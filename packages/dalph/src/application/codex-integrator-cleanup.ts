/* eslint-disable max-lines -- Exact provider cleanup observation and retry stay co-located for auditability. */

import { Effect, Option } from "effect"
import { WorktreeLocator } from "@dalph/contracts"
import type { FileSystem } from "effect"
import type {
  CodexAppServer,
  CodexOwnedActivityCensus,
  CodexOwnedActivityCensusProjection,
  CodexThreadSnapshot
} from "./codex-app-server.js"
import {
  candidateWorktreePathFor,
  preserveRevision,
  type CodexIntegratorConfiguration,
  type CodexIntegratorPrivateRecord,
  type CodexIntegratorPrivateStoreService,
  type IntegratorCandidateWorktreePath,
  sameSession
} from "./codex-integrator-private-store.js"
import { boundary, errorDetail, observedThread, providerFailure } from "./codex-integrator-runtime.js"
import { type GitWorktreeRecord, readWorktrees } from "./codex-integrator-worktree.js"
import {
  IntegratorCandidateCleanupMutationResult,
  type IntegratorCandidateCleanupAuthorization,
  type IntegratorCandidateCleanupEvidenceSubject,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupObservation,
  IntegratorCandidateProviderAuthority,
  type CoordinatorOwnership,
  type IntegratorSessionCorrelation,
  type GitCommandService
} from "@dalph/orchestrator"

type CleanupForeignReason = "OtherSession" | "Transferred" | "LiveWriter"

const cleanupForeign = (
  authorization: IntegratorCandidateCleanupAuthorization,
  observedSessionId: IntegratorSessionCorrelation["sessionId"],
  reason: CleanupForeignReason,
  revision: IntegratorCandidateCleanupEvidenceRevision = authorization.evidenceRevision
): IntegratorCandidateCleanupObservation =>
  IntegratorCandidateCleanupObservation.cases.Foreign.make({
    locator: authorization.locator,
    observedSessionId,
    reason,
    revision
  })

const cleanupAbsent = (
  authorization: IntegratorCandidateCleanupAuthorization,
  revision: IntegratorCandidateCleanupEvidenceRevision
): IntegratorCandidateCleanupObservation =>
  IntegratorCandidateCleanupObservation.cases.Absent.make({ locator: authorization.locator, revision })

const privateRevision = (record: CodexIntegratorPrivateRecord): IntegratorCandidateCleanupEvidenceRevision =>
  IntegratorCandidateCleanupEvidenceRevision.make(Number(record.revision))

const cleanupUnreadable = (
  authorization: IntegratorCandidateCleanupAuthorization,
  detail: string
): IntegratorCandidateCleanupObservation =>
  IntegratorCandidateCleanupObservation.cases.Unreadable.make({ detail, locator: authorization.locator })

const cleanupMissingPrivateRecord = Effect.fn("CodexIntegrator.cleanupMissingPrivateRecord")(function* (
  authorization: IntegratorCandidateCleanupAuthorization,
  candidatePath: IntegratorCandidateWorktreePath,
  store: CodexIntegratorPrivateStoreService
) {
  const occupied = yield* boundary(store.findByCandidatePath(candidatePath))
  return Option.isSome(occupied)
    ? cleanupForeign(
        authorization,
        occupied.value.correlation.sessionId,
        "OtherSession",
        privateRevision(occupied.value)
      )
    : cleanupUnreadable(authorization, "private predecessor record is absent; absence cannot be inferred")
})

const terminalTurnEvidence = (
  authorization: IntegratorCandidateCleanupAuthorization,
  predecessor: IntegratorSessionCorrelation,
  record: CodexIntegratorPrivateRecord,
  thread: CodexThreadSnapshot
): IntegratorCandidateCleanupObservation | undefined => {
  const expected = record.runs[record.runs.length - 1]
  if (expected === undefined || expected.phase !== "Sealed" || expected.result === null || expected.turnId === null) {
    return cleanupUnreadable(authorization, "private predecessor has no sealed terminal turn evidence")
  }
  if (
    expected.terminalStatus === null ||
    (expected.terminalStatus === "failed" && expected.result._tag !== "NotPrepared") ||
    (expected.result._tag === "PreparedCandidate" && expected.terminalStatus !== "completed")
  ) {
    return cleanupUnreadable(authorization, "private predecessor has contradictory sealed terminal outcome evidence")
  }
  if (thread.status === "active") return cleanupForeign(authorization, predecessor.sessionId, "LiveWriter")
  const knownTokens = new Set(record.runs.map((run) => run.token))
  if (thread.turns.some((turn) => turn.ownedTurnToken === undefined)) {
    return cleanupUnreadable(authorization, "candidate thread contains a tokenless turn")
  }
  const foreign = thread.turns.find(
    (turn) => turn.ownedTurnToken !== undefined && !knownTokens.has(turn.ownedTurnToken)
  )
  if (foreign !== undefined) return cleanupForeign(authorization, predecessor.sessionId, "OtherSession")
  const matching = thread.turns.filter((turn) => turn.ownedTurnToken === expected.token)
  if (matching.length !== 1) {
    return cleanupUnreadable(authorization, "candidate thread lacks the exact sealed terminal turn")
  }
  const exact = matching[0]
  if (exact === undefined || exact.id !== expected.turnId) {
    return cleanupUnreadable(authorization, "candidate thread lacks the exact sealed terminal turn")
  }
  if (exact.correlation !== undefined) return cleanupForeign(authorization, predecessor.sessionId, "OtherSession")
  if (exact.status === "inProgress") return cleanupForeign(authorization, predecessor.sessionId, "LiveWriter")
  if (exact.status !== "completed" && exact.status !== "failed") {
    return cleanupUnreadable(authorization, "candidate terminal turn status is not conclusive")
  }
  if (exact.status !== expected.terminalStatus) {
    return cleanupUnreadable(authorization, "candidate terminal turn status contradicts the private sealed result")
  }
  return undefined
}

const cleanupWithoutRegistration = Effect.fn("CodexIntegrator.cleanupWithoutRegistration")(function* (
  authorization: IntegratorCandidateCleanupAuthorization,
  predecessor: IntegratorSessionCorrelation,
  record: CodexIntegratorPrivateRecord,
  pathExists: boolean,
  store: CodexIntegratorPrivateStoreService,
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"]
) {
  const revision = privateRevision(record)
  if (record.worktreeMaterializationIntent === true) {
    return cleanupUnreadable(authorization, "candidate worktree materialization remains unresolved")
  }
  if (pathExists) return cleanupForeign(authorization, predecessor.sessionId, "Transferred", revision)
  if (record.removed === true) return cleanupAbsent(authorization, revision)
  if (record.threadStartIntent || record.threadId === null) {
    return cleanupUnreadable(authorization, "provider thread ownership is unresolved; absence cannot be inferred")
  }
  if (record.removalIntent === true) {
    const thread = yield* observedThread(app, record.threadId, record.candidatePath)
    if (thread.ownedThreadToken !== record.threadToken) {
      return cleanupForeign(authorization, predecessor.sessionId, "OtherSession", revision)
    }
    const terminalEvidence = terminalTurnEvidence(authorization, predecessor, record, thread)
    if (terminalEvidence !== undefined) return terminalEvidence
    const terminals = yield* boundary(app.listBackgroundTerminals(thread.id))
    const projection = yield* boundary(census.observe(thread, terminals, "IntegratorSession"))
    if (projection._tag === "ExactLive") {
      return cleanupForeign(authorization, predecessor.sessionId, "LiveWriter", revision)
    }
    if (projection._tag === "Unreadable" || projection._tag === "Contradictory") {
      return cleanupUnreadable(authorization, projection.detail)
    }
    yield* boundary(
      store.write(
        preserveRevision(record, { removalIntent: false, removed: true, threadId: null, worktreeReady: false })
      )
    )
    return cleanupAbsent(authorization, revision)
  }
  return cleanupForeign(authorization, predecessor.sessionId, "Transferred", revision)
})

const cleanupProjection = (
  authorization: IntegratorCandidateCleanupAuthorization,
  predecessor: IntegratorSessionCorrelation,
  projection: CodexOwnedActivityCensusProjection,
  revision: IntegratorCandidateCleanupEvidenceRevision
): IntegratorCandidateCleanupObservation => {
  if (projection._tag === "ExactLive")
    return cleanupForeign(authorization, predecessor.sessionId, "LiveWriter", revision)
  if (projection._tag === "Unreadable" || projection._tag === "Contradictory") {
    return cleanupUnreadable(authorization, projection.detail)
  }
  return IntegratorCandidateCleanupObservation.cases.Present.make({
    locator: authorization.locator,
    revision,
    sessionId: predecessor.sessionId,
    writerQuiescent: true
  })
}

const registrationIsForeign = (registration: GitWorktreeRecord, predecessor: IntegratorSessionCorrelation): boolean =>
  registration.head !== predecessor.expectedTargetHead ||
  registration.branch !== undefined ||
  !registration.detached ||
  registration.prunable

const cleanupRegistered = Effect.fn("CodexIntegrator.cleanupRegistered")(function* (
  authorization: IntegratorCandidateCleanupAuthorization,
  predecessor: IntegratorSessionCorrelation,
  record: CodexIntegratorPrivateRecord,
  registration: GitWorktreeRecord,
  candidatePath: IntegratorCandidateWorktreePath,
  pathExists: boolean,
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"]
) {
  const revision = privateRevision(record)
  if (record.worktreeMaterializationIntent === true) {
    return cleanupUnreadable(authorization, "candidate worktree materialization remains unresolved")
  }
  if (record.removed === true) return cleanupForeign(authorization, predecessor.sessionId, "Transferred", revision)
  if (registrationIsForeign(registration, predecessor)) {
    return cleanupForeign(authorization, predecessor.sessionId, "Transferred", revision)
  }
  if (!pathExists)
    return cleanupUnreadable(authorization, "candidate is registered by Git but its filesystem path is absent")
  if (record.threadStartIntent || record.threadId === null) {
    return cleanupUnreadable(authorization, "candidate has no settled provider thread")
  }
  const thread = yield* observedThread(app, record.threadId, candidatePath)
  if (thread.ownedThreadToken !== record.threadToken) {
    return cleanupForeign(authorization, predecessor.sessionId, "OtherSession", revision)
  }
  const terminalEvidence = terminalTurnEvidence(authorization, predecessor, record, thread)
  if (terminalEvidence !== undefined) return terminalEvidence
  const terminals = yield* boundary(app.listBackgroundTerminals(thread.id))
  const projection = yield* boundary(census.observe(thread, terminals, "IntegratorSession"))
  return cleanupProjection(authorization, predecessor, projection, revision)
})

const cleanupObservationFor = Effect.fn("CodexIntegrator.cleanupObservationFor")(function* (
  config: CodexIntegratorConfiguration,
  authorization: IntegratorCandidateCleanupAuthorization,
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  commands: GitCommandService,
  fileSystem: FileSystem.FileSystem,
  store: CodexIntegratorPrivateStoreService
) {
  const predecessor = authorization.disposition.predecessor
  const candidatePath = candidateWorktreePathFor(config, predecessor.candidateResource)
  /* v8 ignore next -- @preserve The authorization schema fixes the locator to the predecessor resource and the path brand rejects an empty canonical path. */
  if (candidatePath === "" || authorization.locator !== predecessor.candidateResource) {
    return cleanupForeign(authorization, predecessor.sessionId, "Transferred")
  }
  const found = yield* boundary(store.read(predecessor.sessionId))
  if (Option.isNone(found)) return yield* cleanupMissingPrivateRecord(authorization, candidatePath, store)
  const record = found.value
  if (!sameSession(record.correlation, predecessor) || record.candidatePath !== candidatePath) {
    return cleanupForeign(authorization, record.correlation.sessionId, "OtherSession", privateRevision(record))
  }
  const actualRevision = privateRevision(record)
  if (actualRevision !== authorization.evidenceRevision) {
    return cleanupUnreadable(
      authorization,
      `private predecessor revision ${String(actualRevision)} is stale against authorization revision ${String(authorization.evidenceRevision)}`
    )
  }
  const records = yield* readWorktrees(commands, config)
  const registration = records.find((item) => item.worktree === WorktreeLocator.make(candidatePath))
  const pathExists = yield* boundary(fileSystem.exists(candidatePath))
  if (registration === undefined) {
    return yield* cleanupWithoutRegistration(authorization, predecessor, record, pathExists, store, app, census)
  }
  return yield* cleanupRegistered(
    authorization,
    predecessor,
    record,
    registration,
    candidatePath,
    pathExists,
    app,
    census
  )
})

const removalNotPermitted = (
  authorization: IntegratorCandidateCleanupAuthorization,
  observation: IntegratorCandidateCleanupObservation
): IntegratorCandidateCleanupMutationResult =>
  observation._tag === "Absent"
    ? IntegratorCandidateCleanupMutationResult.cases.AlreadyAbsent.make({
        locator: authorization.locator,
        revision: authorization.evidenceRevision,
        sessionId: authorization.owner.sessionId
      })
    : IntegratorCandidateCleanupMutationResult.cases.DefinitelyNotApplied.make({
        detail: "fresh provider ownership observation did not permit removal",
        locator: authorization.locator,
        sessionId: authorization.owner.sessionId
      })

const reconcileFailedRemoval = (
  authorization: IntegratorCandidateCleanupAuthorization,
  result: { readonly exitCode: number; readonly stderr: string },
  observation: IntegratorCandidateCleanupObservation
): IntegratorCandidateCleanupMutationResult =>
  observation._tag === "Absent"
    ? IntegratorCandidateCleanupMutationResult.cases.AlreadyAbsent.make({
        locator: authorization.locator,
        revision: authorization.evidenceRevision,
        sessionId: authorization.owner.sessionId
      })
    : observation._tag === "Foreign"
      ? IntegratorCandidateCleanupMutationResult.cases.DefinitelyNotApplied.make({
          detail: `candidate ownership changed during Git removal (${observation.reason})`,
          locator: authorization.locator,
          sessionId: authorization.owner.sessionId
        })
      : IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
          detail: result.stderr.trim() || `git exited ${result.exitCode}`,
          locator: authorization.locator,
          sessionId: authorization.owner.sessionId
        })

const removeOwnedCandidate = Effect.fn("CodexIntegrator.removeOwnedCandidate")(function* (
  authorization: IntegratorCandidateCleanupAuthorization,
  config: CodexIntegratorConfiguration,
  observe: (
    authorization: IntegratorCandidateCleanupAuthorization
  ) => Effect.Effect<IntegratorCandidateCleanupObservation>,
  commands: GitCommandService,
  store: CodexIntegratorPrivateStoreService,
  ownership: CoordinatorOwnership["Service"]
) {
  const found = yield* boundary(store.read(authorization.owner.sessionId))
  if (Option.isNone(found)) {
    return IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
      detail: "private predecessor record disappeared before removal intent",
      locator: authorization.locator,
      sessionId: authorization.owner.sessionId
    })
  }
  const candidatePath = candidateWorktreePathFor(config, authorization.locator)
  if (
    !sameSession(found.value.correlation, authorization.disposition.predecessor) ||
    found.value.candidatePath !== candidatePath
  ) {
    return IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
      detail: "private predecessor correlation or path changed before removal intent",
      locator: authorization.locator,
      sessionId: authorization.owner.sessionId
    })
  }
  if (privateRevision(found.value) !== authorization.evidenceRevision) {
    return IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
      detail: "private predecessor revision changed before removal intent",
      locator: authorization.locator,
      sessionId: authorization.owner.sessionId
    })
  }
  yield* boundary(store.write(preserveRevision(found.value, { removalIntent: true, removed: false })))
  const intent = yield* boundary(store.read(authorization.owner.sessionId))
  if (Option.isNone(intent)) {
    return IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
      detail: "private predecessor record disappeared after removal intent",
      locator: authorization.locator,
      sessionId: authorization.owner.sessionId
    })
  }
  if (
    !sameSession(intent.value.correlation, authorization.disposition.predecessor) ||
    intent.value.candidatePath !== candidatePath ||
    privateRevision(intent.value) !== authorization.evidenceRevision ||
    intent.value.removalIntent !== true
  ) {
    return IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
      detail: "private predecessor correlation or path changed before Git removal",
      locator: authorization.locator,
      sessionId: authorization.owner.sessionId
    })
  }
  const revalidated = yield* observe(authorization)
  if (revalidated._tag === "Unreadable") {
    return IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
      detail: "provider ownership became unreadable before Git removal",
      locator: authorization.locator,
      sessionId: authorization.owner.sessionId
    })
  }
  if (revalidated._tag !== "Present") return removalNotPermitted(authorization, revalidated)
  const mutation = boundary(
    commands.run(config.commonDirectory, ["worktree", "remove", "--force", "--", candidatePath])
  )
  const result = yield* ownership.runMutation(mutation)
  if (result.exitCode !== 0) return reconcileFailedRemoval(authorization, result, yield* observe(authorization))
  const settled = yield* observe(authorization)
  if (settled._tag !== "Absent") {
    if (settled._tag === "Foreign") {
      return IntegratorCandidateCleanupMutationResult.cases.DefinitelyNotApplied.make({
        detail: `candidate ownership changed after Git removal (${settled.reason})`,
        locator: authorization.locator,
        sessionId: authorization.owner.sessionId
      })
    }
    return IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
      detail: "Git remove returned but exact candidate remains registered",
      locator: authorization.locator,
      sessionId: authorization.owner.sessionId
    })
  }
  const foundAfter = yield* boundary(store.read(authorization.owner.sessionId))
  if (Option.isNone(foundAfter)) {
    return IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
      detail: "Git remove returned and private predecessor tombstone was not observed",
      locator: authorization.locator,
      sessionId: authorization.owner.sessionId
    })
  }
  if (
    !sameSession(foundAfter.value.correlation, authorization.disposition.predecessor) ||
    foundAfter.value.candidatePath !== candidatePath
  ) {
    return IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
      detail: "Git remove returned but the private predecessor record became foreign",
      locator: authorization.locator,
      sessionId: authorization.owner.sessionId
    })
  }
  const tombstone = preserveRevision(foundAfter.value, {
    removalIntent: false,
    removed: true,
    threadId: null,
    worktreeReady: false
  })
  yield* boundary(store.write(tombstone))
  const confirmed = yield* boundary(store.read(authorization.owner.sessionId))
  if (Option.isNone(confirmed) || !confirmed.value.removed || confirmed.value.candidatePath !== candidatePath) {
    return IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
      detail: "Git remove returned but the private predecessor tombstone was not durable",
      locator: authorization.locator,
      sessionId: authorization.owner.sessionId
    })
  }
  return IntegratorCandidateCleanupMutationResult.cases.Removed.make({
    locator: authorization.locator,
    revision: authorization.evidenceRevision,
    sessionId: authorization.owner.sessionId
  })
})

export const providerAuthorityFor = (
  config: CodexIntegratorConfiguration,
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  commands: GitCommandService,
  fileSystem: FileSystem.FileSystem,
  store: CodexIntegratorPrivateStoreService,
  ownership: CoordinatorOwnership["Service"]
) => {
  const readEvidenceRevision = (subject: IntegratorCandidateCleanupEvidenceSubject) =>
    boundary(store.read(subject.predecessor.sessionId)).pipe(
      Effect.flatMap((found) => {
        if (Option.isNone(found)) return Effect.fail(providerFailure("private predecessor record is absent"))
        const record = found.value
        return sameSession(record.correlation, subject.predecessor) &&
          record.candidatePath === candidateWorktreePathFor(config, subject.locator)
          ? Effect.succeed(privateRevision(record))
          : Effect.fail(providerFailure("private predecessor record is foreign to cleanup evidence"))
      })
    )
  const observe = (authorization: IntegratorCandidateCleanupAuthorization) =>
    cleanupObservationFor(config, authorization, app, census, commands, fileSystem, store).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          IntegratorCandidateCleanupObservation.cases.Unreadable.make({
            detail: errorDetail(error),
            locator: authorization.locator
          })
        )
      )
    )
  const remove = (
    authorization: IntegratorCandidateCleanupAuthorization,
    _attempt: Parameters<IntegratorCandidateProviderAuthority["Service"]["remove"]>[1]
  ) =>
    Effect.gen(function* () {
      const initial = yield* observe(authorization)
      if (initial._tag !== "Present") return removalNotPermitted(authorization, initial)
      return yield* removeOwnedCandidate(authorization, config, observe, commands, store, ownership)
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
            detail: errorDetail(error),
            locator: authorization.locator,
            sessionId: authorization.owner.sessionId
          })
        )
      )
    )
  return IntegratorCandidateProviderAuthority.of({ readEvidenceRevision, observe, remove })
}
