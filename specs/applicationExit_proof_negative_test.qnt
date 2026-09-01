// Deliberately illegal transitions show that every application Exit proof
// safety family can turn red. They are negative controls, not behavior.
module applicationExitAdmissionProofNegativeTest {
  import applicationExitAdmissionProof.* from "./applicationExit_proof"

  action closeCutoffTwice: bool = all {
    state.phase == Draining,
    state' = { ...state, cutoffCount: 2 },
  }

  action carryPreparationAcrossCutoff: bool = all {
    state.phase == Serving,
    state.ownerA == PreparingOwner,
    state' = { ...state, phase: Draining, cutoffCount: 1, requestCount: 1 },
  }

  action registerAfterCutoff: bool = all {
    state.phase == Draining,
    state' = {
      ...state,
      ownerA: RegisteredOwner,
      postCutoffRegistrations: 1,
    },
  }

  action resetJoinedTimer: bool = all {
    state.requestCount == 2,
    state.tick > 0,
    state' = {
      ...state,
      tick: 0,
      timerResets: 1,
      tickRegressions: 1,
    },
  }

  action publishDifferentJoinedResult: bool = all {
    state.requestCount == 2,
    state' = { ...state, result: SharedResult, joinedResult: NoResult },
  }

  action advancePastFifthTick: bool = all {
    state.tick == 5,
    state' = { ...state, tick: 6 },
  }

  run duplicateCutoffIsDetectedTest = {
    init.then(acceptExit).then(closeCutoffTwice).expect(not(cutoffClosesAtMostOnce))
  }

  run preparationAcrossCutoffIsDetectedTest = {
    init.then(prepareOwnerA).then(carryPreparationAcrossCutoff)
      .expect(not(preparingNeverSurvivesCutoff))
  }

  run postCutoffRegistrationIsDetectedTest = {
    init.then(acceptExit).then(registerAfterCutoff).expect(not(registrationRequiresServing))
  }

  run joinedTimerResetIsDetectedTest = {
    init.then(acceptExit).then(advanceTick).then(joinExit).then(resetJoinedTimer)
      .expect(not(joinedRequestDoesNotResetTimer))
  }

  run joinedResultMismatchIsDetectedTest = {
    init.then(acceptExit).then(joinExit).then(publishDifferentJoinedResult)
      .expect(not(joinedRequestsShareResult))
  }

  run sixthTickIsDetectedTest = {
    init
      .then(acceptExit)
      .then(advanceTick).then(advanceTick).then(advanceTick).then(advanceTick).then(advanceTick)
      .then(advancePastFifthTick)
      .expect(not(admissionProofTypeOk))
  }
}

module applicationExitOwnerProofNegativeTest {
  import applicationExitOwnerProof.* from "./applicationExit_proof"

  action beginForbiddenDrainAction: bool = all {
    state.phase == Draining,
    state' = { ...state, forbiddenDrainActions: 1 },
  }

  action releaseAmbiguouslyWithoutIntent: bool = all {
    state.phase == Draining,
    state.owner == InterruptibleOwner,
    not(state.intentAcknowledged),
    state' = { ...state, owner: NoOwner, recoverableAmbiguity: true },
  }

  action recordKnownObservationWithoutIntent: bool = all {
    state.phase == Draining,
    not(state.intentAcknowledged),
    state' = { ...state, knownObservationRecorded: true },
  }

  action terminateWithoutAuthorization: bool = all {
    not(state.runTerminationAuthorized),
    state' = { ...state, runTerminated: true },
  }

  action appendWorkflowExitRecord: bool = all {
    state' = { ...state, workflowExitRecords: 1 },
  }

  action disposeDurableResource: bool = all {
    state' = { ...state, durableResourcesPreserved: false },
  }

  run forbiddenDrainActionIsDetectedTest = {
    init.then(acceptExit).then(beginForbiddenDrainAction)
      .expect(not(onlyEnumeratedQuickDrainActionsBegin))
  }

  run ambiguityWithoutIntentIsDetectedTest = {
    init.then(admitInterruptibleOwner).then(acceptExit).then(releaseAmbiguouslyWithoutIntent)
      .expect(not(recoverableAmbiguityRequiresAcknowledgedIntent))
  }

  run knownObservationWithoutIntentIsDetectedTest = {
    init.then(acceptExit).then(recordKnownObservationWithoutIntent)
      .expect(not(knownObservationRequiresAcknowledgedIntent))
  }

  run unauthorizedTerminationIsDetectedTest = {
    init.then(terminateWithoutAuthorization)
      .expect(not(runTerminationRequiresPreCutoffAuthorization))
  }

  run workflowExitRecordIsDetectedTest = {
    init.then(appendWorkflowExitRecord)
      .expect(not(applicationLifecycleNeverEntersWorkflowHistory))
  }

  run durableResourceDisposalIsDetectedTest = {
    init.then(disposeDurableResource)
      .expect(not(exitNeverDisposesDurableWorkflowResources))
  }

  run ownerProjectionOutOfBoundsIsDetectedTest = {
    init.then(acceptExit).then(beginForbiddenDrainAction).expect(not(ownerProofTypeOk))
  }
}

module applicationExitExecutorProofNegativeTest {
  import applicationExitExecutorProof.* from "./applicationExit_proof"

  action releaseExecutingPosition: bool = all {
    state.attempt == Executing,
    state' = { ...state, positionHeld: false },
  }

  action retainSafePosition: bool = all {
    state.attempt == FastSuspensionCalled,
    state' = { ...state, attempt: SafelySuspended, positionHeld: true },
  }

  action callWithoutAcknowledgedIntent: bool = all {
    state.phase == Draining,
    state.attempt == Executing,
    not(state.suspensionIntentAcknowledged),
    state' = { ...state, attempt: FastSuspensionCalled },
  }

  action releaseForForeignEvidence: bool = all {
    state.attempt == Executing,
    state' = { ...state, positionHeld: false, foreignReleases: 1 },
  }

  run unsafeExecutingReleaseIsDetectedTest = {
    init.then(startAttempt).then(releaseExecutingPosition)
      .expect(not(exactSafeOrTerminalEvidenceControlsPositionRelease))
  }

  run safeEvidenceMustReleasePositionTest = {
    init.then(startAttempt).then(acceptExit).then(recordSuspensionIntent).then(callFastSuspension)
      .then(retainSafePosition).expect(not(exactSafeOrTerminalEvidenceControlsPositionRelease))
  }

  run fastCallWithoutIntentIsDetectedTest = {
    init.then(startAttempt).then(acceptExit).then(callWithoutAcknowledgedIntent)
      .expect(not(fastSuspensionRequiresAcknowledgedIntent))
  }

  run foreignEvidenceReleaseIsDetectedTest = {
    init.then(startAttempt).then(releaseForForeignEvidence)
      .expect(and {
        not(exactSafeOrTerminalEvidenceControlsPositionRelease),
        not(executorProofTypeOk),
      })
  }
}

module applicationExitResultProofNegativeTest {
  import applicationExitResultProof.* from "./applicationExit_proof"

  action reportUnsafeSuccess: bool = all {
    state.phase == Draining,
    state' = { ...state, phase: SuccessReported, result: Succeeded, status: ZeroStatus },
  }

  action reportFailureWhileUsefulWorkRemains: bool = all {
    state.phase == Draining,
    state.attempt == BusyAttempt,
    state' = {
      ...state,
      phase: FailureReported,
      result: Failed,
      status: NonzeroStatus,
      failureDiagnosticRetained: true,
    },
  }

  action timeoutBeforeFifthTick: bool = all {
    state.phase == Draining,
    state.tick < 5,
    state' = {
      ...state,
      phase: ProcessGoneTimeout,
      result: TimedOut,
      status: NonzeroStatus,
      forcedTerminationRequested: true,
    },
  }

  action fifthTickWithoutForcedTermination: bool = all {
    state.phase == Draining,
    state.tick == 4,
    state' = {
      ...state,
      phase: ProcessGoneTimeout,
      tick: 5,
      result: TimedOut,
      status: NonzeroStatus,
      forcedTerminationRequested: false,
    },
  }

  action forceFailureWithZeroStatus: bool = all {
    state.phase == FailureReported,
    state' = {
      ...state,
      phase: ProcessGoneFailure,
      status: ZeroStatus,
      forcedTerminationRequested: true,
    },
  }

  action stopGracefullyWithoutSuccess: bool = all {
    state.phase == Draining,
    state' = {
      ...state,
      phase: ProcessGoneGraceful,
      gracefulTerminationRequested: true,
    },
  }

  action reportUnexpectedDeathAsSuccess: bool = all {
    state.phase == Draining,
    state' = {
      ...state,
      phase: ProcessGoneUnexpected,
      result: Succeeded,
      status: ZeroStatus,
      unexpectedDeathObserved: true,
    },
  }

  action restartWithOldLifecycleState: bool = all {
    state.phase == ProcessGoneUnexpected,
    state' = {
      ...state,
      phase: RestartedServing,
      restarted: true,
      restartClearedLifecycle: false,
      tick: 3,
      result: TimedOut,
      status: NonzeroStatus,
    },
  }

  action appendWorkflowExitRecord: bool = all {
    state' = { ...state, workflowExitRecords: 1 },
  }

  action disposeDurableResource: bool = all {
    state' = { ...state, durableResourcesPreserved: false },
  }

  action advancePastFifthTick: bool = all {
    state' = { ...state, tick: 6 },
  }

  // Each result-boundary mutant below changes one fact while preserving the
  // other result invariants. They are separate controls so a surviving or
  // killed property cannot be attributed to a conjunction of claims.
  action ordinarySuccessWithoutCoordinatorRelease: bool = all {
    state.phase == Draining,
    state.mode == Ordinary,
    not(state.ownerHeld),
    state.attempt == SafeAttempt,
    state.write != PendingWrite,
    state.write != FailedWrite,
    not(state.resourcesHeld),
    not(state.failureDiagnosticRetained),
    state' = {
      ...state,
      phase: SuccessReported,
      result: Succeeded,
      resultProvenance: OrdinaryResult,
      status: ZeroStatus,
    },
  }

  action hostScopeFinalizationBeforeResult: bool = all {
    state.phase == Draining,
    state.mode == ProductionHostScoped,
    state' = {
      ...state,
      phase: HostScopeFinalized,
      result: NoResult,
      resultProvenance: NoProvenance,
      coordinatorLockHeld: false,
      hostResultReported: false,
      hostScopeFinalized: true,
    },
  }

  action hostScopeFinalizationRetainsCoordinator: bool = all {
    state.phase == HostResultReported,
    state.mode == ProductionHostScoped,
    state.result != NoResult,
    state.hostResultReported,
    not(state.hostScopeFinalized),
    state' = { ...state, phase: HostScopeFinalized, hostScopeFinalized: true },
  }

  action hostResultUsesOrdinaryProvenance: bool = all {
    state.phase == HostResultReported,
    state.mode == ProductionHostScoped,
    state.result != NoResult,
    state.hostResultReported,
    state.resultProvenance == ProductionHostResult,
    state' = { ...state, resultProvenance: OrdinaryResult },
  }

  run unsafeSuccessIsDetectedTest = {
    init.then(startAttempt).then(acceptExit).then(reportUnsafeSuccess)
      .expect(not(successfulExitRequiresRecoverableBoundary))
  }

  run prematureFailureIsDetectedTest = {
    init.then(startAttempt).then(acceptExit).then(reportFailureWhileUsefulWorkRemains)
      .expect(not(conclusiveFailureWaitsForUsefulQuickWork))
  }

  run earlyTimeoutIsDetectedTest = {
    init.then(acceptExit).then(timeoutBeforeFifthTick)
      .expect(not(fifthTickAtomicallyForcesTimedOutTermination))
  }

  run fifthTickWithoutForceIsDetectedTest = {
    init.then(acceptExit)
      .then(advanceTick).then(advanceTick).then(advanceTick).then(advanceTick)
      .then(fifthTickWithoutForcedTermination)
      .expect(and {
        not(fifthTickAtomicallyForcesTimedOutTermination),
        not(failureAndTimeoutRequestNonzeroForcedTermination),
      })
  }

  run failureZeroStatusIsDetectedTest = {
    init.then(recordFailureDiagnostic).then(acceptExit).then(releaseResources).then(releaseCoordinatorLock).then(reportFailure)
      .then(forceFailureWithZeroStatus)
      .expect(not(failureAndTimeoutRequestNonzeroForcedTermination))
  }

  run gracefulStopWithoutSuccessIsDetectedTest = {
    init.then(acceptExit).then(stopGracefullyWithoutSuccess)
      .expect(not(successReportsBeforeGracefulProcessEnd))
  }

  run unexpectedDeathAsSuccessIsDetectedTest = {
    init.then(acceptExit).then(reportUnexpectedDeathAsSuccess)
      .expect(not(unexpectedDeathNeverReportsGracefulSuccess))
  }

  run restoredLifecycleIsDetectedTest = {
    init.then(acceptExit).then(unexpectedDeath).then(restartWithOldLifecycleState)
      .expect(not(restartRestoresNoApplicationLifecycleState))
  }

  run workflowExitRecordIsDetectedTest = {
    init.then(appendWorkflowExitRecord)
      .expect(not(applicationLifecycleNeverEntersWorkflowHistory))
  }

  run durableResourceDisposalIsDetectedTest = {
    init.then(disposeDurableResource)
      .expect(not(exitNeverDisposesDurableWorkflowResources))
  }

  run ordinarySuccessWithoutCoordinatorReleaseIsDetectedTest = {
    init.then(acceptExit).then(releaseResources).then(ordinarySuccessWithoutCoordinatorRelease)
      .expect(not(ordinarySuccessReleasesCoordinatorBeforeResult))
  }

  run hostResultBeforeScopeFinalizationIsDetectedTest = {
    init.then(selectHostScopedMode).then(acceptExit).then(releaseResources)
      .then(hostScopeFinalizationBeforeResult)
      .expect(not(hostResultBeforeScopeFinalization))
  }

  run hostScopeFinalizationReleaseIsDetectedTest = {
    init.then(selectHostScopedMode).then(acceptExit).then(releaseResources).then(reportSuccess)
      .then(hostScopeFinalizationRetainsCoordinator)
      .expect(not(hostScopeFinalizationReleasesCoordinator))
  }

  run hostResultProvenanceIsDetectedTest = {
    init.then(selectHostScopedMode).then(acceptExit).then(releaseResources).then(reportSuccess)
      .then(hostResultUsesOrdinaryProvenance)
      .expect(not(hostResultProvenanceIsExplicit))
  }

  run sixthTickIsDetectedTest = {
    init.then(advancePastFifthTick).expect(not(resultProofTypeOk))
  }
}
