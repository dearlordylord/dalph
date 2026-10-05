import { ProviderResultRecoveryRecord } from "./provider-result-recovery.js"
/* eslint-disable max-lines -- The bounded executor chronology stays co-located for auditability. */
import {
  decodeOwnedSemanticCandidate,
  publishProviderResultEvidence,
  validateOwnedSemanticCandidate,
  providerResultGitBoundary,
  ProviderResultAuthorityUnavailable,
  semanticCandidateInstructions
} from "./provider-semantic-result.js"
import {
  AcceptedResultEvidenceManifest,
  EvidenceDigest,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorCommandFailure,
  PlannedAttemptResultRecoveryAuthorization,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorBeginProofId,
  type PlannedAttemptExecutorBeginDelivery,
  type PlannedAttemptExecutorObservationPurpose,
  PlannedAttemptExecutorReport,
  PlannedAttemptExecutorWriterCustody,
  PlannedAttemptResultResponseCount,
  PlannedAttemptExecutorResult,
  type PlannedAttemptExecutorFailureCode,
  PlannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedAttemptExecutorProjection as PlannedAttemptExecutorProjectionType,
  type PlannedAttemptExecutorReport as PlannedAttemptExecutorReportType,
  type PlannedAttemptExecutorService,
  EvidenceReference,
  evidenceReferenceEquals,
  PlannedTaskAttempt,
  type PlannedAttemptExecutorRequest,
  samePlannedTaskAttempt,
  samePlannedAttemptExecutorProjection,
  TaskRevision,
  TaskWorkSpecification,
  WorktreeLocator
} from "@dalph/contracts"
import { ActiveTaskClaim, EvidenceStore, GitCommand, isExactTaskClaim } from "@dalph/orchestrator"
import {
  Context,
  Data,
  Crypto,
  Deferred,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Result,
  Schedule,
  Schema,
  Semaphore,
  Stream
} from "effect"
import * as Scope from "effect/Scope"
import {
  ProviderResultCycle,
  ProviderResultRequestToken,
  ProviderResultTurnId,
  ProviderResultInstantMilliseconds,
  ProviderResultResponseIntent,
  providerResultResponseExpired,
  observeProviderResultTurn,
  prepareProviderResultCorrection,
  prepareProviderResultContinuation,
  providerResultResponseOwnership,
  withinProviderResultDeadline,
  rejectProviderResultResponse
} from "./provider-result-correction.js"
import { logCodexCompletionTrace } from "./codex-completion-trace.js"
import {
  CodexAppServer,
  CodexAppServerFailure,
  CodexOwnedActivityCensus,
  CodexThreadWorkingDirectory,
  nodeCodexOwnedActivityCensusLayer,
  type CodexTurnCompletedHint,
  type CodexThreadIdleHint,
  type CodexToolEffectNotification,
  type CodexOwnedActivityCensusProjection,
  type CodexOwnedProcessIdentity,
  type CodexThreadSnapshot,
  type CodexTurnSnapshot
} from "./codex-app-server.js"
import {
  CodexAttemptRecord,
  CodexAttemptStore,
  CodexAttemptStoreFailure,
  CodexOwnedTurnToken,
  appendCodexReplacementHistory,
  codexReplacementRequestDigestFromCanonical,
  CodexPurgedWorkUnitEvidence,
  CodexPurgedWorkUnitReplacementLedger,
  CodexReplacementHistoryEntry,
  CodexReplacementOperationId,
  CodexReplacementRequestId,
  CodexSealedTerminal,
  type CodexServerIncarnation,
  type CodexReplacementRequestDigest,
  type CodexSealedTerminal as CodexSealedTerminalType,
  type CodexThreadId,
  type CodexTurnId,
  CodexToolEffectRecord,
  CodexToolItemId
} from "./codex-attempt-store.js"
import { bindCodexToolEffectPolicy, CodexToolEffectPolicy, codexToolEffectLimit } from "./codex-tool-effect-policy.js"

/** A terminal Codex message must contain one unambiguous 40-character commit. */
const lastElementOffset = -1
const hexRadix = 16
const hexByteWidth = 2
// eslint-disable-next-line no-magic-numbers -- The provider gets a bounded grace before exact containment closes.
const toolInterruptGrace = Duration.seconds(5)
const missingToolStartScanIntervalMilliseconds = 5_000
const ordinaryToolEffectLimitMilliseconds = 60_000
// eslint-disable-next-line no-magic-numbers -- One millisecond is one thousand microseconds and one million nanoseconds.
const nanosecondsPerMillisecond = BigInt(1_000) * BigInt(1_000)
const completedToolStatuses = new Set(["completed", "failed", "declined", "interrupted"])
const toolItemTypes = new Set(["commandExecution", "fileChange", "dynamicToolCall"])
type JsonRecord = Record<string, unknown>

const isJsonRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null

// eslint-disable-next-line complexity -- One fail-closed boundary preserves typed detail, tag, Error, and unknown failure shapes.
const commandFailureDetail = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "detail" in error && typeof error.detail === "string") {
    /* v8 ignore next -- @preserve Typed failures construct a non-empty detail; the fallback keeps foreign callers total. */
    if (error.detail.length > 0) return error.detail
  }
  if (typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string") {
    return error._tag
  }
  /* v8 ignore next -- @preserve Native Error producers retain a message; name is a defensive foreign-error fallback. */
  if (error instanceof Error) return error.message.length > 0 ? error.message : error.name
  return String(error)
}

export const commandFailure = (
  command: "Begin" | "Resume" | "Suspend" | "ContinueRejectedResult",
  correlation: PlannedAttemptExecutorCorrelation,
  error: unknown
): PlannedAttemptExecutorCommandFailure =>
  new PlannedAttemptExecutorCommandFailure({ command, correlation, detail: commandFailureDetail(error) })

export const preserveCommandFailure = (
  command: "Begin" | "Resume" | "Suspend" | "ContinueRejectedResult",
  correlation: PlannedAttemptExecutorCorrelation,
  error: unknown
): PlannedAttemptExecutorCommandFailure =>
  error instanceof PlannedAttemptExecutorCommandFailure ? error : commandFailure(command, correlation, error)

const running = (correlation: PlannedAttemptExecutorCorrelation): PlannedAttemptExecutorReportType =>
  PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })

const suspended = (correlation: PlannedAttemptExecutorCorrelation): PlannedAttemptExecutorReportType =>
  PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })

const terminal = (
  correlation: PlannedAttemptExecutorCorrelation,
  result: PlannedAttemptExecutorResult
): PlannedAttemptExecutorReportType =>
  PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result })

const foreignReport = (observed: PlannedAttemptExecutorCorrelation): PlannedAttemptExecutorReportType =>
  PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation: observed })

const noReport = (correlation: PlannedAttemptExecutorCorrelation): PlannedAttemptExecutorProjectionType =>
  PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })

const exact = (report: PlannedAttemptExecutorReportType): PlannedAttemptExecutorProjectionType =>
  PlannedAttemptExecutorProjection.cases.Exact.make({ report })

const unavailable = (correlation: PlannedAttemptExecutorCorrelation): PlannedAttemptExecutorProjectionType =>
  PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({ correlation })

const unreadable = (
  correlation: PlannedAttemptExecutorCorrelation,
  detail?: string
): PlannedAttemptExecutorProjectionType =>
  PlannedAttemptExecutorProjection.cases.Unreadable.make(
    detail === undefined ? { correlation } : { correlation, detail }
  )

const initializationContradiction = (
  correlation: PlannedAttemptExecutorCorrelation,
  detail: string
): PlannedAttemptExecutorProjectionType =>
  PlannedAttemptExecutorProjection.cases.InitializationCorrelationContradiction.make({ correlation, detail })

const foreign = (
  expected: PlannedAttemptExecutorCorrelation,
  observed: PlannedAttemptExecutorCorrelation
): PlannedAttemptExecutorProjectionType =>
  PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
    expected,
    observed: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation: observed })
  })

const sameCorrelation = (left: PlannedAttemptExecutorCorrelation, right: PlannedAttemptExecutorCorrelation): boolean =>
  left.runId === right.runId && left.attemptId === right.attemptId

const sameAcceptedManifest = Schema.toEquivalence(AcceptedResultEvidenceManifest)

type CodexEmptyRecord = Extract<CodexAttemptRecord, { readonly _tag: "EmptyPreTurn" }>
type CodexAssociatedRecord = Extract<CodexAttemptRecord, { readonly _tag: "AssociatedPreTurn" }>
type CodexPreTurnBeginRecord = CodexEmptyRecord | CodexAssociatedRecord
/** A successful allocation has no readable rollout yet; only its current process owns this response authority. */
type CodexBeginAssociation = Data.TaggedEnum<{
  FreshAllocation: { readonly record: CodexAssociatedRecord }
  ReconciledExisting: { readonly record: CodexAssociatedRecord }
}>
const CodexBeginAssociation = Data.taggedEnum<CodexBeginAssociation>()
type CodexIntentRecord = Extract<CodexAttemptRecord, { readonly _tag: "TurnIntentRecorded" }>
type CodexObservedRecord = Extract<CodexAttemptRecord, { readonly _tag: "TurnObserved" }>
type CodexRunningRecord = Extract<CodexAttemptRecord, { readonly _tag: "Running" }>
type CodexSuspensionStopIntentRecord = Extract<CodexAttemptRecord, { readonly _tag: "SuspensionStopIntended" }>
type CodexSafelySuspendedRecord = Extract<CodexAttemptRecord, { readonly _tag: "SafelySuspended" }>
type CodexTerminalRecord = Extract<CodexAttemptRecord, { readonly _tag: "Terminal" }>
type CodexThreadBackedRecord = Exclude<CodexAttemptRecord, CodexEmptyRecord>
type CodexSendableRecord = Exclude<CodexThreadBackedRecord, CodexIntentRecord>
type CodexAcceptedTerminalRecord = CodexTerminalRecord & {
  readonly terminal: Extract<CodexSealedTerminalType, { readonly _tag: "Accepted" }>
  readonly evidenceManifest: EvidenceReference
}

const emptyRecordFor = (attempt: Pick<PlannedTaskAttempt, "attemptId" | "runId" | "worktree">): CodexEmptyRecord =>
  CodexAttemptRecord.cases.EmptyPreTurn.make({
    attemptId: attempt.attemptId,
    correlationAttemptId: attempt.attemptId,
    correlationRunId: attempt.runId,
    worktree: attempt.worktree
  })

const associatedRecordFor = (
  attempt: Pick<PlannedTaskAttempt, "attemptId" | "runId" | "worktree">,
  threadId: CodexThreadId
): CodexAssociatedRecord =>
  CodexAttemptRecord.cases.AssociatedPreTurn.make({
    attemptId: attempt.attemptId,
    correlationAttemptId: attempt.attemptId,
    correlationRunId: attempt.runId,
    threadId,
    worktree: attempt.worktree
  })

const intentRecordFor = (
  attempt: Pick<PlannedTaskAttempt, "attemptId" | "runId" | "worktree">,
  threadId: CodexThreadId,
  currentToken: CodexOwnedTurnToken,
  priorObservedTurnId: CodexTurnId | null,
  turnStartedAtMilliseconds: number,
  turnStartIncarnation: CodexServerIncarnation,
  toolEffectPolicy: CodexToolEffectPolicy,
  resultCycle?: ProviderResultCycle
): CodexIntentRecord =>
  CodexAttemptRecord.cases.TurnIntentRecorded.make({
    attemptId: attempt.attemptId,
    correlationAttemptId: attempt.attemptId,
    correlationRunId: attempt.runId,
    currentToken,
    turnStartedAtMilliseconds,
    turnStartIncarnation,
    toolEffectPolicy,
    ...(resultCycle === undefined ? {} : { resultCycle }),
    priorObservedTurnId,
    threadId,
    worktree: attempt.worktree
  })

const observedRecordFor = (
  attempt: Pick<PlannedTaskAttempt, "attemptId" | "runId" | "worktree">,
  threadId: CodexThreadId,
  currentToken: CodexOwnedTurnToken,
  observedTurnId: CodexTurnId,
  priorObservedTurnId: CodexTurnId | null,
  turnStartedAtMilliseconds?: number,
  turnStartIncarnation?: CodexServerIncarnation,
  toolEffectPolicy?: CodexToolEffectPolicy,
  resultCycle?: ProviderResultCycle
) =>
  Effect.gen(function* () {
    const response = resultCycle?.responses.at(lastElementOffset)
    const observedCycle =
      resultCycle !== undefined &&
      response !== undefined &&
      (response._tag === "RequestIntended" ||
        providerResultResponseOwnership(resultCycle)?.token === ProviderResultRequestToken.make(currentToken))
        ? yield* observeProviderResultTurn(
            resultCycle,
            ProviderResultRequestToken.make(currentToken),
            ProviderResultTurnId.make(observedTurnId),
            ProviderResultInstantMilliseconds.make(yield* Effect.clockWith((clock) => clock.currentTimeMillis))
          ).pipe(Effect.mapError(() => new CodexTurnBoundaryUnknown({})))
        : resultCycle
    return CodexAttemptRecord.cases.TurnObserved.make({
      attemptId: attempt.attemptId,
      correlationAttemptId: attempt.attemptId,
      correlationRunId: attempt.runId,
      currentToken,
      ...(turnStartedAtMilliseconds === undefined ? {} : { turnStartedAtMilliseconds }),
      ...(turnStartIncarnation === undefined ? {} : { turnStartIncarnation }),
      ...(toolEffectPolicy === undefined ? {} : { toolEffectPolicy }),
      ...(observedCycle === undefined ? {} : { resultCycle: observedCycle }),
      observedTurnId,
      priorObservedTurnId,
      threadId,
      worktree: attempt.worktree
    })
  })

const runningRecordFor = (
  attempt: Pick<PlannedTaskAttempt, "attemptId" | "runId" | "worktree">,
  record: CodexObservedRecord
): CodexRunningRecord =>
  CodexAttemptRecord.cases.Running.make({
    attemptId: attempt.attemptId,
    correlationAttemptId: attempt.attemptId,
    correlationRunId: attempt.runId,
    currentToken: record.currentToken,
    ...(record.turnStartedAtMilliseconds === undefined
      ? {}
      : { turnStartedAtMilliseconds: record.turnStartedAtMilliseconds }),
    ...(record.turnStartIncarnation === undefined ? {} : { turnStartIncarnation: record.turnStartIncarnation }),
    ...(record.toolEffectPolicy === undefined ? {} : { toolEffectPolicy: record.toolEffectPolicy }),
    ...(record.resultCycle === undefined ? {} : { resultCycle: record.resultCycle }),
    observedTurnId: record.observedTurnId,
    priorObservedTurnId: record.priorObservedTurnId,
    threadId: record.threadId,
    worktree: attempt.worktree
  })

const safelySuspendedRecordFor = (
  attempt: Pick<PlannedTaskAttempt, "attemptId" | "runId" | "worktree">,
  record: CodexObservedRecord | CodexSuspensionStopIntentRecord
): CodexSafelySuspendedRecord =>
  CodexAttemptRecord.cases.SafelySuspended.make({
    attemptId: attempt.attemptId,
    correlationAttemptId: attempt.attemptId,
    correlationRunId: attempt.runId,
    currentToken: record.currentToken,
    ...(record.turnStartedAtMilliseconds === undefined
      ? {}
      : { turnStartedAtMilliseconds: record.turnStartedAtMilliseconds }),
    ...(record.turnStartIncarnation === undefined ? {} : { turnStartIncarnation: record.turnStartIncarnation }),
    ...(record.toolEffectPolicy === undefined ? {} : { toolEffectPolicy: record.toolEffectPolicy }),
    ...(record.resultCycle === undefined ? {} : { resultCycle: record.resultCycle }),
    observedTurnId: record.observedTurnId,
    priorObservedTurnId: record.priorObservedTurnId,
    threadId: record.threadId,
    worktree: attempt.worktree
  })

const suspensionStopIntendedRecordFor = (
  attempt: Pick<PlannedTaskAttempt, "attemptId" | "runId" | "worktree">,
  record: CodexObservedRecord
): CodexSuspensionStopIntentRecord =>
  CodexAttemptRecord.cases.SuspensionStopIntended.make({
    attemptId: attempt.attemptId,
    correlationAttemptId: attempt.attemptId,
    correlationRunId: attempt.runId,
    currentToken: record.currentToken,
    ...(record.turnStartedAtMilliseconds === undefined
      ? {}
      : { turnStartedAtMilliseconds: record.turnStartedAtMilliseconds }),
    ...(record.turnStartIncarnation === undefined ? {} : { turnStartIncarnation: record.turnStartIncarnation }),
    ...(record.toolEffectPolicy === undefined ? {} : { toolEffectPolicy: record.toolEffectPolicy }),
    ...(record.resultCycle === undefined ? {} : { resultCycle: record.resultCycle }),
    observedTurnId: record.observedTurnId,
    priorObservedTurnId: record.priorObservedTurnId,
    threadId: record.threadId,
    worktree: attempt.worktree
  })

const terminalRecordFor = (
  attempt: Pick<PlannedTaskAttempt, "attemptId" | "runId" | "worktree">,
  record: OwnedTurnRecord,
  observedTurnId: CodexTurnId,
  terminalResult: CodexSealedTerminalType,
  evidenceManifest: EvidenceReference | null
): CodexTerminalRecord =>
  CodexAttemptRecord.cases.Terminal.make({
    attemptId: attempt.attemptId,
    correlationAttemptId: attempt.attemptId,
    correlationRunId: attempt.runId,
    currentToken: record.currentToken,
    ...(record.turnStartedAtMilliseconds === undefined
      ? {}
      : { turnStartedAtMilliseconds: record.turnStartedAtMilliseconds }),
    ...(record.turnStartIncarnation === undefined ? {} : { turnStartIncarnation: record.turnStartIncarnation }),
    ...(record.toolEffectPolicy === undefined ? {} : { toolEffectPolicy: record.toolEffectPolicy }),
    ...(record.resultCycle === undefined ? {} : { resultCycle: record.resultCycle }),
    evidenceManifest,
    observedTurnId,
    priorObservedTurnId: record.priorObservedTurnId,
    terminal: terminalResult,
    threadId: record.threadId,
    worktree: attempt.worktree
  })

type TurnLookup =
  | { readonly _tag: "Found"; readonly turn: CodexTurnSnapshot }
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Contradiction" }
  | { readonly _tag: "Foreign"; readonly observed: PlannedAttemptExecutorCorrelation }

type OwnedTurnRecord = Extract<
  CodexAttemptRecord,
  {
    readonly _tag:
      | "TurnIntentRecorded"
      | "TurnObserved"
      | "Running"
      | "SuspensionInterruptIntended"
      | "SuspensionStopIntended"
      | "SafelySuspended"
      | "Terminal"
      | "ResultRejected"
      | "ResultCorrectionPending"
      | "ResultCorrectionStopIntended"
  }
>

const hasOwnedTurnRecord = (record: CodexAttemptRecord): record is OwnedTurnRecord =>
  record._tag !== "EmptyPreTurn" && record._tag !== "AssociatedPreTurn"

const isThreadBackedRecord = (record: CodexAttemptRecord): record is CodexThreadBackedRecord =>
  record._tag !== "EmptyPreTurn"

const isAcceptedTerminalRecord = (record: CodexTerminalRecord): record is CodexAcceptedTerminalRecord =>
  record.terminal._tag === "Accepted" && record.evidenceManifest !== null

const isPersistableOwnedRecord = (record: CodexAttemptRecord): record is CodexObservedRecord =>
  record._tag === "TurnObserved" ||
  record._tag === "Running" ||
  record._tag === "SuspensionInterruptIntended" ||
  record._tag === "SafelySuspended"

export const ownedRecordPersistenceDisposition = (
  tag: CodexAttemptRecord["_tag"]
): "Intent" | "Persistable" | "Reject" => {
  switch (tag) {
    case "TurnIntentRecorded":
      return "Intent"
    case "TurnObserved":
    case "Running":
    case "SuspensionInterruptIntended":
    case "SafelySuspended":
      return "Persistable"
    case "SuspensionStopIntended":
    case "EmptyPreTurn":
    case "AssociatedPreTurn":
    case "Terminal":
    case "ResultRejected":
    case "ResultCorrectionPending":
    case "ResultCorrectionStopIntended":
      return "Reject"
  }
}

export const ownedTurnTokenCounts = (turns: ReadonlyArray<CodexTurnSnapshot>): ReadonlyMap<string, number> =>
  turns.reduce<ReadonlyMap<string, number>>((counts, turn) => {
    if (turn.ownedTurnToken === undefined) return counts
    return new Map([...counts, [turn.ownedTurnToken, (counts.get(turn.ownedTurnToken) ?? 0) + 1] as const])
  }, new Map())

export const hasDuplicateOwnedTurnTokens = (tokenCounts: ReadonlyMap<string, number>): boolean =>
  [...tokenCounts.values()].some((count) => count > 1)

const ownedTurnMatch = (thread: CodexThreadSnapshot, record: OwnedTurnRecord): TurnLookup => {
  if (hasDuplicateOwnedTurnTokens(ownedTurnTokenCounts(thread.turns))) return { _tag: "Contradiction" }
  const turn = thread.turns.find((candidate) => candidate.ownedTurnToken === record.currentToken)
  if (turn === undefined) {
    if (record._tag === "TurnIntentRecorded") return { _tag: "Missing" }
    // Codex's thread/read representation may omit Dalph's private token
    // marker even though the durable observed provider turn id is exact.
    // Preserve that provider identity for reconciliation; duplicate tokens
    // and a changed observed id remain contradictions above/below.
    const observedTurn = thread.turns.find((candidate) => candidate.id === record.observedTurnId)
    if (observedTurn !== undefined) return { _tag: "Found", turn: observedTurn }
    return { _tag: "Contradiction" }
  }
  return { _tag: "Found", turn }
}

export const priorObservedTurnIsConsistent = (
  thread: CodexThreadSnapshot,
  record: OwnedTurnRecord,
  turn: CodexTurnSnapshot
): boolean => {
  if ("observedTurnId" in record && turn.id !== record.observedTurnId) return false
  if (record.priorObservedTurnId === null) return true
  if (turn.id === record.priorObservedTurnId) return false
  const prior = thread.turns.find((candidate) => candidate.id === record.priorObservedTurnId)
  return prior !== undefined && prior.ownedTurnToken !== undefined
}

const ownedTurnCorrelation = (record: OwnedTurnRecord, turn: CodexTurnSnapshot): TurnLookup => {
  if (turn.correlation !== undefined) {
    const expected = PlannedAttemptExecutorCorrelation.make({
      attemptId: record.correlationAttemptId,
      runId: record.correlationRunId
    })
    if (!sameCorrelation(turn.correlation, expected)) return { _tag: "Foreign", observed: turn.correlation }
  }
  return { _tag: "Found", turn }
}

export const ownedTurnForRecord = (thread: CodexThreadSnapshot, record: CodexAttemptRecord): TurnLookup => {
  if (record._tag === "EmptyPreTurn" || record._tag === "AssociatedPreTurn") return { _tag: "Missing" }
  const match = ownedTurnMatch(thread, record)
  if (match._tag !== "Found") return match
  if (!priorObservedTurnIsConsistent(thread, record, match.turn)) return { _tag: "Contradiction" }
  return ownedTurnCorrelation(record, match.turn)
}

export const isTerminalTurn = (turn: CodexTurnSnapshot | undefined): boolean =>
  turn !== undefined && (turn.status === "completed" || turn.status === "failed")

export const isActiveThread = (thread: CodexThreadSnapshot, turn: CodexTurnSnapshot | undefined): boolean =>
  thread.status === "active" || turn?.status === "inProgress"

export const collectText = (value: unknown): string => {
  if (typeof value === "string") return value
  if (!isJsonRecord(value)) return ""
  const text = value["text"]
  return typeof text === "string" ? text : ""
}

type ParsedCommitMessage = { readonly _tag: "Valid"; readonly candidate: GitCommitSha } | { readonly _tag: "Invalid" }

export const parsedCommitFromMessage = (
  finalMessage: string,
  expectedCorrelation: PlannedAttemptExecutorCorrelation
): ParsedCommitMessage => {
  const candidate = decodeOwnedSemanticCandidate(finalMessage, expectedCorrelation)
  return Option.isSome(candidate) ? { _tag: "Valid", candidate: candidate.value.commit } : { _tag: "Invalid" }
}

export const decodeAcceptedManifest = (bytes: Uint8Array): typeof AcceptedResultEvidenceManifest.Type | undefined => {
  try {
    return Schema.decodeUnknownSync(AcceptedResultEvidenceManifest)(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return undefined
  }
}

export const acceptedManifestMatches = (
  bytes: Uint8Array,
  expected: typeof AcceptedResultEvidenceManifest.Type
): boolean => {
  const decoded = decodeAcceptedManifest(bytes)
  return decoded !== undefined && sameAcceptedManifest(decoded, expected)
}

export const commitMatchesHead = (head: GitCommitSha | undefined, commit: GitCommitSha): boolean =>
  head !== undefined && head === commit

export const commitFromTurn = (
  turn: CodexTurnSnapshot | undefined,
  expectedCorrelation: PlannedAttemptExecutorCorrelation
): GitCommitSha | undefined => {
  if (turn === undefined) return undefined
  const messages = turn.items
    .filter(isJsonRecord)
    .filter((item) => item["type"] === "agentMessage")
    .map(collectText)
  const finalMessage = messages.at(lastElementOffset)
  if (finalMessage === undefined) return undefined
  const parsedMessage = parsedCommitFromMessage(finalMessage, expectedCorrelation)
  if (parsedMessage._tag === "Invalid") return undefined
  return parsedMessage.candidate
}

export const defaultCodexTaskInstructions: ReadonlyArray<string> = [
  "Before returning an accepted result, use a fresh sub-agent with the same model selected for this task turn and medium reasoning to review the candidate against the issue, linked specifications, repository instructions, and `Base..HEAD`. Fix reasonable blocking findings and repeat with a fresh reviewer, stopping as soon as a review reports no reasonable blocking findings. Run at most four review rounds. If reasonable blocking findings remain after the fourth review, report failure and do not return an accepted result."
]

const taskTurnText = (
  attempt: PlannedTaskAttempt,
  specification: TaskWorkSpecification,
  taskInstructions: ReadonlyArray<string>
): string =>
  [
    `# ${specification.title}`,
    specification.body,
    "",
    "Dalph executor instructions:",
    ...taskInstructions.map((instruction, index) => `${index + 1}. ${instruction}`),
    "",
    "Dalph immutable attempt facts:",
    `task_id: ${attempt.taskId}`,
    `task_revision: ${attempt.taskRevision}`,
    `base_sha: ${attempt.baseSha}`,
    `branch: ${attempt.branch}`,
    `worktree: ${attempt.worktree}`,
    semanticCandidateInstructions
  ].join("\n")

/** The stable operator request for replacing one provider work unit inside the retained thread. */
export const CodexProviderWorkUnitReplacementRequest = Schema.Struct({
  claim: ActiveTaskClaim,
  plannedAttempt: PlannedTaskAttempt,
  requestId: CodexReplacementRequestId,
  specification: TaskWorkSpecification
}).check(
  Schema.makeFilter((request) =>
    request.claim.taskId !== request.plannedAttempt.taskId ||
    request.specification.taskId !== request.plannedAttempt.taskId ||
    request.specification.fingerprint !== request.plannedAttempt.taskRevision
      ? "replacement request claim and specification must match its planned attempt"
      : undefined
  )
)
export type CodexProviderWorkUnitReplacementRequest = typeof CodexProviderWorkUnitReplacementRequest.Type

const replacementRequestCanonical = (request: CodexProviderWorkUnitReplacementRequest): string =>
  JSON.stringify(Schema.encodeUnknownSync(CodexProviderWorkUnitReplacementRequest)(request))

const replacementRequestDigest = (crypto: Crypto.Crypto, request: CodexProviderWorkUnitReplacementRequest) =>
  codexReplacementRequestDigestFromCanonical(crypto, replacementRequestCanonical(request))

/** Process-local authority witness; it is never copied into the private replacement ledger. */
export const CodexReplacementAuthorityProof = Schema.Struct({
  baseSha: GitCommitSha,
  changedPaths: Schema.Array(Schema.String),
  claim: ActiveTaskClaim,
  gitStatus: Schema.String.check(
    Schema.makeFilter((status) =>
      status.trim().length > 0 ? undefined : "replacement Git status evidence must be non-empty"
    )
  ),
  headDescendsFromBase: Schema.Boolean,
  headSha: GitCommitSha,
  plannedAttempt: PlannedTaskAttempt,
  taskRevision: TaskRevision,
  worktree: WorktreeLocator
}).check(
  Schema.makeFilter((proof) =>
    proof.changedPaths.length === 0 ||
    proof.claim.taskId !== proof.plannedAttempt.taskId ||
    proof.taskRevision !== proof.plannedAttempt.taskRevision ||
    proof.baseSha !== proof.plannedAttempt.baseSha ||
    proof.worktree !== proof.plannedAttempt.worktree
      ? "replacement authority proof does not cover the exact planned attempt"
      : undefined
  )
)
export type CodexReplacementAuthorityProof = typeof CodexReplacementAuthorityProof.Type

const sameReplacementGitObservation = (
  left: CodexReplacementAuthorityProof,
  right: CodexReplacementAuthorityProof
): boolean =>
  left.baseSha === right.baseSha &&
  left.headSha === right.headSha &&
  left.headDescendsFromBase === right.headDescendsFromBase &&
  left.gitStatus === right.gitStatus &&
  left.changedPaths.length === right.changedPaths.length &&
  left.changedPaths.every((path, index) => path === right.changedPaths[index])

const CodexReplacementAuthorityFailureKind = Schema.Literals([
  "ProviderTemporarilyUnreadable",
  "TaskWorkSessionAbsent",
  "CorrelationConflict",
  "ExclusiveRetainedOwnershipUnproved"
])
type CodexReplacementAuthorityFailureKind = typeof CodexReplacementAuthorityFailureKind.Type

/** Typed fresh-authority failure; expected branches never become a replacement intent. */
export class CodexReplacementAuthorityFailure extends Schema.TaggedError<CodexReplacementAuthorityFailure>()(
  "CodexReplacementAuthorityFailure",
  { detail: Schema.String, kind: CodexReplacementAuthorityFailureKind }
) {}

export interface CodexReplacementAuthorityService {
  readonly observe: (
    request: CodexProviderWorkUnitReplacementRequest
  ) => Effect.Effect<CodexReplacementAuthorityProof, CodexReplacementAuthorityFailure>
}

export class CodexReplacementAuthority extends Context.Service<
  CodexReplacementAuthority,
  CodexReplacementAuthorityService
>()("@dalph/CodexReplacementAuthority") {}

/** Controlled fresh-authority injection for replacement tests and cassettes. */
export const controlledCodexReplacementAuthorityLayer = (
  service: CodexReplacementAuthorityService
): Layer.Layer<CodexReplacementAuthority> => Layer.succeed(CodexReplacementAuthority, service)

/** Actor-visible result; provider/session/authority failures remain distinct and fail closed. */
export const CodexProviderWorkUnitReplacementResult = Schema.TaggedUnion({
  Replaced: {
    correlation: PlannedAttemptExecutorCorrelation,
    operationId: CodexReplacementOperationId,
    requestId: CodexReplacementRequestId,
    worktree: WorktreeLocator
  },
  ProviderTemporarilyUnreadable: { detail: Schema.String },
  TaskWorkSessionAbsent: { detail: Schema.String },
  CorrelationConflict: { detail: Schema.String },
  ExclusiveRetainedOwnershipUnproved: { detail: Schema.String },
  PurgeUnconfirmed: { detail: Schema.String },
  RequestIdentityReuseContradiction: { detail: Schema.String }
})
export type CodexProviderWorkUnitReplacementResult = typeof CodexProviderWorkUnitReplacementResult.Type

/** A typed private-store append failure after replacement intent has crossed persistence. */
class CodexReplacementLedgerFailure extends Schema.TaggedError<CodexReplacementLedgerFailure>()(
  "CodexReplacementLedgerFailure",
  { detail: Schema.String }
) {}

interface CodexProviderWorkUnitReplacementService {
  readonly replacePurgedProviderWorkUnit: (
    request: CodexProviderWorkUnitReplacementRequest
  ) => Effect.Effect<
    CodexProviderWorkUnitReplacementResult,
    CodexAttemptStoreFailure | CodexAppServerFailure | CodexReplacementLedgerFailure
  >
}

export class CodexProviderWorkUnitReplacement extends Context.Service<
  CodexProviderWorkUnitReplacement,
  CodexProviderWorkUnitReplacementService
>()("@dalph/CodexProviderWorkUnitReplacement") {}

const replacementTaskTurnText = (
  attempt: PlannedTaskAttempt,
  specification: TaskWorkSpecification,
  evidence: CodexPurgedWorkUnitEvidence,
  operationId: CodexReplacementOperationId,
  taskInstructions: ReadonlyArray<string>
): string =>
  [
    taskTurnText(attempt, specification, taskInstructions),
    "",
    "Dalph provider work-unit replacement evidence:",
    `replacement_operation_id: ${operationId}`,
    `purged_predecessor_turn_id: ${evidence.predecessorTurnId}`,
    `purged_predecessor_token: ${evidence.predecessorToken}`,
    `retained_thread_id: ${evidence.threadId}`,
    `retained_worktree: ${evidence.worktree}`,
    "The preceding provider work unit was confirmed purged. Continue the retained worktree; do not describe this turn as a resumption of the purged unit."
  ].join("\n")

type ReplacementResult = CodexProviderWorkUnitReplacementResult

type ReplacementTurnCheck =
  | { readonly _tag: "Accepted"; readonly turn: CodexTurnSnapshot }
  | { readonly _tag: "Rejected"; readonly result: ReplacementResult }

const replacementTurnTokenMatches = (turn: CodexTurnSnapshot, token: CodexOwnedTurnToken): boolean =>
  turn.ownedTurnToken === undefined || turn.ownedTurnToken === token

const replacementTurnCorrelationMatches = (
  turn: CodexTurnSnapshot,
  expected: PlannedAttemptExecutorCorrelation
): boolean => turn.correlation === undefined || sameCorrelation(turn.correlation, expected)

const replacementTurnCheck = (
  request: CodexProviderWorkUnitReplacementRequest,
  turn: CodexTurnSnapshot,
  predecessor: CodexPurgedWorkUnitEvidence,
  replacementToken: CodexOwnedTurnToken
): ReplacementTurnCheck => {
  const correlatedTurn = turn.ownedTurnToken === undefined ? { ...turn, ownedTurnToken: replacementToken } : turn
  if (!replacementTurnTokenMatches(correlatedTurn, replacementToken)) {
    return {
      _tag: "Rejected",
      result: CodexProviderWorkUnitReplacementResult.cases.CorrelationConflict.make({
        detail: "replacement turn returned a different owned token"
      })
    }
  }
  if (!replacementTurnCorrelationMatches(correlatedTurn, plannedAttemptExecutorCorrelation(request.plannedAttempt))) {
    return {
      _tag: "Rejected",
      result: CodexProviderWorkUnitReplacementResult.cases.CorrelationConflict.make({
        detail: "replacement turn returned a foreign planned-attempt correlation"
      })
    }
  }
  if (correlatedTurn.id === predecessor.predecessorTurnId) {
    return {
      _tag: "Rejected",
      result: CodexProviderWorkUnitReplacementResult.cases.CorrelationConflict.make({
        detail: "replacement turn reused the purged predecessor identity"
      })
    }
  }
  return { _tag: "Accepted", turn: correlatedTurn }
}

const replacementThreadIdentityMatches = (
  request: CodexProviderWorkUnitReplacementRequest,
  predecessor: CodexPurgedWorkUnitEvidence,
  thread: CodexThreadSnapshot
): boolean =>
  thread.id === predecessor.threadId && thread.cwd === CodexThreadWorkingDirectory.make(request.plannedAttempt.worktree)

const replacementThreadCorrelationMatches = (
  request: CodexProviderWorkUnitReplacementRequest,
  thread: CodexThreadSnapshot
): boolean => {
  const expected = PlannedAttemptExecutorCorrelation.make({
    runId: request.plannedAttempt.runId,
    attemptId: request.plannedAttempt.attemptId
  })
  return thread.correlation === undefined || sameCorrelation(thread.correlation, expected)
}

const replacementThreadIsReadable = (thread: CodexThreadSnapshot): boolean =>
  thread.status !== "notLoaded" && thread.status !== "systemError"

const replacementThreadRetainsPredecessor = (
  predecessor: CodexPurgedWorkUnitEvidence,
  thread: CodexThreadSnapshot
): boolean =>
  thread.turns.some((turn) => turn.id === predecessor.predecessorTurnId) ||
  thread.turns.some((turn) => turn.ownedTurnToken === predecessor.predecessorToken)

const replacementThreadFactFailure = (
  request: CodexProviderWorkUnitReplacementRequest,
  predecessor: CodexPurgedWorkUnitEvidence,
  thread: CodexThreadSnapshot
): ReplacementResult | undefined => {
  if (!replacementThreadIdentityMatches(request, predecessor, thread)) {
    return CodexProviderWorkUnitReplacementResult.cases.CorrelationConflict.make({
      detail: "retained Codex thread id or worktree changed"
    })
  }
  if (!replacementThreadCorrelationMatches(request, thread)) {
    return CodexProviderWorkUnitReplacementResult.cases.CorrelationConflict.make({
      detail: "retained Codex thread correlation changed"
    })
  }
  if (!replacementThreadIsReadable(thread)) {
    return CodexProviderWorkUnitReplacementResult.cases.ProviderTemporarilyUnreadable.make({
      detail: "retained Codex thread status is unreadable"
    })
  }
  if (replacementThreadRetainsPredecessor(predecessor, thread)) {
    return CodexProviderWorkUnitReplacementResult.cases.PurgeUnconfirmed.make({
      detail: "the previously observed provider work unit remains visible"
    })
  }
  return undefined
}

const matchingReplacementTurn = (
  thread: CodexThreadSnapshot,
  replacementToken: CodexOwnedTurnToken | undefined
): CodexTurnSnapshot | undefined =>
  replacementToken === undefined
    ? undefined
    : thread.turns.find((turn) => turn.ownedTurnToken === replacementToken && turn.status === "inProgress")

type ReplacementActivities = Extract<CodexOwnedActivityCensusProjection, { readonly _tag: "ExactLive" }>["activities"]

const replacementActivityHasOnlyMatchingTurn = (
  activities: ReplacementActivities,
  matchingTurn: CodexTurnSnapshot | undefined,
  allowMatchingReplacementTurn: boolean
): boolean =>
  allowMatchingReplacementTurn &&
  matchingTurn !== undefined &&
  activities.length === 1 &&
  activities[0]?._tag === "ActiveTurn" &&
  activities[0].turnId === matchingTurn.id

const replacementActivityFailure = (
  census: CodexOwnedActivityCensusProjection,
  thread: CodexThreadSnapshot,
  replacementToken: CodexOwnedTurnToken | undefined,
  allowMatchingReplacementTurn: boolean
): ReplacementResult | undefined => {
  if (census._tag === "Absent") return undefined
  if (census._tag !== "ExactLive") {
    return CodexProviderWorkUnitReplacementResult.cases.ExclusiveRetainedOwnershipUnproved.make({
      detail: "fresh owned-activity census was not exact"
    })
  }
  const matchingTurn = matchingReplacementTurn(thread, replacementToken)
  return replacementActivityHasOnlyMatchingTurn(census.activities, matchingTurn, allowMatchingReplacementTurn)
    ? undefined
    : CodexProviderWorkUnitReplacementResult.cases.ExclusiveRetainedOwnershipUnproved.make({
        detail: "fresh owned-activity census found an unowned writer or turn"
      })
}

const replacementAuthorityClaimMatches = (
  request: CodexProviderWorkUnitReplacementRequest,
  proof: CodexReplacementAuthorityProof
): boolean => isExactTaskClaim(proof.claim, request.claim)

const replacementAuthorityPlanMatches = (
  request: CodexProviderWorkUnitReplacementRequest,
  proof: CodexReplacementAuthorityProof
): boolean => samePlannedTaskAttempt(proof.plannedAttempt, request.plannedAttempt)

const replacementAuthorityFactsMatch = (
  request: CodexProviderWorkUnitReplacementRequest,
  proof: CodexReplacementAuthorityProof
): boolean =>
  proof.worktree === request.plannedAttempt.worktree &&
  proof.baseSha === request.plannedAttempt.baseSha &&
  proof.taskRevision === request.plannedAttempt.taskRevision

const replacementAuthorityProofFailure = (
  request: CodexProviderWorkUnitReplacementRequest,
  proof: CodexReplacementAuthorityProof
): string | undefined => {
  if (!replacementAuthorityClaimMatches(request, proof)) return "fresh authority observed a different exact task claim"
  if (!replacementAuthorityPlanMatches(request, proof)) return "fresh authority observed a different planned attempt"
  if (!replacementAuthorityFactsMatch(request, proof)) return "fresh authority did not prove retained planned facts"
  if (!proof.headDescendsFromBase) {
    return "fresh Git or writer authority did not prove exclusive retained ownership"
  }
  return undefined
}

const replacementLedgerHasPhase = (
  ledger: CodexPurgedWorkUnitReplacementLedger,
  phase: CodexReplacementHistoryEntry["_tag"]
): boolean => ledger.history.at(lastElementOffset)?._tag === phase

const storeFailure = (error: unknown): error is CodexAttemptStoreFailure => error instanceof CodexAttemptStoreFailure

type ThreadReconciliation =
  | { readonly _tag: "Running"; readonly thread: CodexThreadSnapshot; readonly turn: CodexTurnSnapshot }
  | { readonly _tag: "Terminal"; readonly thread: CodexThreadSnapshot; readonly turn: CodexTurnSnapshot }
  | { readonly _tag: "Idle"; readonly thread: CodexThreadSnapshot; readonly turn: CodexTurnSnapshot | undefined }
  | { readonly _tag: "Unresolved"; readonly thread: CodexThreadSnapshot; readonly turn: undefined }

type StartedTurnResult =
  | { readonly _tag: "Turn"; readonly turn: CodexTurnSnapshot }
  | { readonly _tag: "Report"; readonly report: PlannedAttemptExecutorReportType }

/** The only planned facts needed after a task turn's prompt has already been supplied. */
type CodexAttemptContext = Pick<PlannedTaskAttempt, "attemptId" | "runId" | "worktree">

const finitePositiveDuration = Schema.DurationFromString.check(
  Schema.makeFilter((duration) =>
    Duration.isFinite(duration) && Duration.isPositive(duration)
      ? undefined
      : "owned-activity observation interval must be finite and greater than zero"
  )
)

/** Cadence for a fresh exact census only while a terminal Codex turn remains held by owned activity. */
export const CodexOwnedActivityObservationInterval = finitePositiveDuration.pipe(
  Schema.brand("CodexOwnedActivityObservationInterval")
)
export type CodexOwnedActivityObservationInterval = typeof CodexOwnedActivityObservationInterval.Type

const defaultCodexOwnedActivityObservationInterval = CodexOwnedActivityObservationInterval.make(Duration.seconds(1))

interface CodexPlannedAttemptExecutorLayerOptions {
  readonly ownedActivityObservationInterval?: CodexOwnedActivityObservationInterval
  readonly toolEffectPolicy?: CodexToolEffectPolicy
  /** Instructions inside one opaque provider turn; an explicit empty list omits the default review policy. */
  readonly taskInstructions?: ReadonlyArray<string>
}

/**
 * The concrete app-server executor keeps all Codex identities private. The
 * generic boundary receives only normalized #140/#168 reports.
 */
const makeCodexPlannedAttemptExecutorContext = (
  ownedActivityObservationInterval: CodexOwnedActivityObservationInterval,
  taskInstructions: ReadonlyArray<string>,
  toolEffectPolicy: CodexToolEffectPolicy
) =>
  Effect.gen(function* () {
    const app = yield* CodexAppServer
    const activityCensus = yield* CodexOwnedActivityCensus
    const crypto = yield* Crypto.Crypto
    const store = yield* CodexAttemptStore
    const git = yield* GitCommand
    const evidenceStore = yield* Effect.serviceOption(EvidenceStore)
    const replacementAuthority = yield* Effect.serviceOption(CodexReplacementAuthority)
    const gates = yield* Ref.make<ReadonlyMap<string, Semaphore.Semaphore>>(new Map())
    type TurnCompletionSubscription = {
      readonly close: Effect.Effect<void>
      readonly stream: Stream.Stream<CodexTurnCompletedHint>
      readonly threadIdleHints: Stream.Stream<CodexThreadIdleHint>
      readonly toolEffects: Stream.Stream<CodexToolEffectNotification>
      readonly expectTurnId: (turnId: CodexTurnId) => Effect.Effect<void>
      readonly expectNextTurn?: () => Effect.Effect<void>
    }
    const turnCompletionSubscriptions = yield* Ref.make<ReadonlyMap<string, TurnCompletionSubscription>>(new Map())
    const activeCompletionSubscriptions = yield* Ref.make<ReadonlyMap<string, TurnCompletionSubscription>>(new Map())
    // A proof is an activation-local capability, not copied provider authority.
    // New proof replaces old proof; every attempt mutation consumes or invalidates it.
    const beginProofs = yield* Ref.make<
      ReadonlyMap<
        string,
        { readonly proofId: PlannedAttemptExecutorBeginProofId; readonly association: CodexBeginAssociation }
      >
    >(new Map())
    const invalidateBeginProof = (correlation: PlannedAttemptExecutorCorrelation) =>
      Ref.update(
        beginProofs,
        (current) => new Map([...current].filter(([key]) => key !== plannedAttemptExecutorCorrelationKey(correlation)))
      )
    const freshOwnedTurnToken = Effect.gen(function* () {
      return CodexOwnedTurnToken.make(yield* crypto.randomUUIDv4)
    }).pipe(
      /* v8 ignore next -- @preserve Crypto.randomUUIDv4 has an uninhabited error channel in the production Crypto service. */
      Effect.mapError(() => new CodexTurnBoundaryUnknown({}))
    )
    const completionSubscriptionForTurnStart = Effect.fn(
      "CodexPlannedAttemptExecutor.completionSubscriptionForTurnStart"
    )(function* (correlation: PlannedAttemptExecutorCorrelation, threadId: CodexThreadId) {
      const active = (yield* Ref.get(activeCompletionSubscriptions)).get(
        plannedAttemptExecutorCorrelationKey(correlation)
      )
      if (active !== undefined) {
        if (active.expectNextTurn === undefined) return yield* new CodexTurnBoundaryUnknown({})
        return yield* active.expectNextTurn()
      }
      const subscriptionScope = yield* Scope.make()
      const attached =
        app.attachExactTurnCompletedHints === undefined
          ? undefined
          : yield* app
              .attachExactTurnCompletedHints(threadId)
              .pipe(Effect.provideService(Scope.Scope, subscriptionScope))
      const toolEffects =
        app.attachToolEffects === undefined
          ? Stream.empty
          : yield* app.attachToolEffects.pipe(Effect.provideService(Scope.Scope, subscriptionScope))
      const threadIdleHints =
        app.attachThreadIdleHints === undefined
          ? Stream.empty
          : yield* app.attachThreadIdleHints(threadId).pipe(Effect.provideService(Scope.Scope, subscriptionScope))
      const subscription: TurnCompletionSubscription = {
        close: Scope.close(subscriptionScope, Exit.void).pipe(Effect.asVoid),
        stream: attached?.hints ?? Stream.fromIterable<CodexTurnCompletedHint>([]),
        toolEffects,
        threadIdleHints,
        expectTurnId: attached?.expectTurnId ?? (() => Effect.void),
        ...(attached?.expectNextTurn === undefined ? {} : { expectNextTurn: attached.expectNextTurn })
      }
      const key = plannedAttemptExecutorCorrelationKey(correlation)
      const previous = yield* Ref.modify(turnCompletionSubscriptions, (current) => {
        const present = current.get(key)
        return [present, new Map(current).set(key, subscription)] as const
      })
      if (previous !== undefined) yield* previous.close
    })
    const bindTurnCompletionIdentity = (correlation: PlannedAttemptExecutorCorrelation, turnId: CodexTurnId) =>
      Effect.gen(function* () {
        const key = plannedAttemptExecutorCorrelationKey(correlation)
        const active = (yield* Ref.get(activeCompletionSubscriptions)).get(key)
        const pending = (yield* Ref.get(turnCompletionSubscriptions)).get(key)
        yield* (active ?? pending)?.expectTurnId(turnId) ?? Effect.void
      })
    const takeTurnCompletionSubscription = (
      correlation: PlannedAttemptExecutorCorrelation,
      threadId: CodexThreadId,
      turnId: CodexTurnId | undefined,
      attachmentScope: Scope.Scope
    ): Effect.Effect<TurnCompletionSubscription, never, Scope.Scope> =>
      Ref.modify(turnCompletionSubscriptions, (current) => {
        const key = plannedAttemptExecutorCorrelationKey(correlation)
        const present = current.get(key)
        return [present, new Map([...current].filter(([entryKey]) => entryKey !== key))] as const
      }).pipe(
        Effect.flatMap((present) => {
          if (present === undefined) {
            return Effect.gen(function* () {
              const attached =
                app.attachExactTurnCompletedHints === undefined
                  ? undefined
                  : yield* app
                      .attachExactTurnCompletedHints(threadId, turnId)
                      .pipe(Effect.provideService(Scope.Scope, attachmentScope))
              const toolEffects =
                app.attachToolEffects === undefined
                  ? Stream.empty
                  : yield* app.attachToolEffects.pipe(Effect.provideService(Scope.Scope, attachmentScope))
              const threadIdleHints =
                app.attachThreadIdleHints === undefined
                  ? Stream.empty
                  : yield* app.attachThreadIdleHints(threadId).pipe(Effect.provideService(Scope.Scope, attachmentScope))
              return {
                close: Effect.void,
                stream: attached?.hints ?? Stream.fromIterable<CodexTurnCompletedHint>([]),
                toolEffects,
                threadIdleHints,
                expectTurnId: attached?.expectTurnId ?? (() => Effect.void),
                ...(attached?.expectNextTurn === undefined ? {} : { expectNextTurn: attached.expectNextTurn })
              }
            })
          }
          return (turnId === undefined ? Effect.void : present.expectTurnId(turnId)).pipe(
            Effect.andThen(Effect.addFinalizer(() => present.close)),
            Effect.as(present)
          )
        }),
        Effect.tap((subscription) =>
          Effect.gen(function* () {
            const key = plannedAttemptExecutorCorrelationKey(correlation)
            yield* Ref.update(activeCompletionSubscriptions, (current) => new Map(current).set(key, subscription))
            yield* Effect.addFinalizer(() =>
              Ref.update(activeCompletionSubscriptions, (current) => {
                if (current.get(key) !== subscription) return current
                const next = new Map(current)
                next.delete(key)
                return next
              })
            )
          })
        ),
        Effect.provideService(Scope.Scope, attachmentScope)
      )
    const referenceMatchesBytes = Effect.fn("CodexPlannedAttemptExecutor.referenceMatchesBytes")(function* (
      reference: EvidenceReference,
      bytes: Uint8Array
    ) {
      const digestBytes = yield* crypto.digest("SHA-256", bytes)
      const digest = Schema.decodeUnknownSync(EvidenceDigest)(
        Array.from(digestBytes, (byte) => byte.toString(hexRadix).padStart(hexByteWidth, "0")).join("")
      )
      return evidenceReferenceEquals(reference, EvidenceReference.make({ byteLength: bytes.byteLength, digest }))
    })

    const gateFor = (correlation: PlannedAttemptExecutorCorrelation) =>
      Effect.gen(function* () {
        const key = plannedAttemptExecutorCorrelationKey(correlation)
        const created = yield* Semaphore.make(1)
        return yield* Ref.modify(gates, (current) => {
          const present = current.get(key)
          if (present !== undefined) return [present, current] as const
          return [created, new Map(current).set(key, created)] as const
        })
      })

    const readRecord = Effect.fn("CodexPlannedAttemptExecutor.readRecord")(function* (
      correlation: PlannedAttemptExecutorCorrelation,
      attempt: PlannedTaskAttempt
    ) {
      const found = yield* store.readAttempt(correlation.runId, correlation.attemptId)
      if (Option.isNone(found)) return Option.none<CodexAttemptRecord>()
      const record = found.value
      const observed = PlannedAttemptExecutorCorrelation.make({
        runId: record.correlationRunId,
        attemptId: record.correlationAttemptId
      })
      if (!sameCorrelation(observed, correlation) || record.worktree !== attempt.worktree) {
        return yield* Effect.fail(new ForeignAttemptRecord({ observed }))
      }
      return Option.some(record)
    })

    const save = (record: CodexAttemptRecord) => store.writeAttempt(record)

    const enforceThreadIdentity = (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      expectedThreadId: CodexThreadId,
      thread: CodexThreadSnapshot
    ) => {
      if (thread.id !== expectedThreadId || thread.cwd !== CodexThreadWorkingDirectory.make(attempt.worktree)) {
        return Effect.fail(new CodexThreadMismatch({}))
      }
      if (thread.correlation !== undefined && !sameCorrelation(thread.correlation, correlation)) {
        return Effect.fail(new ForeignAttemptRecord({ observed: thread.correlation }))
      }
      return Effect.succeed(thread)
    }

    const requiredReconciliationTurn = (
      reconciliation: ThreadReconciliation
    ): Effect.Effect<CodexTurnSnapshot, CodexTurnBoundaryUnknown> =>
      /* v8 ignore next -- @preserve Every caller has already narrowed reconciliation to Running, whose turn is required. */
      reconciliation.turn === undefined
        ? Effect.fail(new CodexTurnBoundaryUnknown({}))
        : Effect.succeed(reconciliation.turn)

    // An AssociatedPreTurn record says Dalph has not authorized turn/start.
    // Any provider turn therefore contradicts the private pre-turn state.
    const reconcileAssociatedThread = (thread: CodexThreadSnapshot) => {
      if (thread.turns.length > 0 || thread.status !== "idle") {
        return Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
      return Effect.succeed<ThreadReconciliation>({ _tag: "Idle", thread, turn: undefined })
    }

    const reconcileOwnedTurn = (
      thread: CodexThreadSnapshot,
      record: OwnedTurnRecord
    ): Effect.Effect<
      ThreadReconciliation,
      CodexThreadMismatch | CodexTurnBoundaryUnknown | CodexTurnCensusPending | ForeignAttemptRecord
    > => {
      if (
        record._tag === "Running" &&
        !hasDuplicateOwnedTurnTokens(ownedTurnTokenCounts(thread.turns)) &&
        !thread.turns.some((turn) => turn.ownedTurnToken === record.currentToken) &&
        !thread.turns.some((turn) => turn.id === record.observedTurnId)
      ) {
        return Effect.fail(new CodexTurnCensusPending({}))
      }
      const lookup = ownedTurnForRecord(thread, record)
      if (lookup._tag === "Contradiction") {
        return Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
      if (lookup._tag === "Foreign") return Effect.fail(new ForeignAttemptRecord({ observed: lookup.observed }))
      if (lookup._tag === "Missing") {
        return Effect.succeed({ _tag: "Unresolved" as const, thread, turn: undefined })
      }
      if (isTerminalTurn(lookup.turn)) return Effect.succeed({ _tag: "Terminal" as const, thread, turn: lookup.turn })
      if (isActiveThread(thread, lookup.turn))
        return Effect.succeed({ _tag: "Running" as const, thread, turn: lookup.turn })
      return Effect.succeed({ _tag: "Idle" as const, thread, turn: lookup.turn })
    }

    const refreshThreadTurnLedger = Effect.fn("CodexPlannedAttemptExecutor.refreshThreadTurnLedger")(function* (
      thread: CodexThreadSnapshot
    ) {
      if (app.listThreadTurns === undefined) return thread
      // Codex 0.155 can report a stale in-progress turn from thread/resume
      // after the persisted turn has completed. Reconcile against its exact
      // paginated turn ledger before treating the attempt as still running.
      const persistedTurns = yield* app.listThreadTurns(thread.id)
      const byId = new Map(thread.turns.map((turn) => [turn.id, turn]))
      for (const turn of persistedTurns) byId.set(turn.id, turn)
      const turns = [...byId.values()]
      const status =
        thread.status === "active" && !turns.some((turn) => turn.status === "inProgress") ? "idle" : thread.status
      return { ...thread, status, turns }
    })

    const reconcileOwnedTurnWithProviderLedger = Effect.fn(
      "CodexPlannedAttemptExecutor.reconcileOwnedTurnWithProviderLedger"
    )(function* (thread: CodexThreadSnapshot, record: OwnedTurnRecord) {
      const first = yield* reconcileOwnedTurn(thread, record)
      if (first._tag !== "Running" || app.listThreadTurns === undefined) return first
      return yield* reconcileOwnedTurn(yield* refreshThreadTurnLedger(thread), record)
    })

    const reconcile = Effect.fn("CodexPlannedAttemptExecutor.reconcile")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord
    ) {
      /* v8 ignore next -- @preserve Reconciliation is called only after allocation or a durable thread-backed record read. */
      if (record._tag === "EmptyPreTurn") return yield* Effect.fail(new CodexThreadMismatch({}))
      if (record._tag === "SuspensionStopIntended") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      const thread = yield* app.resumeThread(record.threadId, attempt.worktree)
      yield* enforceThreadIdentity(attempt, correlation, record.threadId, thread)
      if (record._tag === "AssociatedPreTurn") {
        /* v8 ignore next -- @preserve Associated no-turn reconciliation accepts only the loaded idle state established by thread/read normalization. */
        if (thread.status === "notLoaded" || thread.status === "systemError") {
          return yield* Effect.fail(new CodexThreadMismatch({}))
        }
        return yield* reconcileAssociatedThread(thread)
      }
      const ownedTurn = yield* reconcileOwnedTurnWithProviderLedger(thread, record)
      if (ownedTurn._tag === "Terminal") return ownedTurn
      if (thread.status === "notLoaded" || thread.status === "systemError") {
        return yield* Effect.fail(new CodexThreadMismatch({}))
      }
      return ownedTurn
    })

    const readAfterTurnBoundary = Effect.fn("CodexPlannedAttemptExecutor.readAfterTurnBoundary")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexIntentRecord
    ) {
      const thread = yield* app.readThread(record.threadId)
      yield* enforceThreadIdentity(attempt, correlation, record.threadId, thread)
      const ownedTurn = yield* reconcileOwnedTurnWithProviderLedger(thread, record)
      if (ownedTurn._tag === "Terminal") return ownedTurn
      if (thread.status === "notLoaded" || thread.status === "systemError") {
        return yield* Effect.fail(new CodexThreadMismatch({}))
      }
      return ownedTurn
    })

    const observeOwnedActivity = Effect.fn("CodexPlannedAttemptExecutor.observeOwnedActivity")(function* (
      thread: CodexThreadSnapshot,
      settledTerminalToolItems = false
    ) {
      const backgroundTerminals = yield* app.listBackgroundTerminals(thread.id)
      return yield* activityCensus.observe(thread, backgroundTerminals, "PlannedAttempt", settledTerminalToolItems)
    })

    const observeOwnedActivityByThreadId = Effect.fn("CodexPlannedAttemptExecutor.observeOwnedActivityByThreadId")(
      function* (threadId: CodexThreadId, terminalCorrelation?: PlannedAttemptExecutorCorrelation) {
        const thread = yield* app.readThread(threadId)
        const settledTerminalToolItems =
          terminalCorrelation === undefined
            ? false
            : (yield* listToolEffects(terminalCorrelation)).every((effect) => effect._tag === "Completed")
        return yield* observeOwnedActivity(yield* refreshThreadTurnLedger(thread), settledTerminalToolItems)
      }
    )

    const censusHasActivity = (census: CodexOwnedActivityCensusProjection): boolean => census._tag !== "Absent"

    const canContinueActivityObservation = (
      census: CodexOwnedActivityCensusProjection,
      terminalReadAuthorized = false
    ): boolean => census._tag === "ExactLive" || (terminalReadAuthorized && census._tag === "Unreadable")

    const terminateBackgroundActivities = (
      threadId: CodexThreadId,
      terminals: ReadonlyArray<{ readonly processId: string }>
    ) =>
      Effect.gen(function* () {
        for (const terminal of terminals) {
          const terminated = yield* app.terminateBackgroundTerminal(threadId, terminal.processId)
          if (!terminated) {
            return yield* Effect.fail(
              new CodexActivityCensusUnknown({ detail: `background activity ${terminal.processId} survived` })
            )
          }
        }
      })

    const terminateDescendantActivities = (descendants: ReadonlyArray<CodexOwnedProcessIdentity>) => {
      if (descendants.length === 0) return Effect.void
      const uniqueDescendants = [
        ...new Map(descendants.map((identity) => [`${identity.pid}:${identity.startIdentity}`, identity])).values()
      ]
      return activityCensus.terminateDescendants(uniqueDescendants, "PlannedAttempt")
    }

    const quiescePass = Effect.fn("CodexPlannedAttemptExecutor.quiescePass")(function* (
      threadId: CodexThreadId,
      remaining: number
    ) {
      const census = yield* observeOwnedActivityByThreadId(threadId)
      if (census._tag === "Absent") return
      if (census._tag === "Unreadable" || census._tag === "Contradictory") {
        return yield* Effect.fail(new CodexActivityCensusUnknown({ detail: census.detail }))
      }
      if (remaining === 0) {
        return yield* Effect.fail(new CodexActivityCensusUnknown({ detail: "owned activity survived quiescence" }))
      }
      if (census.activities.some((activity) => activity._tag === "ActiveTurn")) {
        return yield* Effect.fail(new CodexActivityCensusUnknown({ detail: "owned turn remained active" }))
      }
      const backgroundTerminals = census.activities.flatMap((activity) =>
        activity._tag === "BackgroundTerminal" ? [activity.terminal] : []
      )
      yield* terminateBackgroundActivities(threadId, backgroundTerminals)
      const descendants = census.activities.flatMap((activity) =>
        activity._tag === "ProcessGroupDescendant" ? [activity.identity] : []
      )
      yield* terminateDescendantActivities(descendants)
    })

    // Suspension owns every app-server activity and execution-substrate
    // descendant returned by the attempt census. Every termination is followed
    // by a fresh thread/list/group observation; unreadable, contradictory, or
    // surviving activity never becomes safe capacity.
    const quiesceOwnedActivity = Effect.fn("CodexPlannedAttemptExecutor.quiesceOwnedActivity")(function* (
      threadId: CodexThreadId
    ) {
      const maxQuiescePasses = 3
      for (let remaining = maxQuiescePasses; remaining >= 0; remaining -= 1) {
        yield* quiescePass(threadId, remaining)
      }
    })

    const readHead = Effect.fn("CodexPlannedAttemptExecutor.readHead")(function* (attempt: CodexAttemptContext) {
      const result = yield* git.runInWorktree(attempt.worktree, ["rev-parse", "HEAD"])
      if (result.exitCode !== 0) return undefined
      const value = result.stdout.trim()
      try {
        return Schema.decodeUnknownSync(GitCommitSha)(value)
      } catch {
        return undefined
      }
    })

    const accepted = Effect.fn("CodexPlannedAttemptExecutor.accepted")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: OwnedTurnRecord,
      turn: CodexTurnSnapshot,
      thread: CodexThreadSnapshot,
      terminalReadAuthorized = false
    ) {
      let commit: GitCommitSha
      let reference: EvidenceReference
      if (record.resultCycle?.plannedBaseSha !== undefined) {
        const ownership = ownedTurnForRecord(thread, record)
        const finalMessage =
          turn.items
            .filter(isJsonRecord)
            .filter((item) => item["type"] === "agentMessage")
            .map(collectText)
            .at(lastElementOffset) ?? ""
        const validateResponse = validateOwnedSemanticCandidate(finalMessage, correlation, {
          ...providerResultGitBoundary(git, attempt.worktree, record.resultCycle.plannedBaseSha),
          proveOwnership:
            ownership._tag === "Found" && ownership.turn.id === turn.id
              ? Effect.void
              : Effect.fail(
                  new ProviderResultAuthorityUnavailable({
                    boundary: "Ownership",
                    detail: "exact owned turn is unproved"
                  })
                ),
          publishAndVerifyEvidence: (candidate, boundCorrelation) =>
            Option.isSome(evidenceStore)
              ? publishProviderResultEvidence(evidenceStore.value, crypto, candidate, boundCorrelation)
              : Effect.fail(
                  new ProviderResultAuthorityUnavailable({
                    boundary: "Evidence",
                    detail: "evidence store is unavailable"
                  })
                )
        })
        const request = yield* Schema.decodeUnknownEffect(ProviderResultResponseIntent)(
          record.resultCycle.responses.at(lastElementOffset)?.intent
        ).pipe(Effect.mapError(() => new CodexTurnBoundaryUnknown({})))
        const validation = yield* withinProviderResultDeadline(request, validateResponse).pipe(Effect.result)
        if (validation._tag === "Failure") {
          const error = validation.failure
          if (error._tag === "ProviderResultDeadlineElapsed") {
            if (record._tag === "TurnIntentRecorded") return yield* new CodexTurnBoundaryUnknown({})
            return { continueLifecycleObservation: false, report: yield* expireResultCorrection(correlation, record) }
          }
          if (error._tag === "ProviderResultRejected")
            return yield* failed(
              attempt,
              correlation,
              record,
              turn.id,
              thread,
              error.reason === "CandidateLineageInvalid" ? "LineageUnproven" : error.reason,
              error.observedHead,
              terminalReadAuthorized
            )
          if (error.boundary === "Ownership") return yield* new CodexTurnBoundaryUnknown({})
          if (error.boundary === "Evidence") return yield* new CodexEvidenceInvalid({})
          return yield* new CodexGitObservationUnknown({})
        }
        commit = validation.success.commit
        reference = validation.success.evidenceManifest
      } else {
        // A pre-cycle record has no retained original Git Base. Never invent
        // lineage from the current master or accept it through weaker checks.
        return yield* new CodexGitObservationUnknown({})
      }

      const finalCensus = yield* observeOwnedActivityByThreadId(thread.id, correlation)
      if (finalCensus._tag !== "Absent") {
        return {
          continueLifecycleObservation: canContinueActivityObservation(finalCensus, terminalReadAuthorized),
          report: running(correlation)
        }
      }
      const sealed = CodexSealedTerminal.cases.Accepted.make({ commit, evidenceManifest: reference })
      yield* save(terminalRecordFor(attempt, record, turn.id, sealed, reference))
      return {
        continueLifecycleObservation: false,
        report: terminal(
          correlation,
          PlannedAttemptExecutorResult.cases.Accepted.make({ acceptedResult: { commit, evidenceManifest: reference } })
        )
      }
    })

    const rereadAccepted = Effect.fn("CodexPlannedAttemptExecutor.rereadAccepted")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAcceptedTerminalRecord,
      turn: CodexTurnSnapshot,
      thread: CodexThreadSnapshot
    ) {
      if (Option.isNone(evidenceStore)) return yield* Effect.fail(new CodexEvidenceUnavailable({}))
      if (commitFromTurn(turn, correlation) !== record.terminal.commit)
        return yield* Effect.fail(new CodexEvidenceInvalid({}))
      const bytes = yield* evidenceStore.value.read(record.evidenceManifest)
      if (!(yield* referenceMatchesBytes(record.evidenceManifest, bytes))) {
        return yield* Effect.fail(new CodexEvidenceInvalid({}))
      }
      const expectedManifest = AcceptedResultEvidenceManifest.make({
        commit: record.terminal.commit,
        correlation,
        formatVersion: 1,
        outcome: "Accepted",
        predecessor: null
      })
      if (!acceptedManifestMatches(bytes, expectedManifest)) {
        return yield* Effect.fail(new CodexEvidenceInvalid({}))
      }
      const head = yield* readHead(attempt)
      if (!commitMatchesHead(head, record.terminal.commit)) {
        return yield* Effect.fail(new CodexGitObservationUnknown({}))
      }
      const finalCensus = yield* observeOwnedActivityByThreadId(thread.id, correlation)
      if (finalCensus._tag !== "Absent") {
        return {
          continueLifecycleObservation: canContinueActivityObservation(finalCensus, true),
          report: running(correlation)
        }
      }
      return {
        continueLifecycleObservation: false,
        report: terminal(
          correlation,
          PlannedAttemptExecutorResult.cases.Accepted.make({
            acceptedResult: { commit: record.terminal.commit, evidenceManifest: record.evidenceManifest }
          })
        )
      }
    })

    const rejectedResultReport = Effect.fn("CodexPlannedAttemptExecutor.rejectedResultReport")(function* (
      correlation: PlannedAttemptExecutorCorrelation,
      record: Extract<CodexAttemptRecord, { readonly _tag: "ResultRejected" }>
    ) {
      return PlannedAttemptExecutorReport.cases.ExecutorWorkResultRejected.make({
        correlation,
        reason: record.reason,
        recoveryCause: record.recoveryCause,
        custody: record.custody,
        responseCount: yield* Schema.decodeUnknownEffect(PlannedAttemptResultResponseCount)(
          record.resultCycle.responses.length
        ).pipe(Effect.mapError(() => new CodexTurnBoundaryUnknown({})))
      })
    })

    const finishResultCorrectionStop = Effect.fn("CodexPlannedAttemptExecutor.finishResultCorrectionStop")(function* (
      correlation: PlannedAttemptExecutorCorrelation,
      stop: Extract<CodexAttemptRecord, { readonly _tag: "ResultCorrectionStopIntended" }>,
      firstDelivery: boolean
    ) {
      const attempt: CodexAttemptContext = {
        attemptId: correlation.attemptId,
        runId: correlation.runId,
        worktree: stop.worktree
      }
      const stopped = yield* Effect.gen(function* () {
        const thread = yield* app.readThread(stop.threadId)
        yield* enforceThreadIdentity(attempt, correlation, stop.threadId, thread)
        const owned = ownedTurnForRecord(thread, stop)
        if (owned._tag !== "Found") return yield* new CodexTurnBoundaryUnknown({})
        if (owned.turn.status === "inProgress") {
          if (!firstDelivery) return false
          // An uncertain acknowledgement is reconciled below; never resend it.
          yield* app.interruptTurn(stop.threadId, stop.observedTurnId).pipe(Effect.result)
          const reread = yield* app.readThread(stop.threadId)
          yield* enforceThreadIdentity(attempt, correlation, stop.threadId, reread)
          const reconciled = ownedTurnForRecord(reread, stop)
          if (reconciled._tag !== "Found" || reconciled.turn.status === "inProgress") return false
        }
        yield* quiesceOwnedActivity(stop.threadId)
        return (yield* observeOwnedActivityByThreadId(stop.threadId, correlation))._tag === "Absent"
      }).pipe(Effect.result)
      const retained = CodexAttemptRecord.cases.ResultRejected.make({
        ...stop,
        _tag: "ResultRejected",
        recoveryCause: "Deadline",
        custody: stopped._tag === "Success" && stopped.success ? { _tag: "Stopped" } : { _tag: "Unresolved" }
      })
      yield* save(retained)
      return yield* rejectedResultReport(correlation, retained)
    })

    const expireResultCorrection = Effect.fn("CodexPlannedAttemptExecutor.expireResultCorrection")(function* (
      correlation: PlannedAttemptExecutorCorrelation,
      record: Exclude<OwnedTurnRecord, CodexIntentRecord>
    ) {
      const resultCycle = record.resultCycle
      const rejected = resultCycle?.responses.findLast((response) => response._tag === "ResponseRejected")
      if (resultCycle === undefined || rejected?._tag !== "ResponseRejected")
        return yield* new CodexTurnBoundaryUnknown({})
      const stop = CodexAttemptRecord.cases.ResultCorrectionStopIntended.make({
        ...record,
        _tag: "ResultCorrectionStopIntended",
        resultCycle,
        reason: rejected.reason
      })
      yield* save(stop)
      return yield* finishResultCorrectionStop(correlation, stop, true)
    })

    const failed = Effect.fn("CodexPlannedAttemptExecutor.failed")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: OwnedTurnRecord,
      observedTurnId: CodexTurnId,
      thread: CodexThreadSnapshot,
      failureCode: PlannedAttemptExecutorFailureCode,
      observedHead?: GitCommitSha,
      terminalReadAuthorized = false
    ) {
      if (record._tag === "ResultRejected") {
        const census = yield* observeOwnedActivityByThreadId(thread.id, correlation)
        if (record.custody._tag === "Stopped" && census._tag !== "Absent")
          return yield* new CodexActivityCensusUnknown({ detail: "retained rejection custody is not freshly proved" })
        const retained = CodexAttemptRecord.cases.ResultRejected.make({
          ...record,
          custody: census._tag === "Absent" ? { _tag: "Stopped" } : { _tag: "Unresolved" }
        })
        yield* save(retained)
        return { continueLifecycleObservation: false, report: yield* rejectedResultReport(correlation, retained) }
      }
      if (
        (failureCode === "ResultEnvelopeInvalid" ||
          failureCode === "CandidateHeadMismatch" ||
          failureCode === "LineageUnproven") &&
        record.resultCycle !== undefined
      ) {
        const reason = failureCode === "LineageUnproven" ? "CandidateLineageInvalid" : failureCode
        const previousResponse = record.resultCycle.responses.at(lastElementOffset)
        const responseObservedAt =
          previousResponse?._tag === "ResponseRejected"
            ? previousResponse.responseObservedAt
            : ProviderResultInstantMilliseconds.make(yield* Effect.clockWith((clock) => clock.currentTimeMillis))
        const resultCycle = yield* rejectProviderResultResponse(
          record.resultCycle,
          ProviderResultRequestToken.make(record.currentToken),
          ProviderResultTurnId.make(observedTurnId),
          responseObservedAt,
          reason
        ).pipe(Effect.mapError(() => new CodexTurnBoundaryUnknown({})))
        const pending = CodexAttemptRecord.cases.ResultCorrectionPending.make({
          ...record,
          _tag: "ResultCorrectionPending",
          observedTurnId,
          reason,
          resultCycle
        })
        yield* save(pending)
        const census = yield* observeOwnedActivityByThreadId(thread.id, correlation)
        if (census._tag === "Absent") {
          const correction = yield* sendResultCorrection(attempt, correlation, pending)
          if (correction !== undefined) return { continueLifecycleObservation: false, report: correction }
        }
        const retained = CodexAttemptRecord.cases.ResultRejected.make({
          ...pending,
          _tag: "ResultRejected",
          recoveryCause: census._tag === "Absent" ? "CorrectionExhausted" : "WriterCustodyUnresolved",
          custody: census._tag === "Absent" ? { _tag: "Stopped" } : { _tag: "Unresolved" }
        })
        yield* save(retained)
        return {
          continueLifecycleObservation: false,
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkResultRejected.make({
            correlation,
            reason: retained.reason,
            recoveryCause: retained.recoveryCause,
            responseCount: yield* Schema.decodeUnknownEffect(PlannedAttemptResultResponseCount)(
              retained.resultCycle.responses.length
            ).pipe(Effect.mapError(() => new CodexTurnBoundaryUnknown({}))),
            custody: retained.custody
          })
        }
      }
      const finalCensus = yield* observeOwnedActivityByThreadId(thread.id, correlation)
      if (finalCensus._tag !== "Absent") {
        return {
          continueLifecycleObservation: canContinueActivityObservation(finalCensus, terminalReadAuthorized),
          report: running(correlation)
        }
      }
      const result = { _tag: "Failed" as const, failureCode, ...(observedHead === undefined ? {} : { observedHead }) }
      yield* save(
        terminalRecordFor(attempt, record, observedTurnId, CodexSealedTerminal.cases.Failed.make(result), null)
      )
      return { continueLifecycleObservation: false, report: terminal(correlation, result) }
    })

    const observedRecordForTerminal = Effect.fn("CodexPlannedAttemptExecutor.observedRecordForTerminal")(function* (
      attempt: CodexAttemptContext,
      record: CodexAttemptRecord,
      reconciliation: Extract<ThreadReconciliation, { readonly _tag: "Terminal" }>
    ) {
      if (record._tag === "TurnIntentRecorded") {
        const observed = yield* observedRecordFor(
          attempt,
          record.threadId,
          record.currentToken,
          reconciliation.turn.id,
          record.priorObservedTurnId,
          record.turnStartedAtMilliseconds,
          record.turnStartIncarnation,
          record.toolEffectPolicy,
          record.resultCycle
        )
        yield* save(observed)
        return observed
      }
      /* v8 ignore next -- @preserve Reconciliation reaches this helper only with its thread-backed owned record. */
      if (hasOwnedTurnRecord(record)) return record
      return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
    })

    const runningAfterActivity = Effect.fn("CodexPlannedAttemptExecutor.runningAfterActivity")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      observedRecord: OwnedTurnRecord
    ) {
      if (observedRecord._tag === "Terminal" || observedRecord._tag === "SuspensionInterruptIntended")
        return running(correlation)
      /* v8 ignore next -- @preserve Terminal observation converts TurnIntentRecorded before this function is called. */
      if (!isPersistableOwnedRecord(observedRecord)) {
        return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
      yield* save(runningRecordFor(attempt, observedRecord))
      return running(correlation)
    })

    const finishTerminalOrFailed = Effect.fn("CodexPlannedAttemptExecutor.finishTerminalOrFailed")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      observedRecord: OwnedTurnRecord,
      reconciliation: Extract<ThreadReconciliation, { readonly _tag: "Terminal" }>,
      terminalReadAuthorized = false
    ) {
      if (observedRecord._tag === "ResultCorrectionStopIntended")
        return {
          continueLifecycleObservation: false,
          report: yield* finishResultCorrectionStop(correlation, observedRecord, false)
        }
      if (observedRecord._tag === "ResultRejected" || observedRecord._tag === "ResultCorrectionPending") {
        return yield* failed(
          attempt,
          correlation,
          observedRecord,
          observedRecord.observedTurnId,
          reconciliation.thread,
          observedRecord.reason === "CandidateLineageInvalid" ? "LineageUnproven" : observedRecord.reason,
          undefined,
          terminalReadAuthorized
        )
      }
      const turn = reconciliation.turn
      if (observedRecord._tag === "Terminal") {
        if (observedRecord.terminal._tag === "Failed") {
          return { continueLifecycleObservation: false, report: terminal(correlation, observedRecord.terminal) }
        }
        if (!isAcceptedTerminalRecord(observedRecord) || turn.status !== "completed")
          return yield* Effect.fail(new CodexEvidenceInvalid({}))
        return yield* rereadAccepted(attempt, correlation, observedRecord, turn, reconciliation.thread)
      }
      if (turn.status === "completed") {
        return yield* accepted(
          attempt,
          correlation,
          observedRecord,
          turn,
          reconciliation.thread,
          terminalReadAuthorized
        )
      }
      return yield* failed(
        attempt,
        correlation,
        observedRecord,
        turn.id,
        reconciliation.thread,
        "ProviderFailed",
        undefined,
        terminalReadAuthorized
      )
    })

    const terminalOrRunningOutcome = Effect.fn("CodexPlannedAttemptExecutor.terminalOrRunningOutcome")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord,
      reconciliation: Extract<ThreadReconciliation, { readonly _tag: "Terminal" }>,
      completionHintAuthorized = false
    ) {
      const exactCompletionHintRequired = app.terminalSealPolicy !== "FreshLifecycleMaySeal"
      const hasUnsealedOwnedTurn =
        record._tag === "Running" || record._tag === "SuspensionInterruptIntended" || record._tag === "SafelySuspended"
      if (exactCompletionHintRequired && hasUnsealedOwnedTurn && !completionHintAuthorized) {
        return { continueLifecycleObservation: false, report: running(correlation) }
      }
      const terminalReadAuthorized =
        record._tag === "Terminal" ||
        record._tag === "ResultRejected" ||
        record._tag === "ResultCorrectionPending" ||
        completionHintAuthorized
      const observedRecord = yield* observedRecordForTerminal(attempt, record, reconciliation)
      const toolEffects = yield* listToolEffects(correlation)
      const census = yield* observeOwnedActivity(
        reconciliation.thread,
        toolEffects.every((effect) => effect._tag === "Completed")
      )
      if (censusHasActivity(census)) {
        return {
          continueLifecycleObservation: canContinueActivityObservation(census, terminalReadAuthorized),
          report: yield* runningAfterActivity(attempt, correlation, observedRecord)
        }
      }
      return yield* finishTerminalOrFailed(attempt, correlation, observedRecord, reconciliation, terminalReadAuthorized)
    })

    const terminalOrRunning = Effect.fn("CodexPlannedAttemptExecutor.terminalOrRunning")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord,
      reconciliation: Extract<ThreadReconciliation, { readonly _tag: "Terminal" }>
    ) {
      return (yield* terminalOrRunningOutcome(attempt, correlation, record, reconciliation)).report
    })

    const reconcileAfterTurnBoundary = Effect.fn("CodexPlannedAttemptExecutor.reconcileAfterTurnBoundary")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexIntentRecord
    ) {
      // turn/start may have crossed the provider boundary before its response
      // was lost. Read the exact thread without issuing another state-changing
      // request; the app-server transport applies its own finite RPC bound.
      const reconciliation = yield* readAfterTurnBoundary(attempt, correlation, record)
      if (reconciliation._tag === "Running") {
        const turn = yield* requiredReconciliationTurn(reconciliation)
        const observed = yield* observedRecordFor(
          attempt,
          record.threadId,
          record.currentToken,
          turn.id,
          record.priorObservedTurnId,
          record.turnStartedAtMilliseconds,
          record.turnStartIncarnation,
          record.toolEffectPolicy,
          record.resultCycle
        )
        yield* save(observed)
        yield* save(runningRecordFor(attempt, observed))
        return running(correlation)
      }
      /* v8 ignore next -- @preserve The caller handles Terminal reconciliation before requesting a running record. */
      if (reconciliation._tag === "Terminal")
        return yield* terminalOrRunning(attempt, correlation, record, reconciliation)
      return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
    })

    const allocateThread = Effect.fn("CodexPlannedAttemptExecutor.allocateThread")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation
    ) {
      // This record is the durable empty allocation intent. No task turn may
      // cross the app-server boundary until the returned thread is recorded.
      yield* save(emptyRecordFor(attempt))
      const thread = yield* app.startThread(attempt.worktree)
      yield* enforceThreadIdentity(attempt, correlation, thread.id, thread)
      yield* reconcileAssociatedThread(thread)
      const associated = associatedRecordFor(attempt, thread.id)
      yield* save(associated)
      return associated
    })

    const startTurnAcrossBoundary = Effect.fn("CodexPlannedAttemptExecutor.startTurnAcrossBoundary")(function* (
      attempt: CodexAttemptContext,
      text: string,
      correlation: PlannedAttemptExecutorCorrelation,
      intent: CodexIntentRecord
    ) {
      return yield* app.startTurn(intent.threadId, attempt.worktree, text, intent.currentToken).pipe(
        Effect.map((turn): StartedTurnResult => ({ _tag: "Turn", turn })),
        Effect.catch((error) =>
          reconcileAfterTurnBoundary(attempt, correlation, intent).pipe(
            Effect.map((report): StartedTurnResult => ({ _tag: "Report", report })),
            Effect.catch(() => app.close.pipe(Effect.andThen(Effect.fail(error))))
          )
        )
      )
    })

    const finishStartedTurn = Effect.fn("CodexPlannedAttemptExecutor.finishStartedTurn")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexSendableRecord | CodexIntentRecord,
      priorObservedTurnId: CodexTurnId | null,
      currentToken: CodexOwnedTurnToken,
      turnStartedAtMilliseconds: number,
      turnStartIncarnation: CodexServerIncarnation,
      retainedToolEffectPolicy: CodexToolEffectPolicy,
      result: StartedTurnResult,
      resultCycle?: ProviderResultCycle
    ) {
      if (result._tag === "Report") return result.report
      const turn =
        result.turn.ownedTurnToken === undefined ? { ...result.turn, ownedTurnToken: currentToken } : result.turn
      if (turn.ownedTurnToken !== currentToken) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      yield* enforceThreadIdentity(attempt, correlation, record.threadId, {
        id: record.threadId,
        cwd: CodexThreadWorkingDirectory.make(attempt.worktree),
        status: turn.status === "inProgress" ? "active" : "idle",
        turns: [turn],
        ...(turn.correlation === undefined ? {} : { correlation: turn.correlation })
      })
      const observed = yield* observedRecordFor(
        attempt,
        record.threadId,
        currentToken,
        turn.id,
        priorObservedTurnId,
        turnStartedAtMilliseconds,
        turnStartIncarnation,
        retainedToolEffectPolicy,
        resultCycle ?? ("resultCycle" in record ? record.resultCycle : undefined)
      )
      yield* save(observed)
      // Even a terminal status in the turn/start response is only an initial
      // response fact. The exact completion notification is the authorization
      // boundary for rereading terminal state and owned activity.
      yield* save(runningRecordFor(attempt, observed))
      yield* bindTurnCompletionIdentity(correlation, turn.id)
      return running(correlation)
    })

    /** A missing turn/start acknowledgement cannot supply an owned turn id or stopped-writer proof. */
    const expiredUnobservedCorrectionReport = Effect.fn("CodexPlannedAttemptExecutor.expiredUnobservedCorrection")(
      function* (
        correlation: PlannedAttemptExecutorCorrelation,
        record: Extract<CodexAttemptRecord, { readonly _tag: "TurnIntentRecorded" }>
      ) {
        const cycle = record.resultCycle
        const response = cycle?.responses.at(lastElementOffset)
        const now = ProviderResultInstantMilliseconds.make(yield* Effect.clockWith((clock) => clock.currentTimeMillis))
        if (
          cycle === undefined ||
          response?.intent._tag !== "Correction" ||
          !providerResultResponseExpired(response.intent, now)
        )
          return undefined
        const rejected = cycle.responses.findLast((entry) => entry._tag === "ResponseRejected")
        if (rejected?._tag !== "ResponseRejected") return yield* new CodexTurnBoundaryUnknown({})
        return PlannedAttemptExecutorReport.cases.ExecutorWorkResultRejected.make({
          correlation,
          reason: rejected.reason,
          recoveryCause: "Deadline",
          custody: { _tag: "Unresolved" },
          responseCount: yield* Schema.decodeUnknownEffect(PlannedAttemptResultResponseCount)(
            cycle.responses.length
          ).pipe(Effect.mapError(() => new CodexTurnBoundaryUnknown({})))
        })
      }
    )

    const sendResultCorrection = Effect.fn("CodexPlannedAttemptExecutor.sendResultCorrection")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      pending: Extract<CodexAttemptRecord, { readonly _tag: "ResultCorrectionPending" }>
    ): Effect.fn.Return<
      PlannedAttemptExecutorReportType | undefined,
      | CodexAppServerFailure
      | CodexAttemptStoreFailure
      | CodexTurnBoundaryUnknown
      | CodexThreadMismatch
      | ForeignAttemptRecord
      | CodexTurnCensusPending
      | CodexActivityCensusUnknown
      | CodexGitObservationUnknown
      | CodexEvidenceUnavailable
      | CodexEvidenceInvalid
    > {
      const currentToken = yield* freshOwnedTurnToken
      const now = ProviderResultInstantMilliseconds.make(yield* Effect.clockWith((clock) => clock.currentTimeMillis))
      const decision = yield* prepareProviderResultCorrection(
        pending.resultCycle,
        ProviderResultRequestToken.make(currentToken),
        now
      ).pipe(Effect.mapError(() => new CodexTurnBoundaryUnknown({})))
      if (decision._tag === "OperatorRequired") return undefined
      if (decision._tag !== "CorrectionIntentPrepared") return yield* new CodexTurnBoundaryUnknown({})
      const policy = pending.toolEffectPolicy ?? bindCodexToolEffectPolicy(toolEffectPolicy, attempt.worktree)
      const intent = intentRecordFor(
        attempt,
        pending.threadId,
        currentToken,
        pending.observedTurnId,
        now,
        app.incarnation,
        policy,
        decision.cycle
      )
      yield* save(intent)
      yield* completionSubscriptionForTurnStart(correlation, pending.threadId)
      const text = [
        `Dalph rejected the previous response: ${pending.reason}.`,
        "Freshly verify the current worktree, repair any required code or verification defects, and return a new complete response.",
        semanticCandidateInstructions
      ].join("\n")
      const result = yield* withinProviderResultDeadline(
        decision.request,
        startTurnAcrossBoundary(attempt, text, correlation, intent)
      ).pipe(
        Effect.catchTag("ProviderResultDeadlineElapsed", () =>
          expiredUnobservedCorrectionReport(correlation, intent).pipe(
            Effect.flatMap((report) =>
              report === undefined
                ? Effect.fail(new CodexTurnBoundaryUnknown({}))
                : Effect.succeed({ _tag: "Report" as const, report })
            )
          )
        ),
        Effect.mapError(() => new CodexTurnBoundaryUnknown({}))
      )
      return yield* finishStartedTurn(
        attempt,
        correlation,
        pending,
        pending.observedTurnId,
        currentToken,
        now,
        app.incarnation,
        policy,
        result,
        decision.cycle
      )
    })

    const sendTurn = Effect.fn("CodexPlannedAttemptExecutor.sendTurn")(function* (
      attempt: PlannedTaskAttempt,
      specification: TaskWorkSpecification,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord
    ) {
      if (record._tag === "ResultRejected") return yield* new CodexTurnBoundaryUnknown({})
      /* v8 ignore next -- @preserve sendTurn is called only after allocation has persisted an associated thread. */
      if (record._tag === "EmptyPreTurn") return yield* Effect.fail(new CodexThreadMismatch({}))
      /* v8 ignore next -- @preserve A durable turn intent is reconciled before another turn can be sent. */
      if (record._tag === "TurnIntentRecorded") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      const priorObservedTurnId = record._tag === "AssociatedPreTurn" ? null : record.observedTurnId
      const currentToken = yield* freshOwnedTurnToken
      const turnStartedAtMilliseconds = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
      // A fresh association starts one response cycle before turn/start. Resume
      // of an existing owned turn preserves its history and never creates a
      // replacement budget merely because another transport request is sent.
      const resultCycle =
        record._tag === "AssociatedPreTurn"
          ? yield* Schema.decodeUnknownEffect(ProviderResultCycle)({
              cycleId: currentToken,
              plannedBaseSha: attempt.baseSha,
              responses: [
                {
                  _tag: "RequestIntended",
                  intent: { _tag: "Initial", ordinal: 1, token: currentToken, intendedAt: turnStartedAtMilliseconds }
                }
              ]
            }).pipe(Effect.mapError(() => new CodexTurnBoundaryUnknown({})))
          : record.resultCycle !== undefined
            ? yield* prepareProviderResultContinuation(
                record.resultCycle,
                ProviderResultRequestToken.make(currentToken),
                ProviderResultInstantMilliseconds.make(turnStartedAtMilliseconds)
              ).pipe(Effect.mapError(() => new CodexTurnBoundaryUnknown({})))
            : undefined
      const retainedToolEffectPolicy = hasOwnedTurnRecord(record)
        ? (record.toolEffectPolicy ?? toolEffectPolicy)
        : bindCodexToolEffectPolicy(toolEffectPolicy, attempt.worktree)
      // Persist the crossing intent before turn/start. A lost response can
      // therefore be reconciled without sending a second turn.
      const intent = intentRecordFor(
        attempt,
        record.threadId,
        currentToken,
        priorObservedTurnId,
        turnStartedAtMilliseconds,
        app.incarnation,
        retainedToolEffectPolicy,
        resultCycle
      )
      yield* save(intent)
      // The provider may complete the new turn before its turn/start response
      // arrives, so install the exact-ID notification subscription first.
      yield* completionSubscriptionForTurnStart(correlation, record.threadId)
      return yield* startTurnAcrossBoundary(
        attempt,
        taskTurnText(attempt, specification, taskInstructions),
        correlation,
        intent
      ).pipe(
        (effect) => {
          const response = resultCycle?.responses.at(lastElementOffset)
          return response === undefined
            ? effect
            : withinProviderResultDeadline(response.intent, effect).pipe(
                Effect.catchTag("ProviderResultDeadlineElapsed", () =>
                  expiredUnobservedCorrectionReport(correlation, intent).pipe(
                    Effect.flatMap((report) =>
                      report === undefined
                        ? Effect.fail(new CodexTurnBoundaryUnknown({}))
                        : Effect.succeed({ _tag: "Report" as const, report })
                    )
                  )
                )
              )
        },
        Effect.flatMap((result) =>
          finishStartedTurn(
            attempt,
            correlation,
            record,
            priorObservedTurnId,
            currentToken,
            turnStartedAtMilliseconds,
            app.incarnation,
            retainedToolEffectPolicy,
            result,
            intent.resultCycle
          )
        ),
        Effect.onExit((exit) =>
          Exit.isFailure(exit)
            ? Ref.modify(turnCompletionSubscriptions, (current) => {
                const key = plannedAttemptExecutorCorrelationKey(correlation)
                const present = current.get(key)
                return [present, new Map([...current].filter(([entryKey]) => entryKey !== key))] as const
              }).pipe(Effect.flatMap((present) => (present === undefined ? Effect.void : present.close)))
            : Effect.void
        )
      )
    })

    /** Distinguishes a thread created by this command from private state recovered after a process boundary. */
    type LoadedBeginRecord =
      | { readonly _tag: "FreshAllocation"; readonly record: CodexThreadBackedRecord }
      | { readonly _tag: "Recovered"; readonly record: CodexThreadBackedRecord }

    const loadBeginRecord = Effect.fn("CodexPlannedAttemptExecutor.loadBeginRecord")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation
    ) {
      const found = yield* readRecord(correlation, attempt)
      if (Option.isNone(found)) {
        return {
          _tag: "FreshAllocation" as const,
          record: yield* allocateThread(attempt, correlation)
        } satisfies LoadedBeginRecord
      }
      const record = found.value
      if (!isThreadBackedRecord(record)) {
        return {
          _tag: "FreshAllocation" as const,
          record: yield* allocateThread(attempt, correlation)
        } satisfies LoadedBeginRecord
      }
      return { _tag: "Recovered" as const, record } satisfies LoadedBeginRecord
    })

    const reconcilePreTurnBegin = Effect.fn("CodexPlannedAttemptExecutor.reconcilePreTurnBegin")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexPreTurnBeginRecord
    ) {
      if (record._tag === "EmptyPreTurn") {
        return CodexBeginAssociation.FreshAllocation({ record: yield* allocateThread(attempt, correlation) })
      }
      const reconciliation = yield* reconcile(attempt, correlation, record).pipe(
        Effect.catch((error: unknown) =>
          error instanceof CodexAppServerFailure && error.kind === "NotFound"
            ? Effect.succeed<ThreadReconciliation | undefined>(undefined)
            : Effect.fail(error)
        )
      )
      if (reconciliation === undefined) {
        // The durable association proves turn/start was not yet authorized, so
        // a conclusively absent empty thread can be replaced within this Begin.
        return CodexBeginAssociation.FreshAllocation({ record: yield* allocateThread(attempt, correlation) })
      }
      /* v8 ignore next -- @preserve Associated pre-turn state carries no owned turn that can be Running or Terminal. */
      if (reconciliation._tag === "Running" || reconciliation._tag === "Terminal") {
        return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
      /* v8 ignore next -- @preserve Associated pre-turn reconciliation is idle, unresolved, or conclusively absent. */
      if (reconciliation._tag === "Unresolved") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      return CodexBeginAssociation.ReconciledExisting({ record })
    })

    const saveExecutingResumeRecord = Effect.fn("CodexPlannedAttemptExecutor.saveExecutingResumeRecord")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexThreadBackedRecord,
      reconciliation: ThreadReconciliation
    ) {
      const disposition = ownedRecordPersistenceDisposition(record._tag)
      /* v8 ignore next -- @preserve Resume admits only SafelySuspended records before this reconciliation helper, never TurnIntentRecorded. */
      if (disposition === "Intent" && record._tag === "TurnIntentRecorded") {
        const turn = yield* requiredReconciliationTurn(reconciliation)
        const observed = yield* observedRecordFor(
          attempt,
          record.threadId,
          record.currentToken,
          turn.id,
          record.priorObservedTurnId,
          record.turnStartedAtMilliseconds,
          record.turnStartIncarnation,
          record.toolEffectPolicy,
          record.resultCycle
        )
        yield* save(observed)
        yield* save(runningRecordFor(attempt, observed))
      } else if (disposition === "Persistable" && isPersistableOwnedRecord(record)) {
        yield* save(runningRecordFor(attempt, record))
        /* v8 ignore next -- @preserve Thread-backed records are exhaustively classified as Intent or Persistable here. */
      } else {
        return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
      return running(correlation)
    })

    const reconcileExistingResume = Effect.fn("CodexPlannedAttemptExecutor.reconcileExistingResume")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexThreadBackedRecord
    ) {
      const reconciliation = yield* reconcile(attempt, correlation, record)
      if (reconciliation._tag === "Running") {
        return yield* saveExecutingResumeRecord(attempt, correlation, record, reconciliation)
      }
      if (reconciliation._tag === "Terminal") {
        return yield* terminalOrRunning(attempt, correlation, record, reconciliation)
      }
      if (reconciliation._tag === "Unresolved") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      if (record._tag === "Terminal") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
    })

    const loadReconciledBeginRecord = Effect.fn("CodexPlannedAttemptExecutor.loadReconciledBeginRecord")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation,
      proofId: PlannedAttemptExecutorBeginProofId
    ) {
      const proof = (yield* Ref.get(beginProofs)).get(plannedAttemptExecutorCorrelationKey(correlation))
      yield* invalidateBeginProof(correlation)
      if (proof?.proofId !== proofId) return yield* new CodexTurnBoundaryUnknown({})
      const found = yield* readRecord(correlation, attempt)
      if (Option.isNone(found)) return yield* new CodexTurnBoundaryUnknown({})
      const current = found.value
      if (
        current._tag !== "AssociatedPreTurn" ||
        current.threadId !== proof.association.record.threadId ||
        current.worktree !== proof.association.record.worktree
      ) {
        return yield* new CodexTurnBoundaryUnknown({})
      }
      // A newly allocated empty thread has no readable rollout until its first
      // task turn. Its validated start response is authority only in this process.
      // Existing threads require a fresh read; neither route can allocate here.
      if (proof.association._tag === "ReconciledExisting") yield* reconcile(attempt, correlation, current)
      return current
    })

    const begin = Effect.fn("CodexPlannedAttemptExecutor.begin")(function* (
      request: PlannedAttemptExecutorRequest,
      delivery: PlannedAttemptExecutorBeginDelivery
    ) {
      const attempt = request.plannedAttempt
      const correlation = plannedAttemptExecutorCorrelation(attempt)
      if (delivery._tag === "ReconciledDelivery") {
        const record = yield* loadReconciledBeginRecord(attempt, correlation, delivery.proofId)
        const report = yield* sendTurn(attempt, request.specification, correlation, record)
        return report._tag === "ExecutorWorkExecuting" ? report : running(correlation)
      }
      yield* invalidateBeginProof(correlation)
      const loaded = yield* loadBeginRecord(attempt, correlation)
      let record = loaded.record
      if (loaded._tag === "Recovered" && record._tag === "AssociatedPreTurn") {
        record = (yield* reconcilePreTurnBegin(attempt, correlation, record)).record
      } else if (loaded._tag === "Recovered") {
        return yield* new CodexTurnBoundaryUnknown({})
      }
      const report = yield* sendTurn(attempt, request.specification, correlation, record)
      // Begin acknowledges that the autonomous turn was established. Even
      // when Codex finishes before turn/start returns, its exact Terminal
      // report remains in the private attempt record for the next passive
      // observation; exposing it here would violate Begin's public Executing
      // settlement and make the workflow unable to accept report ordinal 1.
      return report._tag === "ExecutorWorkExecuting" ? report : running(correlation)
    })

    const recordMatchesCorrelation = (
      record: CodexAttemptRecord,
      correlation: PlannedAttemptExecutorCorrelation
    ): boolean => record.correlationAttemptId === correlation.attemptId && record.correlationRunId === correlation.runId

    const readSuspensionRecord = Effect.fn("CodexPlannedAttemptExecutor.readSuspensionRecord")(function* (
      correlation: PlannedAttemptExecutorCorrelation
    ) {
      const found = yield* store.readAttempt(correlation.runId, correlation.attemptId)
      if (Option.isNone(found)) return yield* Effect.fail(new CodexThreadMismatch({}))
      const record = found.value
      if (!recordMatchesCorrelation(record, correlation)) {
        return yield* Effect.fail(
          new ForeignAttemptRecord({
            observed: PlannedAttemptExecutorCorrelation.make({
              attemptId: record.correlationAttemptId,
              runId: record.correlationRunId
            })
          })
        )
      }
      if (!isThreadBackedRecord(record)) return yield* Effect.fail(new CodexThreadMismatch({}))
      return record
    })

    const resume = Effect.fn("CodexPlannedAttemptExecutor.resume")(function* (request: PlannedAttemptExecutorRequest) {
      const attempt = request.plannedAttempt
      const correlation = plannedAttemptExecutorCorrelation(attempt)
      const record = yield* readSuspensionRecord(correlation)
      if (record._tag !== "SafelySuspended") return yield* new CodexTurnBoundaryUnknown({})
      const response = record.resultCycle?.responses.at(lastElementOffset)
      const now = ProviderResultInstantMilliseconds.make(yield* Effect.clockWith((clock) => clock.currentTimeMillis))
      if (response !== undefined && providerResultResponseExpired(response.intent, now))
        return yield* expireResultCorrection(correlation, record)
      const existingReport = yield* reconcileExistingResume(attempt, correlation, record)
      if (existingReport !== undefined) return existingReport
      return yield* sendTurn(attempt, request.specification, correlation, record)
    })

    const canSuspendIdleRecord = (record: CodexAttemptRecord): record is OwnedTurnRecord =>
      hasOwnedTurnRecord(record) &&
      record._tag !== "Terminal" &&
      record._tag !== "ResultRejected" &&
      record._tag !== "ResultCorrectionStopIntended"

    const saveSuspendedRecord = Effect.fn("CodexPlannedAttemptExecutor.saveSuspendedRecord")(function* (
      attempt: CodexAttemptContext,
      record: CodexAttemptRecord,
      turn: CodexTurnSnapshot | undefined
    ) {
      const disposition = ownedRecordPersistenceDisposition(record._tag)
      if (disposition === "Intent" && record._tag === "TurnIntentRecorded") {
        /* v8 ignore next -- @preserve Intent disposition is selected only from reconciliation carrying the observed turn. */
        if (turn === undefined) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
        const observed = yield* observedRecordFor(
          attempt,
          record.threadId,
          record.currentToken,
          turn.id,
          record.priorObservedTurnId,
          record.turnStartedAtMilliseconds,
          record.turnStartIncarnation,
          record.toolEffectPolicy,
          record.resultCycle
        )
        yield* save(observed)
        yield* save(safelySuspendedRecordFor(attempt, observed))
      } else if (disposition === "Persistable" && isPersistableOwnedRecord(record)) {
        yield* save(safelySuspendedRecordFor(attempt, record))
        /* v8 ignore next -- @preserve Suspendable owned records are exhaustively classified as Intent or Persistable here. */
      } else {
        return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
    })

    const suspendIdle = Effect.fn("CodexPlannedAttemptExecutor.suspendIdle")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord,
      current: ThreadReconciliation
    ) {
      if (!canSuspendIdleRecord(record)) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      yield* quiesceOwnedActivity(record.threadId)
      yield* saveSuspendedRecord(attempt, record, current.turn)
      return suspended(correlation)
    })

    const reconcileInterruptFailure = (
      error: unknown,
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord
    ) =>
      reconcile(attempt, correlation, record).pipe(
        Effect.flatMap((after) => {
          if (after._tag === "Terminal")
            return terminalOrRunning(attempt, correlation, record, after).pipe(Effect.asVoid)
          if (after._tag === "Idle") return Effect.void
          return Effect.fail(error)
        })
      )

    const suspendAfterInterrupt = Effect.fn("CodexPlannedAttemptExecutor.suspendAfterInterrupt")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexThreadBackedRecord,
      after: ThreadReconciliation
    ) {
      if (after._tag === "Terminal") return yield* terminalOrRunning(attempt, correlation, record, after)
      if (after._tag === "Running") return running(correlation)
      /* v8 ignore next -- @preserve suspendAfterInterrupt is called only after the bounded interrupt read resolves. */
      if (after._tag === "Unresolved") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      yield* quiesceOwnedActivity(record.threadId)
      yield* saveSuspendedRecord(attempt, record, after.turn)
      return suspended(correlation)
    })

    const suspendRunning = Effect.fn("CodexPlannedAttemptExecutor.suspendRunning")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexThreadBackedRecord,
      current: ThreadReconciliation
    ) {
      const turn = yield* requiredReconciliationTurn(current)
      // Exactly one interrupt is issued. The post-boundary read decides both
      // the lost-response and terminal-during-suspension races.
      if (!hasOwnedTurnRecord(record)) return yield* new CodexTurnBoundaryUnknown({})
      const observed = yield* observedRecordFor(
        attempt,
        record.threadId,
        record.currentToken,
        turn.id,
        record.priorObservedTurnId,
        record.turnStartedAtMilliseconds,
        record.turnStartIncarnation,
        record.toolEffectPolicy,
        record.resultCycle
      )
      const intent = CodexAttemptRecord.cases.SuspensionInterruptIntended.make({
        ...observed,
        _tag: "SuspensionInterruptIntended"
      })
      yield* save(intent)
      yield* app
        .interruptTurn(record.threadId, turn.id)
        .pipe(Effect.catch((error) => reconcileInterruptFailure(error, attempt, correlation, intent)))
      const after = yield* reconcile(attempt, correlation, record)
      return yield* suspendAfterInterrupt(attempt, correlation, record, after)
    })

    const suspend = Effect.fn("CodexPlannedAttemptExecutor.suspend")(function* (attempt: PlannedTaskAttempt) {
      const correlation = plannedAttemptExecutorCorrelation(attempt)
      const record = yield* readSuspensionRecord(correlation)
      const finishIntendedContainmentStop = Effect.fn("CodexPlannedAttemptExecutor.finishIntendedContainmentStop")(
        function* (intent: CodexSuspensionStopIntentRecord) {
          yield* app.close
          yield* save(safelySuspendedRecordFor(attempt, intent))
          return suspended(correlation)
        }
      )
      if (record._tag === "SuspensionStopIntended") return yield* finishIntendedContainmentStop(record)
      const reconciliation = yield* reconcile(attempt, correlation, record).pipe(Effect.result)
      if (Result.isFailure(reconciliation)) {
        const failure = reconciliation.failure
        const retainedThreadResumeDeadline =
          failure instanceof CodexAppServerFailure &&
          failure.kind === "ResponseDeadline" &&
          failure.operation === "thread/resume"
        if (!retainedThreadResumeDeadline) return yield* failure
        if (!isPersistableOwnedRecord(record)) return yield* new CodexTurnBoundaryUnknown({})
        // The workflow has already recorded its Suspend intent before entering
        // this command. Only this intent-authorized path may turn an unanswered
        // passive-capable provider read into an exact containment stop.
        const stopIntent = suspensionStopIntendedRecordFor(attempt, record)
        yield* save(stopIntent)
        return yield* finishIntendedContainmentStop(stopIntent)
      }
      const current = reconciliation.success
      if (current._tag === "Terminal") return yield* terminalOrRunning(attempt, correlation, record, current)
      if (current._tag === "Idle") return yield* suspendIdle(attempt, correlation, record, current)
      if (current._tag === "Unresolved") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      return yield* suspendRunning(attempt, correlation, record, current)
    })

    const isUnusableActivityCensus = (census: CodexOwnedActivityCensusProjection): boolean =>
      census._tag === "Unreadable" || census._tag === "Contradictory"

    const isBeginReconciliation = (purpose: PlannedAttemptExecutorObservationPurpose): boolean =>
      purpose._tag === "ReconcileCommand" && purpose.command === "Begin"

    const isPreTurnBeginRecord = (
      record: CodexAttemptRecord,
      purpose: PlannedAttemptExecutorObservationPurpose
    ): record is CodexPreTurnBeginRecord =>
      isBeginReconciliation(purpose) && (record._tag === "EmptyPreTurn" || record._tag === "AssociatedPreTurn")

    const issueBeginProof = Effect.fn("CodexPlannedAttemptExecutor.issueBeginProof")(function* (
      correlation: PlannedAttemptExecutorCorrelation,
      association: CodexBeginAssociation
    ) {
      const proofId = PlannedAttemptExecutorBeginProofId.make(yield* crypto.randomUUIDv4)
      yield* Ref.update(
        beginProofs,
        (current) =>
          new Map([...current, [plannedAttemptExecutorCorrelationKey(correlation), { proofId, association }]])
      )
      return PlannedAttemptExecutorProjection.cases.BeginNotCrossed.make({ correlation, proofId })
    })

    const projectIdleRecord = Effect.fn("CodexPlannedAttemptExecutor.projectIdleRecord")(function* (
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexThreadBackedRecord
    ) {
      if (record._tag === "AssociatedPreTurn") return noReport(correlation)
      const census = yield* observeOwnedActivityByThreadId(record.threadId)
      if (census._tag === "ExactLive") return exact(running(correlation))
      if (isUnusableActivityCensus(census)) return unreadable(correlation)
      if (record._tag === "SafelySuspended") return exact(suspended(correlation))
      return unreadable(correlation)
    })

    const listToolEffects = (correlation: PlannedAttemptExecutorCorrelation) =>
      store.listToolEffects?.(correlation.runId, correlation.attemptId) ?? Effect.succeed([])
    const writeToolEffect = (record: CodexToolEffectRecord) =>
      store.writeToolEffect?.(record) ?? Effect.fail(new CodexTurnBoundaryUnknown({}))
    const readToolEffect = (
      correlation: PlannedAttemptExecutorCorrelation,
      turnId: CodexTurnId,
      itemId: CodexToolItemId
    ) =>
      store.readToolEffect?.(correlation.runId, correlation.attemptId, turnId, itemId) ??
      Effect.fail(new CodexTurnBoundaryUnknown({}))
    const finishToolEffectStop = Effect.fn("CodexPlannedAttemptExecutor.finishToolEffectStop")(function* (
      record: Extract<CodexToolEffectRecord, { readonly _tag: "StopIntended" }>
    ) {
      if (record.incarnation === app.incarnation) {
        yield* app
          .interruptTurn(record.threadId, record.turnId)
          .pipe(Effect.timeoutOrElse({ duration: toolInterruptGrace, orElse: () => Effect.void }), Effect.ignore)
        // close proves the exact app-server containment stopped, including its writers.
        yield* app.close
      } else {
        if (
          record.serverLaunch === undefined ||
          record.serverLaunch.incarnation !== record.incarnation ||
          app.stopRetainedLaunch === undefined
        )
          return yield* new CodexTurnBoundaryUnknown({})
        yield* app.stopRetainedLaunch(record.serverLaunch)
      }
      const stoppedAtMilliseconds = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
      yield* writeToolEffect(
        CodexToolEffectRecord.cases.LimitReached.make({
          runId: record.runId,
          attemptId: record.attemptId,
          threadId: record.threadId,
          turnId: record.turnId,
          itemId: record.itemId,
          incarnation: record.incarnation,
          worktree: record.worktree,
          ...(record.serverLaunch === undefined ? {} : { serverLaunch: record.serverLaunch }),
          startedAtMilliseconds: record.startedAtMilliseconds,
          deadlineMilliseconds: record.deadlineMilliseconds,
          reason: record.reason,
          stopIntentAtMilliseconds: record.stopIntentAtMilliseconds,
          stoppedAtMilliseconds
        })
      )
    })
    const stopToolEffect = Effect.fn("CodexPlannedAttemptExecutor.stopToolEffect")(function* (
      record: Extract<CodexToolEffectRecord, { readonly _tag: "Started" }>,
      reason: "Elapsed" | "Malformed" | "MissingStart" | "ClockReversed"
    ) {
      const stopIntentAtMilliseconds = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
      const intent = CodexToolEffectRecord.cases.StopIntended.make({
        runId: record.runId,
        attemptId: record.attemptId,
        threadId: record.threadId,
        turnId: record.turnId,
        itemId: record.itemId,
        incarnation: record.incarnation,
        worktree: record.worktree,
        ...(app.serverLaunch === undefined ? {} : { serverLaunch: app.serverLaunch }),
        startedAtMilliseconds: record.startedAtMilliseconds,
        deadlineMilliseconds: record.deadlineMilliseconds,
        reason,
        stopIntentAtMilliseconds
      })
      yield* writeToolEffect(intent)
      yield* finishToolEffectStop(intent)
    })

    type LifecycleProjectionOutcome = {
      readonly continueLifecycleObservation: boolean
      readonly projection: PlannedAttemptExecutorProjectionType
      readonly threadId?: CodexThreadId
      readonly turnId?: CodexTurnId
    }

    const projectionOutcome = (
      projection: PlannedAttemptExecutorProjectionType,
      continueLifecycleObservation = false,
      threadId?: CodexThreadId,
      turnId?: CodexTurnId
    ): LifecycleProjectionOutcome => ({
      continueLifecycleObservation,
      projection,
      ...(threadId === undefined ? {} : { threadId }),
      ...(turnId === undefined ? {} : { turnId })
    })

    const projectReconciliation = Effect.fn("CodexPlannedAttemptExecutor.projectReconciliation")(function* (
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexThreadBackedRecord,
      attempt: CodexAttemptContext,
      reconciliation: ThreadReconciliation,
      purpose: PlannedAttemptExecutorObservationPurpose,
      completionHintAuthorized = false
    ) {
      if (reconciliation._tag === "Running") {
        // Recovery need not replay completion notifications for a sealed turn.
        // Only its exact retained association permits paced terminal reconciliation.
        return projectionOutcome(
          exact(running(correlation)),
          record._tag === "Terminal" ||
            record._tag === "ResultRejected" ||
            record._tag === "ResultCorrectionPending" ||
            completionHintAuthorized,
          reconciliation.thread.id,
          reconciliation.turn.id
        )
      }
      if (reconciliation._tag === "Terminal") {
        const outcome = yield* terminalOrRunningOutcome(
          attempt,
          correlation,
          record,
          reconciliation,
          completionHintAuthorized
        )
        let projectedTurnId = reconciliation.turn.id
        if (outcome.report._tag === "ExecutorWorkExecuting") {
          const latest = yield* store.readAttempt(correlation.runId, correlation.attemptId)
          if (
            Option.isSome(latest) &&
            latest.value._tag === "Running" &&
            recordMatchesCorrelation(latest.value, correlation) &&
            latest.value.threadId === reconciliation.thread.id
          )
            projectedTurnId = latest.value.observedTurnId
        }
        if (reconciliation.turn.status === "interrupted" && outcome.report._tag === "ExecutorWorkExecuting") {
          return projectionOutcome(
            unreadable(correlation, "Codex owned turn interrupted; writer custody remains unresolved"),
            outcome.continueLifecycleObservation,
            reconciliation.thread.id,
            reconciliation.turn.id
          )
        }
        // A Begin reconciliation settles the lost public command response
        // before ordinary passive delivery can expose the retained terminal.
        return projectionOutcome(
          exact(isBeginReconciliation(purpose) ? running(correlation) : outcome.report),
          outcome.continueLifecycleObservation,
          reconciliation.thread.id,
          projectedTurnId
        )
      }
      if (reconciliation._tag === "Unresolved")
        return projectionOutcome(unreadable(correlation), false, reconciliation.thread.id)
      return projectionOutcome(
        yield* projectIdleRecord(correlation, record),
        false,
        reconciliation.thread.id,
        reconciliation.turn?.id
      )
    })

    const projectStoredRecord = Effect.fn("CodexPlannedAttemptExecutor.projectStoredRecord")(function* (
      correlation: PlannedAttemptExecutorCorrelation,
      purpose: PlannedAttemptExecutorObservationPurpose,
      completionHintAuthorized = false,
      abortionReadAuthorized = false
    ) {
      if (isBeginReconciliation(purpose)) yield* invalidateBeginProof(correlation)
      const found = yield* store.readAttempt(correlation.runId, correlation.attemptId)
      if (Option.isNone(found)) return projectionOutcome(noReport(correlation))
      const record = found.value
      const observed = PlannedAttemptExecutorCorrelation.make({
        runId: record.correlationRunId,
        attemptId: record.correlationAttemptId
      })
      if (!sameCorrelation(observed, correlation)) return projectionOutcome(foreign(correlation, observed))
      const retainedToolEffects = yield* listToolEffects(correlation)
      const intendedToolStop = retainedToolEffects.find(
        (effect): effect is Extract<CodexToolEffectRecord, { readonly _tag: "StopIntended" }> =>
          effect._tag === "StopIntended"
      )
      if (intendedToolStop !== undefined) {
        yield* finishToolEffectStop(intendedToolStop)
        return projectionOutcome(unreadable(correlation, "Codex tool item limit reached"))
      }
      if (retainedToolEffects.some((effect) => effect._tag === "LimitReached"))
        return projectionOutcome(unreadable(correlation, "Codex tool item limit reached"))
      if (isBeginReconciliation(purpose) && record._tag === "Terminal") {
        return projectionOutcome(exact(running(correlation)))
      }
      const attempt: CodexAttemptContext = {
        attemptId: correlation.attemptId,
        runId: correlation.runId,
        worktree: record.worktree
      }
      if (record._tag === "TurnIntentRecorded") {
        const expired = yield* expiredUnobservedCorrectionReport(correlation, record)
        if (expired !== undefined) {
          const reconciled = yield* Effect.gen(function* () {
            const thread = yield* refreshThreadTurnLedger(yield* app.readThread(record.threadId))
            yield* enforceThreadIdentity(attempt, correlation, record.threadId, thread)
            const owned = ownedTurnForRecord(thread, record)
            if (owned._tag !== "Found" || record.resultCycle === undefined) return expired
            const stop = CodexAttemptRecord.cases.ResultCorrectionStopIntended.make({
              ...record,
              _tag: "ResultCorrectionStopIntended",
              observedTurnId: owned.turn.id,
              resultCycle: record.resultCycle,
              reason: expired.reason
            })
            // This observes ownership only; the expired response is never validated or sealed.
            yield* save(stop)
            return yield* finishResultCorrectionStop(correlation, stop, true)
          }).pipe(Effect.catch(() => Effect.succeed(expired)))
          return projectionOutcome(exact(reconciled))
        }
      }
      if (record._tag === "Running" || record._tag === "TurnObserved") {
        const response = record.resultCycle?.responses.at(lastElementOffset)
        const now = ProviderResultInstantMilliseconds.make(yield* Effect.clockWith((clock) => clock.currentTimeMillis))
        if (response !== undefined && providerResultResponseExpired(response.intent, now)) {
          const report = yield* expireResultCorrection(correlation, record)
          return projectionOutcome(exact(isBeginReconciliation(purpose) ? running(correlation) : report))
        }
      }
      if (record._tag === "ResultCorrectionStopIntended") {
        const report = yield* finishResultCorrectionStop(correlation, record, false)
        return projectionOutcome(exact(isBeginReconciliation(purpose) ? running(correlation) : report))
      }
      if (record._tag === "ResultRejected") {
        const census = yield* observeOwnedActivityByThreadId(record.threadId, correlation)
        if (record.custody._tag === "Stopped" && census._tag !== "Absent")
          return yield* new CodexActivityCensusUnknown({ detail: "retained rejection custody is not freshly proved" })
        const retained = CodexAttemptRecord.cases.ResultRejected.make({
          ...record,
          custody: census._tag === "Absent" ? { _tag: "Stopped" } : { _tag: "Unresolved" }
        })
        yield* save(retained)
        const report = yield* rejectedResultReport(correlation, retained)
        return projectionOutcome(exact(isBeginReconciliation(purpose) ? running(correlation) : report))
      }
      if (isPreTurnBeginRecord(record, purpose)) {
        // An empty allocation intent proves no task turn was authorized, even
        // if its thread/start response or association write was lost. A retained
        // association must first be freshly reconciled; only exact absence may
        // replace it. Each allocation persists its own private intent.
        const association = yield* reconcilePreTurnBegin(attempt, correlation, record)
        return projectionOutcome(yield* issueBeginProof(correlation, association))
      }
      if (!isThreadBackedRecord(record)) return projectionOutcome(noReport(correlation))
      // Exact-notification providers such as Codex cannot treat a fresh thread
      // read from the same app-server as completion authority. A newly launched
      // production server has first reconciled the prior server and all of its
      // token-owned writers absent; its exact terminal read may settle recovery.
      const exactCompletionHintRequired = app.terminalSealPolicy !== "FreshLifecycleMaySeal"
      const priorServerReconciled =
        (record._tag === "Running" ||
          record._tag === "SuspensionInterruptIntended" ||
          record._tag === "SafelySuspended") &&
        app.serverLaunch !== undefined &&
        record.turnStartIncarnation !== app.incarnation
      const terminalReadAuthorized = completionHintAuthorized || priorServerReconciled
      if (
        (record._tag === "Running" || record._tag === "SafelySuspended") &&
        exactCompletionHintRequired &&
        !terminalReadAuthorized &&
        !(abortionReadAuthorized && record._tag === "Running")
      ) {
        // Preserve the durable Safe projection without treating a lifecycle read
        // as completion authority; only Running projects as Executing here.
        const report = record._tag === "SafelySuspended" ? suspended(correlation) : running(correlation)
        return projectionOutcome(exact(report), false, record.threadId, record.observedTurnId)
      }
      const reconciliation = yield* reconcile(attempt, correlation, record)
      if (record._tag === "SuspensionInterruptIntended" && reconciliation._tag !== "Terminal")
        return projectionOutcome(
          unreadable(correlation, "Codex Suspend interruption awaits exact command reconciliation"),
          false,
          record.threadId,
          record.observedTurnId
        )
      // An interruption observed outside Suspend is an aborted owned turn.
      // Suspend itself still reconciles interruption as idle before proving its
      // stopped disposition; changing that command boundary would lose Resume.
      const lifecycleReconciliation =
        (reconciliation._tag === "Idle" || reconciliation._tag === "Running") &&
        reconciliation.turn?.status === "interrupted" &&
        (record._tag === "Running" || (record._tag === "Terminal" && record.terminal._tag === "Failed"))
          ? { ...reconciliation, _tag: "Terminal" as const, turn: reconciliation.turn }
          : reconciliation
      const observedAbortion =
        lifecycleReconciliation._tag === "Terminal" && lifecycleReconciliation.turn.status === "interrupted"
      if (
        record._tag === "Running" &&
        abortionReadAuthorized &&
        !terminalReadAuthorized &&
        exactCompletionHintRequired &&
        !observedAbortion
      ) {
        return projectionOutcome(exact(running(correlation)), false, record.threadId, record.observedTurnId)
      }
      return yield* projectReconciliation(
        correlation,
        record,
        attempt,
        lifecycleReconciliation,
        purpose,
        terminalReadAuthorized || (abortionReadAuthorized && observedAbortion)
      )
    })

    const projectFailure = (
      correlation: PlannedAttemptExecutorCorrelation,
      error: unknown
    ): PlannedAttemptExecutorProjectionType => {
      if (error instanceof ForeignAttemptRecord) return foreign(correlation, error.observed)
      if (error instanceof CodexAppServerFailure) {
        if (error.kind === "Unavailable" || error.kind === "ResponseDeadline" || error.kind === "CircuitOpen") {
          return unavailable(correlation)
        }
        if (error.kind === "CorrelationContradiction" && error.operation === "initialize") {
          return initializationContradiction(correlation, error.detail)
        }
        return unreadable(correlation, `${error._tag} ${error.operation}/${error.kind}: ${error.detail}`)
      }
      if (storeFailure(error)) return unreadable(correlation, `${error._tag}: ${String(error)}`)
      return unreadable(correlation, String(error))
    }

    const logProjectionFailure = (
      correlation: PlannedAttemptExecutorCorrelation,
      purpose: PlannedAttemptExecutorObservationPurpose,
      error: unknown
    ): Effect.Effect<void> =>
      Effect.logError(
        JSON.stringify({
          _tag: "CodexExecutorProjectionFailure",
          attemptId: correlation.attemptId,
          detail:
            error instanceof CodexAppServerFailure
              ? error.detail
              : error instanceof Error
                ? error.message
                : String(error),
          kind:
            error instanceof CodexAppServerFailure
              ? error.kind
              : typeof error === "object" && error !== null && "_tag" in error
                ? String(error._tag)
                : undefined,
          operation: error instanceof CodexAppServerFailure ? error.operation : purpose._tag,
          runId: correlation.runId
        })
      )

    const project = Effect.fn("CodexPlannedAttemptExecutor.project")(function* (
      correlation: PlannedAttemptExecutorCorrelation,
      purpose: PlannedAttemptExecutorObservationPurpose
    ) {
      try {
        return (yield* projectStoredRecord(correlation, purpose)).projection
      } catch (error) {
        const projection = projectFailure(correlation, error)
        yield* logProjectionFailure(correlation, purpose, error)
        return projection
      }
    })

    const projectLifecycle = Effect.fn("CodexPlannedAttemptExecutor.projectLifecycle")(function* (
      correlation: PlannedAttemptExecutorCorrelation,
      allowInitialRunningRecovery = false,
      completionHintAuthorized = false,
      abortionReadAuthorized = false
    ) {
      return yield* projectStoredRecord(
        correlation,
        { _tag: "PassiveLifecycleObservation" },
        completionHintAuthorized,
        abortionReadAuthorized
      ).pipe(
        Effect.catch((error: unknown) =>
          Effect.gen(function* () {
            // Codex can acknowledge turn/start before thread/resume exposes
            // the owned turn in its first census. A durable Running record
            // proves that Dalph already crossed the boundary; keep the
            // lifecycle attachment alive for the existing provider hint so a
            // later exact census can settle it. This is limited to the first
            // attachment read and does not start a timer. Later contradictory
            // reads remain unreadable and fail closed.
            if (allowInitialRunningRecovery && error instanceof CodexTurnCensusPending) {
              const stored = yield* store.readAttempt(correlation.runId, correlation.attemptId).pipe(Effect.result)
              if (
                Result.isSuccess(stored) &&
                Option.isSome(stored.success) &&
                stored.success.value._tag === "Running" &&
                stored.success.value.correlationRunId === correlation.runId &&
                stored.success.value.correlationAttemptId === correlation.attemptId
              ) {
                return projectionOutcome(
                  exact(running(correlation)),
                  false,
                  stored.success.value.threadId,
                  stored.success.value.observedTurnId
                )
              }
            }
            yield* logProjectionFailure(correlation, { _tag: "PassiveLifecycleObservation" }, error)
            return projectionOutcome(projectFailure(correlation, error))
          })
        )
      )
    })

    const replacementResultFromAuthorityFailure = (
      failure: CodexReplacementAuthorityFailure
    ): CodexProviderWorkUnitReplacementResult =>
      failure.kind === "ProviderTemporarilyUnreadable"
        ? CodexProviderWorkUnitReplacementResult.cases.ProviderTemporarilyUnreadable.make({ detail: failure.detail })
        : failure.kind === "TaskWorkSessionAbsent"
          ? CodexProviderWorkUnitReplacementResult.cases.TaskWorkSessionAbsent.make({ detail: failure.detail })
          : failure.kind === "CorrelationConflict"
            ? CodexProviderWorkUnitReplacementResult.cases.CorrelationConflict.make({ detail: failure.detail })
            : CodexProviderWorkUnitReplacementResult.cases.ExclusiveRetainedOwnershipUnproved.make({
                detail: failure.detail
              })

    const replacementResultFromAppFailure = (failure: CodexAppServerFailure): CodexProviderWorkUnitReplacementResult =>
      failure.kind === "NotFound"
        ? CodexProviderWorkUnitReplacementResult.cases.TaskWorkSessionAbsent.make({ detail: failure.detail })
        : failure.kind === "CorrelationContradiction"
          ? CodexProviderWorkUnitReplacementResult.cases.CorrelationConflict.make({ detail: failure.detail })
          : CodexProviderWorkUnitReplacementResult.cases.ProviderTemporarilyUnreadable.make({ detail: failure.detail })

    const replacementLedgerRequestSubjectMatches = (
      ledger: CodexPurgedWorkUnitReplacementLedger,
      request: CodexProviderWorkUnitReplacementRequest
    ): boolean =>
      ledger.requestId === request.requestId && samePlannedTaskAttempt(ledger.plannedAttempt, request.plannedAttempt)

    const replacementRequestSubjectFailure = (
      request: CodexProviderWorkUnitReplacementRequest
    ): ReplacementResult | undefined =>
      /* v8 ignore next -- @preserve The public request Schema rejects this mismatch before the typed service boundary. */
      request.specification.taskId !== request.plannedAttempt.taskId ||
      request.specification.fingerprint !== request.plannedAttempt.taskRevision
        ? CodexProviderWorkUnitReplacementResult.cases.CorrelationConflict.make({
            detail: "replacement request specification does not match its planned attempt"
          })
        : undefined

    type ReplacementLedgerRequestCheck =
      | { readonly _tag: "Valid" }
      | { readonly _tag: "Malformed" }
      | { readonly _tag: "Contradiction" }

    const replacementLedgerRequestCheck = (
      existing: Option.Option<CodexPurgedWorkUnitReplacementLedger>,
      requestDigest: CodexReplacementRequestDigest
    ): ReplacementLedgerRequestCheck => {
      if (Option.isNone(existing)) return { _tag: "Valid" }
      const intent = existing.value.history[1]
      /* v8 ignore next -- @preserve A decoded replacement ledger always retains IntentRecorded at index one. */
      if (intent === undefined || intent._tag !== "IntentRecorded") return { _tag: "Malformed" }
      return intent.requestDigest === requestDigest ? { _tag: "Valid" } : { _tag: "Contradiction" }
    }

    const validateReplacementLedgerRequest = Effect.fn("CodexProviderWorkUnitReplacement.validateLedgerRequest")(
      function* (
        existing: Option.Option<CodexPurgedWorkUnitReplacementLedger>,
        requestDigest: CodexReplacementRequestDigest
      ) {
        const ledgerCheck = replacementLedgerRequestCheck(existing, requestDigest)
        /* v8 ignore next -- @preserve The store decodes the ledger Schema before returning it to this service. */
        if (ledgerCheck._tag === "Malformed") {
          return yield* new CodexReplacementLedgerFailure({
            detail: "replacement ledger has no durable request intent"
          })
        }
        if (ledgerCheck._tag === "Contradiction") {
          return CodexProviderWorkUnitReplacementResult.cases.RequestIdentityReuseContradiction.make({
            detail: "replacement request identity was reused with changed request content"
          })
        }
        return undefined
      }
    )

    const replacementRecordMatchesRequest = (
      request: CodexProviderWorkUnitReplacementRequest,
      record: CodexAttemptRecord
    ): boolean =>
      record.correlationRunId === request.plannedAttempt.runId &&
      record.correlationAttemptId === request.plannedAttempt.attemptId &&
      record.worktree === request.plannedAttempt.worktree &&
      record._tag !== "EmptyPreTurn" &&
      record._tag !== "AssociatedPreTurn"

    type ReplacementPredecessor =
      | { readonly _tag: "Evidence"; readonly evidence: CodexPurgedWorkUnitEvidence }
      | { readonly _tag: "Result"; readonly result: ReplacementResult }

    type ReplacementOwnedRecordIdentity = {
      readonly currentToken: CodexOwnedTurnToken
      readonly observedTurnId: CodexTurnId
      readonly threadId: CodexThreadId
      readonly worktree: WorktreeLocator
    }

    const replacementOwnedRecordIdentity = (record: CodexAttemptRecord): ReplacementOwnedRecordIdentity | undefined => {
      switch (record._tag) {
        case "TurnObserved":
        case "Running":
        case "SafelySuspended":
        case "Terminal":
          return record
        /* v8 ignore next -- @preserve replacementRecordMatchesRequest rejects AssociatedPreTurn before replacementOwnedRecordIdentity is called. */
        case "AssociatedPreTurn":
        /* v8 ignore next -- @preserve replacementRecordMatchesRequest rejects EmptyPreTurn before replacementOwnedRecordIdentity is called. */
        case "EmptyPreTurn":
        case "TurnIntentRecorded":
        case "SuspensionInterruptIntended":
        case "SuspensionStopIntended":
        case "ResultRejected":
        case "ResultCorrectionPending":
        case "ResultCorrectionStopIntended":
          return undefined
      }
    }

    const sameReplacementOwnedIdentity = (
      record: ReplacementOwnedRecordIdentity,
      token: CodexOwnedTurnToken,
      turnId: CodexTurnId
    ): boolean => record.currentToken === token && record.observedTurnId === turnId

    const sameReplacementThreadSubject = (
      record: ReplacementOwnedRecordIdentity,
      evidence: CodexPurgedWorkUnitEvidence
    ): boolean => record.threadId === evidence.threadId && record.worktree === evidence.worktree

    const replacementRecordMatchesLedger = (
      ledger: CodexPurgedWorkUnitReplacementLedger,
      record: CodexAttemptRecord
    ): boolean => {
      const ownedRecord = replacementOwnedRecordIdentity(record)
      if (ownedRecord === undefined) return false
      const purgeEntry = ledger.history[0]
      /* v8 ignore next -- @preserve CodexAttemptStore decodes the replacement-ledger schema, whose history must begin with Purged evidence. */
      if (purgeEntry._tag !== "Purged") return false
      const purge = purgeEntry.evidence
      if (!sameReplacementThreadSubject(ownedRecord, purge)) return false
      const recordIsPredecessor = sameReplacementOwnedIdentity(
        ownedRecord,
        purge.predecessorToken,
        purge.predecessorTurnId
      )
      const observed = ledger.history[4]
      const recordIsReplacement =
        observed?._tag === "TurnObserved" &&
        sameReplacementOwnedIdentity(ownedRecord, observed.replacementToken, observed.replacementTurnId)
      return recordIsPredecessor || recordIsReplacement
    }

    const replacementPredecessorFor = (
      existing: Option.Option<CodexPurgedWorkUnitReplacementLedger>,
      record: CodexAttemptRecord
    ): ReplacementPredecessor => {
      if (Option.isSome(existing)) {
        if (!replacementRecordMatchesLedger(existing.value, record)) {
          return {
            _tag: "Result",
            result: CodexProviderWorkUnitReplacementResult.cases.CorrelationConflict.make({
              detail: "durable replacement purge evidence conflicts with the current private task-work session"
            })
          }
        }
        const purge = existing.value.history[0]
        /* v8 ignore next -- @preserve A decoded replacement ledger always begins with exact Purged evidence. */
        if (purge._tag !== "Purged") {
          return {
            _tag: "Result",
            result: CodexProviderWorkUnitReplacementResult.cases.CorrelationConflict.make({
              detail: "durable replacement history contains no purge evidence"
            })
          }
        }
        return { _tag: "Evidence", evidence: purge.evidence }
      }
      if (
        record._tag === "TurnObserved" ||
        record._tag === "Running" ||
        record._tag === "SuspensionInterruptIntended" ||
        record._tag === "SafelySuspended"
      ) {
        return {
          _tag: "Evidence",
          evidence: CodexPurgedWorkUnitEvidence.make({
            predecessorToken: record.currentToken,
            predecessorTurnId: record.observedTurnId,
            threadId: record.threadId,
            worktree: record.worktree
          })
        }
      }
      return {
        _tag: "Result",
        result: CodexProviderWorkUnitReplacementResult.cases.PurgeUnconfirmed.make({
          detail: "private state contains no previously observed provider work unit to prove as purged"
        })
      }
    }

    const readReplacementAttempt = Effect.fn("CodexProviderWorkUnitReplacement.readAttempt")(function* (
      request: CodexProviderWorkUnitReplacementRequest,
      existing: Option.Option<CodexPurgedWorkUnitReplacementLedger>
    ) {
      const found = yield* store.readAttempt(request.plannedAttempt.runId, request.plannedAttempt.attemptId)
      if (Option.isNone(found)) {
        return {
          _tag: "Result" as const,
          result: CodexProviderWorkUnitReplacementResult.cases.TaskWorkSessionAbsent.make({
            detail: "private task-work session association is absent"
          })
        }
      }
      const record = found.value
      if (!replacementRecordMatchesRequest(request, record)) {
        return {
          _tag: "Result" as const,
          result: CodexProviderWorkUnitReplacementResult.cases.CorrelationConflict.make({
            detail: "private task-work session association conflicts with the replacement request"
          })
        }
      }
      const predecessor = replacementPredecessorFor(existing, record)
      if (predecessor._tag === "Result") return predecessor
      return { _tag: "Ready" as const, predecessor: predecessor.evidence }
    })

    const replacementSealedResult = (
      request: CodexProviderWorkUnitReplacementRequest,
      ledger: CodexPurgedWorkUnitReplacementLedger
    ): ReplacementResult =>
      CodexProviderWorkUnitReplacementResult.cases.Replaced.make({
        correlation: plannedAttemptExecutorCorrelation(request.plannedAttempt),
        operationId: ledger.operationId,
        requestId: ledger.requestId,
        worktree: ledger.plannedAttempt.worktree
      })

    type ReplacementSubjectPreparation =
      | {
          readonly _tag: "Ready"
          readonly existing: Option.Option<CodexPurgedWorkUnitReplacementLedger>
          readonly predecessor: CodexPurgedWorkUnitEvidence
          readonly requestDigest: CodexReplacementRequestDigest
        }
      | { readonly _tag: "Result"; readonly result: ReplacementResult }

    const readReplacementSubject = Effect.fn("CodexProviderWorkUnitReplacement.readSubject")(function* (
      request: CodexProviderWorkUnitReplacementRequest
    ) {
      const requestFailure = replacementRequestSubjectFailure(request)
      /* v8 ignore next -- @preserve The public request Schema establishes this invariant before service admission. */
      if (requestFailure !== undefined) return { _tag: "Result" as const, result: requestFailure }
      const requestDigest = yield* replacementRequestDigest(crypto, request).pipe(
        Effect.mapError(() => new CodexReplacementLedgerFailure({ detail: "could not digest replacement request" }))
      )
      const existing = yield* store.readReplacementLedger(request.requestId)
      const ledgerResult = yield* validateReplacementLedgerRequest(existing, requestDigest)
      if (ledgerResult !== undefined) return { _tag: "Result" as const, result: ledgerResult }
      if (Option.isSome(existing) && !replacementLedgerRequestSubjectMatches(existing.value, request)) {
        return {
          _tag: "Result" as const,
          result: CodexProviderWorkUnitReplacementResult.cases.RequestIdentityReuseContradiction.make({
            detail: "replacement request identity was reused for another retained work-unit subject"
          })
        }
      }
      const attempt = yield* readReplacementAttempt(request, existing)
      if (attempt._tag === "Result") return attempt
      if (Option.isSome(existing) && replacementLedgerHasPhase(existing.value, "Sealed")) {
        return { _tag: "Result" as const, result: replacementSealedResult(request, existing.value) }
      }
      return { _tag: "Ready" as const, existing, predecessor: attempt.predecessor, requestDigest }
    })

    const appendReplacementEntry = Effect.fn("CodexProviderWorkUnitReplacement.appendEntry")(function* (
      ledger: CodexPurgedWorkUnitReplacementLedger,
      entry: CodexReplacementHistoryEntry
    ) {
      const appended = appendCodexReplacementHistory(ledger, entry)
      /* v8 ignore next -- @preserve Callers append only the single phase admitted by the decoded ledger's current phase. */
      if (appended._tag === "Contradiction") {
        return yield* new CodexReplacementLedgerFailure({ detail: appended.detail })
      }
      yield* store.appendReplacementLedger(appended.ledger)
      return appended.ledger
    })

    const ensureReplacementLedger = Effect.fn("CodexProviderWorkUnitReplacement.ensureLedger")(function* (
      request: CodexProviderWorkUnitReplacementRequest,
      subject: Extract<ReplacementSubjectPreparation, { readonly _tag: "Ready" }>
    ) {
      if (Option.isSome(subject.existing)) return subject.existing.value
      const operationUuid = yield* crypto.randomUUIDv4.pipe(
        /* v8 ignore next -- @preserve Crypto.randomUUIDv4 has an uninhabited error channel in configured services. */
        Effect.mapError(
          () => new CodexReplacementLedgerFailure({ detail: "could not allocate replacement operation identity" })
        )
      )
      const operationId = CodexReplacementOperationId.make(operationUuid)
      const ledger = CodexPurgedWorkUnitReplacementLedger.make({
        history: [
          CodexReplacementHistoryEntry.cases.Purged.make({ evidence: subject.predecessor }),
          CodexReplacementHistoryEntry.cases.IntentRecorded.make({
            operationId,
            requestDigest: subject.requestDigest,
            requestId: request.requestId
          })
        ],
        operationId,
        plannedAttempt: request.plannedAttempt,
        requestId: request.requestId
      })
      yield* store.appendReplacementLedger(ledger)
      return ledger
    })

    type ReplacementPendingPhase = "IntentRecorded" | "TurnIntentRecorded" | "TurnBoundaryCrossingBegan"
    const replacementTurnIntentToken = (
      entry: CodexReplacementHistoryEntry | undefined
    ): CodexOwnedTurnToken | undefined =>
      /* v8 ignore next -- @preserve The decoded phase tag selects this helper only for its matching history entry. */
      entry?._tag === "TurnIntentRecorded" ? entry.replacementToken : undefined

    const replacementTurnBoundaryToken = (
      entry: CodexReplacementHistoryEntry | undefined
    ): CodexOwnedTurnToken | undefined =>
      /* v8 ignore next -- @preserve The decoded phase tag selects this helper only for its matching history entry. */
      entry?._tag === "TurnBoundaryCrossingBegan" ? entry.replacementToken : undefined

    const replacementTurnObservedToken = (
      entry: CodexReplacementHistoryEntry | undefined
    ): CodexOwnedTurnToken | undefined =>
      /* v8 ignore next -- @preserve The decoded phase tag selects this helper only for its matching history entry. */
      entry?._tag === "TurnObserved" ? entry.replacementToken : undefined

    const replacementStoredToken = (
      ledger: CodexPurgedWorkUnitReplacementLedger,
      phase: CodexReplacementHistoryEntry["_tag"] | undefined
    ): CodexOwnedTurnToken | undefined => {
      const entry = ledger.history.at(lastElementOffset)
      if (phase === "TurnIntentRecorded") return replacementTurnIntentToken(entry)
      if (phase === "TurnBoundaryCrossingBegan") return replacementTurnBoundaryToken(entry)
      // Intent is handled before token recovery, Sealed returns earlier, and
      // decoded ledgers cannot end at Purged or undefined. The remaining
      // admitted phase is TurnObserved; its helper still fails closed on a
      // contradictory entry.
      return replacementTurnObservedToken(entry)
    }

    /* v8 ignore next -- @preserve Decoded ledger phases are exhaustively routed before this defensive diagnostic helper. */
    const replacementInvalidPhaseDetail = (phase: CodexReplacementHistoryEntry["_tag"] | undefined): string => {
      switch (phase) {
        case "TurnIntentRecorded":
          return "invalid replacement turn intent"
        case "TurnBoundaryCrossingBegan":
          return "invalid replacement turn call"
        case "TurnObserved":
          return "invalid replacement observation"
        case undefined:
        case "IntentRecorded":
        case "Purged":
        case "Sealed":
          return "invalid replacement ledger phase"
      }
    }

    const prepareObservedReplacementPhase = Effect.fn("CodexProviderWorkUnitReplacement.prepareObservedPhase")(
      function* (
        ledger: CodexPurgedWorkUnitReplacementLedger,
        thread: CodexThreadSnapshot,
        replacementToken: CodexOwnedTurnToken
      ) {
        const currentPhase = ledger.history.at(lastElementOffset)?._tag
        const observed = ledger.history.at(lastElementOffset)
        /* v8 ignore next -- @preserve This helper is selected only after preparePhase narrows the decoded last entry to TurnObserved. */
        if (observed === undefined || observed._tag !== "TurnObserved") {
          return yield* new CodexReplacementLedgerFailure({ detail: replacementInvalidPhaseDetail(currentPhase) })
        }
        const matchingTurn = thread.turns.find(
          (turn) => turn.id === observed.replacementTurnId && turn.ownedTurnToken === observed.replacementToken
        )
        if (matchingTurn === undefined) {
          return {
            _tag: "Result" as const,
            result: CodexProviderWorkUnitReplacementResult.cases.ProviderTemporarilyUnreadable.make({
              detail: "observed replacement turn is not readable after process loss"
            })
          }
        }
        return { _tag: "Observed" as const, ledger, replacementToken, turn: matchingTurn }
      }
    )

    const prepareReplacementPhase = Effect.fn("CodexProviderWorkUnitReplacement.preparePhase")(function* (
      ledger: CodexPurgedWorkUnitReplacementLedger,
      thread: CodexThreadSnapshot
    ) {
      const currentPhase = ledger.history.at(lastElementOffset)?._tag
      if (currentPhase === "IntentRecorded") {
        // Persist the replacement token before any provider turn boundary.
        const tokenUuid = yield* crypto.randomUUIDv4.pipe(
          /* v8 ignore next -- @preserve Crypto.randomUUIDv4 has an uninhabited error channel in configured services. */
          Effect.mapError(
            () => new CodexReplacementLedgerFailure({ detail: "could not allocate replacement turn token" })
          )
        )
        const replacementToken = CodexOwnedTurnToken.make(tokenUuid)
        const nextLedger = yield* appendReplacementEntry(
          ledger,
          CodexReplacementHistoryEntry.cases.TurnIntentRecorded.make({
            operationId: ledger.operationId,
            replacementToken
          })
        )
        return { _tag: "Ready" as const, phase: currentPhase, ledger: nextLedger, replacementToken }
      }
      const replacementToken = replacementStoredToken(ledger, currentPhase)
      /* v8 ignore next -- @preserve Every decoded pending or observed phase carries the exact replacement token. */
      if (replacementToken === undefined) {
        return yield* new CodexReplacementLedgerFailure({ detail: replacementInvalidPhaseDetail(currentPhase) })
      }
      if (currentPhase === "TurnIntentRecorded" || currentPhase === "TurnBoundaryCrossingBegan") {
        return { _tag: "Ready" as const, phase: currentPhase, ledger, replacementToken }
      }
      return yield* prepareObservedReplacementPhase(ledger, thread, replacementToken)
    })

    const finishReplacement = Effect.fn("CodexProviderWorkUnitReplacement.finishReplacement")(function* (
      request: CodexProviderWorkUnitReplacementRequest,
      ledger: CodexPurgedWorkUnitReplacementLedger,
      turn: CodexTurnSnapshot,
      predecessor: CodexPurgedWorkUnitEvidence,
      replacementToken: CodexOwnedTurnToken
    ) {
      const checked = replacementTurnCheck(request, turn, predecessor, replacementToken)
      if (checked._tag === "Rejected") return checked.result
      const correlatedTurn = checked.turn
      const observedEntry = CodexReplacementHistoryEntry.cases.TurnObserved.make({
        operationId: ledger.operationId,
        replacementToken,
        replacementTurnId: correlatedTurn.id
      })
      const observedLedger =
        replacementLedgerHasPhase(ledger, "TurnObserved") || replacementLedgerHasPhase(ledger, "Sealed")
          ? ledger
          : yield* appendReplacementEntry(ledger, observedEntry)
      const prior = yield* store.readAttempt(request.plannedAttempt.runId, request.plannedAttempt.attemptId)
      const admittedPolicy =
        Option.isSome(prior) && hasOwnedTurnRecord(prior.value)
          ? (prior.value.toolEffectPolicy ?? toolEffectPolicy)
          : toolEffectPolicy
      const observed = yield* observedRecordFor(
        request.plannedAttempt,
        predecessor.threadId,
        replacementToken,
        correlatedTurn.id,
        null,
        undefined,
        undefined,
        admittedPolicy,
        Option.isSome(prior) && hasOwnedTurnRecord(prior.value) ? prior.value.resultCycle : undefined
      ).pipe(
        Effect.mapError(
          () =>
            new CodexReplacementLedgerFailure({
              detail: "replacement turn does not match retained result-cycle ownership"
            })
        )
      )
      yield* save(observed)
      const sealedLedger = replacementLedgerHasPhase(observedLedger, "Sealed")
        ? /* v8 ignore next -- @preserve Sealed ledgers return from readSubject, so finishReplacement only appends a new seal. */
          observedLedger
        : yield* appendReplacementEntry(
            observedLedger,
            CodexReplacementHistoryEntry.cases.Sealed.make({
              operationId: ledger.operationId,
              replacementToken,
              replacementTurnId: correlatedTurn.id
            })
          )
      return CodexProviderWorkUnitReplacementResult.cases.Replaced.make({
        correlation: plannedAttemptExecutorCorrelation(request.plannedAttempt),
        operationId: sealedLedger.operationId,
        requestId: request.requestId,
        worktree: predecessor.worktree
      })
    })

    const replacementThreadObservation = Effect.fn("CodexProviderWorkUnitReplacement.observeThread")(function* (
      request: CodexProviderWorkUnitReplacementRequest,
      predecessor: CodexPurgedWorkUnitEvidence
    ) {
      // Rehydrate S1 before reading it so process loss does not turn a valid
      // persisted session into a false absence or unreadable observation.
      const read = yield* app.resumeThread(predecessor.threadId, request.plannedAttempt.worktree).pipe(Effect.result)
      if (Result.isFailure(read)) {
        return { _tag: "Result" as const, result: replacementResultFromAppFailure(read.failure) }
      }
      const thread = read.success
      const failure = replacementThreadFactFailure(request, predecessor, thread)
      if (failure !== undefined) return { _tag: "Result" as const, result: failure }
      return { _tag: "Thread" as const, thread }
    })

    const replacementActivityObservation = Effect.fn("CodexProviderWorkUnitReplacement.observeActivity")(function* (
      thread: CodexThreadSnapshot,
      replacementToken: CodexOwnedTurnToken | undefined,
      allowMatchingReplacementTurn: boolean
    ) {
      const census = yield* app.listBackgroundTerminals(thread.id).pipe(
        Effect.flatMap((terminals) => activityCensus.observe(thread, terminals, "PlannedAttempt")),
        Effect.result
      )
      if (Result.isFailure(census)) {
        return {
          _tag: "Result" as const,
          result: CodexProviderWorkUnitReplacementResult.cases.ExclusiveRetainedOwnershipUnproved.make({
            detail: "fresh owned-activity census was unreadable"
          })
        }
      }
      const failure = replacementActivityFailure(census.success, thread, replacementToken, allowMatchingReplacementTurn)
      if (failure !== undefined) return { _tag: "Result" as const, result: failure }
      return { _tag: "Ready" as const }
    })

    const replacementAuthorityObservation = Effect.fn("CodexProviderWorkUnitReplacement.observeAuthority")(function* (
      request: CodexProviderWorkUnitReplacementRequest,
      thread: CodexThreadSnapshot,
      replacementToken: CodexOwnedTurnToken | undefined,
      allowMatchingReplacementTurn: boolean
    ) {
      if (Option.isNone(replacementAuthority)) {
        return {
          _tag: "Result" as const,
          result: CodexProviderWorkUnitReplacementResult.cases.ExclusiveRetainedOwnershipUnproved.make({
            detail: "no fresh replacement authority adapter is configured"
          })
        }
      }
      const observed = yield* replacementAuthority.value.observe(request).pipe(Effect.result)
      if (Result.isFailure(observed)) {
        return { _tag: "Result" as const, result: replacementResultFromAuthorityFailure(observed.failure) }
      }
      const proof = observed.success
      const failure = replacementAuthorityProofFailure(request, proof)
      if (failure !== undefined) {
        return {
          _tag: "Result" as const,
          result: CodexProviderWorkUnitReplacementResult.cases.ExclusiveRetainedOwnershipUnproved.make({
            detail: failure
          })
        }
      }
      const activity = yield* replacementActivityObservation(thread, replacementToken, allowMatchingReplacementTurn)
      if (activity._tag === "Result") return activity
      return { _tag: "Proof" as const, proof }
    })

    type ReplacementExecutionPreparation =
      | {
          readonly _tag: "Ready"
          readonly subject: Extract<ReplacementSubjectPreparation, { readonly _tag: "Ready" }>
          readonly thread: CodexThreadSnapshot
          readonly phase: CodexReplacementHistoryEntry["_tag"] | undefined
          readonly authority: CodexReplacementAuthorityProof
        }
      | { readonly _tag: "Result"; readonly result: ReplacementResult }

    const replacementExistingAuthorityState = (
      existing: Option.Option<CodexPurgedWorkUnitReplacementLedger>
    ): {
      readonly phase: CodexReplacementHistoryEntry["_tag"] | undefined
      readonly replacementToken: CodexOwnedTurnToken | undefined
      readonly allowMatchingReplacementTurn: boolean
    } => {
      if (Option.isNone(existing)) {
        return { phase: undefined, replacementToken: undefined, allowMatchingReplacementTurn: false }
      }
      const phase = existing.value.history.at(lastElementOffset)?._tag
      const allowMatchingReplacementTurn = phase === "TurnBoundaryCrossingBegan" || phase === "TurnObserved"
      return {
        phase,
        replacementToken: allowMatchingReplacementTurn ? replacementStoredToken(existing.value, phase) : undefined,
        allowMatchingReplacementTurn
      }
    }

    const prepareReplacementExecution = Effect.fn("CodexProviderWorkUnitReplacement.prepareExecution")(function* (
      request: CodexProviderWorkUnitReplacementRequest,
      subject: Extract<ReplacementSubjectPreparation, { readonly _tag: "Ready" }>
    ) {
      const threadObservation = yield* replacementThreadObservation(request, subject.predecessor)
      if (threadObservation._tag === "Result") return threadObservation
      const recovery = replacementExistingAuthorityState(subject.existing)
      const authority = yield* replacementAuthorityObservation(
        request,
        threadObservation.thread,
        recovery.replacementToken,
        recovery.allowMatchingReplacementTurn
      )
      if (authority._tag === "Result") return authority
      return {
        _tag: "Ready" as const,
        subject,
        thread: threadObservation.thread,
        phase: recovery.phase,
        authority: authority.proof
      }
    })

    const confirmReplacementAuthority = Effect.fn("CodexProviderWorkUnitReplacement.confirmAuthority")(function* (
      request: CodexProviderWorkUnitReplacementRequest,
      prepared: Extract<ReplacementExecutionPreparation, { readonly _tag: "Ready" }>,
      replacementToken: CodexOwnedTurnToken
    ) {
      const refreshed = yield* replacementAuthorityObservation(
        request,
        prepared.thread,
        replacementToken,
        prepared.phase === "TurnBoundaryCrossingBegan"
      )
      if (refreshed._tag === "Result") return refreshed
      if (!sameReplacementGitObservation(prepared.authority, refreshed.proof)) {
        return {
          _tag: "Result" as const,
          result: CodexProviderWorkUnitReplacementResult.cases.ExclusiveRetainedOwnershipUnproved.make({
            detail: "fresh Git authority changed before the replacement turn boundary"
          })
        }
      }
      return { _tag: "Ready" as const }
    })

    const reconcileReplacementCall = Effect.fn("CodexProviderWorkUnitReplacement.reconcileCall")(function* (
      request: CodexProviderWorkUnitReplacementRequest,
      ledger: CodexPurgedWorkUnitReplacementLedger,
      thread: CodexThreadSnapshot,
      predecessor: CodexPurgedWorkUnitEvidence,
      replacementToken: CodexOwnedTurnToken
    ) {
      const calledTurn = thread.turns.find((turn) => turn.ownedTurnToken === replacementToken)
      if (calledTurn === undefined) {
        return CodexProviderWorkUnitReplacementResult.cases.ProviderTemporarilyUnreadable.make({
          detail: "replacement turn call has no readable matching provider turn"
        })
      }
      return yield* finishReplacement(request, ledger, calledTurn, predecessor, replacementToken)
    })

    const startReplacementTurn = Effect.fn("CodexProviderWorkUnitReplacement.startTurn")(function* (
      request: CodexProviderWorkUnitReplacementRequest,
      ledger: CodexPurgedWorkUnitReplacementLedger,
      predecessor: CodexPurgedWorkUnitEvidence,
      replacementToken: CodexOwnedTurnToken
    ) {
      const started = yield* app
        .startTurn(
          predecessor.threadId,
          request.plannedAttempt.worktree,
          replacementTaskTurnText(
            request.plannedAttempt,
            request.specification,
            predecessor,
            ledger.operationId,
            taskInstructions
          ),
          replacementToken
        )
        .pipe(Effect.result)
      if (Result.isFailure(started)) {
        const after = yield* replacementThreadObservation(request, predecessor)
        if (after._tag === "Result") return after.result
        const matchingTurn = after.thread.turns.find((turn) => turn.ownedTurnToken === replacementToken)
        if (matchingTurn === undefined) {
          return CodexProviderWorkUnitReplacementResult.cases.ProviderTemporarilyUnreadable.make({
            detail: "replacement turn/start crossed an ambiguous provider boundary"
          })
        }
        return yield* finishReplacement(request, ledger, matchingTurn, predecessor, replacementToken)
      }
      return yield* finishReplacement(request, ledger, started.success, predecessor, replacementToken)
    })

    const continueReplacement = Effect.fn("CodexProviderWorkUnitReplacement.continue")(function* (
      request: CodexProviderWorkUnitReplacementRequest,
      prepared: Extract<ReplacementExecutionPreparation, { readonly _tag: "Ready" }>,
      phase: ReplacementPendingPhase,
      ledger: CodexPurgedWorkUnitReplacementLedger,
      replacementToken: CodexOwnedTurnToken
    ) {
      if (phase === "TurnIntentRecorded") {
        /* v8 ignore next -- @preserve Pre-boundary activity admission rejects an already-live turn before this continuation path. */
        const existingTurn = prepared.thread.turns.find((turn) => turn.ownedTurnToken === replacementToken)
        /* v8 ignore next -- @preserve Covered by the preceding admission invariant; a TurnIntent marker cannot own live provider work. */
        if (existingTurn !== undefined) {
          return yield* finishReplacement(request, ledger, existingTurn, prepared.subject.predecessor, replacementToken)
        }
      }
      let nextLedger = ledger
      if (phase === "IntentRecorded" || phase === "TurnIntentRecorded") {
        // This durable marker is the final point before the provider call. A
        // recovery from it may only reconcile the token; it must never retry
        // turn/start blindly.
        nextLedger = yield* appendReplacementEntry(
          ledger,
          CodexReplacementHistoryEntry.cases.TurnBoundaryCrossingBegan.make({
            operationId: ledger.operationId,
            replacementToken
          })
        )
      }
      if (phase === "TurnBoundaryCrossingBegan") {
        return yield* reconcileReplacementCall(
          request,
          nextLedger,
          prepared.thread,
          prepared.subject.predecessor,
          replacementToken
        )
      }
      return yield* startReplacementTurn(request, nextLedger, prepared.subject.predecessor, replacementToken)
    })

    const replacement = Effect.fn("CodexProviderWorkUnitReplacement.replace")(function* (
      request: CodexProviderWorkUnitReplacementRequest
    ) {
      const subject = yield* readReplacementSubject(request)
      if (subject._tag === "Result") return subject.result
      const prepared = yield* prepareReplacementExecution(request, subject)
      if (prepared._tag === "Result") return prepared.result
      const ledger = yield* ensureReplacementLedger(request, prepared.subject)
      const phase = yield* prepareReplacementPhase(ledger, prepared.thread)
      if (phase._tag === "Result") return phase.result
      if (phase._tag === "Observed") {
        return yield* finishReplacement(
          request,
          phase.ledger,
          phase.turn,
          prepared.subject.predecessor,
          phase.replacementToken
        )
      }
      const authority = yield* confirmReplacementAuthority(request, prepared, phase.replacementToken)
      if (authority._tag === "Result") return authority.result
      return yield* continueReplacement(request, prepared, phase.phase, phase.ledger, phase.replacementToken)
    })

    const continueRejectedResult = Effect.fn("CodexPlannedAttemptExecutor.continueRejectedResult")(function* (
      request: PlannedAttemptExecutorRequest,
      input: PlannedAttemptResultRecoveryAuthorization
    ) {
      const authorization = yield* Schema.decodeUnknownEffect(PlannedAttemptResultRecoveryAuthorization, {
        onExcessProperty: "error"
      })(input)
      const attempt = request.plannedAttempt
      const correlation = plannedAttemptExecutorCorrelation(attempt)
      if (!sameCorrelation(authorization.correlation, correlation)) return yield* new CodexTurnBoundaryUnknown({})
      const record = yield* readSuspensionRecord(correlation)
      if (record.worktree !== attempt.worktree) return yield* new CodexThreadMismatch({})
      const history = "resultRecoveryHistory" in record ? (record.resultRecoveryHistory ?? []) : []
      const retained = history.find(({ authorizationId }) => authorizationId.nonce === authorization.nonce)
      if (retained !== undefined) {
        if (
          retained.authorizationId.runId !== correlation.runId ||
          retained.authorizationId.attemptId !== correlation.attemptId
        )
          return yield* new CodexTurnBoundaryUnknown({})
        // An ambiguous turn/start is observed under its exact retained token. Never resend it.
        if (record._tag === "TurnIntentRecorded") return yield* reconcileAfterTurnBoundary(attempt, correlation, record)
        if (record._tag === "ResultRejected") return yield* rejectedResultReport(correlation, record)
        const current = yield* reconcile(attempt, correlation, record)
        if (current._tag === "Terminal") return yield* terminalOrRunning(attempt, correlation, record, current)
        if (current._tag === "Running") return running(correlation)
        return yield* new CodexTurnBoundaryUnknown({})
      }
      if (
        record._tag !== "ResultRejected" ||
        record.custody._tag !== "Stopped" ||
        record.resultCycle.plannedBaseSha !== attempt.baseSha ||
        store.writeResultRecovery === undefined
      )
        return yield* new CodexTurnBoundaryUnknown({})
      const current = yield* reconcile(attempt, correlation, record)
      if (current._tag !== "Terminal" && current._tag !== "Idle") return yield* new CodexTurnBoundaryUnknown({})
      const recoveryCensus = yield* observeOwnedActivityByThreadId(record.threadId, correlation)
      if (recoveryCensus._tag !== "Absent")
        return yield* new CodexActivityCensusUnknown({
          detail: `retained result recovery requires freshly stopped exact writers: ${recoveryCensus._tag === "ExactLive" ? recoveryCensus.activities.map((activity) => activity._tag).join(", ") : recoveryCensus.detail}`
        })
      const token = yield* freshOwnedTurnToken
      const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
      const cycle = yield* Schema.decodeUnknownEffect(ProviderResultCycle)({
        cycleId: token,
        plannedBaseSha: attempt.baseSha,
        responses: [{ _tag: "RequestIntended", intent: { _tag: "Initial", ordinal: 1, token, intendedAt: now } }]
      })
      const recovery = yield* Schema.decodeUnknownEffect(ProviderResultRecoveryRecord)({
        authorizationId: { nonce: authorization.nonce, runId: correlation.runId, attemptId: correlation.attemptId },
        predecessor: record.resultCycle,
        successorInitial: cycle
      })
      const policy = record.toolEffectPolicy ?? bindCodexToolEffectPolicy(toolEffectPolicy, attempt.worktree)
      const intent = CodexAttemptRecord.cases.TurnIntentRecorded.make({
        ...intentRecordFor(attempt, record.threadId, token, record.observedTurnId, now, app.incarnation, policy, cycle),
        resultRecoveryHistory: [...history, recovery]
      })
      yield* store.writeResultRecovery(intent, recovery)
      yield* completionSubscriptionForTurnStart(correlation, record.threadId)
      const started = yield* startTurnAcrossBoundary(
        attempt,
        taskTurnText(attempt, request.specification, taskInstructions),
        correlation,
        intent
      )
      return yield* finishStartedTurn(
        attempt,
        correlation,
        intent,
        record.observedTurnId,
        token,
        now,
        app.incarnation,
        policy,
        started,
        cycle
      )
    })

    const executor: PlannedAttemptExecutorService = {
      observeWriterCustody: (plannedAttempt) => {
        const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
        return gateFor(correlation).pipe(
          Effect.flatMap((gate) =>
            gate.withPermit(
              Effect.gen(function* () {
                const found = yield* store.readAttempt(correlation.runId, correlation.attemptId)
                if (Option.isNone(found))
                  return PlannedAttemptExecutorWriterCustody.cases.Unresolved.make({
                    plannedAttempt,
                    detail: "retained executor record is unavailable"
                  })
                const record = found.value
                if (
                  record._tag !== "Terminal" ||
                  record.worktree !== plannedAttempt.worktree ||
                  record.correlationRunId !== correlation.runId ||
                  record.correlationAttemptId !== correlation.attemptId
                )
                  return PlannedAttemptExecutorWriterCustody.cases.Unresolved.make({
                    plannedAttempt,
                    detail: "exact retained terminal ownership is unproved"
                  })
                const thread = yield* app.readThread(record.threadId)
                yield* enforceThreadIdentity(
                  { attemptId: correlation.attemptId, runId: correlation.runId, worktree: record.worktree },
                  correlation,
                  record.threadId,
                  thread
                )
                const owned = ownedTurnForRecord(yield* refreshThreadTurnLedger(thread), record)
                if (owned._tag !== "Found" || owned.turn.status === "inProgress")
                  return PlannedAttemptExecutorWriterCustody.cases.Unresolved.make({
                    plannedAttempt,
                    detail: "retained terminal turn is unavailable or executing"
                  })
                const census = yield* observeOwnedActivityByThreadId(record.threadId, correlation)
                return census._tag === "Absent"
                  ? PlannedAttemptExecutorWriterCustody.cases.Stopped.make({ plannedAttempt })
                  : PlannedAttemptExecutorWriterCustody.cases.Unresolved.make({
                      plannedAttempt,
                      detail: "retained executor writers are live or unproved"
                    })
              })
            )
          ),
          Effect.catch(() =>
            Effect.succeed(
              PlannedAttemptExecutorWriterCustody.cases.Unresolved.make({
                plannedAttempt,
                detail: "execution-substrate custody observation is unavailable"
              })
            )
          )
        )
      },
      observe: (correlation, purpose) =>
        (isBeginReconciliation(purpose)
          ? gateFor(correlation).pipe(Effect.flatMap((gate) => gate.withPermit(project(correlation, purpose))))
          : project(correlation, purpose)
        ).pipe(
          Effect.catch((error: unknown) =>
            logProjectionFailure(correlation, purpose, error).pipe(
              Effect.andThen(Effect.succeed(projectFailure(correlation, error)))
            )
          )
        ),
      begin: (request, delivery) => {
        const correlation = plannedAttemptExecutorCorrelation(request.plannedAttempt)
        return gateFor(correlation).pipe(
          Effect.flatMap((gate) => gate.withPermit(begin(request, delivery))),
          Effect.catch((error: unknown) =>
            error instanceof ForeignAttemptRecord ? Effect.succeed(foreignReport(error.observed)) : Effect.fail(error)
          ),
          Effect.mapError((error) => preserveCommandFailure("Begin", correlation, error))
        )
      },
      requestSuspension: (attempt) => {
        const correlation = plannedAttemptExecutorCorrelation(attempt)
        return gateFor(correlation).pipe(
          Effect.flatMap((gate) =>
            gate.withPermit(invalidateBeginProof(correlation).pipe(Effect.andThen(suspend(attempt))))
          ),
          Effect.catch((error: unknown) =>
            error instanceof ForeignAttemptRecord ? Effect.succeed(foreignReport(error.observed)) : Effect.fail(error)
          ),
          Effect.mapError((error) => preserveCommandFailure("Suspend", correlation, error))
        )
      },
      continueRejectedResult: (request, authorization) => {
        const correlation = plannedAttemptExecutorCorrelation(request.plannedAttempt)
        return gateFor(correlation).pipe(
          Effect.flatMap((gate) => gate.withPermit(continueRejectedResult(request, authorization))),
          Effect.mapError((error) => preserveCommandFailure("ContinueRejectedResult", correlation, error))
        )
      },
      resume: (request) => {
        const correlation = plannedAttemptExecutorCorrelation(request.plannedAttempt)
        return gateFor(correlation).pipe(
          Effect.flatMap((gate) =>
            gate.withPermit(invalidateBeginProof(correlation).pipe(Effect.andThen(resume(request))))
          ),
          Effect.catch((error: unknown) =>
            error instanceof ForeignAttemptRecord ? Effect.succeed(foreignReport(error.observed)) : Effect.fail(error)
          ),
          Effect.mapError((error) => preserveCommandFailure("Resume", correlation, error))
        )
      }
    }
    const replacementService: CodexProviderWorkUnitReplacementService = {
      replacePurgedProviderWorkUnit: (request) => {
        const correlation = plannedAttemptExecutorCorrelation(request.plannedAttempt)
        return gateFor(correlation).pipe(
          Effect.flatMap((gate) =>
            gate.withPermit(invalidateBeginProof(correlation).pipe(Effect.andThen(replacement(request))))
          )
        )
      }
    }
    const lifecycleObservation = PlannedAttemptExecutorLifecycleObservation.of({
      attach: (correlation) =>
        Effect.gen(function* () {
          const attachmentScope = yield* Scope.make()
          yield* Effect.addFinalizer((exit) => Scope.close(attachmentScope, exit))
          const projectionGate = yield* Semaphore.make(1)
          const attemptGate = yield* gateFor(correlation)
          const lifecycleReadOrdinal = yield* Ref.make(0)
          const lifecycleHintOrdinal = yield* Ref.make(0)
          const latestLifecycleOutcome = yield* Ref.make<LifecycleProjectionOutcome | undefined>(undefined)
          const matchingCompletionHintObserved = yield* Ref.make(false)
          const closed = yield* Deferred.make<void>()
          const privateRecord = yield* store.readAttempt(correlation.runId, correlation.attemptId).pipe(Effect.result)
          const retainedThreadId =
            Result.isSuccess(privateRecord) &&
            Option.isSome(privateRecord.success) &&
            recordMatchesCorrelation(privateRecord.success.value, correlation) &&
            isThreadBackedRecord(privateRecord.success.value)
              ? privateRecord.success.value.threadId
              : undefined
          const retainedTurnId =
            Result.isSuccess(privateRecord) &&
            Option.isSome(privateRecord.success) &&
            recordMatchesCorrelation(privateRecord.success.value, correlation) &&
            (privateRecord.success.value._tag === "Running" ||
              privateRecord.success.value._tag === "SuspensionInterruptIntended" ||
              privateRecord.success.value._tag === "SafelySuspended" ||
              privateRecord.success.value._tag === "Terminal")
              ? privateRecord.success.value.observedTurnId
              : undefined
          const turnSubscription: TurnCompletionSubscription =
            retainedThreadId === undefined
              ? {
                  close: Effect.void,
                  stream: Stream.fromIterable<CodexTurnCompletedHint>([]),
                  threadIdleHints: Stream.empty,
                  toolEffects: Stream.fromIterable<CodexToolEffectNotification>([]),
                  expectTurnId: (_turnId: CodexTurnId) => Effect.void
                }
              : yield* takeTurnCompletionSubscription(correlation, retainedThreadId, retainedTurnId, attachmentScope)
          const turnHints = turnSubscription.stream
          const activityHints = yield* app.attachOwnedActivityHints.pipe(
            Effect.provideService(Scope.Scope, attachmentScope)
          )
          const protocolFailures =
            app.attachProtocolFailures === undefined
              ? Stream.empty
              : yield* app.attachProtocolFailures.pipe(Effect.provideService(Scope.Scope, attachmentScope))
          const lastMissingStartScanAt = yield* Ref.make<number | undefined>(undefined)
          const toolEffectMonotonicStarts = yield* Ref.make<ReadonlyMap<string, bigint>>(new Map())
          const toolObservationStopped = yield* Deferred.make<void>()
          const toolIdentityMatches = (item: CodexToolEffectNotification): boolean =>
            retainedThreadId !== undefined &&
            retainedTurnId !== undefined &&
            item.threadId === retainedThreadId &&
            item.turnId === retainedTurnId
          const toolEffectGate = yield* Semaphore.make(1)
          const toolLimitProjection = () => projectionOutcome(unreadable(correlation, "Codex tool item limit reached"))
          const observeToolEffect = (item: CodexToolEffectNotification) =>
            Effect.gen(function* () {
              if (!toolIdentityMatches(item) || retainedTurnId === undefined || retainedThreadId === undefined)
                return undefined
              const itemId = CodexToolItemId.make(item.itemId)
              const found = yield* readToolEffect(correlation, retainedTurnId, itemId)
              const retained = Option.isSome(found) ? found.value : undefined
              if (item.phase === "Malformed") {
                if (retained?._tag === "Completed" || retained?._tag === "LimitReached") return undefined
                if (retained?._tag === "StopIntended") {
                  yield* finishToolEffectStop(retained)
                  return toolLimitProjection()
                }
                if (Result.isFailure(privateRecord) || Option.isNone(privateRecord.success))
                  return toolLimitProjection()
                const owned = privateRecord.success.value
                const started =
                  retained?._tag === "Started"
                    ? retained
                    : CodexToolEffectRecord.cases.Started.make({
                        runId: correlation.runId,
                        attemptId: correlation.attemptId,
                        threadId: retainedThreadId,
                        turnId: retainedTurnId,
                        itemId,
                        incarnation: app.incarnation,
                        worktree: owned.worktree,
                        startedAtMilliseconds: hasOwnedTurnRecord(owned)
                          ? (owned.turnStartedAtMilliseconds ?? item.observedAtMilliseconds)
                          : item.observedAtMilliseconds,
                        deadlineMilliseconds: item.observedAtMilliseconds + ordinaryToolEffectLimitMilliseconds
                      })
                if (retained === undefined) yield* writeToolEffect(started)
                yield* stopToolEffect(started, "Malformed")
                return toolLimitProjection()
              }
              if (item.phase === "Started") {
                if (retained !== undefined) return undefined
                if (Result.isFailure(privateRecord) || Option.isNone(privateRecord.success))
                  return toolLimitProjection()
                const owned = privateRecord.success.value
                const admittedPolicy = hasOwnedTurnRecord(owned)
                  ? (owned.toolEffectPolicy ?? toolEffectPolicy)
                  : toolEffectPolicy
                const limit = codexToolEffectLimit(
                  admittedPolicy,
                  item.cwd === owned.worktree
                    ? { ...item, kind: item.kind ?? "dynamicToolCall" }
                    : { kind: item.kind ?? "dynamicToolCall" }
                )
                yield* writeToolEffect(
                  CodexToolEffectRecord.cases.Started.make({
                    runId: correlation.runId,
                    attemptId: correlation.attemptId,
                    threadId: retainedThreadId,
                    turnId: retainedTurnId,
                    itemId,
                    incarnation: app.incarnation,
                    worktree: privateRecord.success.value.worktree,
                    startedAtMilliseconds: item.observedAtMilliseconds,
                    deadlineMilliseconds: item.observedAtMilliseconds + limit
                  })
                )
                const monotonicStart = item.observedAtMonotonicNanoseconds
                if (monotonicStart !== undefined) {
                  yield* Ref.update(toolEffectMonotonicStarts, (current) =>
                    new Map(current).set(JSON.stringify([retainedTurnId, itemId]), monotonicStart)
                  )
                }
                return undefined
              }
              // A completion for an item whose start was not observed cannot
              // settle or extend any other item's retained deadline.
              if (retained === undefined) return undefined
              if (retained._tag !== "Started") return undefined
              const monotonicStart = yield* Ref.get(toolEffectMonotonicStarts).pipe(
                Effect.map((starts) => starts.get(JSON.stringify([retainedTurnId, itemId])))
              )
              if (
                item.observedAtMilliseconds < retained.startedAtMilliseconds ||
                (monotonicStart !== undefined &&
                  item.observedAtMonotonicNanoseconds !== undefined &&
                  item.observedAtMonotonicNanoseconds < monotonicStart)
              ) {
                yield* stopToolEffect(retained, "ClockReversed")
                return toolLimitProjection()
              }
              const completionExpired =
                monotonicStart === undefined || item.observedAtMonotonicNanoseconds === undefined
                  ? item.observedAtMilliseconds >= retained.deadlineMilliseconds
                  : item.observedAtMonotonicNanoseconds - monotonicStart >=
                    BigInt(retained.deadlineMilliseconds - retained.startedAtMilliseconds) * nanosecondsPerMillisecond
              if (completionExpired) {
                yield* stopToolEffect(retained, "Elapsed")
                return toolLimitProjection()
              }
              yield* writeToolEffect(
                CodexToolEffectRecord.cases.Completed.make({
                  runId: retained.runId,
                  attemptId: retained.attemptId,
                  threadId: retained.threadId,
                  turnId: retained.turnId,
                  itemId: retained.itemId,
                  incarnation: retained.incarnation,
                  worktree: retained.worktree,
                  startedAtMilliseconds: retained.startedAtMilliseconds,
                  deadlineMilliseconds: retained.deadlineMilliseconds,
                  completedAtMilliseconds: item.observedAtMilliseconds
                })
              )
              yield* Ref.update(
                toolEffectMonotonicStarts,
                (current) => new Map([...current].filter(([key]) => key !== JSON.stringify([retainedTurnId, itemId])))
              )
              return undefined
            })
          const checkToolEffectDeadline = Effect.gen(function* () {
            const correction = yield* attemptGate.withPermit(
              Effect.gen(function* () {
                const current = yield* store.readAttempt(correlation.runId, correlation.attemptId)
                if (Option.isNone(current) || !recordMatchesCorrelation(current.value, correlation)) return undefined
                const owned = current.value
                if (owned._tag === "ResultCorrectionStopIntended")
                  return yield* finishResultCorrectionStop(correlation, owned, false)
                if (owned._tag !== "Running" && owned._tag !== "TurnObserved") return undefined
                const response = owned.resultCycle?.responses.at(lastElementOffset)
                const now = ProviderResultInstantMilliseconds.make(
                  yield* Effect.clockWith((clock) => clock.currentTimeMillis)
                )
                if (response === undefined || !providerResultResponseExpired(response.intent, now)) return undefined
                return yield* expireResultCorrection(correlation, owned)
              })
            )
            if (correction !== undefined) return projectionOutcome(exact(correction))
            const retained = yield* listToolEffects(correlation)
            const pending = retained.find(
              (record): record is Extract<CodexToolEffectRecord, { readonly _tag: "StopIntended" }> =>
                record._tag === "StopIntended"
            )
            if (pending !== undefined) {
              yield* finishToolEffectStop(pending)
              return toolLimitProjection()
            }
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
            const monotonicNow = yield* Effect.clockWith((clock) => clock.monotonicTimeNanos)
            const monotonicStarts = yield* Ref.get(toolEffectMonotonicStarts)
            const reversed = retained.find((record) => {
              if (record._tag !== "Started") return false
              const monotonicStart = monotonicStarts.get(JSON.stringify([record.turnId, record.itemId]))
              return (
                now < record.startedAtMilliseconds || (monotonicStart !== undefined && monotonicNow < monotonicStart)
              )
            })
            if (reversed !== undefined && reversed._tag === "Started") {
              yield* stopToolEffect(reversed, "ClockReversed")
              return toolLimitProjection()
            }
            const expired = retained.find((record) => {
              if (record._tag !== "Started") return false
              const monotonicStart = monotonicStarts.get(JSON.stringify([record.turnId, record.itemId]))
              return monotonicStart === undefined
                ? now >= record.deadlineMilliseconds
                : monotonicNow - monotonicStart >=
                    BigInt(record.deadlineMilliseconds - record.startedAtMilliseconds) * nanosecondsPerMillisecond
            })
            if (expired !== undefined && expired._tag === "Started") {
              yield* stopToolEffect(expired, "Elapsed")
              return toolLimitProjection()
            }
            const owned =
              Result.isSuccess(privateRecord) && Option.isSome(privateRecord.success)
                ? privateRecord.success.value
                : undefined
            if (
              retainedThreadId === undefined ||
              retainedTurnId === undefined ||
              owned === undefined ||
              !hasOwnedTurnRecord(owned) ||
              owned.turnStartedAtMilliseconds === undefined ||
              now < owned.turnStartedAtMilliseconds + ordinaryToolEffectLimitMilliseconds
            )
              return undefined
            const lastScan = yield* Ref.get(lastMissingStartScanAt)
            if (lastScan !== undefined && now - lastScan < missingToolStartScanIntervalMilliseconds) return undefined
            yield* Ref.set(lastMissingStartScanAt, now)
            const thread = yield* app.readThread(retainedThreadId)
            const turn = thread.turns.find((candidate) => candidate.id === retainedTurnId)
            if (turn === undefined || turn.ownedTurnToken !== owned.currentToken) return toolLimitProjection()
            const activeItem = turn.items.find(
              (candidate) =>
                isJsonRecord(candidate) &&
                typeof candidate["id"] === "string" &&
                candidate["id"].length > 0 &&
                typeof candidate["type"] === "string" &&
                toolItemTypes.has(candidate["type"]) &&
                (typeof candidate["status"] !== "string" || !completedToolStatuses.has(candidate["status"]))
            )
            if (!isJsonRecord(activeItem) || typeof activeItem["id"] !== "string") return undefined
            if (retained.some((record) => record.turnId === retainedTurnId && record.itemId === activeItem["id"]))
              return undefined
            if (owned.turnStartIncarnation === undefined || owned.turnStartIncarnation !== app.incarnation)
              return toolLimitProjection()
            const missingStart = CodexToolEffectRecord.cases.Started.make({
              runId: correlation.runId,
              attemptId: correlation.attemptId,
              threadId: retainedThreadId,
              turnId: retainedTurnId,
              itemId: CodexToolItemId.make(activeItem["id"]),
              incarnation: owned.turnStartIncarnation,
              worktree: owned.worktree,
              startedAtMilliseconds: owned.turnStartedAtMilliseconds,
              deadlineMilliseconds: owned.turnStartedAtMilliseconds + ordinaryToolEffectLimitMilliseconds
            })
            yield* writeToolEffect(missingStart)
            yield* stopToolEffect(missingStart, "MissingStart")
            return toolLimitProjection()
          })
          const toolEffectCandidates = Stream.merge(
            turnSubscription.toolEffects.pipe(
              Stream.mapEffect((item) =>
                toolEffectGate
                  .withPermit(observeToolEffect(item))
                  .pipe(
                    Effect.catch((error: unknown) =>
                      Effect.succeed(projectionOutcome(projectFailure(correlation, error)))
                    )
                  )
              )
            ),
            Stream.fromSchedule(Schedule.spaced(Duration.seconds(1))).pipe(
              Stream.mapEffect(() =>
                toolEffectGate
                  .withPermit(checkToolEffectDeadline)
                  .pipe(
                    Effect.catch((error: unknown) =>
                      Effect.succeed(projectionOutcome(projectFailure(correlation, error)))
                    )
                  )
              )
            )
          ).pipe(
            Stream.filter((candidate): candidate is LifecycleProjectionOutcome => candidate !== undefined),
            Stream.takeUntil(
              (candidate) =>
                candidate.projection._tag !== "Exact" || candidate.projection.report._tag !== "ExecutorWorkExecuting"
            ),
            Stream.interruptWhen(Deferred.await(toolObservationStopped))
          )
          const shouldContinueLifecycleObservation = (outcome: LifecycleProjectionOutcome) =>
            outcome.continueLifecycleObservation &&
            (outcome.projection._tag === "Unreadable" ||
              (outcome.projection._tag === "Exact" && outcome.projection.report._tag === "ExecutorWorkExecuting"))
          const heldTerminalActivity = yield* Deferred.make<void>()
          const idleHintObserved = yield* Ref.make(false)
          const readLifecycle = (
            initial: boolean,
            completionHintAuthorized = false,
            allowInitialRunningRecovery = false,
            abortionReadAuthorized = false
          ) =>
            projectionGate.withPermit(
              Ref.updateAndGet(lifecycleReadOrdinal, (currentOrdinal) => currentOrdinal + 1).pipe(
                Effect.flatMap((readOrdinal) =>
                  attemptGate
                    .withPermit(
                      projectLifecycle(
                        correlation,
                        allowInitialRunningRecovery,
                        completionHintAuthorized,
                        abortionReadAuthorized
                      )
                    )
                    .pipe(
                      Effect.tap((outcome) =>
                        Ref.get(latestLifecycleOutcome).pipe(
                          Effect.flatMap((previous) =>
                            previous?.turnId !== undefined && previous.turnId !== outcome.turnId
                              ? Ref.set(matchingCompletionHintObserved, false)
                              : Effect.void
                          ),
                          Effect.andThen(Ref.set(latestLifecycleOutcome, outcome)),
                          Effect.andThen(
                            outcome.projection._tag === "Exact" &&
                              outcome.projection.report._tag === "ExecutorWorkExecuting"
                              ? Effect.void
                              : Deferred.succeed(toolObservationStopped, undefined)
                          ),
                          Effect.andThen(
                            shouldContinueLifecycleObservation(outcome)
                              ? Deferred.succeed(heldTerminalActivity, undefined)
                              : Effect.void
                          ),
                          Effect.andThen(
                            logCodexCompletionTrace({
                              _tag: "CodexExecutorCompletionTrace",
                              appServerIncarnation: app.incarnation,
                              attemptId: correlation.attemptId,
                              initial,
                              lifecycleReadOrdinal: readOrdinal,
                              phase: "LifecycleRereadResult",
                              projection: outcome.projection._tag,
                              ...(outcome.projection._tag === "Exact"
                                ? { report: outcome.projection.report._tag }
                                : {}),
                              runId: correlation.runId,
                              ...(outcome.threadId === undefined ? {} : { threadId: outcome.threadId }),
                              ...(outcome.turnId === undefined ? {} : { turnId: outcome.turnId })
                            })
                          )
                        )
                      )
                    )
                )
              )
            )
          const current = yield* readLifecycle(true)
          // Paced rereads follow an exact sealed turn during stale recovery,
          // a matching completion hint ahead of the provider census, or a
          // terminal turn still held by its exact owned activity census.
          // A later hint-triggered reread may discover this state, so start the
          // cadence from the first eligible projection rather than attach time.
          const lifecycleCadence = Stream.fromEffect(Deferred.await(heldTerminalActivity)).pipe(
            Stream.flatMap(() =>
              Stream.fromSchedule(Schedule.spaced(ownedActivityObservationInterval)).pipe(
                Stream.mapEffect(() =>
                  Ref.get(matchingCompletionHintObserved).pipe(
                    Effect.flatMap((authorized) =>
                      Ref.get(idleHintObserved).pipe(
                        Effect.flatMap((idle) => readLifecycle(false, authorized, false, idle))
                      )
                    )
                  )
                ),
                Stream.takeUntil((candidate) => !shouldContinueLifecycleObservation(candidate))
              )
            )
          )
          const turnNotificationCandidates = turnHints.pipe(
            Stream.mapEffect((hint) =>
              Ref.updateAndGet(lifecycleHintOrdinal, (currentOrdinal) => currentOrdinal + 1).pipe(
                Effect.flatMap((hintOrdinal) =>
                  Ref.get(latestLifecycleOutcome).pipe(
                    Effect.flatMap((latest) => {
                      const projectedIdentityMatches =
                        latest?.threadId === hint.threadId && latest.turnId === hint.turnId
                      const trace = (
                        phase:
                          | "ExactCompletionHintConsumed"
                          | "UnrelatedCompletionHintIgnored"
                          | "CompletionHintAssociationUnreadable"
                      ) =>
                        logCodexCompletionTrace({
                          _tag: "CodexExecutorCompletionTrace",
                          appServerIncarnation: app.incarnation,
                          attachedAttemptId: correlation.attemptId,
                          attachedRunId: correlation.runId,
                          hintOrdinal,
                          hintChannel: "turn/completed",
                          phase,
                          threadId: hint.threadId,
                          turnId: hint.turnId,
                          ...(latest?.threadId === undefined ? {} : { lastProjectedThreadId: latest.threadId }),
                          ...(latest?.turnId === undefined ? {} : { lastProjectedTurnId: latest.turnId })
                        })
                      if (!projectedIdentityMatches) {
                        return trace("UnrelatedCompletionHintIgnored").pipe(Effect.as(undefined))
                      }
                      return store.readAttempt(correlation.runId, correlation.attemptId).pipe(
                        Effect.result,
                        Effect.flatMap((privateRecord) => {
                          if (Result.isFailure(privateRecord)) {
                            return trace("CompletionHintAssociationUnreadable").pipe(
                              Effect.andThen(readLifecycle(false))
                            )
                          }
                          const record = Option.isSome(privateRecord.success) ? privateRecord.success.value : undefined
                          // A sealed result may still project Executing while a recovered
                          // provider census is stale. The exact hint authorizes a reread,
                          // never a replacement of the retained terminal seal.
                          const exactAssociation =
                            record !== undefined &&
                            recordMatchesCorrelation(record, correlation) &&
                            (record._tag === "Running" ||
                              record._tag === "SuspensionInterruptIntended" ||
                              record._tag === "SafelySuspended" ||
                              record._tag === "Terminal" ||
                              record._tag === "ResultRejected" ||
                              record._tag === "ResultCorrectionPending") &&
                            record.threadId === hint.threadId &&
                            record.observedTurnId === hint.turnId
                          if (!exactAssociation) {
                            return trace("UnrelatedCompletionHintIgnored").pipe(Effect.as(undefined))
                          }
                          return trace("ExactCompletionHintConsumed").pipe(
                            Effect.andThen(Ref.set(matchingCompletionHintObserved, true)),
                            Effect.andThen(readLifecycle(false, true, true))
                          )
                        })
                      )
                    })
                  )
                )
              )
            ),
            Stream.filter((candidate): candidate is LifecycleProjectionOutcome => candidate !== undefined)
          )
          const threadIdleCandidates = turnSubscription.threadIdleHints.pipe(
            Stream.filter((hint) => hint.threadId === retainedThreadId),
            Stream.mapEffect(() =>
              Ref.set(idleHintObserved, true).pipe(Effect.andThen(readLifecycle(false, false, false, true)))
            )
          )
          const activityNotificationCandidates = activityHints.pipe(
            Stream.mapEffect(() =>
              Ref.get(matchingCompletionHintObserved).pipe(
                Effect.flatMap((authorized) => readLifecycle(false, authorized))
              )
            )
          )
          const protocolFailureCandidates = protocolFailures.pipe(
            Stream.mapEffect((failure) =>
              logCodexCompletionTrace({
                _tag: "CodexExecutorCompletionTrace",
                appServerIncarnation: app.incarnation,
                attachedAttemptId: correlation.attemptId,
                attachedRunId: correlation.runId,
                phase: "AppServerProtocolFailureConsumed",
                protocolOperation: failure.operation
              }).pipe(Effect.as(projectionOutcome(projectFailure(correlation, failure))))
            )
          )
          const changes = Stream.merge(
            Stream.merge(
              Stream.merge(
                Stream.merge(
                  Stream.merge(turnNotificationCandidates, threadIdleCandidates),
                  activityNotificationCandidates
                ),
                protocolFailureCandidates
              ),
              toolEffectCandidates
            ),
            lifecycleCadence
          ).pipe(
            Stream.map((candidate) => candidate.projection),
            Stream.filter((candidate) => !samePlannedAttemptExecutorProjection(candidate, current.projection)),
            Stream.interruptWhen(Deferred.await(closed))
          )
          const close = Deferred.succeed(closed, undefined).pipe(
            Effect.andThen(Scope.close(attachmentScope, Exit.void)),
            Effect.asVoid
          )
          return { changes, close, current: current.projection }
        })
    })
    return Context.empty().pipe(
      Context.add(PlannedAttemptExecutor, executor),
      Context.add(PlannedAttemptExecutorLifecycleObservation, lifecycleObservation),
      Context.add(CodexProviderWorkUnitReplacement, replacementService)
    )
  })

export const codexPlannedAttemptExecutorLayerWithOptions = (options: CodexPlannedAttemptExecutorLayerOptions = {}) =>
  Layer.effectContext(
    makeCodexPlannedAttemptExecutorContext(
      options.ownedActivityObservationInterval ?? defaultCodexOwnedActivityObservationInterval,
      options.taskInstructions ?? defaultCodexTaskInstructions,
      options.toolEffectPolicy ?? CodexToolEffectPolicy.make({ defaultLimitMilliseconds: 60_000, longCommands: [] })
    )
  )

/** Default app-server executor composition with the supported one-second held-activity census cadence. */
export const codexPlannedAttemptExecutorLayer = codexPlannedAttemptExecutorLayerWithOptions()

/** Supported production composition: use the node-owned activity census. */
export const nodeCodexPlannedAttemptExecutorLayerWithOptions = (
  options: CodexPlannedAttemptExecutorLayerOptions = {}
) => codexPlannedAttemptExecutorLayerWithOptions(options).pipe(Layer.provide(nodeCodexOwnedActivityCensusLayer))

export const nodeCodexPlannedAttemptExecutorLayer = nodeCodexPlannedAttemptExecutorLayerWithOptions()

class ForeignAttemptRecord extends Schema.TaggedError<ForeignAttemptRecord>()("ForeignAttemptRecord", {
  observed: PlannedAttemptExecutorCorrelation
}) {}

class CodexThreadMismatch extends Schema.TaggedError<CodexThreadMismatch>()("CodexThreadMismatch", {}) {}

class CodexTurnBoundaryUnknown extends Schema.TaggedError<CodexTurnBoundaryUnknown>()("CodexTurnBoundaryUnknown", {}) {}

class CodexTurnCensusPending extends Schema.TaggedError<CodexTurnCensusPending>()("CodexTurnCensusPending", {}) {}

class CodexActivityCensusUnknown extends Schema.TaggedError<CodexActivityCensusUnknown>()(
  "CodexActivityCensusUnknown",
  { detail: Schema.String }
) {}

class CodexGitObservationUnknown extends Schema.TaggedError<CodexGitObservationUnknown>()(
  "CodexGitObservationUnknown",
  {}
) {}

class CodexEvidenceUnavailable extends Schema.TaggedError<CodexEvidenceUnavailable>()("CodexEvidenceUnavailable", {}) {}

class CodexEvidenceInvalid extends Schema.TaggedError<CodexEvidenceInvalid>()("CodexEvidenceInvalid", {}) {}
