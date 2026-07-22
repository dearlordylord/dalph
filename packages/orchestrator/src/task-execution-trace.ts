import { Schema } from "effect"
import { TaskExecutionStartedReport } from "./task-execution.js"
import { WorkflowOperation } from "./workflow-operation.js"
import { WorkflowOutcome } from "./workflow-outcome.js"

/** Records one held unit of bounded task-work capacity, not evidence of task work. */
export const TaskExecutionAdmitted = Schema.TaggedStruct(
  "TaskExecutionAdmitted",
  { operation: WorkflowOperation.cases.ExecuteTaskWork }
)

/** Records provider evidence that task work began, not admission or a request. */
export const TaskExecutionStarted = Schema.TaggedStruct(
  "TaskExecutionStarted",
  {
    observation: TaskExecutionStartedReport,
    operation: WorkflowOperation.cases.ExecuteTaskWork
  }
)

/** Records one discriminated process observation without deciding task success. */
export const TaskExecutionOutcomeObserved = Schema.TaggedStruct(
  "TaskExecutionOutcomeObserved",
  {
    operation: WorkflowOperation.cases.ExecuteTaskWork,
    outcome: WorkflowOutcome.cases.TaskExecutionObserved
  }
)

/** Records a pure process simulation without claiming execution-substrate evidence. */
export const TaskExecutionSimulated = Schema.TaggedStruct(
  "TaskExecutionSimulated",
  {
    operation: WorkflowOperation.cases.ExecuteTaskWork,
    outcome: WorkflowOutcome.cases.TaskExecutionSimulated
  }
)

/** Records a pure plan-derived simulation without claiming provider evidence. */
export const TaskWorkSessionEstablishmentSimulatedTrace = Schema.TaggedStruct(
  "TaskWorkSessionEstablishmentSimulated",
  {
    operation: WorkflowOperation.cases.EstablishTaskWorkSession,
    outcome: WorkflowOutcome.cases.TaskWorkSessionEstablishmentSimulated
  }
)
