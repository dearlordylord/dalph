module plannedAttemptExecutorEvidenceProofTest {
  import plannedAttemptExecutorEvidenceProof.* from "./plannedAttemptExecutor_proof"

  run fourPassiveExecutingReadsKeepOneReportOrdinalTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(observeUnchangedExecuting).then(observeUnchangedExecuting).then(observeUnchangedExecuting).then(observeUnchangedExecuting)
      .expect(and { fourthUnchangedObservationReached, state.acceptedReportOrdinal == 1, state.callCount == 1, state.durableObservationCount == 0, state.proposalIdentityCount == 1, unchangedExecutingObservationsKeepOrdinal, unchangedExecutingObservationsAreProcessLocal, passiveObservationsDoNotCallExecutor })
  }

  run passiveTerminalReadAdvancesOrdinalAndReleasesTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(observeTerminal)
      .expect(and { state.acceptedReportOrdinal == 2, terminalObservationReached, safeAndTerminalReleasePosition })
  }

  run beginSafeResponseCannotSettleTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(SafeReport))
      .expect(firstAcceptedReportIsExecuting)
      .then(settleBeginResponse.fail())
  }

  run unchangedSuspendResponseSettlesWithoutReportTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeSuspendResponse(ExecutingReport)).then(settleSuspendResponse)
      .expect(and { state.settlementCount == 2, state.responseCount == 2, state.acceptedReportOrdinal == 1, commandResponsesAndAcceptedReportsStayDistinct })
  }

  run safeThenResumeSameWorkTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeSuspendResponse(SafeReport)).then(settleSuspendResponse)
      .then(recordResumeIntent).then(callResume).then(observeResumeResponse(TerminalReport)).then(settleResumeResponse)
      .expect(and { state.stage == Terminal, state.acceptedReportOrdinal == 3, safeAndTerminalReleasePosition, beginOccursOnce })
  }
  run preTurnRecoveryKeepsOneIntentAndCrossingTest = {
    init.then(recordBeginIntent).then(callBeginPreTurn).then(observeBeginNotCrossed)
      .then(loseBeginProof).expect(state.stage == BeginPreTurn)
      .then(observeBeginNotCrossed).then(redeliverBegin).then(crossBeginTurn)
      .then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .expect(and { state.intentCount == 1, state.callCount == 2, state.beginTurnCrossingCount == 1, everyCallHasDurableIntent, redeliveryRequiresFreshProof })
  }


  run resumeRedeliveryKeepsOneSemanticResumeTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeSuspendResponse(SafeReport)).then(settleSuspendResponse)
      .then(recordResumeIntent).then(crashResumeDelivery).then(observeResumeSafeProjection).then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent).then(callResumeRedelivery).then(observeResumeResponse(ExecutingReport)).then(settleResumeResponse)
      .expect(and { state.intentCount == 3, state.callCount == 3, state.resumeRedeliveryCount == 1, state.acceptedReportOrdinal == 3, resumeRedeliveryPreservesSemanticResume, everyCallHasDurableIntent })
  }
  run secondResumeRedeliveryNeedsSecondSafeProjectionTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeSuspendResponse(SafeReport)).then(settleSuspendResponse)
      .then(recordResumeIntent).then(crashResumeDelivery).then(observeResumeSafeProjection).then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent).then(crashResumeDelivery)
      .expect(and { resumeCrashDiscardsCallPermission, state.positionHeld })
      .then(observeResumeSafeProjection).then(readResumeContinuationWitness).then(recordResumeRedeliveryIntent)
      .then(callResumeRedelivery).then(observeResumeResponse(TerminalReport)).then(settleResumeResponse)
      .expect(and { state.resumeProjectionOrdinal == 2, state.resumeRedeliveryCount == 2, resumeProjectionConsumedOnce, state.stage == Terminal })
  }
  run crossedResumeReconcilesWithoutRedeliveryTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeSuspendResponse(SafeReport)).then(settleSuspendResponse)
      .then(recordResumeIntent).then(callResume).then(crashResumeDelivery).then(reconcileResumeExecuting)
      .expect(and { state.stage == Executing, state.resumeRedeliveryCount == 0, state.callCount == 3 })
  }
  run recoveredResumeAfterFourReadsStillObservesTerminalTest = {
    init.then(recordBeginIntent).then(callBegin).then(observeBeginResponse(ExecutingReport)).then(settleBeginResponse)
      .then(observeUnchangedExecuting).then(observeUnchangedExecuting).then(observeUnchangedExecuting).then(observeUnchangedExecuting)
      .then(recordSuspendIntent).then(callSuspend).then(observeSuspendResponse(SafeReport)).then(settleSuspendResponse)
      .then(recordResumeIntent).then(callResume).then(crashResumeDelivery).then(reconcileResumeExecuting).then(observeTerminal)
      .expect(and { state.observationCount == 6, state.acceptedReportOrdinal == 4, evidenceProofTypeOk, safeAndTerminalReleasePosition })
  }
}

module plannedAttemptExecutorSuspendBoundProofTest {
  import plannedAttemptExecutorSuspendBoundProof.* from "./plannedAttemptExecutor_proof"

  run threeExecutingResponsesThenPassiveSafeTest = {
    init
      .then(recordSuspendIntent).then(callSuspend).then(observeResponse(ExecutingReport)).then(settleResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeResponse(ExecutingReport)).then(settleResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeResponse(ExecutingReport)).then(settleResponse)
      .expect(and { state.intentCount == SUSPEND_LIMIT, suspendLimitBlocksFourthCommand, everySuspendCallHasItsIntent })
      .then(activateReadOnlyRecovery).then(observePassiveSafe)
      .expect(and { readOnlySafeReached, postLimitRecoveryIsReadOnly, positionReleasesOnlyForSafeOrTerminalEvidence })
  }

  run fourthSuspendIsBlockedTest = {
    init
      .then(recordSuspendIntent).then(callSuspend).then(observeResponse(ExecutingReport)).then(settleResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeResponse(ExecutingReport)).then(settleResponse)
      .then(recordSuspendIntent).then(callSuspend).then(observeResponse(ExecutingReport)).then(settleResponse)
      .then(recordSuspendIntent.fail())
  }

  run lostSuspendMustReconcileBeforeRetryTest = {
    init.then(recordSuspendIntent).then(callSuspend).then(loseResponse)
      .expect(and { suspendResponseLostReached, lostSuspendResponseConsumesCommandBudget, lostSuspendRequiresReconciliationBeforeRetry })
      .then(recordSuspendIntent.fail())
  }

  run lostSuspendProjectionSettlesBeforeRetryTest = {
    init.then(recordSuspendIntent).then(callSuspend).then(loseResponse)
      .then(observeProjection(ExecutingReport)).then(settleProjection)
      .expect(and { state.projectionSettlementCount == 1, projectedSuspendSettledReached, lostSuspendResponseConsumesCommandBudget, lostSuspendRequiresReconciliationBeforeRetry })
      .then(recordSuspendIntent)
      .expect(and { state.intentCount == 2, state.projectionSettlementCount == 1, lostSuspendResponseConsumesCommandBudget, lostSuspendRequiresReconciliationBeforeRetry })
  }
}
