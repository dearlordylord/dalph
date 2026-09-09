// Mutation controls: each illegal transition must turn a named safety claim red.
module plannedAttemptExecutorNegativeTest {
  import plannedAttemptExecutor.* from "./plannedAttemptExecutor"

  action replaceWithoutFreshAbsence: bool = all {
    state' = { ...state, beginTurnBoundary: BeginEmptyReplacement, replacementIntentWasFreshExactAbsence: state.preTurnThreadRead == ExactAbsent and state.beginTurnBoundary == BeginAssociatedPreTurn },
  }
  action retainFreshAllocationAfterRestart: bool = all { state' = { ...state, lastAction: RecoveryActivatedAction } }
  run persistedFreshAllocationAuthorityMutationIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBeginPreTurn).then(loseCommandResponse)
      .then(recordPreTurnThreadRead(ExactAbsent)).then(recordEmptyReplacementIntent)
      .then(allocateReplacementThread).then(associateReplacementThread)
      .then(retainFreshAllocationAfterRestart).expect(not(restartDiscardsFreshAllocationAuthority))
  }
  action allocateDuringRedelivery: bool = all {
    state' = { ...state, replacementAllocationCount: state.replacementAllocationCount + 1 },
  }
  action allocateWithoutEmptyIntent: bool = all {
    state' = { ...state, beginTurnBoundary: BeginReplacementAllocated, lastAllocationHadDurableEmptyIntent: state.beginTurnBoundary == BeginEmptyReplacement },
  }
  run allocationWithoutEmptyIntentMutationIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBeginPreTurn).then(loseCommandResponse)
      .then(recordPreTurnThreadRead(ExactAbsent)).then(allocateWithoutEmptyIntent)
      .expect(not(replacementAllocationRequiresDurableEmptyIntent))
  }
  action issueProofBeforeAssociation: bool = all {
    state' = { ...state, evidence: CommandProjectionEvidence({ correlation: PLANNED_CORRELATION, commandOrdinal: 1, outcome: CommandProjectionBeginNotCrossed }) },
  }
  run staleAbsenceReplacementMutationIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBeginPreTurn).then(loseCommandResponse)
      .then(recordPreTurnThreadRead(ExactAbsent)).then(recoverActivation)
      .then(replaceWithoutFreshAbsence).expect(not(replacementRequiresFreshExactAbsence))
  }
  run ambiguousReplacementMutationIsDetectedTest = {
    nondet read = Set(TemporarilyUnavailable, Unreadable, Foreign, TurnBearing).oneOf()
    init.then(beginResponsibility).then(recordBeginIntent).then(callBeginPreTurn).then(loseCommandResponse)
      .then(recordPreTurnThreadRead(read)).then(replaceWithoutFreshAbsence)
      .expect(not(replacementRequiresFreshExactAbsence))
  }
  run proofBeforeReplacementAssociationMutationIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBeginPreTurn).then(loseCommandResponse)
      .then(recordPreTurnThreadRead(ExactAbsent)).then(recordEmptyReplacementIntent)
      .then(issueProofBeforeAssociation).expect(not(beginNotCrossedProofHasExactPreTurnAuthority))
  }
  run redeliveryAllocationMutationIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBeginPreTurn).then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionBeginNotCrossed)).then(redeliverBegin)
      .then(allocateDuringRedelivery).expect(not(redeliveryNeverAllocates))
  }

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
  action redeliverWithoutProof: bool = all {
    isCalled(state.commandState),
    state' = { ...state, commandCallCount: state.commandCallCount + 1, beginRedeliveryCount: state.beginRedeliveryCount + 1, lastRedeliveryHadFreshExactProof: false, lastAction: BeginRedeliveredAction },
  }
  action crossBeginAgain: bool = all {
    state.beginTurnBoundary == BeginTurnCrossed,
    state' = { ...state, beginTurnCrossingCount: state.beginTurnCrossingCount + 1 },
  }
  run staleBeginProofMutationIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBeginPreTurn).then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionBeginNotCrossed)).then(recoverActivation)
      .then(redeliverWithoutProof).expect(not(redeliveryRequiresFreshExactPreTurnProof))
  }
  run duplicateBeginTurnMutationIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(crossBeginAgain).expect(not(beginTurnCrossesAtMostOnce))
  }

  action duplicateResumeProjectionConsumption: bool = {
    val first = state.resumeRecovery.redeliveryIntents.nth(0)
    all {
      state.resumeRecovery.redeliveryIntents.length() == 1,
      state' = { ...state, resumeRecovery: { ...state.resumeRecovery, redeliveryIntents: state.resumeRecovery.redeliveryIntents.append({ ...first, redeliveryOrdinal: 2 }) } },
    }
  }

  action duplicateResumeDeliveryCall: bool = all {
    state.resumeRecovery.redeliveryCallCount > 0,
    state' = { ...state, resumeRecovery: { ...state.resumeRecovery, redeliveryCallCount: state.resumeRecovery.redeliveryCallCount + 1 } },
  }
  run duplicateResumeDeliveryCallIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend).then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(crashResumeDelivery)
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended)).then(settleCommandProjection)
      .then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent).then(callResumeRedelivery)
      .then(duplicateResumeDeliveryCall).expect(not(eachResumeRedeliveryIntentAllowsOneCall))
  }
  action corruptResumeRedeliveryIdentity(correlation: Correlation, ordinal: int): bool = {
    val first = state.resumeRecovery.redeliveryIntents.nth(0)
    all {
      state.resumeRecovery.redeliveryIntents.length() == 1,
      state' = { ...state, resumeRecovery: { ...state.resumeRecovery, redeliveryIntents: List({ ...first, command: { ...first.command, correlation: correlation, commandOrdinal: ordinal } }) } },
    }
  }
  action staleResumeRedeliveryWitness: bool = {
    val first = state.resumeRecovery.redeliveryIntents.nth(0)
    all {
      state.resumeRecovery.redeliveryIntents.length() == 1,
      state' = { ...state, resumeRecovery: { ...state.resumeRecovery, redeliveryIntents: List({ ...first, witness: { ...first.witness, claim: first.projection.observedAt } }) } },
    }
  }
  action resumeRedeliveryCallWithoutIntent: bool = all {
    state' = { ...state, resumeRecovery: { ...state.resumeRecovery, calledRedeliveryOrdinals: Set(1) } },
  }
  action releaseResumeDeliveryPosition: bool = all { state' = { ...state, positionHeld: false } }
  action restoreCrashedResumeDeliveryAuthority: bool = all {
    state.lastAction == ResumeDeliveryCrashedAction,
    state' = { ...state, resumeRecovery: { ...state.resumeRecovery, readyDelivery: ReadyResumeDelivery(state.resumeRecovery.redeliveryIntents.nth(0)) } },
  }
  run duplicateResumeSafeProjectionConsumptionIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(crashResumeDelivery)
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended)).then(settleCommandProjection).then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent)
      .then(duplicateResumeProjectionConsumption).expect(not(resumeProjectionConsumedAtMostOnce))
  }
  run foreignAttemptResumeRedeliveryIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(crashResumeDelivery)
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended)).then(settleCommandProjection).then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent)
      .then(corruptResumeRedeliveryIdentity(FOREIGN_ATTEMPT_CORRELATION, 3)).expect(not(resumeRedeliveryKeepsOriginalCommand))
  }
  run wrongResumeCommandOrdinalIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(crashResumeDelivery)
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended)).then(settleCommandProjection).then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent)
      .then(corruptResumeRedeliveryIdentity(PLANNED_CORRELATION, 4)).expect(not(resumeRedeliveryKeepsOriginalCommand))
  }
  run staleFocusedResumeWitnessIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(crashResumeDelivery)
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended)).then(settleCommandProjection).then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent)
      .then(staleResumeRedeliveryWitness).expect(not(resumeRedeliveryUsesLaterExactWitnesses))
  }
  run resumeCallWithoutRedeliveryIntentIsDetectedTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(crashResumeDelivery)
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended)).then(settleCommandProjection).then(resumeRedeliveryCallWithoutIntent).expect(not(resumeRedeliveryCallHasDurableIntent))
  }
  run resumeRedeliveryCannotReleasePositionAtIntentTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(crashResumeDelivery)
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended)).then(settleCommandProjection).then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent)
      .then(releaseResumeDeliveryPosition).expect(not(resumeRedeliveryRetainsResponsibility))
  }
  action allocateSecondSemanticResume: bool = all { state' = { ...state, nextCommandOrdinal: state.nextCommandOrdinal + 1, commandIntentCount: state.commandIntentCount + 1 } }
  run redeliveryCannotAllocateSecondSemanticResumeTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend).then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(crashResumeDelivery)
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended)).then(settleCommandProjection)
      .then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent)
      .then(allocateSecondSemanticResume).expect(not(resumeRedeliveryNeverAllocatesCommand))
  }
  action advanceProjectionWithoutNewIntent: bool = all { state' = { ...state, resumeRecovery: { ...state.resumeRecovery, projectionOrdinal: state.resumeRecovery.projectionOrdinal + 1 } } }
  run redeliveryCannotConsumeStaleProjectionTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend).then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(crashResumeDelivery)
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended)).then(settleCommandProjection)
      .then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent)
      .then(advanceProjectionWithoutNewIntent).expect(not(resumeRedeliveryUsesLatestProjection))
  }
  action skipResumeRedeliveryOrdinal: bool = all { state' = { ...state, resumeRecovery: { ...state.resumeRecovery, redeliveryIntents: List({ ...state.resumeRecovery.redeliveryIntents.nth(0), redeliveryOrdinal: 2 }) } } }
  run redeliveryOrdinalCannotSkipTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend).then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(crashResumeDelivery)
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended)).then(settleCommandProjection)
      .then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent)
      .then(skipResumeRedeliveryOrdinal).expect(not(resumeRedeliveryOrdinalsAreExact))
  }
  run crashedResumeIntentCannotRestoreOldDeliveryCapabilityTest = {
    init.then(beginResponsibility).then(recordBeginIntent).then(callBegin)
      .then(receiveCommandResponse(ExecutorWorkExecuting)).then(settleCommandResponse)
      .then(recordSuspendIntent).then(callSuspend)
      .then(receiveCommandResponse(ExecutorWorkSafelySuspended)).then(settleCommandResponse)
      .then(recordResumeIntent).then(crashResumeDelivery)
      .then(recordCommandProjection(CommandProjectionExactSafelySuspended)).then(settleCommandProjection).then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent)
      .then(crashResumeDelivery).then(restoreCrashedResumeDeliveryAuthority)
      .expect(not(crashedResumeCannotReuseDeliveryAuthorization))
  }
}
