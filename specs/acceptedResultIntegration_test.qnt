module acceptedResultIntegrationTest {
  import acceptedResultIntegration.* from "./acceptedResultIntegration"

  run journalOrderSurvivesRestartTest = {
    init
      .then(acceptResult(1))
      .then(acceptResult(2))
      .then(queueAcceptedResult(1))
      .then(queueAcceptedResult(2))
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(observeTargetFacts(1))
      .then(startIntegration(1))
      .expect(and {
        restartReached,
        state.results.get(1).phase == Started,
        state.results.get(2).phase == Queued,
        state.results.get(1).queuePosition < state.results.get(2).queuePosition,
      })
  }

  run acceptedTerminalReconcilesAfterRestartTest = {
    init
      .then(acceptResult(1))
      .then(recoverCoordinator)
      .then(queueAcceptedResult(1))
      .expect(and {
        restartReached,
        state.results.get(1).phase == Queued,
        state.results.get(1).queuePosition == 1,
        state.results.get(1).preIntegrationCancellation,
      })
  }

  run restartRequiresFreshTrackerFactsBeforeStartTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(recoverCoordinator)
      .then(all {
        assert(not(canStart(state, 1))),
        observeTrackerFacts,
      })
      .then(observeTargetFacts(1))
      .then(startIntegration(1))
      .expect(and {
        restartReached,
        state.trackerFactsCurrent,
        state.results.get(1).phase == Started,
      })
  }

  run startConsumesCancellationCapabilityTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .expect(and {
        startedReached,
        targetHeldOnlyForActiveIntegration,
        cancellationExactlyQueued,
        not(state.results.get(1).preIntegrationCancellation),
      })
  }

  run blockerReleasesTargetWithoutDiscardingResultTest = {
    init
      .then(acceptResult(1))
      .then(acceptResult(2))
      .then(queueAcceptedResult(1))
      .then(queueAcceptedResult(2))
      .then(startIntegration(1))
      .then(waitOnDependency(1))
      .expect(and {
        dependencyWaitReleasedTarget,
        state.results.get(1).queuePosition == 1,
        state.results.get(1).phase == DependencyWait,
        state.results.get(2).phase == Queued,
        not(state.results.get(2).targetHeld),
      })
  }

  run explicitExactCandidateFixesOrderedParentsTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .expect(and {
        candidateReadyReached,
        candidateReadyHasExactOrderedParents,
        state.results.get(1).submittedCandidate == 31,
        state.results.get(1).integrationSession == 1,
      })
  }

  run unreadableGitPreservesExplicitSubmissionAcrossRestartTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(gitReadFails(1))
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(observeTargetFacts(1))
      .then(reacquireIntegrationTarget(1))
      .then(observeExactCandidate(1))
      .expect(and {
        restartReached,
        candidateReadyReached,
        state.results.get(1).submittedCandidate == 31,
        state.results.get(1).integrationSession == 1,
      })
  }

  run candidateReadyRestartReconstructsNoTargetLeaseTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(observeTargetFacts(1))
      .expect(and {
        state.results.get(1).phase == CandidateReady,
        not(state.results.get(1).targetHeld),
        canReacquireTarget(state, 1),
      })
  }

  run reacquisitionWaitsForFreshMatchingTargetHeadTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .expect(and {
        not(state.targetFactsCurrent),
        not(canReacquireTarget(state, 1)),
        not(state.results.get(1).targetHeld),
      })
      .then(observeTargetFacts(1))
      .expect(and {
        state.targetFactsCurrent,
        targetHeadProofReached,
        state.targetHeadProof == state.results.get(1).expectedTargetHead,
        canReacquireTarget(state, 1),
      })
      .then(reacquireIntegrationTarget(1))
      .expect(and {
        state.results.get(1).targetHeld,
        not(state.targetReacquisitionRequired),
      })
  }

  run correlationContradictionRestartReconstructsNoTargetLeaseTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(reportForeignCorrelation(1))
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .expect(and {
        state.results.get(1).phase == CorrelationContradiction,
        not(state.results.get(1).targetHeld),
        not(canReacquireTarget(state, 1)),
      })
  }

  run correctionReusesSessionAndAcceptsFirstCorrectedSubmissionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeInvalidCandidate(1))
      .then(submitCandidate(1, 32))
      .then(observeExactCandidate(1))
      .expect(and {
        candidateReadyReached,
        state.results.get(1).integrationSession == 1,
        state.results.get(1).submittedCandidate == 32,
        state.results.get(1).correctionCount == 1,
      })
  }

  run correctionExhaustionPreservesWorkAndReleasesTargetTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeInvalidCandidate(1))
      .then(submitCandidate(1, 32))
      .then(observeInvalidCandidate(1))
      .expect(and {
        correctionLimitReached,
        state.results.get(1).submittedCandidate == 32,
        state.results.get(1).integrationSession == 1,
        not(state.results.get(1).targetHeld),
      })
  }

  run automaticContinuationExhaustionPreservesWorkAndReleasesTargetTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(reportWithoutCandidate(1))
      .then(reportWithoutCandidate(1))
      .expect(and {
        continuationLimitReached,
        state.results.get(1).continuationCount == CONTINUATION_LIMIT,
        state.results.get(1).integrationSession == 1,
        not(state.results.get(1).targetHeld),
      })
  }

  run foreignCorrelationStopsBeforeGitAndKeepsSessionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(reportForeignCorrelation(1))
      .expect(and {
        correlationContradictionReached,
        state.results.get(1).phase == CorrelationContradiction,
        state.results.get(1).integrationSession == 1,
        state.results.get(1).submittedCandidate == 0,
        state.results.get(1).observedFirstParent == 0,
        state.results.get(1).observedSecondParent == 0,
        state.results.get(1).targetHeld,
      })
      .then(releaseForeignCorrelationTarget(1))
      .expect(and {
        correlationContradictionReleasedReached,
        state.results.get(1).phase == CorrelationContradictionReleased,
        state.results.get(1).integrationSession == 1,
        not(state.results.get(1).targetHeld),
      })
  }

  run selectedWrapperSealsPassedEvidenceForExactCandidateTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .then(recordVerificationIntent(1))
      .expect(and {
        state.results.get(1).phase == VerificationIntent,
        state.results.get(1).verificationRequest.requestId == 1031,
        state.results.get(1).verificationRequest.plan == VERIFICATION_PLAN + 1,
        state.results.get(1).verificationRequest.candidate == 31,
        state.results.get(1).verificationRequest.acceptedResult == 21,
        state.results.get(1).wrapperInvocationCount == 0,
        state.results.get(1).targetHeld,
      })
      .then(invokeVerification(1))
      .then(reportVerificationPassed(1))
      .expect(and {
        state.results.get(1).phase == VerificationPassedPendingSeal,
        state.results.get(1).verificationOutcome == Passed,
        not(state.results.get(1).verificationEvidenceReread),
        not(state.results.get(1).verificationManifestSealed),
        not(state.results.get(1).promotionAuthorized),
        state.results.get(1).targetHeld,
      })
      .then(rereadAndSealPassedVerification(1))
      .then(offerPromotionPremise(1))
      .expect(and {
        state.results.get(1).phase == PromotionPremise,
        state.results.get(1).verificationOutcome == Passed,
        state.results.get(1).verificationEvidenceReread,
        state.results.get(1).verificationManifestSealed,
        state.results.get(1).promotionAuthorized,
        not(state.results.get(1).targetHeld),
      })
  }

  run lostVerificationResponseReconcilesSameRequestAfterRestartTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .then(recordVerificationIntent(1))
      .then(invokeVerification(1))
      .then(loseVerificationResponse(1))
      .then(recoverCoordinator)
      .expect(and {
        state.results.get(1).phase == VerificationResponseLost,
        not(state.results.get(1).targetHeld),
        state.results.get(1).verificationRequest.requestId == 1031,
        state.results.get(1).wrapperInvocationCount == 1,
        noAutomaticVerificationReplacement,
      })
      .then(observeTrackerFacts)
      .then(observeTargetFacts(1))
      .then(reacquireIntegrationTarget(1))
      .then(reconcileVerification(1))
      .expect(and {
        state.results.get(1).phase == VerificationReconciling,
        state.results.get(1).verificationRequest.requestId == 1031,
        state.results.get(1).verificationRequest.plan == VERIFICATION_PLAN + 1,
        state.results.get(1).wrapperInvocationCount == 1,
        state.results.get(1).reconciliationCount == 1,
        state.results.get(1).targetHeld,
      })
      .then(reconcileVerification(1))
      .expect(and {
        state.results.get(1).phase == VerificationReconciling,
        state.results.get(1).verificationRequest.requestId == 1031,
        state.results.get(1).wrapperInvocationCount == 1,
        state.results.get(1).reconciliationCount == 2,
        state.results.get(1).targetHeld,
      })
      .then(reportVerificationPassed(1))
      .then(rereadAndSealPassedVerification(1))
      .expect(and {
        state.results.get(1).phase == VerificationPassed,
        state.results.get(1).verificationRequest.requestId == 1031,
        state.results.get(1).wrapperInvocationCount == 1,
        state.results.get(1).reconciliationCount == 2,
        state.results.get(1).promotionAuthorized,
        not(state.results.get(1).targetHeld),
      })
  }

  run failedVerificationStopsBeforePromotionAndBlocksLaterQueueTest = {
    init
      .then(acceptResult(1))
      .then(acceptResult(2))
      .then(queueAcceptedResult(1))
      .then(queueAcceptedResult(2))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .then(recordVerificationIntent(1))
      .then(invokeVerification(1))
      .then(reportVerificationFailed(1))
      .expect(and {
        state.results.get(1).phase == VerificationFailed,
        state.results.get(1).verificationOutcome == Failed,
        state.results.get(1).verificationEvidenceReread,
        state.results.get(1).verificationManifestSealed,
        not(state.results.get(1).promotionAuthorized),
        not(state.results.get(1).targetHeld),
        state.results.get(2).phase == Queued,
        not(canStart(state, 2)),
        logicalIntegrationResponsibilityBlocksLaterQueue,
      })
  }

  run killedVerificationSealsDiagnosticsWithoutPromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .then(recordVerificationIntent(1))
      .then(invokeVerification(1))
      .then(reportVerificationKilled(1))
      .expect(and {
        state.results.get(1).phase == VerificationKilled,
        state.results.get(1).verificationOutcome == Killed,
        state.results.get(1).verificationEvidenceReread,
        state.results.get(1).verificationManifestSealed,
        not(state.results.get(1).promotionAuthorized),
        not(state.results.get(1).targetHeld),
      })
  }

  run timedOutVerificationSealsDiagnosticsWithoutPromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .then(recordVerificationIntent(1))
      .then(invokeVerification(1))
      .then(reportVerificationTimedOut(1))
      .expect(and {
        state.results.get(1).phase == VerificationTimedOut,
        state.results.get(1).verificationOutcome == TimedOut,
        state.results.get(1).verificationEvidenceReread,
        state.results.get(1).verificationManifestSealed,
        not(state.results.get(1).promotionAuthorized),
        not(state.results.get(1).targetHeld),
      })
  }

  run partialVerificationSealsDiagnosticsWithoutPromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .then(recordVerificationIntent(1))
      .then(invokeVerification(1))
      .then(reportVerificationPartial(1))
      .expect(and {
        state.results.get(1).phase == VerificationPartial,
        state.results.get(1).verificationOutcome == Partial,
        state.results.get(1).verificationEvidenceReread,
        state.results.get(1).verificationManifestSealed,
        not(state.results.get(1).promotionAuthorized),
        not(state.results.get(1).targetHeld),
      })
  }

  run foreignVerificationCorrelationFailsClosedTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .then(recordVerificationIntent(1))
      .then(invokeVerification(1))
      .then(reportVerificationCorrelationContradiction(1))
      .expect(and {
        state.results.get(1).phase == VerificationCorrelationContradiction,
        state.results.get(1).verificationRequest.requestId == 1031,
        state.results.get(1).verificationOutcome == NoVerificationOutcome,
        not(state.results.get(1).verificationEvidenceReread),
        not(state.results.get(1).verificationManifestSealed),
        not(state.results.get(1).promotionAuthorized),
        not(state.results.get(1).targetHeld),
        noAutomaticVerificationReplacement,
      })
  }

  run incompleteVerificationEvidenceFailsClosedTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .then(recordVerificationIntent(1))
      .then(invokeVerification(1))
      .then(reportVerificationEvidenceFailure(1))
      .expect(and {
        state.results.get(1).phase == VerificationEvidenceFailure,
        state.results.get(1).verificationRequest.requestId == 1031,
        state.results.get(1).verificationOutcome == NoVerificationOutcome,
        not(state.results.get(1).verificationEvidenceReread),
        not(state.results.get(1).verificationManifestSealed),
        not(state.results.get(1).promotionAuthorized),
        not(state.results.get(1).targetHeld),
        noAutomaticVerificationReplacement,
      })
  }

  run releasedCorrectionLimitStillBlocksLaterSameTargetQueueTest = {
    init
      .then(acceptResult(1))
      .then(acceptResult(2))
      .then(queueAcceptedResult(1))
      .then(queueAcceptedResult(2))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeInvalidCandidate(1))
      .then(submitCandidate(1, 32))
      .then(observeInvalidCandidate(1))
      .expect(and {
        state.results.get(1).phase == CorrectionLimitReached,
        not(state.results.get(1).targetHeld),
        state.results.get(2).phase == Queued,
        not(canStart(state, 2)),
        logicalIntegrationResponsibilityBlocksLaterQueue,
      })
  }

  run releasedContinuationLimitStillBlocksLaterSameTargetQueueTest = {
    init
      .then(acceptResult(1))
      .then(acceptResult(2))
      .then(queueAcceptedResult(1))
      .then(queueAcceptedResult(2))
      .then(startIntegration(1))
      .then(reportWithoutCandidate(1))
      .then(reportWithoutCandidate(1))
      .expect(and {
        state.results.get(1).phase == ContinuationLimitReached,
        not(state.results.get(1).targetHeld),
        state.results.get(2).phase == Queued,
        not(canStart(state, 2)),
        logicalIntegrationResponsibilityBlocksLaterQueue,
      })
  }

  run releasedCorrelationContradictionStillBlocksLaterSameTargetQueueTest = {
    init
      .then(acceptResult(1))
      .then(acceptResult(2))
      .then(queueAcceptedResult(1))
      .then(queueAcceptedResult(2))
      .then(startIntegration(1))
      .then(reportForeignCorrelation(1))
      .then(releaseForeignCorrelationTarget(1))
      .expect(and {
        state.results.get(1).phase == CorrelationContradictionReleased,
        not(state.results.get(1).targetHeld),
        state.results.get(2).phase == Queued,
        not(canStart(state, 2)),
        logicalIntegrationResponsibilityBlocksLaterQueue,
      })
  }

  run sealedVerificationStillBlocksLaterSameTargetQueueTest = {
    init
      .then(acceptResult(1))
      .then(acceptResult(2))
      .then(queueAcceptedResult(1))
      .then(queueAcceptedResult(2))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .then(recordVerificationIntent(1))
      .then(invokeVerification(1))
      .then(reportVerificationPassed(1))
      .expect(and {
        state.results.get(1).phase == VerificationPassedPendingSeal,
        state.results.get(1).targetHeld,
        not(canStart(state, 2)),
        logicalIntegrationResponsibilityBlocksLaterQueue,
      })
      .then(rereadAndSealPassedVerification(1))
      .expect(and {
        state.results.get(1).phase == VerificationPassed,
        not(state.results.get(1).targetHeld),
        state.results.get(2).phase == Queued,
        not(canStart(state, 2)),
        logicalIntegrationResponsibilityBlocksLaterQueue,
      })
      .then(offerPromotionPremise(1))
      .expect(and {
        state.results.get(1).phase == PromotionPremise,
        not(state.results.get(1).targetHeld),
        state.results.get(2).phase == Queued,
        not(canStart(state, 2)),
        logicalIntegrationResponsibilityBlocksLaterQueue,
      })
  }
}
