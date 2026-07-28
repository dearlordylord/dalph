import { Schema } from "effect"

/** Dalph's zero-or-one task-work position requirement for one transition. */
export const TaskWorkCapacityRequirement = Schema.TaggedUnion({
  NoTaskWorkPosition: {},
  OneTaskWorkPosition: {}
})
export type TaskWorkCapacityRequirement = typeof TaskWorkCapacityRequirement.Type

export const noTaskWorkCapacityRequirement = TaskWorkCapacityRequirement.cases.NoTaskWorkPosition.make({})
export const oneTaskWorkCapacityRequirement = TaskWorkCapacityRequirement.cases.OneTaskWorkPosition.make({})
