// Prototype-only profile: restricts a restart trace to the closed M2
// reconstruction action inventory.
module frontierRecoveryRestartTrace {
  import frontierRecovery(CAPACITY = 1).* from "./frontierRecovery"

  action restartTraceStep: bool = any {
    orchestratorCommitsNextFreshTaskClaimIntent,
    taskTrackerReturnsTargetClosureReadAtNextRevision,
    taskTrackerReturnsTargetClosureReadWithPredecessor,
    taskTrackerReturnsTargetClosureReadWithExplicitAbsenceCoverage,
    crash,
    restart,
  }
}
