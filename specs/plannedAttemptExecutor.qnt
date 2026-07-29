// Models issue #158's coarse same-process executor boundary. Detailed review,
// retry, provider-session, and convergence policy are intentionally absent.
module plannedAttemptExecutor {
  type Report = NoReport | Running | SafelySuspended | Terminal

  type State = {
    report: Report,
    reportRunId: int,
    reportAttemptId: int,
    positionHeld: bool,
  }

  pure val RUN_ID = 158
  pure val ATTEMPT_ID = 1

  var state: State

  val everyReportUsesExactPlannedAttempt: bool =
    state.report == NoReport
      or and {
        state.reportRunId == RUN_ID,
        state.reportAttemptId == ATTEMPT_ID,
      }

  val positionHeldExactlyWhileRunning: bool =
    state.positionHeld == (state.report == Running)

  val safeSuspensionReleasesPosition: bool =
    state.report != SafelySuspended or not(state.positionHeld)

  val terminalReleasesPosition: bool =
    state.report != Terminal or not(state.positionHeld)

  val runningReached: bool = state.report == Running
  val safelySuspendedReached: bool = state.report == SafelySuspended
  val terminalReached: bool = state.report == Terminal

  action init: bool = all {
    state' = {
      report: NoReport,
      reportRunId: RUN_ID,
      reportAttemptId: ATTEMPT_ID,
      positionHeld: false,
    }
  }

  action startOrContinueRunning: bool = all {
    state.report != Terminal,
    state' = {
      report: Running,
      reportRunId: RUN_ID,
      reportAttemptId: ATTEMPT_ID,
      positionHeld: true,
    },
  }

  action requestSafeSuspension: bool = all {
    state.report == Running,
    state' = {
      report: SafelySuspended,
      reportRunId: RUN_ID,
      reportAttemptId: ATTEMPT_ID,
      positionHeld: false,
    },
  }

  action finishTerminal: bool = all {
    state.report != Terminal,
    state' = {
      report: Terminal,
      reportRunId: RUN_ID,
      reportAttemptId: ATTEMPT_ID,
      positionHeld: false,
    },
  }

  action step: bool = any {
    startOrContinueRunning,
    requestSafeSuspension,
    finishTerminal,
  }
}
