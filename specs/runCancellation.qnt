// Models the subject-scoped Run cancellation boundary. The Operator's durable
// direction closes later forward admission; existing executor, claim,
// integration, and reconciliation responsibilities must then settle or be
// durably relinquished before this model hands the exact Run to fresh
// activation classification. It does not classify the Run or own application
// Exit, which remain separate decision boundaries.
module runCancellation {
  type RunId = R1 | R2
  type TrackerTarget = Target1 | Target2
  type Actor = Operator | DalphCoordinator

  type ProcessPhase =
    | New
    | Active
    | Cancelling
    | ReadyForClassification
    | ProcessLost
    | Rejected
    | TerminalHistory

  type ExecutorState =
    | NoExecutor
    | Running
    | StopIntentRecorded
    | SafelySuspended
    | ExecutorUnreadable

  type ClaimState =
    | NoClaim
    | Held
    | ReleaseIntentRecorded
    | Released
    | ForeignClaim
    | ClaimUnreadable

  type IntegrationState =
    | NoIntegration
    | IntegrationOwned
    | PromotionIntentRecorded
    | PromotionAccepted
    | IntegrationSettled
    | IntegrationQuarantined
    | IntegrationUnreadable

  type GraphOutcome =
    | NoGraph
    | AllSucceeded
    | NotAllSucceeded
    | TemporaryWait
    | GraphUnreadable

  type TerminalRecord = NoTermination | Completed | Blocked | Cancelled

  type DurableState = {
    runId: RunId,
    target: TrackerTarget,
    cancellationApplied: bool,
    cancellationAppends: int,
    cancellationRedeliveries: int,
    cancellationActor: Actor,
    executor: ExecutorState,
    claim: ClaimState,
    integration: IntegrationState,
    worktreePreserved: bool,
    logsPreserved: bool,
    evidencePreserved: bool,
    executorStopIntents: int,
    executorSafeReports: int,
    claimReleaseIntents: int,
    claimReleaseObservations: int,
    claimReleases: int,
    integrationIntents: int,
    integrationSettlements: int,
    promotionAccepted: bool,
    terminalHistory: TerminalRecord,
    processLosses: int,
    classificationReads: int,
  }

  // This state is recreated after process loss. It describes no outside
  // authority and cannot replace the durable intent or owning boundary facts.
  type ProcessState = {
    phase: ProcessPhase,
    requestedRunId: RunId,
    requestedTarget: TrackerTarget,
    admissionOpen: bool,
    exitCutoff: bool,
    executorPositionHeld: bool,
    responsibilitiesSettled: bool,
    graphRead: bool,
    graph: GraphOutcome,
    forwardAdmissions: int,
    freshAfterRestart: bool,
    cancellationRejected: bool,
  }

  type State = {
    durable: DurableState,
    process: ProcessState,
  }

  var state: State

  pure def noOutstandingResponsibility(durable: DurableState): bool = and {
    durable.executor == NoExecutor or durable.executor == SafelySuspended,
    durable.claim == NoClaim or durable.claim == Released or durable.claim == ForeignClaim,
    durable.integration == NoIntegration or durable.integration == IntegrationSettled,
  }

  pure def executorSafeForRelease(executor: ExecutorState): bool = or {
    executor == SafelySuspended,
    executor == NoExecutor,
  }

  pure def cancellationCanHandoff(durable: DurableState, process: ProcessState): bool = and {
    durable.cancellationApplied,
    noOutstandingResponsibility(durable),
    process.responsibilitiesSettled,
    process.graphRead,
    process.graph != TemporaryWait,
    process.graph != GraphUnreadable,
    process.graph != NoGraph,
  }

  pure def resetAfterProcessLoss(durable: DurableState): ProcessState = {
    phase: ProcessLost,
    requestedRunId: durable.runId,
    requestedTarget: durable.target,
    admissionOpen: false,
    exitCutoff: false,
    executorPositionHeld: durable.executor != NoExecutor
      and durable.executor != SafelySuspended,
    responsibilitiesSettled: noOutstandingResponsibility(durable),
    graphRead: false,
    graph: NoGraph,
    forwardAdmissions: 0,
    freshAfterRestart: false,
    cancellationRejected: false,
  }

  val exactRunAndOperatorDirection: bool =
    not(state.durable.cancellationApplied)
      or and {
        state.durable.runId == state.process.requestedRunId,
        state.durable.target == state.process.requestedTarget,
        state.durable.cancellationActor == Operator,
      }

  val cancellationAppliedAtMostOnce: bool = state.durable.cancellationAppends <= 1

  val cancellationClosesForwardAdmission: bool =
    not(state.durable.cancellationApplied) or not(state.process.admissionOpen)

  val cancellationPreservesWorkInProgress: bool =
    not(state.durable.cancellationApplied)
      or and {
        state.durable.worktreePreserved,
        state.durable.logsPreserved,
        state.durable.evidencePreserved,
      }

  val executorStopIntentPrecedesSafeReport: bool =
    state.durable.executorSafeReports == 0 or state.durable.executorStopIntents == 1

  val executorPositionRetainedUntilSafeReport: bool =
    state.durable.executor == Running
      or state.durable.executor == StopIntentRecorded
      or state.durable.executor == ExecutorUnreadable
      or not(state.process.executorPositionHeld)

  val claimReleaseFollowsSafeExecutor: bool =
    state.durable.claimReleaseIntents == 0
      or executorSafeForRelease(state.durable.executor)

  val claimReleaseIsExactAndBounded: bool = and {
    state.durable.claimReleaseIntents <= 1,
    state.durable.claimReleaseObservations <= 1,
    state.durable.claimReleases <= 1,
    state.durable.claimReleases <= state.durable.claimReleaseIntents,
  }

  val integrationSettlementNeverRollsBackPromotion: bool =
    not(state.durable.promotionAccepted)
      or state.durable.integration == PromotionAccepted
      or state.durable.integration == IntegrationSettled

  val integrationResourceSettlesOnce: bool = state.durable.integrationSettlements <= 1

  val ambiguousExecutorRetainsResponsibility: bool =
    state.durable.executor != ExecutorUnreadable
      or and {
        state.process.executorPositionHeld,
        not(state.process.responsibilitiesSettled),
      }

  val ambiguousIntegrationRetainsResponsibility: bool =
    state.durable.integration != IntegrationUnreadable
      and state.durable.integration != IntegrationQuarantined
      or not(state.process.responsibilitiesSettled)

  val restartReusesAppliedCancellation: bool =
    state.process.phase != ProcessLost
      or state.durable.cancellationApplied
      or state.durable.terminalHistory != NoTermination

  val restartRequiresFreshClassificationGraph: bool =
    not(state.process.freshAfterRestart)
      or state.process.phase != ReadyForClassification
      or state.durable.classificationReads >= 1

  val handoffRequiresSettledResponsibilities: bool =
    state.process.phase != ReadyForClassification
      or and {
        state.process.responsibilitiesSettled,
        noOutstandingResponsibility(state.durable),
      }

  val handoffRequiresFreshGraph: bool =
    state.process.phase != ReadyForClassification or state.process.graphRead

  val temporaryWaitDoesNotClassifyCancellation: bool =
    state.process.graph != TemporaryWait or state.process.phase != ReadyForClassification

  val applicationExitCutoffRejectsCancellation: bool =
    not(state.process.exitCutoff) or not(state.durable.cancellationApplied)

  val terminalHistoryCannotReopen: bool =
    state.durable.terminalHistory == NoTermination
      or state.process.phase == TerminalHistory

  val modelIsFiniteAndBounded: bool = and {
    state.durable.cancellationAppends >= 0,
    state.durable.cancellationAppends <= 1,
    state.durable.cancellationRedeliveries >= 0,
    state.durable.cancellationRedeliveries <= 1,
    state.durable.executorStopIntents >= 0,
    state.durable.executorStopIntents <= 1,
    state.durable.executorSafeReports >= 0,
    state.durable.executorSafeReports <= 1,
    state.durable.claimReleaseIntents >= 0,
    state.durable.claimReleaseIntents <= 1,
    state.durable.claimReleaseObservations >= 0,
    state.durable.claimReleaseObservations <= 1,
    state.durable.claimReleases >= 0,
    state.durable.claimReleases <= 1,
    state.durable.integrationIntents >= 0,
    state.durable.integrationIntents <= 1,
    state.durable.integrationSettlements >= 0,
    state.durable.integrationSettlements <= 1,
    state.durable.processLosses >= 0,
    state.durable.processLosses <= 1,
    state.durable.classificationReads >= 0,
    state.durable.classificationReads <= 2,
    state.process.forwardAdmissions >= 0,
    state.process.forwardAdmissions <= 1,
  }

  val idleCancellationAppliedReached: bool =
    state.durable.cancellationApplied
      and state.durable.executor == NoExecutor
      and state.durable.integration == NoIntegration
  val cancellationRedeliveryReached: bool = state.durable.cancellationRedeliveries == 1
  val runningExecutorCancellationReached: bool =
    state.durable.cancellationApplied and state.durable.executorStopIntents == 1
  val executorStopIntentReached: bool = state.durable.executorStopIntents == 1
  val executorSafeReportReached: bool = state.durable.executorSafeReports == 1
  val claimReleaseIntentReached: bool = state.durable.claimReleaseIntents == 1
  val claimReleasedReached: bool = state.durable.claimReleases == 1
  val integrationOwnedCancellationReached: bool =
    state.durable.cancellationApplied and state.durable.integrationIntents == 1
  val promotionAcceptedReached: bool = state.durable.promotionAccepted
  val integrationSettledReached: bool = state.durable.integration == IntegrationSettled
  val executorAmbiguityReached: bool = state.durable.executor == ExecutorUnreadable
  val integrationAmbiguityReached: bool = state.durable.integration == IntegrationUnreadable
  val processLossBeforeSettlementReached: bool = state.durable.processLosses == 1
  val restartedCancellationReached: bool =
    state.durable.processLosses == 1 and state.process.freshAfterRestart
  val freshClassificationGraphReached: bool = state.process.graphRead
  val cancellationHandoffReached: bool = state.process.phase == ReadyForClassification
  val temporaryWaitReached: bool = state.process.graph == TemporaryWait
  val applicationExitWinsReached: bool = state.process.exitCutoff and state.process.cancellationRejected
  val foreignCancellationRejectedReached: bool =
    state.process.cancellationRejected and state.process.requestedRunId == R2
  val terminalHistoryRejectedReached: bool = state.process.phase == TerminalHistory

  action init: bool = all {
    state' = {
      durable: {
        runId: R1,
        target: Target1,
        cancellationApplied: false,
        cancellationAppends: 0,
        cancellationRedeliveries: 0,
        cancellationActor: Operator,
        executor: NoExecutor,
        claim: NoClaim,
        integration: NoIntegration,
        worktreePreserved: true,
        logsPreserved: true,
        evidencePreserved: true,
        executorStopIntents: 0,
        executorSafeReports: 0,
        claimReleaseIntents: 0,
        claimReleaseObservations: 0,
        claimReleases: 0,
        integrationIntents: 0,
        integrationSettlements: 0,
        promotionAccepted: false,
        terminalHistory: NoTermination,
        processLosses: 0,
        classificationReads: 0,
      },
      process: {
        phase: Active,
        requestedRunId: R1,
        requestedTarget: Target1,
        admissionOpen: true,
        exitCutoff: false,
        executorPositionHeld: false,
        responsibilitiesSettled: true,
        graphRead: false,
        graph: NotAllSucceeded,
        forwardAdmissions: 0,
        freshAfterRestart: false,
        cancellationRejected: false,
      },
    },
  }

  action selectIdleRun: bool = all {
    state.process.phase == Active,
    state.durable.cancellationAppends == 0,
    state' = {
      ...state,
      process: {
        ...state.process,
        executorPositionHeld: false,
        responsibilitiesSettled: true,
        graph: NotAllSucceeded,
      },
    },
  }

  action selectRunningExecutor: bool = all {
    state.process.phase == Active,
    state.durable.cancellationAppends == 0,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        executor: Running,
        claim: Held,
        integration: NoIntegration,
      },
      process: {
        ...state.process,
        executorPositionHeld: true,
        responsibilitiesSettled: false,
      },
    },
  }

  action selectIntegrationOwned: bool = all {
    state.process.phase == Active,
    state.durable.cancellationAppends == 0,
    state' = {
      ...state,
      durable: { ...state.durable, integration: IntegrationOwned },
      process: { ...state.process, responsibilitiesSettled: false },
    },
  }

  action selectTemporaryWait: bool = all {
    state.process.phase == Active,
    state' = { ...state, process: { ...state.process, graph: TemporaryWait } },
  }

  action selectApplicationExitCutoff: bool = all {
    state.process.phase == Active,
    state' = { ...state, process: { ...state.process, exitCutoff: true } },
  }

  action selectForeignRunRequest: bool = all {
    state.process.phase == Active,
    state' = { ...state, process: { ...state.process, requestedRunId: R2 } },
  }

  action selectTerminalHistory: bool = all {
    state.process.phase == Active,
    state' = {
      ...state,
      durable: { ...state.durable, terminalHistory: Cancelled },
      process: { ...state.process, phase: TerminalHistory, admissionOpen: false },
    },
  }

  action applyCancellation: bool = all {
    state.process.phase == Active,
    state.process.admissionOpen,
    not(state.process.exitCutoff),
    state.process.requestedRunId == state.durable.runId,
    state.process.requestedTarget == state.durable.target,
    not(state.durable.cancellationApplied),
    state.durable.terminalHistory == NoTermination,
    state.durable.cancellationAppends == 0,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        cancellationApplied: true,
        cancellationAppends: state.durable.cancellationAppends + 1,
      },
      process: {
        ...state.process,
        phase: Cancelling,
        admissionOpen: false,
        cancellationRejected: false,
      },
    },
  }

  action redeliverCancellation: bool = all {
    state.durable.cancellationApplied,
    state.durable.cancellationAppends == 1,
    state.durable.cancellationRedeliveries == 0,
    state.process.phase == Cancelling,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        cancellationRedeliveries: state.durable.cancellationRedeliveries + 1,
      },
    },
  }

  action recordExecutorStopIntent: bool = all {
    state.process.phase == Cancelling,
    state.durable.executor == Running,
    state.durable.executorStopIntents == 0,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        executor: StopIntentRecorded,
        executorStopIntents: state.durable.executorStopIntents + 1,
      },
      process: { ...state.process, executorPositionHeld: true },
    },
  }

  action reportExecutorSafe: bool = all {
    state.process.phase == Cancelling,
    state.durable.executor == StopIntentRecorded,
    state.durable.executorStopIntents == 1,
    state.durable.executorSafeReports == 0,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        executor: SafelySuspended,
        executorSafeReports: state.durable.executorSafeReports + 1,
      },
      process: { ...state.process, executorPositionHeld: false },
    },
  }

  action recordClaimReleaseIntent: bool = all {
    state.process.phase == Cancelling,
    executorSafeForRelease(state.durable.executor),
    state.durable.claim == Held,
    state.durable.claimReleaseIntents == 0,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        claim: ReleaseIntentRecorded,
        claimReleaseIntents: state.durable.claimReleaseIntents + 1,
      },
    },
  }

  action observeAndReleaseClaim: bool = all {
    state.process.phase == Cancelling,
    executorSafeForRelease(state.durable.executor),
    state.durable.claim == ReleaseIntentRecorded,
    state.durable.claimReleaseObservations == 0,
    state.durable.claimReleases == 0,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        claim: Released,
        claimReleaseObservations: state.durable.claimReleaseObservations + 1,
        claimReleases: state.durable.claimReleases + 1,
      },
    },
  }

  action recordIntegrationIntent: bool = all {
    state.process.phase == Cancelling,
    state.durable.integration == IntegrationOwned,
    state.durable.integrationIntents == 0,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        integration: PromotionIntentRecorded,
        integrationIntents: state.durable.integrationIntents + 1,
      },
    },
  }

  action observePromotedIntegration: bool = all {
    state.process.phase == Cancelling,
    state.durable.integration == PromotionIntentRecorded,
    state.durable.integrationIntents == 1,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        integration: PromotionAccepted,
        promotionAccepted: true,
      },
    },
  }

  action settlePromotedIntegration: bool = all {
    state.process.phase == Cancelling,
    state.durable.integration == PromotionAccepted,
    state.durable.integrationSettlements == 0,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        integration: IntegrationSettled,
        integrationSettlements: state.durable.integrationSettlements + 1,
      },
    },
  }

  action readFreshClassificationGraph: bool = all {
    state.process.phase == Cancelling,
    noOutstandingResponsibility(state.durable),
    state.process.responsibilitiesSettled,
    not(state.process.graphRead),
    state.process.graph != NoGraph,
    state.process.graph != GraphUnreadable,
    state' = {
      ...state,
      durable: { ...state.durable, classificationReads: state.durable.classificationReads + 1 },
      process: { ...state.process, graphRead: true },
    },
  }

  action handoffToFreshClassification: bool = all {
    state.process.phase == Cancelling,
    cancellationCanHandoff(state.durable, state.process),
    state' = { ...state, process: { ...state.process, phase: ReadyForClassification } },
  }

  action crashBeforeSettlement: bool = all {
    state.process.phase == Cancelling,
    state.durable.processLosses == 0,
    not(noOutstandingResponsibility(state.durable)),
    state' = {
      ...state,
      durable: { ...state.durable, processLosses: state.durable.processLosses + 1 },
      process: resetAfterProcessLoss(state.durable),
    },
  }

  action restartCancellation: bool = all {
    state.process.phase == ProcessLost,
    state.durable.cancellationApplied,
    state' = {
      ...state,
      process: {
        ...state.process,
        phase: Cancelling,
        admissionOpen: false,
        freshAfterRestart: true,
        graph: NotAllSucceeded,
      },
    },
  }

  // Recovery reconciles the exact owner instead of issuing a second stop.
  action reconcileExecutorAfterRestart: bool = all {
    state.process.phase == Cancelling,
    state.process.freshAfterRestart,
    state.durable.executor == StopIntentRecorded,
    state' = {
      ...state,
      durable: { ...state.durable, executor: SafelySuspended, executorSafeReports: 1 },
      process: { ...state.process, executorPositionHeld: false },
    },
  }

  action reconcileClaimAfterRestart: bool = all {
    state.process.phase == Cancelling,
    state.process.freshAfterRestart,
    state.durable.claim == ReleaseIntentRecorded,
    state.durable.executor == SafelySuspended,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        claim: Released,
        claimReleaseObservations: 1,
        claimReleases: 1,
      },
    },
  }

  action reconcileIntegrationAfterRestart: bool = all {
    state.process.phase == Cancelling,
    state.process.freshAfterRestart,
    state.durable.integration == PromotionIntentRecorded,
    state' = {
      ...state,
      durable: { ...state.durable, integration: PromotionAccepted, promotionAccepted: true },
    },
  }

  action settleAfterIdleCancellation: bool = all {
    state.process.phase == Cancelling,
    noOutstandingResponsibility(state.durable),
    state' = { ...state, process: { ...state.process, responsibilitiesSettled: true } },
  }

  action markExecutorUnreadable: bool = all {
    state.process.phase == Cancelling,
    state.durable.executor == StopIntentRecorded,
    state' = {
      ...state,
      durable: { ...state.durable, executor: ExecutorUnreadable },
      process: { ...state.process, executorPositionHeld: true, responsibilitiesSettled: false },
    },
  }

  action markIntegrationUnreadable: bool = all {
    state.process.phase == Cancelling,
    state.durable.integration == PromotionIntentRecorded,
    state' = {
      ...state,
      durable: { ...state.durable, integration: IntegrationUnreadable },
      process: { ...state.process, responsibilitiesSettled: false },
    },
  }

  action readTemporaryWaitGraph: bool = all {
    state.process.phase == Cancelling,
    noOutstandingResponsibility(state.durable),
    state.process.responsibilitiesSettled,
    state.process.graph == TemporaryWait,
    not(state.process.graphRead),
    state' = {
      ...state,
      durable: { ...state.durable, classificationReads: state.durable.classificationReads + 1 },
      process: { ...state.process, graphRead: true },
    },
  }

  action rejectCancellationAtExit: bool = all {
    state.process.phase == Active,
    state.process.exitCutoff,
    not(state.durable.cancellationApplied),
    state' = {
      ...state,
      process: { ...state.process, phase: Rejected, cancellationRejected: true },
    },
  }

  action rejectForeignCancellation: bool = all {
    state.process.phase == Active,
    state.process.requestedRunId == R2,
    state.durable.runId == R1,
    not(state.durable.cancellationApplied),
    state' = {
      ...state,
      process: { ...state.process, phase: Rejected, cancellationRejected: true },
    },
  }

  action rejectTerminalHistory: bool = all {
    state.process.phase == TerminalHistory,
    state.durable.terminalHistory != NoTermination,
    state' = state,
  }

  action admitForwardWork: bool = all {
    state.process.phase == Active,
    state.process.admissionOpen,
    not(state.durable.cancellationApplied),
    state.process.forwardAdmissions == 0,
    state' = {
      ...state,
      process: { ...state.process, forwardAdmissions: state.process.forwardAdmissions + 1 },
    },
  }

  action step: bool = any {
    selectIdleRun,
    selectRunningExecutor,
    selectIntegrationOwned,
    selectTemporaryWait,
    selectApplicationExitCutoff,
    selectForeignRunRequest,
    selectTerminalHistory,
    applyCancellation,
    redeliverCancellation,
    recordExecutorStopIntent,
    reportExecutorSafe,
    recordClaimReleaseIntent,
    observeAndReleaseClaim,
    recordIntegrationIntent,
    observePromotedIntegration,
    settlePromotedIntegration,
    readFreshClassificationGraph,
    readTemporaryWaitGraph,
    handoffToFreshClassification,
    crashBeforeSettlement,
    restartCancellation,
    reconcileExecutorAfterRestart,
    reconcileClaimAfterRestart,
    reconcileIntegrationAfterRestart,
    settleAfterIdleCancellation,
    markExecutorUnreadable,
    markIntegrationUnreadable,
    rejectCancellationAtExit,
    rejectForeignCancellation,
    rejectTerminalHistory,
    admitForwardWork,
  }
}
