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

  // A correlation an executor report may carry that is not this planned
  // attempt: another run, or an earlier attempt for the same task. Dalph
  // accepts a report only for the exact planned attempt, so these identities
  // are offered to every report action and never accepted.
  pure val OTHER_RUN_ID = 159
  pure val OTHER_ATTEMPT_ID = 2

  pure def isExactPlannedAttempt(runId: int, attemptId: int): bool =
    runId == RUN_ID and attemptId == ATTEMPT_ID

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

  // Running, SafelySuspended, and Terminal are executor reports and therefore
  // carry the correlation the executor supplied. Dalph records that supplied
  // correlation, and the exactness guard is what keeps a foreign one out.
  // The correlations an executor report may carry. Each report action draws
  // from this set itself, so the branching applies only where a report is
  // actually enabled.
  pure val REPORTED_CORRELATIONS: Set[(int, int)] = Set(
    (RUN_ID, ATTEMPT_ID),
    (OTHER_RUN_ID, ATTEMPT_ID),
    (RUN_ID, OTHER_ATTEMPT_ID),
  )

  action startOrContinueRunning: bool = {
    nondet reported = REPORTED_CORRELATIONS.oneOf()
    all {
      or {
        state.status == ResponsibilityBegan,
        state.status == Running,
        state.status == SafelySuspended,
      },
      isExactPlannedAttempt(reported._1, reported._2),
      state' = {
        status: Running,
        correlationRunId: reported._1,
        correlationAttemptId: reported._2,
        positionHeld: true,
      },
    }
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

  action reportSafelySuspended: bool = {
    nondet reported = REPORTED_CORRELATIONS.oneOf()
    all {
      state.status == SuspensionRequested,
      isExactPlannedAttempt(reported._1, reported._2),
      state' = {
        status: SafelySuspended,
        correlationRunId: reported._1,
        correlationAttemptId: reported._2,
        positionHeld: false,
      },
    }
  }

  action finishTerminal: bool = {
    nondet reported = REPORTED_CORRELATIONS.oneOf()
    all {
      state.status != NoReport,
      state.status != Terminal,
      isExactPlannedAttempt(reported._1, reported._2),
      state' = {
        status: Terminal,
        correlationRunId: reported._1,
        correlationAttemptId: reported._2,
        positionHeld: false,
      },
    }
  }

  action step: bool = any {
    beginResponsibility,
    startOrContinueRunning,
    requestSafeSuspension,
    reportSafelySuspended,
    finishTerminal,
  }
}
