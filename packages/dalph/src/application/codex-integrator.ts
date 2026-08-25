/* eslint-disable import/no-nodejs-modules -- this adapter is the explicit provider and filesystem boundary. */

import { randomUUID } from "node:crypto"
import nodePath from "node:path"
import { Context, Effect, FileSystem, Layer, Option, Semaphore } from "effect"
import {
  CodexAppServer,
  CodexOwnedActivityCensus,
  type CodexOwnedActivityCensusProjection,
  type CodexThreadSnapshot
} from "./codex-app-server.js"
import { isTerminalTurn } from "./codex-planned-attempt-executor.js"
import { CodexOwnedTurnToken, CodexThreadOwnershipToken } from "./codex-attempt-store.js"
import {
  bump,
  candidateWorktreePathFor,
  type CodexIntegratorConfiguration,
  CodexIntegratorPrivateRecord,
  CodexIntegratorPrivateRun,
  CodexIntegratorPrivateStore,
  type CodexIntegratorPrivateStoreService,
  type IntegratorCandidateWorktreePath,
  nodeCodexIntegratorPrivateStoreLayer,
  revision,
  runCorrelationEquals,
  sameSession,
  updateRun
} from "./codex-integrator-private-store.js"
import {
  boundary,
  type CodexIntegratorProviderFailure,
  errorDetail,
  observedThread,
  providerFailure
} from "./codex-integrator-runtime.js"
import { ensureCandidateWorktree } from "./codex-integrator-worktree.js"
import { ensureThread } from "./codex-integrator-thread.js"
import { providerAuthorityFor } from "./codex-integrator-cleanup.js"
import { exactEnvelope } from "./codex-integrator-envelope.js"
import {
  Integrator,
  IntegratorCandidateProviderAuthority,
  IntegratorCallFailure,
  IntegratorNotPreparedDetail,
  IntegratorResult,
  type IntegratorRequest,
  type IntegratorRunCorrelation,
  GitCommand,
  type GitCommandService,
  CoordinatorOwnership
} from "@dalph/orchestrator"
const firstProviderRunOrdinal = 1
const maximumProviderRunOrdinal = 2
const promptFor = (run: IntegratorRunCorrelation, candidatePath: IntegratorCandidateWorktreePath): string =>
  [
    "You are the Dalph integration provider.",
    `Target repository: ${run.session.integrationTarget.repository}`,
    `Target ref: ${run.session.integrationTarget.ref}`,
    `Unchanged target head H: ${run.session.expectedTargetHead}`,
    `Accepted commit C: ${run.session.acceptedResult.commit}`,
    `Candidate worktree: ${candidatePath}`,
    `Exact integration run: ${run.session.sessionId}/${run.ordinal}`,
    "Work only inside the candidate worktree. Do not update the target ref.",
    'Return exactly one terminal JSON object: {"version":1,"outcome":"PreparedCandidate","candidate":"<git commit text>"} or {"version":1,"outcome":"NotPrepared","detail":"<safe non-empty detail>"}.'
  ].join("\n")
const activityIsAbsent = (
  projection: CodexOwnedActivityCensusProjection
): Effect.Effect<void, CodexIntegratorProviderFailure> =>
  projection._tag === "Absent"
    ? Effect.void
    : Effect.fail(
        providerFailure(
          projection._tag === "ExactLive"
            ? "provider-owned activity is still live"
            : `provider-owned activity census is ${projection._tag.toLowerCase()}`
        )
      )

const observeQuiescence = (
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  thread: CodexThreadSnapshot
): Effect.Effect<void, CodexIntegratorProviderFailure> =>
  boundary(app.listBackgroundTerminals(thread.id)).pipe(
    Effect.flatMap((terminals) => boundary(census.observe(thread, terminals, "IntegratorSession"))),
    Effect.flatMap(activityIsAbsent)
  )
const configError = (config: CodexIntegratorConfiguration): string | undefined => {
  const root = config.candidateWorktreeRoot
  /* v8 ignore next -- @preserve The branded configuration admits only an absolute, normalized candidate root. */
  return nodePath.isAbsolute(root) && nodePath.normalize(root) === root ? undefined : "candidate root is not canonical"
}
const runFor = (
  record: CodexIntegratorPrivateRecord,
  run: IntegratorRunCorrelation
): CodexIntegratorPrivateRun | undefined => record.runs.find((item) => runCorrelationEquals(item.correlation, run))

const newToken = (): CodexOwnedTurnToken => CodexOwnedTurnToken.make(`dalph-integrator-${randomUUID()}`)

const ensureRunPreconditionError = (
  record: CodexIntegratorPrivateRecord,
  run: IntegratorRunCorrelation
): string | undefined => {
  if (Number(run.ordinal) < firstProviderRunOrdinal || Number(run.ordinal) > maximumProviderRunOrdinal) {
    return "provider run ordinal exceeds Retry"
  }
  if (run.ordinal === maximumProviderRunOrdinal) {
    const first = record.runs.find((item) => item.correlation.ordinal === firstProviderRunOrdinal)
    if (first === undefined || first.phase !== "Sealed" || first.result === null || first.turnId === null) {
      return "Retry run two has no sealed run-one result"
    }
  }
  return undefined
}

const ensureRun = Effect.fn("CodexIntegrator.ensureRun")(function* (
  store: CodexIntegratorPrivateStoreService,
  record: CodexIntegratorPrivateRecord,
  run: IntegratorRunCorrelation,
  app: CodexAppServer["Service"]
) {
  const preconditionError = ensureRunPreconditionError(record, run)
  if (preconditionError !== undefined) return yield* Effect.fail(providerFailure(preconditionError))
  const existing = runFor(record, run)
  if (existing !== undefined) return { record, run: existing }
  const ordinalCollision = record.runs.find((item) => item.correlation.ordinal === run.ordinal)
  /* v8 ignore next -- @preserve The private-record validator rejects duplicate ordinals before recovery reaches this guard. */
  if (ordinalCollision !== undefined)
    return yield* Effect.fail(providerFailure("private run ordinal is bound to another session"))
  const created = CodexIntegratorPrivateRun.make({
    correlation: run,
    phase: "IntentRecorded",
    result: null,
    terminalStatus: null,
    token: newToken(),
    turnId: null
  })
  const next = bump(record, { appServerIncarnation: app.incarnation, runs: [...record.runs, created] })
  yield* boundary(store.write(next))
  return { record: next, run: created }
})
const markTurnBoundaryCrossing = Effect.fn("CodexIntegrator.markTurnBoundaryCrossing")(function* (
  store: CodexIntegratorPrivateStoreService,
  record: CodexIntegratorPrivateRecord,
  run: CodexIntegratorPrivateRun
) {
  const intent = updateRun(record, run, { phase: "TurnBoundaryCrossing" })
  const intentRun = runFor(intent, run.correlation)
  /* v8 ignore next -- @preserve updateRun returns a schema-validated record retaining the exact run correlation. */
  if (intentRun === undefined) return yield* Effect.fail(providerFailure("private turn intent disappeared"))
  yield* boundary(store.write(intent))
  return { record: intent, run: intentRun }
})

const startObservedTurn = Effect.fn("CodexIntegrator.startObservedTurn")(function* (
  app: CodexAppServer["Service"],
  store: CodexIntegratorPrivateStoreService,
  record: CodexIntegratorPrivateRecord,
  run: CodexIntegratorPrivateRun,
  thread: CodexThreadSnapshot
) {
  const started = yield* boundary(
    app.startTurn(thread.id, record.candidatePath, promptFor(run.correlation, record.candidatePath), run.token)
  )
  if (started.ownedTurnToken !== run.token || started.correlation !== undefined) {
    return yield* Effect.fail(providerFailure("turn/start did not return the exact owned token and correlation"))
  }
  const observed = updateRun(record, run, { phase: "TurnObserved", turnId: started.id })
  const observedRun = runFor(observed, run.correlation)
  /* v8 ignore next -- @preserve updateRun returns a schema-validated record retaining the exact run correlation. */
  if (observedRun === undefined) return yield* Effect.fail(providerFailure("private turn observation disappeared"))
  yield* boundary(store.write(observed))
  return { record: observed, run: observedRun, turn: started }
})

const contradictoryProviderTurn = (
  thread: CodexThreadSnapshot,
  record: CodexIntegratorPrivateRecord,
  token: CodexOwnedTurnToken
): CodexThreadSnapshot["turns"][number] | undefined => {
  const knownTokens = new Set(record.runs.map((item) => item.token))
  return thread.turns.find((item) => {
    if (item.ownedTurnToken === token) return false
    if (item.ownedTurnToken === undefined) return true
    const known = record.runs.find((candidate) => candidate.token === item.ownedTurnToken)
    return !knownTokens.has(item.ownedTurnToken) || known?.phase !== "Sealed"
  })
}

const matchingProviderTurnError = (
  run: CodexIntegratorPrivateRun,
  matchingTurn: CodexThreadSnapshot["turns"][number]
): string | undefined => {
  if (run.turnId !== null && matchingTurn.id !== run.turnId) {
    return "owned turn id does not match the exact durable turn"
  }
  return matchingTurn.correlation !== undefined ? "owned provider turn carries a foreign correlation" : undefined
}

const canRecoverMissingProviderTurn = (run: CodexIntegratorPrivateRun): boolean =>
  run.phase === "IntentRecorded" || run.phase === "TurnBoundaryCrossing"

const readOrRecoverTurn = Effect.fn("CodexIntegrator.readOrRecoverTurn")(function* (
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  store: CodexIntegratorPrivateStoreService,
  record: CodexIntegratorPrivateRecord,
  run: CodexIntegratorPrivateRun,
  thread: CodexThreadSnapshot
) {
  const matchingTurns = thread.turns.filter((item) => item.ownedTurnToken === run.token)
  if (matchingTurns.length > 1) return yield* Effect.fail(providerFailure("owned turn token is duplicated"))
  const contradictoryTurn = contradictoryProviderTurn(thread, record, run.token)
  if (contradictoryTurn !== undefined) {
    return yield* Effect.fail(providerFailure("thread contains a tokenless or foreign provider turn"))
  }
  const matchingTurn = matchingTurns[0]
  if (matchingTurn !== undefined) {
    const matchingError = matchingProviderTurnError(run, matchingTurn)
    if (matchingError !== undefined) return yield* Effect.fail(providerFailure(matchingError))
    return { record, run, turn: matchingTurn }
  }
  if (!canRecoverMissingProviderTurn(run)) {
    return yield* Effect.fail(providerFailure("owned turn token is not readable after a sealed turn"))
  }
  // A missing token is retryable only after a complete census proves quiescence.
  yield* observeQuiescence(app, census, thread)
  let currentRecord = record
  let currentRun = run
  if (currentRun.phase === "IntentRecorded") {
    const advanced = yield* markTurnBoundaryCrossing(store, currentRecord, currentRun)
    currentRecord = advanced.record
    currentRun = advanced.run
  }
  return yield* startObservedTurn(app, store, currentRecord, currentRun, thread)
})

const replaySealedRun = Effect.fn("CodexIntegrator.replaySealedRun")(function* (
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  store: CodexIntegratorPrivateStoreService,
  record: CodexIntegratorPrivateRecord,
  run: CodexIntegratorPrivateRun,
  thread: CodexThreadSnapshot,
  result: IntegratorResult
) {
  /* v8 ignore next -- @preserve CodexIntegratorPrivateRecord validates every stored result against its run correlation. */
  if (!runCorrelationEquals(result.correlation, run.correlation)) {
    return yield* Effect.fail(providerFailure("private result has a foreign run correlation"))
  }
  const freshThread = yield* observedThread(app, thread.id, record.candidatePath)
  if (freshThread.ownedThreadToken !== record.threadToken) {
    return yield* Effect.fail(providerFailure("sealed result thread ownership changed before replay"))
  }
  const recovered = yield* readOrRecoverTurn(app, census, store, record, run, freshThread)
  if (!isTerminalTurn(recovered.turn))
    return yield* Effect.fail(providerFailure("sealed provider turn is still active"))
  if (run.terminalStatus === null || recovered.turn.status !== run.terminalStatus) {
    return yield* Effect.fail(providerFailure("fresh terminal turn status contradicts the sealed private result"))
  }
  yield* observeQuiescence(app, census, freshThread)
  return result
})

const sealObservedRun = Effect.fn("CodexIntegrator.sealObservedRun")(function* (
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  store: CodexIntegratorPrivateStoreService,
  record: CodexIntegratorPrivateRecord,
  run: CodexIntegratorPrivateRun,
  thread: CodexThreadSnapshot
) {
  const current = yield* readOrRecoverTurn(app, census, store, record, run, thread)
  const { record: currentRecord, run: currentRun, turn } = current
  /* v8 ignore next -- @preserve readOrRecoverTurn selects only the exact durable turn token and rejects contradictions. */
  if (turn.ownedTurnToken !== currentRun.token || turn.correlation !== undefined) {
    return yield* Effect.fail(providerFailure("terminal turn does not carry the exact owned token and correlation"))
  }
  if (!isTerminalTurn(turn)) return yield* Effect.fail(providerFailure("exact provider turn remains active"))
  yield* observeQuiescence(app, census, thread)
  const result =
    turn.status === "failed"
      ? IntegratorResult.cases.NotPrepared.make({
          correlation: currentRun.correlation,
          detail: IntegratorNotPreparedDetail.make("Codex provider turn failed before producing a candidate")
        })
      : yield* exactEnvelope(turn, currentRun.correlation)
  const terminalStatus = turn.status === "failed" ? "failed" : "completed"
  const sealed = updateRun(currentRecord, currentRun, { phase: "Sealed", result, terminalStatus, turnId: turn.id })
  yield* boundary(store.write(sealed))
  return result
})

const executeRun = Effect.fn("CodexIntegrator.executeRun")(function* (
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  store: CodexIntegratorPrivateStoreService,
  record: CodexIntegratorPrivateRecord,
  run: CodexIntegratorPrivateRun,
  thread: CodexThreadSnapshot
) {
  if (run.result !== null) {
    return yield* replaySealedRun(app, census, store, record, run, thread, run.result)
  }
  return yield* sealObservedRun(app, census, store, record, run, thread)
})
const reconcilePrivateRecord = Effect.fn("CodexIntegrator.reconcilePrivateRecord")(function* (
  found: CodexIntegratorPrivateRecord,
  run: IntegratorRunCorrelation,
  candidatePath: IntegratorCandidateWorktreePath,
  app: CodexAppServer["Service"],
  store: CodexIntegratorPrivateStoreService
) {
  if (!sameSession(found.correlation, run.session) || found.candidatePath !== candidatePath) {
    return yield* Effect.fail(providerFailure("private record belongs to another session or candidate path"))
  }
  if (found.removed === true) return yield* Effect.fail(providerFailure("private candidate record is tombstoned"))
  const current =
    found.appServerIncarnation === app.incarnation ? found : bump(found, { appServerIncarnation: app.incarnation })
  if (current !== found) yield* boundary(store.write(current))
  return current
})
const createPrivateRecord = Effect.fn("CodexIntegrator.createPrivateRecord")(function* (
  run: IntegratorRunCorrelation,
  candidatePath: IntegratorCandidateWorktreePath,
  app: CodexAppServer["Service"],
  store: CodexIntegratorPrivateStoreService
) {
  const occupied = yield* boundary(store.findByCandidatePath(candidatePath))
  if (Option.isSome(occupied)) {
    return yield* Effect.fail(providerFailure("candidate path is already owned by another integration session"))
  }
  const created = CodexIntegratorPrivateRecord.make({
    appServerIncarnation: app.incarnation,
    candidatePath,
    correlation: run.session,
    revision: revision(1),
    removed: false,
    removalIntent: false,
    runs: [],
    threadId: null,
    threadToken: CodexThreadOwnershipToken.make(`dalph-integrator-thread-${randomUUID()}`),
    threadStartIntent: false,
    worktreeMaterializationIntent: false,
    worktreeReady: false
  })
  yield* boundary(store.write(created))
  return created
})
const checkConfigAndRecord = Effect.fn("CodexIntegrator.checkConfigAndRecord")(function* (
  config: CodexIntegratorConfiguration,
  store: CodexIntegratorPrivateStoreService,
  run: IntegratorRunCorrelation,
  app: CodexAppServer["Service"]
) {
  const invalidConfig = configError(config)
  /* v8 ignore next -- @preserve CodexIntegratorConfiguration brands the canonical root before this boundary is callable. */
  if (invalidConfig !== undefined) return yield* Effect.fail(providerFailure(invalidConfig))
  if (run.session.integrationTarget.repository !== config.repository)
    return yield* Effect.fail(providerFailure("request repository is not the configured canonical repository"))
  const candidatePath = candidateWorktreePathFor(config, run.session.candidateResource)
  const found = yield* boundary(store.read(run.session.sessionId))
  if (Option.isSome(found)) return yield* reconcilePrivateRecord(found.value, run, candidatePath, app, store)
  return yield* createPrivateRecord(run, candidatePath, app, store)
})
const integratorServiceFor = (
  config: CodexIntegratorConfiguration,
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  commands: GitCommandService,
  fileSystem: FileSystem.FileSystem,
  store: CodexIntegratorPrivateStoreService,
  gate: Semaphore.Semaphore,
  ownership: CoordinatorOwnership["Service"]
) =>
  Integrator.of({
    prepare: (request: IntegratorRequest) =>
      gate
        .withPermits(1)(
          Effect.gen(function* () {
            const run = request.correlation
            const initial = yield* checkConfigAndRecord(config, store, run, app)
            // The exact run token is durable before any candidate or thread boundary.
            const ensured = yield* ensureRun(store, initial, run, app)
            const materialized = yield* ensureCandidateWorktree(
              commands,
              fileSystem,
              config,
              ensured.record,
              store,
              ownership
            )
            const threaded = yield* ensureThread(app, materialized, store)
            return yield* executeRun(app, census, store, threaded.record, ensured.run, threaded.thread)
          })
        )
        .pipe(
          Effect.mapError(
            (error) => new IntegratorCallFailure({ correlation: request.correlation, detail: errorDetail(error) })
          )
        )
  })

/** Controlled/production provider layer; #259 supplies the shared app server and coordinator ownership. */
export const codexIntegratorLayer = (config: CodexIntegratorConfiguration) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const app = yield* CodexAppServer
      const census = yield* CodexOwnedActivityCensus
      const commands = yield* GitCommand
      const fileSystem = yield* FileSystem.FileSystem
      const store = yield* CodexIntegratorPrivateStore
      const ownership = yield* CoordinatorOwnership
      const gate = yield* Semaphore.make(1)
      return Context.empty().pipe(
        Context.add(
          Integrator,
          integratorServiceFor(config, app, census, commands, fileSystem, store, gate, ownership)
        ),
        Context.add(
          IntegratorCandidateProviderAuthority,
          providerAuthorityFor(config, app, census, commands, fileSystem, store, ownership)
        )
      )
    })
  )

/** Node-backed provider composition with private durable storage. */
export const nodeCodexIntegratorLayer = (config: CodexIntegratorConfiguration) =>
  codexIntegratorLayer(config).pipe(Layer.provide(nodeCodexIntegratorPrivateStoreLayer(config)))
