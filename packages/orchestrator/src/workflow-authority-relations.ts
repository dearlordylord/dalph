import type { PlannedTaskAttempt, TaskWorkSessionId } from "./domain.js"
import type { PlannedBranchReady, PlannedWorktreeAbsent, PlannedWorktreeReady } from "./git-worktree.js"
import type { TaskExecutionOutcome, TaskExecutionReport } from "./task-execution.js"
import type { TaskWorkSessionReport } from "./task-work-start.js"
import type { ActiveTaskClaim, TaskClaimAcquisition, TaskClaimObservation } from "./tracker-mutation.js"
import { isExactTaskClaim } from "./tracker-mutation.js"

/** Current claim authority must still name the exact durable owner capability. */
export const claimAuthorityMatches = (
  observed: TaskClaimObservation,
  durable: ActiveTaskClaim | TaskClaimAcquisition
): boolean =>
  observed._tag === "ActiveTaskClaim" && isExactTaskClaim(observed, {
    _tag: "ActiveTaskClaim",
    ...durable
  })

/** Git HEAD may advance, but the planned Base, branch, and worktree cannot change. */
export const worktreeAuthorityMatches = (
  observed: PlannedBranchReady | PlannedWorktreeAbsent | PlannedWorktreeReady,
  plannedAttempt: PlannedTaskAttempt
): boolean =>
  observed._tag === "PlannedWorktreeReady"
  && observed.baseSha === plannedAttempt.baseSha
  && observed.branch === plannedAttempt.branch
  && observed.worktree === plannedAttempt.worktree

/** A completed session remains owned by the exact provider session identity. */
export const sessionAuthorityMatches = (
  observed: TaskWorkSessionReport,
  durableSessionId: TaskWorkSessionId
): boolean =>
  observed._tag === "MatchingTaskWorkSessionReported"
  && observed.sessionId === durableSessionId

/** Terminal execution evidence is immutable once the workflow records its outcome. */
export const executionAuthorityMatches = (
  observed: TaskExecutionReport,
  durable: TaskExecutionOutcome
): boolean => {
  if (observed.operationId !== durable.operationId || observed.sessionId !== durable.sessionId) return false
  switch (durable._tag) {
    case "Succeeded":
      return observed._tag === "SuccessfulTaskExecutionReported"
        && observed.processId === durable.processId
        && observed.output === durable.output
    case "Failed":
      return observed._tag === "FailedTaskExecutionReported"
        && observed.processId === durable.processId
        && observed.exitCode === durable.exitCode
        && observed.partialOutput === durable.partialOutput
    case "Interrupted":
      return observed._tag === "InterruptedTaskExecutionReported"
        && observed.processId === durable.processId
        && observed.partialOutput === durable.partialOutput
    case "ResourceEmergency":
      return observed._tag === "ResourceEmergencyTaskExecutionReported"
        && observed.processId === durable.processId
        && observed.cause === durable.cause
        && observed.detail === durable.detail
        && observed.partialOutput === durable.partialOutput
  }
}
