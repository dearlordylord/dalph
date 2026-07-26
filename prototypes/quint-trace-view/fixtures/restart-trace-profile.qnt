// PROTOTYPE ONLY: restricts generated restart traces to the existing closed
// reconstruction action inventory. It does not compute legal transitions.
module frontierRecoveryRestartTrace {
  import frontierRecovery(CAPACITY = 1).* from "../../../specs/frontierRecovery"

  action restartTraceStep: bool = any {
    reconstructionStep,
    crash,
    restart,
  }
}
