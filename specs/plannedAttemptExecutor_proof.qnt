// Focused finite proof projections for named autonomous executor obligations.
module plannedAttemptExecutorEvidenceProof {
  type Stage = ResponsibilityHeld | BeginIntent | BeginCalled | BeginResponseObserved | Executing | SuspendIntent | SuspendCalled | SuspendResponseObserved | Safe | ResumeIntent | ResumeCalled | ResumeResponseObserved | Terminal
  type Report = ExecutingReport | SafeReport | TerminalReport
  type Event = Initialized | BeginIntentRecorded | BeginBoundaryCalled | CommandResponseRecorded | DistinctReportAccepted | PassiveExecutingObserved | PassiveTerminalObserved | SuspendIntentRecorded | SuspendBoundaryCalled | ResumeIntentRecorded | ResumeBoundaryCalled
  type State = {
    stage: Stage,
    pendingReport: Report,
    intentCount: int,
    callCount: int,
    responseCount: int,
    settlementCount: int,
    acceptedReportOrdinal: int,
    acceptedReportOrdinalBeforePassiveRead: int,
    observationCount: int,
    durableObservationCount: int,
    durableObservationCountBeforePassiveRead: int,
    proposalIdentityCount: int,
    proposalIdentityCountBeforePassiveRead: int,
    intentCountBeforePassiveRead: int,
    callCountBeforePassiveRead: int,
    beginCount: int,
    firstAcceptedReportWasExecuting: bool,
    suspendCount: int,
    resumeCountSinceSafe: int,
    positionHeld: bool,
    lastEvent: Event,
  }
  var state: State

  val everyCallHasDurableIntent = state.callCount <= state.intentCount
  val beginOccursOnce = state.beginCount <= 1
  val firstAcceptedReportIsExecuting = state.acceptedReportOrdinal == 0 or state.firstAcceptedReportWasExecuting
  val acceptedSafeReportAuthorizesAtMostOneResume = state.resumeCountSinceSafe <= 1
  val commandResponsesAndAcceptedReportsStayDistinct = state.acceptedReportOrdinal <= state.responseCount + state.observationCount
  val unchangedExecutingObservationsKeepOrdinal = state.lastEvent != PassiveExecutingObserved or state.acceptedReportOrdinal == state.acceptedReportOrdinalBeforePassiveRead
  val unchangedExecutingObservationsAreProcessLocal = state.lastEvent != PassiveExecutingObserved or and {
    state.durableObservationCount == state.durableObservationCountBeforePassiveRead,
    state.proposalIdentityCount == state.proposalIdentityCountBeforePassiveRead,
    state.intentCount == state.intentCountBeforePassiveRead,
    state.callCount == state.callCountBeforePassiveRead,
  }
  val passiveObservationsDoNotCallExecutor = state.lastEvent != PassiveExecutingObserved or and {
    state.intentCount == state.intentCountBeforePassiveRead,
    state.callCount == state.callCountBeforePassiveRead,
  }
  val safeAndTerminalReleasePosition = (state.stage != Safe and state.stage != Terminal) or not(state.positionHeld)
  val evidenceProofTypeOk = and {
    state.intentCount >= 0, state.callCount >= 0, state.responseCount >= 0,
    state.settlementCount >= 0, state.acceptedReportOrdinal >= 0,
    state.observationCount >= 0, state.observationCount <= 5,
    state.suspendCount >= 0, state.suspendCount <= 1,
    state.resumeCountSinceSafe >= 0, state.resumeCountSinceSafe <= 1,
    state.durableObservationCount >= 0, state.proposalIdentityCount >= 0,
  }

  val beginIntentReached = state.lastEvent == BeginIntentRecorded
  val beginCalledReached = state.lastEvent == BeginBoundaryCalled
  val commandResponseReached = state.lastEvent == CommandResponseRecorded
  val executingAcceptedReached = state.stage == Executing and state.acceptedReportOrdinal == 1
  val fourthUnchangedObservationReached = state.stage == Executing and state.observationCount == 4
  val terminalObservationReached = state.lastEvent == PassiveTerminalObserved
  val safeReached = state.stage == Safe
  val resumeIntentReached = state.lastEvent == ResumeIntentRecorded
  val resumeCalledReached = state.lastEvent == ResumeBoundaryCalled

  action init: bool = all {
    state' = { stage: ResponsibilityHeld, pendingReport: ExecutingReport, intentCount: 0, callCount: 0, responseCount: 0, settlementCount: 0, acceptedReportOrdinal: 0, acceptedReportOrdinalBeforePassiveRead: 0, observationCount: 0, durableObservationCount: 0, durableObservationCountBeforePassiveRead: 0, proposalIdentityCount: 0, proposalIdentityCountBeforePassiveRead: 0, intentCountBeforePassiveRead: 0, callCountBeforePassiveRead: 0, beginCount: 0, firstAcceptedReportWasExecuting: false, suspendCount: 0, resumeCountSinceSafe: 0, positionHeld: true, lastEvent: Initialized }
  }
  action recordBeginIntent: bool = all { state.stage == ResponsibilityHeld, state' = { ...state, stage: BeginIntent, intentCount: 1, beginCount: 1, lastEvent: BeginIntentRecorded } }
  action callBegin: bool = all { state.stage == BeginIntent, state' = { ...state, stage: BeginCalled, callCount: 1, lastEvent: BeginBoundaryCalled } }
  action observeBeginResponse(report: Report): bool = all { state.stage == BeginCalled, state' = { ...state, stage: BeginResponseObserved, pendingReport: report, responseCount: state.responseCount + 1, lastEvent: CommandResponseRecorded } }
  action settleBeginResponse: bool = all {
    state.stage == BeginResponseObserved,
    state.pendingReport == ExecutingReport,
    state' = { ...state, stage: Executing, settlementCount: 1, acceptedReportOrdinal: 1, firstAcceptedReportWasExecuting: true, proposalIdentityCount: 1, positionHeld: true, lastEvent: DistinctReportAccepted },
  }
  action observeUnchangedExecuting: bool = all { state.stage == Executing, state.observationCount < 4, state' = { ...state, observationCount: state.observationCount + 1, acceptedReportOrdinalBeforePassiveRead: state.acceptedReportOrdinal, durableObservationCountBeforePassiveRead: state.durableObservationCount, proposalIdentityCountBeforePassiveRead: state.proposalIdentityCount, intentCountBeforePassiveRead: state.intentCount, callCountBeforePassiveRead: state.callCount, lastEvent: PassiveExecutingObserved } }
  action observeTerminal: bool = all { state.stage == Executing, state' = { ...state, stage: Terminal, observationCount: state.observationCount + 1, durableObservationCount: state.durableObservationCount + 1, acceptedReportOrdinal: state.acceptedReportOrdinal + 1, positionHeld: false, lastEvent: PassiveTerminalObserved } }
  action recordSuspendIntent: bool = all { state.stage == Executing, state.suspendCount == 0, state' = { ...state, stage: SuspendIntent, intentCount: state.intentCount + 1, suspendCount: state.suspendCount + 1, lastEvent: SuspendIntentRecorded } }
  action callSuspend: bool = all { state.stage == SuspendIntent, state' = { ...state, stage: SuspendCalled, callCount: state.callCount + 1, lastEvent: SuspendBoundaryCalled } }
  action observeSuspendResponse(report: Report): bool = all { state.stage == SuspendCalled, state' = { ...state, stage: SuspendResponseObserved, pendingReport: report, responseCount: state.responseCount + 1, lastEvent: CommandResponseRecorded } }
  action settleSuspendResponse: bool = all {
    state.stage == SuspendResponseObserved,
    state' = if (state.pendingReport == SafeReport)
      { ...state, stage: Safe, settlementCount: state.settlementCount + 1, acceptedReportOrdinal: state.acceptedReportOrdinal + 1, resumeCountSinceSafe: 0, positionHeld: false, lastEvent: DistinctReportAccepted }
    else if (state.pendingReport == TerminalReport)
      { ...state, stage: Terminal, settlementCount: state.settlementCount + 1, acceptedReportOrdinal: state.acceptedReportOrdinal + 1, positionHeld: false, lastEvent: DistinctReportAccepted }
    else
      { ...state, stage: Executing, settlementCount: state.settlementCount + 1, acceptedReportOrdinal: 1, positionHeld: true, lastEvent: CommandResponseRecorded },
  }
  action recordResumeIntent: bool = all { state.stage == Safe, state.resumeCountSinceSafe == 0, state' = { ...state, stage: ResumeIntent, intentCount: state.intentCount + 1, resumeCountSinceSafe: state.resumeCountSinceSafe + 1, positionHeld: true, lastEvent: ResumeIntentRecorded } }
  action callResume: bool = all { state.stage == ResumeIntent, state' = { ...state, stage: ResumeCalled, callCount: state.callCount + 1, lastEvent: ResumeBoundaryCalled } }
  action observeResumeResponse(report: Report): bool = all { state.stage == ResumeCalled, state' = { ...state, stage: ResumeResponseObserved, pendingReport: report, responseCount: state.responseCount + 1, lastEvent: CommandResponseRecorded } }
  action settleResumeResponse: bool = all {
    state.stage == ResumeResponseObserved,
    state' = if (state.pendingReport == SafeReport)
      { ...state, stage: Safe, settlementCount: state.settlementCount + 1, positionHeld: false, lastEvent: CommandResponseRecorded }
    else if (state.pendingReport == TerminalReport)
      { ...state, stage: Terminal, settlementCount: state.settlementCount + 1, acceptedReportOrdinal: state.acceptedReportOrdinal + 1, positionHeld: false, lastEvent: DistinctReportAccepted }
    else
      { ...state, stage: Executing, settlementCount: state.settlementCount + 1, acceptedReportOrdinal: state.acceptedReportOrdinal + 1, proposalIdentityCount: state.proposalIdentityCount + 1, positionHeld: true, lastEvent: DistinctReportAccepted },
  }
  action step: bool = {
    nondet report = Set(ExecutingReport, SafeReport, TerminalReport).oneOf()
    any { recordBeginIntent, callBegin, observeBeginResponse(report), settleBeginResponse, observeUnchangedExecuting, observeTerminal, recordSuspendIntent, callSuspend, observeSuspendResponse(report), settleSuspendResponse, recordResumeIntent, callResume, observeResumeResponse(report), settleResumeResponse }
  }
}

module plannedAttemptExecutorSuspendBoundProof {
  type Stage = Executing | IntentRecorded | Called | ResponseObserved | ResponseLost | ProjectionObserved | Safe | Terminal | ReadOnlyRecovery
  type Report = ExecutingReport | SafeReport | TerminalReport
  type Event = Initialized | SuspendIntentRecorded | SuspendCalled | SuspendResponseObserved | SuspendResponseLost | SuspendProjectionObserved | SuspendSettled | SuspendProjectionSettled | ReadOnlyRecoveryActivated | PassiveSafeObserved
  type State = { stage: Stage, pendingReport: Report, intentCount: int, callCount: int, settlementCount: int, lostResponseCount: int, projectionSettlementCount: int, positionHeld: bool, lastEvent: Event }
  var state: State
  pure val SUSPEND_LIMIT = 3

  val everySuspendCallHasItsIntent = state.callCount <= state.intentCount
  val suspendLimitBlocksFourthCommand = state.intentCount <= SUSPEND_LIMIT
  val lostSuspendResponseConsumesCommandBudget = state.lostResponseCount <= state.intentCount
  val lostSuspendRequiresReconciliationBeforeRetry = state.lostResponseCount <= state.projectionSettlementCount or state.stage == ResponseLost or state.stage == ProjectionObserved
  val postLimitRecoveryIsReadOnly = state.stage != ReadOnlyRecovery or state.callCount == SUSPEND_LIMIT
  val positionReleasesOnlyForSafeOrTerminalEvidence = (state.stage != Safe and state.stage != Terminal) or not(state.positionHeld)
  val suspendProofTypeOk = and { state.intentCount >= 0, state.intentCount <= SUSPEND_LIMIT, state.callCount >= 0, state.settlementCount >= 0, state.lostResponseCount >= 0, state.projectionSettlementCount >= 0, state.projectionSettlementCount <= state.lostResponseCount }
  val firstSuspendIntentReached = state.lastEvent == SuspendIntentRecorded and state.intentCount == 1
  val thirdSuspendIntentReached = state.lastEvent == SuspendIntentRecorded and state.intentCount == SUSPEND_LIMIT
  val suspendCalledReached = state.lastEvent == SuspendCalled
  val suspendResponseLostReached = state.lastEvent == SuspendResponseLost
  val directSuspendSettledReached = state.lastEvent == SuspendSettled
  val projectedSuspendSettledReached = state.lastEvent == SuspendProjectionSettled
  val thirdSuspendSettledReached = state.settlementCount == SUSPEND_LIMIT
  val safeSuspendReached = state.stage == Safe
  val terminalSuspendReached = state.stage == Terminal
  val readOnlyRecoveryReached = state.lastEvent == ReadOnlyRecoveryActivated
  val readOnlySafeReached = state.lastEvent == PassiveSafeObserved

  action init: bool = all { state' = { stage: Executing, pendingReport: ExecutingReport, intentCount: 0, callCount: 0, settlementCount: 0, lostResponseCount: 0, projectionSettlementCount: 0, positionHeld: true, lastEvent: Initialized } }
  action recordSuspendIntent: bool = all { state.stage == Executing, state.intentCount < SUSPEND_LIMIT, state' = { ...state, stage: IntentRecorded, intentCount: state.intentCount + 1, lastEvent: SuspendIntentRecorded } }
  action callSuspend: bool = all { state.stage == IntentRecorded, state' = { ...state, stage: Called, callCount: state.callCount + 1, lastEvent: SuspendCalled } }
  action observeResponse(report: Report): bool = all { state.stage == Called, state' = { ...state, stage: ResponseObserved, pendingReport: report, lastEvent: SuspendResponseObserved } }
  action loseResponse: bool = all { state.stage == Called, state' = { ...state, stage: ResponseLost, lostResponseCount: state.lostResponseCount + 1, lastEvent: SuspendResponseLost } }
  action observeProjection(report: Report): bool = all { state.stage == ResponseLost, state' = { ...state, stage: ProjectionObserved, pendingReport: report, lastEvent: SuspendProjectionObserved } }
  action settleResponse: bool = all {
    state.stage == ResponseObserved,
    state' = if (state.pendingReport == SafeReport)
      { ...state, stage: Safe, settlementCount: state.settlementCount + 1, positionHeld: false, lastEvent: SuspendSettled }
    else if (state.pendingReport == TerminalReport)
      { ...state, stage: Terminal, settlementCount: state.settlementCount + 1, positionHeld: false, lastEvent: SuspendSettled }
    else
      { ...state, stage: Executing, settlementCount: state.settlementCount + 1, positionHeld: true, lastEvent: SuspendSettled },
  }
  action settleProjection: bool = all {
    state.stage == ProjectionObserved,
    state' = if (state.pendingReport == SafeReport)
      { ...state, stage: Safe, settlementCount: state.settlementCount + 1, projectionSettlementCount: state.projectionSettlementCount + 1, positionHeld: false, lastEvent: SuspendProjectionSettled }
    else if (state.pendingReport == TerminalReport)
      { ...state, stage: Terminal, settlementCount: state.settlementCount + 1, projectionSettlementCount: state.projectionSettlementCount + 1, positionHeld: false, lastEvent: SuspendProjectionSettled }
    else
      { ...state, stage: Executing, settlementCount: state.settlementCount + 1, projectionSettlementCount: state.projectionSettlementCount + 1, positionHeld: true, lastEvent: SuspendProjectionSettled },
  }
  action activateReadOnlyRecovery: bool = all { state.stage == Executing, state.intentCount == SUSPEND_LIMIT, state' = { ...state, stage: ReadOnlyRecovery, lastEvent: ReadOnlyRecoveryActivated } }
  action observePassiveSafe: bool = all { state.stage == ReadOnlyRecovery, state' = { ...state, stage: Safe, positionHeld: false, lastEvent: PassiveSafeObserved } }
  action step: bool = {
    nondet report = Set(ExecutingReport, SafeReport, TerminalReport).oneOf()
    any { recordSuspendIntent, callSuspend, observeResponse(report), loseResponse, observeProjection(report), settleResponse, settleProjection, activateReadOnlyRecovery, observePassiveSafe }
  }
}
