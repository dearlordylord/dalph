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
          and completionProofCarriesAcceptedEvidenceAndNoReturnedRefs
          and state.promoted.replacementIntentRecorded
          and state.promoted.replacementRequests == 0
          and not(state.promoted.postPromotionBlockerCleared)
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
      .then(observePostPromotionCandidateAncestorAncestry)
      .then(deriveCompletionClaim)
      .expect(
        state.promoted.phase == ReplacementIntentPending
          and exactProofAndBinding
          and postPromotionAncestryReached
          and noReintegration
      )
  }

  run postPromotionBlockerClearRequiresFreshCandidateAncestryBeforeReplacementTest = {
    init
      .then(observePostPromotionBlocker)
      .then(observeFreshBlockerClear)
      .expect(
        state.promoted.postPromotionBlockerCleared
          and state.promoted.postPromotionAncestry == NoPostPromotionAncestry
          and not(state.promoted.completionClaimDerived)
          and clearedPromotionRequiresFreshAncestry
      )
      .then(observePostPromotionCandidateCurrentAncestry)
      .expect(postPromotionAncestryReached and clearedPromotionRequiresFreshAncestry)
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .expect(
        state.promoted.phase == ReplacementIntentRecorded
          and state.promoted.completionClaimDerived
          and postPromotionAncestryReached
          and clearedPromotionRequiresFreshAncestry
      )
  }

  run freshBlockerClearObservationPermitsCompletionOfExistingPromotionTest = {
    init
      .then(observePostPromotionBlocker)
      .then(observeFreshBlockerClear)
      .then(observePostPromotionCandidateAncestorAncestry)
      .then(deriveCompletionClaim)
      .expect(
        state.promoted.phase == ReplacementIntentPending
          and state.promoted.completionClaim.integratorSession == INTEGRATOR_SESSION_A
          and postPromotionAncestryReached
          and state.reintegrationRequests == 0
      )
  }

  run postPromotionCandidateNotAncestorWaitsWithoutReplacementTest = {
    init
      .then(observePostPromotionBlocker)
      .then(observeFreshBlockerClear)
      .then(observePostPromotionCandidateNotAncestor)
      .expect(
        state.promoted.phase == PostPromotionAncestryWait
          and state.promoted.postPromotionAncestry == PostPromotionCandidateNotAncestor
          and not(state.promoted.completionClaimDerived)
          and state.promoted.replacementRequests == 0
      )
  }

  run postPromotionCandidateAncestryUnreadableWaitsWithoutReplacementTest = {
    init
      .then(observePostPromotionBlocker)
      .then(observeFreshBlockerClear)
      .then(observePostPromotionCandidateAncestryUnreadable)
      .expect(
        state.promoted.phase == PostPromotionAncestryWait
          and state.promoted.postPromotionAncestry == UnreadablePostPromotionCandidateAncestry
          and not(state.promoted.completionClaimDerived)
          and state.promoted.replacementRequests == 0
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
          and state.promoted.completionClaim.integratorSession == INTEGRATOR_SESSION_A
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

  // S1: the task-local focused success is enough to clean up A. The later
  // complete graph read is a separate observation that can release B.
  run s1FocusedSuccessThenLaterCompleteGraphTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompleteTaskIntent)
      .then(recordCompletionAttemptIntent)
      .then(requestCompleteTask)
      .then(observeCompleteTaskAcknowledgement)
      .then(observeFocusedCompletionSuccess)
      .expect(
        focusedCompletionSuccessReached
          and state.promoted.completeGraphObservation == NoCompleteGraph
          and state.promoted.completeTaskAcknowledged
          and state.promoted.completionRequests == 1
          and state.completeTaskRequests == 1
          and state.dependantReleases == 0
          and focusedSuccessRequiresCompletionObservation
      )
      .then(recordCompletionClaimDeletionIntent)
      .then(requestCompletionClaimDeletion)
      .then(observeCompletionClaimDeleted)
      .then(settlePromotedTask)
      .then(observeLaterCompleteGraphBlocked)
      .then(observeLaterCompleteGraphReleased)
      .expect(
        settledReached
          and completeGraphReleasedReached
          and state.promoted.dependantEligible
          and dependantReleaseRequiresLaterCompleteGraph
          and dependantReleaseBoundaryRemainsExternal
      )
  }

  // S2: a successful focused read after a lost response finishes without a
  // request lookup or second completion call.
  run lostCompletionResponseFocusedSuccessNeedsNoLookupTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompleteTaskIntent)
      .then(recordCompletionAttemptIntent)
      .then(requestCompleteTask)
      .then(loseCompleteTaskResponse)
      .then(observeFocusedCompletionSuccess)
      .expect(
        focusedCompletionSuccessReached
          and state.promoted.completionRequests == 1
          and state.promoted.completionReads == 0
          and state.promoted.completionOutcome == NoCompletionOutcome
          and not(state.promoted.completeTaskAcknowledged)
          and focusedSuccessRequiresCompletionObservation
      )
  }

  // When the focused read still reports Open, exact NotApplied reconciliation
  // is required before one bounded retry.
  run s2LostCompletionResponseReconcilesExactRequestBeforeRetryTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompleteTaskIntent)
      .then(recordCompletionAttemptIntent)
      .then(requestCompleteTask)
      .then(loseCompleteTaskResponse)
      .then(observeFocusedCompletionOpenAfterLoss)
      .then(lookupCompletionRequestNotApplied)
      .then(refreshCompletionPremisesForRetry)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompletionAttemptIntent)
      .then(requestCompleteTask)
      .then(loseCompleteTaskResponse)
      .then(observeFocusedCompletionOpenAfterLoss)
      .then(lookupCompletionRequestApplied)
      .then(observeFocusedCompletionSuccess)
      .expect(
        focusedCompletionSuccessReached
          and state.promoted.completionRequests == 2
          and state.promoted.completionReads == 2
          and state.promoted.completionOutcome == Applied
          and state.promoted.completionNotAppliedReads == 1
          and completionRetryRequiresExactRequestLookup
          and completionRequestsAreBoundedForIssue61
          and completionRequestUsesExactPremises
      )
  }

  run unreadableCompletionRequestKeepsTaskWaitingTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompleteTaskIntent)
      .then(recordCompletionAttemptIntent)
      .then(requestCompleteTask)
      .then(loseCompleteTaskResponse)
      .then(observeFocusedCompletionOpenAfterLoss)
      .then(lookupCompletionRequestUnreadable)
      .expect(
        completionWaitReached
          and state.promoted.completionOutcome == UnreadableCompletionOutcome
          and state.promoted.completionReads == 1
          and not(state.promoted.focusedSuccessRecorded)
          and state.promoted.completionRequests == 1
      )
  }

  // S3: all task-local conflict reads stop this subject without mutating a
  // foreign task or treating a revision/reopen observation as success.
  run s3HumanCompletionWithAbsentClaimIsAcceptedTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompleteTaskIntent)
      .then(observeFocusedCompletionHumanSuccessWithAbsentClaim)
      .expect(
        humanSuccessWithAbsentClaimReached
          and state.promoted.completionConflict == NoCompletionConflict
          and state.promoted.completionRequests == 0
          and state.completeTaskRequests == 0
          and state.promoted.foreignMutationCount == 0
          and humanFocusedSuccessIsAccepted
      )
  }

  run s3HumanCompletionWithForeignClaimIsAcceptedWithoutMutationTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompleteTaskIntent)
      .then(observeFocusedCompletionHumanSuccessWithForeignClaim)
      .expect(
        humanSuccessWithForeignClaimReached
          and state.promoted.completionConflict == NoCompletionConflict
          and state.promoted.completionRequests == 0
          and state.completeTaskRequests == 0
          and state.promoted.foreignMutationCount == 0
          and state.promoted.lastMutation != ForeignClaimMutation
          and humanFocusedSuccessIsAccepted
          and foreignClaimIsNeverMutated
      )
  }

  run s3ForeignCompletionConflictIsTaskLocalTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observeFocusedCompletionForeignTaskConflict)
      .expect(
        completionWaitReached
          and state.promoted.completionConflict == ForeignTask
          and state.promoted.completionRequests == 0
          and not(state.promoted.focusedSuccessRecorded)
      )
  }

  run s3RevisionCompletionConflictIsTaskLocalTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observeFocusedCompletionRevisionConflict)
      .expect(
        completionWaitReached
          and state.promoted.completionConflict == RevisionConflict
          and state.promoted.completionRequests == 0
          and not(state.promoted.focusedSuccessRecorded)
      )
  }

  run s3ReopenedCompletionConflictIsTaskLocalTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observeFocusedCompletionReopenedConflict)
      .expect(
        completionWaitReached
          and state.promoted.completionConflict == ReopenedTask
          and state.promoted.completionRequests == 0
          and not(state.promoted.focusedSuccessRecorded)
      )
  }

  run s4FocusedSuccessSurvivesCleanupBeforeGraphRefreshTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompleteTaskIntent)
      .then(recordCompletionAttemptIntent)
      .then(requestCompleteTask)
      .then(observeCompleteTaskAcknowledgement)
      .then(observeFocusedCompletionSuccess)
      .then(recordCompletionClaimDeletionIntent)
      .then(requestCompletionClaimDeletion)
      .then(observeCompletionClaimDeleted)
      .then(settlePromotedTask)
      .expect(
        settledReached
          and focusedCompletionSuccessReached
          and state.promoted.completeGraphObservation == NoCompleteGraph
          and state.promoted.responsibilityHeld == false
      )
      .then(observeLaterCompleteGraphBlocked)
      .expect(
        settledReached
          and completeGraphBlockedReached
          and not(state.promoted.dependantEligible)
          and successfulTaskNeverReopens
      )
  }

  // S5: current blockers/membership in the later graph control dependant
  // eligibility and do not create another completion request.
  run s5CompleteGraphBlockerAndReleaseAreSeparateFromCompletionTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompleteTaskIntent)
      .then(recordCompletionAttemptIntent)
      .then(requestCompleteTask)
      .then(observeCompleteTaskAcknowledgement)
      .then(observeFocusedCompletionSuccess)
      .then(observeLaterCompleteGraphBlocked)
      .expect(
        completeGraphBlockedReached
          and not(state.promoted.dependantEligible)
          and state.promoted.completionRequests == 1
      )
      .then(observeLaterCompleteGraphReleased)
      .expect(
        completeGraphReleasedReached
          and state.promoted.dependantEligible
          and state.promoted.completionRequests == 1
          and state.completeTaskRequests == 1
          and state.dependantReleases == 0
      )
  }

  run freshTrackerSuccessPrecedesExactDeletionAndSettlementTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompleteTaskIntent)
      .then(observeFocusedCompletionHumanSuccessWithExactClaim)
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
          and dependantReleaseBoundaryRemainsExternal
          and runTerminationRemainsOwnedByIssue102
      )
  }

  run lostDeletionResponseReconcilesAbsentWithoutReopeningTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompleteTaskIntent)
      .then(observeFocusedCompletionHumanSuccessWithExactClaim)
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
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompleteTaskIntent)
      .then(observeFocusedCompletionHumanSuccessWithExactClaim)
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
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompleteTaskIntent)
      .then(observeFocusedCompletionHumanSuccessWithExactClaim)
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
