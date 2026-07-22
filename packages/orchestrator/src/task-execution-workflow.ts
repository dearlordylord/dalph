import { Effect, Schema } from "effect"
import type { CoordinatorOwnershipError } from "./coordinator-lock.js"
import type { JournalStoreContradiction, JournalStoreError } from "./journal-store.js"
import { TaskExecutionStarted } from "./task-execution-trace.js"
import {
  type TaskExecutionEvidenceContradiction,
  type TaskExecutionHistoryContradiction,
  TaskExecutionIdentityContradiction,
  type TaskExecutionLookup,
  TaskExecutionModeContradiction,
  TaskExecutionObservationFailure,
  type TaskExecutionOutcomeAmbiguous,
  taskExecutionOutcomeFromReport,
  TaskExecutionReport,
  type TaskExecutionReportContradiction,
  type TaskExecutionRequest,
  TaskExecutionRequestAcknowledgement,
  TaskExecutionRequestFailure,
  type TaskExecutionRunContradiction,
  type TaskExecutionSessionConflict,
  type TaskExecutionStillRunning,
  type TaskExecutorService,
  validateTaskExecutionReport
} from "./task-execution.js"
import type { TraceOutputError } from "./trace-output.js"
import { WorkflowOperation } from "./workflow-operation.js"

export interface TaskExecutionProtocolObserver {
  readonly requestAttempted: (
    request: TaskExecutionRequest
  ) => Effect.Effect<void, JournalStoreContradiction | JournalStoreError | TraceOutputError>
  readonly observationFailed: (
    lookup: TaskExecutionLookup,
    failure: TaskExecutionObservationFailure
  ) => Effect.Effect<void, JournalStoreContradiction | JournalStoreError | TraceOutputError>
  readonly outcomeReported: (
    lookup: TaskExecutionLookup,
    report: TaskExecutionReport
  ) => Effect.Effect<
    void,
    JournalStoreContradiction | JournalStoreError | TaskExecutionReportContradiction | TraceOutputError
  >
  readonly requestFailed: (
    request: TaskExecutionRequest,
    failure: TaskExecutionRequestFailure
  ) => Effect.Effect<void, JournalStoreContradiction | JournalStoreError | TraceOutputError>
  readonly requestReturned: (
    request: TaskExecutionRequest,
    acknowledgement: TaskExecutionRequestAcknowledgement
  ) => Effect.Effect<void, JournalStoreContradiction | JournalStoreError | TraceOutputError>
}

const silentTaskExecutionObserver: TaskExecutionProtocolObserver = {
  observationFailed: () => Effect.void,
  outcomeReported: () => Effect.void,
  requestFailed: () => Effect.void,
  requestReturned: () => Effect.void,
  requestAttempted: () => Effect.void
}

export type TaskExecutionProtocolFailure =
  | CoordinatorOwnershipError
  | JournalStoreContradiction
  | JournalStoreError
  | TaskExecutionEvidenceContradiction
  | TaskExecutionHistoryContradiction
  | TaskExecutionIdentityContradiction
  | TaskExecutionModeContradiction
  | TaskExecutionObservationFailure
  | TaskExecutionOutcomeAmbiguous
  | TaskExecutionRunContradiction
  | TaskExecutionReportContradiction
  | TaskExecutionSessionConflict
  | TaskExecutionStillRunning
  | TraceOutputError

const requestTaskExecution = Effect.fn("Workflow.requestTaskExecution")(function*(
  executor: TaskExecutorService,
  operation: typeof WorkflowOperation.cases.ExecuteTaskWork.Type,
  observer: TaskExecutionProtocolObserver
) {
  yield* observer.requestAttempted(operation.request)
  const requestResult = yield* executor.requestTaskExecution(operation.request).pipe(Effect.result)
  if (requestResult._tag === "Failure") {
    if (!(requestResult.failure instanceof TaskExecutionRequestFailure)) {
      return yield* requestResult.failure
    }
    if (requestResult.failure.operationId !== operation.request.operationId) {
      return yield* new TaskExecutionIdentityContradiction({
        expectedOperationId: operation.request.operationId,
        observedOperationId: requestResult.failure.operationId
      })
    }
    yield* observer.requestFailed(operation.request, requestResult.failure)
  } else {
    yield* observer.requestReturned(operation.request, requestResult.success)
  }
})

const observeTaskExecution = Effect.fn("Workflow.observeTaskExecution")(function*(
  executor: TaskExecutorService,
  lookup: TaskExecutionLookup,
  observer: TaskExecutionProtocolObserver
) {
  const observed = yield* executor.observeTaskExecution(lookup).pipe(Effect.result)
  if (observed._tag === "Failure") {
    if (observed.failure.operationId !== lookup.operationId) {
      return yield* new TaskExecutionIdentityContradiction({
        expectedOperationId: lookup.operationId,
        observedOperationId: observed.failure.operationId
      })
    }
    yield* observer.observationFailed(lookup, observed.failure)
    return yield* observed.failure
  }
  yield* validateTaskExecutionReport(lookup, observed.success)
  yield* observer.outcomeReported(lookup, observed.success)
  return observed.success
})

/** Requests once, then trusts only a fresh exact provider observation. */
export const runTaskExecutionProtocol = Effect.fn("Workflow.runTaskExecutionProtocol")(
  function*(
    executor: TaskExecutorService,
    operation: typeof WorkflowOperation.cases.ExecuteTaskWork.Type,
    requestBeforeObservation: boolean,
    observer: TaskExecutionProtocolObserver = silentTaskExecutionObserver,
    requestAfterConfirmedAbsence = false
  ) {
    if (operation.request.session._tag !== "EstablishedSession") {
      return yield* new TaskExecutionModeContradiction({
        operationId: operation.request.operationId
      })
    }
    if (requestBeforeObservation) {
      yield* requestTaskExecution(executor, operation, observer)
    }
    const lookup: TaskExecutionLookup = {
      operationId: operation.request.operationId,
      plannedAttempt: operation.request.plannedAttempt,
      sessionId: operation.request.session.sessionId
    }
    const report = yield* observeTaskExecution(executor, lookup, observer)
    if (requestAfterConfirmedAbsence && report._tag === "NoTaskExecutionReported") {
      yield* requestTaskExecution(executor, operation, observer)
      const afterRequest = yield* observeTaskExecution(executor, lookup, observer)
      return yield* taskExecutionOutcomeFromReport(lookup, afterRequest)
    }
    return yield* taskExecutionOutcomeFromReport(lookup, report)
  }
)

export const TaskExecutionRequestReturnedTrace = Schema.TaggedStruct(
  "TaskExecutionRequestReturned",
  {
    acknowledgement: TaskExecutionRequestAcknowledgement,
    operation: WorkflowOperation.cases.ExecuteTaskWork
  }
)

export const TaskExecutionRequestFailedTrace = Schema.TaggedStruct(
  "TaskExecutionRequestFailed",
  { failure: TaskExecutionRequestFailure, operation: WorkflowOperation.cases.ExecuteTaskWork }
)

export const TaskExecutionObservationFailedTrace = Schema.TaggedStruct(
  "TaskExecutionObservationFailed",
  { failure: TaskExecutionObservationFailure, operation: WorkflowOperation.cases.ExecuteTaskWork }
)

export const TaskExecutionReportedTrace = Schema.TaggedStruct(
  "TaskExecutionReported",
  { operation: WorkflowOperation.cases.ExecuteTaskWork, report: TaskExecutionReport }
)

interface ExecutionTrace {
  readonly emit: (
    item:
      | typeof TaskExecutionObservationFailedTrace.Type
      | typeof TaskExecutionReportedTrace.Type
      | typeof TaskExecutionRequestFailedTrace.Type
      | typeof TaskExecutionRequestReturnedTrace.Type
      | typeof TaskExecutionStarted.Type
  ) => Effect.Effect<void, TraceOutputError>
}

export const taskExecutionTraceObserver = (
  operation: typeof WorkflowOperation.cases.ExecuteTaskWork.Type,
  trace: ExecutionTrace
): TaskExecutionProtocolObserver => ({
  requestAttempted: () => Effect.void,
  observationFailed: Effect.fn("WorkflowTrace.taskExecutionObservationFailed")(
    function*(_lookup, failure) {
      yield* trace.emit(TaskExecutionObservationFailedTrace.make({ failure, operation }))
    }
  ),
  outcomeReported: Effect.fn("WorkflowTrace.taskExecutionReported")(function*(_lookup, report) {
    if (
      report._tag !== "NoTaskExecutionReported"
      && report._tag !== "TaskExecutionSessionConflictReported"
    ) {
      yield* trace.emit(TaskExecutionStarted.make({ observation: report, operation }))
    }
    yield* trace.emit(TaskExecutionReportedTrace.make({ operation, report }))
  }),
  requestFailed: Effect.fn("WorkflowTrace.taskExecutionRequestFailed")(function*(_request, failure) {
    yield* trace.emit(TaskExecutionRequestFailedTrace.make({ failure, operation }))
  }),
  requestReturned: Effect.fn("WorkflowTrace.taskExecutionRequestReturned")(
    function*(_request, acknowledgement) {
      yield* trace.emit(TaskExecutionRequestReturnedTrace.make({ acknowledgement, operation }))
    }
  )
})
