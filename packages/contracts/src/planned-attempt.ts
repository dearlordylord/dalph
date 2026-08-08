import { Schema } from "effect"
import { TaskExecutorLocator } from "./executor-locator.js"
import { GitCommitSha, TaskBranchRef, WorktreeLocator } from "./git-locator.js"
import { TaskId, TaskRevision } from "./task-identity.js"
import { RunId } from "./workflow-identity.js"

/** Identifies one planned task attempt, not its task or run. */
export const AttemptId = Schema.NonEmptyString.pipe(Schema.brand("AttemptId"))
export type AttemptId = typeof AttemptId.Type

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

/** Compares every immutable resource and identity captured by two attempts. */
export const plannedTaskAttemptEquivalence = Schema.toEquivalence(PlannedTaskAttempt)

export const samePlannedTaskAttempt = plannedTaskAttemptEquivalence
