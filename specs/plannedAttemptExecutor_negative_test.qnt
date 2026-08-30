// Mutation controls: each illegal transition must turn a named safety claim red.
module plannedAttemptExecutorNegativeTest {
  import plannedAttemptExecutor.* from "./plannedAttemptExecutor"

  action callWithoutIntent: bool = all {
    state.status == ResponsibilityBegan,
    state' = { ...state, commandCallCount: state.commandCallCount + 1, lastAction: BeginCalledAction },
  }

  action recordSecondBegin: bool = all {
    state.beginEverIntended,
    isNoCommand(state.commandState),
    state' = { ...state, beginIntentsSinceSafeSuspension: 2, commandIntentCount: state.commandIntentCount + 1, nextCommandOrdinal: state.nextCommandOrdinal + 1 },
  }

  action resumeWithoutSafeReport: bool = all {
    state.status == StatusExecuting,
    state' = { ...state, lastAction: ResumeIntentRecordedAction },
  }

  action consumeAcceptedSafeReportTwice: bool = all {
    state.status == StatusSafelySuspended,
    state.resumeIntentsSinceSafeSuspension == 1,
    state' = { ...state, resumeIntentsSinceSafeSuspension: 2 },
  }

  action countCommandResponseAsSecondLifecycleReport: bool = all {
    state.status == StatusExecuting,
    boundaryResponseReport(state.evidence) == ExecutorWorkExecuting,
    state' = { ...state, acceptedReportOrdinal: state.acceptedReportOrdinal + 1 },
  }

  action persistAndAuthorizeUnchangedExecutingObservation: bool = all {
    state.status == StatusExecuting,
    state.lastAction == UnchangedExactReportObservedAction,
    state' = { ...state, acceptedReportOrdinal: state.acceptedReportOrdinal + 1, durableObservationCount: state.durableObservationCount + 1, proposalIdentityCount: state.proposalIdentityCount + 1, commandIntentCount: state.commandIntentCount + 1, commandCallCount: state.commandCallCount + 1, nextCommandOrdinal: state.nextCommandOrdinal + 1 },
  }

  action leaveTerminalAfterAcceptance: bool = all {
    state.status == StatusTerminal,
    state.terminalReportEverAccepted,
    state' = { ...state, status: StatusExecuting },
  }

  action releaseFromUnavailableObservation: bool = all {
    freshObservation(state.evidence) == ExecutorStateTemporarilyUnavailable,
    state' = { ...state, positionHeld: false },
  }

  action recordFourthSuspend: bool = all {
    state.suspendIntentsSinceExecuting == SUSPEND_COMMAND_LIMIT,
    state' = { ...state, suspendIntentsSinceExecuting: state.suspendIntentsSinceExecuting + 1 },
  }

  action acceptPassiveExecutingAfterSafe: bool = all {
    state.status == StatusSafelySuspended,
    state.resumeIntentsSinceSafeSuspension == 0,
    state' = { ...applyDistinctReport(state, ExecutorWorkExecuting), lastAction: FreshStateAcceptedAction },
  }

  action acceptFirstPassiveReportWithoutBegin: bool = all {
    state.status == ResponsibilityBegan,
    state' = { ...applyDistinctReport(state, ExecutorWorkExecuting), lastAction: FreshStateAcceptedAction },
  }

  action acceptPassiveSafeWithoutSuspend: bool = all {
    state.status == StatusExecuting,
    state.suspendIntentsSinceExecuting == 0,
    state' = {
      ...applyDistinctReport(state, ExecutorWorkSafelySuspended),
      suspendIntentsSinceExecutingBeforeEvidence: 0,
      lastAction: FreshStateAcceptedAction,
    },
  }

  action settleBeginWithSafeReport: bool = all {
    activeCommand(state.commandState).kind == BeginCommand,
    boundaryResponseReport(state.evidence) == ExecutorWorkSafelySuspended,
    state' = {
      ...applyDistinctReport(state, ExecutorWorkSafelySuspended),
      commandState: NoCommand,
      evidence: NoEvidence,
      commandSettlementCount: state.commandSettlementCount + 1,
      commandResponseSettlementCount: state.commandResponseSettlementCount + 1,
      lastAction: ResponseSettledAction,
    },
  }

  action retryLostSuspendWithoutReconciliation: bool = all {
    state.responseAmbiguous,
    activeCommand(state.commandState).kind == SuspendCommand,
    state' = {
      ...state,
      commandIntentCount: state.commandIntentCount + 1,
      nextCommandOrdinal: state.nextCommandOrdinal + 1,
      suspendCommandIntentCount: state.suspendCommandIntentCount + 1,
      suspendIntentsSinceExecuting: state.suspendIntentsSinceExecuting + 1,
      lastAction: SuspendIntentRecordedAction,
    },
  }

  // These mutations bypass the production evidence constructors to prove that
  // an exact-looking report cannot settle foreign or stale command evidence.
  action recordForeignCorrelationCommandProjection(foreignCorrelation: Correlation): bool = all {
    isCalled(state.commandState),
    state.responseAmbiguous,
    state.evidence == NoEvidence,
    state.reconciliationProjectionsThisActivation == 0,
    state' = {
      ...state,
      evidence: CommandProjectionEvidence({ correlation: foreignCorrelation, commandOrdinal: activeCommand(state.commandState).commandOrdinal, outcome: CommandProjectionExactExecuting }),
      positionHeldBeforeEvidence: state.positionHeld,
      acceptedReportOrdinalBeforeEvidence: state.acceptedReportOrdinal,
      reconciliationProjectionsThisActivation: 1,
      lastAction: CommandProjectedAction,
    },
  }

  action recordWrongOrdinalCommandProjection: bool = all {
    isCalled(state.commandState),
    state.responseAmbiguous,
    state.evidence == NoEvidence,
    state.reconciliationProjectionsThisActivation == 0,
    state' = {
      ...state,
      evidence: CommandProjectionEvidence({ correlation: PLANNED_CORRELATION, commandOrdinal: activeCommand(state.commandState).commandOrdinal + 1, outcome: CommandProjectionExactExecuting }),
      positionHeldBeforeEvidence: state.positionHeld,
      acceptedReportOrdinalBeforeEvidence: state.acceptedReportOrdinal,
      reconciliationProjectionsThisActivation: 1,
      lastAction: CommandProjectedAction,
    },
  }

  run callWithoutIntentIsDetectedTest = {
    init.then(beginResponsibility).then(callWithoutIntent).expect(not(everyCallHasOneDurableIntent))
  }

  run secondBeginIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSecondBegin).expect(not(beginOccursAtMostOnce))
  }

  run resumeWithoutSafeReportIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(resumeWithoutSafeReport).expect(not(resumeRequiresAcceptedSafeReport))
  }

  run secondResumeAgainstSameSafeReportIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(callResume)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(consumeAcceptedSafeReportTwice).expect(not(acceptedSafeReportAuthorizesAtMostOneResume))
  }

  run commandResponseCannotManufactureReportOrdinalTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend).then(receiveCommandResponse(ExecutorWorkExecuting))
      .then(countCommandResponseAsSecondLifecycleReport)
      .expect(not(unsettledEvidenceDoesNotAppendReport))
  }

  run unchangedObservationMutationIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordFreshStateProjection(ExecutorStateExecuting))
      .then(persistAndAuthorizeUnchangedExecutingObservation)
      .expect(and {
        not(unchangedExactObservationDoesNotAppendReport),
        not(unchangedExactObservationIsProcessLocal),
      })
  }

  run terminalAbsorptionMutationIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordFreshStateProjection(ExecutorStateTerminal)).then(acceptFreshStateProjectionProof)
      .then(leaveTerminalAfterAcceptance).expect(not(terminalAcceptedStatusIsAbsorbing))
  }

  run unavailableReleaseIsDetectedTest = {
    init.then(beginResponsibility).then(recordFreshStateProjection(ExecutorStateTemporarilyUnavailable))
      .then(releaseFromUnavailableObservation).expect(not(unsafeOrUnavailableNeverReleasesPosition))
  }

  run fourthSuspendIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend).then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend).then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend).then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordFourthSuspend).expect(not(suspendCommandLimitPreserved))
  }


  run passiveSafeToExecutingMutationIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(acceptPassiveExecutingAfterSafe).expect(not(safeToExecutingRequiresResume))
  }

  run firstPassiveReportWithoutBeginIsDetectedTest = {
    init.then(beginResponsibility)
      .then(acceptFirstPassiveReportWithoutBegin)
      .expect(not(passiveReportAcceptanceHasCausalCommand))
  }

  run passiveSafeWithoutSuspendIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(acceptPassiveSafeWithoutSuspend)
      .expect(not(passiveReportAcceptanceHasCausalCommand))
  }

  run beginSafeSettlementIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended))
      .then(settleBeginWithSafeReport)
      .expect(not(firstAcceptedReportIsExecuting))
  }

  run lostSuspendRetryBeforeReconciliationIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend).then(loseCommandResponse)
      .then(retryLostSuspendWithoutReconciliation)
      .expect(not(lostSuspendRequiresReconciliationBeforeRetry))
  }

  run foreignRunCorrelationProjectionIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin).then(loseCommandResponse)
      .then(recordForeignCorrelationCommandProjection(FOREIGN_RUN_CORRELATION))
      .expect(and {
        not(everyBoundaryValueCarriesExactCorrelation),
        not(boundaryEvidenceUsesExactCommandIdentity),
        not(commandProjectionBelongsToCalledCommand),
        not(canSettleCommandProjection(state)),
      })
  }

  run foreignAttemptCorrelationProjectionIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin).then(loseCommandResponse)
      .then(recordForeignCorrelationCommandProjection(FOREIGN_ATTEMPT_CORRELATION))
      .expect(and {
        not(everyBoundaryValueCarriesExactCorrelation),
        not(boundaryEvidenceUsesExactCommandIdentity),
        not(commandProjectionBelongsToCalledCommand),
        not(canSettleCommandProjection(state)),
      })
  }

  run wrongCommandProjectionOrdinalIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin).then(loseCommandResponse)
      .then(recordWrongOrdinalCommandProjection)
      .expect(and {
        everyBoundaryValueCarriesExactCorrelation,
        not(boundaryEvidenceUsesExactCommandIdentity),
        not(commandProjectionBelongsToCalledCommand),
        not(canSettleCommandProjection(state)),
      })
  }
}
