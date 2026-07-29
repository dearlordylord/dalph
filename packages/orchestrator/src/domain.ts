import { Schema } from "effect"

/** Identifies a fixture locator, not a task, run, or execution resource. */
export const FixtureTarget = Schema.NonEmptyString.pipe(Schema.brand("FixtureTarget"))
export type FixtureTarget = typeof FixtureTarget.Type

/** Identifies one GitHub issue ordinal within a repository, not its stable task identity. */
export const GithubIssueNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("GithubIssueNumber")
)
export type GithubIssueNumber = typeof GithubIssueNumber.Type

/** Identifies a GitHub repository owner only at the adapter target boundary. */
export const GithubRepositoryOwner = Schema.NonEmptyString.pipe(Schema.brand("GithubRepositoryOwner"))
export type GithubRepositoryOwner = typeof GithubRepositoryOwner.Type

/** Identifies a GitHub repository name only at the adapter target boundary. */
export const GithubRepositoryName = Schema.NonEmptyString.pipe(Schema.brand("GithubRepositoryName"))
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

/**
 * Identifies one exact user control command within a run's workflow journal.
 * It is not a workflow operation, run, task, or provider request identity.
 */
export const ControlCommandId = Schema.NonEmptyString.pipe(Schema.brand("ControlCommandId"))
export type ControlCommandId = typeof ControlCommandId.Type

/**
 * Identifies the Dalph user proven by an authenticated transport boundary.
 * It records the actor and does not grant task-claim or provider authority.
 */
export const AuthenticatedOperatorIdentity = Schema.NonEmptyString.pipe(Schema.brand("AuthenticatedOperatorIdentity"))
export type AuthenticatedOperatorIdentity = typeof AuthenticatedOperatorIdentity.Type

/** Identifies the configured Dalph owner recorded in one task claim. */
export const ClaimOwner = Schema.NonEmptyString.pipe(Schema.brand("ClaimOwner"))
export type ClaimOwner = typeof ClaimOwner.Type

/**
 * Authorizes changes to one exact task claim. It is not a run, operation,
 * provider-user, task, or coordinator identity.
 */
export const ClaimToken = Schema.NonEmptyString.pipe(Schema.brand("ClaimToken"))
export type ClaimToken = typeof ClaimToken.Type

/** Identifies one durable Dalph coordination run, not a task or operation. */
export const RunId = Schema.NonEmptyString.pipe(Schema.brand("RunId"))
export type RunId = typeof RunId.Type

/**
 * Fingerprints the immutable inputs of one process-local selected transition.
 * It is not a task revision, operation identity, journal position, or random nonce.
 */
export const SelectedTransitionFingerprint = Schema.NonEmptyString.pipe(Schema.brand("SelectedTransitionFingerprint"))
export type SelectedTransitionFingerprint = typeof SelectedTransitionFingerprint.Type

/**
 * Identifies one exact process-local selector result before operation intent.
 * It creates no workflow responsibility and is never persisted.
 */
export const SelectedTransitionIdentity = Schema.Struct({
  decisionFingerprint: SelectedTransitionFingerprint,
  runId: RunId,
  subjectTaskId: TaskId,
  transitionTag: Schema.NonEmptyString
}).pipe(Schema.brand("SelectedTransitionIdentity"))
export type SelectedTransitionIdentity = typeof SelectedTransitionIdentity.Type

/** Identifies one planned task attempt, not its task or run. */
export const AttemptId = Schema.NonEmptyString.pipe(Schema.brand("AttemptId"))
export type AttemptId = typeof AttemptId.Type

/** Fingerprints the exact tracker-observed task content bound to one attempt; it is not a version counter. */
export const TaskRevision = Schema.NonEmptyString.pipe(Schema.brand("TaskRevision"))
export type TaskRevision = typeof TaskRevision.Type

/** Identifies one exact Git commit used as a planned task attempt's base. */
export const GitCommitSha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)).pipe(Schema.brand("GitCommitSha"))
export type GitCommitSha = typeof GitCommitSha.Type

/** Locates the one exact worktree reserved for a planned task attempt. */
export const WorktreeLocator = Schema.NonEmptyString.pipe(Schema.brand("WorktreeLocator"))
export type WorktreeLocator = typeof WorktreeLocator.Type

/** Locates the exact Git branch ref reserved for a planned task attempt. */
const isValidTaskBranchRef = (ref: string): boolean => {
  if (!ref.startsWith("refs/heads/") || ref === "refs/heads/") return false
  if (
    ref.includes("..") ||
    ref.includes("//") ||
    ref.includes("@{") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    /[\u0000-\u0020\u007f~^:?*[\\]/.test(ref)
  )
    return false
  return ref.split("/").every((component) => !component.startsWith(".") && !component.endsWith(".lock"))
}

export const TaskBranchRef = Schema.String.check(
  Schema.makeFilter((ref) => (isValidTaskBranchRef(ref) ? undefined : "must be a valid refs/heads Git ref"))
).pipe(Schema.brand("TaskBranchRef"))
export type TaskBranchRef = typeof TaskBranchRef.Type

/** Locates the configured executor that will receive one planned task attempt. */
export const TaskExecutorLocator = Schema.NonEmptyString.pipe(Schema.brand("TaskExecutorLocator"))
export type TaskExecutorLocator = typeof TaskExecutorLocator.Type

/** Identifies one durable workflow-journal-history fact within a run. */
export const JournalRecordKey = Schema.NonEmptyString.pipe(Schema.brand("JournalRecordKey"))
export type JournalRecordKey = typeof JournalRecordKey.Type

/** Orders committed journal facts within one run, starting at one. */
export const JournalPosition = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(Schema.brand("JournalPosition"))
export type JournalPosition = typeof JournalPosition.Type

/** Selects one immutable journal payload decoder; it is independent of the SQLite schema generation. */
export const JournalEventVersion = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("JournalEventVersion")
)
export type JournalEventVersion = typeof JournalEventVersion.Type

/** Names the decoded workflow-event variant duplicated in the physical row for boundary checks. */
export const JournalEventKind = Schema.NonEmptyString.pipe(Schema.brand("JournalEventKind"))
export type JournalEventKind = typeof JournalEventKind.Type

/** Locates Dalph's SQLite workflow journal, not a worktree or fixture. */
export const JournalDatabaseLocator = Schema.NonEmptyString.pipe(Schema.brand("JournalDatabaseLocator"))
export type JournalDatabaseLocator = typeof JournalDatabaseLocator.Type

/** Names a requested Git common-directory path before canonical resolution. */
export const GitCommonDirectoryTarget = Schema.NonEmptyString.pipe(Schema.brand("GitCommonDirectoryTarget"))
export type GitCommonDirectoryTarget = typeof GitCommonDirectoryTarget.Type

/** Canonically locates one Git common directory, not a requested path alias. */
export const GitCommonDirectoryLocator = Schema.NonEmptyString.pipe(Schema.brand("GitCommonDirectoryLocator"))
export type GitCommonDirectoryLocator = typeof GitCommonDirectoryLocator.Type

/** Identifies an on-disk journal schema generation; zero means uninitialized. */
export const JournalSchemaVersion = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("JournalSchemaVersion")
)
export type JournalSchemaVersion = typeof JournalSchemaVersion.Type

// Accepted policy: https://github.com/dearlordylord/dalph/issues/24
// Runtime resizing owner: https://github.com/dearlordylord/dalph/issues/54
// Future policy revision owner: https://github.com/dearlordylord/dalph/issues/64
const defaultTaskWorkCapacityValue = 2

// Accepted policy: https://github.com/dearlordylord/dalph/issues/24
// Runtime resizing owner: https://github.com/dearlordylord/dalph/issues/54
// Future policy revision owner: https://github.com/dearlordylord/dalph/issues/64
export const maximumTaskWorkCapacityValue = 8

/**
 * The bounded number of runnable tasks that the coordinator may admit for
 * execution. This is neither tracker execution admission nor integration
 * capacity.
 */
export const TaskWorkCapacity = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(maximumTaskWorkCapacityValue)
).pipe(Schema.brand("TaskWorkCapacity"))
export type TaskWorkCapacity = typeof TaskWorkCapacity.Type

export const defaultTaskWorkCapacity = TaskWorkCapacity.make(defaultTaskWorkCapacityValue)

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

/**
 * Binds one attempt to its exact task revision and Git/executor resource
 * locators before executor work begins.
 */
export const PlannedTaskAttempt = Schema.Struct({
  attemptId: AttemptId,
  baseSha: GitCommitSha,
  branch: TaskBranchRef,
  executor: TaskExecutorLocator,
  runId: RunId,
  taskId: TaskId,
  taskRevision: TaskRevision,
  worktree: WorktreeLocator
})
export type PlannedTaskAttempt = typeof PlannedTaskAttempt.Type

export const TrackerSnapshot = Schema.Struct({ revision: TrackerRevision, tasks: Schema.Array(TrackerTask) })
export type TrackerSnapshot = Schema.Schema.Type<typeof TrackerSnapshot>
