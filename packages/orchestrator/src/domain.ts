import { Schema } from "effect"

/** Identifies a fixture locator, not a task, run, or execution resource. */
export const FixtureTarget = Schema.NonEmptyString.pipe(
  Schema.brand("FixtureTarget")
)
export type FixtureTarget = typeof FixtureTarget.Type

/** Identifies a tracker-owned task, not one of its attempts or operations. */
export const TaskId = Schema.NonEmptyString.pipe(Schema.brand("TaskId"))
export type TaskId = typeof TaskId.Type

/**
 * Causally binds one workflow operation's intent and observations. It is not a
 * task identity, attempt identity, journal position, or trace position.
 */
export const OperationId = Schema.NonEmptyString.pipe(Schema.brand("OperationId"))
export type OperationId = typeof OperationId.Type

// Accepted policy: https://github.com/dearlordylord/dalph/issues/24
// Runtime resizing owner: https://github.com/dearlordylord/dalph/issues/54
// Future policy revision owner: https://github.com/dearlordylord/dalph/issues/64
const defaultTaskExecutionCapacityValue = 2

// Accepted policy: https://github.com/dearlordylord/dalph/issues/24
// Runtime resizing owner: https://github.com/dearlordylord/dalph/issues/54
// Future policy revision owner: https://github.com/dearlordylord/dalph/issues/64
export const maximumTaskExecutionCapacityValue = 8

/**
 * The bounded number of runnable tasks that the coordinator may admit for
 * execution. This is neither tracker execution admission nor integration
 * capacity.
 */
export const TaskExecutionCapacity = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(maximumTaskExecutionCapacityValue)
).pipe(Schema.brand("TaskExecutionCapacity"))
export type TaskExecutionCapacity = typeof TaskExecutionCapacity.Type

export const defaultTaskExecutionCapacity = TaskExecutionCapacity.make(
  defaultTaskExecutionCapacityValue
)

/** Identifies tracker snapshot content, not workflow or journal ordering. */
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
