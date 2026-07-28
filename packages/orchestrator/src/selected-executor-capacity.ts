import type { TaskWorkCapacityRequirement } from "./task-work-capacity.js"
import { noTaskWorkCapacityRequirement, oneTaskWorkCapacityRequirement } from "./task-work-capacity.js"

/**
 * Transitional #158 policy private to the colocated review-loop executor.
 * Generic Dalph must not inspect or copy these internal stage names.
 */
export type SelectedExecutorCapacityActivity =
  | "ImplementationDisposition"
  | "ImplementationEvidenceSealing"
  | "ImplementationReview"
  | "ReviewFindingsHandback"
  | "TaskExecution"

const selectedExecutorCapacityPolicy: Readonly<
  Record<SelectedExecutorCapacityActivity, TaskWorkCapacityRequirement>
> = {
  ImplementationDisposition: noTaskWorkCapacityRequirement,
  ImplementationEvidenceSealing: noTaskWorkCapacityRequirement,
  ImplementationReview: oneTaskWorkCapacityRequirement,
  ReviewFindingsHandback: oneTaskWorkCapacityRequirement,
  TaskExecution: oneTaskWorkCapacityRequirement
}

/**
 * Transitional #158 adapter used only while the review-loop executor remains
 * physically colocated. This is not part of the generic executor contract.
 */
export const selectedExecutorCapacityRequirementFor = (
  activity: SelectedExecutorCapacityActivity
): TaskWorkCapacityRequirement => selectedExecutorCapacityPolicy[activity]
