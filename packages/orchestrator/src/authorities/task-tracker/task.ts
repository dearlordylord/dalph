import { TaskId } from "@dalph/contracts"
import { Schema } from "effect"

/** Identifies tracker snapshot content, not workflow or journal ordering. */
export const TrackerRevision = Schema.NonEmptyString.pipe(Schema.brand("TrackerRevision"))
export type TrackerRevision = typeof TrackerRevision.Type

export const TaskLifecycle = Schema.TaggedUnion({ Open: {}, CompletedSuccessfully: {}, TerminalWithoutSuccess: {} })
export type TaskLifecycle = typeof TaskLifecycle.Type

export const isTaskOpen = (lifecycle: TaskLifecycle): boolean => lifecycle._tag === "Open"

export const isDependencySatisfied = (lifecycle: TaskLifecycle): boolean => lifecycle._tag === "CompletedSuccessfully"

export const TrackerTask = Schema.Struct({
  id: TaskId,
  lifecycle: TaskLifecycle,
  parentTaskId: Schema.NullOr(TaskId),
  prerequisiteIds: Schema.Array(TaskId)
})
export type TrackerTask = Schema.Schema.Type<typeof TrackerTask>

/** A normalized tracker-owned task value used outside provider adapters. */
export const Task = TrackerTask
export type Task = typeof Task.Type

export const TrackerSnapshot = Schema.Struct({ revision: TrackerRevision, tasks: Schema.Array(TrackerTask) })
export type TrackerSnapshot = Schema.Schema.Type<typeof TrackerSnapshot>
