import { Schema } from "effect"

/** Identifies a fixture locator, not a task, run, or execution resource. */
export const FixtureTarget = Schema.NonEmptyString.pipe(
  Schema.brand("FixtureTarget")
)
export type FixtureTarget = typeof FixtureTarget.Type

/** Identifies one GitHub issue ordinal within a repository, not its stable task identity. */
export const GithubIssueNumber = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1)
).pipe(Schema.brand("GithubIssueNumber"))
export type GithubIssueNumber = typeof GithubIssueNumber.Type

/** Identifies a GitHub repository owner only at the adapter target boundary. */
export const GithubRepositoryOwner = Schema.NonEmptyString.pipe(
  Schema.brand("GithubRepositoryOwner")
)
export type GithubRepositoryOwner = typeof GithubRepositoryOwner.Type

/** Identifies a GitHub repository name only at the adapter target boundary. */
export const GithubRepositoryName = Schema.NonEmptyString.pipe(
  Schema.brand("GithubRepositoryName")
)
export type GithubRepositoryName = typeof GithubRepositoryName.Type

/** Names one GitHub issue-root query; it is interpreted only by the GitHub tracker adapter. */
export const GithubIssueTarget = Schema.TaggedStruct("GithubIssue", {
  issueNumber: GithubIssueNumber,
  owner: GithubRepositoryOwner,
  repository: GithubRepositoryName
})
export type GithubIssueTarget = typeof GithubIssueTarget.Type

/** Selects one tracker-native root without turning provider fields into task-domain facts. */
export const TrackerTarget = Schema.Union([FixtureTarget, GithubIssueTarget])
export type TrackerTarget = typeof TrackerTarget.Type

/** Identifies a tracker-owned task, not one of its attempts or operations. */
export const TaskId = Schema.NonEmptyString.pipe(Schema.brand("TaskId"))
export type TaskId = typeof TaskId.Type

/**
 * Causally binds one workflow operation's intent and observations. It is not a
 * task identity, attempt identity, journal position, or trace position.
 */
export const OperationId = Schema.NonEmptyString.pipe(Schema.brand("OperationId"))
export type OperationId = typeof OperationId.Type

/** Identifies one recoverable managed traversal, not a task or operation. */
export const RunId = Schema.NonEmptyString.pipe(Schema.brand("RunId"))
export type RunId = typeof RunId.Type

/** Identifies one durable managed-history fact within a run. */
export const JournalRecordKey = Schema.NonEmptyString.pipe(
  Schema.brand("JournalRecordKey")
)
export type JournalRecordKey = typeof JournalRecordKey.Type

/** Orders committed journal facts within one run, starting at one. */
export const JournalPosition = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1)
).pipe(Schema.brand("JournalPosition"))
export type JournalPosition = typeof JournalPosition.Type

/** Locates the SQLite authority journal, not a worktree or fixture. */
export const JournalDatabaseLocator = Schema.NonEmptyString.pipe(
  Schema.brand("JournalDatabaseLocator")
)
export type JournalDatabaseLocator = typeof JournalDatabaseLocator.Type

/** Identifies an on-disk journal schema generation; zero means uninitialized. */
export const JournalSchemaVersion = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0)
).pipe(Schema.brand("JournalSchemaVersion"))
export type JournalSchemaVersion = typeof JournalSchemaVersion.Type

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
