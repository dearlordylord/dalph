// Negative controls for issue #56 admission and issue #222's outer
// Integrator/Git boundary. Each mutation is deliberately reachable, then
// violates one invariant that must reject the shortcut.
module acceptedResultIntegrationNegativeTest {
  import acceptedResultIntegration.* from "./acceptedResultIntegration"

  action queueLateAcceptedAfterRestart: bool = {
    val result = state.results.get(1)
    all {
      result.phase == LateAcceptedEvidence,
      result.restartChoiceCommittedBeforeTerminal,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: Queued,
          integrationResponsibilityRecorded: true,
          integrationResponsibilityCount: 1,
          queuePosition: state.nextJournalPosition,
          preIntegrationCancellation: true,
        }),
        nextJournalPosition: state.nextJournalPosition + 1,
      },
    }
  }

  action discardOrdinaryAcceptedResponsibility: bool = {
    val result = state.results.get(1)
    all {
      result.phase == Queued,
      result.integrationResponsibilityRecorded,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          integrationResponsibilityRecorded: false,
          integrationResponsibilityCount: 0,
        }),
      },
    }
  }

  action discardLateAcceptedEvidence: bool = {
    val result = state.results.get(1)
    all {
      result.phase == LateAcceptedEvidence,
      state' = {
        ...state,
        results: state.results.put(1, { ...result, acceptedEvidencePreserved: false }),
      },
    }
  }

  // A resource locator cannot remain "the same resource" while its binding
  // silently substitutes another accepted-result commit.
  action substituteIntegratorResourceCommit: bool = {
    val result = state.results.get(1)
    all {
      result.phase == IntegratorSessionFixed,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          resourceBoundCommit: result.acceptedResultCommit + 1,
        }),
      },
    }
  }

  // A queue successor is forbidden while an earlier same-target responsibility
  // is still logically unfinished, including a rejected candidate.
  action startLaterQueueAfterRejectedCandidate: bool = {
    val result = state.results.get(2)
    all {
      state.results.get(1).phase == CandidateRejected,
      result.phase == Queued,
      state' = {
        ...state,
        results: state.results.put(2, {
          ...result,
          phase: Started,
          targetHeld: true,
          integrationSession: 2,
          expectedTargetHead: 12,
        }),
      },
    }
  }

  action startLaterQueueAfterPromotionPremise: bool = {
    val result = state.results.get(2)
    all {
      state.results.get(1).phase == PromotionPremise,
      result.phase == Queued,
      state' = {
        ...state,
        results: state.results.put(2, {
          ...result,
          phase: Started,
          targetHeld: true,
          integrationSession: 2,
          expectedTargetHead: 12,
        }),
      },
    }
  }

  // Forbidden shortcut: make a promotion-bound lease appear without the
  // fresh Git facts required after recovery.
  action reacquireWithoutFreshTargetHead: bool = {
    val result = state.results.get(1)
    all {
      result.phase == CandidateReady,
      state.targetReacquisitionRequired,
      not(state.targetFactsCurrent),
      not(result.targetHeld),
      state' = {
        ...state,
        results: state.results.put(1, { ...result, targetHeld: true }),
      },
    }
  }

  // Each of these four actions makes the same invalid promotion claim from a
  // different non-authoritative source. Git qualification must reject all of
  // them: an explicit report plus exact [H,C] parents is still required.
  action promoteUnreportedCandidate: bool = {
    val result = state.results.get(1)
    all {
      result.phase == IntegratorInFlight,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: PreparedCandidate,
          integratorResultRecorded: true,
          candidateReported: false,
          submittedCandidate: 31,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateExactParents,
          candidateQualificationProven: true,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  // These source-only shortcuts begin directly at IntegratorInFlight. They
  // deliberately carry no durable Integrator result and no explicit M report;
  // process success, resource HEAD, legacy evidence, and equal content cannot
  // manufacture the promotion premise.
  action promoteFromProcessSuccessWithoutIntegratorResult: bool = {
    val result = state.results.get(1)
    all {
      result.phase == IntegratorInFlight,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: NoIntegratorOutcome,
          integratorResultRecorded: false,
          candidateReported: false,
          submittedCandidate: 31,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateExactParents,
          candidateQualificationProven: true,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          processSuccessObserved: true,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  action promoteFromResourceHeadWithoutIntegratorResult: bool = {
    val result = state.results.get(1)
    all {
      result.phase == IntegratorInFlight,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: NoIntegratorOutcome,
          integratorResultRecorded: false,
          candidateReported: false,
          submittedCandidate: 77,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateExactParents,
          candidateQualificationProven: true,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          resourceHeadCandidate: 77,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  action promoteFromLegacyVerificationWithoutIntegratorResult: bool = {
    val result = state.results.get(1)
    all {
      result.phase == IntegratorInFlight,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: NoIntegratorOutcome,
          integratorResultRecorded: false,
          candidateReported: false,
          submittedCandidate: 31,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateExactParents,
          candidateQualificationProven: true,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          legacyVerificationEvidence: true,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  action promoteEquivalentContentWithoutIntegratorResult: bool = {
    val result = state.results.get(1)
    all {
      result.phase == IntegratorInFlight,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: NoIntegratorOutcome,
          integratorResultRecorded: false,
          candidateReported: false,
          submittedCandidate: 88,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateExactParents,
          candidateQualificationProven: true,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          promotionEquivalentContentAccepted: true,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  action promoteFromResourceHead: bool = {
    val result = state.results.get(1)
    all {
      result.phase == CandidateGitReadPending,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: PreparedCandidate,
          integratorResultRecorded: true,
          candidateReported: true,
          submittedCandidate: 77,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateExactParents,
          candidateQualificationProven: true,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          resourceHeadCandidate: 77,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  action promoteFromProcessSuccess: bool = {
    val result = state.results.get(1)
    all {
      result.phase == CandidateGitReadPending,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: PreparedCandidate,
          integratorResultRecorded: true,
          candidateReported: true,
          submittedCandidate: 31,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateExactParents,
          candidateQualificationProven: true,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          processSuccessObserved: true,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  action promoteFromLegacyVerification: bool = {
    val result = state.results.get(1)
    all {
      result.phase == CandidateGitReadPending,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: PreparedCandidate,
          integratorResultRecorded: true,
          candidateReported: true,
          submittedCandidate: 31,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateExactParents,
          candidateQualificationProven: true,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          legacyVerificationEvidence: true,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  action promoteWithWrongParents: bool = {
    val result = state.results.get(1)
    all {
      result.phase == CandidateGitReadPending,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: PreparedCandidate,
          integratorResultRecorded: true,
          candidateReported: true,
          submittedCandidate: 31,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateWrongParents,
          candidateQualificationProven: true,
          observedFirstParent: 99,
          observedSecondParent: 98,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  // A crashed session cannot allocate S2 or count a resume as an invocation.
  action allocateSuccessorAfterIntegratorCrash: bool = {
    val result = state.results.get(1)
    all {
      result.phase == IntegratorResponseLost,
      result.integrationSession == 1,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: IntegratorInFlight,
          integrationSession: 99,
          integratorInvocationCount: 2,
          targetHeld: true,
        }),
      },
    }
  }

  action mintFourthPromotionAttempt: bool = {
    val result = state.results.get(1)
    all {
      result.phase == PromotionRetryReady,
      result.promotionAttemptCount > 0,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: PromotionInFlight,
          targetHeld: true,
          promotionAttemptCount: PROMOTION_ATTEMPT_LIMIT + 1,
          promotionLastAttempt: PROMOTION_ATTEMPT_LIMIT + 1,
          promotionCompareAndSetRequested: true,
        }),
      },
    }
  }

  run lateAcceptedAfterRestartCannotBeQueuedForIntegrationTest = {
    init
      .then(observeAppliedRestartBeforeAccepted(1))
      .then(acceptResult(1))
      .then(queueLateAcceptedAfterRestart)
      .expect(and {
        not(ordinaryAcceptedAdmissionRecordsOneResponsibility),
        not(lateAcceptedAfterRestartNeverCreatesIntegrationResponsibility),
      })
  }

  run ordinaryAcceptedCannotLoseItsOneResponsibilityTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(discardOrdinaryAcceptedResponsibility)
      .expect(not(ordinaryAcceptedAdmissionRecordsOneResponsibility))
  }

  run lateAcceptedEvidenceCannotBeDiscardedTest = {
    init
      .then(observeAppliedRestartBeforeAccepted(1))
      .then(acceptResult(1))
      .then(discardLateAcceptedEvidence)
      .expect(not(acceptedEvidenceIsNeverDiscarded))
  }

  run rejectedCandidateCannotAdvanceLaterSameTargetQueueTest = {
    init
      .then(acceptResult(1))
      .then(acceptResult(2))
      .then(queueAcceptedResult(1))
      .then(queueAcceptedResult(2))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(observeMissingCandidate(1))
      .then(startLaterQueueAfterRejectedCandidate)
      .expect(not(logicalIntegrationResponsibilityBlocksLaterQueue))
  }

  run staleTargetCannotAuthorizePromotionReacquisitionTest = {
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
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(reacquireWithoutFreshTargetHead)
      .expect(not(mutableTargetWorkReacquisitionUsesFreshExpectedHead))
  }

  run unreportedCandidateCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(promoteUnreportedCandidate)
      .expect(not(candidateReportIsExplicit))
  }

  run processSuccessWithoutIntegratorResultCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(promoteFromProcessSuccessWithoutIntegratorResult)
      .expect(and {
        not(candidateReportIsExplicit),
        not(candidateQualificationRequiresExactParents),
        not(noForbiddenEvidenceAuthorizesPromotion),
      })
  }

  run resourceHeadWithoutIntegratorResultCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(promoteFromResourceHeadWithoutIntegratorResult)
      .expect(and {
        not(candidateReportIsExplicit),
        not(candidateQualificationRequiresExactParents),
        not(noForbiddenEvidenceAuthorizesPromotion),
      })
  }

  run legacyVerificationWithoutIntegratorResultCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(promoteFromLegacyVerificationWithoutIntegratorResult)
      .expect(and {
        not(candidateReportIsExplicit),
        not(candidateQualificationRequiresExactParents),
        not(noForbiddenEvidenceAuthorizesPromotion),
      })
  }

  run equivalentContentWithoutIntegratorResultCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(promoteEquivalentContentWithoutIntegratorResult)
      .expect(and {
        not(candidateReportIsExplicit),
        not(candidateQualificationRequiresExactParents),
        not(noForbiddenEvidenceAuthorizesPromotion),
        not(promotionNoForceOrEquivalentShortcut),
      })
  }

  run resourceHeadCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(promoteFromResourceHead)
      .expect(not(noForbiddenEvidenceAuthorizesPromotion))
  }

  run processSuccessCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(promoteFromProcessSuccess)
      .expect(not(noForbiddenEvidenceAuthorizesPromotion))
  }

  run legacyVerificationCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(promoteFromLegacyVerification)
      .expect(not(noForbiddenEvidenceAuthorizesPromotion))
  }

  run wrongParentCandidateCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(promoteWithWrongParents)
      .expect(not(candidateQualificationRequiresExactParents))
  }

  run crashedIntegratorCannotAllocateSuccessorTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(loseIntegratorResponse(1))
      .then(allocateSuccessorAfterIntegratorCrash)
      .expect(and {
        not(noAutomaticIntegratorSuccessor),
        not(sessionIdentityFixedAfterStart),
      })
  }

  run integratorResourceCannotSubstituteCommitTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(substituteIntegratorResourceCommit)
      .expect(not(integratorResourceIsExactlyBound))
  }

  run promotionPremiseCannotAdvanceLaterSameTargetQueueTest = {
    init
      .then(acceptResult(1))
      .then(acceptResult(2))
      .then(queueAcceptedResult(1))
      .then(queueAcceptedResult(2))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(observeExactCandidate(1))
      .then(offerPromotionPremise(1))
      .then(startLaterQueueAfterPromotionPremise)
      .expect(not(logicalIntegrationResponsibilityBlocksLaterQueue))
  }

  run fourthPromotionAttemptViolatesBoundTest = {
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
      .then(mintFourthPromotionAttempt)
      .expect(not(promotionAttemptsAreBounded))
  }
}
