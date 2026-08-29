module taskFactChoiceProofTest {
  import taskFactChoiceProof.* from "./taskFactReconciliation_proof"

  run firstContinueWinsAndExactRedeliveryIsIdempotentTest = {
    init
      .then(observeF2)
      .then(applyContinueF2)
      .then(redeliverExactChoice)
      .expect(and {
        state.f2Choice == ContinueChoice,
        state.appliedChoiceCount == 1,
        firstChoiceAndExactRedeliveryAreIdempotent,
      })
  }

  run firstStopWinsAgainstLaterContinueTest = {
    init
      .then(observeF2)
      .then(applyStopF2)
      .then(rejectLosingChoice)
      .expect(and {
        state.f2Choice == StopChoice,
        state.appliedChoiceCount == 1,
        firstChoiceAndExactRedeliveryAreIdempotent,
      })
  }

  run requestIdentityFailuresRemainDistinctTest = {
    init
      .then(rejectRunMismatch)
      .expect(
        state.controlResult == RequestRunBindingMismatch
          and requestIdentityErrorsStayDistinct
      )
      .then(observeF2)
      .then(applyContinueF2)
      .then(rejectContentReuse)
      .expect(
        state.controlResult == PersistedRequestContentContradiction
          and requestIdentityErrorsStayDistinct
      )
  }

  run continueReadsSixFreshAuthoritiesAndResumesImmutablePTest = {
    init
      .then(observeF2)
      .then(applyContinueF2)
      .then(readFreshGraph)
      .then(readFreshSpecification)
      .then(readFreshClaim)
      .then(readFreshWorktree)
      .then(readFreshLineage)
      .then(readFreshExecutor)
      .then(resumeAttemptP)
      .expect(and {
        state.continueStage == Resumed,
        state.resumedAttempt == AttemptP,
        state.plannedFingerprint == F1,
        continueUsesSixFreshReadsForImmutableP,
      })
  }

  run f3RequiresNewChoiceAndSixNewReadsTest = {
    init
      .then(observeF2)
      .then(applyContinueF2)
      .then(readFreshGraph)
      .then(observeF3)
      .expect(
        state.continueStage == NewChoiceRequired
          and state.f3Choice == NoChoice
          and state.reads == NO_READS
          and laterF3RequiresItsOwnChoiceAndFreshReads
      )
      .then(applyContinueF3)
      .then(readFreshGraph)
      .then(readFreshSpecification)
      .then(readFreshClaim)
      .then(readFreshWorktree)
      .then(readFreshLineage)
      .then(readFreshExecutor)
      .then(resumeAttemptP)
      .expect(and {
        state.f3Choice == ContinueChoice,
        state.appliedChoiceCount == 2,
        state.resumedAttempt == AttemptP,
        continueUsesSixFreshReadsForImmutableP,
      })
  }

  run postCutoffContinueCannotCrossAnotherBoundaryTest = {
    init
      .then(beginIntegration)
      .then(observeF2)
      .then(rejectContinuePastCutoff)
      .expect(postCutoffChoiceHasNoDownstreamEffect)
  }

  run postCutoffStopCannotCrossAnotherBoundaryTest = {
    init
      .then(beginIntegration)
      .then(observeF2)
      .then(rejectStopPastCutoff)
      .expect(postCutoffChoiceHasNoDownstreamEffect)
  }
}

module taskFactStopProofTest {
  import taskFactStopProof.* from "./taskFactReconciliation_proof"

  run retainedSafeProofAllowsStopWithoutAnotherExecutorCallTest = {
    init
      .then(applyStop)
      .then(abandonImplementation)
      .expect(and {
        not(state.implementationRetained),
        state.callCount == 0,
        state.claimHeld,
        abandonmentRequiresExactUnbrokenQuiescence,
      })
  }

  run ambiguousStopAcceptsOnlyExactSafeProjectionTest = {
    init
      .then(applyStop)
      .then(breakRetainedSafeProof)
      .then(recordStopIntent)
      .then(callStop)
      .then(loseStopResponse)
      .then(activateRecovery)
      .then(projectSafe)
      .then(abandonImplementation)
      .expect(and {
        state.callCount == 1,
        state.settlementCount == 1,
        not(state.implementationRetained),
        abandonmentRequiresExactUnbrokenQuiescence,
      })
  }

  run threeLostRunningStopsAllowOnlyReadOnlySafeRecoveryTest = {
    init
      .then(applyStop)
      .then(breakRetainedSafeProof)
      .then(recordStopIntent)
      .then(callStop)
      .then(loseStopResponse)
      .then(activateRecovery)
      .then(projectRunning)
      .then(recordStopIntent)
      .then(callStop)
      .then(loseStopResponse)
      .then(activateRecovery)
      .then(projectRunning)
      .then(recordStopIntent)
      .then(callStop)
      .then(loseStopResponse)
      .then(activateRecovery)
      .then(projectRunning)
      .expect(and {
        state.callCount == STOP_COMMAND_LIMIT,
        state.settlementCount == STOP_COMMAND_LIMIT,
        state.implementationRetained,
        state.positionHeld,
        state.claimHeld,
        thirdRunningResultLeavesOnlyReadOnlyRecovery,
      })
      .then(activateReadOnlyRecovery)
      .then(projectReadOnlySafe)
      .expect(and {
        not(state.implementationRetained),
        state.callCount == STOP_COMMAND_LIMIT,
        readOnlyRecoveryIssuesNoFourthCommand,
        abandonmentRequiresExactUnbrokenQuiescence,
      })
  }

  run unprovedRunningWriterRetainsPositionClaimAndArtifactsTest = {
    init
      .then(applyStop)
      .then(breakRetainedSafeProof)
      .then(recordStopIntent)
      .then(callStop)
      .then(loseStopResponse)
      .then(activateRecovery)
      .then(projectRunning)
      .expect(and {
        state.implementationRetained,
        state.positionHeld,
        state.claimHeld,
        unprovedWriterRetainsPositionAndClaim,
        stopPreservesArtifactsAndNeverIntegrates,
      })
  }
}

module taskFactClaimProofTest {
  import taskFactClaimProof.* from "./taskFactReconciliation_proof"

  run exactClaimIsReleasedOnlyAfterReadAndIntentTest = {
    init
      .then(observeExactClaim)
      .then(recordReleaseIntent)
      .then(releaseExactClaim)
      .expect(and {
        state.result == ExactClaimReleased,
        state.releaseCallCount == 1,
        claimChangesOnlyAfterAbandonmentExactReadAndIntent,
      })
  }

  run absentClaimIsObservedWithoutMutationTest = {
    init
      .then(observeAbsentClaim)
      .expect(
        state.result == NoReleaseAbsent
          and state.releaseCallCount == 0
          and absentForeignUnreadableClaimsAreNeverMutated
      )
  }

  run foreignClaimIsObservedWithoutMutationTest = {
    init
      .then(observeForeignClaim)
      .expect(
        state.result == NoReleaseForeign
          and state.releaseCallCount == 0
          and absentForeignUnreadableClaimsAreNeverMutated
      )
  }

  run unreadableClaimWaitsSeparatelyWhileAnotherTaskProgressesTest = {
    init
      .then(observeUnreadableClaim)
      .then(selectIndependentTask)
      .expect(and {
        state.unresolvedClaimReleaseResponsibility,
        state.independentTaskSelected,
        unreadableClaimRetainsSeparateResponsibility,
        unrelatedTaskRemainsEligible,
      })
      .then(recoverLaterActivation)
      .then(observeAbsentClaim)
      .expect(
        state.result == NoReleaseAbsent
          and state.recoveryCount == 1
          and claimReleaseIsBoundedAndReconciled
      )
  }

  run ambiguousReleaseReconcilesBeforeRetryTest = {
    init
      .then(observeExactClaim)
      .then(recordReleaseIntent)
      .then(loseReleaseResponse)
      .then(projectClaimStillExact)
      .then(recoverLaterActivation)
      .then(observeExactClaim)
      .then(releaseExactClaim)
      .expect(and {
        state.result == ExactClaimReleased,
        state.releaseCallCount == 2,
        claimReleaseIsBoundedAndReconciled,
      })
  }

  run lostReleaseResponseCanProjectExactReleaseTest = {
    init
      .then(observeExactClaim)
      .then(recordReleaseIntent)
      .then(loseReleaseResponse)
      .then(projectClaimReleased)
      .expect(and {
        state.result == ExactClaimReleased,
        state.releaseCallCount == 1,
        claimReleaseIsBoundedAndReconciled,
      })
  }
}

module taskFactActiveRefreshProofTest {
  import taskFactActiveRefreshProof.* from "./taskFactReconciliation_proof"

  run activeRefreshUnreadableWaitsWithoutExecutorActionTest = {
    init
      .then(establishRunningAttempt)
      .expect(runningEstablishmentRetainsAuthority)
      .then(offerTimerRefresh)
      .then(observeUnreadableActiveRefresh)
      .expect(and {
        activeRefreshUnreadableAuthorizesNoExecutorAction,
        activeRefreshOfferRequiresRunningEstablished,
        activeRefreshSourceIsTrackerOrTimer,
      })
      .then(selectIndependentTask)
      .expect(state.independentTaskSelected and independentTaskRemainsEligible)
  }

  run healthyActiveRefreshWaitsWithoutExecutorActionTest = {
    init
      .then(establishRunningAttempt)
      .then(offerTrackerRefresh)
      .then(observeHealthyActiveRefresh)
      .expect(and {
        healthyActiveRefreshAuthorizesNoExecutorAction,
        activeRefreshOfferRequiresRunningEstablished,
        activeRefreshSourceIsTrackerOrTimer,
      })
  }

  // Scenario: after an active refresh offer, lifecycle closure requests an
  // exact safe suspension; a fresh reopen then re-establishes Running work as
  // an ordinary continuation with no refresh source.
  run lifecycleReopenReestablishmentResetsRefreshProvenanceTest = {
    init
      .then(establishRunningAttempt)
      .then(offerTimerRefresh)
      .then(observeLifecycleClosure)
      .expect(lifecycleClosedReached and state.decision == RequestSafeSuspension)
      .then(reportSafelySuspended)
      .expect(safelySuspendedReached and not(state.positionHeld))
      .then(observeFreshLifecycleReopen)
      .expect(lifecycleReopenedReached and state.decision == ContinueWork)
      .then(reestablishRunningAttempt)
      .expect(and {
        runningEstablishmentRetainsAuthority,
        state.purpose == OrdinaryRead,
        state.refreshSource == NoRefreshSource,
        state.evidence == ExactRunning,
        state.positionHeld,
      })
  }

  run ordinaryUnreadableReadUsesExactSuspensionRouteTest = {
    init
      .then(observeUnreadableOrdinaryRead)
      .expect(ordinaryUnreadableStillRequestsSafeSuspension)
      .then(reportSafelySuspended)
      .expect(not(state.positionHeld) and positionReleasesOnlyOnExactSafeEvidence)
  }
}
