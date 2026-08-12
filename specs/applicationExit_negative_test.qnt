// Deliberately illegal transitions prove each application Exit guard family
// has an independently stated invariant capable of turning red.
module applicationExitNegativeTest {
  import applicationExit.* from "./applicationExit"

  action closeCutoffTwice: bool = all {
    state.phase == Draining,
    state' = { ...state, cutoffCount: 2 },
  }

  action carryPreparationAcrossCutoff: bool = all {
    state.phase == Serving,
    ownerIsPreparing(state.ownerA),
    state' = { ...state, phase: Draining, cutoffCount: 1, requestCount: 1 },
  }

  action registerAfterCutoff: bool = all {
    state.phase == Draining,
    state' = {
      ...state,
      ownerA: RegisteredForwardOwner(AtomicBoundary),
      trace: { ...state.trace, postCutoffForwardRegistrations: 1 },
    },
  }

  action resetTimerForJoinedRequest: bool = all {
    state.phase == Draining,
    state.tick > 0,
    state' = {
      ...state,
      tick: 0,
      requestCount: 2,
      trace: { ...state.trace, timerResets: 1, tickRegressions: 1 },
    },
  }

  action giveJoinedRequesterDifferentResult: bool = all {
    state.requestCount == 2,
    state' = { ...state, trace: { ...state.trace, joinedResultMismatches: 1 } },
  }

  action startEveryForbiddenDrainAction: bool = all {
    state.phase == Draining,
    state' = {
      ...state,
      trace: {
        ...state.trace,
        llmRequests: 1,
        freshReconciliationReads: 1,
        stabilizationReads: 1,
        durableCleanupCalls: 1,
        attemptReplacements: 1,
        postCutoffControlApplications: 1,
        postCutoffTerminationStarts: 1,
      },
    },
  }

  action releaseAmbiguousOwnerWithoutIntent: bool = all {
    not(state.durable.ownerAIntentAcknowledged),
    state' = {
      ...state,
      ownerA: NoForwardOwner,
      ownerAAmbiguous: true,
      trace: { ...state.trace, ambiguousReleasesWithoutIntent: 1 },
    },
  }

  action recordKnownObservationWithoutIntent: bool = all {
    not(state.durable.ownerAIntentAcknowledged),
    state' = {
      ...state,
      durable: { ...state.durable, ownerAKnownObservationRecorded: true },
    },
  }

  action releaseAttemptAForForeignReport: bool = all {
    state.attemptA == AttemptRunning,
    state' = {
      ...state,
      attemptA: AttemptSafelySuspended,
      attemptAPositionHeld: false,
      trace: { ...state.trace, foreignExecutorReleases: 1 },
    },
  }

  action releaseUnsafeAttemptPosition: bool = all {
    state.attemptA == AttemptRunning,
    state' = { ...state, attemptAPositionHeld: false },
  }

  action callFastSuspensionWithoutIntent: bool = all {
    state.attemptA == AttemptRunning,
    not(state.durable.attemptASuspensionIntentAcknowledged),
    state' = { ...state, attemptA: FastSuspensionCalled },
  }

  action reportSuccessWithUnsafeAttempt: bool = all {
    state.phase == Draining,
    state.attemptA == AttemptRunning,
    state' = {
      ...state,
      phase: SuccessReported,
      result: Succeeded,
      requestedStatus: ZeroStatus,
    },
  }

  action reportFailureWhileUsefulWorkRemains: bool = all {
    state.phase == Draining,
    state.write == ProducedWritePending,
    state' = {
      ...state,
      phase: FailureReported,
      result: Failed,
      requestedStatus: NonzeroStatus,
      failureDiagnosticRetained: true,
    },
  }

  action forceTimeoutBeforeFifthTick: bool = all {
    state.phase == Draining,
    state.tick < 5,
    state' = {
      ...state,
      phase: ProcessGoneTimeout,
      result: TimedOut,
      requestedStatus: NonzeroStatus,
      trace: { ...state.trace, forcedTerminationRequested: true },
    },
  }

  action fifthTickWithoutForcedTermination: bool = all {
    state.phase == Draining,
    state' = {
      ...state,
      phase: ProcessGoneTimeout,
      tick: 5,
      result: TimedOut,
      requestedStatus: NonzeroStatus,
    },
  }

  action forceFailureWithZeroStatus: bool = all {
    state.failureDiagnosticRetained,
    state' = {
      ...state,
      phase: ProcessGoneFailure,
      result: Failed,
      requestedStatus: ZeroStatus,
      trace: { ...state.trace, forcedTerminationRequested: true },
    },
  }

  action stopGracefullyWithoutSuccessReport: bool = all {
    state.phase == Draining,
    state' = {
      ...state,
      phase: ProcessGoneGraceful,
      trace: { ...state.trace, gracefulTerminationRequested: true },
    },
  }

  action callUnexpectedDeathSuccess: bool = all {
    state.phase == Draining,
    state' = {
      ...state,
      phase: ProcessGoneUnexpected,
      result: Succeeded,
      requestedStatus: ZeroStatus,
      trace: { ...state.trace, unexpectedDeathObserved: true },
    },
  }

  action terminateRunWithoutAuthorization: bool = all {
    not(state.durable.runTerminationAuthorized),
    state' = { ...state, durable: { ...state.durable, runTerminated: true } },
  }

  action appendExitToWorkflowHistory: bool = all {
    state' = {
      ...state,
      durable: { ...state.durable, workflowExitRecords: 1 },
      trace: { ...state.trace, manufacturedWorkflowOutcomes: 1 },
    },
  }

  action disposeDurableWorkflowResource: bool = all {
    state.durable.durableResourcesPreserved,
    state' = {
      ...state,
      durable: { ...state.durable, durableResourcesPreserved: false },
      trace: { ...state.trace, durableCleanupCalls: 1 },
    },
  }

  action restartWithOldLifecycleState: bool = all {
    processIsGone(state.phase),
    state' = {
      ...state,
      phase: Serving,
      trace: { ...state.trace, restarted: true, restartClearedLifecycle: false },
    },
  }

  run secondCutoffIsDetectedTest = {
    init.then(acceptExit).then(closeCutoffTwice).expect(not(cutoffClosesAtMostOncePerApplicationIncarnation))
  }

  run preparationStraddlingCutoffIsDetectedTest = {
    init.then(prepareAtomicOwnerA).then(carryPreparationAcrossCutoff)
      .expect(not(preparingAdmissionNeverSurvivesTheCutoff))
  }

  run postCutoffRegistrationIsDetectedTest = {
    init.then(acceptExit).then(registerAfterCutoff).expect(not(forwardOwnerRegistrationRequiresServing))
  }

  run joinedRequestTimerResetIsDetectedTest = {
    init.then(acceptExit).then(advanceTick).then(resetTimerForJoinedRequest)
      .expect(not(joinedRequestNeverResetsTheDrain))
  }

  run joinedRequestResultDivergenceIsDetectedTest = {
    init.then(acceptExit).then(joinExit).then(giveJoinedRequesterDifferentResult)
      .expect(not(joinedRequestsReceiveOneSharedResult))
  }

  run forbiddenDrainActionsAreDetectedTest = {
    init.then(acceptExit).then(startEveryForbiddenDrainAction)
      .expect(not(onlyEnumeratedQuickDrainActionsBeginAfterCutoff))
  }

  run unacknowledgedAmbiguityIsDetectedTest = {
    init.then(releaseAmbiguousOwnerWithoutIntent)
      .expect(not(recoverableAmbiguityRequiresAcknowledgedExactIntent))
  }

  run unacknowledgedKnownObservationIsDetectedTest = {
    init.then(recordKnownObservationWithoutIntent)
      .expect(not(knownBoundaryObservationRequiresItsAcknowledgedIntent))
  }

  run foreignExecutorReleaseIsDetectedTest = {
    init.then(startAttemptA).then(releaseAttemptAForForeignReport)
      .expect(not(exactSafeOrTerminalEvidenceControlsPositionRelease))
  }

  run unsafePositionReleaseIsDetectedTest = {
    init.then(startAttemptA).then(releaseUnsafeAttemptPosition)
      .expect(not(exactSafeOrTerminalEvidenceControlsPositionRelease))
  }

  run fastCallWithoutIntentIsDetectedTest = {
    init.then(startAttemptA).then(callFastSuspensionWithoutIntent)
      .expect(not(fastSuspensionRequiresAcknowledgedCommandIntent))
  }

  run unsafeSuccessIsDetectedTest = {
    init.then(startAttemptA).then(acceptExit).then(reportSuccessWithUnsafeAttempt)
      .expect(not(successfulExitRequiresRecoverableBoundary))
  }

  run earlyConclusiveFailureIsDetectedTest = {
    init.then(produceJournalWrite).then(acceptExit).then(reportFailureWhileUsefulWorkRemains)
      .expect(not(conclusiveFailureWaitsForUsefulQuickWork))
  }

  run timeoutBeforeFifthTickIsDetectedTest = {
    init.then(acceptExit).then(forceTimeoutBeforeFifthTick)
      .expect(not(fifthTickAtomicallyForcesTimedOutTermination))
  }

  run fifthTickWithoutForceIsDetectedTest = {
    init.then(acceptExit).then(fifthTickWithoutForcedTermination)
      .expect(not(fifthTickAtomicallyForcesTimedOutTermination))
  }

  run zeroStatusFailureIsDetectedTest = {
    init.then(produceJournalWrite).then(acceptExit).then(failProducedWrite)
      .then(forceFailureWithZeroStatus)
      .expect(not(failureAndTimeoutRequestNonzeroForcedTermination))
  }

  run gracefulStopWithoutReportIsDetectedTest = {
    init.then(acceptExit).then(stopGracefullyWithoutSuccessReport)
      .expect(not(successReportsBeforeGracefulProcessEnd))
  }

  run unexpectedDeathSuccessIsDetectedTest = {
    init.then(acceptExit).then(callUnexpectedDeathSuccess)
      .expect(not(unexpectedDeathNeverReportsGracefulSuccess))
  }

  run unauthorizedRunTerminationIsDetectedTest = {
    init.then(terminateRunWithoutAuthorization).expect(not(runTerminationRequiresPreCutoffAuthorization))
  }

  run workflowExitRecordIsDetectedTest = {
    init.then(appendExitToWorkflowHistory).expect(not(applicationLifecycleNeverEntersWorkflowHistory))
  }

  run durableResourceDisposalIsDetectedTest = {
    init.then(disposeDurableWorkflowResource).expect(not(exitNeverDisposesDurableWorkflowResources))
  }

  run restoredLifecycleModeIsDetectedTest = {
    init.then(acceptExit).then(unexpectedDeath).then(restartWithOldLifecycleState)
      .expect(not(restartRestoresNoApplicationLifecycleState))
  }
}
