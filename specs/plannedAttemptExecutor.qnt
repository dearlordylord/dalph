// Durable autonomous planned-attempt executor protocol. Begin and Resume are
// mutation commands; Observe is an unbounded passive read. An exact boundary
// response settles its command, while only a distinct accepted lifecycle
// report advances reportOrdinal or changes capacity ownership.
module plannedAttemptExecutor {
  // Every effectful executor boundary value belongs to one exact planned
  // attempt. A command ordinal identifies the durable intent within that
  // attempt; observations deliberately carry correlation but no command
  // ordinal because they are passive state reads.
  type Correlation = { runId: int, attemptId: int }
  type ExecutorReport = ExecutorWorkExecuting | ExecutorWorkSafelySuspended | ExecutorWorkTerminal
  type WorkStatus = ResponsibilityNotBegun | ResponsibilityBegan | StatusExecuting | StatusSafelySuspended | StatusTerminal
  type CommandKind = BeginCommand | ResumeCommand | SuspendCommand
  type ExecutorCommand = { correlation: Correlation, commandOrdinal: int, kind: CommandKind }
  type CommandState = NoCommand | CommandIntended(ExecutorCommand) | CommandCalled(ExecutorCommand)
  type CommandProjectionOutcome = CommandProjectionExactExecuting | CommandProjectionExactSafelySuspended | CommandProjectionExactTerminal | CommandProjectionNoCurrentReport | CommandProjectionTemporarilyUnavailable | CommandProjectionUnreadable | CommandProjectionContradiction
  type ExecutorStateObservation = ExecutorStateExecuting | ExecutorStateSafelySuspended | ExecutorStateTerminal | ExecutorStateNoCurrentReport | ExecutorStateTemporarilyUnavailable | ExecutorStateUnreadable | ExecutorStateContradiction
  type BoundaryCommandEvidence = { correlation: Correlation, commandOrdinal: int, report: ExecutorReport }
  type CommandProjectionRecord = { correlation: Correlation, commandOrdinal: int, outcome: CommandProjectionOutcome }
  type StateProjection = { correlation: Correlation, observation: ExecutorStateObservation }
  type Evidence = NoEvidence | BoundaryCommandResponse(BoundaryCommandEvidence) | CommandProjectionEvidence(CommandProjectionRecord) | FreshStateProjection(StateProjection)
  type ActionTag = InitializedAction | ResponsibilityBeganAction | BeginIntentRecordedAction | ResumeIntentRecordedAction | SuspendIntentRecordedAction | BeginCalledAction | ResumeCalledAction | SuspendCalledAction | ResponseReceivedAction | ResponseLostAction | CommandProjectedAction | FreshStateProjectedAction | UnchangedExactReportObservedAction | ResponseSettledAction | ProjectionSettledAction | FreshStateAcceptedAction | RecoveryActivatedAction
  type State = {
    status: WorkStatus,
    commandState: CommandState,
    evidence: Evidence,
    positionHeld: bool,
    positionHeldBeforeEvidence: bool,
    nextCommandOrdinal: int,
    beginIntentsSinceSafeSuspension: int,
    resumeIntentsSinceSafeSuspension: int,
    suspendIntentsSinceExecuting: int,
    suspendIntentsSinceExecutingBeforeEvidence: int,
    suspendCommandIntentCount: int,
    lostSuspendResponseCount: int,
    lostSuspendProjectionSettlementCount: int,
    commandIntentCount: int,
    commandCallCount: int,
    commandSettlementCount: int,
    commandResponseEvidenceCount: int,
    commandResponseSettlementCount: int,
    reconciliationProjectionsThisActivation: int,
    recoveryCount: int,
    responseAmbiguous: bool,
    acceptedReportOrdinal: int,
    acceptedReportOrdinalBeforeEvidence: int,
    lastAcceptedReportWasDistinct: bool,
    observationCount: int,
    durableObservationCount: int,
    durableObservationCountBeforePassiveRead: int,
    proposalIdentityCount: int,
    proposalIdentityCountBeforePassiveRead: int,
    commandIntentCountBeforePassiveRead: int,
    commandCallCountBeforePassiveRead: int,
    beginEverIntended: bool,
    terminalReportEverAccepted: bool,
    lastAction: ActionTag,
  }

  pure val SUSPEND_COMMAND_LIMIT = 3
  // Finite-state exploration depth, not a production observation budget.
  pure val RECOVERY_LIMIT = 5
  pure val RUN_ID = 158
  pure val ATTEMPT_ID = 1
  pure val FOREIGN_RUN_ID = 159
  pure val FOREIGN_ATTEMPT_ID = 2
  pure val PLANNED_CORRELATION: Correlation = { runId: RUN_ID, attemptId: ATTEMPT_ID }
  pure val FOREIGN_RUN_CORRELATION: Correlation = { runId: FOREIGN_RUN_ID, attemptId: ATTEMPT_ID }
  pure val FOREIGN_ATTEMPT_CORRELATION: Correlation = { runId: RUN_ID, attemptId: FOREIGN_ATTEMPT_ID }
  pure val EXECUTOR_REPORTS: Set[ExecutorReport] = Set(ExecutorWorkExecuting, ExecutorWorkSafelySuspended, ExecutorWorkTerminal)
  pure val COMMAND_PROJECTIONS: Set[CommandProjectionOutcome] = Set(CommandProjectionExactExecuting, CommandProjectionExactSafelySuspended, CommandProjectionExactTerminal, CommandProjectionNoCurrentReport, CommandProjectionTemporarilyUnavailable, CommandProjectionUnreadable, CommandProjectionContradiction)
  pure val STATE_OBSERVATIONS: Set[ExecutorStateObservation] = Set(ExecutorStateExecuting, ExecutorStateSafelySuspended, ExecutorStateTerminal, ExecutorStateNoCurrentReport, ExecutorStateTemporarilyUnavailable, ExecutorStateUnreadable, ExecutorStateContradiction)

  pure def isNoCommand(commandState: CommandState): bool = match commandState { | NoCommand => true | _ => false }
  pure def isCalled(commandState: CommandState): bool = match commandState { | CommandCalled(_) => true | _ => false }
  pure def correlationIsPlanned(correlation: Correlation): bool = correlation.runId == RUN_ID and correlation.attemptId == ATTEMPT_ID
  pure def plannedCommand(s: State, kind: CommandKind): ExecutorCommand = { correlation: PLANNED_CORRELATION, commandOrdinal: s.nextCommandOrdinal, kind: kind }
  pure def activeCommand(commandState: CommandState): ExecutorCommand = match commandState {
    | CommandIntended(command) => command
    | CommandCalled(command) => command
    | NoCommand => { correlation: PLANNED_CORRELATION, commandOrdinal: 0, kind: BeginCommand }
  }
  pure def reportForProjection(outcome: CommandProjectionOutcome): ExecutorReport = match outcome {
    | CommandProjectionExactExecuting => ExecutorWorkExecuting
    | CommandProjectionExactSafelySuspended => ExecutorWorkSafelySuspended
    | CommandProjectionExactTerminal => ExecutorWorkTerminal
    | _ => ExecutorWorkExecuting
  }
  pure def reportForObservation(observation: ExecutorStateObservation): ExecutorReport = match observation {
    | ExecutorStateExecuting => ExecutorWorkExecuting
    | ExecutorStateSafelySuspended => ExecutorWorkSafelySuspended
    | ExecutorStateTerminal => ExecutorWorkTerminal
    | _ => ExecutorWorkExecuting
  }
  pure def projectionIsExact(outcome: CommandProjectionOutcome): bool = outcome == CommandProjectionExactExecuting or outcome == CommandProjectionExactSafelySuspended or outcome == CommandProjectionExactTerminal
  pure def observationIsExact(observation: ExecutorStateObservation): bool = observation == ExecutorStateExecuting or observation == ExecutorStateSafelySuspended or observation == ExecutorStateTerminal
  pure def statusMatchesReport(status: WorkStatus, report: ExecutorReport): bool = match status {
    | StatusExecuting => report == ExecutorWorkExecuting
    | StatusSafelySuspended => report == ExecutorWorkSafelySuspended
    | StatusTerminal => report == ExecutorWorkTerminal
    | _ => false
  }
  pure def applyDistinctReport(s: State, report: ExecutorReport): State = {
    val reportWasDistinct = not(statusMatchesReport(s.status, report))
    val nextOrdinal = if (reportWasDistinct) s.acceptedReportOrdinal + 1 else s.acceptedReportOrdinal
    match report {
      | ExecutorWorkExecuting => { ...s, status: StatusExecuting, positionHeld: true, acceptedReportOrdinal: nextOrdinal, acceptedReportOrdinalBeforeEvidence: s.acceptedReportOrdinal, lastAcceptedReportWasDistinct: reportWasDistinct, proposalIdentityCount: s.proposalIdentityCount + (if (reportWasDistinct) 1 else 0) }
      | ExecutorWorkSafelySuspended => { ...s, status: StatusSafelySuspended, positionHeld: false, resumeIntentsSinceSafeSuspension: if (reportWasDistinct) 0 else s.resumeIntentsSinceSafeSuspension, suspendIntentsSinceExecuting: 0, acceptedReportOrdinal: nextOrdinal, acceptedReportOrdinalBeforeEvidence: s.acceptedReportOrdinal, lastAcceptedReportWasDistinct: reportWasDistinct }
      | ExecutorWorkTerminal => { ...s, status: StatusTerminal, positionHeld: false, acceptedReportOrdinal: nextOrdinal, acceptedReportOrdinalBeforeEvidence: s.acceptedReportOrdinal, lastAcceptedReportWasDistinct: reportWasDistinct, terminalReportEverAccepted: true }
    }
  }

  pure def canRecordBeginIntent(s: State): bool = and { s.status == ResponsibilityBegan, isNoCommand(s.commandState), s.evidence == NoEvidence, not(s.beginEverIntended) }
  pure def canRecordResumeIntent(s: State): bool = and { s.status == StatusSafelySuspended, isNoCommand(s.commandState), s.evidence == NoEvidence, s.resumeIntentsSinceSafeSuspension == 0 }
  pure def canRecordSuspendIntent(s: State): bool = and { s.status == StatusExecuting, isNoCommand(s.commandState), s.evidence == NoEvidence, s.suspendIntentsSinceExecuting < SUSPEND_COMMAND_LIMIT }
  pure def canRecordFreshStateProjection(s: State, observation: ExecutorStateObservation): bool = and {
    isNoCommand(s.commandState),
    s.evidence == NoEvidence,
    s.status != ResponsibilityNotBegun,
    not(observationIsExact(observation)) or s.status != ResponsibilityBegan,
    s.status != StatusTerminal or not(observationIsExact(observation)) or observation == ExecutorStateTerminal,
    s.status != StatusSafelySuspended or observation != ExecutorStateExecuting,
    s.status != StatusExecuting or observation != ExecutorStateSafelySuspended or s.suspendIntentsSinceExecuting > 0,
  }
  pure def isBoundaryCommandResponse(evidence: Evidence): bool = match evidence { | BoundaryCommandResponse(_) => true | _ => false }
  pure def boundaryResponseReport(evidence: Evidence): ExecutorReport = match evidence { | BoundaryCommandResponse(response) => response.report | _ => ExecutorWorkExecuting }
  pure def commandProjectionOutcome(evidence: Evidence): CommandProjectionOutcome = match evidence { | CommandProjectionEvidence(projection) => projection.outcome | _ => CommandProjectionNoCurrentReport }
  pure def freshObservation(evidence: Evidence): ExecutorStateObservation = match evidence { | FreshStateProjection(projection) => projection.observation | _ => ExecutorStateNoCurrentReport }
  pure def commandEvidenceMatchesActive(s: State): bool = match s.evidence {
    | BoundaryCommandResponse(response) => and {
        isCalled(s.commandState),
        response.commandOrdinal == activeCommand(s.commandState).commandOrdinal,
        response.correlation == activeCommand(s.commandState).correlation,
      }
    | CommandProjectionEvidence(projection) => and {
        isCalled(s.commandState),
        s.responseAmbiguous,
        projection.commandOrdinal == activeCommand(s.commandState).commandOrdinal,
        projection.correlation == activeCommand(s.commandState).correlation,
      }
    | FreshStateProjection(_) => isNoCommand(s.commandState)
    | NoEvidence => true
  }
  pure def commandCanSettleWith(s: State, report: ExecutorReport): bool = and {
    isCalled(s.commandState),
    activeCommand(s.commandState).kind != BeginCommand or report == ExecutorWorkExecuting,
  }
  pure def canSettleCommandResponse(s: State): bool = and {
    isBoundaryCommandResponse(s.evidence),
    commandEvidenceMatchesActive(s),
    commandCanSettleWith(s, boundaryResponseReport(s.evidence)),
  }
  pure def canSettleCommandProjection(s: State): bool = match s.evidence {
    | CommandProjectionEvidence(projection) => commandEvidenceMatchesActive(s) and projectionIsExact(projection.outcome) and commandCanSettleWith(s, reportForProjection(projection.outcome))
    | _ => false
  }

  var state: State

  val everyCallHasOneDurableIntent: bool = state.commandCallCount <= state.commandIntentCount
  val unmatchedIntentBlocksAnotherCommand: bool = isNoCommand(state.commandState) or not(canRecordBeginIntent(state) or canRecordResumeIntent(state) or canRecordSuspendIntent(state))
  val acceptedReportsRequireSettledCommandOrObservation: bool = state.acceptedReportOrdinal <= state.commandSettlementCount + state.observationCount
  val unsettledEvidenceDoesNotAppendReport: bool = state.evidence == NoEvidence or state.acceptedReportOrdinal == state.acceptedReportOrdinalBeforeEvidence
  val commandOrdinalsAreAllocatedExactly: bool = state.nextCommandOrdinal == state.commandIntentCount + 1
  // Keep correlation and ordinal attached to each effectful boundary value;
  // a projection from another attempt or command is not reconciliation
  // evidence for this command even if its lifecycle report looks exact.
  val everyBoundaryValueCarriesExactCorrelation: bool = and {
    match state.commandState {
      | CommandIntended(command) => correlationIsPlanned(command.correlation)
      | CommandCalled(command) => correlationIsPlanned(command.correlation)
      | NoCommand => true
    },
    match state.evidence {
      | BoundaryCommandResponse(response) => correlationIsPlanned(response.correlation)
      | CommandProjectionEvidence(projection) => correlationIsPlanned(projection.correlation)
      | FreshStateProjection(projection) => correlationIsPlanned(projection.correlation)
      | NoEvidence => true
    },
  }
  val boundaryEvidenceUsesExactCommandIdentity: bool = commandEvidenceMatchesActive(state)
  val commandProjectionBelongsToCalledCommand: bool = match state.evidence {
    | CommandProjectionEvidence(projection) => and {
        isCalled(state.commandState),
        state.responseAmbiguous,
        projection.commandOrdinal == activeCommand(state.commandState).commandOrdinal,
        projection.correlation == activeCommand(state.commandState).correlation,
      }
    | _ => true
  }
  val stateProjectionNeverSettlesCommand: bool = match state.evidence { | FreshStateProjection(_) => isNoCommand(state.commandState) | _ => true }
  val beginOccursAtMostOnce: bool = state.beginIntentsSinceSafeSuspension <= 1
  val firstAcceptedReportIsExecuting: bool = state.acceptedReportOrdinal != 1 or state.status == StatusExecuting
  val resumeRequiresAcceptedSafeReport: bool = state.lastAction != ResumeIntentRecordedAction or state.status == StatusSafelySuspended
  val acceptedSafeReportAuthorizesAtMostOneResume: bool = state.resumeIntentsSinceSafeSuspension <= 1
  val observationsDoNotConsumeCommandBudget: bool = (state.lastAction != FreshStateProjectedAction and state.lastAction != UnchangedExactReportObservedAction) or and {
    state.commandIntentCount == state.commandIntentCountBeforePassiveRead,
    state.commandCallCount == state.commandCallCountBeforePassiveRead,
  }
  val acceptedReportOrdinalAdvancesExactlyForDistinctReports: bool = {
    val reportWasAccepted = state.lastAction == ResponseSettledAction or state.lastAction == ProjectionSettledAction or state.lastAction == FreshStateAcceptedAction
    not(reportWasAccepted) or state.acceptedReportOrdinal == state.acceptedReportOrdinalBeforeEvidence + (if (state.lastAcceptedReportWasDistinct) 1 else 0)
  }
  val unchangedExactObservationDoesNotAppendReport: bool = state.lastAction != UnchangedExactReportObservedAction or state.acceptedReportOrdinal == state.acceptedReportOrdinalBeforeEvidence
  val unchangedExactObservationIsProcessLocal: bool = state.lastAction != UnchangedExactReportObservedAction or and {
    state.evidence == NoEvidence,
    state.durableObservationCount == state.durableObservationCountBeforePassiveRead,
    state.proposalIdentityCount == state.proposalIdentityCountBeforePassiveRead,
    state.commandIntentCount == state.commandIntentCountBeforePassiveRead,
    state.commandCallCount == state.commandCallCountBeforePassiveRead,
  }
  val oneReconciliationProjectionPerActivation: bool = state.reconciliationProjectionsThisActivation <= 1
  val suspendCommandLimitPreserved: bool = state.suspendIntentsSinceExecuting <= SUSPEND_COMMAND_LIMIT
  val lostSuspendResponseConsumesCommandBudget: bool = state.lostSuspendResponseCount <= state.suspendCommandIntentCount
  val lostSuspendRequiresReconciliationBeforeRetry: bool = and {
    state.lostSuspendResponseCount <= state.lostSuspendProjectionSettlementCount + 1,
    state.lostSuspendResponseCount <= state.lostSuspendProjectionSettlementCount or and {
      state.responseAmbiguous,
      isCalled(state.commandState),
      activeCommand(state.commandState).kind == SuspendCommand,
      activeCommand(state.commandState).commandOrdinal == state.commandIntentCount,
    },
  }
  val unsafeOrUnavailableNeverReleasesPosition: bool = match state.evidence {
    | CommandProjectionEvidence(projection) => projectionIsExact(projection.outcome) or state.positionHeld == state.positionHeldBeforeEvidence
    | FreshStateProjection(projection) => observationIsExact(projection.observation) or state.positionHeld == state.positionHeldBeforeEvidence
    | _ => true
  }
  val executingAndUnsettledWorkRetainsPosition: bool = state.status != StatusExecuting or state.positionHeld
  val safeSuspensionReleasesPosition: bool = state.status != StatusSafelySuspended or state.resumeIntentsSinceSafeSuspension > 0 or not(state.positionHeld)
  val terminalReleasesPosition: bool = state.status != StatusTerminal or not(state.positionHeld)
  val terminalAcceptedStatusIsAbsorbing: bool = not(state.terminalReportEverAccepted) or state.status == StatusTerminal
  val safeToExecutingRequiresResume: bool = state.status != StatusExecuting or state.acceptedReportOrdinal <= 1 or state.resumeIntentsSinceSafeSuspension == 1
  // Passive lifecycle acceptance cannot create the first report and cannot
  // turn Executing into Safe without a Suspend intent. Safe-to-Terminal remains
  // valid because Terminal is autonomous and absorbing.
  val passiveReportAcceptanceHasCausalCommand: bool = state.lastAction != FreshStateAcceptedAction or and {
    state.acceptedReportOrdinalBeforeEvidence > 0,
    state.status != StatusSafelySuspended or state.suspendIntentsSinceExecutingBeforeEvidence > 0,
  }

  val responsibilityBeganReached = state.lastAction == ResponsibilityBeganAction
  val beginIntentRecordedReached = state.lastAction == BeginIntentRecordedAction
  val resumeIntentRecordedReached = state.lastAction == ResumeIntentRecordedAction
  val suspendIntentRecordedReached = state.lastAction == SuspendIntentRecordedAction
  val beginCalledReached = state.lastAction == BeginCalledAction
  val resumeCalledReached = state.lastAction == ResumeCalledAction
  val suspendCalledReached = state.lastAction == SuspendCalledAction
  val responseReceivedReached = state.lastAction == ResponseReceivedAction
  val responseLostReached = state.lastAction == ResponseLostAction
  val lostSuspendResponseReached = state.lastAction == ResponseLostAction and activeCommand(state.commandState).kind == SuspendCommand
  val commandProjectedReached = state.lastAction == CommandProjectedAction
  val freshStateProjectedReached = state.lastAction == FreshStateProjectedAction
  val responseSettledReached = state.lastAction == ResponseSettledAction
  val projectionSettledReached = state.lastAction == ProjectionSettledAction
  val lostSuspendProjectionSettledReached = state.lastAction == ProjectionSettledAction and state.lostSuspendResponseCount > 0 and state.lostSuspendResponseCount == state.lostSuspendProjectionSettlementCount
  val freshStateAcceptedReached = state.lastAction == FreshStateAcceptedAction
  val recoveryActivatedReached = state.lastAction == RecoveryActivatedAction
  val fourthUnchangedExecutingObservationReached = state.status == StatusExecuting and state.observationCount >= 4 and state.acceptedReportOrdinal == 1
  val suspendCommandLimitReached = state.suspendIntentsSinceExecuting == SUSPEND_COMMAND_LIMIT
  val executingReached = state.status == StatusExecuting
  val safelySuspendedReached = state.status == StatusSafelySuspended
  val terminalReached = state.status == StatusTerminal

  pure def releasableEvidenceAwaitingSettlement(s: State): bool = match s.evidence {
    | BoundaryCommandResponse(response) => commandCanSettleWith(s, response.report) and (response.report == ExecutorWorkSafelySuspended or response.report == ExecutorWorkTerminal)
    | CommandProjectionEvidence(projection) => canSettleCommandProjection(s) and (projection.outcome == CommandProjectionExactSafelySuspended or projection.outcome == CommandProjectionExactTerminal)
    | FreshStateProjection(projection) => projection.observation == ExecutorStateSafelySuspended or projection.observation == ExecutorStateTerminal
    | _ => false
  }
  temporal releasableEvidenceEventuallyReleasesPosition = releasableEvidenceStep.weakFair(Set(state)).implies(
    always(releasableEvidenceAwaitingSettlement(state) implies eventually(not(state.positionHeld)))
  )

  action init: bool = all {
    state' = { status: ResponsibilityNotBegun, commandState: NoCommand, evidence: NoEvidence, positionHeld: false, positionHeldBeforeEvidence: false, nextCommandOrdinal: 1, beginIntentsSinceSafeSuspension: 0, resumeIntentsSinceSafeSuspension: 0, suspendIntentsSinceExecuting: 0, suspendIntentsSinceExecutingBeforeEvidence: 0, suspendCommandIntentCount: 0, lostSuspendResponseCount: 0, lostSuspendProjectionSettlementCount: 0, commandIntentCount: 0, commandCallCount: 0, commandSettlementCount: 0, commandResponseEvidenceCount: 0, commandResponseSettlementCount: 0, reconciliationProjectionsThisActivation: 0, recoveryCount: 0, responseAmbiguous: false, acceptedReportOrdinal: 0, acceptedReportOrdinalBeforeEvidence: 0, lastAcceptedReportWasDistinct: false, observationCount: 0, durableObservationCount: 0, durableObservationCountBeforePassiveRead: 0, proposalIdentityCount: 0, proposalIdentityCountBeforePassiveRead: 0, commandIntentCountBeforePassiveRead: 0, commandCallCountBeforePassiveRead: 0, beginEverIntended: false, terminalReportEverAccepted: false, lastAction: InitializedAction }
  }
  action beginResponsibility: bool = all { state.status == ResponsibilityNotBegun, state' = { ...state, status: ResponsibilityBegan, positionHeld: true, lastAction: ResponsibilityBeganAction } }
  action recordBeginIntent: bool = all {
    canRecordBeginIntent(state),
    state' = { ...state, commandState: CommandIntended(plannedCommand(state, BeginCommand)), nextCommandOrdinal: state.nextCommandOrdinal + 1, commandIntentCount: state.commandIntentCount + 1, beginIntentsSinceSafeSuspension: state.beginIntentsSinceSafeSuspension + 1, beginEverIntended: true, lastAction: BeginIntentRecordedAction }
  }
  action recordResumeIntent: bool = all {
    canRecordResumeIntent(state),
    state' = { ...state, commandState: CommandIntended(plannedCommand(state, ResumeCommand)), nextCommandOrdinal: state.nextCommandOrdinal + 1, commandIntentCount: state.commandIntentCount + 1, resumeIntentsSinceSafeSuspension: state.resumeIntentsSinceSafeSuspension + 1, positionHeld: true, lastAction: ResumeIntentRecordedAction }
  }
  action recordSuspendIntent: bool = all {
    canRecordSuspendIntent(state),
    state' = { ...state, commandState: CommandIntended(plannedCommand(state, SuspendCommand)), nextCommandOrdinal: state.nextCommandOrdinal + 1, commandIntentCount: state.commandIntentCount + 1, suspendIntentsSinceExecuting: state.suspendIntentsSinceExecuting + 1, suspendCommandIntentCount: state.suspendCommandIntentCount + 1, lastAction: SuspendIntentRecordedAction }
  }
  action callBegin: bool = all { state.commandState == CommandIntended(activeCommand(state.commandState)), activeCommand(state.commandState).kind == BeginCommand, state' = { ...state, commandState: CommandCalled(activeCommand(state.commandState)), commandCallCount: state.commandCallCount + 1, lastAction: BeginCalledAction } }
  action callResume: bool = all { state.commandState == CommandIntended(activeCommand(state.commandState)), activeCommand(state.commandState).kind == ResumeCommand, state' = { ...state, commandState: CommandCalled(activeCommand(state.commandState)), commandCallCount: state.commandCallCount + 1, lastAction: ResumeCalledAction } }
  action callSuspend: bool = all { state.commandState == CommandIntended(activeCommand(state.commandState)), activeCommand(state.commandState).kind == SuspendCommand, state' = { ...state, commandState: CommandCalled(activeCommand(state.commandState)), commandCallCount: state.commandCallCount + 1, lastAction: SuspendCalledAction } }
  action receiveCommandResponse(report: ExecutorReport): bool = all { isCalled(state.commandState), not(state.responseAmbiguous), state.evidence == NoEvidence, state' = { ...state, evidence: BoundaryCommandResponse({ correlation: activeCommand(state.commandState).correlation, commandOrdinal: activeCommand(state.commandState).commandOrdinal, report: report }), positionHeldBeforeEvidence: state.positionHeld, acceptedReportOrdinalBeforeEvidence: state.acceptedReportOrdinal, commandResponseEvidenceCount: state.commandResponseEvidenceCount + 1, responseAmbiguous: false, lastAction: ResponseReceivedAction } }
  action loseCommandResponse: bool = all { isCalled(state.commandState), not(state.responseAmbiguous), state.evidence == NoEvidence, state' = { ...state, responseAmbiguous: true, lostSuspendResponseCount: state.lostSuspendResponseCount + (if (activeCommand(state.commandState).kind == SuspendCommand) 1 else 0), lastAction: ResponseLostAction } }
  action recordCommandProjection(commandProjection: CommandProjectionOutcome): bool = all { isCalled(state.commandState), state.responseAmbiguous, state.evidence == NoEvidence, state.reconciliationProjectionsThisActivation == 0, state' = { ...state, evidence: CommandProjectionEvidence({ correlation: activeCommand(state.commandState).correlation, commandOrdinal: activeCommand(state.commandState).commandOrdinal, outcome: commandProjection }), positionHeldBeforeEvidence: state.positionHeld, acceptedReportOrdinalBeforeEvidence: state.acceptedReportOrdinal, reconciliationProjectionsThisActivation: 1, lastAction: CommandProjectedAction } }
  action recordFreshStateProjection(stateObservation: ExecutorStateObservation): bool = all {
    canRecordFreshStateProjection(state, stateObservation),
    state.reconciliationProjectionsThisActivation == 0,
    state' = if (observationIsExact(stateObservation) and statusMatchesReport(state.status, reportForObservation(stateObservation)))
      { ...state, acceptedReportOrdinalBeforeEvidence: state.acceptedReportOrdinal, suspendIntentsSinceExecutingBeforeEvidence: state.suspendIntentsSinceExecuting, observationCount: state.observationCount + 1, durableObservationCountBeforePassiveRead: state.durableObservationCount, proposalIdentityCountBeforePassiveRead: state.proposalIdentityCount, commandIntentCountBeforePassiveRead: state.commandIntentCount, commandCallCountBeforePassiveRead: state.commandCallCount, lastAction: UnchangedExactReportObservedAction }
    else
      { ...state, evidence: FreshStateProjection({ correlation: PLANNED_CORRELATION, observation: stateObservation }), positionHeldBeforeEvidence: state.positionHeld, acceptedReportOrdinalBeforeEvidence: state.acceptedReportOrdinal, suspendIntentsSinceExecutingBeforeEvidence: state.suspendIntentsSinceExecuting, reconciliationProjectionsThisActivation: 1, observationCount: state.observationCount + 1, durableObservationCount: state.durableObservationCount + 1, commandIntentCountBeforePassiveRead: state.commandIntentCount, commandCallCountBeforePassiveRead: state.commandCallCount, lastAction: FreshStateProjectedAction },
  }
  action settleCommandResponse: bool = all {
    canSettleCommandResponse(state),
    state' = { ...applyDistinctReport(state, boundaryResponseReport(state.evidence)), commandState: NoCommand, evidence: NoEvidence, commandSettlementCount: state.commandSettlementCount + 1, commandResponseSettlementCount: state.commandResponseSettlementCount + 1, lastAction: ResponseSettledAction },
  }
  action settleCommandProjection: bool = all {
    canSettleCommandProjection(state),
    state' = { ...applyDistinctReport(state, reportForProjection(commandProjectionOutcome(state.evidence))), commandState: NoCommand, evidence: NoEvidence, commandSettlementCount: state.commandSettlementCount + 1, lostSuspendProjectionSettlementCount: state.lostSuspendProjectionSettlementCount + (if (activeCommand(state.commandState).kind == SuspendCommand and state.responseAmbiguous) 1 else 0), responseAmbiguous: false, lastAction: ProjectionSettledAction },
  }
  action acceptFreshStateProjectionProof: bool = all {
    observationIsExact(freshObservation(state.evidence)),
    state' = { ...applyDistinctReport(state, reportForObservation(freshObservation(state.evidence))), evidence: NoEvidence, lastAction: FreshStateAcceptedAction },
  }
  action recoverActivation: bool = all { state.evidence == NoEvidence, state.recoveryCount < RECOVERY_LIMIT, state' = { ...state, reconciliationProjectionsThisActivation: 0, recoveryCount: state.recoveryCount + 1, lastAction: RecoveryActivatedAction } }

  action step: bool = {
    nondet report = EXECUTOR_REPORTS.oneOf()
    nondet commandProjection = COMMAND_PROJECTIONS.oneOf()
    nondet stateObservation = STATE_OBSERVATIONS.oneOf()
    any {
      beginResponsibility, recordBeginIntent, recordResumeIntent, recordSuspendIntent, callBegin, callResume, callSuspend,
      receiveCommandResponse(report), loseCommandResponse, recordCommandProjection(commandProjection),
      recordFreshStateProjection(stateObservation), settleCommandResponse, settleCommandProjection,
      acceptFreshStateProjectionProof, recoverActivation,
    }
  }
  // Focused temporal subgraph over the same production actions. It reaches
  // releasable direct-response, command-projection, and fresh-state evidence
  // without exploring unrelated unavailable or contradictory recovery state.
  action releasableEvidenceStep: bool = any {
    beginResponsibility,
    all {
      state.positionHeld,
      any {
        recordBeginIntent,
        callBegin,
        receiveCommandResponse(ExecutorWorkExecuting),
        settleCommandResponse,
        recordSuspendIntent,
        callSuspend,
        receiveCommandResponse(ExecutorWorkSafelySuspended),
        receiveCommandResponse(ExecutorWorkTerminal),
        loseCommandResponse,
        recordCommandProjection(CommandProjectionExactSafelySuspended),
        recordCommandProjection(CommandProjectionExactTerminal),
        recordFreshStateProjection(ExecutorStateSafelySuspended),
        recordFreshStateProjection(ExecutorStateTerminal),
        settleCommandProjection,
        acceptFreshStateProjectionProof,
      },
    },
  }
  action mbtStep: bool = step
}
