// Negative controls for #59: each action performs one forbidden shortcut that
// the accepted-result verification invariants must reject.
module acceptedResultIntegrationNegativeTest {
  import acceptedResultIntegration.* from "./acceptedResultIntegration"

  action authorizePromotionWithoutSealedEvidence: bool = {
    val result = state.results.get(1)
    all {
      result.phase == VerificationPassedPendingSeal,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: PromotionPremise,
          promotionAuthorized: true,
        }),
      },
    }
  }

  action startLaterQueueAfterNonPass: bool = {
    val result = state.results.get(2)
    all {
      state.results.get(1).phase == VerificationFailed,
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

  action allocateAutomaticReplacement: bool = {
    val result = state.results.get(1)
    all {
      result.phase == VerificationFailed,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          verificationReplacementCount: result.verificationReplacementCount + 1,
        }),
      },
    }
  }

  // Forbidden control: once three compare-and-set requests have been used,
  // this attempts to mint a fourth durable request. The bounded-attempt
  // invariant must catch the mutation even though the action is syntactically
  // well formed.
  action sendFourthPromotionAttempt: bool = {
    val result = state.results.get(1)
    all {
      result.phase == PromotionExhausted,
      result.promotionAttemptCount == PROMOTION_ATTEMPT_LIMIT,
      not(result.targetHeld),
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: PromotionInFlight,
          targetHeld: true,
          promotionAttemptCount: PROMOTION_ATTEMPT_LIMIT + 1,
          promotionLastAttempt: PROMOTION_ATTEMPT_LIMIT + 1,
          promotionExpectedHeadVerified: true,
          promotionCompareAndSetRequested: true,
        }),
      },
    }
  }

  run unsealedPassCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .then(recordVerificationIntent(1))
      .then(invokeVerification(1))
      .then(reportVerificationPassed(1))
      .then(authorizePromotionWithoutSealedEvidence)
      .expect(not(onlySealedPassedAuthorizesPromotion))
  }

  run nonPassCannotAdvanceLaterSameTargetQueueTest = {
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
      .then(startLaterQueueAfterNonPass)
      .expect(not(logicalIntegrationResponsibilityBlocksLaterQueue))
  }

  run staleTargetCannotAuthorizeVerificationReacquisitionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .then(recoverCoordinator)
      .then(reacquireWithoutFreshTargetHead)
      .expect(not(reacquiredVerificationUsesFreshExpectedHead))
  }

  run completedNonPassCannotAllocateReplacementRequestTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .then(recordVerificationIntent(1))
      .then(invokeVerification(1))
      .then(reportVerificationFailed(1))
      .then(allocateAutomaticReplacement)
      .expect(not(noAutomaticVerificationReplacement))
  }

  run promotionPremiseCannotAdvanceLaterSameTargetQueueTest = {
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
      .then(rereadAndSealPassedVerification(1))
      .then(offerPromotionPremise(1))
      .then(startLaterQueueAfterPromotionPremise)
      .expect(not(logicalIntegrationResponsibilityBlocksLaterQueue))
  }

  run fourthPromotionAttemptViolatesBoundTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .then(recordVerificationIntent(1))
      .then(invokeVerification(1))
      .then(reportVerificationPassed(1))
      .then(rereadAndSealPassedVerification(1))
      .then(offerPromotionPremise(1))
      .then(recordPromotionIntent(1))
      .then(observePromotionExactExpectedHead(1))
      .then(recordPromotionAttemptIntent(1))
      .then(sendPromotionAttempt(1))
      .then(losePromotionResponse(1))
      .then(reconcilePromotion(1))
      .then(observePromotionExactExpectedHead(1))
      .then(recordPromotionAttemptIntent(1))
      .then(sendPromotionAttempt(1))
      .then(losePromotionResponse(1))
      .then(reconcilePromotion(1))
      .then(observePromotionExactExpectedHead(1))
      .then(recordPromotionAttemptIntent(1))
      .then(sendPromotionAttempt(1))
      .then(losePromotionResponse(1))
      .then(reconcilePromotion(1))
      .then(observePromotionExactExpectedHead(1))
      .then(sendFourthPromotionAttempt)
      .expect(not(promotionAttemptsAreBounded))
  }
}
