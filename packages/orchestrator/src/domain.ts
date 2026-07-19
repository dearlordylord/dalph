import { Schema } from "effect"

export const FixtureTarget = Schema.NonEmptyString.pipe(
  Schema.brand("FixtureTarget")
)
export type FixtureTarget = typeof FixtureTarget.Type

export const TaskId = Schema.NonEmptyString.pipe(Schema.brand("TaskId"))
export type TaskId = typeof TaskId.Type

export const TrackerRevision = Schema.NonEmptyString.pipe(
  Schema.brand("TrackerRevision")
)
export type TrackerRevision = typeof TrackerRevision.Type

export const TaskLifecycle = Schema.TaggedUnion({
  Open: {},
  CompletedSuccessfully: {},
  TerminalWithoutSuccess: {}
})
export type TaskLifecycle = typeof TaskLifecycle.Type

export const TrackerTask = Schema.Struct({
  id: TaskId,
  lifecycle: TaskLifecycle,
  parentTaskId: Schema.NullOr(TaskId),
  prerequisiteIds: Schema.Array(TaskId)
})
export type TrackerTask = Schema.Schema.Type<typeof TrackerTask>

export const TrackerSnapshot = Schema.Struct({
  revision: TrackerRevision,
  tasks: Schema.Array(TrackerTask)
})
export type TrackerSnapshot = Schema.Schema.Type<typeof TrackerSnapshot>
