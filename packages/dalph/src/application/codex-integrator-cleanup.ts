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
  CodexIntegratorPrivateLifecycle,
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

type SealedTerminalRunValidation =
  | { readonly _tag: "Valid"; readonly expected: SealedTerminalRun }
  | { readonly _tag: "Invalid"; readonly detail: string }

/** Cleanup evidence whose durable result, turn, and terminal status are mutually compatible. */
type SealedTerminalRun = Extract<
  CodexIntegratorPrivateRecord["runs"][number],
  { readonly _tag: "CompletedTurnSealed" | "FailedTurnSealed" }
>

const hasSealedTerminalRunEvidence = (
  expected: CodexIntegratorPrivateRecord["runs"][number] | undefined
): expected is SealedTerminalRun => expected?._tag === "CompletedTurnSealed" || expected?._tag === "FailedTurnSealed"

const validateSealedTerminalRun = (record: CodexIntegratorPrivateRecord): SealedTerminalRunValidation => {
  const expected = record.runs[record.runs.length - 1]
  if (!hasSealedTerminalRunEvidence(expected)) {
    return { _tag: "Invalid", detail: "private predecessor has no sealed terminal turn evidence" }
  }
  return { _tag: "Valid", expected }
}

const terminalThreadTokenObservation = (
  authorization: IntegratorCandidateCleanupAuthorization,
  predecessor: IntegratorSessionCorrelation,
  thread: CodexThreadSnapshot,
  knownTokens: ReadonlySet<CodexIntegratorPrivateRecord["runs"][number]["token"]>
): IntegratorCandidateCleanupObservation | undefined => {
  if (thread.turns.some((turn) => turn.ownedTurnToken === undefined)) {
    return cleanupUnreadable(authorization, "candidate thread contains a tokenless turn")
  }
  const foreign = thread.turns.find(
    (turn) => turn.ownedTurnToken !== undefined && !knownTokens.has(turn.ownedTurnToken)
  )
  return foreign === undefined ? undefined : cleanupForeign(authorization, predecessor.sessionId, "OtherSession")
}

const terminalTurnIdMismatch = (exact: CodexThreadSnapshot["turns"][number], expected: SealedTerminalRun): boolean =>
  exact.id !== expected.turnId

const isConclusiveTerminalStatus = (status: CodexThreadSnapshot["turns"][number]["status"]): boolean =>
  status === "completed" || status === "failed"

const providerTerminalStatusFor = (run: SealedTerminalRun): "completed" | "failed" =>
  run._tag === "FailedTurnSealed" ? "failed" : "completed"

const terminalTurnObservation = (
  authorization: IntegratorCandidateCleanupAuthorization,
  predecessor: IntegratorSessionCorrelation,
  thread: CodexThreadSnapshot,
  expected: SealedTerminalRun
): IntegratorCandidateCleanupObservation | undefined => {
  const matching = thread.turns.filter((turn) => turn.ownedTurnToken === expected.token)
  if (matching.length !== 1) {
    return cleanupUnreadable(authorization, "candidate thread lacks the exact sealed terminal turn")
  }
  const exact = matching[0]
  if (exact === undefined)
    return cleanupUnreadable(authorization, "candidate thread lacks the exact sealed terminal turn")
  if (terminalTurnIdMismatch(exact, expected)) {
    return cleanupUnreadable(authorization, "candidate thread lacks the exact sealed terminal turn")
  }
  if (exact.correlation !== undefined) return cleanupForeign(authorization, predecessor.sessionId, "OtherSession")
  if (exact.status === "inProgress") return cleanupForeign(authorization, predecessor.sessionId, "LiveWriter")
  if (!isConclusiveTerminalStatus(exact.status)) {
    return cleanupUnreadable(authorization, "candidate terminal turn status is not conclusive")
  }
  return exact.status !== providerTerminalStatusFor(expected)
    ? cleanupUnreadable(authorization, "candidate terminal turn status contradicts the private sealed result")
    : undefined
}

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
  const validation = validateSealedTerminalRun(record)
  if (validation._tag === "Invalid") return cleanupUnreadable(authorization, validation.detail)
  const expected = validation.expected
  if (thread.status === "active") return cleanupForeign(authorization, predecessor.sessionId, "LiveWriter")
  const knownTokens = new Set(record.runs.map((run) => run.token))
  const tokenObservation = terminalThreadTokenObservation(authorization, predecessor, thread, knownTokens)
  if (tokenObservation !== undefined) return tokenObservation
  return terminalTurnObservation(authorization, predecessor, thread, expected)
}

const removalProjectionObservation = (
  authorization: IntegratorCandidateCleanupAuthorization,
  predecessor: IntegratorSessionCorrelation,
  projection: CodexOwnedActivityCensusProjection,
  revision: IntegratorCandidateCleanupEvidenceRevision
): IntegratorCandidateCleanupObservation | undefined => {
  if (projection._tag === "ExactLive") {
    return cleanupForeign(authorization, predecessor.sessionId, "LiveWriter", revision)
  }
  return projection._tag === "Unreadable" || projection._tag === "Contradictory"
    ? cleanupUnreadable(authorization, projection.detail)
    : undefined
}

const cleanupRemovalIntent = Effect.fn("CodexIntegrator.cleanupRemovalIntent")(function* (
  authorization: IntegratorCandidateCleanupAuthorization,
  predecessor: IntegratorSessionCorrelation,
  record: CodexIntegratorPrivateRecord,
  threadId: CodexThreadSnapshot["id"],
  store: CodexIntegratorPrivateStoreService,
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  revision: IntegratorCandidateCleanupEvidenceRevision
) {
  const thread = yield* observedThread(app, threadId, record.candidatePath)
  if (thread.ownedThreadToken !== record.threadToken) {
    return cleanupForeign(authorization, predecessor.sessionId, "OtherSession", revision)
  }
  const terminalEvidence = terminalTurnEvidence(authorization, predecessor, record, thread)
  if (terminalEvidence !== undefined) return terminalEvidence
  const terminals = yield* boundary(app.listBackgroundTerminals(thread.id))
  const projection = yield* boundary(census.observe(thread, terminals, "IntegratorSession"))
  const observation = removalProjectionObservation(authorization, predecessor, projection, revision)
  if (observation !== undefined) return observation
  yield* boundary(
    store.write(preserveRevision(record, { lifecycle: CodexIntegratorPrivateLifecycle.cases.Removed.make({}) }))
  )
  return cleanupAbsent(authorization, revision)
})

const cleanupWithoutRegistrationBaseObservation = (
  authorization: IntegratorCandidateCleanupAuthorization,
  predecessor: IntegratorSessionCorrelation,
  record: CodexIntegratorPrivateRecord,
  pathExists: boolean,
  revision: IntegratorCandidateCleanupEvidenceRevision
): IntegratorCandidateCleanupObservation | undefined => {
  if (record.lifecycle._tag === "WorktreeMaterializationIntentRecorded") {
    return cleanupUnreadable(authorization, "candidate worktree materialization remains unresolved")
  }
  if (pathExists) return cleanupForeign(authorization, predecessor.sessionId, "Transferred", revision)
  return record.lifecycle._tag === "Removed" ? cleanupAbsent(authorization, revision) : undefined
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
  const baseObservation = cleanupWithoutRegistrationBaseObservation(
    authorization,
    predecessor,
    record,
    pathExists,
    revision
  )
  if (baseObservation !== undefined) return baseObservation
  if (record.lifecycle._tag === "ThreadStartIntentRecorded") {
    return cleanupUnreadable(authorization, "provider thread ownership is unresolved; absence cannot be inferred")
  }
  if (record.lifecycle._tag !== "ThreadStarted" && record.lifecycle._tag !== "RemovalIntentRecorded") {
    return cleanupUnreadable(authorization, "provider thread ownership is unresolved; absence cannot be inferred")
  }
  if (record.lifecycle._tag === "RemovalIntentRecorded") {
    return yield* cleanupRemovalIntent(
      authorization,
      predecessor,
      record,
      record.lifecycle.threadId,
      store,
      app,
      census,
      revision
    )
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

const cleanupRegisteredBaseObservation = (
  authorization: IntegratorCandidateCleanupAuthorization,
  predecessor: IntegratorSessionCorrelation,
  record: CodexIntegratorPrivateRecord,
  registration: GitWorktreeRecord,
  pathExists: boolean,
  revision: IntegratorCandidateCleanupEvidenceRevision
): IntegratorCandidateCleanupObservation | undefined => {
  if (record.lifecycle._tag === "WorktreeMaterializationIntentRecorded") {
    return cleanupUnreadable(authorization, "candidate worktree materialization remains unresolved")
  }
  if (record.lifecycle._tag === "Removed") {
    return cleanupForeign(authorization, predecessor.sessionId, "Transferred", revision)
  }
  if (registrationIsForeign(registration, predecessor)) {
    return cleanupForeign(authorization, predecessor.sessionId, "Transferred", revision)
  }
  return !pathExists
    ? cleanupUnreadable(authorization, "candidate is registered by Git but its filesystem path is absent")
    : undefined
}

const settledCandidateThreadId = (record: CodexIntegratorPrivateRecord): CodexThreadSnapshot["id"] | undefined =>
  record.lifecycle._tag === "ThreadStarted" || record.lifecycle._tag === "RemovalIntentRecorded"
    ? record.lifecycle.threadId
    : undefined

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
  const baseObservation = cleanupRegisteredBaseObservation(
    authorization,
    predecessor,
    record,
    registration,
    pathExists,
    revision
  )
  if (baseObservation !== undefined) return baseObservation
  const threadId = settledCandidateThreadId(record)
  if (threadId === undefined) {
    return cleanupUnreadable(authorization, "candidate has no settled provider thread")
  }
  const thread = yield* observedThread(app, threadId, candidatePath)
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

const unknownRemoval = (
  authorization: IntegratorCandidateCleanupAuthorization,
  detail: string
): IntegratorCandidateCleanupMutationResult =>
  IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
    detail,
    locator: authorization.locator,
    sessionId: authorization.owner.sessionId
  })

/** The exact private record that still authorizes the pending Git removal. */
type RemovalRecordCheck =
  | { readonly _tag: "Ready"; readonly record: CodexIntegratorPrivateRecord }
  | { readonly _tag: "Invalid"; readonly detail: string }

const removalRecordIsForeign = (
  record: CodexIntegratorPrivateRecord,
  authorization: IntegratorCandidateCleanupAuthorization,
  candidatePath: IntegratorCandidateWorktreePath
): boolean =>
  !sameSession(record.correlation, authorization.disposition.predecessor) || record.candidatePath !== candidatePath

const checkInitialRemovalRecord = (
  authorization: IntegratorCandidateCleanupAuthorization,
  candidatePath: IntegratorCandidateWorktreePath,
  found: Option.Option<CodexIntegratorPrivateRecord>
): RemovalRecordCheck => {
  if (Option.isNone(found)) {
    return { _tag: "Invalid", detail: "private predecessor record disappeared before removal intent" }
  }
  if (removalRecordIsForeign(found.value, authorization, candidatePath)) {
    return { _tag: "Invalid", detail: "private predecessor correlation or path changed before removal intent" }
  }
  return privateRevision(found.value) !== authorization.evidenceRevision
    ? { _tag: "Invalid", detail: "private predecessor revision changed before removal intent" }
    : { _tag: "Ready", record: found.value }
}

const checkRemovalIntentRecord = (
  authorization: IntegratorCandidateCleanupAuthorization,
  candidatePath: IntegratorCandidateWorktreePath,
  intent: Option.Option<CodexIntegratorPrivateRecord>
): string | undefined => {
  if (Option.isNone(intent)) return "private predecessor record disappeared after removal intent"
  const record = intent.value
  return removalRecordIsForeign(record, authorization, candidatePath) ||
    privateRevision(record) !== authorization.evidenceRevision ||
    record.lifecycle._tag !== "RemovalIntentRecorded"
    ? "private predecessor correlation or path changed before Git removal"
    : undefined
}

const settledRemovalResult = (
  authorization: IntegratorCandidateCleanupAuthorization,
  settled: IntegratorCandidateCleanupObservation
): IntegratorCandidateCleanupMutationResult | undefined => {
  if (settled._tag === "Absent") return undefined
  return settled._tag === "Foreign"
    ? IntegratorCandidateCleanupMutationResult.cases.DefinitelyNotApplied.make({
        detail: `candidate ownership changed after Git removal (${settled.reason})`,
        locator: authorization.locator,
        sessionId: authorization.owner.sessionId
      })
    : unknownRemoval(authorization, "Git remove returned but exact candidate remains registered")
}

const postRemovalRecordError = (
  authorization: IntegratorCandidateCleanupAuthorization,
  candidatePath: IntegratorCandidateWorktreePath,
  found: Option.Option<CodexIntegratorPrivateRecord>
): string | undefined => {
  if (Option.isNone(found)) return "Git remove returned and private predecessor tombstone was not observed"
  return removalRecordIsForeign(found.value, authorization, candidatePath)
    ? "Git remove returned but the private predecessor record became foreign"
    : undefined
}

const confirmedTombstoneError = (
  candidatePath: IntegratorCandidateWorktreePath,
  confirmed: Option.Option<CodexIntegratorPrivateRecord>
): string | undefined =>
  Option.isNone(confirmed) ||
  confirmed.value.lifecycle._tag !== "Removed" ||
  confirmed.value.candidatePath !== candidatePath
    ? "Git remove returned but the private predecessor tombstone was not durable"
    : undefined

const executeGitRemoval = Effect.fn("CodexIntegrator.executeGitRemoval")(function* (
  authorization: IntegratorCandidateCleanupAuthorization,
  config: CodexIntegratorConfiguration,
  candidatePath: IntegratorCandidateWorktreePath,
  observe: (
    authorization: IntegratorCandidateCleanupAuthorization
  ) => Effect.Effect<IntegratorCandidateCleanupObservation>,
  commands: GitCommandService,
  store: CodexIntegratorPrivateStoreService,
  ownership: CoordinatorOwnership["Service"]
) {
  const mutation = boundary(
    commands.run(config.commonDirectory, ["worktree", "remove", "--force", "--", candidatePath])
  )
  const result = yield* ownership.runMutation(mutation)
  if (result.exitCode !== 0) return reconcileFailedRemoval(authorization, result, yield* observe(authorization))
  const settled = yield* observe(authorization)
  const settledResult = settledRemovalResult(authorization, settled)
  if (settledResult !== undefined) return settledResult
  const foundAfter = yield* boundary(store.read(authorization.owner.sessionId))
  const foundAfterError = postRemovalRecordError(authorization, candidatePath, foundAfter)
  if (foundAfterError !== undefined) return unknownRemoval(authorization, foundAfterError)
  if (Option.isNone(foundAfter)) return unknownRemoval(authorization, "private predecessor record disappeared")
  const tombstone = preserveRevision(foundAfter.value, {
    lifecycle: CodexIntegratorPrivateLifecycle.cases.Removed.make({})
  })
  yield* boundary(store.write(tombstone))
  const confirmed = yield* boundary(store.read(authorization.owner.sessionId))
  const confirmedError = confirmedTombstoneError(candidatePath, confirmed)
  if (confirmedError !== undefined) return unknownRemoval(authorization, confirmedError)
  return IntegratorCandidateCleanupMutationResult.cases.Removed.make({
    locator: authorization.locator,
    revision: authorization.evidenceRevision,
    sessionId: authorization.owner.sessionId
  })
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
  const candidatePath = candidateWorktreePathFor(config, authorization.locator)
  const found = yield* boundary(store.read(authorization.owner.sessionId))
  const initialCheck = checkInitialRemovalRecord(authorization, candidatePath, found)
  if (initialCheck._tag === "Invalid") return unknownRemoval(authorization, initialCheck.detail)
  if (
    initialCheck.record.lifecycle._tag !== "ThreadStarted" &&
    initialCheck.record.lifecycle._tag !== "RemovalIntentRecorded"
  ) {
    return unknownRemoval(authorization, "private predecessor has no settled thread before removal intent")
  }
  if (initialCheck.record.lifecycle._tag === "ThreadStarted") {
    yield* boundary(
      store.write(
        preserveRevision(initialCheck.record, {
          lifecycle: CodexIntegratorPrivateLifecycle.cases.RemovalIntentRecorded.make({
            threadId: initialCheck.record.lifecycle.threadId
          })
        })
      )
    )
  }
  const intent = yield* boundary(store.read(authorization.owner.sessionId))
  const intentError = checkRemovalIntentRecord(authorization, candidatePath, intent)
  if (intentError !== undefined) return unknownRemoval(authorization, intentError)
  const revalidated = yield* observe(authorization)
  if (revalidated._tag === "Unreadable") {
    return unknownRemoval(authorization, "provider ownership became unreadable before Git removal")
  }
  if (revalidated._tag !== "Present") return removalNotPermitted(authorization, revalidated)
  return yield* executeGitRemoval(authorization, config, candidatePath, observe, commands, store, ownership)
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
