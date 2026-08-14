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
import { Crypto, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect"
import {
  CodexAppServer,
  CodexAppServerFailure,
  CodexOwnedActivityCensus,
  nodeCodexOwnedActivityCensusLayer,
  type CodexOwnedActivityCensusProjection,
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

const sameCorrelation = (left: PlannedAttemptExecutorCorrelation, right: PlannedAttemptExecutorCorrelation): boolean =>
  left.runId === right.runId && left.attemptId === right.attemptId

type CodexEmptyRecord = Extract<CodexAttemptRecord, { readonly _tag: "EmptyPreTurn" }>
type CodexAssociatedRecord = Extract<CodexAttemptRecord, { readonly _tag: "AssociatedPreTurn" }>
type CodexIntentRecord = Extract<CodexAttemptRecord, { readonly _tag: "TurnIntentRecorded" }>
type CodexObservedRecord = Extract<CodexAttemptRecord, { readonly _tag: "TurnObserved" }>
type CodexRunningRecord = Extract<CodexAttemptRecord, { readonly _tag: "Running" }>
type CodexSafelySuspendedRecord = Extract<CodexAttemptRecord, { readonly _tag: "SafelySuspended" }>
type CodexTerminalRecord = Extract<CodexAttemptRecord, { readonly _tag: "Terminal" }>

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

const ownedTurnForRecord = (thread: CodexThreadSnapshot, record: CodexAttemptRecord): TurnLookup => {
  if (record._tag === "EmptyPreTurn" || record._tag === "AssociatedPreTurn") return { _tag: "Missing" }
  const tokenCounts = thread.turns.reduce<ReadonlyMap<string, number>>((counts, turn) => {
    if (turn.ownedTurnToken === undefined) return counts
    return new Map([...counts, [turn.ownedTurnToken, (counts.get(turn.ownedTurnToken) ?? 0) + 1] as const])
  }, new Map())
  if ([...tokenCounts.values()].some((count) => count > 1)) return { _tag: "Contradiction" }
  const matching = thread.turns.filter((turn) => turn.ownedTurnToken === record.currentToken)
  if (matching.length > 1) return { _tag: "Contradiction" }
  if (matching.length === 0) {
    if (record._tag === "TurnIntentRecorded") return { _tag: "Missing" }
    return { _tag: "Contradiction" }
  }
  const turn = matching[0]
  if (turn === undefined) return { _tag: "Contradiction" }
  if ("observedTurnId" in record && turn.id !== record.observedTurnId) return { _tag: "Contradiction" }
  if (record.priorObservedTurnId !== null) {
    if (turn.id === record.priorObservedTurnId) return { _tag: "Contradiction" }
    const prior = thread.turns.find((candidate) => candidate.id === record.priorObservedTurnId)
    if (prior === undefined || prior.ownedTurnToken === undefined) return { _tag: "Contradiction" }
  }
  if (turn.correlation !== undefined) {
    const expected = PlannedAttemptExecutorCorrelation.make({
      attemptId: record.correlationAttemptId,
      runId: record.correlationRunId
    })
    if (!sameCorrelation(turn.correlation, expected)) return { _tag: "Foreign", observed: turn.correlation }
  }
  return { _tag: "Found", turn }
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
  let parsedCandidate: string | undefined
  try {
    const parsed: unknown = JSON.parse(finalMessage)
    if (!isJsonRecord(parsed)) return undefined
    const responseCorrelation = parsed["correlation"]
    if (responseCorrelation === undefined) return undefined
    const decoded = Schema.decodeUnknownSync(PlannedAttemptExecutorCorrelation)(responseCorrelation)
    if (!sameCorrelation(decoded, expectedCorrelation)) return undefined
    if (typeof parsed["commit"] === "string") parsedCandidate = parsed["commit"]
  } catch {
    return undefined
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
    `worktree: ${attempt.worktree}`,
    'Accepted results must be the final JSON object {"commit":"<40-hex>","correlation":{"runId":"...","attemptId":"..."}}.'
  ].join("\n")

const storeFailure = (error: unknown): error is CodexAttemptStoreFailure => error instanceof CodexAttemptStoreFailure

interface ThreadReconciliation {
  readonly _tag: "Running" | "Idle" | "Terminal" | "Unresolved"
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
    const activityCensus = yield* CodexOwnedActivityCensus
    const crypto = yield* Crypto.Crypto
    const store = yield* CodexAttemptStore
    const git = yield* GitCommand
    const evidenceStore = yield* Effect.serviceOption(EvidenceStore)
    const gates = yield* Ref.make<ReadonlyMap<string, Semaphore.Semaphore>>(new Map())
    const freshOwnedTurnToken = Effect.gen(function* () {
      return CodexOwnedTurnToken.make(yield* crypto.randomUUIDv4)
    }).pipe(Effect.mapError(() => new CodexTurnBoundaryUnknown({})))

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
        if (thread.turns.some((turn) => turn.ownedTurnToken !== undefined) || thread.status === "active") {
          return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
        }
        return { _tag: "Idle" as const, thread, turn: undefined }
      }
      const lookup = ownedTurnForRecord(thread, record)
      if (lookup._tag === "Contradiction") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      if (lookup._tag === "Foreign") return yield* Effect.fail(new ForeignAttemptRecord({ observed: lookup.observed }))
      if (lookup._tag === "Missing") {
        if (record._tag === "TurnIntentRecorded") return { _tag: "Unresolved" as const, thread, turn: undefined }
        return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
      const turn = lookup.turn
      if (isTerminalTurn(turn)) return { _tag: "Terminal" as const, thread, turn }
      if (isActiveThread(thread, turn)) return { _tag: "Running" as const, thread, turn }
      return { _tag: "Idle" as const, thread, turn }
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

    // Suspension owns every app-server activity and execution-substrate
    // descendant returned by the attempt census. Every termination is followed
    // by a fresh thread/list/group observation; unreadable, contradictory, or
    // surviving activity never becomes safe capacity.
    const quiesceOwnedActivity = Effect.fn("CodexPlannedAttemptExecutor.quiesceOwnedActivity")(function* (
      threadId: CodexThreadId
    ) {
      const maxQuiescePasses = 3
      for (let remaining = maxQuiescePasses; remaining >= 0; remaining -= 1) {
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
        for (const terminal of backgroundTerminals) {
          const terminated = yield* app.terminateBackgroundTerminal(threadId, terminal.processId)
          if (!terminated) {
            return yield* Effect.fail(
              new CodexActivityCensusUnknown({ detail: `background activity ${terminal.processId} survived` })
            )
          }
        }
        const descendants = census.activities.flatMap((activity) =>
          activity._tag === "ProcessGroupDescendant" ? [activity.identity] : []
        )
        if (descendants.length > 0) {
          const uniqueDescendants = [
            ...new Map(descendants.map((identity) => [`${identity.pid}:${identity.startIdentity}`, identity])).values()
          ]
          yield* activityCensus.terminateDescendants(uniqueDescendants)
        }
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
      record: CodexAttemptRecord,
      turn: CodexTurnSnapshot,
      thread: CodexThreadSnapshot
    ) {
      const commit = commitFromTurn(turn, correlation)
      const head = yield* readHead(attempt)
      if (commit === undefined) {
        if (!hasOwnedTurnRecord(record)) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
        return yield* failed(attempt, correlation, record, turn.id, thread)
      }
      if (head === undefined) return yield* Effect.fail(new CodexGitObservationUnknown({}))
      if (commit !== head) {
        if (!hasOwnedTurnRecord(record)) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
        return yield* failed(attempt, correlation, record, turn.id, thread)
      }
      if (Option.isNone(evidenceStore)) return yield* Effect.fail(new CodexEvidenceUnavailable({}))
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
        return yield* Effect.fail(new CodexEvidenceInvalid({}))
      }
      if (decoded.commit !== commit || !sameCorrelation(decoded.correlation, correlation)) {
        return yield* Effect.fail(new CodexEvidenceInvalid({}))
      }
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
      record: Extract<CodexAttemptRecord, { readonly _tag: "Terminal" }>,
      turn: CodexTurnSnapshot,
      thread: CodexThreadSnapshot
    ) {
      if (record.terminal._tag !== "Accepted" || record.evidenceManifest === null) {
        return yield* Effect.fail(new CodexEvidenceInvalid({}))
      }
      if (Option.isNone(evidenceStore)) return yield* Effect.fail(new CodexEvidenceUnavailable({}))
      if (commitFromTurn(turn, correlation) !== record.terminal.commit)
        return yield* Effect.fail(new CodexEvidenceInvalid({}))
      const bytes = yield* evidenceStore.value.read(record.evidenceManifest)
      let manifest: typeof AcceptedResultEvidenceManifest.Type
      try {
        manifest = Schema.decodeUnknownSync(AcceptedResultEvidenceManifest)(JSON.parse(new TextDecoder().decode(bytes)))
      } catch {
        return yield* Effect.fail(new CodexEvidenceInvalid({}))
      }
      if (manifest.commit !== record.terminal.commit || !sameCorrelation(manifest.correlation, correlation)) {
        return yield* Effect.fail(new CodexEvidenceInvalid({}))
      }
      const head = yield* readHead(attempt)
      if (head === undefined || head !== record.terminal.commit) {
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

    const terminalOrRunning = Effect.fn("CodexPlannedAttemptExecutor.terminalOrRunning")(function* (
      attempt: CodexAttemptContext,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord,
      reconciliation: ThreadReconciliation
    ) {
      let observedRecord: OwnedTurnRecord
      if (record._tag === "TurnIntentRecorded") {
        if (reconciliation.turn === undefined) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
        observedRecord = observedRecordFor(
          attempt,
          record.threadId,
          record.currentToken,
          reconciliation.turn.id,
          record.priorObservedTurnId
        )
        yield* save(observedRecord)
      } else if (hasOwnedTurnRecord(record)) {
        observedRecord = record
      } else {
        return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
      const census = yield* observeOwnedActivity(reconciliation.thread)
      if (censusHasActivity(census)) {
        if (reconciliation.turn === undefined) {
          return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
        }
        if (observedRecord._tag === "Terminal") return running(correlation)
        yield* save(runningRecordFor(attempt, observedRecord))
        return running(correlation)
      }
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

    const reconcileAfterTurnBoundary = Effect.fn("CodexPlannedAttemptExecutor.reconcileAfterTurnBoundary")(function* (
      attempt: PlannedTaskAttempt,
      correlation: PlannedAttemptExecutorCorrelation,
      record: CodexAttemptRecord
    ) {
      const reconciliation = yield* reconcile(attempt, correlation, record)
      if (reconciliation._tag === "Running") {
        if (record._tag === "TurnIntentRecorded") {
          const observed = observedRecordFor(
            attempt,
            record.threadId,
            record.currentToken,
            reconciliation.turn.id,
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
      const result = yield* app
        .startTurn(record.threadId, attempt.worktree, taskTurnText(attempt, specification), currentToken)
        .pipe(
          Effect.map((turn) => ({ _tag: "Turn" as const, turn })),
          Effect.catch((error) =>
            reconcileAfterTurnBoundary(attempt, correlation, intent).pipe(
              Effect.map((report) => ({ _tag: "Report" as const, report })),
              Effect.catch(() => Effect.fail(error))
            )
          )
        )
      if (result._tag === "Report") return result.report
      const turn =
        result.turn.ownedTurnToken === undefined ? { ...result.turn, ownedTurnToken: currentToken } : result.turn
      if (turn.ownedTurnToken !== currentToken) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      yield* enforceThreadIdentity(attempt, correlation, record.threadId, {
        id: record.threadId,
        cwd: attempt.worktree,
        status: turn.status === "inProgress" ? "active" : "idle",
        turns: [turn]
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
      if (record._tag === "EmptyPreTurn") record = yield* allocateThread(attempt, correlation)
      if (record._tag === "AssociatedPreTurn") {
        const reconciliation = yield* reconcile(attempt, correlation, record).pipe(
          Effect.catch((error: unknown) =>
            error instanceof CodexAppServerFailure && error.kind === "NotFound"
              ? Effect.succeed<ThreadReconciliation | undefined>(undefined)
              : Effect.fail(error)
          )
        )
        if (reconciliation === undefined) {
          // Only a conclusively absent empty pre-turn thread may be replaced.
          record = yield* allocateThread(attempt, correlation)
        } else {
          if (reconciliation._tag === "Running" || reconciliation._tag === "Terminal") {
            return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
          }
          if (reconciliation._tag === "Unresolved") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
        }
      } else {
        const reconciliation = yield* reconcile(attempt, correlation, record)
        if (reconciliation._tag === "Running") {
          if (record._tag === "TurnIntentRecorded") {
            const observed = observedRecordFor(
              attempt,
              record.threadId,
              record.currentToken,
              reconciliation.turn.id,
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
        if (reconciliation._tag === "Unresolved") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
        if (record._tag === "Terminal") return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
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
      if (record._tag === "EmptyPreTurn") return yield* Effect.fail(new CodexThreadMismatch({}))
      const current = yield* reconcile(attempt, correlation, record)
      if (current._tag === "Terminal") return yield* terminalOrRunning(attempt, correlation, record, current)
      if (current._tag === "Idle") {
        if (!hasOwnedTurnRecord(record) || record._tag === "Terminal") {
          return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
        }
        yield* quiesceOwnedActivity(record.threadId)
        if (record._tag === "TurnIntentRecorded") {
          if (current.turn === undefined) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
          const observed = observedRecordFor(
            attempt,
            record.threadId,
            record.currentToken,
            current.turn.id,
            record.priorObservedTurnId
          )
          yield* save(observed)
          yield* save(safelySuspendedRecordFor(attempt, observed))
        } else {
          yield* save(safelySuspendedRecordFor(attempt, record))
        }
        return suspended(correlation)
      }
      if (current._tag === "Unresolved") {
        return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
      const turnId = current.turn.id
      // Exactly one interrupt is issued. The post-boundary read decides both
      // the lost-response and terminal-during-suspension races.
      yield* app.interruptTurn(record.threadId, turnId).pipe(
        Effect.catch((error) =>
          reconcile(attempt, correlation, record).pipe(
            Effect.flatMap((after) => {
              if (after._tag === "Terminal")
                return terminalOrRunning(attempt, correlation, record, after).pipe(Effect.asVoid)
              if (after._tag === "Idle") return Effect.void
              return Effect.fail(error)
            })
          )
        )
      )
      const after = yield* reconcile(attempt, correlation, record)
      if (after._tag === "Terminal") return yield* terminalOrRunning(attempt, correlation, record, after)
      if (after._tag === "Running") return running(correlation)
      if (after._tag === "Unresolved") {
        return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
      yield* quiesceOwnedActivity(record.threadId)
      if (record._tag === "TurnIntentRecorded") {
        if (after.turn === undefined) return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
        const observed = observedRecordFor(
          attempt,
          record.threadId,
          record.currentToken,
          after.turn.id,
          record.priorObservedTurnId
        )
        yield* save(observed)
        yield* save(safelySuspendedRecordFor(attempt, observed))
      } else if (record._tag === "TurnObserved" || record._tag === "Running" || record._tag === "SafelySuspended") {
        yield* save(safelySuspendedRecordFor(attempt, record))
      } else {
        return yield* Effect.fail(new CodexTurnBoundaryUnknown({}))
      }
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
        if (record._tag === "EmptyPreTurn") return noReport(correlation)
        const attempt: CodexAttemptContext = {
          attemptId: correlation.attemptId,
          runId: correlation.runId,
          worktree: record.worktree
        }
        const reconciliation = yield* reconcile(attempt, correlation, record)
        if (reconciliation._tag === "Running") return exact(running(correlation))
        if (reconciliation._tag === "Terminal")
          return exact(yield* terminalOrRunning(attempt, correlation, record, reconciliation))
        if (reconciliation._tag === "Unresolved") return unreadable(correlation)
        if (record._tag === "AssociatedPreTurn") return noReport(correlation)
        const census = yield* observeOwnedActivityByThreadId(record.threadId)
        if (census._tag === "ExactLive") return exact(running(correlation))
        if (census._tag === "Unreadable" || census._tag === "Contradictory") return unreadable(correlation)
        if (record._tag === "SafelySuspended") return exact(suspended(correlation))
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
export const codexPlannedAttemptExecutorNodeLayer = codexPlannedAttemptExecutorLayer.pipe(
  Layer.provide(nodeCodexOwnedActivityCensusLayer)
)

/** Conventional node-prefixed alias used by application composition. */
export const nodeCodexPlannedAttemptExecutorLayer = codexPlannedAttemptExecutorNodeLayer

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
