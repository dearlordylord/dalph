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
  EvidenceReference,
  evidenceReferenceEquals,
  type PlannedTaskAttempt,
  type PlannedAttemptExecutorRequest,
  type TaskWorkSpecification
} from "@dalph/contracts"
import { EvidenceStore, GitCommand, type EvidenceStoreService } from "@dalph/orchestrator"
import { Crypto, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect"
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
  CodexSealedTerminal,
  type CodexThreadId,
  type CodexTurnId,
  type CodexSealedTerminal as CodexSealedTerminalType
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
export const codexPlannedAttemptExecutorLayer = Layer.effect(
  PlannedAttemptExecutor,
  Effect.gen(function* () {
    const app = yield* CodexAppServer
    const activityCensus = yield* CodexOwnedActivityCensus
    const crypto = yield* Crypto.Crypto
    const store = yield* CodexAttemptStore
    const git = yield* GitCommand
    const evidenceStore = yield* Effect.serviceOption(EvidenceStore)
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

    return {
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
