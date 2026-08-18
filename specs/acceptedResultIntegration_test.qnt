module acceptedResultIntegrationTest {
  import acceptedResultIntegration.* from "./acceptedResultIntegration"

  // The ordinary accepted result is journaled once, keeps its queue position,
  // and starts only after recovery rereads tracker and Git target facts.
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
        state.results.get(1).integrationResponsibilityCount == 1,
      })
  }

  run lateAcceptedAfterRestartRemainsEvidenceOnlyTest = {
    init
      .then(observeAppliedRestartBeforeAccepted(1))
      .then(acceptResult(1))
      .then(recoverCoordinator)
      .expect(and {
        state.results.get(1).phase == LateAcceptedEvidence,
        state.results.get(1).acceptedEvidencePreserved,
        not(state.results.get(1).integrationResponsibilityRecorded),
        state.results.get(1).integrationResponsibilityCount == 0,
        lateAcceptedAfterRestartNeverCreatesIntegrationResponsibility,
      })
  }

  run ordinaryAcceptedConsumesCancellationAndStartsOneResponsibilityTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .expect(and {
        state.results.get(1).phase == Queued,
        state.results.get(1).integrationResponsibilityRecorded,
        state.results.get(1).integrationResponsibilityCount == 1,
        state.results.get(1).preIntegrationCancellation,
        ordinaryAcceptedAdmissionRecordsOneResponsibility,
        acceptedEvidenceIsNeverDiscarded,
      })
      .then(startIntegration(1))
      .expect(and {
        state.results.get(1).phase == Started,
        not(state.results.get(1).preIntegrationCancellation),
        state.results.get(1).targetHeld,
        cancellationExactlyQueued,
      })
  }

  // A changed planned target head is a stop before S exists. It cannot be
  // converted into an ordinary fresh Integrator session.
  run changedTargetHeadStopsBeforeNewSessionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(observeChangedTargetHead(1))
      .expect(and {
        state.results.get(1).phase == Queued,
        not(canStart(state, 1)),
        state.results.get(1).integrationSession == 0,
        state.results.get(1).integratorInvocationCount == 0,
        noAutomaticIntegratorSuccessor,
      })
  }

  run incompatibleTargetLineageStopsBeforeIntegratorTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(observeIncompatibleTargetLineage(1))
      .expect(and {
        state.results.get(1).phase == Queued,
        not(state.results.get(1).lineageCompatible),
        not(canStart(state, 1)),
        state.results.get(1).integrationSession == 0,
        state.results.get(1).integratorInvocationCount == 0,
      })
  }

  run changedHeadAfterSessionCannotStartSuccessorTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(observeChangedTargetHead(1))
      .expect(and {
        state.results.get(1).phase == IntegratorSessionFixed,
        state.results.get(1).integrationSession == 1,
        state.results.get(1).expectedTargetHead == state.results.get(1).plannedTargetHead,
        state.targetHeadProof != state.results.get(1).expectedTargetHead,
        noAutomaticIntegratorSuccessor,
      })
  }

  // The accepted result gets exactly one fixed outer session. The private
  // Integrator stages are not represented as separate Dalph phases.
  run outerIntegratorReportsOneExplicitCandidateTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .expect(and {
        state.results.get(1).phase == IntegratorSessionFixed,
        state.results.get(1).sessionFixed,
        state.results.get(1).candidateResource == 101,
        integratorResourceIsExactlyBound,
      })
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .expect(and {
        state.results.get(1).phase == IntegratorResultRecorded,
        state.results.get(1).integrationSession == 1,
        state.results.get(1).integratorInvocationCount == 1,
        state.results.get(1).integratorResultRecorded,
        state.results.get(1).candidateReported,
        state.results.get(1).submittedCandidate == 31,
        state.results.get(1).acceptedResultEvidence != 0,
        state.results.get(1).integratorReturnedEvidenceRefs == Set(),
        integratorResultCarriesOnlyAcceptedEvidence,
        not(state.results.get(1).candidateGitReadIntentRecorded),
        integratorSessionIsFixedBeforeResult,
        integratorCallResultIsPersistent,
        candidateReportIsExplicit,
      })
  }

  run outerIntegratorNotPreparedIsConclusiveTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorNotPrepared(1))
      .expect(and {
        state.results.get(1).phase == IntegratorNotPrepared,
        state.results.get(1).integratorOutcome == NotPrepared,
        state.results.get(1).integratorResultRecorded,
        state.results.get(1).submittedCandidate == 0,
        not(state.results.get(1).targetHeld),
        not(state.results.get(1).promotionAuthorized),
        conclusiveNotPreparedHasNoCandidate,
      })
  }

  // Process loss after the call restores the same S. Resume is not a new
  // Integrator invocation and cannot manufacture a successor S.
  run unfinishedIntegratorRestoresSameSessionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(loseIntegratorResponse(1))
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(reacquireIntegrationTarget(1))
      .then(resumeIntegrator(1))
      .expect(and {
        state.results.get(1).phase == IntegratorInFlight,
        state.results.get(1).integrationSession == 1,
        state.results.get(1).integratorInvocationCount == 1,
        state.results.get(1).integratorResumeCount == 1,
        state.results.get(1).targetHeld,
        integratorResourceIsExactlyBound,
        integratorRecoveryReusesSameSession,
        noAutomaticIntegratorSuccessor,
      })
  }

  // Acquiring the process-local target position for S does not reread or
  // substitute current Git target facts; S remains bound to its durable H.
  run unfinishedIntegratorReacquiresWithoutTargetRereadTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(loseIntegratorResponse(1))
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(reacquireIntegrationTarget(1))
      .expect(and {
        state.results.get(1).phase == IntegratorResponseLost,
        state.results.get(1).targetHeld,
        not(state.targetFactsCurrent),
        state.targetHeadProof == 0,
        targetHeldOnlyForActiveIntegration,
      })
  }

  // A durable Integrator result survives restart before Git qualification;
  // only the Git read is resumed.
  run reportedCandidateRestoresWithoutIntegratorRerunTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(observeTargetFacts(1))
      .then(reacquireIntegrationTarget(1))
      .then(recordCandidateGitReadIntent(1))
      .expect(and {
        state.results.get(1).phase == CandidateGitReadIntent,
        state.results.get(1).submittedCandidate == 31,
        state.results.get(1).integratorInvocationCount == 1,
        state.results.get(1).candidateGitReadIntentRecorded,
        state.results.get(1).integratorResultRecorded,
      })
  }

  run exactGitParentsQualifyReportedCandidateTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(observeExactCandidate(1))
      .expect(and {
        state.results.get(1).phase == CandidateReady,
        state.results.get(1).candidateGitObservation == CandidateExactParents,
        state.results.get(1).observedFirstParent == state.results.get(1).expectedTargetHead,
        state.results.get(1).observedSecondParent == state.results.get(1).acceptedResultCommit,
        state.results.get(1).candidateQualificationProven,
        state.results.get(1).promotionAuthorized,
        not(state.results.get(1).targetHeld),
        candidateGitIntentPrecedesObservation,
        candidateQualificationRequiresExactParents,
        candidateReportIsExplicit,
        invalidCandidateNeverAuthorizesPromotion,
      })
  }

  run missingCandidateIsRejectedWithoutPromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(observeMissingCandidate(1))
      .expect(and {
        state.results.get(1).phase == CandidateRejected,
        state.results.get(1).candidateGitObservation == CandidateMissing,
        not(state.results.get(1).candidateQualificationProven),
        not(state.results.get(1).promotionAuthorized),
        invalidCandidateNeverAuthorizesPromotion,
      })
  }

  run nonCommitCandidateIsRejectedWithoutPromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(observeNonCommitCandidate(1))
      .expect(and {
        state.results.get(1).phase == CandidateRejected,
        state.results.get(1).candidateGitObservation == CandidateNonCommit,
        not(state.results.get(1).promotionAuthorized),
        invalidCandidateNeverAuthorizesPromotion,
      })
  }

  run wrongParentCandidateIsRejectedWithoutPromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(observeWrongParentCandidate(1))
      .expect(and {
        state.results.get(1).phase == CandidateRejected,
        state.results.get(1).candidateGitObservation == CandidateWrongParents,
        state.results.get(1).observedFirstParent != state.results.get(1).expectedTargetHead,
        state.results.get(1).observedSecondParent != state.results.get(1).acceptedResultCommit,
        not(state.results.get(1).candidateQualificationProven),
        not(state.results.get(1).promotionAuthorized),
        invalidCandidateNeverAuthorizesPromotion,
      })
  }

  run ambiguousCandidateGitReadReconcilesSameCandidateTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(loseCandidateGitResponse(1))
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(reacquireIntegrationTarget(1))
      .then(readCandidateGit(1))
      .then(observeExactCandidate(1))
      .expect(and {
        state.results.get(1).phase == CandidateReady,
        state.results.get(1).submittedCandidate == 31,
        state.results.get(1).candidateGitReadCount == 2,
        state.results.get(1).candidateGitObservation == CandidateExactParents,
        state.results.get(1).integratorInvocationCount == 1,
        not(state.targetFactsCurrent),
        candidateQualificationRequiresExactParents,
      })
  }

  // Promotion starts from the candidate Git proof itself. No Dalph
  // verification manifest or process/resource shortcut is present.
  run exactCandidatePromotesWithDirectCompareAndSetTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(observeExactCandidate(1))
      .then(offerPromotionPremise(1))
      .then(recordPromotionIntent(1))
      .then(observePromotionExactExpectedHead(1))
      .then(recordPromotionAttemptIntent(1))
      .then(sendPromotionAttempt(1))
      .then(observePromotionCandidateCurrent(1))
      .expect(and {
        state.results.get(1).phase == PromotionSucceeded,
        state.results.get(1).promotionResultRecorded,
        state.results.get(1).promotionGitObservation == PromotionCandidateCurrent,
        state.results.get(1).promotionCandidateAncestryProven,
        state.results.get(1).promotionAttemptCount == 1,
        state.results.get(1).submittedCandidate == 31,
        promotionUsesExactIntegratorCandidate,
        promotionSuccessRequiresExactAncestry,
        promotionNoForceOrEquivalentShortcut,
      })
  }

  run changedHeadMakesPromotionStaleAndPreservesCandidateTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(observeExactCandidate(1))
      .then(offerPromotionPremise(1))
      .then(recordPromotionIntent(1))
      .then(observePromotionOtherHead(1))
      .expect(and {
        state.results.get(1).phase == PromotionStale,
        state.results.get(1).promotionResultRecorded,
        state.results.get(1).promotionGitObservation == PromotionOtherHead,
        state.results.get(1).submittedCandidate == 31,
        not(state.results.get(1).promotionCandidateAncestryProven),
        stalePromotionPreservesCandidateAndNeverOverwrites,
      })
  }

  run ambiguousPromotionRequiresFreshGitBeforeRetryTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(observeExactCandidate(1))
      .then(offerPromotionPremise(1))
      .then(recordPromotionIntent(1))
      .then(observePromotionExactExpectedHead(1))
      .then(recordPromotionAttemptIntent(1))
      .then(sendPromotionAttempt(1))
      .then(losePromotionResponse(1))
      .expect(and {
        state.results.get(1).phase == PromotionResponseLost,
        state.results.get(1).promotionAttemptCount == 1,
        not(state.results.get(1).promotionResultRecorded),
      })
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(observeTargetFacts(1))
      .then(reconcilePromotion(1))
      .then(observePromotionExactExpectedHead(1))
      .expect(and {
        state.results.get(1).phase == PromotionRetryReady,
        state.results.get(1).promotionAttemptCount == 1,
        state.results.get(1).promotionFreshExactHeadReads == 2,
        ambiguousPromotionRequiresFreshObservation,
      })
  }

  run unreadablePromotionReadRemainsPendingUntilFreshFactsTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(observeExactCandidate(1))
      .then(offerPromotionPremise(1))
      .then(recordPromotionIntent(1))
      .then(observePromotionGitUnreadable(1))
      .expect(and {
        state.results.get(1).phase == PromotionReadPending,
        not(state.results.get(1).promotionResultRecorded),
        unreadablePromotionStaysPending,
      })
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(observeTargetFacts(1))
      .then(reconcilePromotion(1))
      .then(observePromotionExactExpectedHead(1))
      .expect(and {
        state.results.get(1).phase == PromotionRetryReady,
        state.results.get(1).promotionFreshExactHeadObservation,
        promotionFreshObservationIsExactExpectedHead,
      })
  }

  run promotionExhaustionPreservesQualifiedCandidateTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(observeExactCandidate(1))
      .then(offerPromotionPremise(1))
      .then(recordPromotionIntent(1))
      .then(observePromotionExactExpectedHead(1))
      .then(recordPromotionAttemptIntent(1))
      .then(sendPromotionAttempt(1))
      .then(losePromotionResponse(1))
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(observeTargetFacts(1))
      .then(reconcilePromotion(1))
      .then(observePromotionExactExpectedHead(1))
      .then(recordPromotionAttemptIntent(1))
      .then(sendPromotionAttempt(1))
      .then(losePromotionResponse(1))
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(observeTargetFacts(1))
      .then(reconcilePromotion(1))
      .then(observePromotionExactExpectedHead(1))
      .then(recordPromotionAttemptIntent(1))
      .then(sendPromotionAttempt(1))
      .then(losePromotionResponse(1))
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(observeTargetFacts(1))
      .then(reconcilePromotion(1))
      .then(observePromotionExactExpectedHead(1))
      .expect(and {
        state.results.get(1).phase == PromotionExhausted,
        state.results.get(1).promotionAttemptCount == PROMOTION_ATTEMPT_LIMIT,
        state.results.get(1).submittedCandidate == 31,
        not(state.results.get(1).targetHeld),
        promotionExhaustionPreservesCandidate,
        promotionTerminalReleasesTarget,
      })
  }

  run unrelatedResultKeepsIndependentAdmissionFactsTest = {
    init
      .then(acceptResult(1))
      .then(acceptResult(2))
      .then(assignResultTwoIndependentTarget)
      .then(queueAcceptedResult(1))
      .then(queueAcceptedResult(2))
      .expect(and {
        state.results.get(1).integrationTarget == 1,
        state.results.get(2).integrationTarget == 2,
        queuePositionsAreUnique,
        acceptedEvidenceIsNeverDiscarded,
      })
  }
}
