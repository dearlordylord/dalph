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

  run lifecycleReopenReestablishmentResetsRefreshProvenanceTest = {
    init
      .then(establishRunningAttemptForActiveRefresh)
      .then(offerActiveWorkAuthorityRefreshFromTimer)
      .then(observeLifecycleClosure)
      .then(reportSafelySuspended)
      .then(observeFreshLifecycleReopen)
      .then(establishRunningAttemptForActiveRefresh)
      .expect(and {
        activeWorkRunningEstablishmentRetainsAuthority,
        state.authorityReadPurpose == OrdinaryContinuationRead,
        state.refreshSource == NoRefreshSource,
        state.executorEvidence == ExactExecuting,
        state.positionHeld,
      })
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

  run activeRefreshUnreadableDoesNotSuspendOrContinueTest = {
    init
      .then(establishRunningAttemptForActiveRefresh)
      .then(offerActiveWorkAuthorityRefreshFromTrackerNotification)
      .then(observeUnreadableClaimDuringActiveRefresh)
      .expect(and {
        activeRefreshUnreadableAuthorizesNoExecutorAction,
        state.factDecision == AwaitNextActiveWorkRefresh,
        state.constraint == NoConstraint,
        state.executorEvidence == ExactExecuting,
        state.positionHeld,
        state.implementationResponsibilityRetained,
      })
      .then(selectIndependentTaskB)
      .expect(and {
        state.factDecision == AwaitNextActiveWorkRefresh,
        state.independentTaskSelected,
    })
  }

  run activeRefreshHealthyDoesNotAuthorizeAnotherExecutorActionTest = {
    init
      .then(establishRunningAttemptForActiveRefresh)
      .expect(activeWorkRunningEstablishmentRetainsAuthority)
      .then(offerActiveWorkAuthorityRefreshFromTimer)
      .then(observeHealthyActiveWorkRefresh)
      .expect(and {
        healthyActiveRefreshAuthorizesNoExecutorAction,
        state.factDecision == AwaitNextActiveWorkRefresh,
        state.constraint == NoConstraint,
        state.executorEvidence == ExactExecuting,
        state.positionHeld,
        state.implementationResponsibilityRetained,
    })
  }

  run activeRefreshGitFailuresRemainUnreadableAndNoActionTest = {
    init
      .then(establishRunningAttemptForActiveRefresh)
      .then(offerActiveWorkAuthorityRefreshFromTrackerNotification)
      .then(observeActiveRefreshGitFailures)
      .expect(and {
        activeRefreshGitFailuresAuthorizeNoExecutorAction,
        state.factDecision == AwaitNextActiveWorkRefresh,
        state.constraint == NoConstraint,
        state.executorEvidence == ExactExecuting,
        state.positionHeld,
        state.implementationResponsibilityRetained,
      })
  }

  run continueReadsEveryFreshAuthorityAndResumesOnlyPTest = {
    init
      .then(observeF2Change)
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
      .then(observeF2Change)
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
      .then(observeF2Change)
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
      .then(observeF2Change)
      .then(applyContinueF2)
      .then(redeliverExactF2Choice)
      .then(redeliverExactF2Choice)
      .expect(and {
        state.lastControlResult == ExactRedelivery,
        state.appliedChoiceCount == 1,
        state.continueStage == NeedFreshGraph,
      })
  }

  run continueWinsFirstJournaledChoiceRaceTest = {
    init
      .then(observeF2Change)
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
      .then(observeF2Change)
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
      .then(observeF2Change)
      .then(rejectStopPastIntegrationCutoff)
      .expect(and {
        state.lastControlResult == ChoiceOutsidePreIntegration,
        state.f2WinningChoice == NoChoice,
        state.stopStage == NotStopping,
        postCutoffChoiceNeverApplies,
      })
  }

  run terminalAcceptedPastIntegrationCutoffCannotAuthorizeContinueTest = {
    init
      .then(observeExactTerminal)
      .then(beginIntegration)
      .then(observeF2Change)
      .then(rejectContinuePastIntegrationCutoff)
      .expect(and {
        state.lastControlResult == ChoiceOutsidePreIntegration,
        state.f2WinningChoice == NoChoice,
        state.continueStage == NotContinuing,
        postCutoffChoiceNeverApplies,
      })
  }

  run retainedSafeProofStopsWithoutHoldingPositionTest = {
    init
      .expect(not(state.positionHeld))
      .then(observeF2Change)
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

  run stopCancelsAdmittedUnissuedResumeBeforeExecutorContactTest = {
    init
      .then(observeF2Change)
      .then(admitHeldResumeBeforeTerminalChoice)
      .then(applyStopF2)
      .expect(and {
        not(state.heldResumeAdmitted),
        state.heldResumeCancellationCount == 1,
        state.resumeBoundaryCallCount == 0,
        state.executorEvidence == ExactSafelySuspended,
        terminalChoiceBlocksResumeWhileLifecycleEvidenceRemains,
      })
      .then(admitSameAttemptP.fail())
  }

  run restartCancelsAdmittedUnissuedResumeBeforeExecutorContactTest = {
    init
      .then(observeF2Change)
      .then(admitHeldResumeBeforeTerminalChoice)
      .then(applyRestartF2)
      .expect(and {
        not(state.heldResumeAdmitted),
        state.heldResumeCancellationCount == 1,
        state.resumeBoundaryCallCount == 0,
        state.executorEvidence == ExactSafelySuspended,
        terminalChoiceBlocksResumeWhileLifecycleEvidenceRemains,
      })
      .then(admitSameAttemptP.fail())
  }

  run settledUnchangedSafeResumeConsumesTerminalChoiceAuthorityTest = {
    init
      .then(observeF2Change)
      .then(settleResumeWithUnchangedSafe)
      .expect(and {
        state.executorEvidence == ExactSafelySuspended,
        state.resumeCommandIntentCount == 1,
        state.resumeBoundaryCallCount == 1,
        resumeSettledUnchangedSafeReached,
      })
      .then(applyStopF2.fail())
  }

  run settledUnchangedSafeResumeConsumesRestartAuthorityTest = {
    init
      .then(observeF2Change)
      .then(settleResumeWithUnchangedSafe)
      .then(applyRestartF2.fail())
  }

  run terminalAfterStopIsAbsorbingAndIntegratesNormallyTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(observeExactTerminal)
      .expect(and {
        state.stopStage == NeedQuiescence,
        state.implementationResponsibilityRetained,
        not(state.replacementEventRecorded),
        acceptedTerminalIsAbsorbing,
        terminalChoiceBlocksResumeWhileLifecycleEvidenceRemains,
      })
      .then(beginIntegration)
      .expect(and { state.integrationSelected, stopNeverSelectsIntegration })
  }

  run terminalAfterRestartIsAbsorbingAndIntegratesNormallyTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(observeExactTerminal)
      .expect(and {
        state.replacementPhase == RestartApplied,
        state.implementationResponsibilityRetained,
        not(state.replacementEventRecorded),
        acceptedTerminalIsAbsorbing,
        terminalChoiceBlocksResumeWhileLifecycleEvidenceRemains,
      })
      .then(beginIntegration)
      .expect(and { state.integrationSelected, restartNeverSelectsIntegration })
  }

  run terminalAfterStopCannotAbandonImplementationTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(observeExactTerminal)
      .then(abandonImplementation.fail())
  }

  run terminalCannotBeAcceptedAfterStopAlreadyAbandonedTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(observeExactTerminal.fail())
  }

  run terminalAfterRestartCannotBeginReplacementTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(observeExactTerminal)
      .then(beginReplacementFactsFromRetainedSafeSuspension.fail())
  }

  run terminalAfterRestartAuthorizationBeganBlocksExactTaskFactsTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeExactTerminal)
      .then(observeReplacementExactF2TaskFacts.fail())
  }

  run terminalAfterRestartAuthorizationBeganBlocksChangedTaskFactsTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeExactTerminal)
      .then(observeReplacementF3TaskFacts.fail())
  }

  run terminalAfterRestartAuthorizationBeganBlocksUnreadableTaskFactsTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeExactTerminal)
      .then(observeReplacementTaskFactsUnreadable.fail())
  }

  run terminalAfterRestartAuthorizationBeganBlocksIneligibleTaskFactsTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeExactTerminal)
      .then(observeReplacementTaskNotEligible.fail())
  }

  run terminalAfterRestartTaskFactsReadBlocksExactClaimTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeExactTerminal)
      .then(observeReplacementExactK1.fail())
  }

  run terminalAfterRestartTaskFactsReadBlocksAbsentClaimTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeExactTerminal)
      .then(observeReplacementClaimAbsent.fail())
  }

  run terminalAfterRestartTaskFactsReadBlocksForeignClaimTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeExactTerminal)
      .then(observeReplacementClaimForeign.fail())
  }

  run terminalAfterRestartTaskFactsReadBlocksUnreadableClaimTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeExactTerminal)
      .then(observeReplacementClaimUnreadable.fail())
  }

  run terminalAfterRestartTaskFactsReadBlocksBoundedUnreadableClaimTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeExactTerminal)
      .then(observeReplacementClaimUnreadableBounded.fail())
  }

  run terminalAfterRestartTaskFactsReadBlocksClaimReadRecoveryTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementClaimUnreadable)
      .then(observeExactTerminal)
      .then(recoverReplacementClaimReadActivation.fail())
  }

  run terminalAfterRestartClaimReadBlocksReadyWorktreeTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeExactTerminal)
      .then(observeReplacementExactW1Ready.fail())
  }

  run terminalAfterRestartClaimReadBlocksUnreadyWorktreeTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeExactTerminal)
      .then(observeReplacementW1NotReady.fail())
  }

  run terminalAfterRestartClaimReadBlocksUnreadableWorktreeTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeExactTerminal)
      .then(observeReplacementW1Unreadable.fail())
  }

  run terminalAfterRestartWorktreeReadBlocksExactTargetTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeExactTerminal)
      .then(observeReplacementExactH2.fail())
  }

  run terminalAfterRestartWorktreeReadBlocksUnreadableTargetTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeExactTerminal)
      .then(observeReplacementH2Unreadable.fail())
  }

  run terminalAfterRestartTargetReadBlocksAbsentAppendRecoveryTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(observeExactTerminal)
      .then(recoverReplacementAppendAbsent.fail())
  }

  run terminalAfterRestartTargetReadBlocksReplacementAppendTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(observeExactTerminal)
      .then(recordPlannedAttemptReplacement.fail())
  }

  run terminalObservationAloneExposesNeitherChoiceTest = {
    init
      .then(observeF2Change)
      .then(observeExactTerminal)
      .expect(terminalObservationAloneExposesNoChoice)
  }

  run stopReleasesOnlyFreshlyConfirmedExactClaimTest = {
    init
      .then(observeF2Change)
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
      .then(observeF2Change)
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
      .then(observeF2Change)
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
      .then(observeF2Change)
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
      .then(observeF2Change)
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(observeExactClaim)
      .then(recordClaimReleaseIntent)
      .then(loseClaimReleaseResponse)
      .then(projectClaimStillExact)
      .then(recoverClaimActivation)
      .then(observeExactClaim)
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
      .then(observeF2Change)
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

  run lostExactAuthorizedReleaseCanLaterObserveAbsentWithoutMutationTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(observeExactClaim)
      .then(recordClaimReleaseIntent)
      .then(loseClaimReleaseResponse)
      .then(projectClaimStillExact)
      .then(recoverClaimActivation)
      .then(observeAbsentClaim)
      .expect(and {
        state.claimResult == NoReleaseAbsent,
        state.claimReleaseCallCount == 1,
        state.claimReleaseCallCountAtNonExactObservation == 1,
        absentForeignUnreadableClaimsAreNeverMutated,
      })
  }

  run claimReleaseCallsStopAtThreeAcrossLaterActivationsTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(observeExactClaim)
      .then(recordClaimReleaseIntent)
      .then(loseClaimReleaseResponse)
      .then(projectClaimStillExact)
      .then(recoverClaimActivation)
      .then(observeExactClaim)
      .then(loseClaimReleaseResponse)
      .then(projectClaimStillExact)
      .then(recoverClaimActivation)
      .then(observeExactClaim)
      .then(loseClaimReleaseResponse)
      .then(projectClaimStillExact)
      .expect(and {
        state.claimReleaseCallCount == 3,
        state.claimRecoveryCount == 2,
        state.stopStage == ClaimReleaseRetryWait,
        claimReleaseIsBoundedAndReconciled,
      })
  }

  run restartIsTheThirdExactChoiceAndFirstJournaledWinnerTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(redeliverExactF2Choice)
      .then(rejectLosingF2Choice)
      .expect(and {
        state.f2WinningChoice == RestartChoice,
        state.firstF2Choice == RestartChoice,
        state.winningRequestId.nonce == RESTART_D1.nonce,
        state.appliedChoiceCount == 1,
        state.lastControlResult == ChoiceAlreadyApplied,
        firstJournaledChoiceWins,
      })
  }

  run safeSuspensionAndExactFreshFactsAtomicallyRecordCleanP2Test = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(recordPlannedAttemptReplacement)
      .expect(and {
        state.replacementPhase == PlannedAttemptReplacementRecorded,
        state.p1Superseded,
        not(state.p1Unsettled),
        state.plannedSuccessor == PlannedP2,
        state.replacementEventCount == 1,
        state.successorAllocationCount == 1,
        state.successorBaseHead == TARGET_HEAD_H2,
        state.successorWorktreeIdentity == WORKTREE_W2,
        not(state.successorWorktreeReady),
        not(state.successorPositionHeld),
        not(state.successorExecutorResponsibilityRetained),
        plannedAttemptReplacementRequiresExactCurrentEvidence,
        plannedAttemptReplacementIsAtomic,
        replacementLeavesAtMostOneUnsettledAttempt,
        restartPreservesP1Resources,
        restartRetainsExactK1WithoutTrackerMutation,
        restartSendsNoClaimMutation,
        successorPlanIsCleanW2AtExactH2,
        replacementEventDoesNotClaimW2OrExecutorWork,
      })
      .then(prepareCleanSuccessorW2)
      .expect(and {
        state.replacementPhase == SuccessorWaitingForAdmission,
        state.successorWorktreeReady,
        not(state.successorPositionHeld),
        state.successorExecutorStartCount == 0,
      })
      .then(admitSuccessorThroughOrdinaryCapacity)
      .expect(and {
        state.replacementPhase == SuccessorAdmitted,
        state.successorAdmissionCount == 1,
        state.successorPositionHeld,
        state.successorExecutorStartCount == 0,
      })
      .then(startSuccessorExecutor)
      .expect(and {
        state.replacementPhase == SuccessorExecuting,
        state.successorExecutorStartCount == 1,
        state.successorExecutorResponsibilityRetained,
        successorUsesOrdinaryBoundedAdmission,
        p1AndP2ExecutorResponsibilitiesNeverOverlap,
        restartNeverSelectsIntegration,
      })
  }

  run absentReplacementAppendCrashRereadsFactsAndAllocatesOnlyP2Test = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(recoverReplacementAppendAbsent)
      .expect(and {
        state.replacementPhase == NeedCurrentReplacementTaskFacts,
        state.p1Unsettled,
        not(state.p1Superseded),
        state.plannedSuccessor == NoPlannedSuccessor,
        not(state.replacementEventRecorded),
        state.successorAllocationCount == 0,
        crashKeepsEitherNoP2OrTheSameP2,
      })
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(recordPlannedAttemptReplacement)
      .expect(and {
        state.plannedSuccessor == PlannedP2,
        state.successorAllocationCount == 1,
        state.replacementEventCount == 1,
        replacementNeverAllocatesP3,
      })
  }

  run presentReplacementAppendCrashReusesExactP2WithoutP3Test = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(recordPlannedAttemptReplacement)
      .then(recoverReplacementAppendPresent)
      .then(recoverReplacementAppendPresent)
      .expect(and {
        state.replacementProcessLossCount == 2,
        state.plannedSuccessor == PlannedP2,
        state.successorAllocationCount == 1,
        state.replacementEventCount == 1,
        crashKeepsEitherNoP2OrTheSameP2,
        replacementNeverAllocatesP3,
      })
      .then(prepareCleanSuccessorW2)
      .then(admitSuccessorThroughOrdinaryCapacity)
      .then(startSuccessorExecutor)
      .expect(successorUsesOrdinaryBoundedAdmission)
  }

  run F3AfterAppliedRestartRequiresNewChoiceAndRecordsNoP2Test = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementF3TaskFacts)
      .expect(and {
        state.currentFingerprint == F3,
        state.replacementDisposition == NewFingerprintChoiceRequired,
        state.continueStage == NewChoiceRequired,
        state.constraint == SpecificationConstraint,
        state.factDecision == SpecificationChoices,
        state.f3WinningChoice == NoChoice,
        not(state.replacementEventRecorded),
        state.plannedSuccessor == NoPlannedSuccessor,
        changedAgainRequiresNewChoice,
      })
      .then(applyContinueF3.fail())
  }

  run unreadableOrNoneligibleTaskFactsRecordNoP2Test = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementTaskFactsUnreadable)
      .expect(and {
        state.replacementDisposition == TaskFactsUnreadableWait,
        not(state.replacementEventRecorded),
      })
  }

  run noneligibleTaskFactsRecordNoP2Test = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementTaskNotEligible)
      .expect(and {
        state.replacementDisposition == TaskNotEligibleWait,
        not(state.replacementEventRecorded),
      })
  }

  run absentK1RecordsNoP2AndSendsNoClaimMutationTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementClaimAbsent)
      .expect(and {
        state.replacementDisposition == ClaimAbsentWait,
        state.claimState == MissingClaim,
        not(state.exactClaimHeld),
        not(state.replacementEventRecorded),
        state.replacementClaimMutationCallCount == 0,
        restartSendsNoClaimMutation,
      })
  }

  run foreignK1RecordsNoP2AndSendsNoClaimMutationTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementClaimForeign)
      .expect(and {
        state.replacementDisposition == ClaimForeignWait,
        state.claimState == ForeignClaim,
        not(state.exactClaimHeld),
        not(state.replacementEventRecorded),
        state.replacementClaimMutationCallCount == 0,
        restartSendsNoClaimMutation,
      })
  }

  run unreadableK1RecordsNoP2AndSendsNoClaimMutationTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementClaimUnreadable)
      .expect(and {
        state.replacementPhase == NeedCurrentReplacementClaim,
        state.replacementClaimReadsThisActivation == 1,
        state.claimState == UnreadableClaim,
        not(state.replacementEventRecorded),
      })
      .then(observeReplacementClaimUnreadable)
      .expect(and {
        state.replacementPhase == NeedCurrentReplacementClaim,
        state.replacementClaimReadsThisActivation == 2,
        not(state.replacementEventRecorded),
      })
      .then(observeReplacementClaimUnreadable)
      .expect(and {
        state.replacementPhase == ReplacementWaiting,
        state.replacementDisposition == ClaimUnreadableWait,
        state.replacementClaimReadsThisActivation == REPLACEMENT_CLAIM_READ_LIMIT,
        not(state.replacementEventRecorded),
        state.replacementClaimMutationCallCount == 0,
        replacementClaimReadsAreBounded,
        restartSendsNoClaimMutation,
      })
  }

  run processLossResetsOnlyUnreadableK1ReadAllowanceTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementClaimUnreadable)
      .then(observeReplacementClaimUnreadable)
      .then(recoverReplacementClaimReadActivation)
      .expect(and {
        state.replacementPhase == NeedCurrentReplacementClaim,
        state.replacementClaimFacts == ReplacementClaimNotRead,
        state.replacementClaimReadsThisActivation == 0,
        state.claimState == UnreadableClaim,
        state.replacementProcessLossCount == 1,
        state.replacementClaimMutationCallCount == 0,
        replacementClaimReadsAreBounded,
      })
  }

  run nonreadyW1DelegatesWithoutReplacementOrCleanupTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementW1NotReady)
      .expect(and {
        state.replacementDisposition == OldWorktreeNotReadyWait,
        not(state.replacementEventRecorded),
        state.replacementCleanupCallCount == 0,
        restartPreservesP1Resources,
      })
  }

  run unreadableW1DelegatesWithoutReplacementOrCleanupTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementW1Unreadable)
      .expect(and {
        state.replacementDisposition == OldWorktreeUnreadableWait,
        not(state.replacementEventRecorded),
        state.replacementCleanupCallCount == 0,
        restartPreservesP1Resources,
      })
  }

  run unreadableH2RecordsNoP2Test = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementH2Unreadable)
      .expect(and {
        state.replacementDisposition == TargetHeadUnreadableWait,
        not(state.replacementEventRecorded),
        state.plannedSuccessor == NoPlannedSuccessor,
      })
  }

  run restartPastIntegrationCutoffCrossesNoBoundaryTest = {
    init
      .then(observeExactTerminal)
      .then(beginIntegration)
      .then(observeF2Change)
      .then(rejectRestartPastIntegrationCutoff)
      .expect(and {
        state.lastControlResult == ChoiceOutsidePreIntegration,
        state.f2WinningChoice == NoChoice,
        state.replacementPhase == ReplacementRejected,
        state.replacementDisposition == PastIntegrationCutoff,
        not(state.replacementEventRecorded),
        state.replacementClaimMutationCallCount == 0,
        state.replacementCleanupCallCount == 0,
        postCutoffChoiceNeverApplies,
      })
  }
}
