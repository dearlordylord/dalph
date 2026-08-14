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

const commandFailure = (
  command: "StartOrContinue" | "Suspend",
  correlation: PlannedAttemptExecutorCorrelation,
  error: unknown
): PlannedAttemptExecutorCommandFailure =>
  new PlannedAttemptExecutorCommandFailure({
    command,
    correlation,
    detail: error instanceof Error ? error.message : String(error)
  })

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
  record: OwnedTurnRecord
): record is CodexObservedRecord | CodexRunningRecord | CodexSafelySuspendedRecord =>
  record._tag !== "TurnIntentRecorded" && record._tag !== "Terminal"

const ownedTurnTokenCounts = (turns: ReadonlyArray<CodexTurnSnapshot>): ReadonlyMap<string, number> =>
  turns.reduce<ReadonlyMap<string, number>>((counts, turn) => {
    if (turn.ownedTurnToken === undefined) return counts
    return new Map([...counts, [turn.ownedTurnToken, (counts.get(turn.ownedTurnToken) ?? 0) + 1] as const])
  }, new Map())

const hasDuplicateOwnedTurnTokens = (tokenCounts: ReadonlyMap<string, number>): boolean =>
  [...tokenCounts.values()].some((count) => count > 1)

const ownedTurnMatch = (thread: CodexThreadSnapshot, record: OwnedTurnRecord): TurnLookup => {
  if (hasDuplicateOwnedTurnTokens(ownedTurnTokenCounts(thread.turns))) return { _tag: "Contradiction" }
  const matching = thread.turns.filter((turn) => turn.ownedTurnToken === record.currentToken)
  if (matching.length > 1) return { _tag: "Contradiction" }
  if (matching.length === 0) {
    if (record._tag === "TurnIntentRecorded") return { _tag: "Missing" }
    return { _tag: "Contradiction" }
  }
  const turn = matching[0]
  if (turn === undefined) return { _tag: "Contradiction" }
  return { _tag: "Found", turn }
}

const priorObservedTurnIsConsistent = (
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

const ownedTurnForRecord = (thread: CodexThreadSnapshot, record: CodexAttemptRecord): TurnLookup => {
  if (record._tag === "EmptyPreTurn" || record._tag === "AssociatedPreTurn") return { _tag: "Missing" }
  const match = ownedTurnMatch(thread, record)
  if (match._tag !== "Found") return match
  if (!priorObservedTurnIsConsistent(thread, record, match.turn)) return { _tag: "Contradiction" }
  return ownedTurnCorrelation(record, match.turn)
}

const isTerminalTurn = (turn: CodexTurnSnapshot | undefined): boolean =>
  turn !== undefined && (turn.status === "completed" || turn.status === "failed")

const isActiveThread = (thread: CodexThreadSnapshot, turn: CodexTurnSnapshot | undefined): boolean =>
  thread.status === "active" || turn?.status === "inProgress"

const collectText = (value: unknown): string => {
  if (typeof value === "string") return value
  if (!isJsonRecord(value)) return ""
  const text = value["text"]
  return typeof text === "string" ? text : ""
}

type ParsedCommitMessage =
  | { readonly _tag: "Valid"; readonly candidate: string | undefined }
  | { readonly _tag: "Invalid" }

const parsedCommitFromMessage = (
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

const commitCandidates = (finalMessage: string, parsedCandidate: string | undefined): ReadonlySet<string> =>
  new Set<string>([
    ...(parsedCandidate !== undefined && /^[0-9a-f]{40}$/.test(parsedCandidate) ? [parsedCandidate] : []),
    ...Array.from(finalMessage.matchAll(commitPattern), (match) => match[1]).filter(
      (candidate): candidate is string => candidate !== undefined
    )
  ])

const decodeCommit = (candidate: string): GitCommitSha | undefined => {
  try {
    return Schema.decodeUnknownSync(GitCommitSha)(candidate)
  } catch {
    return undefined
  }
}

const decodeAcceptedManifest = (bytes: Uint8Array): typeof AcceptedResultEvidenceManifest.Type | undefined => {
  try {
    return Schema.decodeUnknownSync(AcceptedResultEvidenceManifest)(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return undefined
  }
}

const acceptedManifestMatches = (bytes: Uint8Array, expected: typeof AcceptedResultEvidenceManifest.Type): boolean => {
  const decoded = decodeAcceptedManifest(bytes)
  return decoded !== undefined && sameAcceptedManifest(decoded, expected)
}

const commitMatchesHead = (head: GitCommitSha | undefined, commit: GitCommitSha): boolean =>
  head !== undefined && head === commit

const commitFromTurn = (
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
  const candidate = [...candidates][0]
  if (candidate === undefined) return undefined
  return decodeCommit(candidate)
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

interface ThreadReconciliation {
  readonly _tag: "Running" | "Idle" | "Terminal" | "Unresolved"
  readonly thread: CodexThreadSnapshot
  readonly turn: CodexTurnSnapshot | undefined
}

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
    }).pipe(Effect.mapError(() => new CodexTurnBoundaryUnknown({})))
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
        const existing = (yield* Ref.get(gates)).get(key)
        if (existing !== undefined) return existing
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
        return record._tag === "TurnIntentRecorded"
          ? Effect.succeed({ _tag: "Unresolved" as const, thread, turn: undefined })
          : Effect.fail(new CodexTurnBoundaryUnknown({}))
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
      if (record._tag === "EmptyPreTurn") return yield* Effect.fail(new CodexThreadMismatch({}))
      const thread = yield* app.resumeThread(record.threadId, attempt.worktree)
      yield* enforceThreadIdentity(attempt, correlation, record.threadId, thread)
      if (thread.status === "notLoaded" || thread.status === "systemError") {
        return yield* Effect.fail(new CodexThreadMismatch({}))
      }
      if (record._tag === "AssociatedPreTurn") {
        return yield* reconcileAssociatedThread(thread)
      }
      return yield* reconcileOwnedTurn(thread, record)
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
      record: CodexAttemptRecord,
      turn: CodexTurnSnapshot,
      thread: CodexThreadSnapshot
    ) {
      const commit = commitFromTurn(turn, correlation)
      const head = yield* readHead(attempt)
      if (commit === undefined) {
        if (!hasOwnedTurnRecord(record)) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
        return { _tag: "Report" as const, report: yield* failed(attempt, correlation, record, turn.id, thread) }
      }
      if (head === undefined) return yield* Effect.fail(new CodexGitObservationUnknown({}))
      if (commit !== head) {
        if (!hasOwnedTurnRecord(record)) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
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
      record: CodexAttemptRecord,
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
      if (!hasOwnedTurnRecord(record)) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      yield* save(terminalRecordFor(attempt, record, turn.id, sealed, reference))
      return terminal(
        correlation,
        PlannedAttemptExecutorResult.cases.Accepted.make({ acceptedResult: { commit, evidenceManifest: reference } })
      )
    })

    const rereadAccepted = Effect.fn("CodexPlannedAttemptExecutor.rereadAccepted")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexTerminalRecord,
      turn: CodexTurnSnapshot,
      thread: CodexThreadSnapshot
    ) {
      if (!isAcceptedTerminalRecord(record)) {
        return yield* Effect.fail(new CodexEvidenceInvalid({}))
      }
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
      reconciliation: ThreadReconciliation
    ) {
      if (record._tag === "TurnIntentRecorded") {
        if (reconciliation.turn === undefined) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
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
      if (hasOwnedTurnRecord(record)) return record
      return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
    })

    const runningAfterActivity = Effect.fn("CodexPlannedAttemptExecutor.runningAfterActivity")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      observedRecord: OwnedTurnRecord,
      reconciliation: ThreadReconciliation
    ) {
      if (reconciliation.turn === undefined) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      if (observedRecord._tag === "Terminal") return running(correlation)
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
      reconciliation: ThreadReconciliation
    ) {
      const turn = reconciliation.turn
      if (turn?.status === "completed") {
        if (observedRecord._tag === "Terminal" && observedRecord.terminal._tag === "Accepted") {
          return yield* rereadAccepted(attempt, correlation, observedRecord, turn, reconciliation.thread)
        }
        return yield* accepted(attempt, correlation, observedRecord, turn, reconciliation.thread)
      }
      if (turn === undefined) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      return yield* failed(attempt, correlation, observedRecord, turn.id, reconciliation.thread)
    })

    const terminalOrRunning = Effect.fn("CodexPlannedAttemptExecutor.terminalOrRunning")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord,
      reconciliation: ThreadReconciliation
    ) {
      const observedRecord = yield* observedRecordForTerminal(attempt, record, reconciliation)
      const census = yield* observeOwnedActivity(reconciliation.thread)
      if (censusHasActivity(census)) {
        return yield* runningAfterActivity(attempt, correlation, observedRecord, reconciliation)
      }
      return yield* finishTerminalOrFailed(attempt, correlation, observedRecord, reconciliation)
    })

    const reconcileAfterTurnBoundary = Effect.fn("CodexPlannedAttemptExecutor.reconcileAfterTurnBoundary")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord
    ) {
      const reconciliation = yield* reconcile(attempt, correlation, record)
      if (reconciliation._tag === "Running") {
        if (record._tag === "TurnIntentRecorded") {
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
        } else if (record._tag === "TurnObserved" || record._tag === "Running" || record._tag === "SafelySuspended") {
          yield* save(runningRecordFor(attempt, record))
        } else {
          return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
        }
        return running(correlation)
      }
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
      if (record._tag === "EmptyPreTurn") return yield* Effect.fail(new CodexThreadMismatch({}))
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

    const loadStartRecord = Effect.fn("CodexPlannedAttemptExecutor.loadStartRecord")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation
    ) {
      let found: Option.Option<CodexAttemptRecord>
      try {
        found = yield* readRecord(correlation, attempt)
      } catch (error) {
        if (error instanceof ForeignAttemptRecord) return yield* Effect.fail(error)
        return yield* Effect.fail(error)
      }
      if (Option.isNone(found)) {
        return yield* allocateThread(attempt, correlation)
      }
      const record = found.value
      if (!isThreadBackedRecord(record)) return yield* allocateThread(attempt, correlation)
      return record
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
      if (reconciliation._tag === "Running" || reconciliation._tag === "Terminal") {
        return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
      if (reconciliation._tag === "Unresolved") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      return record
    })

    const saveRunningStartRecord = Effect.fn("CodexPlannedAttemptExecutor.saveRunningStartRecord")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexThreadBackedRecord,
      reconciliation: ThreadReconciliation
    ) {
      if (record._tag === "TurnIntentRecorded") {
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
      } else if (record._tag === "TurnObserved" || record._tag === "Running" || record._tag === "SafelySuspended") {
        yield* save(runningRecordFor(attempt, record))
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
      let record = yield* loadStartRecord(attempt, correlation)
      if (record._tag === "AssociatedPreTurn") {
        record = yield* reconcileAssociatedStart(attempt, correlation, record)
      } else {
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
      if (record._tag === "TurnIntentRecorded") {
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
      } else if (record._tag === "TurnObserved" || record._tag === "Running" || record._tag === "SafelySuspended") {
        yield* save(safelySuspendedRecordFor(attempt, record))
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
          Effect.mapError((error) =>
            error instanceof PlannedAttemptExecutorCommandFailure
              ? error
              : commandFailure("Suspend", correlation, error)
          )
        )
      },
      startOrContinue: (request) => {
        const correlation = plannedAttemptExecutorCorrelation(request.plannedAttempt)
        return gateFor(correlation).pipe(
          Effect.flatMap((gate) => gate.withPermit(start(request))),
          Effect.catch((error: unknown) =>
            error instanceof ForeignAttemptRecord ? Effect.succeed(foreignReport(error.observed)) : Effect.fail(error)
          ),
          Effect.mapError((error) =>
            error instanceof PlannedAttemptExecutorCommandFailure
              ? error
              : commandFailure("StartOrContinue", correlation, error)
          )
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
