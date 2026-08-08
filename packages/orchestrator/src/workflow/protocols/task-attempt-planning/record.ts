import { Schema } from "effect"
import { AttemptId, PlannedTaskAttempt, RunId } from "@dalph/contracts"
import { OperationId } from "../../identity.js"
import { WorkflowOperation } from "../../registry/operation.js"

export { samePlannedTaskAttempt } from "@dalph/contracts"

/** The planned task attempt belongs to a different durable workflow run. */
export class TaskAttemptPlanRunContradiction extends Schema.TaggedErrorClass<TaskAttemptPlanRunContradiction>()(
  "TaskAttemptPlanRunContradiction",
  { journalRunId: RunId, operationId: OperationId, plannedAttemptRunId: RunId }
) {}

/** Journal history cannot prove the exact plan required by executor work. */
export class TaskAttemptPlanHistoryContradiction extends Schema.TaggedErrorClass<TaskAttemptPlanHistoryContradiction>()(
  "TaskAttemptPlanHistoryContradiction",
  {
    attemptId: AttemptId,
    operationId: OperationId,
    reason: Schema.Literals(["CausalPredecessorMissing", "Missing", "MultiplePlans", "PlanMismatch"])
  }
) {}

/** A durable journal append acknowledged one exact planned task attempt. */
export const TaskAttemptPlanRecordAcknowledged = Schema.TaggedStruct("TaskAttemptPlanRecordAcknowledged", {
  plannedAttempt: PlannedTaskAttempt
})

/** Records acknowledgement that one immutable planned task attempt is durable. */
export const TaskAttemptPlanAcknowledged = Schema.TaggedStruct("TaskAttemptPlanAcknowledged", {
  operation: WorkflowOperation.cases.RecordTaskAttemptPlan
})

export const TaskAttemptPlanRecordingResult = TaskAttemptPlanRecordAcknowledged
export type TaskAttemptPlanRecordingResult = typeof TaskAttemptPlanRecordingResult.Type
