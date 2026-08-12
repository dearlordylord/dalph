module applicationExitTest {
  import applicationExit.* from "./applicationExit"

  run idleExitClosesCutoffBeforeSuccessTest = {
    init
      .then(acceptExit)
      .then(releaseCoordinatorLock)
      .then(reportSuccess)
      .then(stopAfterSuccess)
      .expect(and {
        state.cutoffCount == 1,
        state.result == Succeeded,
        state.phase == ProcessGoneGraceful,
        successfulExitRequiresRecoverableBoundary,
        successReportsBeforeGracefulProcessEnd,
      })
  }

  run cutoffRollsBackPreparationAndBlocksRegistrationTest = {
    init
      .then(prepareAtomicOwnerA)
      .then(acceptExit)
      .expect(state.ownerA == NoForwardOwner and preparingAdmissionNeverSurvivesTheCutoff)
      .then(registerOwnerA.fail())
  }

  run cutoffPreservesAnEarlierRegisteredOwnerTest = {
    init
      .then(prepareAtomicOwnerA)
      .then(registerOwnerA)
      .then(acceptExit)
      .expect(state.ownerA == RegisteredForwardOwner(AtomicBoundary))
      .then(finishAtomicOwnerA)
      .expect(state.ownerA == NoForwardOwner)
  }

  run joinedExitUsesTheOriginalTickAndSharedResultTest = {
    init
      .then(acceptExit)
      .then(advanceTick)
      .then(advanceTick)
      .then(joinExit)
      .expect(and {
        state.tick == 2,
        state.requestCount == 2,
        state.cutoffCount == 1,
        joinedRequestNeverResetsTheDrain,
        joinedRequestsReceiveOneSharedResult,
      })
  }

  run acknowledgedInterruptibleIntentMayRemainAmbiguousTest = {
    init
      .then(acknowledgeOwnerAIntent)
      .then(prepareInterruptibleOwnerA)
      .then(registerOwnerA)
      .then(acceptExit)
      .then(interruptOwnerAWithRecoverableAmbiguity)
      .then(releaseCoordinatorLock)
      .then(reportSuccess)
      .expect(and {
        recoverableAmbiguityReached,
        state.durable.ownerAIntentAcknowledged,
        state.ownerA == NoForwardOwner,
        recoverableAmbiguityRequiresAcknowledgedExactIntent,
        successfulExitRequiresRecoverableBoundary,
      })
  }

  run immediatelyAvailableBoundaryResultIsRecordedBeforeReleaseTest = {
    init
      .then(acknowledgeOwnerAIntent)
      .then(prepareInterruptibleOwnerA)
      .then(registerOwnerA)
      .then(acceptExit)
      .then(observeOwnerAKnownResult)
      .expect(and {
        state.ownerA == NoForwardOwner,
        state.durable.ownerAKnownObservationRecorded,
        knownBoundaryObservationRequiresItsAcknowledgedIntent,
      })
  }

  run exactSafeSuspensionReleasesOnlyAttemptAPositionTest = {
    init
      .then(startAttemptA)
      .then(startAttemptB)
      .then(acceptExit)
      .then(recordAttemptASuspensionIntent)
      .then(callFastSuspensionA)
      .then(reportAttemptASafelySuspended)
      .expect(and {
        state.attemptA == AttemptSafelySuspended,
        not(state.attemptAPositionHeld),
        state.attemptB == AttemptRunning,
        state.attemptBPositionHeld,
        exactSafeOrTerminalEvidenceControlsPositionRelease,
      })
  }

  run exactTerminalReportReleasesItsCorrelatedPositionTest = {
    init
      .then(startAttemptA)
      .then(acceptExit)
      .then(reportAttemptATerminal)
      .expect(and {
        state.attemptA == AttemptTerminal,
        not(state.attemptAPositionHeld),
        exactSafeOrTerminalEvidenceControlsPositionRelease,
      })
  }

  run runningAttemptMustConfirmSafetyBeforeSuccessTest = {
    init
      .then(startAttemptA)
      .then(acceptExit)
      .then(releaseCoordinatorLock)
      .then(recordAttemptASuspensionIntent)
      .then(callFastSuspensionA)
      .then(reportAttemptASafelySuspended)
      .then(reportSuccess)
      .expect(successfulExitRequiresRecoverableBoundary)
  }

  run unsafeRunningAttemptBlocksSuccessTest = {
    init
      .then(startAttemptA)
      .then(acceptExit)
      .then(releaseCoordinatorLock)
      .then(reportSuccess.fail())
  }

  run admittedAtomicBoundaryFinishesInsideTheOriginalDrainTest = {
    init
      .then(prepareAtomicOwnerA)
      .then(registerOwnerA)
      .then(acceptExit)
      .then(advanceTick)
      .then(finishAtomicOwnerA)
      .then(releaseCoordinatorLock)
      .then(reportSuccess)
      .expect(state.tick == 1 and state.result == Succeeded)
  }

  run fifthTickForceTerminatesAStuckAtomicBoundaryTest = {
    init
      .then(prepareAtomicOwnerA)
      .then(registerOwnerA)
      .then(acceptExit)
      .then(advanceTick)
      .then(advanceTick)
      .then(advanceTick)
      .then(advanceTick)
      .expect(fourthTickReached)
      .then(advanceTick)
      .expect(and {
        state.ownerA == RegisteredForwardOwner(AtomicBoundary),
        state.phase == ProcessGoneTimeout,
        state.tick == 5,
        fifthTickAtomicallyForcesTimedOutTermination,
        failureAndTimeoutRequestNonzeroForcedTermination,
      })
  }

  run conclusiveFailureWaitsForIndependentQuickDrainWorkTest = {
    init
      .then(produceJournalWrite)
      .then(holdReservation)
      .then(openFiber)
      .then(acceptExit)
      .then(failProducedWrite)
      .then(releaseReservation)
      .then(closeFiber)
      .then(releaseCoordinatorLock)
      .then(reportFailure)
      .then(forceAfterFailure)
      .expect(and {
        state.phase == ProcessGoneFailure,
        state.failureDiagnosticRetained,
        conclusiveFailureWaitsForUsefulQuickWork,
        failureAndTimeoutRequestNonzeroForcedTermination,
      })
  }

  run usefulQuickWorkBlocksConclusiveFailureTest = {
    init
      .then(produceJournalWrite)
      .then(holdReservation)
      .then(acceptExit)
      .then(failProducedWrite)
      .then(reportFailure.fail())
  }

  run timeoutRetainsAnEarlierConclusiveFailureDiagnosticTest = {
    init
      .then(startAttemptA)
      .then(produceJournalWrite)
      .then(acceptExit)
      .then(failProducedWrite)
      .then(advanceTick)
      .then(advanceTick)
      .then(advanceTick)
      .then(advanceTick)
      .then(advanceTick)
      .expect(and {
        state.phase == ProcessGoneTimeout,
        state.failureDiagnosticRetained,
        state.attemptA == AttemptRunning,
        state.attemptAPositionHeld,
        fifthTickAtomicallyForcesTimedOutTermination,
      })
  }

  run deathBeforeResultRestartsWithoutLifecycleStateTest = {
    init
      .then(acknowledgeOwnerAIntent)
      .then(applyPauseBeforeCutoff)
      .then(acceptExit)
      .then(advanceTick)
      .then(unexpectedDeath)
      .expect(unexpectedDeathNeverReportsGracefulSuccess)
      .then(restartApplication)
      .expect(and {
        restartedServingReached,
        state.tick == 0,
        state.cutoffCount == 0,
        state.requestCount == 0,
        state.result == NoExitResult,
        state.durable.ownerAIntentAcknowledged,
        state.durable.pauseApplied,
        restartRestoresNoApplicationLifecycleState,
      })
  }

  run pauseAppliedBeforeCutoffRemainsDurableTest = {
    init
      .then(applyPauseBeforeCutoff)
      .then(acceptExit)
      .then(releaseCoordinatorLock)
      .then(reportSuccess)
      .expect(and {
        pausePreservedReached,
        state.durable.pauseApplied,
        onlyEnumeratedQuickDrainActionsBeginAfterCutoff,
      })
  }

  run onlyPreauthorizedRunTerminationAppendMayFinishTest = {
    init
      .then(prepareTerminationAppendOwnerA)
      .then(registerOwnerA)
      .then(acceptExit)
      .then(finishAuthorizedTerminationAppendA)
      .expect(and {
        authorizedTerminationFinishedReached,
        state.durable.runTerminationAuthorized,
        runTerminationRequiresPreCutoffAuthorization,
      })
      .then(prepareTerminationAppendOwnerA.fail())
  }

  run postCutoffForwardWorkCannotBeginTest = {
    init
      .then(acceptExit)
      .then(startAttemptA.fail())
  }

  run postCutoffControlCannotApplyTest = {
    init
      .then(acceptExit)
      .then(applyPauseBeforeCutoff.fail())
  }

  run postCutoffOwnerPreparationCannotBeginTest = {
    init
      .then(acceptExit)
      .then(prepareAtomicOwnerA.fail())
  }

  run everyExitOutcomeLeavesWorkflowExitRecordCountZeroTest = {
    init
      .then(acceptExit)
      .then(releaseCoordinatorLock)
      .then(reportSuccess)
      .then(stopAfterSuccess)
      .expect(and {
        state.durable.workflowExitRecords == 0,
        applicationLifecycleNeverEntersWorkflowHistory,
        exitNeverDisposesDurableWorkflowResources,
      })
  }
}
