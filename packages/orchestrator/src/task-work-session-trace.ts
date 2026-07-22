import { Effect, Schema } from "effect"
import { OperationId, PlannedTaskAttempt, ProviderObservationId } from "./domain.js"
import {
  TaskWorkSessionEstablishmentDidNotConverge,
  TaskWorkSessionLookupDidNotConverge
} from "./task-work-session-recovery-decision.js"
import {
  TaskWorkSessionLookupFailure,
  TaskWorkSessionReport,
  TaskWorkStartRequestAcknowledgement,
  TaskWorkStartRequestFailure
} from "./task-work-start.js"
import { WorkflowOperation } from "./workflow-operation.js"
import { WorkflowOutcome } from "./workflow-outcome.js"
import type { TaskWorkSessionProtocolObserver, WorkflowTraceService } from "./workflow.js"

export const taskWorkSessionTraceObserver = (
  operation: typeof WorkflowOperation.cases.EstablishTaskWorkSession.Type,
  trace: WorkflowTraceService
): TaskWorkSessionProtocolObserver => ({
  lookupFailed: Effect.fn("WorkflowTrace.taskWorkSessionLookupFailed")(function*(lookup, failure) {
    yield* trace.emit(TaskWorkSessionLookupRequestedTrace.make({
      lookup,
      observationId: failure.observationId,
      operation
    }))
    yield* trace.emit(TaskWorkSessionLookupFailedTrace.make({ failure, operation }))
  }),
  sessionReported: Effect.fn("WorkflowTrace.taskWorkSessionReported")(function*(lookup, report) {
    yield* trace.emit(TaskWorkSessionLookupRequestedTrace.make({
      lookup,
      observationId: report.observationId,
      operation
    }))
    yield* trace.emit(TaskWorkSessionReportedTrace.make({ operation, report }))
  }),
  startFailed: Effect.fn("WorkflowTrace.taskWorkStartFailed")(function*(_request, failure) {
    yield* trace.emit(TaskWorkStartRequestedTrace.make({ operation }))
    yield* trace.emit(TaskWorkStartRequestFailedTrace.make({ failure, operation }))
  }),
  startRequested: Effect.fn("WorkflowTrace.taskWorkStartRequested")(function*(_request, acknowledgement) {
    yield* trace.emit(TaskWorkStartRequestedTrace.make({ operation }))
    yield* trace.emit(TaskWorkStartRequestAcknowledgedTrace.make({ acknowledgement, operation }))
  })
})

export const TaskWorkStartRequestedTrace = Schema.TaggedStruct(
  "TaskWorkStartRequested",
  { operation: WorkflowOperation.cases.EstablishTaskWorkSession }
)

export const TaskWorkStartRequestAcknowledgedTrace = Schema.TaggedStruct(
  "TaskWorkStartRequestAcknowledged",
  {
    acknowledgement: TaskWorkStartRequestAcknowledgement,
    operation: WorkflowOperation.cases.EstablishTaskWorkSession
  }
)

export const TaskWorkStartRequestFailedTrace = Schema.TaggedStruct(
  "TaskWorkStartRequestFailed",
  {
    failure: TaskWorkStartRequestFailure,
    operation: WorkflowOperation.cases.EstablishTaskWorkSession
  }
)

export const TaskWorkSessionLookupRequestedTrace = Schema.TaggedStruct(
  "TaskWorkSessionLookupRequested",
  {
    lookup: Schema.Struct({
      operationId: OperationId,
      plannedAttempt: PlannedTaskAttempt
    }),
    observationId: ProviderObservationId,
    operation: WorkflowOperation.cases.EstablishTaskWorkSession
  }
)

export const TaskWorkSessionLookupFailedTrace = Schema.TaggedStruct(
  "TaskWorkSessionLookupFailed",
  {
    failure: TaskWorkSessionLookupFailure,
    operation: WorkflowOperation.cases.EstablishTaskWorkSession
  }
)

export const TaskWorkSessionReportedTrace = Schema.TaggedStruct(
  "TaskWorkSessionReported",
  {
    operation: WorkflowOperation.cases.EstablishTaskWorkSession,
    report: TaskWorkSessionReport
  }
)

export const TaskWorkSessionEstablishedTrace = Schema.TaggedStruct(
  "TaskWorkSessionEstablished",
  {
    operation: WorkflowOperation.cases.EstablishTaskWorkSession,
    outcome: WorkflowOutcome.cases.TaskWorkSessionEstablished
  }
)

export const TaskWorkSessionLookupDidNotConvergeTrace = Schema.TaggedStruct(
  "TaskWorkSessionLookupDidNotConverge",
  {
    failure: TaskWorkSessionLookupDidNotConverge,
    operation: WorkflowOperation.cases.EstablishTaskWorkSession
  }
)

export const TaskWorkSessionEstablishmentDidNotConvergeTrace = Schema.TaggedStruct(
  "TaskWorkSessionEstablishmentDidNotConverge",
  {
    failure: TaskWorkSessionEstablishmentDidNotConverge,
    operation: WorkflowOperation.cases.EstablishTaskWorkSession
  }
)
