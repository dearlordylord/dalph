// Negative controls for the issue #141 invariant projection. Each mutation
// performs one forbidden shortcut that the main model never permits.
module integrationFinalityNegativeTest {
  import integrationFinality.* from "./integrationFinality"

  action forgePromotionProof: bool = all {
    state.promoted.completionClaimDerived,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        proof: { ...state.promoted.proof, candidateCommit: CANDIDATE_A + 1 },
      },
    },
  }

  action requestBeforeDurableIntent: bool = all {
    state.promoted.phase == ReplacementIntentPending,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: ReplacementRequested,
        replacementRequests: state.promoted.replacementRequests + 1,
      },
    },
  }

  action retryBeforeFreshRead: bool = all {
    state.promoted.phase == ReplacementResponseLost,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: ReplacementRequested,
        replacementRequests: state.promoted.replacementRequests + 1,
      },
    },
  }

  action mutateForeignClaim: bool = all {
    state.promoted.phase == ReplacementWait,
    state.promoted.claimState == ForeignClaim,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        foreignMutationCount: state.promoted.foreignMutationCount + 1,
        lastMutation: ForeignClaimMutation,
      },
    },
  }

  action reintegratePromotedCandidate: bool = all {
    state.promoted.proofPresent,
    state' = {
      ...state,
      reintegrationRequests: state.reintegrationRequests + 1,
      promoted: { ...state.promoted, reintegrationCount: state.promoted.reintegrationCount + 1 },
    },
  }

  action reopenSuccessfulTask: bool = all {
    state.promoted.trackerSuccessEver,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: PromotedProof,
        reopenedAfterSuccess: true,
      },
    },
  }

  action terminateWithRetainedResponsibility: bool = all {
    state.frontierEmpty,
    state.promoted.responsibilityHeld or state.unrelated.responsibilityHeld,
    state' = { ...state, runTerminated: true },
  }

  run forgedProofIsDetectedTest = {
    init
      .then(deriveCompletionClaim)
      .then(forgePromotionProof)
      .expect(not(exactProofAndBinding) and not(completionClaimRequiresExactPromotionProof))
  }

  run requestBeforeIntentIsDetectedTest = {
    init
      .then(deriveCompletionClaim)
      .then(requestBeforeDurableIntent)
      .expect(not(replacementIntentPrecedesRequest))
  }

  run retryBeforeReadIsDetectedTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(loseCompletionClaimReplacementResponse)
      .then(retryBeforeFreshRead)
      .expect(not(replacementRereadPrecedesRetry))
  }

  run foreignMutationIsDetectedTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(loseCompletionClaimReplacementResponse)
      .then(reconcileReplacementAsForeignClaim)
      .then(mutateForeignClaim)
      .expect(not(foreignClaimIsNeverMutated))
  }

  run reintegrationAfterPromotionIsDetectedTest = {
    init
      .then(reintegratePromotedCandidate)
      .expect(not(noReintegration))
  }

  run reopeningAfterFreshSuccessIsDetectedTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFreshTrackerSuccess)
      .then(reopenSuccessfulTask)
      .expect(not(successfulTaskNeverReopens))
  }

  run terminatingWithRetainedResponsibilityIsDetectedTest = {
    init
      .then(markEmptyFrontier)
      .then(terminateWithRetainedResponsibility)
      .expect(not(emptyFrontierDoesNotSettleRetainedResponsibility))
  }
}
