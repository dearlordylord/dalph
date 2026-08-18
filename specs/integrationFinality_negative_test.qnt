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

  // A legacy verification-shaped reference cannot replace the accepted-result
  // evidence and empty Integrator-returned collection in a finality claim.
  action forgeLegacyEvidenceForFinality: bool = all {
    state.promoted.phase == PromotedProof,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: ReplacementIntentPending,
        proof: {
          ...state.promoted.proof,
          acceptedResultEvidence: 0,
          integratorReturnedEvidenceRefs: Set(703),
        },
        completionClaimDerived: true,
        completionClaim: {
          claimId: COMPLETION_CLAIM_A,
          runId: state.promoted.proof.runId,
          taskId: state.promoted.proof.taskId,
          attemptId: state.promoted.proof.attemptId,
          taskRevision: state.promoted.proof.taskRevision,
          integratorSession: state.promoted.proof.integratorSession,
          predecessorClaimId: state.promoted.originalClaimId,
          candidateCommit: state.promoted.proof.candidateCommit,
          expectedTargetHead: state.promoted.proof.expectedTargetHead,
          acceptedResultCommit: state.promoted.proof.acceptedResultCommit,
          candidateFirstParent: state.promoted.proof.candidateFirstParent,
          candidateSecondParent: state.promoted.proof.candidateSecondParent,
          acceptedResultEvidence: 0,
          integratorReturnedEvidenceRefs: Set(703),
        },
        legacyEvidenceForged: true,
      },
    },
  }

  // Models a mutation that drops the candidate-commit check from the
  // deriveCompletionClaim guard. The independently stated invariants must
  // reject the resulting derived claim even though the transition fires.
  action deriveCompletionClaimWithWeakenedGuard: bool = all {
    state.promoted.phase == PromotedProof,
    state.promoted.proofPresent,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: ReplacementIntentPending,
        proof: {
          ...state.promoted.proof,
          candidateCommit: CANDIDATE_A + 1,
        },
        completionClaimDerived: true,
        completionClaim: {
          claimId: COMPLETION_CLAIM_A,
          runId: state.promoted.proof.runId,
          taskId: state.promoted.proof.taskId,
          attemptId: state.promoted.proof.attemptId,
          taskRevision: state.promoted.proof.taskRevision,
          integratorSession: state.promoted.proof.integratorSession,
          predecessorClaimId: state.promoted.originalClaimId,
          candidateCommit: state.promoted.proof.candidateCommit,
          expectedTargetHead: state.promoted.proof.expectedTargetHead,
          acceptedResultCommit: state.promoted.proof.acceptedResultCommit,
          candidateFirstParent: state.promoted.proof.candidateFirstParent,
          candidateSecondParent: state.promoted.proof.candidateSecondParent,
          acceptedResultEvidence: state.promoted.proof.acceptedResultEvidence,
          integratorReturnedEvidenceRefs: state.promoted.proof.integratorReturnedEvidenceRefs,
        },
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

  action requestCompleteBeforeIntent: bool = all {
    state.promoted.phase == CompletionEvidenceObserved,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionRequested,
        completionRequests: state.promoted.completionRequests + 1,
        completionPremiseViolationCalls:
          if (completionCallPremisesExact(state.promoted))
          state.promoted.completionPremiseViolationCalls
          else
          state.promoted.completionPremiseViolationCalls + 1,
        lastMutation: CompleteTaskMutation,
      },
    },
  }

  action retryCompleteBeforeExactLookup: bool = all {
    state.promoted.phase == CompletionResponseLost,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionRequested,
        completionRequests: state.promoted.completionRequests + 1,
        lastMutation: CompleteTaskMutation,
      },
    },
  }

  action requestCompleteWithoutAttemptIntent: bool = all {
    state.promoted.phase == CompletionIntentRecorded,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionRequested,
        completionRequests: state.promoted.completionRequests + 1,
        lastMutation: CompleteTaskMutation,
      },
    },
  }

  action lookupCompletionRequestWithoutConfirmation: bool = all {
    state.promoted.phase == CompletionResponseLost,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionRetryReady,
        completionReads: state.promoted.completionReads + 1,
        completionNotAppliedReads: state.promoted.completionNotAppliedReads + 1,
        completionConfirmationViolationLookups:
          completionConfirmationViolationLookupsAfterCurrentLookup(state.promoted),
        completionOutcome: NotApplied,
      },
    },
  }

  action mutateCompletionAncestryBeforeCall: bool = all {
    state.promoted.phase == CompletionAttemptIntentRecorded,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        completionAncestry: CandidateNotAncestor,
        completionRequests: state.promoted.completionRequests + 1,
        completionPremiseViolationCalls:
          if (completionCallPremisesExact({ ...state.promoted, completionAncestry: CandidateNotAncestor }))
          state.promoted.completionPremiseViolationCalls
          else
          state.promoted.completionPremiseViolationCalls + 1,
        lastMutation: CompleteTaskMutation,
      },
    },
  }

  action inventPostRequestFocusedSuccessWithoutRequest: bool = all {
    state.promoted.phase == CompletionEvidenceObserved,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: DeleteIntentPending,
        focusedSuccessRecorded: true,
        freshTrackerSuccess: true,
        trackerSuccessEver: true,
        successSource: PostRequestFocusedSuccess,
      },
    },
  }

  action inferSuccessFromAcknowledgement: bool = all {
    state.promoted.phase == CompletionRequested,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: DeleteIntentPending,
        completionOutcome: Applied,
        completeTaskAcknowledged: true,
        trackerSuccessEver: true,
        freshTrackerSuccess: true,
        trackerObservation: FreshSuccess,
        trackerObservationRevision: FRESH_TRACKER_REVISION,
        successSource: NoSuccess,
      },
    },
  }

  action misclassifyHumanSuccessAsConflict: bool = all {
    state.promoted.phase == CompletionIntentRecorded,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionWait,
        claimState: ForeignClaim,
        currentClaimId: 999,
        successSource: ExternalFocusedSuccess,
        completionConflict: ForeignTask,
      },
    },
  }

  action releaseDependantBeforeCompleteGraph: bool = all {
    state.promoted.trackerSuccessEver,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        dependantEligible: true,
      },
    },
  }

  action makeFourthCompleteTaskRequest: bool = all {
    state.promoted.completionRequests == COMPLETE_TASK_REQUEST_LIMIT,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        completionRequests: state.promoted.completionRequests + 1,
      },
    },
  }

  run forgedProofIsDetectedTest = {
    init
      .then(deriveCompletionClaim)
      .then(forgePromotionProof)
      .expect(not(exactProofAndBinding) and not(completionClaimRequiresExactPromotionProof))
  }

  run forgedLegacyEvidenceCannotAuthorizeFinalityTest = {
    init
      .then(forgeLegacyEvidenceForFinality)
      .expect(and {
        not(noLegacyEvidenceAuthorizesFinality),
        not(completionProofCarriesAcceptedEvidenceAndNoReturnedRefs),
        not(completionClaimRequiresExactPromotionProof),
      })
  }

  run weakenedDerivationGuardIsDetectedTest = {
    init
      .then(deriveCompletionClaimWithWeakenedGuard)
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
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompleteTaskIntent)
      .then(observeFocusedCompletionHumanSuccessWithExactClaim)
      .then(reopenSuccessfulTask)
      .expect(not(successfulTaskNeverReopens))
  }

  run terminatingWithRetainedResponsibilityIsDetectedTest = {
    init
      .then(markEmptyFrontier)
      .then(terminateWithRetainedResponsibility)
      .expect(not(emptyFrontierDoesNotSettleRetainedResponsibility))
  }

  run completeTaskRequestBeforeIntentIsDetectedTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(requestCompleteBeforeIntent)
      .expect(not(completionIntentPrecedesRequest))
  }

  run completeTaskRetryBeforeExactLookupIsDetectedTest = {
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
      .then(retryCompleteBeforeExactLookup)
      .expect(not(completionRetryRequiresExactRequestLookup))
  }

  run completeTaskCallWithoutAttemptIntentIsDetectedTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompleteTaskIntent)
      .then(requestCompleteWithoutAttemptIntent)
      .expect(not(completionAttemptIntentPrecedesRequest))
  }

  run completionLookupWithoutPostLossConfirmationIsDetectedTest = {
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
      .then(lookupCompletionRequestWithoutConfirmation)
      .expect(not(completionLookupRequiresPostLossConfirmation))
  }

  run completionCallWithWrongAncestryIsDetectedTest = {
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
      .then(mutateCompletionAncestryBeforeCall)
      .expect(not(completionRequestUsesExactPremises))
  }

  run postRequestFocusedSuccessWithoutRequestIsDetectedTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(inventPostRequestFocusedSuccessWithoutRequest)
      .expect(not(focusedSuccessRequiresCompletionObservation))
  }

  run acknowledgementCannotInventFocusedSuccessTest = {
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
      .then(inferSuccessFromAcknowledgement)
      .expect(not(trackerSuccessRequiresFocusedObservation))
  }

  run humanSuccessCannotBeMisclassifiedAsConflictTest = {
    init
      .then(deriveCompletionClaim)
      .then(recordCompletionClaimReplacementIntent)
      .then(requestCompletionClaimReplacement)
      .then(observeCompletionClaimReplacement)
      .then(observeFocusedCompletionFacts)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompleteTaskIntent)
      .then(misclassifyHumanSuccessAsConflict)
      .expect(not(humanFocusedSuccessIsAccepted))
  }

  run dependantReleaseBeforeCompleteGraphIsDetectedTest = {
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
      .then(releaseDependantBeforeCompleteGraph)
      .expect(not(dependantReleaseRequiresLaterCompleteGraph))
  }

  run fourthCompleteTaskRequestIsDetectedTest = {
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
      .then(lookupCompletionRequestNotApplied)
      .then(refreshCompletionPremisesForRetry)
      .then(observePromotedCandidateAncestry)
      .then(observeCompletionEvidence)
      .then(recordCompletionAttemptIntent)
      .then(requestCompleteTask)
      .then(makeFourthCompleteTaskRequest)
      .expect(not(completionRequestsAreBoundedForIssue61))
  }
}
