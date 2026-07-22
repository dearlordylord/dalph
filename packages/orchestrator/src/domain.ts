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

/** Identifies the configured Dalph owner recorded in one task claim. */
export const ClaimOwner = Schema.NonEmptyString.pipe(Schema.brand("ClaimOwner"))
export type ClaimOwner = typeof ClaimOwner.Type

/**
 * Authorizes changes to one exact task claim. It is not a run, operation,
 * provider-user, task, or coordinator identity.
 */
export const ClaimToken = Schema.NonEmptyString.pipe(Schema.brand("ClaimToken"))
export type ClaimToken = typeof ClaimToken.Type

/** Identifies one recoverable managed traversal, not a task or operation. */
export const RunId = Schema.NonEmptyString.pipe(Schema.brand("RunId"))
export type RunId = typeof RunId.Type

/** Identifies one planned task attempt, not its task, run, or provider session. */
export const AttemptId = Schema.NonEmptyString.pipe(Schema.brand("AttemptId"))
export type AttemptId = typeof AttemptId.Type

/** Identifies the exact tracker-observed task content bound to one attempt. */
export const TaskRevision = Schema.NonEmptyString.pipe(
  Schema.brand("TaskRevision")
)
export type TaskRevision = typeof TaskRevision.Type

/** Identifies one exact Git commit used as a planned attempt's base. */
export const GitCommitSha = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}$/)
).pipe(Schema.brand("GitCommitSha"))
export type GitCommitSha = typeof GitCommitSha.Type

/** Locates the one exact worktree reserved for a planned task attempt. */
export const WorktreeLocator = Schema.NonEmptyString.pipe(
  Schema.brand("WorktreeLocator")
)
export type WorktreeLocator = typeof WorktreeLocator.Type

/** Locates the exact Git branch ref reserved for a planned task attempt. */
const isValidTaskBranchRef = (ref: string): boolean => {
  if (!ref.startsWith("refs/heads/") || ref === "refs/heads/") return false
  if (
    ref.includes("..")
    || ref.includes("//")
    || ref.includes("@{")
    || ref.endsWith("/")
    || ref.endsWith(".")
    || /[\u0000-\u0020\u007f~^:?*\[\\]/.test(ref)
  ) return false
  return ref.split("/").every((component) => !component.startsWith(".") && !component.endsWith(".lock"))
}

export const TaskBranchRef = Schema.String.check(
  Schema.makeFilter((ref) => isValidTaskBranchRef(ref) ? undefined : "must be a valid refs/heads Git ref")
).pipe(Schema.brand("TaskBranchRef"))
export type TaskBranchRef = typeof TaskBranchRef.Type

/** Locates the configured executor that will receive one planned task attempt. */
export const TaskExecutorLocator = Schema.NonEmptyString.pipe(
  Schema.brand("TaskExecutorLocator")
)
export type TaskExecutorLocator = typeof TaskExecutorLocator.Type

/** Locates one durable task-work session before a provider creates or discovers it. */
export const TaskWorkSessionLocator = Schema.NonEmptyString.pipe(
  Schema.brand("TaskWorkSessionLocator")
)
export type TaskWorkSessionLocator = typeof TaskWorkSessionLocator.Type

/** Identifies one provider-assigned task-work session. */
export const TaskWorkSessionId = Schema.NonEmptyString.pipe(
  Schema.brand("TaskWorkSessionId")
)
export type TaskWorkSessionId = typeof TaskWorkSessionId.Type

/** Identifies one durable reviewer session, not a task-work or implementer session. */
export const ReviewerSessionId = Schema.NonEmptyString.pipe(
  Schema.brand("ReviewerSessionId")
)
export type ReviewerSessionId = typeof ReviewerSessionId.Type

/** Orders semantic review rounds for one planned attempt, starting at one. */
export const SemanticReviewRound = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1)
).pipe(Schema.brand("SemanticReviewRound"))
export type SemanticReviewRound = typeof SemanticReviewRound.Type

/** Bounds automatic technical retries after an invocation failure; it is not a semantic review-round limit. */
export const TechnicalRetryLimit = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
).pipe(Schema.brand("TechnicalRetryLimit"))
export type TechnicalRetryLimit = typeof TechnicalRetryLimit.Type

/** Orders retries after the first technical invocation, starting at one; it is not a semantic review round. */
export const TechnicalRetryOrdinal = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
).pipe(Schema.brand("TechnicalRetryOrdinal"))
export type TechnicalRetryOrdinal = typeof TechnicalRetryOrdinal.Type

/** A positive whole-millisecond technical retry delay, distinct from an absolute time. */
export const TechnicalRetryDelayMillis = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
).pipe(Schema.brand("TechnicalRetryDelayMillis"))
export type TechnicalRetryDelayMillis = typeof TechnicalRetryDelayMillis.Type

/** The absolute virtual-clock millisecond before which one technical retry is ineligible. */
export const TechnicalRetryNotBefore = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
).pipe(Schema.brand("TechnicalRetryNotBefore"))
export type TechnicalRetryNotBefore = typeof TechnicalRetryNotBefore.Type

/** Identifies one reviewer finding across immutable review evidence. */
export const ReviewFindingId = Schema.NonEmptyString.pipe(
  Schema.brand("ReviewFindingId")
)
export type ReviewFindingId = typeof ReviewFindingId.Type

/** Identifies one task-work-provider response to a start request. */
export const ProviderRequestId = Schema.NonEmptyString.pipe(
  Schema.brand("ProviderRequestId")
)
export type ProviderRequestId = typeof ProviderRequestId.Type

/** Identifies one completed provider observation, not journal ordering. */
export const ProviderObservationId = Schema.NonEmptyString.pipe(
  Schema.brand("ProviderObservationId")
)
export type ProviderObservationId = typeof ProviderObservationId.Type

/** Identifies one provider-owned work unit within a task-work session. */
export const ProviderWorkUnitId = Schema.NonEmptyString.pipe(
  Schema.brand("ProviderWorkUnitId")
)
export type ProviderWorkUnitId = typeof ProviderWorkUnitId.Type

/** Identifies one operating-system worker process reported by a task runner. */
export const WorkerProcessId = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1)
).pipe(Schema.brand("WorkerProcessId"))
export type WorkerProcessId = typeof WorkerProcessId.Type

/** A provider-reported positive safe-integer status that proves task work failed. */
export const FailedProcessExitCode = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
).pipe(Schema.brand("FailedProcessExitCode"))
export type FailedProcessExitCode = typeof FailedProcessExitCode.Type

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

/** Locates Dalph's SQLite workflow journal, not a worktree or fixture. */
export const JournalDatabaseLocator = Schema.NonEmptyString.pipe(
  Schema.brand("JournalDatabaseLocator")
)
export type JournalDatabaseLocator = typeof JournalDatabaseLocator.Type

/** Locates one EvidenceStore root, not a worktree or workflow journal. */
export const EvidenceStoreLocator = Schema.NonEmptyString.pipe(
  Schema.brand("EvidenceStoreLocator")
)
export type EvidenceStoreLocator = typeof EvidenceStoreLocator.Type

/** Names a requested Git common-directory path before canonical resolution. */
export const GitCommonDirectoryTarget = Schema.NonEmptyString.pipe(
  Schema.brand("GitCommonDirectoryTarget")
)
export type GitCommonDirectoryTarget = typeof GitCommonDirectoryTarget.Type

/** Canonically locates one Git common directory, not a requested path alias. */
export const GitCommonDirectoryLocator = Schema.NonEmptyString.pipe(
  Schema.brand("GitCommonDirectoryLocator")
)
export type GitCommonDirectoryLocator = typeof GitCommonDirectoryLocator.Type

/** Identifies an on-disk journal schema generation; zero means uninitialized. */
export const JournalSchemaVersion = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0)
).pipe(Schema.brand("JournalSchemaVersion"))
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

export const defaultTaskWorkCapacity = TaskWorkCapacity.make(
  defaultTaskWorkCapacityValue
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

/** A normalized tracker-owned task value used outside provider adapters. */
export const Task = TrackerTask
export type Task = typeof Task.Type

/**
 * Binds one attempt to its exact tracker revision and every Git/executor
 * resource locator before any execution resource is created or discovered.
 */
export const PlannedTaskAttempt = Schema.Struct({
  attemptId: AttemptId,
  baseSha: GitCommitSha,
  branch: TaskBranchRef,
  executor: TaskExecutorLocator,
  runId: RunId,
  session: TaskWorkSessionLocator,
  taskId: TaskId,
  taskRevision: TaskRevision,
  worktree: WorktreeLocator
})
export type PlannedTaskAttempt = typeof PlannedTaskAttempt.Type

export const TrackerSnapshot = Schema.Struct({
  revision: TrackerRevision,
  tasks: Schema.Array(TrackerTask)
})
export type TrackerSnapshot = Schema.Schema.Type<typeof TrackerSnapshot>
