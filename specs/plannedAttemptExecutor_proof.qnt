// Complete finite proof projections for the plannedAttemptExecutor subject.
// The canonical model and its production-backed MBT remain the source of
// executable behavior. These projections retain its command-evidence and two
// bounded-command chronologies while removing the reset cycles that prevent a
// complete traversal of the canonical graph, as permitted by ADR 0010.
module plannedAttemptExecutorEvidenceProof {
  type CommandKind = StartCommand | SuspendCommand
  type Report = RunningReport | SafelySuspendedReport | TerminalReport
  type Correlation = ExactCorrelation | ForeignCorrelation
  type Stage =
    | ResponsibilityHeld
    | IntentRecorded
    | CommandCalled
    | ResponseLost
    | DirectResponseObserved
    | CommandProjectionObserved
    | FreshStateProjectionObserved
    | Settled
  type Event =
    | Initialized
    | StartIntentRecorded
    | SuspendIntentRecorded
    | ExecutorCalled
    | ExecutorResponseLost
    | DirectResponseRecorded
    | ExactCommandProjectionRecorded
    | UnavailableCommandProjectionRecorded
    | RecoveryActivated
    | FreshSafeStateProjectionRecorded
    | DirectResponseSettled
    | CommandProjectionSettled
    | FreshStateProjectionAccepted

  type State = {
    stage: Stage,
    kind: CommandKind,
    intendedOrdinal: int,
    evidenceOrdinal: int,
    evidenceCorrelation: Correlation,
    report: Report,
    intentCount: int,
    callCount: int,
    directResponseCount: int,
    commandProjectionCount: int,
    settlementCount: int,
    reconciliationReadsThisActivation: int,
    recoveryCount: int,
    positionHeld: bool,
    lastEvent: Event,
  }

  var state: State

  pure def reportAllowedFor(kind: CommandKind, report: Report): bool =
    kind == SuspendCommand or report == RunningReport or report == TerminalReport

  val everyCallHasDurableIntent: bool = state.callCount <= state.intentCount

  val directResponsesAndProjectionsStayDistinct: bool = and {
    state.directResponseCount <= state.callCount,
    state.commandProjectionCount <= state.callCount,
    state.directResponseCount + state.commandProjectionCount <= state.callCount,
    state.lastEvent != DirectResponseRecorded or state.directResponseCount == 1,
    state.lastEvent != ExactCommandProjectionRecorded or state.commandProjectionCount == 1,
  }

  val settlementUsesExactOrdinalAndCorrelation: bool =
    state.lastEvent != DirectResponseSettled
      and state.lastEvent != CommandProjectionSettled
      or and {
        state.evidenceOrdinal == state.intendedOrdinal,
        state.evidenceCorrelation == ExactCorrelation,
      }

  val freshStateProjectionNeverSettlesCommand: bool =
    state.lastEvent != FreshStateProjectionAccepted or and {
      state.callCount == 0,
      state.settlementCount == 0,
      state.intendedOrdinal == 0,
    }

  val oneReconciliationReadPerActivation: bool =
    state.reconciliationReadsThisActivation >= 0
      and state.reconciliationReadsThisActivation <= 1

  val ambiguousOrUnavailableEvidenceRetainsPosition: bool =
    state.stage != ResponseLost or and {
      state.positionHeld,
      state.settlementCount == 0,
    }

  val positionReleasesOnlyForSafeOrTerminalEvidence: bool =
    and {
      not(state.positionHeld) implies and {
        state.stage == Settled,
        state.report == SafelySuspendedReport or state.report == TerminalReport,
      },
      state.stage == Settled
        and (state.report == SafelySuspendedReport or state.report == TerminalReport)
        implies not(state.positionHeld),
    }

  val evidenceProofTypeOk: bool = and {
    state.intentCount >= 0,
    state.intentCount <= 1,
    state.callCount >= 0,
    state.callCount <= 1,
    state.settlementCount >= 0,
    state.settlementCount <= 1,
    state.recoveryCount >= 0,
    state.recoveryCount <= 1,
  }

  val startIntentReached: bool = state.lastEvent == StartIntentRecorded
  val suspendIntentReached: bool = state.lastEvent == SuspendIntentRecorded
  val commandCalledReached: bool = state.lastEvent == ExecutorCalled
  val responseLostReached: bool = state.lastEvent == ExecutorResponseLost
  val directResponseReached: bool = state.lastEvent == DirectResponseRecorded
  val commandProjectionReached: bool = state.lastEvent == ExactCommandProjectionRecorded
  val unavailableProjectionReached: bool = state.lastEvent == UnavailableCommandProjectionRecorded
  val recoveryActivatedReached: bool = state.lastEvent == RecoveryActivated
  val directResponseSettledReached: bool = state.lastEvent == DirectResponseSettled
  val commandProjectionSettledReached: bool = state.lastEvent == CommandProjectionSettled
  val freshSafeStateProjectionReached: bool = state.lastEvent == FreshStateProjectionAccepted
  val safePositionReleasedReached: bool =
    not(state.positionHeld) and state.report == SafelySuspendedReport
  val terminalPositionReleasedReached: bool =
    not(state.positionHeld) and state.report == TerminalReport

  action init: bool = all {
    state' = {
      stage: ResponsibilityHeld,
      kind: StartCommand,
      intendedOrdinal: 0,
      evidenceOrdinal: 0,
      evidenceCorrelation: ExactCorrelation,
      report: RunningReport,
      intentCount: 0,
      callCount: 0,
      directResponseCount: 0,
      commandProjectionCount: 0,
      settlementCount: 0,
      reconciliationReadsThisActivation: 0,
      recoveryCount: 0,
      positionHeld: true,
      lastEvent: Initialized,
    },
  }

  action recordStartIntent: bool = all {
    state.stage == ResponsibilityHeld,
    state.intentCount == 0,
    state' = {
      ...state,
      stage: IntentRecorded,
      kind: StartCommand,
      intendedOrdinal: 1,
      intentCount: 1,
      lastEvent: StartIntentRecorded,
    },
  }

  action recordSuspendIntent: bool = all {
    state.stage == ResponsibilityHeld,
    state.intentCount == 0,
    state' = {
      ...state,
      stage: IntentRecorded,
      kind: SuspendCommand,
      intendedOrdinal: 1,
      intentCount: 1,
      lastEvent: SuspendIntentRecorded,
    },
  }

  action callExecutor: bool = all {
    state.stage == IntentRecorded,
    state' = {
      ...state,
      stage: CommandCalled,
      callCount: 1,
      lastEvent: ExecutorCalled,
    },
  }

  action loseResponse: bool = all {
    state.stage == CommandCalled,
    state' = { ...state, stage: ResponseLost, lastEvent: ExecutorResponseLost },
  }

  action recordDirectResponse(report: Report): bool = all {
    state.stage == CommandCalled,
    reportAllowedFor(state.kind, report),
    state' = {
      ...state,
      stage: DirectResponseObserved,
      evidenceOrdinal: state.intendedOrdinal,
      evidenceCorrelation: ExactCorrelation,
      report: report,
      directResponseCount: 1,
      lastEvent: DirectResponseRecorded,
    },
  }

  action recordExactCommandProjection(report: Report): bool = all {
    state.stage == ResponseLost,
    state.reconciliationReadsThisActivation == 0,
    reportAllowedFor(state.kind, report),
    state' = {
      ...state,
      stage: CommandProjectionObserved,
      evidenceOrdinal: state.intendedOrdinal,
      evidenceCorrelation: ExactCorrelation,
      report: report,
      commandProjectionCount: 1,
      reconciliationReadsThisActivation: 1,
      lastEvent: ExactCommandProjectionRecorded,
    },
  }

  action recordUnavailableCommandProjection: bool = all {
    state.stage == ResponseLost,
    state.reconciliationReadsThisActivation == 0,
    state' = {
      ...state,
      reconciliationReadsThisActivation: 1,
      lastEvent: UnavailableCommandProjectionRecorded,
    },
  }

  action activateRecovery: bool = all {
    state.stage == ResponseLost,
    state.reconciliationReadsThisActivation == 1,
    state.recoveryCount == 0,
    state' = {
      ...state,
      reconciliationReadsThisActivation: 0,
      recoveryCount: 1,
      lastEvent: RecoveryActivated,
    },
  }

  action recordFreshSafeStateProjection: bool = all {
    state.stage == ResponsibilityHeld,
    state.intentCount == 0,
    state.reconciliationReadsThisActivation == 0,
    state' = {
      ...state,
      stage: FreshStateProjectionObserved,
      report: SafelySuspendedReport,
      reconciliationReadsThisActivation: 1,
      lastEvent: FreshSafeStateProjectionRecorded,
    },
  }

  action settleDirectResponse: bool = all {
    state.stage == DirectResponseObserved,
    state' = {
      ...state,
      stage: Settled,
      settlementCount: 1,
      positionHeld: state.report == RunningReport,
      lastEvent: DirectResponseSettled,
    },
  }

  action settleCommandProjection: bool = all {
    state.stage == CommandProjectionObserved,
    state' = {
      ...state,
      stage: Settled,
      settlementCount: 1,
      positionHeld: state.report == RunningReport,
      lastEvent: CommandProjectionSettled,
    },
  }

  action acceptFreshStateProjection: bool = all {
    state.stage == FreshStateProjectionObserved,
    state' = {
      ...state,
      stage: Settled,
      positionHeld: false,
      lastEvent: FreshStateProjectionAccepted,
    },
  }

  action step: bool = {
    nondet report = Set(RunningReport, SafelySuspendedReport, TerminalReport).oneOf()
    any {
      recordStartIntent,
      recordSuspendIntent,
      callExecutor,
      loseResponse,
      recordDirectResponse(report),
      recordExactCommandProjection(report),
      recordUnavailableCommandProjection,
      activateRecovery,
      recordFreshSafeStateProjection,
      settleDirectResponse,
      settleCommandProjection,
      acceptFreshStateProjection,
    }
  }
}

module plannedAttemptExecutorStartBoundProof {
  type Stage = Ready | IntentRecorded | Called | ResponseLost | RunningEvidence | TerminalEvidence | Terminal
  type Event =
    | Initialized
    | StartIntentRecorded
    | StartCalled
    | StartResponseLost
    | DirectRunningObserved
    | ProjectedRunningObserved
    | DirectTerminalObserved
    | StartSettledRunning
    | StartSettledTerminal

  type State = {
    stage: Stage,
    intentCount: int,
    callCount: int,
    settlementCount: int,
    nextOrdinal: int,
    activeOrdinal: int,
    evidenceOrdinal: int,
    responseCount: int,
    projectionCount: int,
    positionHeld: bool,
    lastEvent: Event,
  }

  var state: State
  pure val START_LIMIT = 3

  val everyStartCallHasItsIntent: bool = and {
    state.callCount <= state.intentCount,
    state.intentCount <= START_LIMIT,
  }

  val everyStartSettlementUsesItsOrdinal: bool =
    state.lastEvent != StartSettledRunning
      and state.lastEvent != StartSettledTerminal
      or state.evidenceOrdinal == state.activeOrdinal

  val lostResponsesStillConsumeStartBudget: bool = and {
    state.projectionCount <= state.settlementCount + 1,
    state.projectionCount == state.settlementCount + 1
      implies state.stage == RunningEvidence,
    state.intentCount >= state.projectionCount,
  }

  val startLimitBlocksFourthCommand: bool = and {
    state.intentCount <= START_LIMIT,
    state.callCount <= START_LIMIT,
    state.settlementCount <= START_LIMIT,
    state.intentCount == START_LIMIT and state.stage == Ready
      implies state.nextOrdinal == START_LIMIT + 1,
  }

  val terminalStartReleasesPosition: bool =
    (state.stage == Terminal implies not(state.positionHeld))
      and (not(state.positionHeld) implies state.stage == Terminal)

  val startProofTypeOk: bool = and {
    state.intentCount >= 0,
    state.callCount >= 0,
    state.settlementCount >= 0,
    state.nextOrdinal >= 1,
    state.nextOrdinal <= START_LIMIT + 1,
  }

  val firstStartIntentReached: bool = state.lastEvent == StartIntentRecorded and state.intentCount == 1
  val thirdStartIntentReached: bool = state.lastEvent == StartIntentRecorded and state.intentCount == START_LIMIT
  val startCalledReached: bool = state.lastEvent == StartCalled
  val startResponseLostReached: bool = state.lastEvent == StartResponseLost
  val directStartSettledReached: bool = state.lastEvent == StartSettledRunning and state.responseCount > 0
  val projectedStartSettledReached: bool = state.lastEvent == StartSettledRunning and state.projectionCount > 0
  val thirdStartSettledReached: bool = state.settlementCount == START_LIMIT
  val terminalStartReached: bool = state.lastEvent == StartSettledTerminal

  action init: bool = all {
    state' = {
      stage: Ready,
      intentCount: 0,
      callCount: 0,
      settlementCount: 0,
      nextOrdinal: 1,
      activeOrdinal: 0,
      evidenceOrdinal: 0,
      responseCount: 0,
      projectionCount: 0,
      positionHeld: true,
      lastEvent: Initialized,
    },
  }

  action recordStartIntent: bool = all {
    state.stage == Ready,
    state.intentCount < START_LIMIT,
    state' = {
      ...state,
      stage: IntentRecorded,
      intentCount: state.intentCount + 1,
      activeOrdinal: state.nextOrdinal,
      nextOrdinal: state.nextOrdinal + 1,
      lastEvent: StartIntentRecorded,
    },
  }

  action callStart: bool = all {
    state.stage == IntentRecorded,
    state' = { ...state, stage: Called, callCount: state.callCount + 1, lastEvent: StartCalled },
  }

  action loseStartResponse: bool = all {
    state.stage == Called,
    state' = { ...state, stage: ResponseLost, lastEvent: StartResponseLost },
  }

  action observeDirectRunning: bool = all {
    state.stage == Called,
    state' = {
      ...state,
      stage: RunningEvidence,
      evidenceOrdinal: state.activeOrdinal,
      responseCount: state.responseCount + 1,
      lastEvent: DirectRunningObserved,
    },
  }

  action observeProjectedRunning: bool = all {
    state.stage == ResponseLost,
    state' = {
      ...state,
      stage: RunningEvidence,
      evidenceOrdinal: state.activeOrdinal,
      projectionCount: state.projectionCount + 1,
      lastEvent: ProjectedRunningObserved,
    },
  }

  action observeDirectTerminal: bool = all {
    state.stage == Called,
    state' = {
      ...state,
      stage: TerminalEvidence,
      evidenceOrdinal: state.activeOrdinal,
      responseCount: state.responseCount + 1,
      lastEvent: DirectTerminalObserved,
    },
  }

  action settleRunning: bool = all {
    state.stage == RunningEvidence,
    state' = {
      ...state,
      stage: Ready,
      settlementCount: state.settlementCount + 1,
      positionHeld: true,
      lastEvent: StartSettledRunning,
    },
  }

  action settleTerminal: bool = all {
    state.stage == TerminalEvidence,
    state' = {
      ...state,
      stage: Terminal,
      settlementCount: state.settlementCount + 1,
      positionHeld: false,
      lastEvent: StartSettledTerminal,
    },
  }

  action step: bool = any {
    recordStartIntent,
    callStart,
    loseStartResponse,
    observeDirectRunning,
    observeProjectedRunning,
    observeDirectTerminal,
    settleRunning,
    settleTerminal,
  }
}

module plannedAttemptExecutorSuspendBoundProof {
  type Stage = Running | IntentRecorded | Called | ResponseLost | RunningEvidence | SafeEvidence | TerminalEvidence | ReadOnlyRecovery | FreshSafeEvidence | SettledSafe | SettledTerminal
  type Event =
    | Initialized
    | SuspendIntentRecorded
    | SuspendCalled
    | SuspendResponseLost
    | DirectRunningObserved
    | ProjectedRunningObserved
    | DirectSafeObserved
    | DirectTerminalObserved
    | SuspendSettledRunning
    | SuspendSettledSafe
    | SuspendSettledTerminal
    | ReadOnlyRecoveryActivated
    | FreshSafeStateProjected
    | FreshSafeStateAccepted

  type State = {
    stage: Stage,
    intentCount: int,
    callCount: int,
    settlementCount: int,
    nextOrdinal: int,
    activeOrdinal: int,
    evidenceOrdinal: int,
    responseCount: int,
    projectionCount: int,
    readOnlyProjectionCount: int,
    positionHeld: bool,
    lastEvent: Event,
  }

  var state: State
  pure val SUSPEND_LIMIT = 3

  val everySuspendCallHasItsIntent: bool = and {
    state.callCount <= state.intentCount,
    state.intentCount <= SUSPEND_LIMIT,
  }

  val everySuspendSettlementUsesItsOrdinal: bool =
    state.lastEvent != SuspendSettledRunning
      and state.lastEvent != SuspendSettledSafe
      and state.lastEvent != SuspendSettledTerminal
      or state.evidenceOrdinal == state.activeOrdinal

  val lostResponsesStillConsumeSuspendBudget: bool = and {
    state.projectionCount <= state.settlementCount + 1,
    state.projectionCount == state.settlementCount + 1
      implies state.stage == RunningEvidence,
    state.intentCount >= state.projectionCount,
  }

  val suspendLimitBlocksFourthCommand: bool = and {
    state.intentCount <= SUSPEND_LIMIT,
    state.callCount <= SUSPEND_LIMIT,
    state.settlementCount <= SUSPEND_LIMIT,
    state.intentCount == SUSPEND_LIMIT and state.stage == Running
      implies state.nextOrdinal == SUSPEND_LIMIT + 1,
  }

  val postLimitRecoveryIsReadOnly: bool =
    state.readOnlyProjectionCount == 0 or and {
      state.intentCount == SUSPEND_LIMIT,
      state.callCount == SUSPEND_LIMIT,
    }

  val positionReleasesOnlyForSafeOrTerminalEvidence: bool =
    and {
      not(state.positionHeld)
        implies state.stage == SettledSafe or state.stage == SettledTerminal,
      state.stage == SettledSafe or state.stage == SettledTerminal
        implies not(state.positionHeld),
    }

  val suspendProofTypeOk: bool = and {
    state.intentCount >= 0,
    state.callCount >= 0,
    state.settlementCount >= 0,
    state.nextOrdinal >= 1,
    state.nextOrdinal <= SUSPEND_LIMIT + 1,
    state.readOnlyProjectionCount >= 0,
    state.readOnlyProjectionCount <= 1,
  }

  val firstSuspendIntentReached: bool = state.lastEvent == SuspendIntentRecorded and state.intentCount == 1
  val thirdSuspendIntentReached: bool = state.lastEvent == SuspendIntentRecorded and state.intentCount == SUSPEND_LIMIT
  val suspendCalledReached: bool = state.lastEvent == SuspendCalled
  val suspendResponseLostReached: bool = state.lastEvent == SuspendResponseLost
  val directSuspendSettledReached: bool = state.lastEvent == SuspendSettledRunning and state.responseCount > 0
  val projectedSuspendSettledReached: bool = state.lastEvent == SuspendSettledRunning and state.projectionCount > 0
  val thirdSuspendSettledReached: bool = state.settlementCount == SUSPEND_LIMIT
  val safeSuspendReached: bool = state.lastEvent == SuspendSettledSafe
  val terminalSuspendReached: bool = state.lastEvent == SuspendSettledTerminal
  val readOnlyRecoveryReached: bool = state.lastEvent == ReadOnlyRecoveryActivated
  val readOnlySafeReached: bool = state.lastEvent == FreshSafeStateAccepted

  action init: bool = all {
    state' = {
      stage: Running,
      intentCount: 0,
      callCount: 0,
      settlementCount: 0,
      nextOrdinal: 1,
      activeOrdinal: 0,
      evidenceOrdinal: 0,
      responseCount: 0,
      projectionCount: 0,
      readOnlyProjectionCount: 0,
      positionHeld: true,
      lastEvent: Initialized,
    },
  }

  action recordSuspendIntent: bool = all {
    state.stage == Running,
    state.intentCount < SUSPEND_LIMIT,
    state' = {
      ...state,
      stage: IntentRecorded,
      intentCount: state.intentCount + 1,
      activeOrdinal: state.nextOrdinal,
      nextOrdinal: state.nextOrdinal + 1,
      lastEvent: SuspendIntentRecorded,
    },
  }

  action callSuspend: bool = all {
    state.stage == IntentRecorded,
    state' = { ...state, stage: Called, callCount: state.callCount + 1, lastEvent: SuspendCalled },
  }

  action loseSuspendResponse: bool = all {
    state.stage == Called,
    state' = { ...state, stage: ResponseLost, lastEvent: SuspendResponseLost },
  }

  action observeDirectRunning: bool = all {
    state.stage == Called,
    state' = {
      ...state,
      stage: RunningEvidence,
      evidenceOrdinal: state.activeOrdinal,
      responseCount: state.responseCount + 1,
      lastEvent: DirectRunningObserved,
    },
  }

  action observeProjectedRunning: bool = all {
    state.stage == ResponseLost,
    state' = {
      ...state,
      stage: RunningEvidence,
      evidenceOrdinal: state.activeOrdinal,
      projectionCount: state.projectionCount + 1,
      lastEvent: ProjectedRunningObserved,
    },
  }

  action observeDirectSafe: bool = all {
    state.stage == Called,
    state' = {
      ...state,
      stage: SafeEvidence,
      evidenceOrdinal: state.activeOrdinal,
      responseCount: state.responseCount + 1,
      lastEvent: DirectSafeObserved,
    },
  }

  action observeDirectTerminal: bool = all {
    state.stage == Called,
    state' = {
      ...state,
      stage: TerminalEvidence,
      evidenceOrdinal: state.activeOrdinal,
      responseCount: state.responseCount + 1,
      lastEvent: DirectTerminalObserved,
    },
  }

  action settleRunning: bool = all {
    state.stage == RunningEvidence,
    state' = {
      ...state,
      stage: Running,
      settlementCount: state.settlementCount + 1,
      positionHeld: true,
      lastEvent: SuspendSettledRunning,
    },
  }

  action settleSafe: bool = all {
    state.stage == SafeEvidence,
    state' = {
      ...state,
      stage: SettledSafe,
      settlementCount: state.settlementCount + 1,
      positionHeld: false,
      lastEvent: SuspendSettledSafe,
    },
  }

  action settleTerminal: bool = all {
    state.stage == TerminalEvidence,
    state' = {
      ...state,
      stage: SettledTerminal,
      settlementCount: state.settlementCount + 1,
      positionHeld: false,
      lastEvent: SuspendSettledTerminal,
    },
  }

  action activateReadOnlyRecovery: bool = all {
    state.stage == Running,
    state.intentCount == SUSPEND_LIMIT,
    state.settlementCount == SUSPEND_LIMIT,
    state' = { ...state, stage: ReadOnlyRecovery, lastEvent: ReadOnlyRecoveryActivated },
  }

  action recordFreshSafeStateProjection: bool = all {
    state.stage == ReadOnlyRecovery,
    state.readOnlyProjectionCount == 0,
    state' = {
      ...state,
      stage: FreshSafeEvidence,
      readOnlyProjectionCount: 1,
      lastEvent: FreshSafeStateProjected,
    },
  }

  action acceptFreshSafeStateProjection: bool = all {
    state.stage == FreshSafeEvidence,
    state' = {
      ...state,
      stage: SettledSafe,
      positionHeld: false,
      lastEvent: FreshSafeStateAccepted,
    },
  }

  action step: bool = any {
    recordSuspendIntent,
    callSuspend,
    loseSuspendResponse,
    observeDirectRunning,
    observeProjectedRunning,
    observeDirectSafe,
    observeDirectTerminal,
    settleRunning,
    settleSafe,
    settleTerminal,
    activateReadOnlyRecovery,
    recordFreshSafeStateProjection,
    acceptFreshSafeStateProjection,
  }
}
