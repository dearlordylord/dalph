import { Schema } from "effect"

export const FixtureTarget = Schema.NonEmptyString.pipe(
  Schema.brand("FixtureTarget")
)
export type FixtureTarget = typeof FixtureTarget.Type

export const TaskId = Schema.NonEmptyString.pipe(Schema.brand("TaskId"))
export type TaskId = typeof TaskId.Type

// Accepted by the orchestration specification and intentionally revised only by
// https://github.com/dearlordylord/dalph/issues/24,
// https://github.com/dearlordylord/dalph/issues/54, and
// https://github.com/dearlordylord/dalph/issues/64.
const defaultTaskExecutionCapacityValue = 2

// Accepted by the orchestration specification and intentionally revised only by
// https://github.com/dearlordylord/dalph/issues/24,
// https://github.com/dearlordylord/dalph/issues/54, and
// https://github.com/dearlordylord/dalph/issues/64.
const maximumTaskExecutionCapacityValue = 8

export const TaskExecutionCapacity = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(maximumTaskExecutionCapacityValue)
).pipe(Schema.brand("TaskExecutionCapacity"))
export type TaskExecutionCapacity = typeof TaskExecutionCapacity.Type

export const defaultTaskExecutionCapacity = TaskExecutionCapacity.make(
  defaultTaskExecutionCapacityValue
)

export const maximumTaskExecutionCapacity = TaskExecutionCapacity.make(
  maximumTaskExecutionCapacityValue
)

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

export const isTaskOpen = (lifecycle: TaskLifecycle): boolean => lifecycle._tag === "Open"

export const isDependencySatisfied = (lifecycle: TaskLifecycle): boolean => lifecycle._tag === "CompletedSuccessfully"

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
