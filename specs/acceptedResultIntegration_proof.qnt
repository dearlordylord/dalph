// Complete finite proof projection for the accepted-result Integrator
// quarantine boundary. The canonical model remains the behavior vocabulary
// and sampled/collected source; this projection owns the exhaustive proof of
// its issue #68 quarantine, recovery, Retry, and FullRerun chronology.
module acceptedResultIntegrationQuarantineProof {
  type Phase =
    | Ready
    | IntegratorInFlight
    | IntegratorResponseLost
    | NotPreparedObserved
    | Quarantined
    | RetrySelected
    | RetryInFlight
    | RetryNotPreparedObserved
    | FullRerunSelected
    | FreshHeadObserved
    | SuccessorSessionFixed

  type Direction = NoDirection | RetryDirection | FullRerunDirection

  type Event =
    | Initialized
    | InitialIntegratorStarted
    | InitialResponseLost
    | RecoveryFactsObserved
    | InitialRunResumed
    | NotPreparedRecorded
    | QuarantineRecorded
    | RetryChosen
    | FullRerunChosen
    | DirectionRedelivered
    | ConflictingDirectionRejected
    | RetryStarted
    | RetryNotPreparedRecorded
    | RetryQuarantineRecorded
    | FreshHeadObservedEvent
    | SuccessorStarted

  type State = {
    phase: Phase,
    lastEvent: Event,
    targetHeld: bool,
    queuePosition: int,
    fixedSession: int,
    fixedResource: int,
    fixedTargetHead: int,
    integratorInvocationCount: int,
    integratorRunOrdinal: int,
    integratorRunSession: int,
    integratorOutcomeRecorded: bool,
    integratorOutcomeCount: int,
    targetFactsCurrent: bool,
    targetHeadProof: int,
    targetReacquisitionRequired: bool,
    lastRecoveryRunSession: int,
    lastRecoveryRunOrdinal: int,
    quarantineRecorded: bool,
    quarantineOccurrenceCount: int,
    quarantinePosition: int,
    quarantineDirection: Direction,
    quarantineDirectionSession: int,
    quarantineDirectionPosition: int,
    quarantineDirectionCount: int,
    quarantineRedeliveryCount: int,
    quarantineConflictCount: int,
    retryRunCount: int,
    successorHeadFreshlyObserved: bool,
    successorHeadObservationCount: int,
    successorTargetHead: int,
    successorSession: int,
    successorResource: int,
    successorRunOrdinal: int,
    successorInvocationCount: int,
    predecessorPreserved: bool,
  }

  var state: State

  pure val INITIAL_SESSION = 1
  pure val INITIAL_RESOURCE = 101
  pure val FIXED_TARGET_HEAD = 1
  pure val QUEUE_POSITION = 1

  pure def quarantinePhase(phase: Phase): bool =
    Set(
      Quarantined,
      RetrySelected,
      RetryInFlight,
      FullRerunSelected,
      FreshHeadObserved,
      SuccessorSessionFixed,
    ).contains(phase)

  // The unsuccessful outer result still owns the live target until the
  // separate durable quarantine occurrence is recorded.
  val quarantineBeforeRelease: bool = and {
    state.phase != NotPreparedObserved or and {
      state.targetHeld,
      not(state.quarantineRecorded),
    },
    state.phase != RetryNotPreparedObserved or and {
      state.targetHeld,
      state.quarantineRecorded,
      state.quarantineOccurrenceCount == 1,
    },
  }

  val quarantinePhaseRequiresOccurrence: bool =
    not(quarantinePhase(state.phase)) or and {
      state.quarantineRecorded,
      state.quarantineOccurrenceCount > 0,
      state.quarantineOccurrenceCount <= 2,
      state.quarantinePosition > 0,
      state.integratorOutcomeRecorded,
    }

  val firstDirectionWins: bool = and {
    state.quarantineDirectionCount >= 0,
    state.quarantineDirectionCount <= 1,
    state.quarantineDirection == NoDirection implies and {
      state.quarantineDirectionSession == 0,
      state.quarantineDirectionPosition == 0,
    },
    state.quarantineDirection != NoDirection implies and {
      state.quarantineRecorded,
      state.quarantineDirectionCount == 1,
      state.quarantineDirectionSession == state.fixedSession,
      state.quarantineDirectionPosition == state.quarantinePosition,
    },
    state.phase == RetrySelected
      or state.phase == RetryInFlight
      or state.phase == RetryNotPreparedObserved
      implies state.quarantineDirection == RetryDirection,
    state.phase == FullRerunSelected
      or state.phase == FreshHeadObserved
      or state.phase == SuccessorSessionFixed
      implies state.quarantineDirection == FullRerunDirection,
  }

  // A conflicting request changes only durable conflict evidence. It cannot
  // replace the first direction or allocate either kind of run.
  val conflictingDirectionDoesNoWork: bool =
    state.quarantineConflictCount == 0 or and {
      state.quarantineDirection == RetryDirection,
      state.quarantineDirectionCount == 1,
      state.successorSession == 0,
    }

  val retryRequiresSameSessionAndChoice: bool =
    state.retryRunCount == 0 or and {
      state.integratorRunSession == state.fixedSession,
      state.integratorInvocationCount == 2,
      state.integratorRunOrdinal == 2,
      state.quarantineOccurrenceCount == 1 implies and {
        state.phase == RetryInFlight or state.phase == RetryNotPreparedObserved,
        state.quarantineDirection == RetryDirection,
        state.quarantineDirectionSession == state.fixedSession,
        state.quarantineDirectionPosition == state.quarantinePosition,
        state.targetHeld,
        state.targetFactsCurrent,
        state.targetHeadProof == state.fixedTargetHead,
      },
      state.quarantineOccurrenceCount == 2 implies and {
        state.quarantineRecorded,
        state.quarantinePosition == 2,
      },
    }

  val retryConclusiveRunRequiresFreshQ2: bool =
    state.integratorOutcomeCount < 2 or and {
      state.retryRunCount == 1,
      state.integratorInvocationCount == 2,
      state.integratorRunOrdinal == 2,
      state.integratorRunSession == state.fixedSession,
      state.phase == RetryNotPreparedObserved
        or state.phase == Quarantined
        or state.phase == FullRerunSelected
        or state.phase == FreshHeadObserved
        or state.phase == SuccessorSessionFixed,
      state.phase == RetryNotPreparedObserved implies state.targetHeld,
      state.phase != RetryNotPreparedObserved implies and {
        state.quarantineRecorded,
        state.quarantineOccurrenceCount == 2,
        state.quarantinePosition == 2,
      },
    }

  val retryOrdinalAdvancesOnce: bool = and {
    state.integratorInvocationCount >= 0,
    state.integratorInvocationCount <= 2,
    state.integratorRunOrdinal >= 0,
    state.integratorRunOrdinal <= 2,
    state.retryRunCount >= 0,
    state.retryRunCount <= 1,
    state.retryRunCount == 0 implies and {
      state.integratorInvocationCount <= 1,
      state.integratorRunOrdinal <= 1,
    },
    state.retryRunCount == 1 implies and {
      state.integratorInvocationCount == 2,
      state.integratorRunOrdinal == 2,
    },
  }

  val recoveryResumesSameOrdinal: bool =
    state.lastRecoveryRunSession == 0 or and {
      state.phase == IntegratorInFlight,
      state.lastRecoveryRunSession == state.fixedSession,
      state.lastRecoveryRunOrdinal == 1,
      state.integratorRunSession == state.fixedSession,
      state.integratorRunOrdinal == 1,
      state.integratorInvocationCount == 1,
    }

  val fullRerunRequiresFreshObservation: bool =
    state.phase != SuccessorSessionFixed or and {
      state.successorHeadFreshlyObserved,
      state.successorHeadObservationCount == 1,
      state.targetFactsCurrent,
      state.targetHeadProof == state.successorTargetHead,
      state.successorTargetHead == state.fixedTargetHead
        or state.successorTargetHead == state.fixedTargetHead + 1,
    }

  // Equality with H is deliberately allowed. Fresh observation causality,
  // not numeric inequality, distinguishes a valid successor head.
  val successorStartsAtFreshOrdinalOne: bool =
    state.successorSession == 0 or and {
      state.predecessorPreserved,
      state.successorHeadFreshlyObserved,
      state.successorHeadObservationCount == 1,
      state.successorRunOrdinal == 1,
      state.successorInvocationCount == 1,
      state.successorResource == INITIAL_RESOURCE + 1000,
      state.successorTargetHead == state.targetHeadProof,
    }

  val freshObservationMayEqualFixedHead: bool =
    state.successorSession == 0
      or state.successorTargetHead != state.fixedTargetHead
      or state.successorHeadFreshlyObserved

  val proofStateIsBounded: bool = and {
    state.queuePosition == QUEUE_POSITION,
    state.fixedSession >= 0,
    state.fixedSession <= INITIAL_SESSION,
    state.fixedResource == 0 or state.fixedResource == INITIAL_RESOURCE,
    state.fixedTargetHead == 0 or state.fixedTargetHead == FIXED_TARGET_HEAD,
    state.quarantineOccurrenceCount >= 0,
    state.quarantineOccurrenceCount <= 2,
    state.quarantineRedeliveryCount >= 0,
    state.quarantineRedeliveryCount <= 1,
    state.quarantineConflictCount >= 0,
    state.quarantineConflictCount <= 1,
    state.successorHeadObservationCount >= 0,
    state.successorHeadObservationCount <= 1,
    state.successorSession == 0 or state.successorSession == INITIAL_SESSION + 1,
    state.successorInvocationCount >= 0,
    state.successorInvocationCount <= 1,
  }

  val quarantinePendingReached: bool = state.lastEvent == NotPreparedRecorded
  val quarantinedReached: bool = state.lastEvent == QuarantineRecorded
  val retrySelectedReached: bool = state.lastEvent == RetryChosen
  val retryInFlightReached: bool = state.lastEvent == RetryStarted
  val retryNotPreparedReached: bool = state.lastEvent == RetryNotPreparedRecorded
  val retryQuarantineRecordedReached: bool = state.lastEvent == RetryQuarantineRecorded
  val responseLostReached: bool = state.lastEvent == InitialResponseLost
  val recoveredInitialReached: bool = state.lastEvent == InitialRunResumed
  val fullRerunSelectedReached: bool = state.lastEvent == FullRerunChosen
  val freshHeadObservedReached: bool = state.lastEvent == FreshHeadObservedEvent
  val successorSessionFixedReached: bool = state.lastEvent == SuccessorStarted
  val conflictRejectedReached: bool = state.lastEvent == ConflictingDirectionRejected

  action init: bool = all {
    state' = {
      phase: Ready,
      lastEvent: Initialized,
      targetHeld: true,
      queuePosition: QUEUE_POSITION,
      fixedSession: 0,
      fixedResource: 0,
      fixedTargetHead: 0,
      integratorInvocationCount: 0,
      integratorRunOrdinal: 0,
      integratorRunSession: 0,
      integratorOutcomeRecorded: false,
      integratorOutcomeCount: 0,
      targetFactsCurrent: true,
      targetHeadProof: 0,
      targetReacquisitionRequired: false,
      lastRecoveryRunSession: 0,
      lastRecoveryRunOrdinal: 0,
      quarantineRecorded: false,
      quarantineOccurrenceCount: 0,
      quarantinePosition: 0,
      quarantineDirection: NoDirection,
      quarantineDirectionSession: 0,
      quarantineDirectionPosition: 0,
      quarantineDirectionCount: 0,
      quarantineRedeliveryCount: 0,
      quarantineConflictCount: 0,
      retryRunCount: 0,
      successorHeadFreshlyObserved: false,
      successorHeadObservationCount: 0,
      successorTargetHead: 0,
      successorSession: 0,
      successorResource: 0,
      successorRunOrdinal: 0,
      successorInvocationCount: 0,
      predecessorPreserved: false,
    },
  }

  action startInitialIntegrator: bool = all {
    state.phase == Ready,
    state.fixedSession == 0,
    state.targetFactsCurrent,
    state' = {
      ...state,
      phase: IntegratorInFlight,
      lastEvent: InitialIntegratorStarted,
      targetHeld: true,
      fixedSession: INITIAL_SESSION,
      fixedResource: INITIAL_RESOURCE,
      fixedTargetHead: FIXED_TARGET_HEAD,
      integratorInvocationCount: 1,
      integratorRunOrdinal: 1,
      integratorRunSession: INITIAL_SESSION,
      targetHeadProof: FIXED_TARGET_HEAD,
    },
  }

  action loseInitialResponse: bool = all {
    state.phase == IntegratorInFlight,
    state.integratorInvocationCount == 1,
    state.integratorRunOrdinal == 1,
    state' = {
      ...state,
      phase: IntegratorResponseLost,
      lastEvent: InitialResponseLost,
      targetHeld: false,
      targetFactsCurrent: false,
      targetHeadProof: 0,
      targetReacquisitionRequired: true,
      lastRecoveryRunSession: 0,
      lastRecoveryRunOrdinal: 0,
    },
  }

  action observeRecoveryFacts: bool = all {
    state.phase == IntegratorResponseLost,
    state.targetReacquisitionRequired,
    state' = {
      ...state,
      lastEvent: RecoveryFactsObserved,
      targetFactsCurrent: true,
      targetHeadProof: state.fixedTargetHead,
      targetReacquisitionRequired: false,
    },
  }

  action resumeInitialIntegrator: bool = all {
    state.phase == IntegratorResponseLost,
    state.targetFactsCurrent,
    state.targetHeadProof == state.fixedTargetHead,
    state.integratorInvocationCount == 1,
    state.integratorRunOrdinal == 1,
    state' = {
      ...state,
      phase: IntegratorInFlight,
      lastEvent: InitialRunResumed,
      targetHeld: true,
      lastRecoveryRunSession: state.fixedSession,
      lastRecoveryRunOrdinal: state.integratorRunOrdinal,
    },
  }

  action observeNotPrepared: bool = all {
    state.phase == IntegratorInFlight,
    state.targetHeld,
    state.integratorInvocationCount == 1,
    state' = {
      ...state,
      phase: NotPreparedObserved,
      lastEvent: NotPreparedRecorded,
      targetHeld: true,
      integratorOutcomeRecorded: true,
      integratorOutcomeCount: 1,
      lastRecoveryRunSession: 0,
      lastRecoveryRunOrdinal: 0,
    },
  }

  action recordQuarantine: bool = all {
    state.phase == NotPreparedObserved,
    state.targetHeld,
    state.integratorOutcomeRecorded,
    not(state.quarantineRecorded),
    state' = {
      ...state,
      phase: Quarantined,
      lastEvent: QuarantineRecorded,
      targetHeld: false,
      quarantineRecorded: true,
      quarantineOccurrenceCount: 1,
      quarantinePosition: QUEUE_POSITION,
      quarantineDirection: NoDirection,
      quarantineDirectionSession: 0,
      quarantineDirectionPosition: 0,
      quarantineDirectionCount: 0,
      quarantineConflictCount: 0,
    },
  }

  action observeRetryNotPrepared: bool = all {
    state.phase == RetryInFlight,
    state.retryRunCount == 1,
    state.integratorInvocationCount == 2,
    state.integratorRunOrdinal == 2,
    state.targetHeld,
    state' = {
      ...state,
      phase: RetryNotPreparedObserved,
      lastEvent: RetryNotPreparedRecorded,
      targetHeld: true,
      integratorOutcomeRecorded: true,
      integratorOutcomeCount: 2,
    },
  }

  action recordRetryQuarantine: bool = all {
    state.phase == RetryNotPreparedObserved,
    state.targetHeld,
    state.integratorOutcomeCount == 2,
    state.quarantineOccurrenceCount == 1,
    state' = {
      ...state,
      phase: Quarantined,
      lastEvent: RetryQuarantineRecorded,
      targetHeld: false,
      quarantineRecorded: true,
      quarantineOccurrenceCount: 2,
      quarantinePosition: 2,
      quarantineDirection: NoDirection,
      quarantineDirectionSession: 0,
      quarantineDirectionPosition: 0,
      quarantineDirectionCount: 0,
      quarantineConflictCount: 0,
    },
  }

  action chooseRetry: bool = all {
    state.phase == Quarantined,
    state.quarantineRecorded,
    state.quarantineDirection == NoDirection,
    state.retryRunCount == 0,
    state' = {
      ...state,
      phase: RetrySelected,
      lastEvent: RetryChosen,
      quarantineDirection: RetryDirection,
      quarantineDirectionSession: state.fixedSession,
      quarantineDirectionPosition: state.quarantinePosition,
      quarantineDirectionCount: 1,
    },
  }

  action chooseFullRerun: bool = all {
    state.phase == Quarantined,
    state.quarantineRecorded,
    state.quarantineDirection == NoDirection,
    state' = {
      ...state,
      phase: FullRerunSelected,
      lastEvent: FullRerunChosen,
      quarantineDirection: FullRerunDirection,
      quarantineDirectionSession: state.fixedSession,
      quarantineDirectionPosition: state.quarantinePosition,
      quarantineDirectionCount: 1,
    },
  }

  action redeliverRetry: bool = all {
    state.phase == RetrySelected,
    state.quarantineDirection == RetryDirection,
    state.quarantineDirectionSession == state.fixedSession,
    state.quarantineDirectionPosition == state.quarantinePosition,
    state.quarantineRedeliveryCount == 0,
    state' = {
      ...state,
      lastEvent: DirectionRedelivered,
      quarantineRedeliveryCount: state.quarantineRedeliveryCount + 1,
    },
  }

  action redeliverFullRerun: bool = all {
    state.phase == FullRerunSelected,
    state.quarantineDirection == FullRerunDirection,
    state.quarantineDirectionSession == state.fixedSession,
    state.quarantineDirectionPosition == state.quarantinePosition,
    state.quarantineRedeliveryCount == 0,
    state' = {
      ...state,
      lastEvent: DirectionRedelivered,
      quarantineRedeliveryCount: state.quarantineRedeliveryCount + 1,
    },
  }

  action rejectConflictingFullRerun: bool = all {
    state.phase == RetrySelected,
    state.quarantineDirection == RetryDirection,
    state.quarantineDirectionCount == 1,
    state.quarantineConflictCount == 0,
    state' = {
      ...state,
      lastEvent: ConflictingDirectionRejected,
      quarantineConflictCount: state.quarantineConflictCount + 1,
    },
  }

  action startRetry: bool = all {
    state.phase == RetrySelected,
    state.quarantineDirection == RetryDirection,
    state.quarantineDirectionSession == state.fixedSession,
    state.quarantineDirectionPosition == state.quarantinePosition,
    state.retryRunCount == 0,
    state.targetFactsCurrent,
    state.targetHeadProof == state.fixedTargetHead,
    state' = {
      ...state,
      phase: RetryInFlight,
      lastEvent: RetryStarted,
      targetHeld: true,
      retryRunCount: 1,
      integratorInvocationCount: 2,
      integratorRunOrdinal: 2,
      integratorRunSession: state.fixedSession,
      lastRecoveryRunSession: 0,
      lastRecoveryRunOrdinal: 0,
    },
  }

  action observeFreshHead(observedHead: int): bool = all {
    state.phase == FullRerunSelected,
    state.quarantineDirection == FullRerunDirection,
    state.quarantineDirectionSession == state.fixedSession,
    state.quarantineDirectionPosition == state.quarantinePosition,
    state.successorHeadObservationCount == 0,
    observedHead == state.fixedTargetHead or observedHead == state.fixedTargetHead + 1,
    state' = {
      ...state,
      phase: FreshHeadObserved,
      lastEvent: FreshHeadObservedEvent,
      targetHeld: false,
      targetFactsCurrent: true,
      targetHeadProof: observedHead,
      targetReacquisitionRequired: false,
      successorHeadFreshlyObserved: true,
      successorHeadObservationCount: 1,
      successorTargetHead: observedHead,
    },
  }

  action startSuccessor: bool = all {
    state.phase == FreshHeadObserved,
    state.successorHeadFreshlyObserved,
    state.successorHeadObservationCount == 1,
    state.targetFactsCurrent,
    state.targetHeadProof == state.successorTargetHead,
    state.successorSession == 0,
    state' = {
      ...state,
      phase: SuccessorSessionFixed,
      lastEvent: SuccessorStarted,
      targetHeld: true,
      successorSession: INITIAL_SESSION + 1,
      successorResource: INITIAL_RESOURCE + 1000,
      successorRunOrdinal: 1,
      successorInvocationCount: 1,
      predecessorPreserved: true,
    },
  }

  action step: bool = any {
    startInitialIntegrator,
    loseInitialResponse,
    observeRecoveryFacts,
    resumeInitialIntegrator,
    observeNotPrepared,
    recordQuarantine,
    chooseRetry,
    chooseFullRerun,
    redeliverRetry,
    redeliverFullRerun,
    rejectConflictingFullRerun,
    startRetry,
    observeRetryNotPrepared,
    recordRetryQuarantine,
    observeFreshHead(FIXED_TARGET_HEAD),
    observeFreshHead(FIXED_TARGET_HEAD + 1),
    startSuccessor,
  }
}
