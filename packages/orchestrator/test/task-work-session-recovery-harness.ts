/* eslint-disable functional/immutable-data, no-magic-numbers */
import { Cause, Effect, Exit, Fiber, Layer, Queue } from "effect"
import {
  AttemptId,
  GitCommitSha,
  JournalPosition,
  type JournalRecordKey,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  ProviderRequestId,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskLifecycle,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  WorktreeLocator
} from "../src/domain.js"
import {
  type JournalRecord,
  JournalStore,
  JournalStoreContradiction,
  type WorkflowJournalEvent
} from "../src/journal-store.js"
import { journaledWorkflowInterpreterLayer } from "../src/journaled-workflow-interpreter.js"
import { taskRevisionFor } from "../src/task-dag.js"
import { taskExecutorTestLayer } from "../src/task-execution.js"
import {
  MatchingTaskWorkSessionReported,
  NoMatchingTaskWorkSessionReported,
  TaskRunner,
  TaskWorkSessionCorrelationConflict,
  TaskWorkSessionLookupFailure,
  TaskWorkStartRequest
} from "../src/task-work-start.js"
import { TrackerGraphReader } from "../src/tracker-graph-reader.js"
import { taskRunnerWorkflowInterpreterLayer } from "../src/workflow-interpreters.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTaskWorktreeReconciliationOperation,
  WorkflowInterpreter,
  WorkflowTrace
} from "../src/workflow.js"
import { recordReadyWorktreeEvidence } from "./task-worktree-evidence.js"

type Evidence = "Absent" | "Conflict" | "Matching" | "Unreadable"
const lookupBound = 3n
const taskId = TaskId.make("mbt-task")
const runId = RunId.make("mbt-run")

/**
 * Quint controls backed by the real journaled WorkflowInterpreter protocol.
 * Local fields only project test observations; all requests, retries, durable
 * records, failures, and recovery decisions are produced by production code.
 */
export const makeTaskWorkSessionRecoveryHarness = () => {
  let authorization = "NoAuthorization"
  let candidateSelected = false
  let coordinatorRunning = true
  let everCrashed = false
  let intentCommitted = false
  let lookupAttempts = 0n
  let matchingReportRecorded = false
  let operationId = 0n
  let pendingEvidence = "NoEvidence"
  let providerHasSession = false
  let providerObservationOrdinal = 0n
  let recordedEvidence = "NoEvidence"
  let requestCount = 0n
  let status = "Active"
  let operation: ReturnType<typeof makeTaskWorkSessionEstablishmentOperation> | undefined
  let interruptWorkflow: Effect.Effect<void> = Effect.void

  const predecessorOperationIds = new Set([-1n])
  const requestOperationIds = new Set<bigint>()
  const requestPayloads = new Set<bigint>()
  const records = new Array<JournalRecord>()

  let intentCommittedSignal: Queue.Queue<void>
  let releaseIntent: Queue.Queue<void>
  let requestCrossedSignal: Queue.Queue<void>
  let requestPlans: Queue.Queue<boolean>
  let lookupRecordedSignal: Queue.Queue<Evidence>
  let lookupPlans: Queue.Queue<Evidence>
  let releaseLookupRecord: Queue.Queue<void>
  let outcomePendingSignal: Queue.Queue<void>
  let releaseOutcome: Queue.Queue<void>
  let workflowExitSignal: Queue.Queue<Exit.Exit<unknown, unknown>>

  const requireOperation = () => {
    if (operation === undefined) return Effect.die(new Error("identity must be selected"))
    return Effect.succeed(operation)
  }

  const sameEvent = (left: WorkflowJournalEvent, right: WorkflowJournalEvent) =>
    JSON.stringify(left) === JSON.stringify(right)

  const appendRecord = (
    requestedRunId: RunId,
    key: JournalRecordKey,
    event: WorkflowJournalEvent
  ) =>
    Effect.gen(function*() {
      const existing = records.find((record) => record.runId === requestedRunId && record.key === key)
      if (existing !== undefined) {
        if (sameEvent(existing.event, event)) return existing
        return yield* new JournalStoreContradiction({
          existingPosition: existing.position,
          key,
          runId: requestedRunId
        })
      }
      const record: JournalRecord = {
        event,
        key,
        position: JournalPosition.make(records.length + 1),
        runId: requestedRunId
      }
      records.push(record)
      return record
    })

  const journal = JournalStore.of({
    append: (requestedRunId, key, event) =>
      Effect.gen(function*() {
        if (event._tag === "TaskWorkSessionEstablished") {
          yield* Queue.offer(outcomePendingSignal, undefined)
          yield* Queue.take(releaseOutcome)
        }
        const existed = records.some((record) => record.runId === requestedRunId && record.key === key)
        const record = yield* appendRecord(requestedRunId, key, event)
        if (event._tag === "TaskWorkSessionEstablishmentIntentRecorded" && !existed) {
          yield* Queue.offer(intentCommittedSignal, undefined)
          yield* Queue.take(releaseIntent)
        }
        if (event._tag === "TaskWorkSessionReported" || event._tag === "TaskWorkSessionLookupFailed") {
          const evidence: Evidence = event._tag === "TaskWorkSessionLookupFailed"
            ? "Unreadable"
            : event.report._tag === "MatchingTaskWorkSessionReported"
            ? "Matching"
            : event.report._tag === "NoMatchingTaskWorkSessionReported"
            ? "Absent"
            : "Conflict"
          yield* Queue.offer(lookupRecordedSignal, evidence)
          yield* Queue.take(releaseLookupRecord)
        }
        return record
      }),
    read: (requestedRunId) => Effect.succeed(records.filter((record) => record.runId === requestedRunId))
  })

  const runner = TaskRunner.of({
    lookupTaskWorkSession: () =>
      Effect.gen(function*() {
        const evidence = yield* Queue.take(lookupPlans)
        lookupAttempts += 1n
        providerObservationOrdinal += 1n
        const ordinal = providerObservationOrdinal
        if (evidence === "Unreadable") {
          return yield* new TaskWorkSessionLookupFailure({
            detail: "mbt unreadable provider registry",
            observationId: ProviderObservationId.make(`mbt-unreadable-${ordinal}`)
          })
        }
        if (evidence === "Conflict") {
          return TaskWorkSessionCorrelationConflict.make({
            conflicts: [{
              detail: "mbt provider conflict",
              sessionId: TaskWorkSessionId.make("mbt-conflict")
            }],
            observationId: ProviderObservationId.make(`mbt-conflict-${ordinal}`)
          })
        }
        return evidence === "Matching"
          ? MatchingTaskWorkSessionReported.make({
            observationId: ProviderObservationId.make(`mbt-matching-${ordinal}`),
            sessionId: TaskWorkSessionId.make("mbt-session"),
            work: { _tag: "NoProviderWorkReported" }
          })
          : NoMatchingTaskWorkSessionReported.make({
            observationId: ProviderObservationId.make(`mbt-absent-${ordinal}`)
          })
      }),
    requestTaskWorkStart: (request) =>
      Effect.gen(function*() {
        const createsSession = yield* Queue.take(requestPlans)
        requestCount += 1n
        requestOperationIds.add(operationId)
        requestPayloads.add(41n)
        providerHasSession ||= createsSession
        yield* Queue.offer(requestCrossedSignal, undefined)
        return {
          observationId: ProviderObservationId.make(`mbt-request-observation-${requestCount}`),
          providerRequestId: ProviderRequestId.make(`mbt-request-${request.operationId}-${requestCount}`)
        }
      })
  })

  const interpreterLayer = journaledWorkflowInterpreterLayer(
    runId,
    taskRunnerWorkflowInterpreterLayer,
    taskExecutorTestLayer
  ).pipe(
    Layer.provide(Layer.succeed(TaskRunner, runner)),
    Layer.provide(Layer.succeed(
      TrackerGraphReader,
      TrackerGraphReader.of({
        read: () => Effect.die("unused tracker read")
      })
    )),
    Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
  )

  const startWorkflow = Effect.gen(function*() {
    const selected = yield* requireOperation()
    const fiber = yield* Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
      const planOperationId = selected.predecessorOperationIds[0] ?? OperationId.make("mbt-predecessor")
      const worktreeOperationId = selected.predecessorOperationIds[1] ?? OperationId.make("mbt-worktree")
      yield* interpreter.recordTaskAttemptPlan(makeTaskAttemptPlanOperation({
        operationId: planOperationId,
        plannedAttempt: selected.request.plannedAttempt,
        predecessorOperationIds: []
      }))
      const worktreeOperation = makeTaskWorktreeReconciliationOperation({
        operationId: worktreeOperationId,
        plannedAttempt: selected.request.plannedAttempt,
        predecessorOperationIds: [planOperationId]
      })
      yield* recordReadyWorktreeEvidence(worktreeOperation)
      return yield* interpreter.establishTaskWorkSession(selected)
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit) && exit.cause.reasons.every(Cause.isInterruptReason)
          ? Effect.void
          : Queue.offer(workflowExitSignal, exit)
      ),
      Effect.provide(interpreterLayer),
      Effect.provide(Layer.succeed(JournalStore, journal)),
      Effect.forkDetach
    )
    interruptWorkflow = Fiber.interrupt(fiber).pipe(Effect.asVoid)
  })

  const lookup = (evidence: Evidence) =>
    Effect.gen(function*() {
      yield* Queue.offer(lookupPlans, evidence)
      pendingEvidence = yield* Queue.take(lookupRecordedSignal)
    })

  const applyWorkflowExit = (exit: Exit.Exit<unknown, unknown>) => {
    if (Exit.isSuccess(exit)) {
      return Effect.sync(() => {
        status = "Established"
      })
    }
    const failure = Cause.squash(exit.cause)
    if (typeof failure !== "object" || failure === null || !("_tag" in failure)) {
      return Effect.die(failure)
    }
    switch (failure._tag) {
      case "TaskWorkSessionLookupDidNotConverge":
        return Effect.sync(() => {
          status = "LookupDidNotConverge"
        })
      case "TaskWorkSessionEstablishmentDidNotConverge":
        return Effect.sync(() => {
          status = "EstablishmentDidNotConverge"
        })
      case "TaskWorkSessionCorrelationConflict":
      case "TaskWorkSessionEvidenceContradiction":
        return Effect.sync(() => {
          status = "CorrelationConflict"
        })
      default:
        return Effect.die(failure)
    }
  }

  return {
    init: () =>
      Effect.gen(function*() {
        yield* interruptWorkflow
        interruptWorkflow = Effect.void
        authorization = "NoAuthorization"
        candidateSelected = false
        coordinatorRunning = true
        everCrashed = false
        intentCommitted = false
        lookupAttempts = 0n
        matchingReportRecorded = false
        operationId = 0n
        pendingEvidence = "NoEvidence"
        providerHasSession = false
        providerObservationOrdinal = 0n
        recordedEvidence = "NoEvidence"
        requestCount = 0n
        status = "Active"
        operation = undefined
        records.length = 0
        requestOperationIds.clear()
        requestPayloads.clear()
        intentCommittedSignal = yield* Queue.unbounded<void>()
        releaseIntent = yield* Queue.unbounded<void>()
        requestCrossedSignal = yield* Queue.unbounded<void>()
        requestPlans = yield* Queue.unbounded<boolean>()
        lookupRecordedSignal = yield* Queue.unbounded<Evidence>()
        lookupPlans = yield* Queue.unbounded<Evidence>()
        releaseLookupRecord = yield* Queue.unbounded<void>()
        outcomePendingSignal = yield* Queue.unbounded<void>()
        releaseOutcome = yield* Queue.unbounded<void>()
        workflowExitSignal = yield* Queue.unbounded<Exit.Exit<unknown, unknown>>()
      }),
    selectIdentity: () =>
      Effect.sync(() => {
        candidateSelected = true
        operationId += 1n
        const task = {
          id: taskId,
          lifecycle: TaskLifecycle.cases.Open.make({}),
          parentTaskId: null,
          prerequisiteIds: []
        }
        const request = TaskWorkStartRequest.make({
          operationId: OperationId.make(`mbt-operation-${operationId}`),
          plannedAttempt: PlannedTaskAttempt.make({
            attemptId: AttemptId.make("mbt-attempt"),
            baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
            branch: TaskBranchRef.make("refs/heads/mbt-task"),
            executor: TaskExecutorLocator.make("executor:mbt"),
            runId,
            session: TaskWorkSessionLocator.make("session:mbt"),
            taskId,
            taskRevision: taskRevisionFor(task),
            worktree: WorktreeLocator.make("/tmp/mbt-task")
          }),
          task
        })
        operation = makeTaskWorkSessionEstablishmentOperation({
          predecessorOperationIds: [
            OperationId.make("mbt-predecessor"),
            OperationId.make("mbt-worktree")
          ],
          request
        })
      }),
    commitIntent: () =>
      Effect.gen(function*() {
        yield* startWorkflow
        yield* Queue.take(intentCommittedSignal)
        intentCommitted = true
        authorization = "InitialRequest"
      }),
    requestCreatesNothing: () =>
      Effect.gen(function*() {
        yield* Queue.offer(requestPlans, false)
        if (requestCount === 0n) yield* Queue.offer(releaseIntent, undefined)
        yield* Queue.take(requestCrossedSignal)
        authorization = "NoAuthorization"
        recordedEvidence = "NoEvidence"
      }),
    requestCreatesSession: () =>
      Effect.gen(function*() {
        yield* Queue.offer(requestPlans, true)
        if (requestCount === 0n) yield* Queue.offer(releaseIntent, undefined)
        yield* Queue.take(requestCrossedSignal)
        authorization = "NoAuthorization"
        recordedEvidence = "NoEvidence"
      }),
    lookupAbsent: () => lookup("Absent"),
    lookupConflict: () => lookup("Conflict"),
    lookupContradictoryAbsence: () => lookup("Absent"),
    lookupMatching: () => lookup("Matching"),
    lookupUnreadable: () => lookup("Unreadable"),
    recordLookup: () =>
      Effect.gen(function*() {
        const evidence = pendingEvidence
        yield* Queue.offer(releaseLookupRecord, undefined)
        recordedEvidence = evidence
        pendingEvidence = "NoEvidence"
        if (evidence === "Matching") {
          matchingReportRecorded = true
          yield* Queue.take(outcomePendingSignal)
        } else if (evidence === "Absent" && !matchingReportRecorded && lookupAttempts < lookupBound) {
          authorization = "FreshAbsence"
        }
        if (
          evidence === "Conflict"
          || (evidence === "Absent" && (matchingReportRecorded || lookupAttempts === lookupBound))
          || (evidence === "Unreadable" && lookupAttempts === lookupBound)
        ) yield* Queue.take(workflowExitSignal).pipe(Effect.flatMap(applyWorkflowExit))
      }),
    recordOutcome: () =>
      Queue.offer(releaseOutcome, undefined).pipe(
        Effect.andThen(Queue.take(workflowExitSignal)),
        Effect.flatMap(applyWorkflowExit),
        Effect.asVoid
      ),
    crash: () =>
      interruptWorkflow.pipe(Effect.andThen(Effect.sync(() => {
        coordinatorRunning = false
        lookupAttempts = 0n
        pendingEvidence = "NoEvidence"
        authorization = "NoAuthorization"
        matchingReportRecorded = status === "Established"
        everCrashed = true
      }))),
    restart: () =>
      Effect.gen(function*() {
        coordinatorRunning = true
        candidateSelected = intentCommitted
        if (intentCommitted && status !== "Established") yield* startWorkflow
      }),
    getState: () =>
      Effect.succeed({
        authorization,
        candidateSelected,
        coordinatorRunning,
        everCrashed,
        intentCommitted,
        lookupAttempts,
        matchingReportRecorded,
        operationId,
        predecessorOperationIds: operationId > 0n ? predecessorOperationIds : new Set<bigint>(),
        pendingEvidence,
        providerHasSession,
        recordedEvidence,
        requestCount,
        requestOperationIds,
        requestPayloads,
        status
      })
  }
}
