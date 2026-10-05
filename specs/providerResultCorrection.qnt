// #428: one private response cycle. Workflow recovery authorization, Git/evidence
// validation and native stopped-writer proof remain separate composition owners.
// Production conformance and the canonical sampled/exhaustive profile cover this
// private cycle; they do not prove public workflow recovery or native custody.
module providerResultCorrection {
  type Phase = NoRequest | RequestIntended | TurnObserved | ResponseRejected | OperatorRequired
  type State = {
    phase: Phase,
    responses: int,
    calls: List[int],
    now: int,
    intendedAt: int,
    deadline: int,
    active: bool,
    lastCallOrdinal: int,
    lastCallAt: int,
    lastCallDeadline: int,
    recoveryObserved: bool,
    recoveryResponses: int,
    recoveryDeadline: int,
  }
  var state: State

  val responseBudgetBounded = state.responses >= 0 and state.responses <= 3
  val everyProviderCallHasIntent = state.calls.indices().forall(index => state.calls.nth(index) >= 1 and state.calls.nth(index) <= state.responses)
  val eachOwnedRequestCrossesAtMostOnce = state.calls.indices().forall(left =>
    state.calls.indices().forall(right => left == right or state.calls.nth(left) != state.calls.nth(right)))
  val initialResponseHasNoCorrectionDeadline = state.responses != 1 or state.deadline == 0
  val initialIntentReached = state.phase == RequestIntended and state.responses == 1
  val ownedRequestSentReached = state.calls.length() > 0
  val ownedTurnObservedReached = state.phase == TurnObserved
  val rejectedResponseReached = state.phase == ResponseRejected
  // One model tick represents fifteen seconds; the exact thirty-second bound
  // is checked separately at the production schema boundary.
  val correctionDeadlineIsOriginal =
    state.responses <= 1 or state.deadline == state.intendedAt + 2
  val secondResponseReached = state.responses == 2
  val thirdResponseReached = state.responses == 3
  val exhaustedReached = state.phase == OperatorRequired and state.responses == 3
  val noCorrectionCallAfterDeadline =
    state.lastCallOrdinal <= 1 or state.lastCallAt < state.lastCallDeadline
  val correctionTimeAdvancedReached = state.responses > 1 and state.now > state.intendedAt
  val expiredCorrectionReached =
    state.phase == OperatorRequired and state.responses > 1 and state.now >= state.deadline
  val recoveryPreservesOriginalBudget = not(state.recoveryObserved) or
    (state.responses == state.recoveryResponses and state.deadline == state.recoveryDeadline)
  val crashReached = not(state.active)
  val recoveredBeforeCallReached = state.recoveryObserved and state.phase == RequestIntended
    and not(state.calls.indices().exists(index => state.calls.nth(index) == state.responses))
  val recoveredAfterCallReached = state.recoveryObserved and state.phase == TurnObserved

  action init = state' = {
    phase: NoRequest, responses: 0, calls: List(), now: 0,
    intendedAt: 0, deadline: 0, active: true,
    lastCallOrdinal: 0, lastCallAt: 0, lastCallDeadline: 0,
    recoveryObserved: false, recoveryResponses: 0, recoveryDeadline: 0,
  }

  action recordInitialIntent = all {
    state.active,
    state.phase == NoRequest,
    state' = { ...state, recoveryObserved: false, phase: RequestIntended, responses: 1, intendedAt: state.now },
  }

  // calls is execution-substrate truth, not a persisted workflow counter.
  action sendOwnedRequest = all {
    state.active,
    state.phase == RequestIntended,
    not(state.calls.indices().exists(index => state.calls.nth(index) == state.responses)),
    state.responses == 1 or state.now < state.deadline,
    state' = {
      ...state, recoveryObserved: false, calls: state.calls.append(state.responses),
      lastCallOrdinal: state.responses, lastCallAt: state.now, lastCallDeadline: state.deadline,
    },
  }

  action observeOwnedTurn = all {
    state.active,
    state.phase == RequestIntended,
    state.calls.indices().exists(index => state.calls.nth(index) == state.responses),
    state.responses == 1 or state.now < state.deadline,
    state' = { ...state, recoveryObserved: false, phase: TurnObserved },
  }

  action rejectResponse = all {
    state.active,
    state.phase == TurnObserved,
    state.responses == 1 or state.now < state.deadline,
    state' = { ...state, recoveryObserved: false, phase: ResponseRejected },
  }

  action recordCorrectionIntent = all {
    state.active,
    state.phase == ResponseRejected,
    state.responses < 3,
    state' = {
      ...state, recoveryObserved: false, phase: RequestIntended, responses: state.responses + 1,
      intendedAt: state.now, deadline: state.now + 2,
    },
  }

  action returnExhausted = all {
    state.active,
    state.phase == ResponseRejected,
    state.responses == 3,
    state' = { ...state, recoveryObserved: false, phase: OperatorRequired },
  }

  // Initial implementation time is immaterial to this subject: it has no
  // correction deadline. Time progresses only while an additional response is pending.
  action advanceCorrectionTime = all {
    state.responses > 1,
    state.phase == RequestIntended or state.phase == TurnObserved,
    state.now < state.deadline,
    state' = { ...state, recoveryObserved: false, now: state.now + 1 },
  }

  action returnExpired = all {
    state.active,
    state.responses > 1,
    state.phase == RequestIntended or state.phase == TurnObserved,
    state.now >= state.deadline,
    state' = { ...state, recoveryObserved: false, phase: OperatorRequired },
  }

  action crash = all {
    state.active,
    state.phase != NoRequest and state.phase != OperatorRequired,
    state' = { ...state, active: false, recoveryObserved: false },
  }

  action recoverExactOwnedRequest = all {
    not(state.active),
    state' = {
      ...state,
      active: true,
      recoveryObserved: true,
      recoveryResponses: state.responses,
      recoveryDeadline: state.deadline,
      phase: if (state.responses > 1 and state.now >= state.deadline and state.phase != ResponseRejected)
        OperatorRequired
        else if (state.phase == RequestIntended and
          state.calls.indices().exists(index => state.calls.nth(index) == state.responses))
          TurnObserved
        else state.phase,
    },
  }

  action recoverUnresolvedRequest = all {
    not(state.active),
    state' = {
      ...state, phase: OperatorRequired, active: true,
      recoveryObserved: true, recoveryResponses: state.responses, recoveryDeadline: state.deadline,
    },
  }

  // Directed conformance control: spend one tick of a correction, crash,
  // then recover its exact retained deadline before any further provider call.
  action recoveryDeadlineMbtStep = any {
    all { state.phase == NoRequest, recordInitialIntent },
    all { state.responses == 1 and state.phase == RequestIntended and state.calls.length() == 0, sendOwnedRequest },
    all { state.responses == 1 and state.phase == RequestIntended and state.calls.length() > 0, observeOwnedTurn },
    all { state.responses == 1 and state.phase == TurnObserved, rejectResponse },
    all { state.phase == ResponseRejected, recordCorrectionIntent },
    all { state.responses == 2 and state.now == state.intendedAt, advanceCorrectionTime },
    all { state.responses == 2 and state.now > state.intendedAt and state.active and not(state.recoveryObserved), crash },
    all { not(state.active), recoverExactOwnedRequest },
    all { state.active and state.recoveryObserved, advanceCorrectionTime },
  }

  action step = any {
    recordInitialIntent, sendOwnedRequest, observeOwnedTurn, rejectResponse,
    recordCorrectionIntent, returnExhausted, advanceCorrectionTime, returnExpired,
    crash, recoverExactOwnedRequest, recoverUnresolvedRequest,
  }
}
