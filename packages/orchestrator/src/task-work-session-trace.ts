import { Schema } from "effect"
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
