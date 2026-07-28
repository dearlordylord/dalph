import { Schema } from "effect"

/** Dalph's zero-or-one task-work position requirement for one transition. */
export const TaskWorkCapacityRequirement = Schema.TaggedUnion({
  NoTaskWorkPosition: {},
  OneTaskWorkPosition: {}
})
export type TaskWorkCapacityRequirement = typeof TaskWorkCapacityRequirement.Type

export const noTaskWorkCapacityRequirement = TaskWorkCapacityRequirement.cases.NoTaskWorkPosition.make({})
export const oneTaskWorkCapacityRequirement = TaskWorkCapacityRequirement.cases.OneTaskWorkPosition.make({})

/**
 * @deprecated Transitional #158 leakage from the review-loop executor.
 * Generic Dalph's final policy is only about starting or continuing one opaque
 * outer invocation. Do not add another internal activity name here.
 */
export type TaskWorkCapacityActivity =
  | "ImplementationDisposition"
  | "ImplementationEvidenceSealing"
  | "ImplementationReview"
  | "ReviewFindingsHandback"
  | "TaskExecution"

const taskWorkCapacityPolicy: Readonly<
  Record<TaskWorkCapacityActivity, TaskWorkCapacityRequirement>
> = {
  ImplementationDisposition: noTaskWorkCapacityRequirement,
  ImplementationEvidenceSealing: noTaskWorkCapacityRequirement,
  ImplementationReview: oneTaskWorkCapacityRequirement,
  ReviewFindingsHandback: oneTaskWorkCapacityRequirement,
  TaskExecution: oneTaskWorkCapacityRequirement
}

/**
 * @deprecated #158 removes this internal-stage mapping from generic code.
 * It must not be treated as the executor contract.
 */
export const taskWorkCapacityRequirementFor = (
  activity: TaskWorkCapacityActivity
): TaskWorkCapacityRequirement => taskWorkCapacityPolicy[activity]
