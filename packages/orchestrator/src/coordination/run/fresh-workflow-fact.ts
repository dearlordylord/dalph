import { Data } from "effect"
import type { PlannedAttemptExecutorReport, PlannedTaskAttempt, TaskId } from "@dalph/contracts"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import type { TaskWorkSpecification } from "../../authorities/task-tracker/task-work-specification.js"
import type { OperationId } from "../../workflow/identity.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"

/** A boundary result accepted by the non-durable workflow composition. */
export type SyntheticWorkflowFact = Data.TaggedEnum<{
  CurrentTaskGraphObserved: {
    readonly operationId: OperationId
    readonly snapshot: TaskDagSnapshot
    readonly taskId: TaskId
  }
  TaskClaimAcquisitionCompleted: {
    readonly operation: typeof WorkflowOperation.cases.AcquireTaskClaim.Type
    readonly taskId: TaskId
  }
  PostClaimGraphObserved: {
    readonly operationId: OperationId
    readonly snapshot: TaskDagSnapshot
    readonly taskId: TaskId
  }
  TaskWorkSpecificationObserved: {
    readonly operationId: OperationId
    readonly specification: TaskWorkSpecification
    readonly taskId: TaskId
  }
  TaskAttemptPlanRecorded: {
    readonly operationId: OperationId
    readonly plannedAttempt: PlannedTaskAttempt
    readonly taskId: TaskId
  }
  TaskWorktreeReconciled: { readonly plannedAttempt: PlannedTaskAttempt; readonly taskId: TaskId }
  PlannedAttemptExecutorWorkReported: {
    readonly plannedAttempt: PlannedTaskAttempt
    readonly report: PlannedAttemptExecutorReport
    readonly taskId: TaskId
  }
}>

export const SyntheticWorkflowFact = Data.taggedEnum<SyntheticWorkflowFact>()
