// Deliberately illegal transitions show that every planned-attempt executor
// proof safety family can turn red. They are negative controls, not behavior.
module plannedAttemptExecutorEvidenceProofNegativeTest {
  import plannedAttemptExecutorEvidenceProof.* from "./plannedAttemptExecutor_proof"

  action callWithoutIntent: bool = all {
    state.stage == ResponsibilityHeld,
    state' = { ...state, callCount: 1, lastEvent: ExecutorCalled },
  }

  action countProjectionAsResponse: bool = all {
    state.stage == CommandProjectionObserved,
    state' = { ...state, directResponseCount: 1 },
  }

  action settleWrongOrdinal: bool = all {
    state.stage == CommandProjectionObserved,
    state' = {
      ...state,
      stage: Settled,
      evidenceOrdinal: state.intendedOrdinal + 1,
      settlementCount: 1,
      lastEvent: CommandProjectionSettled,
    },
  }

  action settleWrongCorrelation: bool = all {
    state.stage == DirectResponseObserved,
    state' = {
      ...state,
      stage: Settled,
      evidenceCorrelation: ForeignCorrelation,
      settlementCount: 1,
      lastEvent: DirectResponseSettled,
    },
  }

  action settleCommandFromFreshStateProjection: bool = all {
    state.stage == FreshStateProjectionObserved,
    state' = {
      ...state,
      stage: Settled,
      intendedOrdinal: 1,
      callCount: 1,
      settlementCount: 1,
      positionHeld: false,
      lastEvent: FreshStateProjectionAccepted,
    },
  }

  action takeSecondReadInActivation: bool = all {
    state.reconciliationReadsThisActivation == 1,
    state' = { ...state, reconciliationReadsThisActivation: 2 },
  }

  action releaseFromUnavailableProjection: bool = all {
    state.stage == ResponseLost,
    state' = { ...state, positionHeld: false },
  }

  action retainPositionAfterSafeSettlement: bool = all {
    state.stage == DirectResponseObserved,
    state.report == SafelySuspendedReport,
    state' = {
      ...state,
      stage: Settled,
      settlementCount: 1,
      positionHeld: true,
      lastEvent: DirectResponseSettled,
    },
  }

  run callWithoutIntentIsDetectedTest = {
    init.then(callWithoutIntent).expect(not(everyCallHasDurableIntent))
  }

  run responseProjectionConfusionIsDetectedTest = {
    init.then(recordStartIntent).then(callExecutor).then(loseResponse)
      .then(recordExactCommandProjection(RunningReport)).then(countProjectionAsResponse)
      .expect(not(directResponsesAndProjectionsStayDistinct))
  }

  run wrongOrdinalIsDetectedTest = {
    init.then(recordStartIntent).then(callExecutor).then(loseResponse)
      .then(recordExactCommandProjection(RunningReport)).then(settleWrongOrdinal)
      .expect(not(settlementUsesExactOrdinalAndCorrelation))
  }

  run wrongCorrelationIsDetectedTest = {
    init.then(recordSuspendIntent).then(callExecutor)
      .then(recordDirectResponse(RunningReport)).then(settleWrongCorrelation)
      .expect(not(settlementUsesExactOrdinalAndCorrelation))
  }

  run freshStateProjectionSettlementIsDetectedTest = {
    init.then(recordFreshSafeStateProjection).then(settleCommandFromFreshStateProjection)
      .expect(not(freshStateProjectionNeverSettlesCommand))
  }

  run secondReadInOneActivationIsDetectedTest = {
    init.then(recordStartIntent).then(callExecutor).then(loseResponse)
      .then(recordUnavailableCommandProjection).then(takeSecondReadInActivation)
      .expect(not(oneReconciliationReadPerActivation))
  }

  run unavailableEvidenceReleaseIsDetectedTest = {
    init.then(recordStartIntent).then(callExecutor).then(loseResponse)
      .then(releaseFromUnavailableProjection)
      .expect(and {
        not(ambiguousOrUnavailableEvidenceRetainsPosition),
        not(positionReleasesOnlyForSafeOrTerminalEvidence),
      })
  }


  run retainedPositionAfterSafeEvidenceIsDetectedTest = {
    init.then(recordSuspendIntent).then(callExecutor)
      .then(recordDirectResponse(SafelySuspendedReport)).then(retainPositionAfterSafeSettlement)
      .expect(not(positionReleasesOnlyForSafeOrTerminalEvidence))
  }
}

module plannedAttemptExecutorStartBoundProofNegativeTest {
  import plannedAttemptExecutorStartBoundProof.* from "./plannedAttemptExecutor_proof"

  action fourthStartIntent: bool = all {
    state.stage == Ready,
    state.intentCount == START_LIMIT,
    state' = {
      ...state,
      stage: IntentRecorded,
      intentCount: state.intentCount + 1,
      activeOrdinal: state.nextOrdinal,
      nextOrdinal: state.nextOrdinal + 1,
      lastEvent: StartIntentRecorded,
    },
  }

  action loseResponseWithoutConsumingBudget: bool = all {
    state.stage == RunningEvidence,
    state.projectionCount > 0,
    state' = { ...state, intentCount: state.intentCount - 1 },
  }

  action releaseOnRunningStart: bool = all {
    state.stage == RunningEvidence,
    state' = { ...state, stage: Ready, positionHeld: false },
  }


  action retainPositionAfterTerminalStart: bool = all {
    state.stage == TerminalEvidence,
    state' = { ...state, stage: Terminal, positionHeld: true },
  }

  run fourthStartIsDetectedTest = {
    init
      .then(recordStartIntent).then(callStart).then(observeDirectRunning).then(settleRunning)
      .then(recordStartIntent).then(callStart).then(observeDirectRunning).then(settleRunning)
      .then(recordStartIntent).then(callStart).then(observeDirectRunning).then(settleRunning)
      .then(fourthStartIntent)
      .expect(not(startLimitBlocksFourthCommand) and not(startProofTypeOk))
  }

  run lostStartResponseBudgetEvasionIsDetectedTest = {
    init.then(recordStartIntent).then(callStart).then(loseStartResponse)
      .then(observeProjectedRunning).then(loseResponseWithoutConsumingBudget)
      .expect(not(lostResponsesStillConsumeStartBudget))
  }

  run runningStartCannotReleasePositionTest = {
    init.then(recordStartIntent).then(callStart).then(observeDirectRunning)
      .then(releaseOnRunningStart).expect(not(terminalStartReleasesPosition))
  }


  run terminalStartMustReleasePositionTest = {
    init.then(recordStartIntent).then(callStart).then(observeDirectTerminal)
      .then(retainPositionAfterTerminalStart).expect(not(terminalStartReleasesPosition))
  }
}

module plannedAttemptExecutorSuspendBoundProofNegativeTest {
  import plannedAttemptExecutorSuspendBoundProof.* from "./plannedAttemptExecutor_proof"

  action fourthSuspendIntent: bool = all {
    state.stage == Running,
    state.intentCount == SUSPEND_LIMIT,
    state' = {
      ...state,
      stage: IntentRecorded,
      intentCount: state.intentCount + 1,
      activeOrdinal: state.nextOrdinal,
      nextOrdinal: state.nextOrdinal + 1,
      lastEvent: SuspendIntentRecorded,
    },
  }

  action callDuringReadOnlyRecovery: bool = all {
    state.stage == ReadOnlyRecovery,
    state' = { ...state, callCount: state.callCount + 1 },
  }

  action releaseOnRunningSuspend: bool = all {
    state.stage == RunningEvidence,
    state' = { ...state, stage: Running, positionHeld: false },
  }


  action retainPositionAfterSafeSuspend: bool = all {
    state.stage == SafeEvidence,
    state' = { ...state, stage: SettledSafe, positionHeld: true },
  }

  run fourthSuspendIsDetectedTest = {
    init
      .then(recordSuspendIntent).then(callSuspend).then(observeDirectRunning).then(settleRunning)
      .then(recordSuspendIntent).then(callSuspend).then(observeDirectRunning).then(settleRunning)
      .then(recordSuspendIntent).then(callSuspend).then(observeDirectRunning).then(settleRunning)
      .then(fourthSuspendIntent)
      .expect(not(suspendLimitBlocksFourthCommand) and not(suspendProofTypeOk))
  }

  run postLimitRecoveryCommandIsDetectedTest = {
    init
      .then(recordSuspendIntent).then(callSuspend).then(observeDirectRunning).then(settleRunning)
      .then(recordSuspendIntent).then(callSuspend).then(observeDirectRunning).then(settleRunning)
      .then(recordSuspendIntent).then(callSuspend).then(observeDirectRunning).then(settleRunning)
      .then(activateReadOnlyRecovery).then(callDuringReadOnlyRecovery)
      .then(recordFreshSafeStateProjection)
      .expect(not(postLimitRecoveryIsReadOnly))
  }

  run runningSuspendCannotReleasePositionTest = {
    init.then(recordSuspendIntent).then(callSuspend).then(observeDirectRunning)
      .then(releaseOnRunningSuspend).expect(not(positionReleasesOnlyForSafeOrTerminalEvidence))
  }


  run safeSuspendMustReleasePositionTest = {
    init.then(recordSuspendIntent).then(callSuspend).then(observeDirectSafe)
      .then(retainPositionAfterSafeSuspend)
      .expect(not(positionReleasesOnlyForSafeOrTerminalEvidence))
  }
}
