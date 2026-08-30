module plannedAttemptExecutorEvidenceProofNegativeTest {
  import plannedAttemptExecutorEvidenceProof.* from "./plannedAttemptExecutor_proof"

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
