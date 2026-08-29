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
        state.executorEvidence == ExactRunning,
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
        state.executorEvidence == ExactRunning,
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
        state.executorEvidence == ExactRunning,
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
        state.executorEvidence == ExactRunning,
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

  run terminalAfterAppliedStopCanProveStoppageTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(requireStoppageReconciliation)
      .then(recordStoppageIntent)
      .then(callStoppage)
      .then(loseStoppageResponse)
      .then(recoverStopActivation)
      .then(projectExactTerminalForStoppage)
      .then(abandonImplementation)
      .expect(and {
        state.executorEvidence == ExactTerminal,
        not(state.implementationResponsibilityRetained),
        not(state.positionHeld),
        abandonmentRequiresExactUnbrokenQuiescence,
      })
  }

  run terminalObservationAloneExposesNeitherChoiceTest = {
    init
      .then(observeF2Change)
      .then(observeExactTerminal)
      .expect(terminalObservationAloneExposesNoChoice)
  }

  run projectedRunningSettlesIntentButNeverProvesQuiescenceTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(requireStoppageReconciliation)
      .then(recordStoppageIntent)
      .then(callStoppage)
      .then(loseStoppageResponse)
      .then(recoverStopActivation)
      .then(projectExactRunningForStoppage)
      .expect(and {
        state.stopCommandSettlementCount == 1,
        state.lastSettledStopCommandOrdinal == 2,
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

  run threeRunningStoppageCallsStillAllowLaterReadOnlySafeProofTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(requireStoppageReconciliation)
      .then(recordStoppageIntent)
      .then(callStoppage)
      .then(loseStoppageResponse)
      .then(recoverStopActivation)
      .then(projectExactRunningForStoppage)
      .then(recordStoppageIntent)
      .then(callStoppage)
      .then(loseStoppageResponse)
      .then(recoverStopActivation)
      .then(projectExactRunningForStoppage)
      .then(recordStoppageIntent)
      .then(callStoppage)
      .then(loseStoppageResponse)
      .then(recoverStopActivation)
      .then(projectExactRunningForStoppage)
      .expect(and {
        state.stopCommandIntentCount == STOP_COMMAND_LIMIT,
        state.suspensionCommandCountSinceSafeEvidence == STOP_COMMAND_LIMIT,
        state.stopCommandSettlementCount == STOP_COMMAND_LIMIT,
        stoppageLimitPreservesReadOnlyRecovery,
      })
      .then(recoverStopActivation)
      .then(projectReadOnlyExactSafeAfterStoppageLimit)
      .expect(and {
        not(state.implementationResponsibilityRetained),
        not(state.positionHeld),
        abandonmentRequiresExactUnbrokenQuiescence,
      })
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
        state.replacementPhase == SuccessorRunning,
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

  run brokenSafeProofCanUseExactSafeReportThenFreshFactsTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(breakRestartSafeSuspension)
      .expect(and {
        state.replacementPhase == NeedCurrentExecutorQuiescence,
        state.replacementTaskFacts == ReplacementTaskFactsNotRead,
        state.positionHeld,
        stoppageCallsHaveExactDurableIntents,
      })
      .then(observeRestartSafelySuspended)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(recordPlannedAttemptReplacement)
      .expect(and {
        state.executorEvidence == ExactSafelySuspended,
        state.replacementEventRecorded,
        stoppageCallsHaveExactDurableIntents,
        plannedAttemptReplacementRequiresExactCurrentEvidence,
      })
  }

  run lateAcceptedPreservesEvidenceSkipsIntegrationAndUsesFreshFactsTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(breakRestartSafeSuspension)
      .then(observeRestartAccepted)
      .expect(and {
        state.executorEvidence == ExactAcceptedTerminal,
        state.lateAcceptedCommitPreserved,
        state.lateAcceptedEvidencePreserved,
        not(state.implementationResponsibilityRetained),
        state.replacementTaskFacts == ReplacementTaskFactsNotRead,
        state.lateAcceptedIntegrationResponsibilityCount == 0,
        lateAcceptedNeverCreatesIntegrationResponsibility,
      })
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(recordPlannedAttemptReplacement)
      .expect(and {
        state.replacementEventRecorded,
        state.plannedSuccessor == PlannedP2,
        state.lateAcceptedCommitPreserved,
        state.lateAcceptedIntegrationResponsibilityCount == 0,
        plannedAttemptReplacementRequiresExactCurrentEvidence,
        restartNeverSelectsIntegration,
      })
  }

  run runningWriterKeepsP1AndLetsIndependentCContinueTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(breakRestartSafeSuspension)
      .then(observeRestartRunning)
      .then(selectIndependentTaskB)
      .expect(and {
        state.replacementPhase == ReplacementWaiting,
        state.replacementDisposition == RunningWriterWait,
        state.implementationResponsibilityRetained,
        state.p1Unsettled,
        state.positionHeld,
        not(state.replacementEventRecorded),
        state.independentTaskSelected,
        stoppageCallsHaveExactDurableIntents,
        nonAuthorizingExecutorEvidenceNeverRecordsReplacement,
      })
  }

  run restartSuspensionLimitUsesReadOnlySafeEvidenceTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(breakRestartSafeSuspension)
      .then(observeRestartRunning)
      .then(observeRestartRunning)
      .then(observeRestartRunning)
      .expect(and {
        state.replacementPhase == ReplacementWaiting,
        state.stopCommandIntentCount == STOP_COMMAND_LIMIT,
        state.suspensionCommandCountSinceSafeEvidence == STOP_COMMAND_LIMIT,
        stoppageCallsHaveExactDurableIntents,
        stoppageIsBounded,
      })
      .then(observeRestartSafelySuspended)
      .expect(and {
        state.replacementPhase == NeedCurrentReplacementTaskFacts,
        state.executorEvidence == ExactSafelySuspended,
        state.stopCommandIntentCount == STOP_COMMAND_LIMIT,
        state.stopCommandSettlementCount == STOP_COMMAND_LIMIT,
        state.suspensionCommandCountSinceSafeEvidence == 0,
        stoppageCallsHaveExactDurableIntents,
        stoppageIsBounded,
      })
  }

  run completedTerminalEndsOnlyP1ExecutorWorkWithoutReplacementTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(breakRestartSafeSuspension)
      .then(observeRestartCompleted)
      .expect(and {
        state.replacementDisposition == CompletedDoesNotAuthorizeReplacement,
        state.completedResultPreserved,
        not(state.implementationResponsibilityRetained),
        not(state.replacementEventRecorded),
        replacementTerminalOutcomesRemainDistinct,
        nonAuthorizingExecutorEvidenceNeverRecordsReplacement,
      })
  }

  run failedTerminalEndsOnlyP1ExecutorWorkWithoutReplacementTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(breakRestartSafeSuspension)
      .then(observeRestartFailed)
      .expect(and {
        state.replacementDisposition == FailedDoesNotAuthorizeReplacement,
        state.failedResultPreserved,
        not(state.implementationResponsibilityRetained),
        not(state.replacementEventRecorded),
        replacementTerminalOutcomesRemainDistinct,
        nonAuthorizingExecutorEvidenceNeverRecordsReplacement,
      })
  }

  run unreadableOrContradictoryExecutorCannotAuthorizeReplacementTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(breakRestartSafeSuspension)
      .then(observeRestartExecutorUnavailable)
      .expect(and {
        state.replacementDisposition == ExecutorUnreadableWait,
        not(state.replacementEventRecorded),
        nonAuthorizingExecutorEvidenceNeverRecordsReplacement,
      })
      .then(observeRestartExecutorContradiction)
      .expect(and {
        state.replacementDisposition == ExecutorCorrelationContradiction,
        not(state.replacementEventRecorded),
        nonAuthorizingExecutorEvidenceNeverRecordsReplacement,
      })
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
