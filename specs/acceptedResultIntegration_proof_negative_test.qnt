// Mutation controls for the finite accepted-result quarantine proof. Each
// action performs one forbidden transition and the paired test proves that a
// projected invariant turns red.
module acceptedResultIntegrationQuarantineProofNegativeTest {
  import acceptedResultIntegrationQuarantineProof.* from "./acceptedResultIntegration_proof"

  action releaseBeforeQuarantine: bool = all {
    state.phase == NotPreparedObserved,
    state' = { ...state, targetHeld: false },
  }

  action quarantineWithoutOccurrence: bool = all {
    state.phase == NotPreparedObserved,
    state' = {
      ...state,
      phase: Quarantined,
      targetHeld: false,
      quarantineRecorded: false,
      quarantineOccurrenceCount: 0,
    },
  }

  action retryWithoutChoice: bool = all {
    state.phase == Quarantined,
    state' = {
      ...state,
      phase: RetryInFlight,
      targetHeld: true,
      retryRunCount: 1,
      integratorInvocationCount: 2,
      integratorRunOrdinal: 2,
      integratorRunSession: state.fixedSession,
    },
  }

  action conflictingDirectionWins: bool = all {
    state.phase == RetrySelected,
    state.quarantineDirection == RetryDirection,
    state' = {
      ...state,
      quarantineDirection: FullRerunDirection,
      quarantineConflictCount: 1,
    },
  }

  action retryUsesNewSession: bool = all {
    state.phase == RetrySelected,
    state' = {
      ...state,
      phase: RetryInFlight,
      targetHeld: true,
      retryRunCount: 1,
      integratorInvocationCount: 2,
      integratorRunOrdinal: 2,
      integratorRunSession: state.fixedSession + 1,
    },
  }

  action recoveryChangesOrdinal: bool = all {
    state.phase == IntegratorResponseLost,
    state.targetFactsCurrent,
    state' = {
      ...state,
      phase: IntegratorInFlight,
      targetHeld: true,
      lastRecoveryRunSession: state.fixedSession,
      lastRecoveryRunOrdinal: 1,
      integratorRunSession: state.fixedSession,
      integratorRunOrdinal: 2,
      integratorInvocationCount: 2,
    },
  }

  action successorWithoutFreshRead: bool = all {
    state.phase == FullRerunSelected,
    state' = {
      ...state,
      phase: SuccessorSessionFixed,
      targetHeld: true,
      successorSession: INITIAL_SESSION + 1,
      successorResource: INITIAL_RESOURCE + 1000,
      successorTargetHead: state.fixedTargetHead,
      successorRunOrdinal: 1,
      successorInvocationCount: 1,
      predecessorPreserved: true,
      successorHeadFreshlyObserved: false,
      successorHeadObservationCount: 0,
    },
  }

  action successorOrdinalTwo: bool = all {
    state.phase == FreshHeadObserved,
    state' = {
      ...state,
      phase: SuccessorSessionFixed,
      targetHeld: true,
      successorSession: INITIAL_SESSION + 1,
      successorResource: INITIAL_RESOURCE + 1000,
      successorRunOrdinal: 2,
      successorInvocationCount: 1,
      predecessorPreserved: true,
    },
  }

  action directionAfterRunTwoWithoutQ2: bool = all {
    state.phase == RetryNotPreparedObserved,
    state.integratorOutcomeCount == 2,
    state' = {
      ...state,
      phase: FullRerunSelected,
      quarantineDirection: FullRerunDirection,
      quarantineDirectionSession: state.fixedSession,
      quarantineDirectionPosition: state.quarantinePosition,
      quarantineDirectionCount: 1,
    },
  }

  run releaseBeforeQuarantineIsDetectedTest = {
    init
      .then(startInitialIntegrator)
      .then(observeNotPrepared)
      .then(releaseBeforeQuarantine)
      .expect(not(quarantineBeforeRelease))
  }

  run quarantineWithoutOccurrenceIsDetectedTest = {
    init
      .then(startInitialIntegrator)
      .then(observeNotPrepared)
      .then(quarantineWithoutOccurrence)
      .expect(not(quarantinePhaseRequiresOccurrence))
  }

  run retryWithoutChoiceIsDetectedTest = {
    init
      .then(startInitialIntegrator)
      .then(observeNotPrepared)
      .then(recordQuarantine)
      .then(retryWithoutChoice)
      .expect(and {
        not(firstDirectionWins),
        not(retryRequiresSameSessionAndChoice),
      })
  }

  run conflictingDirectionReplacementIsDetectedTest = {
    init
      .then(startInitialIntegrator)
      .then(observeNotPrepared)
      .then(recordQuarantine)
      .then(chooseRetry)
      .then(conflictingDirectionWins)
      .expect(and {
        not(firstDirectionWins),
        not(conflictingDirectionDoesNoWork),
      })
  }

  run retryNewSessionIsDetectedTest = {
    init
      .then(startInitialIntegrator)
      .then(observeNotPrepared)
      .then(recordQuarantine)
      .then(chooseRetry)
      .then(retryUsesNewSession)
      .expect(not(retryRequiresSameSessionAndChoice))
  }

  run recoveryOrdinalChangeIsDetectedTest = {
    init
      .then(startInitialIntegrator)
      .then(loseInitialResponse)
      .then(observeRecoveryFacts)
      .then(recoveryChangesOrdinal)
      .expect(not(recoveryResumesSameOrdinal))
  }

  run successorWithoutFreshReadIsDetectedTest = {
    init
      .then(startInitialIntegrator)
      .then(observeNotPrepared)
      .then(recordQuarantine)
      .then(chooseFullRerun)
      .then(successorWithoutFreshRead)
      .expect(and {
        not(fullRerunRequiresFreshObservation),
        not(successorStartsAtFreshOrdinalOne),
      })
  }

  run successorOrdinalTwoIsDetectedTest = {
    init
      .then(startInitialIntegrator)
      .then(observeNotPrepared)
      .then(recordQuarantine)
      .then(chooseFullRerun)
      .then(observeFreshHead(FIXED_TARGET_HEAD))
      .then(successorOrdinalTwo)
      .expect(not(successorStartsAtFreshOrdinalOne))
  }

  run runTwoNeedsFreshQ2BeforeDirectionIsDetectedTest = {
    init
      .then(startInitialIntegrator)
      .then(observeNotPrepared)
      .then(recordQuarantine)
      .then(chooseRetry)
      .then(startRetry)
      .then(observeRetryNotPrepared)
      .then(directionAfterRunTwoWithoutQ2)
      .expect(not(retryConclusiveRunRequiresFreshQ2))
  }
}
