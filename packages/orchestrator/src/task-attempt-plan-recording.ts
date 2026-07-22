import { Schema } from "effect"
import { AttemptId, OperationId, PlannedTaskAttempt, RunId } from "./domain.js"
import { WorkflowOperation } from "./workflow-operation.js"

export { samePlannedTaskAttempt } from "./planned-task-attempt.js"

/** The attempt plan belongs to a different durable workflow run. */
export class TaskAttemptPlanRunContradiction extends Schema.TaggedErrorClass<TaskAttemptPlanRunContradiction>()(
  "TaskAttemptPlanRunContradiction",
  {
    journalRunId: RunId,
    operationId: OperationId,
    plannedAttemptRunId: RunId
  }
) {}

/** Journal history cannot prove the exact plan required by session establishment. */
export class TaskAttemptPlanHistoryContradiction extends Schema.TaggedErrorClass<TaskAttemptPlanHistoryContradiction>()(
  "TaskAttemptPlanHistoryContradiction",
  {
    attemptId: AttemptId,
    operationId: OperationId,
    reason: Schema.Literals([
      "CausalPredecessorMissing",
      "Missing",
      "MultiplePlans",
      "PlanMismatch"
    ])
  }
) {}

/** A durable journal append acknowledged one exact task-attempt plan. */
export const TaskAttemptPlanRecordAcknowledged = Schema.TaggedStruct(
  "TaskAttemptPlanRecordAcknowledged",
  { plannedAttempt: PlannedTaskAttempt }
)

/** Dry-run selected the plan operation without recording or mutating resources. */
export const TaskAttemptPlanRecordingSimulated = Schema.TaggedStruct(
  "TaskAttemptPlanRecordingSimulated",
  { operation: WorkflowOperation.cases.RecordTaskAttemptPlan }
)

/** Records acknowledgement that one immutable attempt plan is durable. */
export const TaskAttemptPlanAcknowledged = Schema.TaggedStruct(
  "TaskAttemptPlanAcknowledged",
  { operation: WorkflowOperation.cases.RecordTaskAttemptPlan }
)

export const TaskAttemptPlanRecordingResult = Schema.Union([
  TaskAttemptPlanRecordAcknowledged,
  TaskAttemptPlanRecordingSimulated
])
export type TaskAttemptPlanRecordingResult = typeof TaskAttemptPlanRecordingResult.Type
