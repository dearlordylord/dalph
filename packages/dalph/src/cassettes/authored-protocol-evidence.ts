import { AttemptId, GitCommitSha, TaskId, TaskRevision } from "@dalph/contracts"
import { ControlDirection, TaskClaimReacquisitionRequestId } from "@dalph/orchestrator"
import { Schema } from "effect"

/** Optional evidence from the claim, attempt-planning, and worktree protocol. */
export const AuthoredProtocolEvidence = Schema.TaggedUnion({
  AttemptChoiceApplied: {
    attemptId: AttemptId,
    choice: Schema.Literals(["ContinueExistingAttempt", "RestartTaskImplementation", "StopTaskImplementation"]),
    observedTaskRevision: TaskRevision,
    taskId: TaskId
  },
  AttemptImplementationAbandoned: { attemptId: AttemptId, taskId: TaskId },
  PlannedAttemptReplaced: { priorAttemptId: AttemptId, successorAttemptId: AttemptId, taskId: TaskId },
  AttemptWorktreeLost: { attemptId: AttemptId, taskId: TaskId },
  CompatibleTargetAdvance: { plannedBaseSha: GitCommitSha, targetHeadSha: GitCommitSha, taskId: TaskId },
  ControlDirectionApplied: {
    direction: ControlDirection,
    subject: Schema.TaggedUnion({ Run: {}, Task: { taskId: TaskId } })
  },
  IncompatibleTargetRewrite: { plannedBaseSha: GitCommitSha, targetHeadSha: GitCommitSha, taskId: TaskId },
  StoppedAttemptClaimNoReleaseObserved: { claimState: Schema.Literals(["Foreign", "Missing"]), taskId: TaskId },
  TaskAttemptPlanned: { attemptId: AttemptId, taskId: TaskId },
  TaskClaimAcquired: { taskId: TaskId },
  TaskClaimObserved: { claimState: Schema.Literals(["Exact", "Foreign", "Missing"]), taskId: TaskId },
  TaskClaimReadExhausted: { taskId: TaskId },
  TaskClaimReacquisitionDirected: { requestId: TaskClaimReacquisitionRequestId, taskId: TaskId },
  TaskClaimReleased: { taskId: TaskId },
  TaskWorktreeReady: { attemptId: AttemptId, taskId: TaskId }
})
export type AuthoredProtocolEvidence = typeof AuthoredProtocolEvidence.Type
