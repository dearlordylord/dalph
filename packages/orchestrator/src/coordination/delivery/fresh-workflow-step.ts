import type { PlannedTaskAttempt, TaskWorkSpecification } from "@dalph/contracts"
import { Data } from "effect"
import type { Task } from "../../authorities/task-tracker/task.js"
import type { OperationId } from "../../workflow/identity.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"
import type { AcceptedPlannedAttemptExecutorProgress } from "../frontier/fresh-facts.js"

/** One fresh ticket's exact next protocol step before any new identity is allocated. */
export type FreshWorkflowStep = Data.TaggedEnum<{
  ReadCurrentTaskGraph: { readonly predecessorOperationId: OperationId; readonly task: Task }
  AcquireTaskClaim: { readonly predecessorOperationId: OperationId; readonly task: Task }
  ReadPostClaimGraph: {
    readonly claimOperation: typeof WorkflowOperation.cases.AcquireTaskClaim.Type
    readonly predecessorOperationId: OperationId
    readonly task: Task
  }
  ReadTaskWorkSpecification: { readonly predecessorOperationId: OperationId; readonly task: Task }
  RecordTaskAttemptPlan: {
    readonly predecessorOperationId: OperationId
    readonly specification: TaskWorkSpecification
    readonly task: Task
  }
  ReconcileTaskWorktree: {
    readonly plannedAttempt: PlannedTaskAttempt
    readonly predecessorOperationId: OperationId
    readonly task: Task
  }
  BeginPlannedAttemptExecutorWork: {
    readonly plannedAttempt: PlannedTaskAttempt
    readonly specification: TaskWorkSpecification
    readonly task: Task
  }
  ObservePlannedAttemptExecutorWork: {
    readonly acceptedProgress: AcceptedPlannedAttemptExecutorProgress
    readonly plannedAttempt: PlannedTaskAttempt
    readonly specification: TaskWorkSpecification
    readonly task: Task
  }
}>

export const FreshWorkflowStep = Data.taggedEnum<FreshWorkflowStep>()
