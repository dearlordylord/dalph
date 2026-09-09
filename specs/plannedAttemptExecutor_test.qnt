module plannedAttemptExecutorTest {
  import plannedAttemptExecutor.* from "./plannedAttemptExecutor"

  run absentEmptyAssociationFinishesSameBeginTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBeginPreTurn).then(loseCommandResponse)
      .then(recoverActivation).then(recordPreTurnThreadRead(ExactAbsent))
      .then(recordEmptyReplacementIntent).expect(replacementKeepsOriginalBegin)
      .then(allocateReplacementThread).then(associateReplacementThread)
      .then(recordCommandProjection(CommandProjectionBeginNotCrossed)).expect(freshAllocationProofReached).then(redeliverBegin)
      .expect(and { redeliveryNeverAllocates, state.replacementAllocationCount == 1 })
      .then(crossRedeliveredBeginTurn).then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .expect(and { state.commandIntentCount == 1, state.acceptedReportOrdinal == 1, state.beginTurnCrossingCount == 1 })
  }

  run repeatedReplacementCrashCutsKeepOneBeginTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBeginPreTurn).then(loseCommandResponse)
      .then(recordPreTurnThreadRead(ExactAbsent)).then(recoverActivation)
      .expect(state.preTurnThreadRead == PreTurnNotRead)
      .then(recordPreTurnThreadRead(ExactAbsent)).then(recordEmptyReplacementIntent).then(recoverActivation)
      .expect(state.beginTurnBoundary == BeginEmptyReplacement)
      .then(allocateReplacementThread).then(recoverActivation)
      .expect(state.beginTurnBoundary == BeginEmptyReplacement)
      .then(allocateReplacementThread).then(associateReplacementThread).then(recoverActivation)
      .then(recordCommandProjection(CommandProjectionBeginNotCrossed)).then(recoverActivation)
      .expect(state.evidence == NoEvidence)
      .then(recordCommandProjection(CommandProjectionBeginNotCrossed)).then(redeliverBegin)
      .then(crossRedeliveredBeginTurn)
      .expect(and { state.replacementAllocationCount == 2, state.beginTurnCrossingCount == 1, state.commandIntentCount == 1, redeliveryNeverAllocates })
  }

  run ambiguousPreTurnReadForbidsReplacementTest = {
    nondet read = Set(TemporarilyUnavailable, Unreadable, Foreign, TurnBearing).oneOf()
    init.then(beginResponsibility).then(recordBeginIntent).then(callBeginPreTurn).then(loseCommandResponse)
      .then(recordPreTurnThreadRead(read))
      .then(recordEmptyReplacementIntent).fail()
  }

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
  run exactPreTurnBeginIsRedeliveredTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBeginPreTurn).then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionBeginNotCrossed))
      .then(redeliverBegin).then(crossRedeliveredBeginTurn)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .expect(and { state.commandIntentCount == 1, state.commandCallCount == 2, state.beginTurnCrossingCount == 1, state.status == StatusExecuting, everyCallHasOneDurableIntent })
  }
  run crashDiscardsBeginNotCrossedProofTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBeginPreTurn).then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionBeginNotCrossed)).then(recoverActivation)
      .expect(state.evidence == NoEvidence)
      .then(recordCommandProjection(CommandProjectionBeginNotCrossed)).then(redeliverBegin)
      .expect(redeliveryRequiresFreshExactPreTurnProof)
  }
  run absenceAndTurnIntentNeverAuthorizeBeginRedeliveryTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBeginPreTurn).then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionNoCurrentReport))
      .expect(commandProjectionOutcome(state.evidence) != CommandProjectionBeginNotCrossed)
  }
  run authorizedTurnCannotProduceBeginNotCrossedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBeginPreTurn).then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionBeginNotCrossed)).then(redeliverBegin)
      .then(loseCommandResponse).then(recoverActivation)
      .expect(and { state.beginTurnBoundary == BeginTurnAuthorized, state.responseAmbiguous, state.evidence == NoEvidence })
  }

  // #274: C's same Resume is reconciled Safe, then newer exact focused reads
  // authorize one durable delivery intent before the executor is contacted.
  run exactSafeResumeRedeliveryKeepsOriginalOrdinalTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(crashResumeDelivery)
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended)).then(settleCommandProjection)
      .expect(and { isNoCommand(state.commandState), not(state.positionHeld), state.commandSettlementCount == 3 })
      .then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent)
      .expect(and { state.commandIntentCount == 3, state.nextCommandOrdinal == 4, state.commandSettlementCount == 2, state.positionHeld, resumeRedeliveryKeepsOriginalCommand })
      .then(callResumeRedelivery).then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .expect(and { state.status == StatusExecuting, state.commandCallCount == 3, state.resumeRecovery.totalRedeliveryIntents == 1, state.acceptedReportOrdinal == 3, everyCallHasOneDurableIntent })
  }
  run crashAfterResumeRedeliveryIntentRequiresNewProjectionAndIntentTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(crashResumeDelivery)
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended)).then(settleCommandProjection).then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent)
      .then(crashResumeDelivery)
      .expect(and { state.positionHeld, crashedResumeCannotReuseDeliveryAuthorization, not(canAuthorizeResumeRedelivery(state)) })
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended)).then(settleCommandProjection)
      .then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent)
      .expect(and { secondResumeRedeliveryReached, state.resumeRecovery.projectionOrdinal == 2, resumeProjectionConsumedAtMostOnce, resumeRedeliveryOrdinalsAreExact })
      .then(callResumeRedelivery).then(loseCommandResponse).then(recoverActivation)
      .then(recordCommandProjection(CommandProjectionExactExecuting)).then(settleCommandProjection)
      .expect(and { state.status == StatusExecuting, state.commandIntentCount == 3, state.resumeRecovery.totalRedeliveryIntents == 2, state.commandCallCount == 3 })
  }
  run completedResumeDeliveryReconcilesWithoutAnotherResumeTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(callResume).then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionExactExecuting)).then(settleCommandProjection)
      .expect(and { state.status == StatusExecuting, state.resumeRecovery.proof == NoResumeProjection, state.commandCallCount == 3, state.resumeRecovery.totalRedeliveryIntents == 0 })
  }
  run ordinarySafeResumeResponseCannotMintRedeliveryProofTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(callResume).then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .expect(and { state.resumeRecovery.proof == NoResumeProjection, not(canAuthorizeResumeRedelivery(state)) })
  }
  run unavailableResumeProjectionCannotAuthorizeRetryTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(crashResumeDelivery).then(recordCommandProjection(CommandProjectionTemporarilyUnavailable))
      .expect(and { state.positionHeld, state.resumeRecovery.proof == NoResumeProjection, not(canAuthorizeResumeRedelivery(state)) })
  }
  run crashBeforeResumeRedeliveryIntentDiscardsFocusedWitnessTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(crashResumeDelivery)
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended)).then(settleCommandProjection).then(readResumeContinuationWitness).then(recoverActivation)
      .expect(and { state.resumeRecovery.witness == NoResumeWitness, not(canAuthorizeResumeRedelivery(state)) })
      .then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent)
      .expect(resumeRedeliveryUsesLaterExactWitnesses)
  }
  run laterDurableExecutorEvidenceInvalidatesResumeProjectionTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend).then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(crashResumeDelivery)
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended)).then(settleCommandProjection).then(recoverActivation)
      .then(recordFreshStateProjection(ExecutorStateTerminal))
      .expect(and { state.resumeRecovery.proof == NoResumeProjection, not(canAuthorizeResumeRedelivery(state)) })
      .then(acceptFreshStateProjectionProof)
      .expect(and { state.status == StatusTerminal, not(state.positionHeld) })
  }
}
