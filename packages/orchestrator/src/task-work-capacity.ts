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
 * The Dalph-owned activity whose orchestration policy decides whether one
 * task-work position is required. Executors only report lifecycle evidence.
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

/** Returns the single orchestration-owned capacity rule used live and on restart. */
export const taskWorkCapacityRequirementFor = (
  activity: TaskWorkCapacityActivity
): TaskWorkCapacityRequirement => taskWorkCapacityPolicy[activity]
