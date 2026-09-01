module applicationExitAdmissionProofTest {
  import applicationExitAdmissionProof.* from "./applicationExit_proof"

  run cutoffRollsBackPreparationAndPreservesRegistrationTest = {
    init
      .then(prepareOwnerA)
      .then(prepareOwnerB)
      .then(registerOwnerB)
      .then(acceptExit)
      .expect(and {
        state.ownerA == NoOwner,
        state.ownerB == RegisteredOwner,
        cutoffClosesAtMostOnce,
        preparingNeverSurvivesCutoff,
        registrationRequiresServing,
      })
  }

  run joinedRequestSharesTimerAndResultTest = {
    init
      .then(acceptExit)
      .then(advanceTick)
      .then(advanceTick)
      .then(joinExit)
      .then(advanceTick)
      .then(publishSharedResult)
      .expect(and {
        state.requestCount == 2,
        state.tick == 3,
        state.joinedTick == 3,
        state.result == SharedResult,
        state.joinedResult == SharedResult,
        joinedRequestDoesNotResetTimer,
        joinedRequestsShareResult,
      })
  }

  run fiveTicksRemainMonotonicTest = {
    init
      .then(acceptExit)
      .then(advanceTick)
      .then(advanceTick)
      .then(advanceTick)
      .then(advanceTick)
      .then(advanceTick)
      .expect(fifthTickReached and admissionProofTypeOk)
      .then(finishProof)
      .expect(processGoneReached)
  }
}

module applicationExitOwnerProofTest {
  import applicationExitOwnerProof.* from "./applicationExit_proof"

  run interruptibleOwnerKnownResultRequiresIntentTest = {
    init
      .then(admitInterruptibleOwner)
      .then(acknowledgeIntent)
      .then(acceptExit)
      .then(recordKnownObservationAndRelease)
      .expect(and {
        state.owner == NoOwner,
        knownObservationRequiresAcknowledgedIntent,
        applicationLifecycleNeverEntersWorkflowHistory,
        exitNeverDisposesDurableWorkflowResources,
      })
  }

  run interruptibleOwnerAmbiguityRequiresIntentTest = {
    init
      .then(admitInterruptibleOwner)
      .then(acknowledgeIntent)
      .then(acceptExit)
      .then(releaseWithRecoverableAmbiguity)
      .expect(recoverableAmbiguityRequiresAcknowledgedIntent)
  }

  run admittedAtomicOwnerFinishesAfterCutoffTest = {
    init
      .then(admitAtomicOwner)
      .then(acceptExit)
      .then(finishAtomicOwner)
      .expect(state.owner == NoOwner and onlyEnumeratedQuickDrainActionsBegin)
  }

  run authorizedTerminationFinishesWithoutInventingExitHistoryTest = {
    init
      .then(admitAuthorizedTerminationOwner)
      .then(acceptExit)
      .then(finishAuthorizedTermination)
      .expect(and {
        state.runTerminated,
        runTerminationRequiresPreCutoffAuthorization,
        applicationLifecycleNeverEntersWorkflowHistory,
      })
  }
}

module applicationExitExecutorProofTest {
  import applicationExitExecutorProof.* from "./applicationExit_proof"

  run exactSafeSuspensionReleasesPositionTest = {
    init
      .then(startAttempt)
      .then(acceptExit)
      .then(recordSuspensionIntent)
      .then(callFastSuspension)
      .then(reportSafelySuspended)
      .expect(and {
        not(state.positionHeld),
        exactSafeOrTerminalEvidenceControlsPositionRelease,
        fastSuspensionRequiresAcknowledgedIntent,
      })
  }

  run exactTerminalEvidenceReleasesPositionTest = {
    init
      .then(startAttempt)
      .then(acceptExit)
      .then(reportTerminal)
      .expect(not(state.positionHeld) and exactSafeOrTerminalEvidenceControlsPositionRelease)
  }

  run failedSuspensionRetainsPositionTest = {
    init
      .then(startAttempt)
      .then(acceptExit)
      .then(recordSuspensionIntent)
      .then(callFastSuspension)
      .then(failFastSuspension)
      .expect(state.positionHeld and exactSafeOrTerminalEvidenceControlsPositionRelease)
  }
}

module applicationExitResultProofTest {
  import applicationExitResultProof.* from "./applicationExit_proof"

  run idleExitReportsSuccessBeforeGracefulStopAndRestartsFreshTest = {
    init
      .then(acceptExit)
      .then(releaseResources)
      .then(releaseCoordinatorLock)
      .then(reportSuccess)
      .expect(and {
        state.mode == Ordinary,
        state.result == Succeeded,
        state.resultProvenance == OrdinaryResult,
        not(state.coordinatorLockHeld),
        successfulExitRequiresRecoverableBoundary,
        ordinarySuccessReleasesCoordinatorBeforeResult,
      })
      .then(stopAfterSuccess)
      .expect(successReportsBeforeGracefulProcessEnd)
      .then(restartApplication)
      .expect(restartRestoresNoApplicationLifecycleState)
  }

  run usefulWorkSettlesBeforeSuccessTest = {
    init
      .then(holdOwner)
      .then(startAttempt)
      .then(produceWrite)
      .then(acceptExit)
      .expect(not(successBoundaryReached(state)))
      .then(releaseOwner)
      .then(settleAttemptSafely)
      .then(acknowledgeWrite)
      .then(releaseResources)
      .then(releaseCoordinatorLock)
      .then(reportSuccess)
      .expect(and {
        state.result == Succeeded,
        state.resultProvenance == OrdinaryResult,
        ordinarySuccessReleasesCoordinatorBeforeResult,
        successfulExitRequiresRecoverableBoundary,
      })
  }

  run failureWaitsForQuickWorkThenForcesNonzeroTest = {
    init
      .then(startAttempt)
      .then(acceptExit)
      .then(failAttempt)
      .expect(usefulQuickWorkRemains(state))
      .then(releaseResources)
      .then(releaseCoordinatorLock)
      .then(reportFailure)
      .expect(conclusiveFailureWaitsForUsefulQuickWork)
      .then(forceAfterFailure)
      .expect(failureAndTimeoutRequestNonzeroForcedTermination)
  }

  run hostScopedSuccessReportsExactResultBeforeScopeFinalizationTest = {
    init
      .then(selectHostScopedMode)
      .then(acceptExit)
      .then(releaseResources)
      .then(reportSuccess)
      .expect(and {
        state.mode == ProductionHostScoped,
        state.phase == HostResultReported,
        state.result == Succeeded,
        state.resultProvenance == ProductionHostResult,
        state.hostResultReported,
        not(state.hostScopeFinalized),
        state.coordinatorLockHeld,
        successfulExitRequiresRecoverableBoundary,
        hostResultBeforeScopeFinalization,
        hostResultProvenanceIsExplicit,
      })
      .then(finalizeHostScope)
      .expect(and {
        state.phase == HostScopeFinalized,
        state.hostScopeFinalized,
        not(state.coordinatorLockHeld),
        hostResultBeforeScopeFinalization,
        hostScopeFinalizationReleasesCoordinator,
      })
  }

  run hostScopedFailureReportsExactResultBeforeScopeFinalizationTest = {
    init
      .then(selectHostScopedMode)
      .then(recordFailureDiagnostic)
      .then(acceptExit)
      .then(releaseResources)
      .then(reportFailure)
      .expect(and {
        state.phase == HostResultReported,
        state.result == Failed,
        state.resultProvenance == ProductionHostResult,
        state.hostResultReported,
        state.coordinatorLockHeld,
        hostResultBeforeScopeFinalization,
        hostResultProvenanceIsExplicit,
      })
      .then(finalizeHostScope)
      .expect(and {
        state.hostScopeFinalized,
        not(state.coordinatorLockHeld),
        hostScopeFinalizationReleasesCoordinator,
      })
  }

  run hostScopedTimeoutReportsExactResultBeforeScopeFinalizationTest = {
    init
      .then(selectHostScopedMode)
      .then(acceptExit)
      .then(advanceTick)
      .then(advanceTick)
      .then(advanceTick)
      .then(advanceTick)
      .then(advanceTick)
      .expect(and {
        state.phase == HostResultReported,
        state.result == TimedOut,
        state.resultProvenance == ProductionHostResult,
        state.hostResultReported,
        not(state.hostScopeFinalized),
        state.coordinatorLockHeld,
        fifthTickAtomicallyForcesTimedOutTermination,
        hostResultBeforeScopeFinalization,
      })
      .then(finalizeHostScope)
      .expect(and {
        state.phase == HostScopeFinalized,
        not(state.coordinatorLockHeld),
        hostScopeFinalizationReleasesCoordinator,
      })
  }

  run hostScopedRestartClearsModeResultAndTimerTest = {
    init
      .then(selectHostScopedMode)
      .then(acceptExit)
      .then(releaseResources)
      .then(reportSuccess)
      .then(finalizeHostScope)
      .then(restartApplication)
      .expect(and {
        state.phase == RestartedServing,
        state.mode == Ordinary,
        state.result == NoResult,
        state.resultProvenance == NoProvenance,
        state.tick == 0,
        state.coordinatorLockHeld,
        not(state.hostResultReported),
        not(state.hostScopeFinalized),
        restartRestoresNoApplicationLifecycleState,
      })
  }

  run fifthTickAtomicallyForcesTimedOutTerminationTest = {
    init
      .then(startAttempt)
      .then(acceptExit)
      .then(advanceTick)
      .then(advanceTick)
      .then(advanceTick)
      .then(advanceTick)
      .expect(fourthTickReached)
      .then(advanceTick)
      .expect(and {
        fifthTickAtomicallyForcesTimedOutTermination,
        failureAndTimeoutRequestNonzeroForcedTermination,
      })
  }

  run unexpectedDeathIsDistinctAndRestartIsFreshTest = {
    init
      .then(startAttempt)
      .then(acceptExit)
      .then(unexpectedDeath)
      .expect(unexpectedDeathNeverReportsGracefulSuccess)
      .then(restartApplication)
      .expect(restartRestoresNoApplicationLifecycleState)
  }
}
