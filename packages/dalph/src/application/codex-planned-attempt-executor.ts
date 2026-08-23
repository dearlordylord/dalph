/* eslint-disable max-lines -- The bounded executor chronology stays co-located for auditability. */
import {
  AcceptedResultEvidenceManifest,
  EvidenceDigest,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorCommandFailure,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  PlannedAttemptExecutorResult,
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
  TaskRevision,
  TaskWorkSpecification,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  EvidenceStore,
  GitCommand,
  isExactTaskClaim,
  type EvidenceStoreService
} from "@dalph/orchestrator"
import { Context, Crypto, Effect, Layer, Option, Ref, Result, Schema, Semaphore } from "effect"
import {
  CodexAppServer,
  CodexAppServerFailure,
  CodexOwnedActivityCensus,
  nodeCodexOwnedActivityCensusLayer,
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
  type CodexReplacementRequestDigest,
  type CodexSealedTerminal as CodexSealedTerminalType,
  type CodexThreadId,
  type CodexTurnId
} from "./codex-attempt-store.js"

/** A terminal Codex message must contain one unambiguous 40-character commit. */
const commitPattern = /(?<![0-9a-f])([0-9a-f]{40})(?![0-9a-f])/g
const lastElementOffset = -1
const hexRadix = 16
const hexByteWidth = 2
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
  command: "StartOrContinue" | "Suspend",
  correlation: PlannedAttemptExecutorCorrelation,
  error: unknown
): PlannedAttemptExecutorCommandFailure =>
  new PlannedAttemptExecutorCommandFailure({ command, correlation, detail: commandFailureDetail(error) })

export const preserveCommandFailure = (
  command: "StartOrContinue" | "Suspend",
  correlation: PlannedAttemptExecutorCorrelation,
  error: unknown
): PlannedAttemptExecutorCommandFailure =>
  error instanceof PlannedAttemptExecutorCommandFailure ? error : commandFailure(command, correlation, error)

const running = (correlation: PlannedAttemptExecutorCorrelation): PlannedAttemptExecutorReportType =>
  PlannedAttemptExecutorReport.cases.Running.make({ correlation })

const suspended = (correlation: PlannedAttemptExecutorCorrelation): PlannedAttemptExecutorReportType =>
  PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })

const terminal = (
  correlation: PlannedAttemptExecutorCorrelation,
  result: PlannedAttemptExecutorResult
): PlannedAttemptExecutorReportType => PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result })

const foreignReport = (observed: PlannedAttemptExecutorCorrelation): PlannedAttemptExecutorReportType =>
  PlannedAttemptExecutorReport.cases.Running.make({ correlation: observed })

const noReport = (correlation: PlannedAttemptExecutorCorrelation): PlannedAttemptExecutorProjectionType =>
  PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })

const exact = (report: PlannedAttemptExecutorReportType): PlannedAttemptExecutorProjectionType =>
  PlannedAttemptExecutorProjection.cases.Exact.make({ report })

const unavailable = (correlation: PlannedAttemptExecutorCorrelation): PlannedAttemptExecutorProjectionType =>
  PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({ correlation })

const unreadable = (correlation: PlannedAttemptExecutorCorrelation): PlannedAttemptExecutorProjectionType =>
  PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation })

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
    observed: PlannedAttemptExecutorReport.cases.Running.make({ correlation: observed })
  })

const sameCorrelation = (left: PlannedAttemptExecutorCorrelation, right: PlannedAttemptExecutorCorrelation): boolean =>
  left.runId === right.runId && left.attemptId === right.attemptId

const sameAcceptedManifest = Schema.toEquivalence(AcceptedResultEvidenceManifest)

type CodexEmptyRecord = Extract<CodexAttemptRecord, { readonly _tag: "EmptyPreTurn" }>
type CodexAssociatedRecord = Extract<CodexAttemptRecord, { readonly _tag: "AssociatedPreTurn" }>
type CodexIntentRecord = Extract<CodexAttemptRecord, { readonly _tag: "TurnIntentRecorded" }>
type CodexObservedRecord = Extract<CodexAttemptRecord, { readonly _tag: "TurnObserved" }>
type CodexRunningRecord = Extract<CodexAttemptRecord, { readonly _tag: "Running" }>
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
  priorObservedTurnId: CodexTurnId | null
): CodexIntentRecord =>
  CodexAttemptRecord.cases.TurnIntentRecorded.make({
    attemptId: attempt.attemptId,
    correlationAttemptId: attempt.attemptId,
    correlationRunId: attempt.runId,
    currentToken,
    priorObservedTurnId,
    threadId,
    worktree: attempt.worktree
  })

const observedRecordFor = (
  attempt: Pick<PlannedTaskAttempt, "attemptId" | "runId" | "worktree">,
  threadId: CodexThreadId,
  currentToken: CodexOwnedTurnToken,
  observedTurnId: CodexTurnId,
  priorObservedTurnId: CodexTurnId | null
): CodexObservedRecord =>
  CodexAttemptRecord.cases.TurnObserved.make({
    attemptId: attempt.attemptId,
    correlationAttemptId: attempt.attemptId,
    correlationRunId: attempt.runId,
    currentToken,
    observedTurnId,
    priorObservedTurnId,
    threadId,
    worktree: attempt.worktree
  })

const runningRecordFor = (
  attempt: Pick<PlannedTaskAttempt, "attemptId" | "runId" | "worktree">,
  record: CodexObservedRecord | CodexRunningRecord | CodexSafelySuspendedRecord
): CodexRunningRecord =>
  CodexAttemptRecord.cases.Running.make({
    attemptId: attempt.attemptId,
    correlationAttemptId: attempt.attemptId,
    correlationRunId: attempt.runId,
    currentToken: record.currentToken,
    observedTurnId: record.observedTurnId,
    priorObservedTurnId: record.priorObservedTurnId,
    threadId: record.threadId,
    worktree: attempt.worktree
  })

const safelySuspendedRecordFor = (
  attempt: Pick<PlannedTaskAttempt, "attemptId" | "runId" | "worktree">,
  record: CodexObservedRecord | CodexRunningRecord | CodexSafelySuspendedRecord
): CodexSafelySuspendedRecord =>
  CodexAttemptRecord.cases.SafelySuspended.make({
    attemptId: attempt.attemptId,
    correlationAttemptId: attempt.attemptId,
    correlationRunId: attempt.runId,
    currentToken: record.currentToken,
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
  { readonly _tag: "TurnIntentRecorded" | "TurnObserved" | "Running" | "SafelySuspended" | "Terminal" }
>

const hasOwnedTurnRecord = (record: CodexAttemptRecord): record is OwnedTurnRecord =>
  record._tag !== "EmptyPreTurn" && record._tag !== "AssociatedPreTurn"

const isThreadBackedRecord = (record: CodexAttemptRecord): record is CodexThreadBackedRecord =>
  record._tag !== "EmptyPreTurn"

const isAcceptedTerminalRecord = (record: CodexTerminalRecord): record is CodexAcceptedTerminalRecord =>
  record.terminal._tag === "Accepted" && record.evidenceManifest !== null

const isPersistableOwnedRecord = (
  record: CodexAttemptRecord
): record is CodexObservedRecord | CodexRunningRecord | CodexSafelySuspendedRecord =>
  record._tag !== "TurnIntentRecorded" && record._tag !== "Terminal"

export const ownedRecordPersistenceDisposition = (
  tag: CodexAttemptRecord["_tag"]
): "Intent" | "Persistable" | "Reject" => {
  switch (tag) {
    case "TurnIntentRecorded":
      return "Intent"
    case "TurnObserved":
    case "Running":
    case "SafelySuspended":
      return "Persistable"
    case "EmptyPreTurn":
    case "AssociatedPreTurn":
    case "Terminal":
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

type ParsedCommitMessage =
  | { readonly _tag: "Valid"; readonly candidate: string | undefined }
  | { readonly _tag: "Invalid" }

export const parsedCommitFromMessage = (
  finalMessage: string,
  expectedCorrelation: PlannedAttemptExecutorCorrelation
): ParsedCommitMessage => {
  try {
    const parsed: unknown = JSON.parse(finalMessage)
    if (!isJsonRecord(parsed)) return { _tag: "Invalid" }
    const responseCorrelation = parsed["correlation"]
    if (responseCorrelation === undefined) return { _tag: "Invalid" }
    const decoded = Schema.decodeUnknownSync(PlannedAttemptExecutorCorrelation)(responseCorrelation)
    if (!sameCorrelation(decoded, expectedCorrelation)) return { _tag: "Invalid" }
    return { _tag: "Valid", candidate: typeof parsed["commit"] === "string" ? parsed["commit"] : undefined }
  } catch {
    return { _tag: "Invalid" }
  }
}

export const commitCandidates = (finalMessage: string, parsedCandidate: string | undefined): ReadonlySet<string> =>
  new Set<string>([
    ...(parsedCandidate !== undefined && /^[0-9a-f]{40}$/.test(parsedCandidate) ? [parsedCandidate] : []),
    ...Array.from(finalMessage.matchAll(commitPattern), (match) => match[1]).filter(
      (candidate): candidate is string => candidate !== undefined
    )
  ])

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
  const candidates = commitCandidates(finalMessage, parsedMessage.candidate)
  if (candidates.size !== 1) return undefined
  return GitCommitSha.make(String([...candidates][0]))
}

const taskTurnText = (attempt: PlannedTaskAttempt, specification: TaskWorkSpecification): string =>
  [
    `# ${specification.title}`,
    specification.body,
    "",
    "Dalph immutable attempt facts:",
    `run_id: ${attempt.runId}`,
    `attempt_id: ${attempt.attemptId}`,
    `task_id: ${attempt.taskId}`,
    `task_revision: ${attempt.taskRevision}`,
    `base_sha: ${attempt.baseSha}`,
    `branch: ${attempt.branch}`,
    `worktree: ${attempt.worktree}`,
    'Accepted results must be the final JSON object {"commit":"<40-hex>","correlation":{"runId":"...","attemptId":"..."}}.'
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
  operationId: CodexReplacementOperationId
): string =>
  [
    taskTurnText(attempt, specification),
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
): boolean => thread.id === predecessor.threadId && thread.cwd === request.plannedAttempt.worktree

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

/**
 * The concrete app-server executor keeps all Codex identities private. The
 * generic boundary receives only normalized #140/#168 reports.
 */
export const codexPlannedAttemptExecutorLayer = Layer.effectContext(
  Effect.gen(function* () {
    const app = yield* CodexAppServer
    const activityCensus = yield* CodexOwnedActivityCensus
    const crypto = yield* Crypto.Crypto
    const store = yield* CodexAttemptStore
    const git = yield* GitCommand
    const evidenceStore = yield* Effect.serviceOption(EvidenceStore)
    const replacementAuthority = yield* Effect.serviceOption(CodexReplacementAuthority)
    const gates = yield* Ref.make<ReadonlyMap<string, Semaphore.Semaphore>>(new Map())
    const freshOwnedTurnToken = Effect.gen(function* () {
      return CodexOwnedTurnToken.make(yield* crypto.randomUUIDv4)
    }).pipe(
      /* v8 ignore next -- @preserve Crypto.randomUUIDv4 has an uninhabited error channel in the production Crypto service. */
      Effect.mapError(() => new CodexTurnBoundaryUnknown({}))
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
      if (thread.id !== expectedThreadId || thread.cwd !== attempt.worktree) {
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

    const reconcileAssociatedThread = (thread: CodexThreadSnapshot) => {
      if (thread.turns.some((turn) => turn.ownedTurnToken !== undefined) || thread.status === "active") {
        return Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
      return Effect.succeed<ThreadReconciliation>({ _tag: "Idle", thread, turn: undefined })
    }

    const reconcileOwnedTurn = (
      thread: CodexThreadSnapshot,
      record: OwnedTurnRecord
    ): Effect.Effect<ThreadReconciliation, CodexThreadMismatch | CodexTurnBoundaryUnknown | ForeignAttemptRecord> => {
      const lookup = ownedTurnForRecord(thread, record)
      if (lookup._tag === "Contradiction") return Effect.fail(new CodexTurnBoundaryUnknown({}))
      if (lookup._tag === "Foreign") return Effect.fail(new ForeignAttemptRecord({ observed: lookup.observed }))
      if (lookup._tag === "Missing") {
        return Effect.succeed({ _tag: "Unresolved" as const, thread, turn: undefined })
      }
      if (isTerminalTurn(lookup.turn)) return Effect.succeed({ _tag: "Terminal" as const, thread, turn: lookup.turn })
      if (isActiveThread(thread, lookup.turn))
        return Effect.succeed({ _tag: "Running" as const, thread, turn: lookup.turn })
      return Effect.succeed({ _tag: "Idle" as const, thread, turn: lookup.turn })
    }

    const reconcile = Effect.fn("CodexPlannedAttemptExecutor.reconcile")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord
    ) {
      /* v8 ignore next -- @preserve Reconciliation is called only after allocation or a durable thread-backed record read. */
      if (record._tag === "EmptyPreTurn") return yield* Effect.fail(new CodexThreadMismatch({}))
      const thread = yield* app.resumeThread(record.threadId, attempt.worktree)
      yield* enforceThreadIdentity(attempt, correlation, record.threadId, thread)
      if (record._tag === "AssociatedPreTurn") {
        /* v8 ignore next -- @preserve Associated no-turn reconciliation accepts only the loaded idle state established by thread/read normalization. */
        if (thread.status === "notLoaded" || thread.status === "systemError") {
          return yield* Effect.fail(new CodexThreadMismatch({}))
        }
        return yield* reconcileAssociatedThread(thread)
      }
      const ownedTurn = yield* reconcileOwnedTurn(thread, record)
      if (ownedTurn._tag === "Terminal") return ownedTurn
      if (thread.status === "notLoaded" || thread.status === "systemError") {
        return yield* Effect.fail(new CodexThreadMismatch({}))
      }
      return ownedTurn
    })

    const observeOwnedActivity = Effect.fn("CodexPlannedAttemptExecutor.observeOwnedActivity")(function* (
      thread: CodexThreadSnapshot
    ) {
      const backgroundTerminals = yield* app.listBackgroundTerminals(thread.id)
      return yield* activityCensus.observe(thread, backgroundTerminals)
    })

    const observeOwnedActivityByThreadId = Effect.fn("CodexPlannedAttemptExecutor.observeOwnedActivityByThreadId")(
      function* (threadId: CodexThreadId) {
        const thread = yield* app.readThread(threadId)
        return yield* observeOwnedActivity(thread)
      }
    )

    const censusHasActivity = (census: CodexOwnedActivityCensusProjection): boolean => census._tag !== "Absent"

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
      return activityCensus.terminateDescendants(uniqueDescendants)
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

    const acceptedCommit = Effect.fn("CodexPlannedAttemptExecutor.acceptedCommit")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: OwnedTurnRecord,
      turn: CodexTurnSnapshot,
      thread: CodexThreadSnapshot
    ) {
      const commit = commitFromTurn(turn, correlation)
      const head = yield* readHead(attempt)
      if (commit === undefined) {
        return { _tag: "Report" as const, report: yield* failed(attempt, correlation, record, turn.id, thread) }
      }
      if (head === undefined) return yield* Effect.fail(new CodexGitObservationUnknown({}))
      if (commit !== head) {
        return { _tag: "Report" as const, report: yield* failed(attempt, correlation, record, turn.id, thread) }
      }
      return { _tag: "Commit" as const, commit }
    })

    const publishAcceptedEvidence = Effect.fn("CodexPlannedAttemptExecutor.publishAcceptedEvidence")(function* (
      evidence: EvidenceStoreService,
      commit: GitCommitSha,
      correlation: PlannedAttemptExecutorCorrelation
    ) {
      const manifest = AcceptedResultEvidenceManifest.make({
        commit,
        correlation,
        formatVersion: 1,
        outcome: "Accepted",
        predecessor: null
      })
      const bytes = new TextEncoder().encode(JSON.stringify(manifest))
      const reference = yield* evidence.put(bytes)
      const reread = yield* evidence.read(reference)
      if (!(yield* referenceMatchesBytes(reference, reread))) {
        return yield* Effect.fail(new CodexEvidenceInvalid({}))
      }
      const decoded = decodeAcceptedManifest(reread)
      if (decoded === undefined || !sameAcceptedManifest(decoded, manifest)) {
        return yield* Effect.fail(new CodexEvidenceInvalid({}))
      }
      return { manifest, reference }
    })

    const accepted = Effect.fn("CodexPlannedAttemptExecutor.accepted")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: OwnedTurnRecord,
      turn: CodexTurnSnapshot,
      thread: CodexThreadSnapshot
    ) {
      const commitResult = yield* acceptedCommit(attempt, correlation, record, turn, thread)
      if (commitResult._tag === "Report") return commitResult.report
      const commit = commitResult.commit
      if (Option.isNone(evidenceStore)) return yield* Effect.fail(new CodexEvidenceUnavailable({}))
      const { reference } = yield* publishAcceptedEvidence(evidenceStore.value, commit, correlation)
      const rereadHead = yield* readHead(attempt)
      if (rereadHead === undefined) return yield* Effect.fail(new CodexGitObservationUnknown({}))
      if (rereadHead !== commit) return yield* Effect.fail(new CodexGitObservationUnknown({}))
      const finalCensus = yield* observeOwnedActivityByThreadId(thread.id)
      if (finalCensus._tag !== "Absent") return running(correlation)
      const sealed = CodexSealedTerminal.cases.Accepted.make({ commit, evidenceManifest: reference })
      yield* save(terminalRecordFor(attempt, record, turn.id, sealed, reference))
      return terminal(
        correlation,
        PlannedAttemptExecutorResult.cases.Accepted.make({ acceptedResult: { commit, evidenceManifest: reference } })
      )
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
      const finalCensus = yield* observeOwnedActivityByThreadId(thread.id)
      if (finalCensus._tag !== "Absent") return running(correlation)
      return terminal(
        correlation,
        PlannedAttemptExecutorResult.cases.Accepted.make({
          acceptedResult: { commit: record.terminal.commit, evidenceManifest: record.evidenceManifest }
        })
      )
    })

    const failed = Effect.fn("CodexPlannedAttemptExecutor.failed")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: OwnedTurnRecord,
      observedTurnId: CodexTurnId,
      thread: CodexThreadSnapshot
    ) {
      const finalCensus = yield* observeOwnedActivityByThreadId(thread.id)
      if (finalCensus._tag !== "Absent") return running(correlation)
      yield* save(terminalRecordFor(attempt, record, observedTurnId, CodexSealedTerminal.cases.Failed.make({}), null))
      return terminal(correlation, { _tag: "Failed" })
    })

    const observedRecordForTerminal = Effect.fn("CodexPlannedAttemptExecutor.observedRecordForTerminal")(function* (
      attempt: CodexAttemptContext,
      record: CodexAttemptRecord,
      reconciliation: Extract<ThreadReconciliation, { readonly _tag: "Terminal" }>
    ) {
      if (record._tag === "TurnIntentRecorded") {
        const observed = observedRecordFor(
          attempt,
          record.threadId,
          record.currentToken,
          reconciliation.turn.id,
          record.priorObservedTurnId
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
      if (observedRecord._tag === "Terminal") return running(correlation)
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
      reconciliation: Extract<ThreadReconciliation, { readonly _tag: "Terminal" }>
    ) {
      const turn = reconciliation.turn
      if (turn.status === "completed") {
        if (observedRecord._tag === "Terminal" && isAcceptedTerminalRecord(observedRecord)) {
          return yield* rereadAccepted(attempt, correlation, observedRecord, turn, reconciliation.thread)
        }
        return yield* accepted(attempt, correlation, observedRecord, turn, reconciliation.thread)
      }
      return yield* failed(attempt, correlation, observedRecord, turn.id, reconciliation.thread)
    })

    const terminalOrRunning = Effect.fn("CodexPlannedAttemptExecutor.terminalOrRunning")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord,
      reconciliation: Extract<ThreadReconciliation, { readonly _tag: "Terminal" }>
    ) {
      const observedRecord = yield* observedRecordForTerminal(attempt, record, reconciliation)
      const census = yield* observeOwnedActivity(reconciliation.thread)
      if (censusHasActivity(census)) {
        return yield* runningAfterActivity(attempt, correlation, observedRecord)
      }
      return yield* finishTerminalOrFailed(attempt, correlation, observedRecord, reconciliation)
    })

    const reconcileAfterTurnBoundary = Effect.fn("CodexPlannedAttemptExecutor.reconcileAfterTurnBoundary")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexIntentRecord
    ) {
      const reconciliation = yield* reconcile(attempt, correlation, record)
      if (reconciliation._tag === "Running") {
        const turn = yield* requiredReconciliationTurn(reconciliation)
        const observed = observedRecordFor(
          attempt,
          record.threadId,
          record.currentToken,
          turn.id,
          record.priorObservedTurnId
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
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation
    ) {
      // This record is the durable empty allocation intent. No task turn may
      // cross the app-server boundary until the returned thread is recorded.
      yield* save(emptyRecordFor(attempt))
      const thread = yield* app.startThread(attempt.worktree)
      yield* enforceThreadIdentity(attempt, correlation, thread.id, thread)
      const associated = associatedRecordFor(attempt, thread.id)
      yield* save(associated)
      return associated
    })

    const startTurnAcrossBoundary = Effect.fn("CodexPlannedAttemptExecutor.startTurnAcrossBoundary")(function* (
      attempt: PlannedTaskAttempt,
      specification: TaskWorkSpecification,
      correlation: PlannedAttemptExecutorCorrelation,
      intent: CodexIntentRecord
    ) {
      return yield* app
        .startTurn(intent.threadId, attempt.worktree, taskTurnText(attempt, specification), intent.currentToken)
        .pipe(
          Effect.map((turn): StartedTurnResult => ({ _tag: "Turn", turn })),
          Effect.catch((error) =>
            reconcileAfterTurnBoundary(attempt, correlation, intent).pipe(
              Effect.map((report): StartedTurnResult => ({ _tag: "Report", report })),
              Effect.catch(() => Effect.fail(error))
            )
          )
        )
    })

    const finishStartedTurn = Effect.fn("CodexPlannedAttemptExecutor.finishStartedTurn")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexSendableRecord,
      priorObservedTurnId: CodexTurnId | null,
      currentToken: CodexOwnedTurnToken,
      result: StartedTurnResult
    ) {
      if (result._tag === "Report") return result.report
      const turn =
        result.turn.ownedTurnToken === undefined ? { ...result.turn, ownedTurnToken: currentToken } : result.turn
      if (turn.ownedTurnToken !== currentToken) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      yield* enforceThreadIdentity(attempt, correlation, record.threadId, {
        id: record.threadId,
        cwd: attempt.worktree,
        status: turn.status === "inProgress" ? "active" : "idle",
        turns: [turn],
        ...(turn.correlation === undefined ? {} : { correlation: turn.correlation })
      })
      const observed = observedRecordFor(attempt, record.threadId, currentToken, turn.id, priorObservedTurnId)
      yield* save(observed)
      if (turn.status === "inProgress") {
        yield* save(runningRecordFor(attempt, observed))
        return running(correlation)
      }
      return yield* terminalOrRunning(attempt, correlation, observed, {
        _tag: "Terminal" as const,
        thread: { id: record.threadId, cwd: attempt.worktree, status: "idle", turns: [turn] },
        turn
      })
    })

    const sendTurn = Effect.fn("CodexPlannedAttemptExecutor.sendTurn")(function* (
      attempt: PlannedTaskAttempt,
      specification: TaskWorkSpecification,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord
    ) {
      /* v8 ignore next -- @preserve sendTurn is called only after allocation has persisted an associated thread. */
      if (record._tag === "EmptyPreTurn") return yield* Effect.fail(new CodexThreadMismatch({}))
      /* v8 ignore next -- @preserve A durable turn intent is reconciled before another turn can be sent. */
      if (record._tag === "TurnIntentRecorded") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      const priorObservedTurnId = record._tag === "AssociatedPreTurn" ? null : record.observedTurnId
      const currentToken = yield* freshOwnedTurnToken
      // Persist the crossing intent before turn/start. A lost response can
      // therefore be reconciled without sending a second turn.
      const intent = intentRecordFor(attempt, record.threadId, currentToken, priorObservedTurnId)
      yield* save(intent)
      const result = yield* startTurnAcrossBoundary(attempt, specification, correlation, intent)
      return yield* finishStartedTurn(attempt, correlation, record, priorObservedTurnId, currentToken, result)
    })

    /** Distinguishes a thread created by this command from private state recovered after a process boundary. */
    type LoadedStartRecord =
      | { readonly _tag: "FreshAllocation"; readonly record: CodexThreadBackedRecord }
      | { readonly _tag: "Recovered"; readonly record: CodexThreadBackedRecord }

    const loadStartRecord = Effect.fn("CodexPlannedAttemptExecutor.loadStartRecord")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation
    ) {
      const found = yield* readRecord(correlation, attempt)
      if (Option.isNone(found)) {
        return {
          _tag: "FreshAllocation" as const,
          record: yield* allocateThread(attempt, correlation)
        } satisfies LoadedStartRecord
      }
      const record = found.value
      if (!isThreadBackedRecord(record)) {
        return {
          _tag: "FreshAllocation" as const,
          record: yield* allocateThread(attempt, correlation)
        } satisfies LoadedStartRecord
      }
      return { _tag: "Recovered" as const, record } satisfies LoadedStartRecord
    })

    const reconcileAssociatedStart = Effect.fn("CodexPlannedAttemptExecutor.reconcileAssociatedStart")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation,
      record: Extract<CodexAttemptRecord, { readonly _tag: "AssociatedPreTurn" }>
    ) {
      const reconciliation = yield* reconcile(attempt, correlation, record).pipe(
        Effect.catch((error: unknown) =>
          error instanceof CodexAppServerFailure && error.kind === "NotFound"
            ? Effect.succeed<ThreadReconciliation | undefined>(undefined)
            : Effect.fail(error)
        )
      )
      if (reconciliation === undefined) {
        // Only a conclusively absent empty pre-turn thread may be replaced.
        return yield* allocateThread(attempt, correlation)
      }
      /* v8 ignore next -- @preserve An associated pre-turn record has no owned turn that can be Running or Terminal. */
      if (reconciliation._tag === "Running" || reconciliation._tag === "Terminal") {
        return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
      /* v8 ignore next -- @preserve Associated pre-turn reconciliation is either idle or conclusively absent. */
      if (reconciliation._tag === "Unresolved") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      return record
    })

    const saveRunningStartRecord = Effect.fn("CodexPlannedAttemptExecutor.saveRunningStartRecord")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexThreadBackedRecord,
      reconciliation: ThreadReconciliation
    ) {
      const disposition = ownedRecordPersistenceDisposition(record._tag)
      if (disposition === "Intent" && record._tag === "TurnIntentRecorded") {
        const turn = yield* requiredReconciliationTurn(reconciliation)
        const observed = observedRecordFor(
          attempt,
          record.threadId,
          record.currentToken,
          turn.id,
          record.priorObservedTurnId
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

    const continueExistingStart = Effect.fn("CodexPlannedAttemptExecutor.continueExistingStart")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexThreadBackedRecord
    ) {
      const reconciliation = yield* reconcile(attempt, correlation, record)
      if (reconciliation._tag === "Running") {
        return yield* saveRunningStartRecord(attempt, correlation, record, reconciliation)
      }
      if (reconciliation._tag === "Terminal") {
        return yield* terminalOrRunning(attempt, correlation, record, reconciliation)
      }
      if (reconciliation._tag === "Unresolved") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      if (record._tag === "Terminal") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
    })

    const start = Effect.fn("CodexPlannedAttemptExecutor.start")(function* (request: PlannedAttemptExecutorRequest) {
      const attempt = request.plannedAttempt
      const correlation = plannedAttemptExecutorCorrelation(attempt)
      const loaded = yield* loadStartRecord(attempt, correlation)
      let record = loaded.record
      if (loaded._tag === "Recovered" && record._tag === "AssociatedPreTurn") {
        record = yield* reconcileAssociatedStart(attempt, correlation, record)
      } else if (loaded._tag === "Recovered") {
        const existingReport = yield* continueExistingStart(attempt, correlation, record)
        if (existingReport !== undefined) return existingReport
      }
      return yield* sendTurn(attempt, request.specification, correlation, record)
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

    const canSuspendIdleRecord = (record: CodexAttemptRecord): record is OwnedTurnRecord =>
      hasOwnedTurnRecord(record) && record._tag !== "Terminal"

    const saveSuspendedRecord = Effect.fn("CodexPlannedAttemptExecutor.saveSuspendedRecord")(function* (
      attempt: CodexAttemptContext,
      record: CodexAttemptRecord,
      turn: CodexTurnSnapshot | undefined
    ) {
      const disposition = ownedRecordPersistenceDisposition(record._tag)
      if (disposition === "Intent" && record._tag === "TurnIntentRecorded") {
        /* v8 ignore next -- @preserve Intent disposition is selected only from reconciliation carrying the observed turn. */
        if (turn === undefined) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
        const observed = observedRecordFor(
          attempt,
          record.threadId,
          record.currentToken,
          turn.id,
          record.priorObservedTurnId
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
      yield* app
        .interruptTurn(record.threadId, turn.id)
        .pipe(Effect.catch((error) => reconcileInterruptFailure(error, attempt, correlation, record)))
      const after = yield* reconcile(attempt, correlation, record)
      return yield* suspendAfterInterrupt(attempt, correlation, record, after)
    })

    const suspend = Effect.fn("CodexPlannedAttemptExecutor.suspend")(function* (attempt: PlannedTaskAttempt) {
      const correlation = plannedAttemptExecutorCorrelation(attempt)
      const record = yield* readSuspensionRecord(correlation)
      const current = yield* reconcile(attempt, correlation, record)
      if (current._tag === "Terminal") return yield* terminalOrRunning(attempt, correlation, record, current)
      if (current._tag === "Idle") return yield* suspendIdle(attempt, correlation, record, current)
      if (current._tag === "Unresolved") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      return yield* suspendRunning(attempt, correlation, record, current)
    })

    const isUnusableActivityCensus = (census: CodexOwnedActivityCensusProjection): boolean =>
      census._tag === "Unreadable" || census._tag === "Contradictory"

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

    const projectReconciliation = Effect.fn("CodexPlannedAttemptExecutor.projectReconciliation")(function* (
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexThreadBackedRecord,
      attempt: CodexAttemptContext,
      reconciliation: ThreadReconciliation
    ) {
      if (reconciliation._tag === "Running") return exact(running(correlation))
      if (reconciliation._tag === "Terminal") {
        return exact(yield* terminalOrRunning(attempt, correlation, record, reconciliation))
      }
      if (reconciliation._tag === "Unresolved") return unreadable(correlation)
      return yield* projectIdleRecord(correlation, record)
    })

    const projectStoredRecord = Effect.fn("CodexPlannedAttemptExecutor.projectStoredRecord")(function* (
      correlation: PlannedAttemptExecutorCorrelation
    ) {
      const found = yield* store.readAttempt(correlation.runId, correlation.attemptId)
      if (Option.isNone(found)) return noReport(correlation)
      const record = found.value
      const observed = PlannedAttemptExecutorCorrelation.make({
        runId: record.correlationRunId,
        attemptId: record.correlationAttemptId
      })
      if (!sameCorrelation(observed, correlation)) return foreign(correlation, observed)
      if (!isThreadBackedRecord(record)) return noReport(correlation)
      const attempt: CodexAttemptContext = {
        attemptId: correlation.attemptId,
        runId: correlation.runId,
        worktree: record.worktree
      }
      const reconciliation = yield* reconcile(attempt, correlation, record)
      return yield* projectReconciliation(correlation, record, attempt, reconciliation)
    })

    const projectFailure = (
      correlation: PlannedAttemptExecutorCorrelation,
      error: unknown
    ): PlannedAttemptExecutorProjectionType => {
      if (error instanceof ForeignAttemptRecord) return foreign(correlation, error.observed)
      if (error instanceof CodexAppServerFailure) {
        if (error.kind === "Unavailable") return unavailable(correlation)
        if (error.kind === "CorrelationContradiction" && error.operation === "initialize") {
          return initializationContradiction(correlation, error.detail)
        }
        return unreadable(correlation)
      }
      if (storeFailure(error)) return unreadable(correlation)
      return unreadable(correlation)
    }

    const project = Effect.fn("CodexPlannedAttemptExecutor.project")(function* (
      correlation: PlannedAttemptExecutorCorrelation
    ) {
      try {
        return yield* projectStoredRecord(correlation)
      } catch (error) {
        return projectFailure(correlation, error)
      }
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
        case "AssociatedPreTurn":
        case "EmptyPreTurn":
        case "TurnIntentRecorded":
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
      if (record._tag === "TurnObserved" || record._tag === "Running" || record._tag === "SafelySuspended") {
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
      const observed = observedRecordFor(
        request.plannedAttempt,
        predecessor.threadId,
        replacementToken,
        correlatedTurn.id,
        null
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
        Effect.flatMap((terminals) => activityCensus.observe(thread, terminals)),
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
          replacementTaskTurnText(request.plannedAttempt, request.specification, predecessor, ledger.operationId),
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

    const executor: PlannedAttemptExecutorService = {
      project: (correlation) =>
        project(correlation).pipe(Effect.catch((error: unknown) => Effect.succeed(projectFailure(correlation, error)))),
      requestSuspension: (attempt) => {
        const correlation = plannedAttemptExecutorCorrelation(attempt)
        return gateFor(correlation).pipe(
          Effect.flatMap((gate) => gate.withPermit(suspend(attempt))),
          Effect.catch((error: unknown) =>
            error instanceof ForeignAttemptRecord ? Effect.succeed(foreignReport(error.observed)) : Effect.fail(error)
          ),
          Effect.mapError((error) => preserveCommandFailure("Suspend", correlation, error))
        )
      },
      startOrContinue: (request) => {
        const correlation = plannedAttemptExecutorCorrelation(request.plannedAttempt)
        return gateFor(correlation).pipe(
          Effect.flatMap((gate) => gate.withPermit(start(request))),
          Effect.catch((error: unknown) =>
            error instanceof ForeignAttemptRecord ? Effect.succeed(foreignReport(error.observed)) : Effect.fail(error)
          ),
          Effect.mapError((error) => preserveCommandFailure("StartOrContinue", correlation, error))
        )
      }
    }
    const replacementService: CodexProviderWorkUnitReplacementService = {
      replacePurgedProviderWorkUnit: (request) => {
        const correlation = plannedAttemptExecutorCorrelation(request.plannedAttempt)
        return gateFor(correlation).pipe(Effect.flatMap((gate) => gate.withPermit(replacement(request))))
      }
    }
    return Context.empty().pipe(
      Context.add(PlannedAttemptExecutor, executor),
      Context.add(CodexProviderWorkUnitReplacement, replacementService)
    )
  })
)

/** Supported production composition: use the node-owned activity census. */
export const nodeCodexPlannedAttemptExecutorLayer = codexPlannedAttemptExecutorLayer.pipe(
  Layer.provide(nodeCodexOwnedActivityCensusLayer)
)

class ForeignAttemptRecord extends Schema.TaggedError<ForeignAttemptRecord>()("ForeignAttemptRecord", {
  observed: PlannedAttemptExecutorCorrelation
}) {}

class CodexThreadMismatch extends Schema.TaggedError<CodexThreadMismatch>()("CodexThreadMismatch", {}) {}

class CodexTurnBoundaryUnknown extends Schema.TaggedError<CodexTurnBoundaryUnknown>()("CodexTurnBoundaryUnknown", {}) {}

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
