import { TaskId } from "@dalph/contracts"
import { Schema } from "effect"
import { TrackerTaskDescriptor, type TrackerTask } from "../../authorities/task-tracker/task.js"

/** Intrinsic tracker descriptions attached only to tasks named by the complete observation. */
export const TaskDescriptorRows = Schema.Array(Schema.Struct({ taskId: TaskId, descriptor: TrackerTaskDescriptor }))

export const descriptorSubjectsMatch = (fact: {
  readonly taskIds: ReadonlyArray<TaskId>
  readonly descriptors?: typeof TaskDescriptorRows.Type
}) =>
  fact.descriptors === undefined ||
  (new Set(fact.descriptors.map(({ taskId }) => taskId)).size === fact.descriptors.length &&
    fact.descriptors.every(({ taskId }) => fact.taskIds.includes(taskId))) ||
  "descriptors must identify distinct tasks in the complete observation"

export const observedDescriptorsFor = (tasks: ReadonlyArray<Pick<TrackerTask, "id" | "descriptor">>) => {
  const descriptors = tasks.flatMap(({ descriptor, id }) =>
    descriptor === undefined ? [] : [{ taskId: id, descriptor }]
  )
  return descriptors.length === 0 ? {} : { descriptors }
}
