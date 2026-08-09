// Models coarse same-process executor boundary. Detailed review,
// retry, provider-session, and convergence policy are intentionally absent.
module plannedAttemptExecutor {
  // The identity an executor claims on a report. Dalph's own intended identity
  // is constant here, because Dalph planned the attempt; only a claim can
  // differ from it, so only a claim is state.
  type Correlation = {
    runId: int,
    attemptId: int,
  }

  // Running, SafelySuspended, and Terminal are executor reports and carry the
  // correlation the executor supplied. The first two phases are Dalph's own.
  // Their identity is known and already journalled — Dalph planned the attempt
  // and recorded responsibility for it — but no executor has claimed one yet,
  // and a claim is the only thing that can disagree.
  type Status =
    | ResponsibilityNotBegun
    | ResponsibilityBegan
    | Running(Correlation)
    | SuspensionRequested(Correlation)
    | SafelySuspended(Correlation)
    | Terminal(Correlation)

  type State = {
    status: Status,
    positionHeld: bool,
    consecutiveRunningReports: int,
  }

  pure val RUN_ID = 158
  pure val ATTEMPT_ID = 1
  pure val CONTINUATION_LIMIT = 3

  // A correlation an executor report may carry that is not this planned
  // attempt: another run, or an earlier attempt for the same task. Dalph
  // accepts a report only for the exact planned attempt, so these identities
  // are offered to every report action and never accepted.
  pure val OTHER_RUN_ID = 159
  pure val OTHER_ATTEMPT_ID = 2

  pure def isPlannedAttempt(claimed: Correlation): bool =
    claimed.runId == RUN_ID and claimed.attemptId == ATTEMPT_ID

  // The correlations an executor report may carry. Each report action draws
  // from this set itself, so the branching applies only where a report is
  // actually enabled.
  pure val REPORTED_CORRELATIONS: Set[Correlation] = Set(
    { runId: RUN_ID, attemptId: ATTEMPT_ID },
    { runId: OTHER_RUN_ID, attemptId: ATTEMPT_ID },
    { runId: RUN_ID, attemptId: OTHER_ATTEMPT_ID },
  )

  pure def acceptsExecutorStart(status: Status): bool = match status {
    | ResponsibilityBegan => true
    | Running(_) => true
    | SafelySuspended(_) => true
    | _ => false
  }

  pure def acceptsTerminal(status: Status): bool = match status {
    | ResponsibilityNotBegun => false
    | Terminal(_) => false
    | _ => true
  }

  pure def awaitsSuspensionResult(status: Status): bool = match status {
    | SuspensionRequested(_) => true
    | _ => false
  }

  var state: State

  // Stated independently of `isPlannedAttempt`, which the report actions guard
  // with. Sharing that definition would move the guard and the requirement
  // together, and a weakened guard would stop being detectable.
  //
  // The pre-report phases answer true because Dalph's own identity is the
  // constant here, and comparing a constant to itself measures nothing.
  //
  // TODO: this compares a claim against a constant, where production compares
  // it against the responsibility Dalph journalled — `validateExecutorEvent`
  // in packages/orchestrator/src/coordination/reconstruction/history.ts looks
  // the responsibility up by the claimed AttemptId and rejects the report
  // unless its RunId equals that responsibility's planned attempt. Absolute and
  // relative agree only because one attempt is modelled.
  //
  // Crash/recovery closes this: add the intended correlation to State, written
  // by `beginResponsibility` drawing from a set that may hold a wrong identity,
  // and restate this invariant as claimed == intended. That is what makes a
  // recovery minting a fresh attempt id detectable, which is reachable in
  // production because the attempt ordinal is an in-process Ref that restarts
  // at zero — `deterministicPlannedTaskAttemptLayer` in
  // packages/orchestrator/src/workflow/protocols/task-attempt-planning/plan.ts
  // — while RunId is allocated fresh from a UUIDv7.
  val everyReportCarriesPlannedAttempt: bool = match state.status {
    | ResponsibilityNotBegun => true
    | ResponsibilityBegan => true
    | Running(claimed) => claimed.runId == RUN_ID and claimed.attemptId == ATTEMPT_ID
    | SuspensionRequested(claimed) => claimed.runId == RUN_ID and claimed.attemptId == ATTEMPT_ID
    | SafelySuspended(claimed) => claimed.runId == RUN_ID and claimed.attemptId == ATTEMPT_ID
    | Terminal(claimed) => claimed.runId == RUN_ID and claimed.attemptId == ATTEMPT_ID
  }

  // Dalph owes the attempt a task-work position from taking responsibility
  // until a suspension result settles it.
  val positionHeldUntilSuspensionResult: bool =
    state.positionHeld
      == match state.status {
        | ResponsibilityBegan => true
        | Running(_) => true
        | SuspensionRequested(_) => true
        | _ => false
      }

  val safeSuspensionReleasesPosition: bool = match state.status {
    | SafelySuspended(_) => not(state.positionHeld)
    | _ => true
  }

  val terminalReleasesPosition: bool = match state.status {
    | Terminal(_) => not(state.positionHeld)
    | _ => true
  }

  val suspensionRequestRetainsPosition: bool = match state.status {
    | SuspensionRequested(_) => state.positionHeld
    | _ => true
  }

  // Restated independently of the start action's guard so mutation can detect
  // either a missing increment or an incorrectly weakened limit.
  val continuationCountBounded: bool =
    state.consecutiveRunningReports >= 0 and state.consecutiveRunningReports <= 3

  val responsibilityBeganReached: bool = match state.status {
    | ResponsibilityBegan => true
    | _ => false
  }

  val runningReached: bool = match state.status {
    | Running(_) => true
    | _ => false
  }

  val suspensionRequestedReached: bool = match state.status {
    | SuspensionRequested(_) => true
    | _ => false
  }

  val safelySuspendedReached: bool = match state.status {
    | SafelySuspended(_) => true
    | _ => false
  }

  val terminalReached: bool = match state.status {
    | Terminal(_) => true
    | _ => false
  }

  val continuationLimitReached: bool = state.consecutiveRunningReports == CONTINUATION_LIMIT

  pure def suspensionRequested(status: Status): bool = match status {
    | SuspensionRequested(_) => true
    | _ => false
  }

  /// After Dalph asks the executor to suspend this exact planned attempt, the
  /// task-work position is eventually released. `reportSafelySuspended` needs
  /// only weak fairness: while the request remains pending its exact planned
  /// report is continuously enabled. A terminal report may win first and also
  /// releases the position, which is why the consequent names the owned
  /// resource rather than requiring one particular executor outcome.
  ///
  /// The one-attempt bound is this owning model's accepted boundary: correlation
  /// is checked against one durable planned `(RunId, AttemptId)`, not a claim
  /// about scheduling every task in a Run.
  temporal suspensionRequestEventuallyReleasesPosition =
    reportSafelySuspended.weakFair(Set(state)) implies
      always(suspensionRequested(state.status) implies eventually(not(state.positionHeld)))

  action init: bool = all {
    state' = {
      status: ResponsibilityNotBegun,
      positionHeld: false,
      consecutiveRunningReports: 0,
    }
  }

  action beginResponsibility: bool = all {
    state.status == ResponsibilityNotBegun,
    state' = {
      status: ResponsibilityBegan,
      positionHeld: true,
      consecutiveRunningReports: state.consecutiveRunningReports,
    },
  }

  action startOrContinueRunning: bool = {
    nondet reported = REPORTED_CORRELATIONS.oneOf()
    all {
      acceptsExecutorStart(state.status),
      state.consecutiveRunningReports < CONTINUATION_LIMIT,
      isPlannedAttempt(reported),
      state' = {
        status: Running(reported),
        positionHeld: true,
        consecutiveRunningReports: state.consecutiveRunningReports + 1,
      },
    }
  }

  // Dalph's request, not an executor report, so it carries forward the
  // correlation the executor last claimed rather than minting one. Drawing
  // that claim from the same set the reports draw from, and requiring the
  // current status to equal `Running` of it, keeps the action a flat guard.
  action requestSafeSuspension: bool = {
    nondet claimed = REPORTED_CORRELATIONS.oneOf()
    all {
      state.status == Running(claimed),
      state' = {
        status: SuspensionRequested(claimed),
        positionHeld: true,
        consecutiveRunningReports: state.consecutiveRunningReports,
      },
    }
  }

  action reportSafelySuspended: bool = {
    nondet reported = REPORTED_CORRELATIONS.oneOf()
    all {
      awaitsSuspensionResult(state.status),
      isPlannedAttempt(reported),
      state' = {
        status: SafelySuspended(reported),
        positionHeld: false,
        consecutiveRunningReports: 0,
      },
    }
  }

  action finishTerminal: bool = {
    nondet reported = REPORTED_CORRELATIONS.oneOf()
    all {
      acceptsTerminal(state.status),
      awaitsSuspensionResult(state.status) or state.consecutiveRunningReports < CONTINUATION_LIMIT,
      isPlannedAttempt(reported),
      state' = {
        status: Terminal(reported),
        positionHeld: false,
        consecutiveRunningReports: state.consecutiveRunningReports,
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
