// #428 S4-S7: admission and exact redelivery of an explicit recovery direction.
// One Run owner serializes accepted journal facts. Native custody, fresh Git /
// tracker reads, cycle permission and provider effects are separate owners.
// OwnerPlan represents the whole immutable plan tuple, not just attemptId.
// Two nonces and two report ordinals retain identity reuse, competing requests,
// stale selections and fresh later selections in a finite graph.
module resultRecoveryDirection {
  type Plan = OwnerPlan | ForeignPlan
  type Direction = ContinueRetained | RestartFresh
  type ReportKind = NoReport | Rejected | HistoricalFailed | KnownFailed | Accepted | Completed
  type SubjectKind = RejectionSubject | HistoricalFailureSubject
  type Request = {
    nonce: int,
    plan: Plan,
    sameRun: bool,
    direction: Direction,
    subject: SubjectKind,
    ordinal: int,
  }
  type Outcome = NoOutcome | Recorded | ExactRedelivery | IdentityContradiction | Unavailable | Authorized
  type State = {
    report: ReportKind,
    ordinal: int,
    stopped: bool,
    integrated: bool,
    replaced: bool,
    directions: Set[Request],
    lastRequest: Request,
    outcome: Outcome,
    active: bool,
    applications: int,
    terminalSeal: ReportKind,
    executorCalls: int,
    permissionCount: int,
  }
  var state: State

  pure def request(nonce: int, direction: Direction, ordinal: int, subject: SubjectKind): Request = {
    nonce: nonce, plan: OwnerPlan, sameRun: true,
    direction: direction, subject: subject, ordinal: ordinal,
  }
  pure def terminal(kind: ReportKind): bool = Set(HistoricalFailed, KnownFailed, Accepted, Completed).contains(kind)
  pure def sameIdentity(left: Request, right: Request): bool = left.nonce == right.nonce and left.sameRun == right.sameRun
  pure def currentSelection(s: State, selected: Request): bool = and {
    selected.plan == OwnerPlan,
    selected.sameRun,
    selected.ordinal == s.ordinal,
    not(s.integrated),
    not(s.replaced),
    if (selected.subject == RejectionSubject)
      s.report == Rejected and s.stopped
    else s.report == HistoricalFailed and selected.direction == RestartFresh,
  }
  pure def admission(s: State, selected: Request): Outcome = {
    val existing = s.directions.filter(prior => sameIdentity(prior, selected))
    if (not(selected.sameRun) or (selected.subject == HistoricalFailureSubject and selected.direction != RestartFresh)) Unavailable
    else if (existing.size() > 0)
      if (existing.contains(selected)) ExactRedelivery else IdentityContradiction
    else if (currentSelection(s, selected)
      and not(s.directions.exists(prior => prior.ordinal == selected.ordinal))) Recorded
    else Unavailable
  }
  pure def appliedState(s: State, selected: Request): State = {
    val result = admission(s, selected)
    {
      ...s, lastRequest: selected, outcome: result,
      directions: if (result == Recorded) s.directions.union(Set(selected)) else s.directions,
      applications: s.applications + (if (result == Recorded) 1 else 0),
    }
  }
  pure def observedState(s: State, kind: ReportKind, ordinal: int, stopped: bool): State = {
    ...s, report: kind, ordinal: ordinal, stopped: kind == Rejected and stopped, outcome: NoOutcome,
    terminalSeal: if (terminal(kind)) kind else s.terminalSeal,
  }

  val directionIdentityIsExact = state.directions.forall(left =>
    state.directions.forall(right => not(sameIdentity(left, right)) or left == right))
  val firstDirectionWinsSelectedReport = state.directions.forall(left =>
    state.directions.forall(right => left.ordinal != right.ordinal or left == right))
  val eachRecordedDirectionAppliedOnce = state.applications == state.directions.size()
  val historicalFailureIsRestartOnly = state.directions.forall(selected =>
    selected.subject != HistoricalFailureSubject or selected.direction == RestartFresh)
  val acceptedTerminalSealIsAbsorbing = state.terminalSeal == NoReport or state.report == state.terminalSeal
  val staleDirectionCannotAuthorize = state.outcome != Authorized or and {
    state.directions.contains(state.lastRequest), currentSelection(state, state.lastRequest),
  }
  val admissionClaimsNoExecution = state.executorCalls == 0 and state.permissionCount == 0
  val typeOk = state.ordinal >= 0 and state.ordinal <= 2 and state.directions.size() <= 2

  val rejectionObservedReached = state.report == Rejected
  val historicalFailureObservedReached = state.report == HistoricalFailed
  val knownFailureObservedReached = state.report == KnownFailed
  val continueRecordedReached = state.outcome == Recorded and state.lastRequest.direction == ContinueRetained
  val restartRecordedReached = state.outcome == Recorded and state.lastRequest.direction == RestartFresh
  val exactRedeliveryReached = state.outcome == ExactRedelivery
  val conflictingReuseReached = state.outcome == IdentityContradiction
  val unavailableSelectionReached = state.outcome == Unavailable
  val currentDirectionAuthorizedReached = state.outcome == Authorized
  val lateTerminalReached = state.ordinal == 2 and terminal(state.report)
  val freshLaterDirectionReached = state.directions.exists(selected => selected.ordinal == 2)
  val integrationCutoffReached = state.integrated
  val replacementCutoffReached = state.replaced
  val crashReached = not(state.active)
  val recoveredReached = state.active and state.outcome == NoOutcome and state.directions.size() > 0

  action init = all {
    state' = {
      report: NoReport, ordinal: 0, stopped: false, integrated: false, replaced: false,
      directions: Set(), lastRequest: request(1, ContinueRetained, 1, RejectionSubject),
      outcome: NoOutcome, active: true, applications: 0, terminalSeal: NoReport,
      executorCalls: 0, permissionCount: 0,
    },
  }
  action observeInitial(kind: ReportKind, stopped: bool): bool = all {
    state.active, state.report == NoReport, kind != NoReport,
    state' = observedState(state, kind, 1, stopped),
  }
  action observeLater(kind: ReportKind, stopped: bool): bool = all {
    state.active, state.report == Rejected, state.ordinal == 1,
    Set(Rejected, KnownFailed, Accepted, Completed).contains(kind),
    // A later rejection is an externally admitted fresh cycle, not spontaneous
    // reuse of invalid predecessor bytes. This model does not grant that cycle.
    kind != Rejected or state.directions.exists(selected => selected.direction == ContinueRetained),
    state' = observedState(state, kind, 2, stopped),
  }
  action apply(selected: Request): bool = all {
    state.active, state.report != NoReport,
    state' = appliedState(state, selected),
  }
  action recheck(selected: Request): bool = all {
    state.active, state.directions.contains(selected),
    state' = {
      ...state, lastRequest: selected,
      outcome: if (currentSelection(state, selected)) Authorized else Unavailable,
    },
  }
  action beginIntegration = all {
    state.active, not(state.integrated), state.report == Accepted,
    state' = { ...state, integrated: true, outcome: NoOutcome },
  }
  action replaceAttempt = all {
    state.active, not(state.replaced), state.outcome == Authorized, state.lastRequest.direction == RestartFresh,
    state' = { ...state, replaced: true, outcome: NoOutcome },
  }
  action crash = all {
    state.active,
    state' = { ...state, active: false, outcome: NoOutcome },
  }
  action recover = all {
    not(state.active),
    state' = { ...state, active: true, outcome: NoOutcome },
  }
  action step = {
    nondet kind = Set(Rejected, HistoricalFailed, KnownFailed, Accepted, Completed).oneOf()
    nondet stopped = Set(false, true).oneOf()
    nondet nonce = Set(1, 2).oneOf()
    nondet direction = Set(ContinueRetained, RestartFresh).oneOf()
    nondet ordinal = Set(1, 2).oneOf()
    nondet subject = Set(RejectionSubject, HistoricalFailureSubject).oneOf()
    nondet plan = Set(OwnerPlan, ForeignPlan).oneOf()
    nondet sameRun = Set(false, true).oneOf()
    nondet selected = Set(
      { ...request(nonce, direction, ordinal, subject), plan: plan, sameRun: sameRun },
      request(nonce, direction, state.ordinal,
        if (state.report == HistoricalFailed) HistoricalFailureSubject else RejectionSubject)
    ).oneOf()
    nondet retained = state.directions.union(Set(selected)).oneOf()
    any {
      observeInitial(kind, stopped), observeLater(kind, stopped), apply(selected), recheck(retained),
      beginIntegration, replaceAttempt, crash, recover,
    }
  }

  // Directed production negative control: the receipt remains durable, but
  // the newer accepted terminal report must reject later authorization.
  action staleDirectionMbtStep = {
    nondet kind = Set(Rejected, Accepted).oneOf()
    nondet stopped = Set(true).oneOf()
    nondet selected = Set(request(1, RestartFresh, 1, RejectionSubject)).oneOf()
    nondet retained = Set(selected).oneOf()
    any {
    all { state.report == NoReport, kind == Rejected, observeInitial(kind, stopped) },
    all { state.report == Rejected, state.directions.size() == 0,
      apply(selected) },
    all { state.report == Rejected, state.directions.size() == 1, kind == Accepted, observeLater(kind, stopped) },
    all { state.report == Accepted, recheck(retained) },
    }
  }

}
