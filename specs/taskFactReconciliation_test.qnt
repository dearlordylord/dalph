module taskFactReconciliationTest {
  import taskFactReconciliation.* from "./taskFactReconciliation"

  run changedInstructionsExposeChoicesAfterSafeSuspensionTest = {
    init
      .then(observeSpecificationChange)
      .then(reportSafelySuspended)
      .expect(specificationChoicesReached and changedFactsPreserveWip)
  }

  run lifecycleCloseReopenPreservesAttemptTest = {
    init
      .then(observeLifecycleClosure)
      .then(reportSafelySuspended)
      .then(observeFreshLifecycleReopen)
      .expect(state.factDecision == ContinueWork and changedFactsPreserveWip)
  }

  run membershipLossWaitsAfterSafeSuspensionTest = {
    init
      .then(observeMembershipLoss)
      .then(reportSafelySuspended)
      .expect(membershipWaitReached and changedFactsPreserveWip)
  }

  run incompleteReadCannotProveMembershipLossTest = {
    init
      .then(observeIncompleteMembershipRead)
      .expect(state.factDecision == ContinueWork and state.constraint == NoConstraint)
  }

  run externalSuccessIsFinalWithoutDuplicateDeliveryTest = {
    init
      .then(observeExternalSuccess)
      .then(reportSafelySuspended)
      .then(releaseExternalSuccessExactClaim)
      .expect(and {
        externalSuccessSettledReached,
        externalSuccessPreventsDuplicateDelivery,
        externalSuccessSettlesAfterExactClaimRelease,
        changedFactsPreserveWip,
      })
  }

  run foreignClaimStopsOnlyATest = {
    init
      .then(observeForeignClaimConstraint)
      .then(reportSafelySuspended)
      .then(applyForeignClaimReacquisitionDirection)
      .then(rejectForeignClaimReacquisition)
      .then(selectIndependentTaskB)
      .expect(and {
        foreignClaimWaitReached,
        foreignClaimIsNeverChanged,
        state.independentTaskSelected,
      })
  }

  run missingClaimRequiresAppliedDirectionTest = {
    init
      .then(observeMissingClaimConstraint)
      .then(reportSafelySuspended)
      .then(selectIndependentTaskB)
      .expect(and {
        missingClaimWaitReached,
        not(state.replacementIntentRecorded),
        state.independentTaskSelected,
      })
      .then(applyMissingClaimReacquisitionDirection)
      .then(planReplacementClaim)
      .then(observeExactReplacementClaim)
      .expect(and {
        replacementClaimObserved,
        replacementClaimRequiresDirectionAndIntent,
        replacementClaimIdentityIsFresh,
      })
  }

  run unreadableClaimCannotAuthorizeProgressOrLossTest = {
    init
      .then(observeUnreadableClaimConstraint)
      .then(reportSafelySuspended)
      .then(selectIndependentTaskB)
      .expect(and {
        unreadableClaimWaitReached,
        unreadableClaimCannotAuthorizeReplacement,
        state.exactClaimHeld,
        state.independentTaskSelected,
      })
  }

  run continueReadsEveryFreshAuthorityAndResumesOnlyPTest = {
    init
      .then(applyContinueF2)
      .then(readFreshExactGraph)
      .then(readFreshExactSpecification)
      .then(readFreshExactClaim)
      .then(readFreshExactWorktree)
      .then(readFreshExactLineage)
      .then(readFreshExactExecutor)
      .then(admitSameAttemptP)
      .expect(and {
        state.continueStage == ContinueResumed,
        state.resumedAttempt == AttemptP,
        state.positionHeld,
        state.authorizedFingerprint == F2,
        continueRequiresEveryFreshExactAuthority,
        continueResumesOnlyImmutableAttemptP,
        stopPreservesEveryArtifact,
        not(state.integrationSelected),
      })
  }

  run fingerprintF3RequiresNewChoiceBeforeContinuationTest = {
    init
      .then(applyContinueF2)
      .then(readFreshExactGraph)
      .then(observeF3BeforeContinuation)
      .expect(and {
        state.continueStage == NewChoiceRequired,
        state.authorizedFingerprint == F2,
        not(exactContinueFacts(state)),
        changedAgainRequiresNewChoice,
      })
      .then(applyContinueF3)
      .then(readFreshExactGraph)
      .then(readFreshExactSpecification)
      .then(readFreshExactClaim)
      .then(readFreshExactWorktree)
      .then(readFreshExactLineage)
      .then(readFreshExactExecutor)
      .then(admitSameAttemptP)
      .expect(and {
        state.authorizedFingerprint == F3,
        state.appliedChoiceCount == 2,
        state.resumedAttempt == AttemptP,
      })
  }

  run runBindingAndPersistedContentContradictionsStayDistinctTest = {
    init
      .then(rejectRunMismatchedRequest)
      .expect(state.lastControlResult == RequestRunBindingMismatch)
      .then(applyContinueF2)
      .then(rejectPersistedRequestContentReuse)
      .expect(and {
        state.lastControlResult == PersistedRequestContentContradiction,
        state.f2WinningChoice == ContinueChoice,
        state.appliedChoiceCount == 1,
        requestIdentityErrorsRemainDistinct,
      })
  }

  run exactRedeliveryCoalescesWithoutAnotherChoiceTest = {
    init
      .then(applyContinueF2)
      .then(redeliverExactF2Choice)
      .expect(and {
        state.lastControlResult == ExactRedelivery,
        state.appliedChoiceCount == 1,
        state.continueStage == NeedFreshGraph,
      })
  }

  run continueWinsFirstJournaledChoiceRaceTest = {
    init
      .then(applyContinueF2)
      .then(rejectLosingF2Choice)
      .expect(and {
        state.f2WinningChoice == ContinueChoice,
        state.lastControlResult == ChoiceAlreadyApplied,
        state.appliedChoiceCount == 1,
        firstJournaledChoiceWins,
      })
  }

  run stopWinsFirstJournaledChoiceRaceTest = {
    init
      .then(applyStopF2)
      .then(rejectLosingF2Choice)
      .expect(and {
        state.f2WinningChoice == StopChoice,
        state.lastControlResult == ChoiceAlreadyApplied,
        state.appliedChoiceCount == 1,
        firstJournaledChoiceWins,
      })
  }

  run terminalAcceptedPastIntegrationCutoffCannotAuthorizeStopTest = {
    init
      .then(observeExactTerminal)
      .then(beginIntegration)
      .then(rejectStopPastIntegrationCutoff)
      .expect(and {
        state.lastControlResult == ChoiceOutsidePreIntegration,
        state.f2WinningChoice == NoChoice,
        state.stopStage == NotStopping,
        postCutoffChoiceNeverApplies,
      })
  }

  run retainedSafeProofStopsWithoutHoldingPositionTest = {
    init
      .expect(not(state.positionHeld))
      .then(applyStopF2)
      .then(abandonImplementation)
      .expect(and {
        not(state.implementationResponsibilityRetained),
        not(state.positionHeld),
        state.stopStage == NeedClaimObservation,
        abandonmentRequiresExactUnbrokenQuiescence,
        quiescentStopNeedNotHoldPosition,
        stopPreservesEveryArtifact,
        stopNeverSelectsIntegration,
      })
  }

  run retainedExactTerminalProofCanStopBeforeCutoffTest = {
    init
      .then(observeExactTerminal)
      .then(applyStopF2)
      .then(abandonImplementation)
      .expect(and {
        state.executorEvidence == ExactTerminal,
        not(state.implementationResponsibilityRetained),
        not(state.positionHeld),
        abandonmentRequiresExactUnbrokenQuiescence,
      })
  }

  run projectedRunningSettlesIntentButNeverProvesQuiescenceTest = {
    init
      .then(applyStopF2)
      .then(requireStoppageReconciliation)
      .then(recordStoppageIntent)
      .then(callStoppage)
      .then(loseStoppageResponse)
      .then(projectExactRunningForStoppage)
      .expect(and {
        state.stopCommandSettlementCount == 1,
        state.lastSettledStopCommandOrdinal == 1,
        state.stopStage == NeedQuiescence,
        state.implementationResponsibilityRetained,
        state.positionHeld,
        projectedRunningSettlesOnlyItsIntent,
      })
      .then(recoverStopActivation)
      .then(recordStoppageIntent)
      .then(callStoppage)
      .then(loseStoppageResponse)
      .then(projectExactSafeForStoppage)
      .then(abandonImplementation)
      .expect(and {
        state.stopCommandSettlementCount == 2,
        not(state.implementationResponsibilityRetained),
        abandonmentRequiresExactUnbrokenQuiescence,
      })
  }

  run stopReleasesOnlyFreshlyConfirmedExactClaimTest = {
    init
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(observeExactClaim)
      .then(recordClaimReleaseIntent)
      .then(releaseExactClaim)
      .expect(and {
        state.stopStage == StopComplete,
        state.claimResult == ExactClaimReleased,
        state.claimReleaseCallCount == 1,
        claimChangesOnlyAfterAbandonmentAndExactRead,
        stopPreservesEveryArtifact,
      })
  }

  run stoppedAttemptLeavesAbsentClaimUnchangedTest = {
    init
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(observeAbsentClaim)
      .expect(and {
        state.claimResult == NoReleaseAbsent,
        state.claimReleaseCallCount == 0,
        absentForeignUnreadableClaimsAreNeverMutated,
      })
  }

  run stoppedAttemptLeavesForeignClaimUnchangedAndBProgressesTest = {
    init
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(selectIndependentTaskB)
      .then(observeForeignClaim)
      .expect(and {
        state.claimResult == NoReleaseForeign,
        state.claimReleaseCallCount == 0,
        state.independentTaskSelected,
        unrelatedTaskBRemainsEligible,
        absentForeignUnreadableClaimsAreNeverMutated,
      })
  }

  run unreadableClaimRetainsSeparateResponsibilityAcrossBoundedRecoveryTest = {
    init
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(observeUnreadableClaim)
      .then(selectIndependentTaskB)
      .expect(and {
        state.stopStage == StopWaiting,
        state.unresolvedClaimReleaseResponsibility,
        not(state.implementationResponsibilityRetained),
        state.independentTaskSelected,
        unreadableClaimRemainsSeparateResponsibility,
      })
      .then(recoverClaimActivation)
      .then(observeAbsentClaim)
      .expect(and {
        state.stopStage == StopComplete,
        state.claimRecoveryCount == 1,
        claimReleaseIsBoundedAndReconciled,
      })
  }

  run ambiguousClaimReleaseReconcilesBeforeBoundedRetryTest = {
    init
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(observeExactClaim)
      .then(recordClaimReleaseIntent)
      .then(loseClaimReleaseResponse)
      .then(projectClaimStillExact)
      .then(recoverClaimActivation)
      .then(releaseExactClaim)
      .expect(and {
        state.claimReleaseCallCount == 2,
        state.claimResult == ExactClaimReleased,
        state.stopStage == StopComplete,
        claimReleaseIsBoundedAndReconciled,
      })
  }

  run lostClaimReleaseResponseCanProjectExactReleaseTest = {
    init
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(observeExactClaim)
      .then(recordClaimReleaseIntent)
      .then(loseClaimReleaseResponse)
      .then(projectClaimReleased)
      .expect(and {
        state.claimReleaseCallCount == 1,
        state.claimResult == ExactClaimReleased,
        state.stopStage == StopComplete,
        claimReleaseIsBoundedAndReconciled,
      })
  }

  run claimReleaseCallsStopAtThreeAcrossLaterActivationsTest = {
    init
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(observeExactClaim)
      .then(recordClaimReleaseIntent)
      .then(loseClaimReleaseResponse)
      .then(projectClaimStillExact)
      .then(recoverClaimActivation)
      .then(loseClaimReleaseResponse)
      .then(projectClaimStillExact)
      .then(recoverClaimActivation)
      .then(loseClaimReleaseResponse)
      .then(projectClaimStillExact)
      .expect(and {
        state.claimReleaseCallCount == 3,
        state.claimRecoveryCount == 2,
        state.stopStage == ClaimReleaseRetryWait,
        claimReleaseIsBoundedAndReconciled,
      })
  }
}
