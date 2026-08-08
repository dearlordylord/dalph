// Models the durable protocol at the planned-attempt executor boundary. Dalph
// records one exact command intent before calling the executor. A lost response
// leaves that ordinal unmatched until an exact command projection settles it;
// a fresh executor-state projection is separate evidence and cannot do so.
module plannedAttemptExecutor {
  type Correlation = {
    runId: int,
    attemptId: int,
  }

  type ExecutorReport =
    | ReportRunning
    | ReportSafelySuspended
    | ReportTerminal

  type WorkStatus =
    | ResponsibilityNotBegun
    | ResponsibilityBegan
    | Running(Correlation)
    | SafelySuspended(Correlation)
    | Terminal(Correlation)

  type CommandKind = StartOrContinueCommand | SuspendCommand

  // A command ordinal is allocated by its durable intent and is carried
  // unchanged through the boundary call, response, projection, and settlement.
  type ExecutorCommand = {
    correlation: Correlation,
    commandOrdinal: int,
    kind: CommandKind,
  }

  type CommandState =
    | NoCommand
    | CommandIntended(ExecutorCommand)
    | CommandCalled(ExecutorCommand)

  type CommandResult = {
    command: ExecutorCommand,
    report: ExecutorReport,
  }

  type CommandProjectionOutcome =
    | CommandProjectionExactRunning
    | CommandProjectionExactSafelySuspended
    | CommandProjectionExactTerminal
    | CommandProjectionUnavailable
    | CommandProjectionContradiction

  type CommandProjection = {
    command: ExecutorCommand,
    outcome: CommandProjectionOutcome,
  }

  type ExecutorStateObservation =
    | ExecutorStateRunning
    | ExecutorStateSafelySuspended
    | ExecutorStateTerminal
    | ExecutorStateUnavailable

  type StateProjection = {
    correlation: Correlation,
    observation: ExecutorStateObservation,
  }

  // These three evidence sources are deliberately disjoint. In particular, a
  // fresh state projection has no command ordinal and is not a command result.
  type Evidence =
    | NoEvidence
    | CommandResponse(CommandResult)
    | CommandProjectionEvidence(CommandProjection)
    | FreshStateProjection(StateProjection)

  type SettlementSource =
    | NoSettlementSource
    | SettledFromCommandResponse
    | SettledFromExactCommandProjection
    | SettledFromFreshStateProjection

  type CommandSettlement = {
    intendedCommand: ExecutorCommand,
    evidenceCommand: ExecutorCommand,
    source: SettlementSource,
  }

  type LastSettlement = NoSettlement | Settled(CommandSettlement)

  // `lastAction` makes every major protocol action independently witnessable.
  type ActionTag =
    | InitializedAction
    | ResponsibilityBeganAction
    | StartIntentRecordedAction
    | SuspendIntentRecordedAction
    | StartCalledAction
    | SuspendCalledAction
    | ResponseReceivedAction
    | ResponseLostAction
    | CommandProjectedAction
    | FreshStateProjectedAction
    | FreshSafeProofAcceptedAction
    | ResponseSettledAction
    | ProjectionSettledAction
    | RecoveryActivatedAction

  type State = {
    status: WorkStatus,
    commandState: CommandState,
    evidence: Evidence,
    positionHeld: bool,
    nextCommandOrdinal: int,
    startOrContinueIntentsSinceSafeSuspension: int,
    suspendIntentsSinceRunning: int,
    commandIntentCount: int,
    commandCallCount: int,
    commandSettlementCount: int,
    commandResponseEvidenceCount: int,
    commandResponseSettlementCount: int,
    reconciliationProjectionsThisActivation: int,
    recoveryCount: int,
    responseAmbiguous: bool,
    lastSettlement: LastSettlement,
    lastAction: ActionTag,
  }

  pure val RUN_ID = 158
  pure val ATTEMPT_ID = 1
  pure val OTHER_RUN_ID = 159
  pure val OTHER_ATTEMPT_ID = 2
  pure val CONTINUATION_LIMIT = 3
  pure val SUSPEND_COMMAND_LIMIT = 3
  // Finite exploration bound, not production retry policy. Initial activation
  // plus two recoveries is enough to consume either three-command budget.
  pure val RECOVERY_LIMIT = 2

  pure val PLANNED_CORRELATION: Correlation = {
    runId: RUN_ID,
    attemptId: ATTEMPT_ID,
  }

  pure val OTHER_CORRELATIONS: Set[Correlation] = Set(
    { runId: OTHER_RUN_ID, attemptId: ATTEMPT_ID },
    { runId: RUN_ID, attemptId: OTHER_ATTEMPT_ID },
  )

  pure val EXECUTOR_REPORTS: Set[ExecutorReport] = Set(
    ReportRunning,
    ReportSafelySuspended,
    ReportTerminal,
  )

  pure val COMMAND_PROJECTION_OUTCOMES: Set[CommandProjectionOutcome] = Set(
    CommandProjectionExactRunning,
    CommandProjectionExactSafelySuspended,
    CommandProjectionExactTerminal,
    CommandProjectionUnavailable,
    CommandProjectionContradiction,
  )

  pure val STATE_OBSERVATIONS: Set[ExecutorStateObservation] = Set(
    ExecutorStateRunning,
    ExecutorStateSafelySuspended,
    ExecutorStateTerminal,
    ExecutorStateUnavailable,
  )

  pure def isPlannedAttempt(correlation: Correlation): bool =
    correlation.runId == RUN_ID and correlation.attemptId == ATTEMPT_ID

  pure def isNoCommand(commandState: CommandState): bool = match commandState {
    | NoCommand => true
    | _ => false
  }

  pure def isIntendedKind(commandState: CommandState, kind: CommandKind): bool = match commandState {
    | CommandIntended(command) => command.kind == kind
    | _ => false
  }

  pure def isCalled(commandState: CommandState): bool = match commandState {
    | CommandCalled(_) => true
    | _ => false
  }

  pure def isCommandResponseEvidence(evidence: Evidence): bool = match evidence {
    | CommandResponse(_) => true
    | _ => false
  }

  pure def isCommandProjectionEvidence(evidence: Evidence): bool = match evidence {
    | CommandProjectionEvidence(_) => true
    | _ => false
  }

  pure def isFreshStateProjectionEvidence(evidence: Evidence): bool = match evidence {
    | FreshStateProjection(_) => true
    | _ => false
  }

  pure def activeCommand(commandState: CommandState): ExecutorCommand = match commandState {
    | CommandIntended(command) => command
    | CommandCalled(command) => command
    | NoCommand => {
        correlation: PLANNED_CORRELATION,
        commandOrdinal: 0,
        kind: StartOrContinueCommand,
      }
  }

  pure def commandResponseOf(evidence: Evidence): CommandResult = match evidence {
    | CommandResponse(result) => result
    | _ => {
        command: activeCommand(NoCommand),
        report: ReportRunning,
      }
  }

  pure def commandProjectionOf(evidence: Evidence): CommandProjection = match evidence {
    | CommandProjectionEvidence(projection) => projection
    | _ => {
        command: activeCommand(NoCommand),
        outcome: CommandProjectionUnavailable,
      }
  }

  pure def freshStateProjectionOf(evidence: Evidence): StateProjection = match evidence {
    | FreshStateProjection(projection) => projection
    | _ => {
        correlation: PLANNED_CORRELATION,
        observation: ExecutorStateUnavailable,
      }
  }

  pure def reportAllowedFor(kind: CommandKind, report: ExecutorReport): bool = match kind {
    | StartOrContinueCommand => report == ReportRunning or report == ReportTerminal
    | SuspendCommand => true
  }

  pure def projectedReport(outcome: CommandProjectionOutcome): ExecutorReport = match outcome {
    | CommandProjectionExactRunning => ReportRunning
    | CommandProjectionExactSafelySuspended => ReportSafelySuspended
    | CommandProjectionExactTerminal => ReportTerminal
    // These values are never consumed for unavailable or contradictory
    // projections; the settlement guard keeps the total helper away from them.
    | CommandProjectionUnavailable => ReportRunning
    | CommandProjectionContradiction => ReportRunning
  }

  pure def commandProjectionIsExact(outcome: CommandProjectionOutcome): bool =
    outcome == CommandProjectionExactRunning
      or outcome == CommandProjectionExactSafelySuspended
      or outcome == CommandProjectionExactTerminal

  pure def commandProjectionAllowed(command: ExecutorCommand, outcome: CommandProjectionOutcome): bool =
    not(commandProjectionIsExact(outcome)) or reportAllowedFor(command.kind, projectedReport(outcome))

  pure def canRecordStartIntent(s: State): bool = and {
    isNoCommand(s.commandState),
    s.evidence == NoEvidence,
    s.startOrContinueIntentsSinceSafeSuspension < CONTINUATION_LIMIT,
    match s.status {
      | ResponsibilityBegan => true
      | Running(_) => true
      | SafelySuspended(_) => true
      | _ => false
    },
  }

  pure def canRecordSuspendIntent(s: State): bool = and {
    isNoCommand(s.commandState),
    s.evidence == NoEvidence,
    s.positionHeld,
    s.suspendIntentsSinceRunning < SUSPEND_COMMAND_LIMIT,
    match s.status {
      | Running(_) => true
      | _ => false
    },
  }

  pure def canRecordFreshStateProjection(s: State): bool = and {
    isNoCommand(s.commandState),
    s.evidence == NoEvidence,
    s.reconciliationProjectionsThisActivation == 0,
  }

  pure def canSettleCommandProjection(s: State): bool = {
    val projection = commandProjectionOf(s.evidence)
    and {
      isCommandProjectionEvidence(s.evidence),
      isCalled(s.commandState),
      projection.command == activeCommand(s.commandState),
      isPlannedAttempt(projection.command.correlation),
      commandProjectionIsExact(projection.outcome),
    }
  }

  pure def applyReport(s: State, report: ExecutorReport): State = match report {
    | ReportRunning => {
        ...s,
        status: Running(PLANNED_CORRELATION),
        positionHeld: true,
        suspendIntentsSinceRunning:
          if (activeCommand(s.commandState).kind == StartOrContinueCommand) 0
          else s.suspendIntentsSinceRunning,
      }
    | ReportSafelySuspended => {
        ...s,
        status: SafelySuspended(PLANNED_CORRELATION),
        positionHeld: false,
        startOrContinueIntentsSinceSafeSuspension: 0,
      }
    | ReportTerminal => {
        ...s,
        status: Terminal(PLANNED_CORRELATION),
        positionHeld: false,
      }
  }

  pure def settleCommand(
    s: State,
    evidenceCommand: ExecutorCommand,
    source: SettlementSource,
    report: ExecutorReport,
  ): State = {
    val withReport = applyReport(s, report)
    val intended = activeCommand(s.commandState)
    {
      ...withReport,
      commandState: NoCommand,
      evidence: NoEvidence,
      commandSettlementCount: s.commandSettlementCount + 1,
      commandResponseSettlementCount:
        if (source == SettledFromCommandResponse) s.commandResponseSettlementCount + 1
        else s.commandResponseSettlementCount,
      responseAmbiguous: false,
      lastSettlement: Settled({
        intendedCommand: intended,
        evidenceCommand: evidenceCommand,
        source: source,
      }),
    }
  }

  var state: State

  // Every report, command, and settling evidence stays on the one exact
  // responsibility. This restates the comparisons instead of sharing the
  // action guards so weakened guards remain detectable.
  val everyBoundaryValueCarriesPlannedAttempt: bool = and {
    match state.status {
      | Running(correlation) => correlation.runId == RUN_ID and correlation.attemptId == ATTEMPT_ID
      | SafelySuspended(correlation) => correlation.runId == RUN_ID and correlation.attemptId == ATTEMPT_ID
      | Terminal(correlation) => correlation.runId == RUN_ID and correlation.attemptId == ATTEMPT_ID
      | _ => true
    },
    match state.commandState {
      | CommandIntended(command) =>
          command.correlation.runId == RUN_ID and command.correlation.attemptId == ATTEMPT_ID
      | CommandCalled(command) =>
          command.correlation.runId == RUN_ID and command.correlation.attemptId == ATTEMPT_ID
      | NoCommand => true
    },
    match state.evidence {
      | CommandResponse(result) =>
          result.command.correlation.runId == RUN_ID
            and result.command.correlation.attemptId == ATTEMPT_ID
      | CommandProjectionEvidence(projection) =>
          projection.command.correlation.runId == RUN_ID
            and projection.command.correlation.attemptId == ATTEMPT_ID
      | FreshStateProjection(projection) =>
          projection.correlation.runId == RUN_ID
            and projection.correlation.attemptId == ATTEMPT_ID
      | NoEvidence => true
    },
    match state.lastSettlement {
      | Settled(settlement) => and {
          settlement.intendedCommand.correlation.runId == RUN_ID,
          settlement.intendedCommand.correlation.attemptId == ATTEMPT_ID,
          settlement.evidenceCommand.correlation.runId == RUN_ID,
          settlement.evidenceCommand.correlation.attemptId == ATTEMPT_ID,
        }
      | NoSettlement => true
    },
  }

  // A boundary call consumes exactly one earlier durable intent. Keeping one
  // active command in the algebra also makes an unmatched intent block the
  // allocation and call of its successor.
  val everyCallHasOneDurableIntent: bool = and {
    state.commandCallCount <= state.commandIntentCount,
    state.commandSettlementCount <= state.commandCallCount,
    state.commandIntentCount
      == state.commandSettlementCount + (if (isNoCommand(state.commandState)) 0 else 1),
    state.commandCallCount
      == state.commandSettlementCount + (if (isCalled(state.commandState)) 1 else 0),
  }

  val unmatchedIntentBlocksAnotherCommand: bool =
    state.commandIntentCount
      == state.commandSettlementCount + (if (isNoCommand(state.commandState)) 0 else 1)

  // Projection evidence is never counted as a returned command response.
  val projectionsAreNotCommandResponses: bool =
    state.commandResponseEvidenceCount
      == state.commandResponseSettlementCount
        + match state.evidence {
          | CommandResponse(_) => 1
          | _ => 0
        }

  // The most recent settlement records both sides of the equality, rather
  // than erasing the ordinal and checking only a current status.
  val settlementsUseExactCommandOrdinal: bool = match state.lastSettlement {
    | NoSettlement => true
    | Settled(settlement) => and {
        settlement.intendedCommand.commandOrdinal == settlement.evidenceCommand.commandOrdinal,
        settlement.intendedCommand.kind == settlement.evidenceCommand.kind,
        settlement.intendedCommand.correlation.runId == settlement.evidenceCommand.correlation.runId,
        settlement.intendedCommand.correlation.attemptId == settlement.evidenceCommand.correlation.attemptId,
      }
  }

  val commandOrdinalsAreAllocatedExactly: bool = and {
    state.nextCommandOrdinal == state.commandIntentCount + 1,
    match state.commandState {
      | CommandIntended(command) => command.commandOrdinal == state.commandIntentCount
      | CommandCalled(command) => command.commandOrdinal == state.commandIntentCount
      | NoCommand => true
    },
    match state.lastSettlement {
      | Settled(settlement) =>
          settlement.intendedCommand.commandOrdinal == state.commandSettlementCount
      | NoSettlement => state.commandSettlementCount == 0
    },
  }

  val stateProjectionNeverSettlesCommand: bool = match state.lastSettlement {
    | NoSettlement => true
    | Settled(settlement) => settlement.source != SettledFromFreshStateProjection
  }

  // A generic current-state projection is only meaningful when there is no
  // unmatched command ordinal. Once a command response is ambiguous, the same
  // boundary read is classified as command-projection evidence instead.
  val freshStateProjectionHasNoUnmatchedCommand: bool =
    not(isFreshStateProjectionEvidence(state.evidence)) or isNoCommand(state.commandState)

  // Every command projection is evidence about the one called ordinal. An
  // unavailable or contradictory projection remains unresolved and must be
  // reread after recovery; only an exact report may settle it.
  val commandProjectionBelongsToCalledCommand: bool =
    not(isCommandProjectionEvidence(state.evidence)) or and {
      isCalled(state.commandState),
      state.responseAmbiguous,
      commandProjectionOf(state.evidence).command == activeCommand(state.commandState),
    }

  val commandBudgetsAreBounded: bool = and {
    state.startOrContinueIntentsSinceSafeSuspension >= 0,
    state.startOrContinueIntentsSinceSafeSuspension <= 3,
    state.suspendIntentsSinceRunning >= 0,
    state.suspendIntentsSinceRunning <= 3,
  }

  val oneReconciliationProjectionPerActivation: bool = and {
    state.reconciliationProjectionsThisActivation >= 0,
    state.reconciliationProjectionsThisActivation <= 1,
  }

  // Running or unavailable current-state evidence cannot prove quiescence.
  // Safe suspension and terminal status are the only active-responsibility
  // states in which the task-work position may be absent.
  val unsafeOrUnavailableNeverReleasesPosition: bool =
    not(state.positionHeld) implies match state.status {
      | ResponsibilityNotBegun => true
      | SafelySuspended(_) => true
      | Terminal(_) => true
      | _ => false
    }

  val runningAndUnsettledWorkRetainsPosition: bool = and {
    match state.status {
      | ResponsibilityBegan => state.positionHeld
      | Running(_) => state.positionHeld
      | _ => true
    },
    match state.commandState {
      | CommandIntended(command) =>
          command.kind != SuspendCommand
            or state.positionHeld
            or match state.status {
              | SafelySuspended(_) => true
              | Terminal(_) => true
              | _ => false
            }
      | CommandCalled(command) =>
          command.kind != SuspendCommand
            or state.positionHeld
            or match state.status {
              | SafelySuspended(_) => true
              | Terminal(_) => true
              | _ => false
            }
      | NoCommand => true
    },
  }

  val safeSuspensionReleasesPosition: bool = match state.status {
    | SafelySuspended(_) =>
        not(isNoCommand(state.commandState)) or not(state.positionHeld)
    | _ => true
  }

  val terminalReleasesPosition: bool = match state.status {
    | Terminal(_) => not(state.positionHeld)
    | _ => true
  }

  val responsibilityBeganReached: bool = state.lastAction == ResponsibilityBeganAction
  val startIntentRecordedReached: bool = state.lastAction == StartIntentRecordedAction
  val suspendIntentRecordedReached: bool = state.lastAction == SuspendIntentRecordedAction
  val startCalledReached: bool = state.lastAction == StartCalledAction
  val suspendCalledReached: bool = state.lastAction == SuspendCalledAction
  val responseReceivedReached: bool = state.lastAction == ResponseReceivedAction
  val responseLostReached: bool = state.lastAction == ResponseLostAction
  val commandProjectedReached: bool = state.lastAction == CommandProjectedAction
  val freshStateProjectedReached: bool = state.lastAction == FreshStateProjectedAction
  val freshSafeProofAcceptedReached: bool = state.lastAction == FreshSafeProofAcceptedAction
  val responseSettledReached: bool = state.lastAction == ResponseSettledAction
  val projectionSettledReached: bool = state.lastAction == ProjectionSettledAction
  val recoveryActivatedReached: bool = state.lastAction == RecoveryActivatedAction
  val continuationLimitReached: bool =
    state.startOrContinueIntentsSinceSafeSuspension == CONTINUATION_LIMIT
  val suspendCommandLimitReached: bool =
    state.suspendIntentsSinceRunning == SUSPEND_COMMAND_LIMIT
  val runningReached: bool = match state.status {
    | Running(_) => true
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

  action init: bool = all {
    state' = {
      status: ResponsibilityNotBegun,
      commandState: NoCommand,
      evidence: NoEvidence,
      positionHeld: false,
      nextCommandOrdinal: 1,
      startOrContinueIntentsSinceSafeSuspension: 0,
      suspendIntentsSinceRunning: 0,
      commandIntentCount: 0,
      commandCallCount: 0,
      commandSettlementCount: 0,
      commandResponseEvidenceCount: 0,
      commandResponseSettlementCount: 0,
      reconciliationProjectionsThisActivation: 0,
      recoveryCount: 0,
      responseAmbiguous: false,
      lastSettlement: NoSettlement,
      lastAction: InitializedAction,
    }
  }

  action beginResponsibility: bool = all {
    state.status == ResponsibilityNotBegun,
    state' = {
      ...state,
      status: ResponsibilityBegan,
      positionHeld: true,
      lastAction: ResponsibilityBeganAction,
    },
  }

  action recordStartOrContinueIntent: bool = all {
    canRecordStartIntent(state),
    state' = {
      ...state,
      commandState: CommandIntended({
        correlation: PLANNED_CORRELATION,
        commandOrdinal: state.nextCommandOrdinal,
        kind: StartOrContinueCommand,
      }),
      positionHeld: true,
      nextCommandOrdinal: state.nextCommandOrdinal + 1,
      startOrContinueIntentsSinceSafeSuspension:
        state.startOrContinueIntentsSinceSafeSuspension + 1,
      commandIntentCount: state.commandIntentCount + 1,
      lastAction: StartIntentRecordedAction,
    },
  }

  action recordSuspendIntent: bool = all {
    canRecordSuspendIntent(state),
    state' = {
      ...state,
      commandState: CommandIntended({
        correlation: PLANNED_CORRELATION,
        commandOrdinal: state.nextCommandOrdinal,
        kind: SuspendCommand,
      }),
      nextCommandOrdinal: state.nextCommandOrdinal + 1,
      suspendIntentsSinceRunning: state.suspendIntentsSinceRunning + 1,
      commandIntentCount: state.commandIntentCount + 1,
      lastAction: SuspendIntentRecordedAction,
    },
  }

  action callStartOrContinue: bool = all {
    isIntendedKind(state.commandState, StartOrContinueCommand),
    state.evidence == NoEvidence,
    state' = {
      ...state,
      commandState: CommandCalled(activeCommand(state.commandState)),
      commandCallCount: state.commandCallCount + 1,
      lastAction: StartCalledAction,
    },
  }

  action callSuspend: bool = all {
    isIntendedKind(state.commandState, SuspendCommand),
    state.evidence == NoEvidence,
    state' = {
      ...state,
      commandState: CommandCalled(activeCommand(state.commandState)),
      commandCallCount: state.commandCallCount + 1,
      lastAction: SuspendCalledAction,
    },
  }

  action receiveCommandResponse(report: ExecutorReport): bool = {
    val command = activeCommand(state.commandState)
    all {
      isCalled(state.commandState),
      state.evidence == NoEvidence,
      not(state.responseAmbiguous),
      reportAllowedFor(command.kind, report),
      state' = {
        ...state,
        evidence: CommandResponse({ command: command, report: report }),
        commandResponseEvidenceCount: state.commandResponseEvidenceCount + 1,
        lastAction: ResponseReceivedAction,
      },
    }
  }

  action loseCommandResponse: bool = all {
    isCalled(state.commandState),
    state.evidence == NoEvidence,
    not(state.responseAmbiguous),
    state' = {
      ...state,
      responseAmbiguous: true,
      lastAction: ResponseLostAction,
    },
  }

  action recordCommandProjection(outcome: CommandProjectionOutcome): bool = {
    val command = activeCommand(state.commandState)
    all {
      isCalled(state.commandState),
      state.responseAmbiguous,
      state.evidence == NoEvidence,
      state.reconciliationProjectionsThisActivation == 0,
      commandProjectionAllowed(command, outcome),
      state' = {
        ...state,
        evidence: CommandProjectionEvidence({ command: command, outcome: outcome }),
        reconciliationProjectionsThisActivation: 1,
        lastAction: CommandProjectedAction,
      },
    }
  }

  action recordFreshStateProjection(observation: ExecutorStateObservation): bool = all {
    canRecordFreshStateProjection(state),
    state' = {
      ...state,
      evidence: FreshStateProjection({
        correlation: PLANNED_CORRELATION,
        observation: observation,
      }),
      reconciliationProjectionsThisActivation: 1,
      lastAction: FreshStateProjectedAction,
    },
  }

  // With no unmatched command, a fresh exact safe/terminal state can prove
  // that no executor-owned writer remains and release the task-work position.
  action acceptFreshStateProjectionProof: bool = {
    val projection = freshStateProjectionOf(state.evidence)
    all {
      isFreshStateProjectionEvidence(state.evidence),
      isNoCommand(state.commandState),
      isPlannedAttempt(projection.correlation),
      projection.observation == ExecutorStateSafelySuspended
        or projection.observation == ExecutorStateTerminal,
      state.positionHeld,
      state' = {
        ...state,
        status:
          if (projection.observation == ExecutorStateTerminal)
            Terminal(projection.correlation)
          else SafelySuspended(projection.correlation),
        positionHeld: false,
        startOrContinueIntentsSinceSafeSuspension:
          if (projection.observation == ExecutorStateSafelySuspended) 0
          else state.startOrContinueIntentsSinceSafeSuspension,
        evidence: NoEvidence,
        lastAction: FreshSafeProofAcceptedAction,
      },
    }
  }

  action settleCommandResponse: bool = {
    val result = commandResponseOf(state.evidence)
    all {
      isCommandResponseEvidence(state.evidence),
      isCalled(state.commandState),
      result.command == activeCommand(state.commandState),
      isPlannedAttempt(result.command.correlation),
      state' = {
        ...settleCommand(
          state,
          result.command,
          SettledFromCommandResponse,
          result.report,
        ),
        lastAction: ResponseSettledAction,
      },
    }
  }

  action settleCommandProjection: bool = {
    val projection = commandProjectionOf(state.evidence)
    all {
      canSettleCommandProjection(state),
      state' = {
        ...settleCommand(
          state,
          projection.command,
          SettledFromExactCommandProjection,
          projectedReport(projection.outcome),
        ),
        lastAction: ProjectionSettledAction,
      },
    }
  }

  // Recovery starts a new activation with one projection allowance. Any
  // unaccepted projection result is process-local and is reread; the durable
  // called command and ordinal remain unmatched.
  action recoverActivation: bool = all {
    isCalled(state.commandState),
    state.responseAmbiguous,
    state.reconciliationProjectionsThisActivation == 1,
    state.recoveryCount < RECOVERY_LIMIT,
    state' = {
      ...state,
      evidence: NoEvidence,
      reconciliationProjectionsThisActivation: 0,
      recoveryCount: state.recoveryCount + 1,
      lastAction: RecoveryActivatedAction,
    },
  }

  action step: bool = {
    nondet report = EXECUTOR_REPORTS.oneOf()
    nondet commandProjection = COMMAND_PROJECTION_OUTCOMES.oneOf()
    nondet stateObservation = STATE_OBSERVATIONS.oneOf()
    any {
      beginResponsibility,
      recordStartOrContinueIntent,
      recordSuspendIntent,
      callStartOrContinue,
      callSuspend,
      receiveCommandResponse(report),
      loseCommandResponse,
      recordCommandProjection(commandProjection),
      recordFreshStateProjection(stateObservation),
      acceptFreshStateProjectionProof,
      settleCommandResponse,
      settleCommandProjection,
      recoverActivation,
    }
  }
}
