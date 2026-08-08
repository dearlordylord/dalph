module integrationFinalityTest {
  import integrationFinality.* from "./integrationFinality"

  run completionClaimUsesTheExactPromotionProofTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .expect(
        state.promoted.completionClaimDerived
          and exactProofAndBinding
          and completionClaimRequiresExactPromotionProof
          and state.promoted.replacementIntentRecorded
          and state.promoted.replacementRequests == 0
      )
  }

  run lostReplacementResponseReadsBeforeRetryTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(loseCompletionClaimReplacementResponse)
      .then(reconcileReplacementAsOriginalClaim)
      .then(retryCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .expect(
        state.promoted.phase == CompletionClaimCurrent
          and state.promoted.replacementRequests == 2
          and state.promoted.replacementReads == 1
          and replacementRereadPrecedesRetry
          and completionClaimRequestsAreBounded
          and currentCompletionClaimIsExact
      )
  }

  run replacementRequestsStopAtThreeWithoutAFourthRequestTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(loseCompletionClaimReplacementResponse)
      .then(reconcileReplacementAsOriginalClaim)
      .then(retryCompletionClaimReplacement)
      .then(loseCompletionClaimReplacementResponse)
      .then(reconcileReplacementAsOriginalClaim)
      .then(retryCompletionClaimReplacement)
      .then(loseCompletionClaimReplacementResponse)
      .then(reconcileReplacementAsOriginalClaim)
      .expect(
        replacementExhaustedReached
          and state.promoted.replacementRequests == REPLACEMENT_REQUEST_LIMIT
          and state.promoted.replacementReads == REPLACEMENT_REQUEST_LIMIT
          and completionClaimRequestsAreBounded
          and replacementRereadPrecedesRetry
      )
  }

  run lostReplacementResponseReconcilesCurrentClaimTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(loseCompletionClaimReplacementResponse)
      .then(reconcileReplacementAsCurrentCompletionClaim)
      .expect(
        state.promoted.phase == CompletionClaimCurrent
          and state.promoted.replacementRequests == 1
          and state.promoted.replacementReads == 1
          and state.promoted.currentClaimId == COMPLETION_CLAIM_A
          and currentCompletionClaimIsExact
      )
  }

  run foreignClaimStopsReplacementMutationTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(loseCompletionClaimReplacementResponse)
      .then(reconcileReplacementAsForeignClaim)
      .expect(
        state.promoted.phase == ReplacementWait
          and state.promoted.claimState == ForeignClaim
          and state.promoted.replacementRequests == 1
          and foreignClaimIsNeverMutated
          and noReintegration
      )
  }

  run blockerAfterPromotionPreservesTheSameProofTest = {
    init
      .then(observePostPromotionBlocker)
      .expect(
        blockerWaitReached
          and exactProofAndBinding
          and state.promoted.proof.candidateCommit == CANDIDATE_A
          and noReintegration
      )
      .then(observeFreshBlockerClear)
      .then(deriveCompletionClaim)
      .expect(
        state.promoted.phase == ReplacementIntentPending
          and exactProofAndBinding
          and noReintegration
      )
  }

  run freshBlockerClearObservationPermitsCompletionOfExistingPromotionTest = {
    init
      .then(observePostPromotionBlocker)
      .then(observeFreshBlockerClear)
      .then(deriveCompletionClaim)
      .expect(
        state.promoted.phase == ReplacementIntentPending
          and state.promoted.completionClaim.promotionCorrelation == PROMOTION_CORRELATION_A
          and state.reintegrationRequests == 0
      )
  }

  run blockerWhileCompletionClaimCurrentPreservesClaimAndPromotionTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observePostPromotionBlocker)
      .expect(
        state.promoted.phase == CompletionClaimBlocked
          and state.promoted.claimState == CompletionClaim
          and state.promoted.completionClaim.promotionCorrelation == PROMOTION_CORRELATION_A
          and noReintegration
      )
      .then(observeFreshBlockerClear)
      .expect(state.promoted.phase == CompletionClaimCurrent and state.promoted.claimState == CompletionClaim)
  }

  run staleTrackerSuccessDoesNotAuthorizeDeletionTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeStaleTrackerSuccess)
      .expect(
        state.promoted.phase == CompletionClaimCurrent
          and state.promoted.trackerObservation == StaleSuccess
          and not(state.promoted.deleteIntentRecorded)
          and state.promoted.deleteRequests == 0
      )
  }

  run freshTrackerSuccessPrecedesExactDeletionAndSettlementTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFreshTrackerSuccess)
      .then(recordCompletionClaimDeletionIntent)
      .then(requestCompletionClaimDeletion)
      .then(observeCompletionClaimDeleted)
      .then(settlePromotedTask)
      .expect(
        settledReached
          and exactProofAndBinding
          and freshTrackerSuccessPrecedesCompletionClaimDeletion
          and completionClaimDeletionTargetsExactClaim
          and settledTaskRequiresExactCleanup
          and subjectSettlementIsLocal
          and issue61BoundariesRemainExternal
          and runTerminationRemainsOwnedByIssue102
      )
  }

  run lostDeletionResponseReconcilesAbsentWithoutReopeningTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFreshTrackerSuccess)
      .then(recordCompletionClaimDeletionIntent)
      .then(requestCompletionClaimDeletion)
      .then(loseCompletionClaimDeletionResponse)
      .then(reconcileDeletionAsAbsent)
      .then(settlePromotedTask)
      .expect(
        settledReached
          and state.promoted.deleteRequests == 1
          and state.promoted.deleteReads == 1
          and deletionRereadPrecedesRetry
          and completionClaimDeletionRequestsAreBounded
          and successfulTaskNeverReopens
          and subjectSettlementIsLocal
      )
  }

  run failedDeletionKeepsSuccessfulTaskFinalTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFreshTrackerSuccess)
      .then(recordCompletionClaimDeletionIntent)
      .then(requestCompletionClaimDeletion)
      .then(rejectCompletionClaimDeletion)
      .expect(
        cleanupWaitReached
          and state.promoted.deletionFailureRecorded
          and state.promoted.trackerSuccessEver
          and state.promoted.freshTrackerSuccess
          and state.promoted.responsibilityHeld
          and successfulTaskNeverReopens
          and noReintegration
      )
  }

  run deletionRetryIsBoundedAfterFreshReadTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFreshTrackerSuccess)
      .then(recordCompletionClaimDeletionIntent)
      .then(requestCompletionClaimDeletion)
      .then(loseCompletionClaimDeletionResponse)
      .then(reconcileDeletionAsCurrentCompletionClaim)
      .then(retryCompletionClaimDeletion)
      .then(loseCompletionClaimDeletionResponse)
      .then(reconcileDeletionAsCurrentCompletionClaim)
      .then(retryCompletionClaimDeletion)
      .then(loseCompletionClaimDeletionResponse)
      .then(reconcileDeletionAsCurrentCompletionClaim)
      .expect(
        cleanupWaitReached
          and state.promoted.deleteRequests == DELETION_REQUEST_LIMIT
          and state.promoted.deleteReads == DELETION_REQUEST_LIMIT
          and deletionRereadPrecedesRetry
          and completionClaimDeletionRequestsAreBounded
          and state.promoted.trackerSuccessEver
          and state.promoted.responsibilityHeld
          and successfulTaskNeverReopens
      )
  }

  run emptyFrontierRetainsUnsettledUnrelatedResponsibilityTest = {
    init
      .then(markEmptyFrontier)
      .expect(
        emptyFrontierReached
          and state.unrelated.responsibilityHeld
          and emptyFrontierDoesNotSettleRetainedResponsibility
          and runTerminationRemainsOwnedByIssue102
      )
  }
}
