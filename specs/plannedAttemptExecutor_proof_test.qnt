module plannedAttemptExecutorEvidenceProofTest {
  import plannedAttemptExecutorEvidenceProof.* from "./plannedAttemptExecutor_proof"

  run absentReplacementAndRepeatedCrashCutsTest = {
    init.then(recordBeginIntent).then(callBeginPreTurn)
      .then(readEmptyAbsence).then(loseReplacementProcess)
      .expect(state.stage == BeginPreTurn)
      .then(readEmptyAbsence).then(recordEmptyReplacementIntent).then(loseReplacementProcess)
      .then(allocateReplacementThread).then(loseReplacementProcess)
      .expect(state.stage == EmptyReplacement)
      .then(allocateReplacementThread).then(associateReplacementThread)
      .expect(state.stage == BeginFreshReplacement).then(loseReplacementProcess)
      .then(observeBeginNotCrossed).then(loseBeginProof)
      .then(observeBeginNotCrossed).then(redeliverBegin).then(crossBeginTurn)
      .expect(and { state.beginCount == 1, state.beginTurnCrossingCount == 1, replacementRequiresFreshAbsence, allocationRequiresDurableEmptyIntent, redeliveryNeverAllocates })
  }

  run unsafeThreadNeverAllocatesTest = {
    init.then(recordBeginIntent).then(callBeginPreTurn).then(readUnsafePreTurn)
      .then(recordEmptyReplacementIntent).fail()
  }

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
