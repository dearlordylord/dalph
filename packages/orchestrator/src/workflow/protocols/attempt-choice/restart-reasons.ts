/** A boundary fact prevented Restart from proving that it may record P2 during this activation. */
export type AttemptRestartPendingReason =
  | "ClaimAbsent"
  | "ClaimForeign"
  | "ClaimUnreadable"
  | "ExecutorContradictory"
  | "ExecutorRunning"
  | "ExecutorUnavailable"
  | "OldWorktreeNotReady"
  | "OldWorktreeUnreadable"
  | "TargetHeadUnreadable"
  | "TaskFactsUnreadable"
  | "TaskNotEligible"

/** Current durable facts permanently reject the exact applied Restart choice. */
export type AttemptRestartRejectedReason =
  | "CompletedDoesNotAuthorizeReplacement"
  | "FailedDoesNotAuthorizeReplacement"
  | "NewFingerprintChoiceRequired"

/** Recovery also waits when coordinator configuration cannot name the Git integration target to reread. */
export type AttemptRestartWaitReason = AttemptRestartPendingReason | "IntegrationTargetUnavailable"
