/* eslint-disable max-lines -- The bounded executor chronology stays co-located for auditability. */
import {
  AcceptedResultEvidenceManifest,
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
  type EvidenceReference,
  type PlannedTaskAttempt,
  type PlannedAttemptExecutorRequest,
  type TaskWorkSpecification
} from "@dalph/contracts"
import { EvidenceStore, GitCommand } from "@dalph/orchestrator"
import { Effect, Layer, Option, Ref, Schema, Semaphore } from "effect"
import {
  CodexAppServer,
  CodexAppServerFailure,
  type CodexThreadSnapshot,
  type CodexTurnSnapshot
} from "./codex-app-server.js"
import {
  CodexAttemptRecord,
  CodexAttemptStore,
  CodexAttemptStoreFailure,
  CodexSealedTerminal,
  type CodexAttemptPhase,
  type CodexThreadId,
  type CodexTurnId,
  type CodexSealedTerminal as CodexSealedTerminalType
} from "./codex-attempt-store.js"

/** A terminal Codex message must contain one unambiguous 40-character commit. */
const commitPattern = /(?<![0-9a-f])([0-9a-f]{40})(?![0-9a-f])/g
const lastElementOffset = -1
const noRecordedTurnIndex = -1

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

const noReport = (correlation: PlannedAttemptExecutorCorrelation): PlannedAttemptExecutorProjectionType =>
  PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })

const exact = (report: PlannedAttemptExecutorReportType): PlannedAttemptExecutorProjectionType =>
  PlannedAttemptExecutorProjection.cases.Exact.make({ report })

const unavailable = (correlation: PlannedAttemptExecutorCorrelation): PlannedAttemptExecutorProjectionType =>
  PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({ correlation })

const unreadable = (correlation: PlannedAttemptExecutorCorrelation): PlannedAttemptExecutorProjectionType =>
  PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation })

const foreign = (
  expected: PlannedAttemptExecutorCorrelation,
  observed: PlannedAttemptExecutorCorrelation
): PlannedAttemptExecutorProjectionType =>
  PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
    expected,
    observed: PlannedAttemptExecutorReport.cases.Running.make({ correlation: observed })
  })

const recordFor = (
  attempt: Pick<PlannedTaskAttempt, "attemptId" | "runId" | "worktree">,
  phase: CodexAttemptPhase,
  threadId: CodexThreadId | null,
  turnId: CodexTurnId | null,
  turnMayHaveStarted: boolean,
  terminalResult: CodexSealedTerminalType | null = null,
  evidenceManifest: EvidenceReference | null = null
): CodexAttemptRecord =>
  CodexAttemptRecord.make({
    attemptId: attempt.attemptId,
    correlationAttemptId: attempt.attemptId,
    correlationRunId: attempt.runId,
    evidenceManifest,
    phase,
    terminal: terminalResult,
    threadId,
    turnId,
    turnMayHaveStarted,
    worktree: attempt.worktree
  })

const sameCorrelation = (left: PlannedAttemptExecutorCorrelation, right: PlannedAttemptExecutorCorrelation): boolean =>
  left.runId === right.runId && left.attemptId === right.attemptId

const turnForRecord = (thread: CodexThreadSnapshot, record: CodexAttemptRecord): CodexTurnSnapshot | undefined => {
  if (record.turnId === null) {
    // A TurnMayHaveStarted record with no turn id is the only ambiguous cut:
    // a lost first turn response may have left exactly one newly persisted turn.
    return record.phase === "TurnMayHaveStarted" ? thread.turns.at(lastElementOffset) : undefined
  }
  const recordedIndex = thread.turns.findIndex((turn) => turn.id === record.turnId)
  if (recordedIndex < 0) return undefined
  if (record.phase === "TurnMayHaveStarted") {
    // A continuation response may be lost after a new turn is appended. The
    // later turn is admissible only because the crossing intent was durable.
    return thread.turns.slice(recordedIndex + 1).at(lastElementOffset) ?? thread.turns[recordedIndex]
  }
  return thread.turns[recordedIndex]
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

const commitFromTurn = (turn: CodexTurnSnapshot | undefined): GitCommitSha | undefined => {
  if (turn === undefined) return undefined
  const messages = turn.items
    .filter(isJsonRecord)
    .filter((item) => item["type"] === "agentMessage")
    .map(collectText)
  const finalMessage = messages.at(lastElementOffset)
  if (finalMessage === undefined) return undefined
  let parsedCandidate: string | undefined
  try {
    const parsed: unknown = JSON.parse(finalMessage)
    if (isJsonRecord(parsed) && typeof parsed["commit"] === "string") {
      parsedCandidate = parsed["commit"]
    }
  } catch {
    // Plain-text final messages are handled by the exact-token pass below.
  }
  const candidates = new Set<string>([
    ...(parsedCandidate !== undefined && /^[0-9a-f]{40}$/.test(parsedCandidate) ? [parsedCandidate] : []),
    ...Array.from(finalMessage.matchAll(commitPattern), (match) => match[1]).filter(
      (candidate): candidate is string => candidate !== undefined
    )
  ])
  if (candidates.size !== 1) return undefined
  const candidate = [...candidates][0]
  if (candidate === undefined) return undefined
  try {
    return Schema.decodeUnknownSync(GitCommitSha)(candidate)
  } catch {
    return undefined
  }
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
    `worktree: ${attempt.worktree}`
  ].join("\n")

const storeFailure = (error: unknown): error is CodexAttemptStoreFailure => error instanceof CodexAttemptStoreFailure

interface ThreadReconciliation {
  readonly _tag: "Running" | "Idle" | "Terminal"
  readonly thread: CodexThreadSnapshot
  readonly turn: CodexTurnSnapshot | undefined
}

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
    const store = yield* CodexAttemptStore
    const git = yield* GitCommand
    const evidenceStore = yield* Effect.serviceOption(EvidenceStore)
    const gates = yield* Ref.make<ReadonlyMap<string, Semaphore.Semaphore>>(new Map())

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

    const reportForRecord = (
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord
    ): PlannedAttemptExecutorReportType | undefined => {
      if (record.phase === "Terminal" && record.terminal !== null) {
        if (record.terminal._tag === "Accepted") {
          return terminal(
            correlation,
            PlannedAttemptExecutorResult.cases.Accepted.make({
              acceptedResult: { commit: record.terminal.commit, evidenceManifest: record.terminal.evidenceManifest }
            })
          )
        }
        return terminal(correlation, { _tag: "Failed" })
      }
      if (record.phase === "SafelySuspended") return suspended(correlation)
      if (record.phase === "Running" || record.phase === "TurnMayHaveStarted") return running(correlation)
      return undefined
    }

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

    const reconcile = Effect.fn("CodexPlannedAttemptExecutor.reconcile")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord
    ) {
      if (record.threadId === null) return yield* Effect.fail(new CodexThreadMismatch({}))
      const thread = yield* app.resumeThread(record.threadId, attempt.worktree)
      yield* enforceThreadIdentity(attempt, correlation, record.threadId, thread)
      if (thread.status === "notLoaded" || thread.status === "systemError") {
        return yield* Effect.fail(new CodexThreadMismatch({}))
      }
      const recordedIndex =
        record.turnId === null
          ? noRecordedTurnIndex
          : thread.turns.findIndex((candidate) => candidate.id === record.turnId)
      const laterTurnCount = recordedIndex === noRecordedTurnIndex ? 0 : thread.turns.length - recordedIndex - 1
      if (
        (record.phase === "TurnMayHaveStarted" &&
          ((record.turnId === null && thread.turns.length > 1) || (record.turnId !== null && laterTurnCount > 1))) ||
        (record.phase !== "TurnMayHaveStarted" && laterTurnCount > 0)
      ) {
        return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
      const turn = turnForRecord(thread, record)
      if (
        record.phase === "TurnMayHaveStarted" &&
        record.turnId !== null &&
        laterTurnCount === 0 &&
        isTerminalTurn(turn)
      ) {
        return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
      if (record.phase === "AssociatedPreTurn" && (thread.turns.length > 0 || thread.status === "active")) {
        return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
      if (record.turnId !== null && turn === undefined) {
        return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
      if (isTerminalTurn(turn)) return { _tag: "Terminal" as const, thread, turn }
      if (isActiveThread(thread, turn)) return { _tag: "Running" as const, thread, turn }
      return { _tag: "Idle" as const, thread, turn }
    })

    const noOwnedActivity = Effect.fn("CodexPlannedAttemptExecutor.noOwnedActivity")(function* (
      threadId: CodexThreadId
    ) {
      const activities = yield* app.listBackgroundTerminals(threadId)
      return activities.length === 0
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
      record: CodexAttemptRecord,
      turn: CodexTurnSnapshot
    ) {
      const commit = commitFromTurn(turn)
      const head = yield* readHead(attempt)
      if (commit === undefined || head === undefined || commit !== head || Option.isNone(evidenceStore)) {
        return yield* failed(attempt, correlation, record, turn.id)
      }
      const manifest = AcceptedResultEvidenceManifest.make({
        commit,
        correlation,
        formatVersion: 1,
        outcome: "Accepted",
        predecessor: null
      })
      const bytes = new TextEncoder().encode(JSON.stringify(manifest))
      const reference = yield* evidenceStore.value.put(bytes)
      const reread = yield* evidenceStore.value.read(reference)
      let decoded: typeof AcceptedResultEvidenceManifest.Type
      try {
        decoded = Schema.decodeUnknownSync(AcceptedResultEvidenceManifest)(JSON.parse(new TextDecoder().decode(reread)))
      } catch {
        return yield* failed(attempt, correlation, record, turn.id)
      }
      if (decoded.commit !== commit || !sameCorrelation(decoded.correlation, correlation)) {
        return yield* failed(attempt, correlation, record, turn.id)
      }
      const rereadHead = yield* readHead(attempt)
      if (rereadHead === undefined || rereadHead !== commit) {
        return yield* failed(attempt, correlation, record, turn.id)
      }
      const sealed = CodexSealedTerminal.cases.Accepted.make({ commit, evidenceManifest: reference })
      yield* save(recordFor(attempt, "Terminal", record.threadId, turn.id, true, sealed, reference))
      return terminal(
        correlation,
        PlannedAttemptExecutorResult.cases.Accepted.make({ acceptedResult: { commit, evidenceManifest: reference } })
      )
    })

    const failed = Effect.fn("CodexPlannedAttemptExecutor.failed")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord,
      turnId: CodexTurnId | null = record.turnId
    ) {
      yield* save(
        recordFor(attempt, "Terminal", record.threadId, turnId, true, CodexSealedTerminal.cases.Failed.make({}), null)
      )
      return terminal(correlation, { _tag: "Failed" })
    })

    const terminalOrRunning = Effect.fn("CodexPlannedAttemptExecutor.terminalOrRunning")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord,
      reconciliation: ThreadReconciliation
    ) {
      if (!(yield* noOwnedActivity(reconciliation.thread.id))) {
        yield* save(recordFor(attempt, "Running", record.threadId, reconciliation.turn?.id ?? record.turnId, true))
        return running(correlation)
      }
      const turn = reconciliation.turn
      if (turn?.status === "completed") {
        return yield* accepted(attempt, correlation, record, turn).pipe(
          Effect.catch(() => failed(attempt, correlation, record, turn.id))
        )
      }
      return yield* failed(attempt, correlation, record, turn?.id ?? record.turnId)
    })

    const reconcileAfterTurnBoundary = Effect.fn("CodexPlannedAttemptExecutor.reconcileAfterTurnBoundary")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord
    ) {
      const reconciliation = yield* reconcile(attempt, correlation, record)
      if (reconciliation._tag === "Running") {
        const activeTurn = reconciliation.turn?.id ?? record.turnId
        yield* save(recordFor(attempt, "Running", record.threadId, activeTurn, true))
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
      yield* save(recordFor(attempt, "EmptyPreTurn", null, null, false))
      const thread = yield* app.startThread(attempt.worktree)
      yield* enforceThreadIdentity(attempt, correlation, thread.id, thread)
      const associated = recordFor(attempt, "AssociatedPreTurn", thread.id, null, false)
      yield* save(associated)
      return associated
    })

    const sendTurn = Effect.fn("CodexPlannedAttemptExecutor.sendTurn")(function* (
      attempt: PlannedTaskAttempt,
      specification: TaskWorkSpecification,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord
    ) {
      if (record.threadId === null) return yield* Effect.fail(new CodexThreadMismatch({}))
      // Persist the crossing intent before turn/start. A lost response can
      // therefore be reconciled without sending a second turn.
      const intent = recordFor(attempt, "TurnMayHaveStarted", record.threadId, record.turnId, true)
      yield* save(intent)
      const result = yield* app.startTurn(record.threadId, attempt.worktree, taskTurnText(attempt, specification)).pipe(
        Effect.map((turn) => ({ _tag: "Turn" as const, turn })),
        Effect.catch((error) =>
          reconcileAfterTurnBoundary(attempt, correlation, intent).pipe(
            Effect.map((report) => ({ _tag: "Report" as const, report })),
            Effect.catch(() => Effect.fail(error))
          )
        )
      )
      if (result._tag === "Report") return result.report
      const turn = result.turn
      yield* enforceThreadIdentity(attempt, correlation, record.threadId, {
        id: record.threadId,
        cwd: attempt.worktree,
        status: turn.status === "inProgress" ? "active" : "idle",
        turns: [turn]
      })
      const withTurn = recordFor(
        attempt,
        turn.status === "inProgress" ? "Running" : "TurnMayHaveStarted",
        record.threadId,
        turn.id,
        true
      )
      yield* save(withTurn)
      if (turn.status === "inProgress") return running(correlation)
      return yield* terminalOrRunning(attempt, correlation, withTurn, {
        _tag: "Terminal" as const,
        thread: { id: record.threadId, cwd: attempt.worktree, status: "idle", turns: [turn] },
        turn
      })
    })

    const start = Effect.fn("CodexPlannedAttemptExecutor.start")(function* (request: PlannedAttemptExecutorRequest) {
      const attempt = request.plannedAttempt
      const correlation = plannedAttemptExecutorCorrelation(attempt)
      let found: Option.Option<CodexAttemptRecord>
      try {
        found = yield* readRecord(correlation, attempt)
      } catch (error) {
        if (error instanceof ForeignAttemptRecord) return yield* Effect.fail(error)
        return yield* Effect.fail(error)
      }
      let record: CodexAttemptRecord
      if (Option.isNone(found)) {
        record = yield* allocateThread(attempt, correlation)
      } else {
        record = found.value
      }
      const existingReport = reportForRecord(correlation, record)
      if (existingReport !== undefined && (record.phase === "Terminal" || record.phase === "Running")) {
        if (record.phase === "Running") {
          const reconciliation = yield* reconcile(attempt, correlation, record)
          if (reconciliation._tag === "Running") return running(correlation)
          if (reconciliation._tag === "Terminal")
            return yield* terminalOrRunning(attempt, correlation, record, reconciliation)
          return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
        }
        return existingReport
      }
      if (record.phase === "EmptyPreTurn") {
        record = yield* allocateThread(attempt, correlation)
      }
      if (record.threadId === null) return yield* Effect.fail(new CodexThreadMismatch({}))
      if (record.phase === "TurnMayHaveStarted" || record.phase === "SafelySuspended") {
        const reconciliation = yield* reconcile(attempt, correlation, record)
        if (reconciliation._tag === "Running") {
          yield* save(recordFor(attempt, "Running", record.threadId, reconciliation.turn?.id ?? record.turnId, true))
          return running(correlation)
        }
        if (reconciliation._tag === "Terminal")
          return yield* terminalOrRunning(attempt, correlation, record, reconciliation)
        if (record.phase === "TurnMayHaveStarted") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      } else if (record.phase === "AssociatedPreTurn") {
        const reconciliation = yield* reconcile(attempt, correlation, record).pipe(
          Effect.catch((error: unknown) =>
            record.turnId === null &&
            !record.turnMayHaveStarted &&
            error instanceof CodexAppServerFailure &&
            error.kind === "NotFound"
              ? Effect.succeed<ThreadReconciliation | undefined>(undefined)
              : Effect.fail(error)
          )
        )
        if (reconciliation === undefined) {
          // Only a conclusively absent empty pre-turn thread may be replaced.
          record = yield* allocateThread(attempt, correlation)
        } else {
          if (reconciliation._tag === "Running") return running(correlation)
          if (reconciliation._tag === "Terminal")
            return yield* terminalOrRunning(attempt, correlation, record, reconciliation)
        }
      }
      return yield* sendTurn(attempt, request.specification, correlation, record)
    })

    const suspend = Effect.fn("CodexPlannedAttemptExecutor.suspend")(function* (attempt: PlannedTaskAttempt) {
      const correlation = plannedAttemptExecutorCorrelation(attempt)
      const found = yield* store.readAttempt(correlation.runId, correlation.attemptId)
      if (Option.isNone(found)) return yield* Effect.fail(new CodexThreadMismatch({}))
      const record = found.value
      if (record.correlationAttemptId !== correlation.attemptId || record.correlationRunId !== correlation.runId) {
        return yield* Effect.fail(
          new ForeignAttemptRecord({
            observed: PlannedAttemptExecutorCorrelation.make({
              attemptId: record.correlationAttemptId,
              runId: record.correlationRunId
            })
          })
        )
      }
      const existingReport = reportForRecord(correlation, record)
      if (record.phase === "Terminal" && existingReport !== undefined) return existingReport
      if (record.threadId === null) return yield* Effect.fail(new CodexThreadMismatch({}))
      const current = yield* reconcile(attempt, correlation, record)
      if (current._tag === "Terminal") return yield* terminalOrRunning(attempt, correlation, record, current)
      if (current._tag === "Idle") {
        if (!(yield* noOwnedActivity(record.threadId))) return running(correlation)
        yield* save(recordFor(attempt, "SafelySuspended", record.threadId, record.turnId, true))
        return suspended(correlation)
      }
      const turnId = current.turn?.id ?? record.turnId
      if (turnId === null) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      const interruptedIntent = recordFor(attempt, "TurnMayHaveStarted", record.threadId, turnId, true)
      yield* save(interruptedIntent)
      // Exactly one interrupt is issued. The post-boundary read decides both
      // the lost-response and terminal-during-suspension races.
      yield* app.interruptTurn(record.threadId, turnId).pipe(
        Effect.catch((error) =>
          reconcile(attempt, correlation, interruptedIntent).pipe(
            Effect.flatMap((after) => {
              if (after._tag === "Terminal")
                return terminalOrRunning(attempt, correlation, interruptedIntent, after).pipe(Effect.asVoid)
              if (after._tag === "Idle") return Effect.void
              return Effect.fail(error)
            })
          )
        )
      )
      const after = yield* reconcile(attempt, correlation, interruptedIntent)
      if (after._tag === "Terminal") return yield* terminalOrRunning(attempt, correlation, interruptedIntent, after)
      if (after._tag === "Running") return running(correlation)
      if (!(yield* noOwnedActivity(record.threadId))) return running(correlation)
      yield* save(recordFor(attempt, "SafelySuspended", record.threadId, turnId, true))
      return suspended(correlation)
    })

    const project = Effect.fn("CodexPlannedAttemptExecutor.project")(function* (
      correlation: PlannedAttemptExecutorCorrelation
    ) {
      try {
        const found = yield* store.readAttempt(correlation.runId, correlation.attemptId)
        if (Option.isNone(found)) return noReport(correlation)
        const record = found.value
        const observed = PlannedAttemptExecutorCorrelation.make({
          runId: record.correlationRunId,
          attemptId: record.correlationAttemptId
        })
        if (!sameCorrelation(observed, correlation)) return foreign(correlation, observed)
        if (record.phase === "EmptyPreTurn") return noReport(correlation)
        const existingReport = reportForRecord(correlation, record)
        if (record.phase === "Terminal" && existingReport !== undefined) return exact(existingReport)
        if (record.threadId === null) return unreadable(correlation)
        const attempt: CodexAttemptContext = {
          attemptId: correlation.attemptId,
          runId: correlation.runId,
          worktree: record.worktree
        }
        const reconciliation = yield* reconcile(attempt, correlation, record)
        if (reconciliation._tag === "Running") return exact(running(correlation))
        if (reconciliation._tag === "Terminal")
          return exact(yield* terminalOrRunning(attempt, correlation, record, reconciliation))
        if (
          record.phase === "AssociatedPreTurn" &&
          reconciliation.turn === undefined &&
          reconciliation.thread.turns.length === 0
        ) {
          return noReport(correlation)
        }
        if (!(yield* noOwnedActivity(record.threadId))) return exact(running(correlation))
        if (record.phase === "SafelySuspended") return exact(suspended(correlation))
        return unreadable(correlation)
      } catch (error) {
        if (error instanceof ForeignAttemptRecord) return foreign(correlation, error.observed)
        if (error instanceof CodexAppServerFailure) {
          return error.kind === "Unavailable" ? unavailable(correlation) : unreadable(correlation)
        }
        if (storeFailure(error)) return unreadable(correlation)
        return unreadable(correlation)
      }
    })

    return {
      project: (correlation) =>
        project(correlation).pipe(
          Effect.catch((error: unknown) => {
            if (error instanceof ForeignAttemptRecord) return Effect.succeed(foreign(correlation, error.observed))
            if (error instanceof CodexAppServerFailure) {
              return Effect.succeed(error.kind === "Unavailable" ? unavailable(correlation) : unreadable(correlation))
            }
            if (storeFailure(error)) return Effect.succeed(unreadable(correlation))
            return Effect.succeed(unreadable(correlation))
          })
        ),
      requestSuspension: (attempt) => {
        const correlation = plannedAttemptExecutorCorrelation(attempt)
        return gateFor(correlation).pipe(
          Effect.flatMap((gate) => gate.withPermit(suspend(attempt))),
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

/** Compatibility alias emphasizing that this is the production executor. */
export const codexPlannedAttemptExecutorNodeLayer = codexPlannedAttemptExecutorLayer

/** Conventional node-prefixed alias used by application composition. */
export const nodeCodexPlannedAttemptExecutorLayer = codexPlannedAttemptExecutorLayer

class ForeignAttemptRecord extends Schema.TaggedError<ForeignAttemptRecord>()("ForeignAttemptRecord", {
  observed: PlannedAttemptExecutorCorrelation
}) {}

class CodexThreadMismatch extends Schema.TaggedError<CodexThreadMismatch>()("CodexThreadMismatch", {}) {}

class CodexTurnBoundaryUnknown extends Schema.TaggedError<CodexTurnBoundaryUnknown>()("CodexTurnBoundaryUnknown", {}) {}
