/* eslint-disable max-lines -- The controlled happy and fail-closed stories share one private harness. */
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  type PlannedAttemptExecutorService,
  type PlannedAttemptExecutorReport,
  PlannedAttemptExecutorRequest,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation,
  samePlannedTaskAttempt
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ClaimToken,
  GitCommand,
  isExactTaskClaim,
  memoryEvidenceStoreLayer,
  OperationId,
  type GitCommandService
} from "@dalph/orchestrator"
import { Effect, Layer, Option, Ref, Schema, type Crypto } from "effect"
import {
  CodexAppServerFailure,
  controlledCodexAppServerLayer,
  controlledCodexOwnedActivityCensusLayer,
  type CodexAppServerService,
  type CodexOwnedActivityCensusProjection,
  type CodexThreadSnapshot,
  type CodexTurnSnapshot
} from "../application/codex-app-server.js"
import {
  CodexAttemptStore,
  CodexAttemptRecord,
  type CodexAttemptStoreService,
  CodexOwnedTurnToken,
  CodexPurgedWorkUnitEvidence,
  CodexPurgedWorkUnitReplacementLedger,
  CodexReplacementHistoryEntry,
  CodexReplacementOperationId,
  CodexReplacementRequestDigest,
  CodexReplacementRequestId,
  CodexServerIncarnation,
  CodexThreadId,
  CodexTurnId
} from "../application/codex-attempt-store.js"
import {
  CodexProviderWorkUnitReplacement,
  CodexProviderWorkUnitReplacementRequest,
  type CodexProviderWorkUnitReplacementResult,
  CodexReplacementAuthorityFailure,
  CodexReplacementAuthorityProof,
  controlledCodexReplacementAuthorityLayer,
  codexPlannedAttemptExecutorLayer
} from "../application/codex-planned-attempt-executor.js"
import {
  CodexPlannedAttemptExecutorCassette,
  CodexPlannedAttemptExecutorRecordedCassette,
  type CodexPlannedAttemptExecutorCassette as CodexPlannedAttemptExecutorCassetteType
} from "./codex-planned-attempt-executor-cassette-domain.js"

const gitShaHexLength = 40
const requestDigestHexLength = 64
const acceptedCommit = GitCommitSha.make("a".repeat(gitShaHexLength))
const worktree = WorktreeLocator.make("/dalph/cassettes/codex-executor")
const specification = makeTaskWorkSpecification({
  body: "Run the maintained concrete Codex executor chronology.",
  taskId: TaskId.make("codex-cassette-task"),
  title: "Exercise the concrete Codex executor"
})
const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt:codex-cassette:0"),
  baseSha: GitCommitSha.make("1".repeat(gitShaHexLength)),
  branch: TaskBranchRef.make("refs/heads/dalph/codex-cassette"),
  executor: TaskExecutorLocator.make("executor:codex-app-server"),
  runId: RunId.make("run:codex-cassette"),
  taskId: specification.taskId,
  taskRevision: specification.fingerprint,
  worktree
})
const request = PlannedAttemptExecutorRequest.make({ plannedAttempt: attempt, specification })
const activeClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("codex-cassette-active-claim"),
  owner: ClaimOwner.make("dalph:codex-cassette"),
  taskId: attempt.taskId,
  token: ClaimToken.make("codex-cassette-active-claim-token")
})
const replacementRequestId = CodexReplacementRequestId.make("codex-cassette-replacement-request")
const replacementRequest = CodexProviderWorkUnitReplacementRequest.make({
  claim: activeClaim,
  plannedAttempt: attempt,
  requestId: replacementRequestId,
  specification
})

const sameReplacementRequest = (
  left: CodexProviderWorkUnitReplacementRequest,
  right: CodexProviderWorkUnitReplacementRequest
): boolean =>
  left.requestId === right.requestId &&
  isExactTaskClaim(left.claim, right.claim) &&
  samePlannedTaskAttempt(left.plannedAttempt, right.plannedAttempt) &&
  left.specification.body === right.specification.body &&
  left.specification.fingerprint === right.specification.fingerprint &&
  left.specification.taskId === right.specification.taskId &&
  left.specification.title === right.specification.title

const sameAuthoritySubject = (
  proof: CodexReplacementAuthorityProof,
  observedRequest: CodexProviderWorkUnitReplacementRequest
): boolean =>
  isExactTaskClaim(proof.claim, observedRequest.claim) &&
  samePlannedTaskAttempt(proof.plannedAttempt, observedRequest.plannedAttempt) &&
  proof.baseSha === observedRequest.plannedAttempt.baseSha &&
  proof.taskRevision === observedRequest.plannedAttempt.taskRevision &&
  proof.worktree === observedRequest.plannedAttempt.worktree &&
  proof.headDescendsFromBase &&
  proof.changedPaths.length > 0 &&
  proof.gitStatus.trim().length > 0

const sameAuthorityGitProjection = (
  left: CodexReplacementAuthorityProof,
  right: CodexReplacementAuthorityProof
): boolean =>
  left.baseSha === right.baseSha &&
  left.headSha === right.headSha &&
  left.headDescendsFromBase === right.headDescendsFromBase &&
  left.gitStatus === right.gitStatus &&
  left.changedPaths.length === right.changedPaths.length &&
  left.changedPaths.every((path, index) => path === right.changedPaths[index])

const hasCommittedModifiedAndUntrackedWork = (proof: CodexReplacementAuthorityProof): boolean =>
  proof.headSha !== proof.baseSha &&
  proof.changedPaths.includes("src/committed-work.ts") &&
  proof.changedPaths.includes("src/modified-work.ts") &&
  proof.changedPaths.includes("notes/untracked-work.txt") &&
  proof.gitStatus.includes(" M src/modified-work.ts") &&
  proof.gitStatus.includes("?? notes/untracked-work.txt")

const recordKey = `${attempt.runId}\u0000${attempt.attemptId}`
const defaultOwnedTurnToken = CodexOwnedTurnToken.make("codex-cassette-owned-turn")
const predecessorTurnId = CodexTurnId.make("codex-cassette-turn-u1")
const predecessorToken = CodexOwnedTurnToken.make("codex-cassette-token-u1")
const unusedBoundary = Effect.die.bind(undefined, "the maintained Codex executor cassette must not cross this boundary")

const git: GitCommandService = {
  run: unusedBoundary,
  runInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: `${acceptedCommit}\n` }),
  runBytesInWorktree: unusedBoundary
}

const unavailableTurnStart = new CodexAppServerFailure({
  detail: "the controlled turn/start response was lost",
  kind: "Unavailable",
  operation: "turn/start"
})

type CodexReplacementScenario = Extract<CodexPlannedAttemptExecutorCassetteType["scenario"], `PurgedWorkUnit${string}`>

const isReplacementScenario = (
  scenario: CodexPlannedAttemptExecutorCassetteType["scenario"]
): scenario is CodexReplacementScenario => scenario.startsWith("PurgedWorkUnit")

const authorityFailureFor = (scenario: CodexReplacementScenario | undefined) => {
  if (scenario === "PurgedWorkUnitUnreadable") {
    return new CodexReplacementAuthorityFailure({
      detail: "controlled Codex authority read is temporarily unreadable",
      kind: "ProviderTemporarilyUnreadable"
    })
  }
  if (scenario === "PurgedWorkUnitWriterConflict") {
    return new CodexReplacementAuthorityFailure({
      detail: "controlled execution-substrate writer is still live",
      kind: "ExclusiveRetainedOwnershipUnproved"
    })
  }
  if (scenario === "PurgedWorkUnitCorrelationConflict") {
    return new CodexReplacementAuthorityFailure({
      detail: "controlled authority observed a foreign planned attempt",
      kind: "CorrelationConflict"
    })
  }
  return undefined
}

const makeHarness = Effect.fn("CodexExecutorCassette.makeHarness")(function* (
  loseTurnResponse: boolean,
  replacementScenario: CodexReplacementScenario | undefined
) {
  const threadId = CodexThreadId.make("codex-cassette-thread")
  const threadStartCount = yield* Ref.make(0)
  const turnStartCount = yield* Ref.make(0)
  const authorityObservationCount = yield* Ref.make(0)
  const authorityCallsBeforeProviderBoundary = yield* Ref.make<number | null>(null)
  const authorityRequestMatches = yield* Ref.make<boolean | null>(null)
  const authorityProofMatchesRequest = yield* Ref.make<boolean | null>(null)
  const authorityGitProjectionStable = yield* Ref.make<boolean | null>(null)
  const authorityRetainedWorkEvidenceMatches = yield* Ref.make<boolean | null>(null)
  const authorityProofProjection = yield* Ref.make<CodexReplacementAuthorityProof | undefined>(undefined)
  const records = yield* Ref.make<ReadonlyMap<string, CodexAttemptRecord>>(new Map())
  const replacementLedgers = yield* Ref.make<ReadonlyMap<string, CodexPurgedWorkUnitReplacementLedger>>(new Map())
  const predecessorTurn: CodexTurnSnapshot = {
    id: predecessorTurnId,
    status: "completed",
    items: [],
    ownedTurnToken: predecessorToken
  }
  const replacementThreadHasPredecessor = replacementScenario === "PurgedWorkUnitStillPresent"
  const thread = yield* Ref.make<CodexThreadSnapshot>({
    id: threadId,
    cwd: worktree,
    status: "idle",
    turns: replacementThreadHasPredecessor ? [predecessorTurn] : []
  })
  const responseWasLost = yield* Ref.make(false)

  if (replacementScenario !== undefined && replacementScenario !== "PurgedWorkUnitSessionAbsent") {
    const predecessorRecord = CodexAttemptRecord.cases.Running.make({
      attemptId: attempt.attemptId,
      correlationAttemptId: attempt.attemptId,
      correlationRunId: attempt.runId,
      currentToken: predecessorToken,
      observedTurnId: predecessorTurnId,
      priorObservedTurnId: null,
      threadId,
      worktree
    })
    yield* Ref.set(records, new Map([[recordKey, predecessorRecord]]))
  }

  if (replacementScenario === "PurgedWorkUnitRequestConflict") {
    const otherAttempt = PlannedTaskAttempt.make({
      ...attempt,
      attemptId: AttemptId.make("attempt:codex-cassette:other"),
      runId: RunId.make("run:codex-cassette:other"),
      worktree: WorktreeLocator.make("/dalph/cassettes/codex-executor-other")
    })
    const otherThreadId = CodexThreadId.make("codex-cassette-other-thread")
    const otherPredecessorToken = CodexOwnedTurnToken.make("codex-cassette-other-token-u1")
    const otherPredecessorTurnId = CodexTurnId.make("codex-cassette-other-turn-u1")
    const otherOperationId = CodexReplacementOperationId.make("codex-cassette-other-operation")
    const otherEvidence = CodexPurgedWorkUnitEvidence.make({
      predecessorToken: otherPredecessorToken,
      predecessorTurnId: otherPredecessorTurnId,
      threadId: otherThreadId,
      worktree: otherAttempt.worktree
    })
    const otherLedger = CodexPurgedWorkUnitReplacementLedger.make({
      history: [
        CodexReplacementHistoryEntry.cases.Purged.make({ evidence: otherEvidence }),
        CodexReplacementHistoryEntry.cases.IntentRecorded.make({
          operationId: otherOperationId,
          requestDigest: CodexReplacementRequestDigest.make("b".repeat(requestDigestHexLength)),
          requestId: replacementRequestId
        })
      ],
      operationId: otherOperationId,
      plannedAttempt: otherAttempt,
      requestId: replacementRequestId
    })
    yield* Ref.set(replacementLedgers, new Map([[replacementRequestId, otherLedger]]))
  }

  const authorityProof = CodexReplacementAuthorityProof.make({
    baseSha: attempt.baseSha,
    changedPaths: ["src/committed-work.ts", "src/modified-work.ts", "notes/untracked-work.txt"],
    claim: activeClaim,
    headDescendsFromBase: true,
    headSha: acceptedCommit,
    gitStatus: " M src/modified-work.ts\n?? notes/untracked-work.txt",
    plannedAttempt: attempt,
    taskRevision: specification.fingerprint,
    worktree
  })
  const rememberAuthorityRequest = Effect.fn("CodexExecutorCassette.rememberAuthorityRequest")(function* (
    observedRequest: CodexProviderWorkUnitReplacementRequest
  ) {
    yield* Ref.update(authorityObservationCount, (count) => count + 1)
    const requestMatches = sameReplacementRequest(observedRequest, replacementRequest)
    const previousRequestMatch = yield* Ref.get(authorityRequestMatches)
    yield* Ref.set(
      authorityRequestMatches,
      previousRequestMatch === null ? requestMatches : previousRequestMatch && requestMatches
    )
  })
  const rememberAuthorityProof = Effect.fn("CodexExecutorCassette.rememberAuthorityProof")(function* (
    observedRequest: CodexProviderWorkUnitReplacementRequest
  ) {
    const proofMatchesRequest = sameAuthoritySubject(authorityProof, observedRequest)
    const retainedWorkEvidenceMatches = hasCommittedModifiedAndUntrackedWork(authorityProof)
    const previousProofMatch = yield* Ref.get(authorityProofMatchesRequest)
    yield* Ref.set(
      authorityProofMatchesRequest,
      previousProofMatch === null ? proofMatchesRequest : previousProofMatch && proofMatchesRequest
    )
    const previousRetainedWorkMatch = yield* Ref.get(authorityRetainedWorkEvidenceMatches)
    yield* Ref.set(
      authorityRetainedWorkEvidenceMatches,
      previousRetainedWorkMatch === null
        ? retainedWorkEvidenceMatches
        : previousRetainedWorkMatch && retainedWorkEvidenceMatches
    )
    const previousProof = yield* Ref.get(authorityProofProjection)
    if (previousProof === undefined) {
      yield* Ref.set(authorityGitProjectionStable, true)
    } else {
      const gitProjectionStable = sameAuthorityGitProjection(previousProof, authorityProof)
      const previousGitProjection = yield* Ref.get(authorityGitProjectionStable)
      yield* Ref.set(
        authorityGitProjectionStable,
        previousGitProjection === null ? gitProjectionStable : previousGitProjection && gitProjectionStable
      )
    }
    yield* Ref.set(authorityProofProjection, authorityProof)
  })
  const replacementAuthority = {
    observe: (observedRequest: CodexProviderWorkUnitReplacementRequest) =>
      Effect.gen(function* () {
        yield* rememberAuthorityRequest(observedRequest)
        const failure = authorityFailureFor(replacementScenario)
        if (failure !== undefined) return yield* failure
        yield* rememberAuthorityProof(observedRequest)
        return authorityProof
      })
  }

  const updateTurn = (update: (turn: CodexTurnSnapshot) => CodexTurnSnapshot) =>
    Ref.update(
      thread,
      (current): CodexThreadSnapshot => ({ ...current, status: "idle", turns: current.turns.map(update) })
    )

  const observeOwnedActivity = (current: CodexThreadSnapshot): Effect.Effect<CodexOwnedActivityCensusProjection> =>
    Effect.succeed(
      current.turns.some((turn) => turn.status === "inProgress")
        ? {
            _tag: "ExactLive" as const,
            activities: current.turns
              .filter((turn) => turn.status === "inProgress")
              .map((turn) => ({ _tag: "ActiveTurn" as const, turnId: turn.id }))
          }
        : { _tag: "Absent" as const }
    )

  const app: CodexAppServerService = {
    incarnation: CodexServerIncarnation.make("codex-cassette-incarnation"),
    startThread: (cwd) =>
      Ref.updateAndGet(thread, (current) => ({ ...current, cwd })).pipe(
        Effect.tap(() => Ref.update(threadStartCount, (count) => count + 1))
      ),
    readThread: () => Ref.get(thread),
    resumeThread: (_threadId, cwd) => Ref.updateAndGet(thread, (current) => ({ ...current, cwd })),
    startTurn: (_threadId, cwd, _text, ownedTurnToken = defaultOwnedTurnToken) =>
      Effect.gen(function* () {
        yield* Ref.set(authorityCallsBeforeProviderBoundary, yield* Ref.get(authorityObservationCount))
        const ordinal = yield* Ref.updateAndGet(turnStartCount, (count) => count + 1)
        const turn: CodexTurnSnapshot = {
          id:
            replacementScenario !== undefined
              ? CodexTurnId.make("codex-cassette-turn-u2")
              : CodexTurnId.make(`codex-cassette-turn-${ordinal}`),
          status: "inProgress",
          items: [],
          ownedTurnToken
        }
        yield* Ref.update(
          thread,
          (current): CodexThreadSnapshot => ({ ...current, cwd, status: "active", turns: [...current.turns, turn] })
        )
        if (loseTurnResponse && !(yield* Ref.get(responseWasLost))) {
          yield* Ref.set(responseWasLost, true)
          return yield* unavailableTurnStart
        }
        return turn
      }),
    interruptTurn: (_threadId, turnId) =>
      updateTurn((turn) => (turn.id === turnId ? { ...turn, status: "interrupted" } : turn)),
    listBackgroundTerminals: () => Effect.succeed([]),
    terminateBackgroundTerminal: unusedBoundary,
    close: Effect.void
  }
  const store: CodexAttemptStoreService = {
    readAttempt: (runId, attemptId) => {
      return Ref.get(records).pipe(
        Effect.map((current) => {
          const found = current.get(`${runId}\u0000${attemptId}`)
          return found === undefined ? Option.none() : Option.some(found)
        })
      )
    },
    writeAttempt: (record) =>
      Ref.update(records, (current) =>
        new Map(current).set(`${record.correlationRunId}\u0000${record.correlationAttemptId}`, record)
      ),
    readServerLaunch: unusedBoundary,
    writeServerLaunch: unusedBoundary,
    clearServerLaunch: unusedBoundary,
    acquireServerLease: unusedBoundary,
    releaseServerLease: unusedBoundary,
    readReplacementLedger: (requestId) =>
      Ref.get(replacementLedgers).pipe(
        Effect.map((current) => {
          const found = current.get(requestId)
          return found === undefined ? Option.none() : Option.some(found)
        })
      ),
    appendReplacementLedger: (ledger) =>
      Ref.update(replacementLedgers, (current) => new Map(current).set(ledger.requestId, ledger))
  }
  return {
    app,
    completeTurn: updateTurn((turn) => ({
      ...turn,
      status: "completed",
      items: [
        {
          type: "agentMessage",
          text: JSON.stringify({
            commit: acceptedCommit,
            correlation: { runId: attempt.runId, attemptId: attempt.attemptId }
          })
        }
      ]
    })),
    interruptForeignTurn: app.interruptTurn(threadId, CodexTurnId.make("codex-cassette-foreign-turn")),
    observeOwnedActivity,
    observeCurrentActivity: Ref.get(thread).pipe(Effect.flatMap(observeOwnedActivity)),
    currentRecord: Ref.get(records).pipe(Effect.map((current) => current.get(recordKey))),
    currentThread: Ref.get(thread),
    currentReplacementLedger: Ref.get(replacementLedgers).pipe(
      Effect.map((current) => current.get(replacementRequestId))
    ),
    replacementAuthority,
    store,
    authorityObservationCount,
    authorityCallsBeforeProviderBoundary,
    authorityRequestMatches,
    authorityProofMatchesRequest,
    authorityGitProjectionStable,
    authorityRetainedWorkEvidenceMatches,
    threadStartCount,
    turnStartCount
  }
})

export interface CodexPlannedAttemptExecutorCassetteRun {
  readonly cassette: CodexPlannedAttemptExecutorCassetteType
  readonly activeActivity: Pick<CodexOwnedActivityCensusProjection, "_tag">
  readonly privateRecordTag: CodexAttemptRecord["_tag"] | null
  readonly replacementResultTag: CodexProviderWorkUnitReplacementResult["_tag"] | null
  readonly purgedWorkUnitPreserved: boolean | null
  readonly distinctReplacementWorkUnit: boolean | null
  readonly authorityObservationCount: number | null
  readonly authorityCallsBeforeProviderBoundary: number | null
  readonly authorityRequestMatches: boolean | null
  readonly authorityProofMatchesRequest: boolean | null
  readonly authorityGitProjectionStable: boolean | null
  readonly authorityRetainedWorkEvidenceMatches: boolean | null
  readonly downstreamBoundaryCalls: {
    readonly cleanup: number
    readonly integration: number
    readonly semanticReview: number
  }
  readonly reports: ReadonlyArray<PlannedAttemptExecutorReport>
  readonly threadStartCount: number
  readonly turnStartCount: number
}

/** Exposes only the record state needed by cassette assertions, never its private Codex thread id. */
export const codexAttemptRecordTagOrNull = (
  record: CodexAttemptRecord | undefined
): CodexAttemptRecord["_tag"] | null => record?._tag ?? null

/** Keeps the private process and turn identities inside the controlled harness. */
const publicActivityProjection = (
  projection: CodexOwnedActivityCensusProjection
): Pick<CodexOwnedActivityCensusProjection, "_tag"> => ({ _tag: projection._tag })

const replacementHistoryIsComplete = (ledger: CodexPurgedWorkUnitReplacementLedger | undefined): boolean =>
  ledger?.history.map(({ _tag }) => _tag).join(",") ===
  "Purged,IntentRecorded,TurnIntentRecorded,TurnBoundaryCrossingBegan,TurnObserved,Sealed"

const purgedPredecessorEvidenceIsRetained = (
  ledger: CodexPurgedWorkUnitReplacementLedger | undefined,
  thread: CodexThreadSnapshot
): boolean => {
  const first = ledger?.history[0]
  if (first?._tag !== "Purged") return false
  return (
    first.evidence.predecessorTurnId === predecessorTurnId &&
    first.evidence.predecessorToken === predecessorToken &&
    first.evidence.threadId === thread.id &&
    first.evidence.worktree === worktree
  )
}

const replacementRecordHasNoPredecessor = (record: CodexAttemptRecord | undefined): boolean =>
  record?._tag === "TurnObserved" && record.priorObservedTurnId === null

const purgedWorkUnitIsPreserved = (
  replacementResult: CodexProviderWorkUnitReplacementResult,
  ledger: CodexPurgedWorkUnitReplacementLedger | undefined,
  record: CodexAttemptRecord | undefined,
  thread: CodexThreadSnapshot
): boolean =>
  replacementResult._tag === "Replaced" &&
  replacementHistoryIsComplete(ledger) &&
  purgedPredecessorEvidenceIsRetained(ledger, thread) &&
  replacementRecordHasNoPredecessor(record)

const replacementIdentityIsDistinct = (ledger: CodexPurgedWorkUnitReplacementLedger | undefined): boolean => {
  const observed = ledger?.history[4]
  if (observed?._tag !== "TurnObserved") return false
  return observed.replacementTurnId !== predecessorTurnId && observed.replacementToken !== predecessorToken
}

const replacementRecordTracksReplacement = (
  ledger: CodexPurgedWorkUnitReplacementLedger | undefined,
  record: CodexAttemptRecord | undefined
): boolean => {
  const observed = ledger?.history[4]
  return (
    observed?._tag === "TurnObserved" &&
    record?._tag === "TurnObserved" &&
    record.currentToken === observed.replacementToken
  )
}

const threadContainsReplacement = (
  ledger: CodexPurgedWorkUnitReplacementLedger | undefined,
  thread: CodexThreadSnapshot
): boolean => {
  const observed = ledger?.history[4]
  return observed?._tag === "TurnObserved" && thread.turns.some((turn) => turn.id === observed.replacementTurnId)
}

const replacementWorkUnitIsDistinct = (
  replacementResult: CodexProviderWorkUnitReplacementResult,
  ledger: CodexPurgedWorkUnitReplacementLedger | undefined,
  record: CodexAttemptRecord | undefined,
  thread: CodexThreadSnapshot
): boolean =>
  replacementResult._tag === "Replaced" &&
  replacementIdentityIsDistinct(ledger) &&
  replacementRecordTracksReplacement(ledger, record) &&
  threadContainsReplacement(ledger, thread)

/** Runs one maintained story through the concrete Codex planned-attempt executor layer. */
export const runCodexPlannedAttemptExecutorCassette: (
  input: unknown
) => Effect.Effect<CodexPlannedAttemptExecutorCassetteRun, unknown, Crypto.Crypto> = Effect.fn(
  "CodexPlannedAttemptExecutorCassette.run"
)(function* (input: unknown) {
  const cassette = yield* Schema.decodeUnknownEffect(CodexPlannedAttemptExecutorCassette)(input)
  const replacementScenario = isReplacementScenario(cassette.scenario) ? cassette.scenario : undefined
  const harness = yield* makeHarness(cassette.scenario === "LostTurnResponse", replacementScenario)
  const dependencies = Layer.mergeAll(
    controlledCodexAppServerLayer(harness.app),
    controlledCodexOwnedActivityCensusLayer({
      observe: harness.observeOwnedActivity,
      terminateDescendants: unusedBoundary
    }),
    Layer.succeed(CodexAttemptStore, harness.store),
    Layer.succeed(GitCommand, git),
    memoryEvidenceStoreLayer,
    controlledCodexReplacementAuthorityLayer(harness.replacementAuthority)
  )
  const executorLayer = codexPlannedAttemptExecutorLayer.pipe(Layer.provide(dependencies))
  const observeExactReport = Effect.fn("CodexExecutorCassette.observeExactReport")(function* (
    executor: PlannedAttemptExecutorService
  ) {
    const projection = yield* executor.observe(plannedAttemptExecutorCorrelation(attempt), {
      _tag: "PassiveLifecycleObservation"
    })
    if (projection._tag === "Exact") return projection.report
    return yield* Effect.die(`expected exact Codex executor report, received ${projection._tag}`)
  })
  const executeHappyReplacement = Effect.fn("CodexExecutorCassette.executeHappyReplacement")(function* (
    executor: PlannedAttemptExecutorService,
    replacementResult: CodexProviderWorkUnitReplacementResult
  ) {
    const report = yield* observeExactReport(executor)
    const ledger = yield* harness.currentReplacementLedger
    const record = yield* harness.currentRecord
    const thread = yield* harness.currentThread
    const purgedWorkUnitPreserved = purgedWorkUnitIsPreserved(replacementResult, ledger, record, thread)
    const distinctReplacementWorkUnit = replacementWorkUnitIsDistinct(replacementResult, ledger, record, thread)
    return {
      activeActivity: publicActivityProjection(yield* harness.observeCurrentActivity),
      distinctReplacementWorkUnit,
      purgedWorkUnitPreserved,
      replacementResultTag: replacementResult._tag,
      reports: [report]
    }
  })
  const executeReplacement = Effect.fn("CodexExecutorCassette.executeReplacement")(function* (
    executor: PlannedAttemptExecutorService,
    scenario: CodexReplacementScenario
  ) {
    const replacement = yield* CodexProviderWorkUnitReplacement
    const replacementResult = yield* replacement.replacePurgedProviderWorkUnit(replacementRequest)
    if (scenario === "PurgedWorkUnitReplacement") return yield* executeHappyReplacement(executor, replacementResult)
    return {
      activeActivity: publicActivityProjection(yield* harness.observeCurrentActivity),
      distinctReplacementWorkUnit: null,
      purgedWorkUnitPreserved: null,
      replacementResultTag: replacementResult._tag,
      reports: []
    }
  })
  const executeOrdinary = Effect.fn("CodexExecutorCassette.executeOrdinary")(function* (
    executor: PlannedAttemptExecutorService
  ) {
    const first = yield* executor.begin(request)
    const activeActivity = publicActivityProjection(yield* harness.observeCurrentActivity)
    if (cassette.scenario === "FirstTurnExecutorWorkExecuting" || cassette.scenario === "LostTurnResponse") {
      return {
        activeActivity,
        distinctReplacementWorkUnit: null,
        purgedWorkUnitPreserved: null,
        replacementResultTag: null,
        reports: [first]
      }
    }
    if (cassette.scenario === "AcceptedExecutorWorkTerminal") {
      yield* harness.completeTurn
      return {
        activeActivity,
        distinctReplacementWorkUnit: null,
        purgedWorkUnitPreserved: null,
        replacementResultTag: null,
        reports: [first, yield* observeExactReport(executor)]
      }
    }
    yield* harness.interruptForeignTurn
    return {
      activeActivity,
      distinctReplacementWorkUnit: null,
      purgedWorkUnitPreserved: null,
      replacementResultTag: null,
      reports: [first, yield* executor.requestSuspension(attempt)]
    }
  })
  const execution = yield* Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    return replacementScenario === undefined
      ? yield* executeOrdinary(executor)
      : yield* executeReplacement(executor, replacementScenario)
  }).pipe(Effect.provide(executorLayer))

  const authorityEvidence =
    replacementScenario === undefined
      ? {
          authorityObservationCount: null,
          authorityCallsBeforeProviderBoundary: null,
          authorityRequestMatches: null,
          authorityProofMatchesRequest: null,
          authorityGitProjectionStable: null,
          authorityRetainedWorkEvidenceMatches: null
        }
      : {
          authorityObservationCount: yield* Ref.get(harness.authorityObservationCount),
          authorityCallsBeforeProviderBoundary: yield* Ref.get(harness.authorityCallsBeforeProviderBoundary),
          authorityRequestMatches: yield* Ref.get(harness.authorityRequestMatches),
          authorityProofMatchesRequest: yield* Ref.get(harness.authorityProofMatchesRequest),
          authorityGitProjectionStable: yield* Ref.get(harness.authorityGitProjectionStable),
          authorityRetainedWorkEvidenceMatches: yield* Ref.get(harness.authorityRetainedWorkEvidenceMatches)
        }

  const run: CodexPlannedAttemptExecutorCassetteRun = {
    cassette,
    activeActivity: execution.activeActivity,
    distinctReplacementWorkUnit: execution.distinctReplacementWorkUnit,
    privateRecordTag: codexAttemptRecordTagOrNull(yield* harness.currentRecord),
    purgedWorkUnitPreserved: execution.purgedWorkUnitPreserved,
    replacementResultTag: execution.replacementResultTag,
    reports: execution.reports,
    ...authorityEvidence,
    downstreamBoundaryCalls: { cleanup: 0, integration: 0, semanticReview: 0 },
    threadStartCount: yield* Ref.get(harness.threadStartCount),
    turnStartCount: yield* Ref.get(harness.turnStartCount)
  }
  return run
})

/** Projects one public, versioned recording from the concrete executor transcript. */
export const recordCodexPlannedAttemptExecutorCassette = (
  run: CodexPlannedAttemptExecutorCassetteRun
): CodexPlannedAttemptExecutorRecordedCassette =>
  CodexPlannedAttemptExecutorRecordedCassette.make({
    authorityObservationCount: run.authorityObservationCount,
    authorityRetainedWorkEvidenceMatches: run.authorityRetainedWorkEvidenceMatches,
    downstreamBoundaryCalls: run.downstreamBoundaryCalls,
    name: run.cassette.name,
    replacementResultTag: run.replacementResultTag,
    reportTags: run.reports.map(({ _tag }) => _tag),
    scenario: run.cassette.scenario,
    threadStartCount: run.threadStartCount,
    turnStartCount: run.turnStartCount,
    version: 1
  })
