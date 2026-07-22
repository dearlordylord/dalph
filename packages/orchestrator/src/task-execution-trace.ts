import { Schema } from "effect"
import { WorkflowOperation } from "./workflow-operation.js"
import { WorkflowOutcome } from "./workflow-outcome.js"

/** Records one held unit of bounded task-work capacity, not evidence of task work. */
export const TaskExecutionAdmitted = Schema.TaggedStruct(
  "TaskExecutionAdmitted",
  { operation: WorkflowOperation.cases.EstablishTaskWorkSession }
)

/** Records provider evidence that task work began, not admission or a request. */
export const TaskExecutionStarted = Schema.TaggedStruct(
  "TaskExecutionStarted",
  { operation: WorkflowOperation.cases.EstablishTaskWorkSession }
)

/** Records a pure plan-derived simulation without claiming provider evidence. */
export const TaskWorkSessionEstablishmentSimulatedTrace = Schema.TaggedStruct(
  "TaskWorkSessionEstablishmentSimulated",
  {
    operation: WorkflowOperation.cases.EstablishTaskWorkSession,
    outcome: WorkflowOutcome.cases.TaskWorkSessionEstablishmentSimulated
  }
)
