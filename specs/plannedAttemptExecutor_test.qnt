module plannedAttemptExecutorTest {
  import plannedAttemptExecutor.* from "./plannedAttemptExecutor"

  run exactBoundaryCorrelationAndOrdinalArePreservedTest = {
    init.then(beginResponsibility).then(recordBeginIntent)
      .expect(and {
        everyBoundaryValueCarriesExactCorrelation,
        commandOrdinalsAreAllocatedExactly,
      })
      .then(callBegin).then(receiveCommandResponse(ExecutorWorkExecuting))
      .expect(and {
        everyBoundaryValueCarriesExactCorrelation,
        boundaryEvidenceUsesExactCommandIdentity,
      })
      .then(settleCommandResponse).then(recordSuspendIntent).then(callSuspend)
      .then(loseCommandResponse).then(recordCommandProjection(CommandProjectionExactExecuting))
      .expect(and {
        everyBoundaryValueCarriesExactCorrelation,
        boundaryEvidenceUsesExactCommandIdentity,
        commandProjectionBelongsToCalledCommand,
      })
  }

  run beginOnceAndObserveExecutingFiveTimesTest = {
    init.then(beginResponsibility)
      .then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordFreshStateProjection(ExecutorStateExecuting))
      .then(recoverActivation)
      .then(recordFreshStateProjection(ExecutorStateExecuting))
      .then(recoverActivation)
      .then(recordFreshStateProjection(ExecutorStateExecuting))
      .then(recoverActivation)
      .then(recordFreshStateProjection(ExecutorStateExecuting))
      .then(recoverActivation)
      .then(recordFreshStateProjection(ExecutorStateExecuting))
      .expect(and {
        fourthUnchangedExecutingObservationReached,
        state.commandIntentCount == 1,
        state.commandCallCount == 1,
        state.acceptedReportOrdinal == 1,
        beginOccursAtMostOnce,
        observationsDoNotConsumeCommandBudget,
        unchangedExactObservationDoesNotAppendReport,
        unchangedExactObservationIsProcessLocal,
        state.durableObservationCount == 0,
        state.proposalIdentityCount == 1,
      })
  }

  run passiveTerminalObservationAppendsDistinctReportTest = {
    init.then(beginResponsibility)
      .then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordFreshStateProjection(ExecutorStateTerminal)).then(acceptFreshStateProjectionProof)
      .expect(and { terminalReached, state.acceptedReportOrdinal == 2, terminalReleasesPosition })
  }

  run firstPassiveLifecycleReportRequiresBeginSettlementTest = {
    init.then(beginResponsibility)
      .expect(and {
        state.status == ResponsibilityBegan,
        state.acceptedReportOrdinal == 0,
        not(canRecordFreshStateProjection(state, ExecutorStateExecuting)),
        not(canRecordFreshStateProjection(state, ExecutorStateSafelySuspended)),
        not(canRecordFreshStateProjection(state, ExecutorStateTerminal)),
        passiveReportAcceptanceHasCausalCommand,
      })
  }

  run passiveSafeObservationRequiresSuspendTest = {
    init.then(beginResponsibility)
      .then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .expect(not(canRecordFreshStateProjection(state, ExecutorStateSafelySuspended)))
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordFreshStateProjection(ExecutorStateSafelySuspended)).then(acceptFreshStateProjectionProof)
      .expect(and {
        safelySuspendedReached,
        state.acceptedReportOrdinal == 2,
        passiveReportAcceptanceHasCausalCommand,
      })
  }

  run passiveTerminalAfterSafeRemainsAllowedTest = {
    init.then(beginResponsibility)
      .then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordFreshStateProjection(ExecutorStateTerminal)).then(acceptFreshStateProjectionProof)
      .expect(and {
        terminalReached,
        terminalAcceptedStatusIsAbsorbing,
        passiveReportAcceptanceHasCausalCommand,
      })
  }

  run beginSafeResponseCannotSettleTest = {
    init.then(beginResponsibility)
      .then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended))
      .expect(and { not(canSettleCommandResponse(state)), firstAcceptedReportIsExecuting })
  }

  run beginTerminalResponseCannotSettleTest = {
    init.then(beginResponsibility)
      .then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkTerminal))
      .expect(and { not(canSettleCommandResponse(state)), firstAcceptedReportIsExecuting })
  }

  run beginSafeProjectionCannotSettleTest = {
    init.then(beginResponsibility)
      .then(recordBeginIntent).then(callBegin).then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended))
      .expect(and { not(canSettleCommandProjection(state)), firstAcceptedReportIsExecuting })
  }

  run unchangedTerminalObservationIsProcessLocalTest = {
    init.then(beginResponsibility)
      .then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordFreshStateProjection(ExecutorStateTerminal)).then(acceptFreshStateProjectionProof)
      .then(recoverActivation)
      .then(recordFreshStateProjection(ExecutorStateTerminal))
      .expect(and {
        terminalReached,
        terminalAcceptedStatusIsAbsorbing,
        state.acceptedReportOrdinal == 2,
        state.durableObservationCount == 1,
        unchangedExactObservationDoesNotAppendReport,
        unchangedExactObservationIsProcessLocal,
        not(canRecordFreshStateProjection(state, ExecutorStateExecuting)),
        not(canRecordFreshStateProjection(state, ExecutorStateSafelySuspended)),
      })
  }

  run unchangedSafeObservationIsProcessLocalTest = {
    init.then(beginResponsibility)
      .then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recoverActivation)
      .then(recordFreshStateProjection(ExecutorStateSafelySuspended))
      .expect(and {
        safelySuspendedReached,
        state.acceptedReportOrdinal == 2,
        state.durableObservationCount == 0,
        unchangedExactObservationDoesNotAppendReport,
        unchangedExactObservationIsProcessLocal,
        state.resumeIntentsSinceSafeSuspension == 0,
      })
  }

  run unchangedSuspendResponseSettlesWithoutNewReportTest = {
    init.then(beginResponsibility)
      .then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .expect(and {
        executingReached,
        state.commandSettlementCount == 2,
        state.commandResponseEvidenceCount == 2,
        state.acceptedReportOrdinal == 1,
        acceptedReportsRequireSettledCommandOrObservation,
        acceptedReportOrdinalAdvancesExactlyForDistinctReports,
      })
  }

  run safeSuspendThenExactResumeTest = {
    init.then(beginResponsibility)
      .then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .expect(safelySuspendedReached and safeSuspensionReleasesPosition)
      .then(recordResumeIntent).then(callResume)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .expect(and { executingReached, resumeRequiresAcceptedSafeReport, state.acceptedReportOrdinal == 3 })
  }

  run lostBeginResponseReconcilesWithoutSecondBeginTest = {
    init.then(beginResponsibility)
      .then(recordBeginIntent).then(callBegin).then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionExactExecuting)).then(settleCommandProjection)
      .expect(and {
        executingReached,
        state.commandIntentCount == 1,
        state.commandCallCount == 1,
        not(canRecordBeginIntent(state)),
        beginOccursAtMostOnce,
      })
  }

  run lostSuspendMustReconcileBeforeRetryTest = {
    init.then(beginResponsibility)
      .then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend).then(loseCommandResponse)
      .expect(and {
        lostSuspendResponseReached,
        state.suspendIntentsSinceExecuting == 1,
        lostSuspendResponseConsumesCommandBudget,
        lostSuspendRequiresReconciliationBeforeRetry,
      })
      .then(recordSuspendIntent.fail())
  }

  run lostSuspendResponseConsumesBoundAndReconcilesTest = {
    init.then(beginResponsibility)
      .then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend).then(loseCommandResponse)
      .then(recoverActivation)
      .then(recordCommandProjection(CommandProjectionExactExecuting)).then(settleCommandProjection)
      .expect(and {
        lostSuspendProjectionSettledReached,
        state.suspendIntentsSinceExecuting == 1,
        lostSuspendRequiresReconciliationBeforeRetry,
      })
      .then(recordSuspendIntent)
      .expect(and { state.suspendIntentsSinceExecuting == 2, suspendCommandLimitPreserved })
  }

  run passiveSafeToExecutingIsBlockedTest = {
    init.then(beginResponsibility)
      .then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .expect(and { safelySuspendedReached, state.acceptedReportOrdinal == 2, safeToExecutingRequiresResume })
      .then(recordFreshStateProjection(ExecutorStateExecuting).fail())
  }

  run threeSuspendCommandsRemainTheOnlyCommandBoundTest = {
    init.then(beginResponsibility)
      .then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend).then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend).then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend).then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .expect(and { suspendCommandLimitReached, not(canRecordSuspendIntent(state)), suspendCommandLimitPreserved })
  }

  run unsafeObservationsRetainPositionTest = {
    init.then(beginResponsibility)
      .then(recordFreshStateProjection(ExecutorStateTemporarilyUnavailable))
      .expect(state.positionHeld and unsafeOrUnavailableNeverReleasesPosition)
  }
}
