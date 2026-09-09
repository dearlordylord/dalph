module plannedAttemptExecutorEvidenceProofNegativeTest {
  import plannedAttemptExecutorEvidenceProof.* from "./plannedAttemptExecutor_proof"

  action replaceWithoutFreshAbsence: bool = all { state' = { ...state, stage: EmptyReplacement, lastReplacementHadFreshAbsence: state.stage == EmptyAbsenceObserved } }
  action allocateWithoutIntent: bool = all { state' = { ...state, stage: ReplacementAllocated, lastAllocationHadDurableIntent: state.stage == EmptyReplacement } }
  action allocateWithRedelivery: bool = all { state' = { ...state, allocationParity: not(state.allocationParity) } }
  action issueProofWithoutAssociation: bool = all { state' = { ...state, stage: BeginNotCrossedObserved, lastProofHadAssociatedAuthority: state.stage == BeginPreTurn or state.stage == BeginFreshReplacement } }
  run proofBeforeAssociationMutationIsDetectedTest = {
    init.then(recordBeginIntent).then(callBeginPreTurn).then(readEmptyAbsence).then(recordEmptyReplacementIntent)
      .then(issueProofWithoutAssociation).expect(not(beginProofRequiresAssociation))
  }
  action retainFreshAllocationAfterRestart: bool = all { state' = { ...state, lastEvent: ReplacementProcessLost } }
  run persistedFreshAllocationAuthorityMutationIsDetectedTest = {
    init.then(recordBeginIntent).then(callBeginPreTurn).then(readEmptyAbsence).then(recordEmptyReplacementIntent)
      .then(allocateReplacementThread).then(associateReplacementThread)
      .then(retainFreshAllocationAfterRestart).expect(not(restartDiscardsFreshAllocationAuthority))
  }
  run staleAbsenceReplacementMutationIsDetectedTest = {
    init.then(recordBeginIntent).then(callBeginPreTurn).then(readEmptyAbsence).then(loseReplacementProcess)
      .then(replaceWithoutFreshAbsence).expect(not(replacementRequiresFreshAbsence))
  }
  run unsafeReplacementMutationIsDetectedTest = {
    init.then(recordBeginIntent).then(callBeginPreTurn).then(readUnsafePreTurn)
      .then(replaceWithoutFreshAbsence).expect(not(replacementRequiresFreshAbsence))
  }
  run missingAllocationIntentMutationIsDetectedTest = {
    init.then(recordBeginIntent).then(callBeginPreTurn).then(readEmptyAbsence)
      .then(allocateWithoutIntent).expect(not(allocationRequiresDurableEmptyIntent))
  }
  run redeliveryAllocationMutationIsDetectedTest = {
    init.then(recordBeginIntent).then(callBeginPreTurn).then(observeBeginNotCrossed).then(redeliverBegin)
      .then(allocateWithRedelivery).expect(not(redeliveryNeverAllocates))
  }

  action callWithoutIntent: bool = all { state.stage == ResponsibilityHeld, state' = { ...state, callCount: 1, lastEvent: BeginBoundaryCalled } }
  action appendOrdinalForUnchangedRead: bool = all { state.stage == Executing, state' = { ...state, observationCount: 1, acceptedReportOrdinal: 2, durableObservationCount: state.durableObservationCount + 1, proposalIdentityCount: state.proposalIdentityCount + 1, intentCount: state.intentCount + 1, callCount: state.callCount + 1, lastEvent: PassiveExecutingObserved } }
  action secondBegin: bool = all { state.stage == Executing, state' = { ...state, beginCount: 2, intentCount: state.intentCount + 1, lastEvent: BeginIntentRecorded } }
  action consumeAcceptedSafeReportTwice: bool = all { state.stage == Safe, state.resumeCountSinceSafe == 1, state' = { ...state, resumeCountSinceSafe: 2 } }
  action retainTerminalPosition: bool = all { state.stage == Terminal, state' = { ...state, positionHeld: true } }
  action settleBeginWithSafeReport: bool = all {
    state.stage == BeginResponseObserved,
    state.pendingReport == SafeReport,
    state' = { ...state, stage: Safe, settlementCount: 1, acceptedReportOrdinal: 1, resumeCountSinceSafe: 0, positionHeld: false, lastEvent: DistinctReportAccepted },
  }

  run callWithoutIntentIsDetectedTest = { init.then(callWithoutIntent).expect(not(everyCallHasDurableIntent)) }
  run unchangedReadOrdinalMutationIsDetectedTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(appendOrdinalForUnchangedRead).expect(and { not(unchangedExecutingObservationsKeepOrdinal), not(unchangedExecutingObservationsAreProcessLocal), not(passiveObservationsDoNotCallExecutor) })
  }
  run secondBeginIsDetectedTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(secondBegin).expect(not(beginOccursOnce))
  }
  run secondResumeAgainstSameSafeReportIsDetectedTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeSuspendResponse(SafeReport)).then(settleSuspendResponse)
      .then(recordResumeIntent).then(callResume).then(observeResumeResponse(SafeReport)).then(settleResumeResponse)
      .then(consumeAcceptedSafeReportTwice).expect(not(acceptedSafeReportAuthorizesAtMostOneResume))
  }
  run beginSafeSettlementIsDetectedTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(SafeReport))
      .then(settleBeginWithSafeReport).expect(not(firstAcceptedReportIsExecuting))
  }
  run terminalCapacityLeakIsDetectedTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(observeTerminal).then(retainTerminalPosition).expect(not(safeAndTerminalReleasePosition))
  }
  action redeliverStaleProof: bool = all { state.stage == BeginPreTurn, state' = { ...state, stage: BeginTurnIntent, lastRedeliveryHadFreshProof: false, lastEvent: BeginRedelivered } }
  action crossDuplicateTurn: bool = all { state.stage == BeginCalled, state' = { ...state, beginTurnCrossingCount: state.beginTurnCrossingCount + 1 } }
  run stalePreTurnProofIsDetectedTest = {
    init.then(recordBeginIntent).then(callBeginPreTurn).then(observeBeginNotCrossed).then(loseBeginProof)
      .then(redeliverStaleProof).expect(not(redeliveryRequiresFreshProof))
  }
  run duplicateTaskTurnIsDetectedTest = {
    init.then(recordBeginIntent).then(callBegin).then(crossDuplicateTurn).expect(not(beginTurnCrossesAtMostOnce))
  }


  action duplicateResumeProjectionConsumption: bool = all {
    state' = { ...state, resumeRedeliveryCount: state.resumeRedeliveryCount + 1 },
  }
  action callResumeWithoutRedeliveryIntent: bool = all {
    state' = { ...state, resumeRedeliveryCallCount: state.resumeRedeliveryCount + 1 },
  }
  action reuseResumeWitnessWithoutFreshRead: bool = all {
    state' = { ...state, lastResumeRedeliveryHadFreshWitness: false, lastEvent: ResumeRedeliveryRecorded },
  }
  action releasePendingResumePosition: bool = all { state' = { ...state, positionHeld: false } }
  action restoreCrashedResumePermission: bool = all { state' = { ...state, resumeDeliveryMayCall: true } }
  run duplicateResumeProjectionConsumptionIsDetectedTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeSuspendResponse(SafeReport)).then(settleSuspendResponse)
      .then(recordResumeIntent).then(crashResumeDelivery).then(observeResumeSafeProjection).then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent).then(duplicateResumeProjectionConsumption).expect(not(resumeProjectionConsumedOnce))
  }
  run resumeCallWithoutDurableRedeliveryIntentIsDetectedTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeSuspendResponse(SafeReport)).then(settleSuspendResponse)
      .then(recordResumeIntent).then(crashResumeDelivery).then(observeResumeSafeProjection).then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent).then(callResumeWithoutRedeliveryIntent).expect(not(resumeRedeliveryCallHasIntent))
  }
  run staleResumeWitnessIsDetectedTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeSuspendResponse(SafeReport)).then(settleSuspendResponse)
      .then(recordResumeIntent).then(crashResumeDelivery).then(observeResumeSafeProjection).then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent).then(reuseResumeWitnessWithoutFreshRead).expect(not(resumeRedeliveryUsesFreshWitness))
  }
  run pendingResumePositionReleaseIsDetectedTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeSuspendResponse(SafeReport)).then(settleSuspendResponse)
      .then(recordResumeIntent).then(crashResumeDelivery).then(observeResumeSafeProjection).then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent).then(releasePendingResumePosition).expect(not(resumeRedeliveryRetainsPosition))
  }
  run restoredCrashedResumePermissionIsDetectedTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeSuspendResponse(SafeReport)).then(settleSuspendResponse)
      .then(recordResumeIntent).then(crashResumeDelivery).then(observeResumeSafeProjection).then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent).then(crashResumeDelivery).then(restoreCrashedResumePermission).expect(not(resumeCrashDiscardsCallPermission))
  }
}

module plannedAttemptExecutorSuspendBoundProofNegativeTest {
  import plannedAttemptExecutorSuspendBoundProof.* from "./plannedAttemptExecutor_proof"

  action fourthSuspend: bool = all { state.stage == Executing, state.intentCount == SUSPEND_LIMIT, state' = { ...state, stage: IntentRecorded, intentCount: state.intentCount + 1, lastEvent: SuspendIntentRecorded } }
  action callDuringReadOnlyRecovery: bool = all { state.stage == ReadOnlyRecovery, state' = { ...state, callCount: state.callCount + 1 } }
  action releaseOnExecuting: bool = all { state.stage == Executing, state' = { ...state, positionHeld: false } }
  action retryLostSuspendWithoutProjection: bool = all { state.stage == ResponseLost, state' = { ...state, stage: IntentRecorded, intentCount: state.intentCount + 1, lastEvent: SuspendIntentRecorded } }
  action eraseLostSuspendIntent: bool = all { state.stage == ResponseLost, state' = { ...state, intentCount: 0 } }

  run fourthSuspendIsDetectedTest = {
    init
      .then(recordSuspendIntent).then(callSuspend).then(observeResponse(ExecutingReport)).then(settleResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeResponse(ExecutingReport)).then(settleResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeResponse(ExecutingReport)).then(settleResponse)
      .then(fourthSuspend).expect(not(suspendLimitBlocksFourthCommand) and not(suspendProofTypeOk))
  }
  run recoveryCommandIsDetectedTest = {
    init
      .then(recordSuspendIntent).then(callSuspend).then(observeResponse(ExecutingReport)).then(settleResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeResponse(ExecutingReport)).then(settleResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeResponse(ExecutingReport)).then(settleResponse)
      .then(activateReadOnlyRecovery).then(callDuringReadOnlyRecovery).expect(not(postLimitRecoveryIsReadOnly))
  }
  run lostSuspendRetryIsDetectedTest = {
    init.then(recordSuspendIntent).then(callSuspend).then(loseResponse)
      .then(retryLostSuspendWithoutProjection).expect(not(lostSuspendRequiresReconciliationBeforeRetry))
  }
  run lostSuspendBudgetErasureIsDetectedTest = {
    init.then(recordSuspendIntent).then(callSuspend).then(loseResponse)
      .then(eraseLostSuspendIntent).expect(not(lostSuspendResponseConsumesCommandBudget))
  }
}
