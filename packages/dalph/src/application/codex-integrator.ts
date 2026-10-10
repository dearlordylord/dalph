/* eslint-disable import/no-nodejs-modules, max-lines -- this adapter is the explicit provider and filesystem boundary. */

import nodePath from "node:path"
import { NodeCrypto } from "@effect/platform-node"
import { Context, Crypto, Effect, FileSystem, Layer, Option, Semaphore, Stream, type Scope } from "effect"
import {
  CodexAppServer,
  CodexOwnedActivityCensus,
  type CodexOwnedActivityCensusProjection,
  type CodexThreadSnapshot,
  type CodexTurnCompletedHint,
  type CodexTurnCompletedSubscription
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
  privateRuns,
  recordRunIntent,
  revision,
  runCorrelationEquals,
  sameSession,
  updateRun
} from "./codex-integrator-private-store.js"
import {
  isRetryProviderRun,
  isSealedPrivateRun,
  newPrivateRecordRunError,
  providerRunAdmissionError
} from "./codex-integrator-private-lifecycle.js"
import { providerPreparationError } from "./codex-integrator-private-preparation.js"
import {
  boundary,
  type CodexIntegratorProviderFailure,
  errorDetail,
  observedThread,
  providerFailure
} from "./codex-integrator-runtime.js"
import { candidateOverlapsPlannedWorktree, ensureCandidateWorktree } from "./codex-integrator-worktree.js"
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
const promptFor = (run: IntegratorRunCorrelation, candidatePath: IntegratorCandidateWorktreePath): string =>
  [
    "You are the Dalph integration provider.",
    `Target repository: ${run.session.integrationTarget.repository}`,
    `Target ref: ${run.session.integrationTarget.ref}`,
    `Unchanged target head H: ${run.session.expectedTargetHead}`,
    `Accepted commit C: ${run.session.acceptedResult.commit}`,
    `Candidate worktree: ${candidatePath}`,
    `Exact integration run: ${run.session.sessionId}/${run.ordinal}`,
    "Initial materialization starts at unchanged target head H. On an authorized Retry the exact owned candidate may retain its merge with ordered parents [H, C]; inspect it, preserve history, and rerun applicable required checks before reporting PreparedCandidate.",
    `Prepare the candidate as the exact integration merge of H and accepted commit C (${run.session.acceptedResult.commit}); the candidate commit must have exact ordered direct parents [H, C]. Do not rebase, cherry-pick, change accepted C, recreate the task change, or update/push the target ref.`,
    "Work only inside the exact candidate worktree for this session/run. Do not update or push the target ref, edit the accepted task worktree, or create another leaf attempt or claim.",
    "You own content-conflict resolution inside this candidate. Read H and C, their changes from the planned Base, repository instructions, and accepted task scenarios/source authorities before resolving.",
    `Planned Base: ${run.session.plannedAttempt.baseSha}`,
    "Attempt the merge and resolve content conflicts in this candidate while preserving both accepted task behavior and existing target behavior. A content conflict alone is not a reason to return NotPrepared. Do not blindly select one whole side.",
    "After a clean merge, a required documentation check may reveal broken relative local Markdown links after relocation. Read the exact diagnostic and existing intended local targets. Only when the intended existing target is unambiguous may you repair lexical path/fragment destinations in Markdown documentation inside this exact candidate.",
    "Preserve link labels, narrative, acceptance content, runtime, tests, fixtures, raw evidence, and manifest-bound bytes. A manifest-bound document is immutable; only its owner may produce an explicitly accepted new evidence artifact. Do not edit hashed evidence.",
    "Select applicable required integration checks from the accepted task/scenarios and the repository documented route. Invoking an optional diagnostic does not make it a mandatory gate. The hosted docs-only git diff --check route does not apply to a mixed application-test/evidence candidate.",
    "A failed applicable required check, including a required whitespace check, remains blocking and requires NotPrepared. Optional diagnostics may fail without blocking Prepared only after all applicable required checks exit0 and preservation is certain. Retain and report the actual failed diagnostic and its limit truthfully; never claim its exit passed or exempt arbitrary files. Preserve raw evidence and manifest-bound byte identities exactly.",
    "An explicit human Retry after conclusive NotPrepared may continue on the same S2/H/C/resource under existing authorization: no numeric Retry cap, no automatic retry, and no S3. Reconcile uncertain outcomes and writers before new effects.",
    "After permitted link repair, run focused check:docs and applicable already-required checks and obtain exit0 before creating the final merge with ordered direct parents [H, C]. Verify accepted C is unchanged as well as the target still H. Never bypass checks, drop evidence, weaken assertions, or perform arbitrary candidate repair or a broad rerun.",
    "If the intended target is ambiguous or absent, repair requires prose/acceptance/evidence-content changes, an applicable required non-documentation check fails, or preservation is uncertain, return conclusive NotPrepared naming the exact boundary. A documentation-check failure permits only the bounded lexical repair above; other required-check failures still require NotPrepared.",
    "If preparation stops before successful checks/result, retain the exact candidate and native custody. Retry/FullRerun requires explicit fresh Operator authorization under existing H/C/session/Q/run/resource rules; reconcile uncertain outcomes and stopped writers before effects. Reuse no missing/failed qualification and never infer Prepared from a process exit.",
    "Run focused checks for the affected behavior after resolution. Verify the reported merge commit has exact ordered direct parents [H, C] and the target ref still names H before returning PreparedCandidate.",
    "If requirements cannot both be preserved, resolution is unsafe, a required scoped check fails, or authorities contradict, return conclusive NotPrepared with the concrete unresolved requirement, failed check, or authority contradiction. Never fabricate success.",
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

const requiresExactCompletionHint = (app: CodexAppServer["Service"]): boolean =>
  app.terminalSealPolicy !== "FreshLifecycleMaySeal"

const attachTurnCompletionHints = (
  app: CodexAppServer["Service"],
  threadId: CodexThreadSnapshot["id"],
  turnId?: CodexTurnCompletedHint["turnId"]
): Effect.Effect<CodexTurnCompletedSubscription | undefined, CodexIntegratorProviderFailure, Scope.Scope> =>
  !requiresExactCompletionHint(app)
    ? Effect.succeed(undefined)
    : app.attachExactTurnCompletedHints === undefined
      ? Effect.fail(providerFailure("exact provider completion hints are unavailable"))
      : app.attachExactTurnCompletedHints(threadId, turnId)

const awaitExactTurnCompletionHint = (
  subscription: CodexTurnCompletedSubscription,
  threadId: CodexTurnCompletedHint["threadId"],
  turnId: CodexTurnCompletedHint["turnId"]
): Effect.Effect<CodexTurnCompletedHint, CodexIntegratorProviderFailure> =>
  subscription.hints.pipe(
    Stream.filter((hint) => hint.threadId === threadId && hint.turnId === turnId),
    Stream.runHead,
    Effect.flatMap((hint) => (Option.isSome(hint) ? Effect.succeed(hint.value) : Effect.never))
  )
const configError = (config: CodexIntegratorConfiguration): string | undefined => {
  const root = config.candidateWorktreeRoot
  /* v8 ignore next -- @preserve The branded configuration admits only an absolute, normalized candidate root. */
  return nodePath.isAbsolute(root) && nodePath.normalize(root) === root ? undefined : "candidate root is not canonical"
}
const runFor = (
  record: CodexIntegratorPrivateRecord,
  run: IntegratorRunCorrelation
): CodexIntegratorPrivateRun | undefined =>
  privateRuns(record).find((item) => runCorrelationEquals(item.correlation, run))

const newToken = (crypto: Crypto.Crypto) =>
  crypto.randomUUIDv4.pipe(
    Effect.map((value) => CodexOwnedTurnToken.make(`dalph-integrator-${value}`)),
    Effect.mapError((error) => providerFailure(String(error)))
  )

const ensureRunPreconditionError = (
  record: CodexIntegratorPrivateRecord,
  run: IntegratorRunCorrelation
): string | undefined => {
  const first = privateRuns(record).find((item) => item.correlation.ordinal === run.ordinal - 1)
  const hasSealedInitialRun = isSealedPrivateRun(first)
  return providerRunAdmissionError(run, hasSealedInitialRun)
}

const ensureRun = Effect.fn("CodexIntegrator.ensureRun")(function* (
  store: CodexIntegratorPrivateStoreService,
  record: CodexIntegratorPrivateRecord,
  run: IntegratorRunCorrelation,
  app: CodexAppServer["Service"],
  crypto: Crypto.Crypto
) {
  const preconditionError = ensureRunPreconditionError(record, run)
  if (preconditionError !== undefined) return yield* Effect.fail(providerFailure(preconditionError))
  const existing = runFor(record, run)
  if (existing !== undefined) return { record, run: existing }
  const ordinalCollision = privateRuns(record).find((item) => item.correlation.ordinal === run.ordinal)
  /* v8 ignore next -- @preserve The private-record validator rejects duplicate ordinals before recovery reaches this guard. */
  if (ordinalCollision !== undefined)
    return yield* Effect.fail(providerFailure("private run ordinal is bound to another session"))
  const created = CodexIntegratorPrivateRun.cases.IntentRecorded.make({
    correlation: run,
    token: yield* newToken(crypto)
  })
  const next = recordRunIntent(record, created, app.incarnation)
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- recordRunIntent explicitly returns undefined for invalid private phases/history; retain this fail-closed guard.
  if (next === undefined)
    return yield* Effect.fail(providerFailure("provider run requires an established owned thread"))
  yield* boundary(store.write(next))
  return { record: next, run: created }
})

const markTurnBoundaryCrossing = Effect.fn("CodexIntegrator.markTurnBoundaryCrossing")(function* (
  store: CodexIntegratorPrivateStoreService,
  record: CodexIntegratorPrivateRecord,
  run: CodexIntegratorPrivateRun
) {
  const intent = updateRun(
    record,
    run,
    CodexIntegratorPrivateRun.cases.TurnBoundaryCrossing.make({ correlation: run.correlation, token: run.token })
  )
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
  thread: CodexThreadSnapshot,
  completionSubscription: CodexTurnCompletedSubscription | undefined
) {
  const subscription = completionSubscription ?? (yield* attachTurnCompletionHints(app, thread.id))
  const started = yield* boundary(
    app.startTurn(thread.id, record.candidatePath, promptFor(run.correlation, record.candidatePath), run.token)
  )
  if (started.ownedTurnToken !== run.token || started.correlation !== undefined) {
    return yield* Effect.fail(providerFailure("turn/start did not return the exact owned token and correlation"))
  }
  const observed = updateRun(
    record,
    run,
    CodexIntegratorPrivateRun.cases.TurnObserved.make({
      correlation: run.correlation,
      token: run.token,
      turnId: started.id
    })
  )
  const observedRun = runFor(observed, run.correlation)
  /* v8 ignore next -- @preserve updateRun returns a schema-validated record retaining the exact run correlation. */
  if (observedRun === undefined) return yield* Effect.fail(providerFailure("private turn observation disappeared"))
  yield* boundary(store.write(observed))
  if (subscription !== undefined) yield* subscription.expectTurnId(started.id)
  return { record: observed, run: observedRun, turn: started, completionSubscription: subscription }
})

const contradictoryProviderTurn = (
  thread: CodexThreadSnapshot,
  record: CodexIntegratorPrivateRecord,
  token: CodexOwnedTurnToken
): CodexThreadSnapshot["turns"][number] | undefined => {
  const knownTokens = new Set(privateRuns(record).map((item) => item.token))
  return thread.turns.find((item) => {
    if (item.ownedTurnToken === token) return false
    if (item.ownedTurnToken === undefined) return true
    const known = privateRuns(record).find((candidate) => candidate.token === item.ownedTurnToken)
    return !knownTokens.has(item.ownedTurnToken) || !isSealedPrivateRun(known)
  })
}

const matchingProviderTurnError = (
  run: CodexIntegratorPrivateRun,
  matchingTurn: CodexThreadSnapshot["turns"][number]
): string | undefined => {
  if ((run._tag === "TurnObserved" || isSealedPrivateRun(run)) && matchingTurn.id !== run.turnId) {
    return "owned turn id does not match the exact durable turn"
  }
  return matchingTurn.correlation !== undefined ? "owned provider turn carries a foreign correlation" : undefined
}

const canRecoverMissingProviderTurn = (run: CodexIntegratorPrivateRun): boolean =>
  run._tag === "IntentRecorded" || run._tag === "TurnBoundaryCrossing"

const readOrRecoverTurn = Effect.fn("CodexIntegrator.readOrRecoverTurn")(function* (
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  store: CodexIntegratorPrivateStoreService,
  record: CodexIntegratorPrivateRecord,
  run: CodexIntegratorPrivateRun,
  thread: CodexThreadSnapshot,
  completionSubscription?: CodexTurnCompletedSubscription
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
  if (currentRun._tag === "IntentRecorded") {
    const advanced = yield* markTurnBoundaryCrossing(store, currentRecord, currentRun)
    currentRecord = advanced.record
    currentRun = advanced.run
  }
  return yield* startObservedTurn(app, store, currentRecord, currentRun, thread, completionSubscription)
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
  const terminalStatus = run._tag === "FailedTurnSealed" ? "failed" : "completed"
  if (recovered.turn.status !== terminalStatus) {
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
  thread: CodexThreadSnapshot,
  completionSubscription: CodexTurnCompletedSubscription | undefined,
  deliveredCompletionHint: CodexTurnCompletedHint | undefined
) {
  const subscription =
    completionSubscription ??
    (yield* attachTurnCompletionHints(app, thread.id, run._tag === "TurnObserved" ? run.turnId : undefined))
  let currentThread = thread
  let current = yield* readOrRecoverTurn(app, census, store, record, run, thread, subscription)
  if (requiresExactCompletionHint(app) && current.run._tag === "TurnObserved") {
    const observedTurnId = current.run.turnId
    // Reopen reconciliation has already consumed this exact hint and supplied
    // the fresh thread snapshot. Reuse its exact T observation instead of
    // resuming the same thread a second time; the terminal path below still
    // requires the complete absent-activity census before sealing. If this
    // snapshot is active, wait for a later matching hint before rereading.
    let terminalRereadObserved = deliveredCompletionHint !== undefined && isTerminalTurn(current.turn)
    while (!terminalRereadObserved) {
      const hint =
        subscription === undefined
          ? yield* Effect.fail(providerFailure("exact provider completion hints are unavailable"))
          : yield* awaitExactTurnCompletionHint(subscription, thread.id, observedTurnId)
      if (hint.threadId !== thread.id || hint.turnId !== observedTurnId) {
        return yield* Effect.fail(providerFailure("completion hint does not match the exact private Integrator turn"))
      }
      currentThread = yield* observedThread(app, thread.id, record.candidatePath)
      if (currentThread.ownedThreadToken !== record.threadToken) {
        return yield* Effect.fail(providerFailure("fresh completion thread has a foreign ownership token"))
      }
      current = yield* readOrRecoverTurn(app, census, store, current.record, current.run, currentThread, subscription)
      terminalRereadObserved = isTerminalTurn(current.turn)
    }
  }
  const { record: currentRecord, run: currentRun, turn } = current
  /* v8 ignore next -- @preserve readOrRecoverTurn selects only the exact durable turn token and rejects contradictions. */
  if (turn.ownedTurnToken !== currentRun.token || turn.correlation !== undefined) {
    return yield* Effect.fail(providerFailure("terminal turn does not carry the exact owned token and correlation"))
  }
  if (!isTerminalTurn(turn)) return yield* Effect.fail(providerFailure("exact provider turn remains active"))
  yield* observeQuiescence(app, census, currentThread)
  const sealedIdentity = { correlation: currentRun.correlation, token: currentRun.token, turnId: turn.id }
  if (turn.status === "failed") {
    const result = IntegratorResult.cases.NotPrepared.make({
      correlation: currentRun.correlation,
      detail: IntegratorNotPreparedDetail.make("Codex provider turn failed before producing a candidate")
    })
    const sealed = updateRun(
      currentRecord,
      currentRun,
      CodexIntegratorPrivateRun.cases.FailedTurnSealed.make({ ...sealedIdentity, result })
    )
    yield* boundary(store.write(sealed))
    return result
  }
  const result = yield* exactEnvelope(turn, currentRun.correlation)
  const sealedRun = CodexIntegratorPrivateRun.cases.CompletedTurnSealed.make({ ...sealedIdentity, result })
  const sealed = updateRun(currentRecord, currentRun, sealedRun)
  yield* boundary(store.write(sealed))
  return result
})

const executeRun = Effect.fn("CodexIntegrator.executeRun")(function* (
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  store: CodexIntegratorPrivateStoreService,
  record: CodexIntegratorPrivateRecord,
  run: CodexIntegratorPrivateRun,
  thread: CodexThreadSnapshot,
  completionSubscription: CodexTurnCompletedSubscription | undefined,
  deliveredCompletionHint: CodexTurnCompletedHint | undefined
) {
  if (isSealedPrivateRun(run)) {
    return yield* replaySealedRun(app, census, store, record, run, thread, run.result)
  }
  return yield* sealObservedRun(
    app,
    census,
    store,
    record,
    run,
    thread,
    completionSubscription,
    deliveredCompletionHint
  )
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
  const preparationError = providerPreparationError(found, run)
  if (preparationError !== undefined) return yield* Effect.fail(providerFailure(preparationError))
  const current =
    found.appServerIncarnation === app.incarnation ? found : bump(found, { appServerIncarnation: app.incarnation })
  if (current !== found) yield* boundary(store.write(current))
  return current
})
const createPrivateRecord = Effect.fn("CodexIntegrator.createPrivateRecord")(function* (
  run: IntegratorRunCorrelation,
  candidatePath: IntegratorCandidateWorktreePath,
  app: CodexAppServer["Service"],
  store: CodexIntegratorPrivateStoreService,
  crypto: Crypto.Crypto
) {
  const initialRunError = newPrivateRecordRunError(run)
  if (initialRunError !== undefined) return yield* Effect.fail(providerFailure(initialRunError))
  const occupied = yield* boundary(store.findByCandidatePath(candidatePath))
  if (Option.isSome(occupied)) {
    return yield* Effect.fail(providerFailure("candidate path is already owned by another integration session"))
  }
  const created = CodexIntegratorPrivateRecord.cases.CandidateUnmaterialized.make({
    appServerIncarnation: app.incarnation,
    candidatePath,
    correlation: run.session,
    initialRun: run,
    revision: revision(1),
    threadToken: CodexThreadOwnershipToken.make(
      `dalph-integrator-thread-${yield* crypto.randomUUIDv4.pipe(Effect.mapError((error) => providerFailure(String(error))))}`
    )
  })
  yield* boundary(store.write(created))
  return created
})
const checkConfigAndRecord = Effect.fn("CodexIntegrator.checkConfigAndRecord")(function* (
  config: CodexIntegratorConfiguration,
  store: CodexIntegratorPrivateStoreService,
  run: IntegratorRunCorrelation,
  app: CodexAppServer["Service"],
  crypto: Crypto.Crypto
) {
  const invalidConfig = configError(config)
  /* v8 ignore next -- @preserve CodexIntegratorConfiguration brands the canonical root before this boundary is callable. */
  if (invalidConfig !== undefined) return yield* Effect.fail(providerFailure(invalidConfig))
  if (run.session.integrationTarget.repository !== config.repository)
    return yield* Effect.fail(providerFailure("request repository is not the configured canonical repository"))
  const candidatePath = candidateWorktreePathFor(config, run.session.candidateResource)
  if (candidateOverlapsPlannedWorktree(candidatePath, run.session.plannedAttempt.worktree)) {
    return yield* Effect.fail(providerFailure("candidate worktree must be disjoint from the planned-attempt worktree"))
  }
  const found = yield* boundary(store.read(run.session.sessionId))
  if (Option.isSome(found)) return yield* reconcilePrivateRecord(found.value, run, candidatePath, app, store)
  return yield* createPrivateRecord(run, candidatePath, app, store, crypto)
})
/** A retained merge is reusable only after rereading the exact sealed NotPrepared predecessor and stopped writers. */
const reconcileRetainedMergeRetry = Effect.fn("CodexIntegrator.reconcileRetainedMergeRetry")(function* (
  record: CodexIntegratorPrivateRecord,
  run: IntegratorRunCorrelation,
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  store: CodexIntegratorPrivateStoreService
) {
  const predecessor = privateRuns(record).find((item) => item.correlation.ordinal === run.ordinal - 1)
  if (!isRetryProviderRun(run) || !isSealedPrivateRun(predecessor) || predecessor.result._tag !== "NotPrepared") {
    return yield* Effect.fail(providerFailure("retained merge Retry requires a sealed NotPrepared predecessor"))
  }
  const threaded = yield* ensureThread(app, record, store)
  const fresh = yield* observedThread(app, threaded.thread.id, record.candidatePath)
  if (fresh.ownedThreadToken !== record.threadToken) {
    return yield* Effect.fail(providerFailure("retained Retry thread ownership changed"))
  }
  const matching = fresh.turns.filter((turn) => turn.ownedTurnToken === predecessor.token)
  const terminalStatus = predecessor._tag === "FailedTurnSealed" ? "failed" : "completed"
  if (matching.length !== 1 || matching[0]?.id !== predecessor.turnId || matching[0].status !== terminalStatus) {
    return yield* Effect.fail(providerFailure("retained Retry predecessor terminal evidence changed"))
  }
  for (const turn of fresh.turns) {
    const known = privateRuns(record).find((item) => item.token === turn.ownedTurnToken)
    if (
      known === undefined ||
      matchingProviderTurnError(known, turn) !== undefined ||
      (!isSealedPrivateRun(known) && !runCorrelationEquals(known.correlation, run)) ||
      (isSealedPrivateRun(known) && turn.status !== (known._tag === "FailedTurnSealed" ? "failed" : "completed"))
    ) {
      return yield* Effect.fail(providerFailure("retained Retry contains foreign or contradictory provider history"))
    }
  }
  yield* observeQuiescence(app, census, fresh)
})
const integratorServiceFor = (
  config: CodexIntegratorConfiguration,
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  commands: GitCommandService,
  fileSystem: FileSystem.FileSystem,
  store: CodexIntegratorPrivateStoreService,
  gate: Semaphore.Semaphore,
  ownership: CoordinatorOwnership["Service"],
  crypto: Crypto.Crypto
) =>
  Integrator.of({
    prepare: (request: IntegratorRequest) =>
      gate
        .withPermits(1)(
          Effect.scoped(
            Effect.gen(function* () {
              const run = request.correlation
              const initial = yield* checkConfigAndRecord(config, store, run, app, crypto)
              const materialized = yield* ensureCandidateWorktree(
                commands,
                fileSystem,
                config,
                initial,
                store,
                ownership,
                reconcileRetainedMergeRetry(initial, run, app, census, store)
              )
              const existingRun = runFor(materialized, run)
              const existingThreadId =
                materialized._tag === "ThreadWithRuns" || materialized._tag === "RemovalIntentRecorded"
                  ? materialized.threadId
                  : undefined
              const completionSubscription =
                existingThreadId !== undefined &&
                (existingRun?._tag === "TurnObserved" || existingRun?._tag === "TurnBoundaryCrossing")
                  ? yield* attachTurnCompletionHints(
                      app,
                      existingThreadId,
                      existingRun._tag === "TurnObserved" ? existingRun.turnId : undefined
                    )
                  : undefined
              let deliveredCompletionHint: CodexTurnCompletedHint | undefined
              if (existingRun?._tag === "TurnObserved" && requiresExactCompletionHint(app)) {
                if (existingThreadId === undefined) {
                  return yield* providerFailure("private Integrator thread identity is unavailable")
                }
                if (completionSubscription === undefined) {
                  return yield* providerFailure("exact provider completion hints are unavailable")
                }
                deliveredCompletionHint = yield* awaitExactTurnCompletionHint(
                  completionSubscription,
                  existingThreadId,
                  existingRun.turnId
                )
              }
              const threaded = yield* ensureThread(app, materialized, store)
              // A new Retry may record its run-two token only after the retained thread is freshly writer-free.
              if (isRetryProviderRun(run) && runFor(threaded.record, run) === undefined) {
                yield* observeQuiescence(app, census, threaded.thread)
              }
              // The thread id is durable before the first exact provider-run token is recorded.
              const ensured = yield* ensureRun(store, threaded.record, run, app, crypto)
              return yield* executeRun(
                app,
                census,
                store,
                ensured.record,
                ensured.run,
                threaded.thread,
                completionSubscription,
                deliveredCompletionHint
              )
            })
          )
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
      const crypto = yield* Crypto.Crypto
      const gate = yield* Semaphore.make(1)
      return Context.empty().pipe(
        Context.add(
          Integrator,
          integratorServiceFor(config, app, census, commands, fileSystem, store, gate, ownership, crypto)
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
  codexIntegratorLayer(config).pipe(
    Layer.provide(nodeCodexIntegratorPrivateStoreLayer(config)),
    Layer.provide(NodeCrypto.layer)
  )
