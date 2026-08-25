import type { PlannedAttemptExecutorCorrelation, TaskId } from "@dalph/contracts"
import type { OperationId } from "../../workflow/identity.js"

/**
 * Journal-derived task-work responsibility before executor work has begun.
 * A task without a plan cannot carry an attempt correlation; a planned task
 * must carry the exact Run/Attempt pair that planning recorded.
 */
export type RequiredPreStartTaskWorkPosition =
  | {
      readonly _tag: "UnplannedPreStartTaskWorkPosition"
      readonly claimOperationId: OperationId
      readonly taskId: TaskId
    }
  | {
      readonly _tag: "PlannedPreStartTaskWorkPosition"
      readonly claimOperationId: OperationId
      readonly correlation: PlannedAttemptExecutorCorrelation
      readonly taskId: TaskId
    }
