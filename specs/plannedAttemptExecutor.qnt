// Models issue #158's coarse same-process executor boundary. Detailed review,
// retry, provider-session, and convergence policy are intentionally absent.
module plannedAttemptExecutor {
  type Status =
    | NoReport
    | ResponsibilityBegan
    | Running
    | SuspensionRequested
    | SafelySuspended
    | Terminal

  type State = {
    status: Status,
    correlationRunId: int,
    correlationAttemptId: int,
    positionHeld: bool,
  }

  pure val RUN_ID = 158
  pure val ATTEMPT_ID = 1

  var state: State

  val everyStatusUsesExactPlannedAttempt: bool =
    state.status == NoReport
      or and {
        state.correlationRunId == RUN_ID,
        state.correlationAttemptId == ATTEMPT_ID,
      }

  val positionHeldUntilSuspensionResult: bool =
    state.positionHeld
      == or {
        state.status == ResponsibilityBegan,
        state.status == Running,
        state.status == SuspensionRequested,
      }

  val safeSuspensionReleasesPosition: bool =
    state.status != SafelySuspended or not(state.positionHeld)

  val terminalReleasesPosition: bool =
    state.status != Terminal or not(state.positionHeld)

  val suspensionRequestRetainsPosition: bool =
    state.status != SuspensionRequested or state.positionHeld

  val responsibilityBeganReached: bool = state.status == ResponsibilityBegan
  val runningReached: bool = state.status == Running
  val suspensionRequestedReached: bool = state.status == SuspensionRequested
  val safelySuspendedReached: bool = state.status == SafelySuspended
  val terminalReached: bool = state.status == Terminal

  action init: bool = all {
    state' = {
      status: NoReport,
      correlationRunId: RUN_ID,
      correlationAttemptId: ATTEMPT_ID,
      positionHeld: false,
    }
  }

  action startOrContinueRunning: bool = all {
    or {
      state.status == ResponsibilityBegan,
      state.status == Running,
      state.status == SafelySuspended,
    },
    state' = {
      status: Running,
      correlationRunId: RUN_ID,
      correlationAttemptId: ATTEMPT_ID,
      positionHeld: true,
    },
  }

  action beginResponsibility: bool = all {
    state.status == NoReport,
    state' = {
      status: ResponsibilityBegan,
      correlationRunId: RUN_ID,
      correlationAttemptId: ATTEMPT_ID,
      positionHeld: true,
    },
  }

  action requestSafeSuspension: bool = all {
    state.status == Running,
    state' = {
      status: SuspensionRequested,
      correlationRunId: RUN_ID,
      correlationAttemptId: ATTEMPT_ID,
      positionHeld: true,
    },
  }

  action reportSafelySuspended: bool = all {
    state.status == SuspensionRequested,
    state' = {
      status: SafelySuspended,
      correlationRunId: RUN_ID,
      correlationAttemptId: ATTEMPT_ID,
      positionHeld: false,
    },
  }

  action finishTerminal: bool = all {
    state.status != NoReport,
    state.status != Terminal,
    state' = {
      status: Terminal,
      correlationRunId: RUN_ID,
      correlationAttemptId: ATTEMPT_ID,
      positionHeld: false,
    },
  }

  action step: bool = any {
    beginResponsibility,
    startOrContinueRunning,
    requestSafeSuspension,
    reportSafelySuspended,
    finishTerminal,
  }
}
