/* eslint-disable functional/immutable-data, no-magic-numbers */
import { Effect, Fiber, Layer, Match, Queue, Result } from "effect"
import {
  AttemptId,
  GitCommitSha,
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
} from "../../src/domain.js"
import { type JournalRecord, JournalStore, type WorkflowJournalEvent } from "../../src/journal-store.js"
import { journaledWorkflowInterpreterLayer } from "../../src/journaled-workflow-interpreter.js"
import { taskRevisionFor } from "../../src/task-dag.js"
import { taskExecutorTestLayer } from "../../src/task-execution.js"
import {
  MatchingTaskWorkSessionReported,
  NoMatchingTaskWorkSessionReported,
  TaskRunner,
  TaskWorkSessionCorrelationConflict,
  TaskWorkSessionLookupFailure,
  TaskWorkStartRequest
} from "../../src/task-work-start.js"
import { recordReadyWorktreeEvidence } from "../../src/task-worktree-evidence.js"
import { TrackerGraphReader } from "../../src/tracker-graph-reader.js"
import { deterministicTestWorkflowInterpreterLayer } from "../../src/workflow-interpreters.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTaskWorktreeReconciliationOperation,
  WorkflowInterpreter,
  type WorkflowInterpreterService,
  WorkflowTrace
} from "../../src/workflow.js"
import { makeTaskWorkSessionRecoveryModelJournal } from "./task-work-session-recovery-model-journal.js"

type Evidence = "Absent" | "Conflict" | "Matching" | "Unreadable"
type PendingEvidence = Evidence | "NoEvidence"
type TaskWorkSessionWorkflow = ReturnType<WorkflowInterpreterService["establishTaskWorkSession"]>
type TaskWorkSessionWorkflowFailure = Effect.Error<TaskWorkSessionWorkflow>
type TaskWorkSessionWorkflowResult = Result.Result<
  Effect.Success<TaskWorkSessionWorkflow>,
  TaskWorkSessionWorkflowFailure
>
const lookupBound = 3n
const taskId = TaskId.make("mbt-task")
const runId = RunId.make("mbt-run")
const planOperationId = OperationId.make("mbt-predecessor")
const worktreeOperationId = OperationId.make("mbt-worktree")

/**
 * @experimental Executable Quint conformance infrastructure, not a supported
 * production reducer, scheduler, or package API. Do not derive runtime
 * architecture from its queues, projections, or deterministic authority
 * scripts.
 *
 * The controls invoke the real journaled WorkflowInterpreter protocol.
 * Local fields only project test observations; all requests, retries, durable
 * records, failures, and recovery decisions are produced by production code.
 */
export const makeTaskWorkSessionRecoveryModelControls = () => {
  let authorization = "NoAuthorization"
  let candidateSelected = false
  let coordinatorRunning = true
  let everCrashed = false
  let intentCommitted = false
  let lookupAttempts = 0n
  let matchingReportRecorded = false
  let operationId = 0n
  let pendingEvidence: PendingEvidence = "NoEvidence"
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

  const requireOperation = () => {
    if (operation === undefined) return Effect.die(new Error("identity must be selected"))
    return Effect.succeed(operation)
  }

  const beforeJournalAppend = (event: WorkflowJournalEvent) =>
    event._tag === "TaskWorkSessionEstablished"
      ? Queue.offer(outcomePendingSignal, undefined).pipe(Effect.andThen(Queue.take(releaseOutcome)))
      : Effect.void

  const observedLookupEvidence = (event: WorkflowJournalEvent): Evidence | undefined =>
    event._tag === "TaskWorkSessionLookupFailed"
      ? "Unreadable"
      : event._tag !== "TaskWorkSessionReported"
      ? undefined
      : event.report._tag === "MatchingTaskWorkSessionReported"
      ? "Matching"
      : event.report._tag === "NoMatchingTaskWorkSessionReported"
      ? "Absent"
      : "Conflict"

  const afterJournalAppend = (
    event: WorkflowJournalEvent,
    existed: boolean
  ) =>
    Effect.gen(function*() {
      if (event._tag === "TaskWorkSessionEstablishmentIntentRecorded" && !existed) {
        yield* Queue.offer(intentCommittedSignal, undefined)
        yield* Queue.take(releaseIntent)
      }
      const evidence = observedLookupEvidence(event)
      if (evidence !== undefined) {
        yield* Queue.offer(lookupRecordedSignal, evidence)
        yield* Queue.take(releaseLookupRecord)
      }
    })

  const journal = makeTaskWorkSessionRecoveryModelJournal(
    records,
    runId,
    beforeJournalAppend,
    afterJournalAppend
  )

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
    deterministicTestWorkflowInterpreterLayer,
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

  let workflowResultSignal: Queue.Queue<TaskWorkSessionWorkflowResult>

  const startWorkflow = Effect.gen(function*() {
    const selected = yield* requireOperation()
    const workflow = yield* Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
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
      return interpreter.establishTaskWorkSession(selected)
    }).pipe(
      Effect.provide(interpreterLayer),
      Effect.provide(Layer.succeed(JournalStore, journal))
    )
    const fiber = yield* workflow.pipe(
      Effect.result,
      Effect.flatMap((result) => Queue.offer(workflowResultSignal, result)),
      Effect.forkDetach
    )
    interruptWorkflow = Fiber.interrupt(fiber).pipe(Effect.asVoid)
  })

  const lookup = (evidence: Evidence) =>
    Effect.gen(function*() {
      yield* Queue.offer(lookupPlans, evidence)
      pendingEvidence = yield* Queue.take(lookupRecordedSignal)
    })

  const applyWorkflowResult = (result: TaskWorkSessionWorkflowResult) => {
    if (Result.isSuccess(result)) {
      return Effect.sync(() => {
        status = "Established"
      })
    }
    const recordStatus = (next: string) =>
      Effect.sync(() => {
        status = next
      })
    const recordCorrelationConflict = () => recordStatus("CorrelationConflict")
    const dieUnexpectedFailure: typeof Effect.die = Effect.die
    return Match.valueTags(result.failure, {
      CoordinatorLockObservationContradiction: dieUnexpectedFailure,
      CoordinatorOwnershipLost: dieUnexpectedFailure,
      JournalDataCorruption: dieUnexpectedFailure,
      JournalSchemaIncompatible: dieUnexpectedFailure,
      JournalStorageAccessDenied: dieUnexpectedFailure,
      JournalStorageCapacityExhausted: dieUnexpectedFailure,
      JournalStorageLocked: dieUnexpectedFailure,
      JournalStorageUnavailable: dieUnexpectedFailure,
      JournalStoreContradiction: dieUnexpectedFailure,
      TaskAttemptPlanHistoryContradiction: dieUnexpectedFailure,
      TaskWorkSessionCorrelationConflict: recordCorrelationConflict,
      TaskWorkSessionEstablishmentDidNotConverge: () => recordStatus("EstablishmentDidNotConverge"),
      TaskWorkSessionEvidenceContradiction: recordCorrelationConflict,
      TaskWorkSessionLookupDidNotConverge: () => recordStatus("LookupDidNotConverge"),
      TaskWorkSessionRunContradiction: dieUnexpectedFailure,
      TaskWorktreeHistoryContradiction: dieUnexpectedFailure,
      "TraceOutput.TraceOutputError": dieUnexpectedFailure
    })
  }

  const recordLookup = (evidence: Evidence) =>
    Effect.gen(function*() {
      yield* Queue.offer(releaseLookupRecord, undefined)
      recordedEvidence = evidence
      pendingEvidence = "NoEvidence"
      yield* Match.value(evidence).pipe(
        Match.when("Matching", () =>
          Effect.sync(() => {
            matchingReportRecorded = true
          }).pipe(Effect.andThen(Queue.take(outcomePendingSignal)))),
        Match.when("Absent", () =>
          matchingReportRecorded || lookupAttempts === lookupBound
            ? Queue.take(workflowResultSignal).pipe(Effect.flatMap(applyWorkflowResult))
            : Effect.sync(() => {
              authorization = "FreshAbsence"
            })),
        Match.when("Conflict", () => Queue.take(workflowResultSignal).pipe(Effect.flatMap(applyWorkflowResult))),
        Match.when("Unreadable", () =>
          lookupAttempts === lookupBound
            ? Queue.take(workflowResultSignal).pipe(Effect.flatMap(applyWorkflowResult))
            : Effect.void),
        Match.exhaustive
      )
    })

  const recordPendingLookup = (evidence: PendingEvidence) =>
    Match.value(evidence).pipe(
      Match.when("NoEvidence", () => Effect.die("no provider lookup is pending")),
      Match.when("Absent", () => recordLookup("Absent")),
      Match.when("Conflict", () => recordLookup("Conflict")),
      Match.when("Matching", () => recordLookup("Matching")),
      Match.when("Unreadable", () => recordLookup("Unreadable")),
      Match.exhaustive
    )

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
        workflowResultSignal = yield* Queue.unbounded<TaskWorkSessionWorkflowResult>()
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
            planOperationId,
            worktreeOperationId
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
    recordLookup: () => recordPendingLookup(pendingEvidence),
    recordOutcome: () =>
      Queue.offer(releaseOutcome, undefined).pipe(
        Effect.andThen(Queue.take(workflowResultSignal)),
        Effect.flatMap(applyWorkflowResult),
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
