module acceptedResultIntegrationQuarantineProofTest {
  import acceptedResultIntegrationQuarantineProof.* from "./acceptedResultIntegration_proof"

  run quarantineRecordsBeforeTargetReleaseTest = {
    init
      .then(startInitialIntegrator)
      .then(observeNotPrepared)
      .expect(and {
        state.phase == NotPreparedObserved,
        state.targetHeld,
        not(state.quarantineRecorded),
        quarantineBeforeRelease,
      })
      .then(recordQuarantine)
      .expect(and {
        state.phase == Quarantined,
        state.quarantineRecorded,
        state.quarantineOccurrenceCount == 1,
        not(state.targetHeld),
        quarantinePhaseRequiresOccurrence,
        quarantineBeforeRelease,
      })
  }

  run processLossResumesSameSessionAndOrdinalTest = {
    init
      .then(startInitialIntegrator)
      .then(loseInitialResponse)
      .expect(and {
        state.phase == IntegratorResponseLost,
        state.fixedSession == INITIAL_SESSION,
        state.integratorRunOrdinal == 1,
        state.integratorInvocationCount == 1,
        not(state.targetHeld),
        responseLostReached,
      })
      .then(observeRecoveryFacts)
      .then(resumeInitialIntegrator)
      .expect(and {
        state.phase == IntegratorInFlight,
        state.fixedSession == INITIAL_SESSION,
        state.integratorRunSession == INITIAL_SESSION,
        state.integratorRunOrdinal == 1,
        state.integratorInvocationCount == 1,
        state.lastRecoveryRunSession == INITIAL_SESSION,
        state.lastRecoveryRunOrdinal == 1,
        state.targetHeld,
        recoveryResumesSameOrdinal,
      })
  }

  run retryStartsRunTwoAndRecordsFreshQ2Test = {
    init
      .then(startInitialIntegrator)
      .then(observeNotPrepared)
      .then(recordQuarantine)
      .then(chooseRetry)
      .then(redeliverRetry)
      .then(rejectConflictingFullRerun)
      .expect(and {
        state.phase == RetrySelected,
        state.quarantineDirection == RetryDirection,
        state.quarantineDirectionCount == 1,
        state.quarantineConflictCount == 1,
        state.retryRunCount == 0,
        conflictingDirectionDoesNoWork,
      })
      .then(startRetry)
      .expect(and {
        state.phase == RetryInFlight,
        state.fixedSession == INITIAL_SESSION,
        state.integratorRunSession == INITIAL_SESSION,
        state.integratorRunOrdinal == 2,
        state.integratorInvocationCount == 2,
        state.retryRunCount == 1,
        retryRequiresSameSessionAndChoice,
        retryOrdinalAdvancesOnce,
      })
      .then(observeRetryNotPrepared)
      .expect(and {
        state.phase == RetryNotPreparedObserved,
        state.integratorOutcomeCount == 2,
        state.targetHeld,
        retryConclusiveRunRequiresFreshQ2,
      })
      .then(recordRetryQuarantine)
      .expect(and {
        state.phase == Quarantined,
        state.quarantineOccurrenceCount == 2,
        state.quarantinePosition == 2,
        not(state.targetHeld),
        retryConclusiveRunRequiresFreshQ2,
      })
  }

  run fullRerunAllowsFreshHeadEqualToFixedHeadTest = {
    init
      .then(startInitialIntegrator)
      .then(observeNotPrepared)
      .then(recordQuarantine)
      .then(chooseFullRerun)
      .then(redeliverFullRerun)
      .then(observeFreshHead(FIXED_TARGET_HEAD))
      .expect(and {
        state.phase == FreshHeadObserved,
        state.successorHeadFreshlyObserved,
        state.successorTargetHead == state.fixedTargetHead,
        state.successorHeadObservationCount == 1,
        freshObservationMayEqualFixedHead,
        fullRerunRequiresFreshObservation,
      })
      .then(startSuccessor)
      .expect(and {
        state.phase == SuccessorSessionFixed,
        state.successorSession == INITIAL_SESSION + 1,
        state.successorRunOrdinal == 1,
        state.successorInvocationCount == 1,
        state.predecessorPreserved,
        successorStartsAtFreshOrdinalOne,
      })
  }

  run fullRerunUsesFreshDifferentHeadTest = {
    init
      .then(startInitialIntegrator)
      .then(observeNotPrepared)
      .then(recordQuarantine)
      .then(chooseFullRerun)
      .then(observeFreshHead(FIXED_TARGET_HEAD + 1))
      .then(startSuccessor)
      .expect(and {
        state.phase == SuccessorSessionFixed,
        state.successorTargetHead == FIXED_TARGET_HEAD + 1,
        state.successorRunOrdinal == 1,
        fullRerunRequiresFreshObservation,
        successorStartsAtFreshOrdinalOne,
      })
  }
}
