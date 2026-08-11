// Models issue #141 after issue #60 has durably proved one exact promotion.
// This subject-scoped slice owns completion-claim replacement, issue #61's
// exact completion request and focused tracker success, the later complete
// graph read that may make a dependant eligible, and cleanup/settlement. Issue
// #102 owns Run termination. Git promotion, executor work, and candidate
// construction are represented only by the exact proof that this protocol
// consumes.
module integrationFinality {
  type Phase =
    | PromotedProof
    | BlockedAfterPromotion
    | CompletionClaimBlocked
    | ReplacementIntentPending
    | ReplacementIntentRecorded
    | ReplacementRequested
    | ReplacementResponseLost
    | ReplacementRetryReady
    | ReplacementWait
    | ReplacementExhausted
    | CompletionClaimCurrent
    | CompletionFactsObserved
    | CompletionAncestryObserved
    | CompletionEvidenceObserved
    | CompletionIntentRecorded
    | CompletionAttemptIntentRecorded
    | CompletionRequested
    | CompletionResponseLost
    | CompletionConfirmationObserved
    | CompletionAcknowledged
    | CompletionRetryReady
    | CompletionWait
    | DeleteIntentPending
    | DeleteIntentRecorded
    | DeleteRequested
    | DeleteResponseLost
    | DeleteRetryReady
    | DeleteResponseObserved
    | CleanupWait
    | Settled
    | UnrelatedPending

  type ClaimState = OriginalClaim | CompletionClaim | ForeignClaim | AbsentClaim | UnreadableClaim
  type TrackerObservation = NoTrackerObservation | StaleSuccess | FreshSuccess
  type CompletionRequestOutcome = NoCompletionOutcome | Applied | NotApplied | UnreadableCompletionOutcome
  type CandidateAncestry = NoCandidateAncestry | CandidateAncestor | CandidateNotAncestor | UnreadableAncestry
  type CompleteGraphObservation = NoCompleteGraph | GraphBlocked | GraphReleased | UnreadableGraph
  type SuccessSource = NoSuccess | ExternalFocusedSuccess | PostRequestFocusedSuccess
  type CompletionConflict = NoCompletionConflict | ForeignTask | RevisionConflict | ReopenedTask
  type MutationTarget = NoMutation | OriginalClaimMutation | CompletionClaimMutation | CompleteTaskMutation | ForeignClaimMutation

  // Git owns this proof. The #141 protocol may consume it but may not
  // reconstruct or weaken any of its bindings.
  type PromotionProof = {
    runId: int,
    taskId: int,
    attemptId: int,
    taskRevision: int,
    candidateCommit: int,
    expectedTargetHead: int,
    integrationTarget: int,
    promotionCorrelation: int,
    acceptanceManifest: int,
    integrationReviewManifest: int,
    verificationManifest: int,
  }

  // This is the one new tracker claim identity derived from the exact active
  // claim and exact promotion proof. It is not a second integration attempt.
  type CompletionClaimRecord = {
    claimId: int,
    runId: int,
    taskId: int,
    attemptId: int,
    taskRevision: int,
    predecessorClaimId: int,
    promotionCorrelation: int,
    acceptanceManifest: int,
    integrationReviewManifest: int,
    verificationManifest: int,
  }

  type SubjectState = {
    taskId: int,
    attemptId: int,
    taskRevision: int,
    originalClaimId: int,
    currentClaimId: int,
    claimState: ClaimState,
    phase: Phase,
    proofPresent: bool,
    proof: PromotionProof,
    completionClaimDerived: bool,
    completionClaim: CompletionClaimRecord,
    replacementIntentRecorded: bool,
    replacementRequests: int,
    replacementReads: int,
    replacementReadBeforeRetry: bool,
    replacementOutcomeRecorded: bool,
    deleteIntentRecorded: bool,
    deleteRequests: int,
    deleteReads: int,
    deleteReadBeforeRetry: bool,
    deletionOutcomeRecorded: bool,
    deletionFailureRecorded: bool,
    trackerObservation: TrackerObservation,
    trackerCompletionRequestRevision: int,
    trackerObservationRevision: int,
    freshTrackerSuccess: bool,
    trackerSuccessEver: bool,
    focusedSuccessRecorded: bool,
    successSource: SuccessSource,
    focusedFactsRecorded: bool,
    focusedFactsOpen: bool,
    focusedFactsNoBlocker: bool,
    completionAncestry: CandidateAncestry,
    completionEvidenceRecorded: bool,
    completionRequestId: int,
    completionIntentRecorded: bool,
    completionAttemptIntents: int,
    completionOpenConfirmationRecorded: bool,
    completionConfirmationViolationLookups: int,
    completionRequests: int,
    completionPremiseViolationCalls: int,
    completionReads: int,
    completionNotAppliedReads: int,
    completionOutcome: CompletionRequestOutcome,
    completeTaskAcknowledged: bool,
    completionConflict: CompletionConflict,
    completeGraphObservation: CompleteGraphObservation,
    dependantEligible: bool,
    responsibilityHeld: bool,
    settled: bool,
    foreignMutationCount: int,
    reintegrationCount: int,
    lastMutation: MutationTarget,
    blockerPresent: bool,
    reopenedAfterSuccess: bool,
  }

  type State = {
    promoted: SubjectState,
    unrelated: SubjectState,
    frontierEmpty: bool,
    runTerminated: bool,
    completeTaskRequests: int,
    dependantReleases: int,
    reintegrationRequests: int,
  }

  pure val RUN_ID = 141
  pure val TASK_A = 1
  pure val TASK_B = 2
  pure val ATTEMPT_A = 11
  pure val ATTEMPT_B = 22
  pure val TASK_REVISION_A = 7
  pure val TASK_REVISION_B = 8
  pure val ORIGINAL_CLAIM_A = 101
  pure val ORIGINAL_CLAIM_B = 102
  pure val COMPLETION_CLAIM_A = 201
  pure val CANDIDATE_A = 301
  pure val EXPECTED_HEAD_A = 401
  pure val INTEGRATION_TARGET_A = 501
  pure val PROMOTION_CORRELATION_A = 601
  pure val ACCEPTANCE_MANIFEST_A = 701
  pure val INTEGRATION_REVIEW_MANIFEST_A = 702
  pure val VERIFICATION_MANIFEST_A = 703
  pure val COMPLETION_REQUEST_A = 801
  pure val TRACKER_COMPLETION_REQUEST_REVISION = 10
  pure val STALE_TRACKER_REVISION = 10
  pure val FRESH_TRACKER_REVISION = 11
  pure val COMPLETE_GRAPH_REVISION = 12
  pure val REPLACEMENT_REQUEST_LIMIT = 3
  pure val DELETION_REQUEST_LIMIT = 3
  pure val COMPLETE_TASK_REQUEST_LIMIT = 3

  var state: State

  pure def promotionProofExact(subject: SubjectState): bool = and {
    subject.proofPresent,
    subject.proof.runId == RUN_ID,
    subject.proof.taskId == TASK_A,
    subject.proof.attemptId == ATTEMPT_A,
    subject.proof.taskRevision == TASK_REVISION_A,
    subject.proof.candidateCommit == CANDIDATE_A,
    subject.proof.expectedTargetHead == EXPECTED_HEAD_A,
    subject.proof.integrationTarget == INTEGRATION_TARGET_A,
    subject.proof.promotionCorrelation == PROMOTION_CORRELATION_A,
    subject.proof.acceptanceManifest == ACCEPTANCE_MANIFEST_A,
    subject.proof.integrationReviewManifest == INTEGRATION_REVIEW_MANIFEST_A,
    subject.proof.verificationManifest == VERIFICATION_MANIFEST_A,
  }

  pure def completionClaimExact(subject: SubjectState): bool = and {
    subject.completionClaim.claimId == COMPLETION_CLAIM_A,
    subject.completionClaim.runId == subject.proof.runId,
    subject.completionClaim.taskId == subject.proof.taskId,
    subject.completionClaim.attemptId == subject.proof.attemptId,
    subject.completionClaim.taskRevision == subject.proof.taskRevision,
    subject.completionClaim.predecessorClaimId == subject.originalClaimId,
    subject.completionClaim.promotionCorrelation == subject.proof.promotionCorrelation,
    subject.completionClaim.acceptanceManifest == subject.proof.acceptanceManifest,
    subject.completionClaim.integrationReviewManifest == subject.proof.integrationReviewManifest,
    subject.completionClaim.verificationManifest == subject.proof.verificationManifest,
  }

  // Independent call-time measurement. The request transition keeps its
  // fail-closed guard inline; this predicate is used only to record whether a
  // crossed boundary actually carried every exact premise. Weakening the
  // guard therefore turns the safety invariant red instead of making the
  // transition certify itself.
  pure def completionCallPremisesExact(subject: SubjectState): bool = and {
    subject.completionRequestId == COMPLETION_REQUEST_A,
    promotionProofExact(subject),
    completionClaimExact(subject),
    subject.focusedFactsRecorded,
    subject.focusedFactsOpen,
    subject.focusedFactsNoBlocker,
    subject.completionAncestry == CandidateAncestor,
    subject.completionEvidenceRecorded,
    subject.completionConflict == NoCompletionConflict,
  }

  pure def replacementPhase(phase: Phase): bool = Set(
    ReplacementIntentPending,
    ReplacementIntentRecorded,
    ReplacementRequested,
    ReplacementResponseLost,
    ReplacementRetryReady,
    ReplacementWait,
    ReplacementExhausted,
  ).contains(phase)

  pure def deletionPhase(phase: Phase): bool = Set(
    DeleteIntentPending,
    DeleteIntentRecorded,
    DeleteRequested,
    DeleteResponseLost,
    DeleteRetryReady,
    DeleteResponseObserved,
    CleanupWait,
    Settled,
  ).contains(phase)

  pure def successfulPhase(phase: Phase): bool = Set(
    DeleteIntentPending,
    DeleteIntentRecorded,
    DeleteRequested,
    DeleteResponseLost,
    DeleteRetryReady,
    DeleteResponseObserved,
    CleanupWait,
    Settled,
  ).contains(phase)

  // The exact proof and derived claim remain reachable witnesses for the
  // protocol's two identity-binding boundaries.
  val promotedProofReached: bool = state.promoted.phase == PromotedProof
  val blockerWaitReached: bool = state.promoted.phase == BlockedAfterPromotion
  val replacementIntentPendingReached: bool = state.promoted.phase == ReplacementIntentPending
  val replacementIntentReached: bool = state.promoted.phase == ReplacementIntentRecorded
  val replacementRequestedReached: bool = state.promoted.phase == ReplacementRequested
  val replacementResponseLostReached: bool = state.promoted.phase == ReplacementResponseLost
  val replacementRetryReadyReached: bool = state.promoted.phase == ReplacementRetryReady
  val replacementWaitReached: bool = state.promoted.phase == ReplacementWait
  val replacementExhaustedReached: bool = state.promoted.phase == ReplacementExhausted
  val completionClaimCurrentReached: bool = state.promoted.phase == CompletionClaimCurrent
  val completionFactsReached: bool = state.promoted.phase == CompletionFactsObserved
  val completionAncestryReached: bool = state.promoted.phase == CompletionAncestryObserved
  val completionEvidenceReached: bool = state.promoted.phase == CompletionEvidenceObserved
  val completionIntentReached: bool = state.promoted.phase == CompletionIntentRecorded
  val completionAttemptIntentReached: bool = state.promoted.phase == CompletionAttemptIntentRecorded
  val completionRequestedReached: bool = state.promoted.phase == CompletionRequested
  val completionResponseLostReached: bool = state.promoted.phase == CompletionResponseLost
  val completionConfirmationReached: bool = state.promoted.phase == CompletionConfirmationObserved
  val completionAcknowledgedReached: bool = state.promoted.phase == CompletionAcknowledged
  val completionRetryReadyReached: bool = state.promoted.phase == CompletionRetryReady
  val completionWaitReached: bool = state.promoted.phase == CompletionWait
  val trackerSuccessReached: bool = state.promoted.phase == DeleteIntentPending
  val focusedCompletionSuccessReached: bool = and {
    state.promoted.focusedSuccessRecorded,
    state.promoted.successSource == PostRequestFocusedSuccess,
  }
  val humanSuccessWithAbsentClaimReached: bool = and {
    state.promoted.focusedSuccessRecorded,
    state.promoted.successSource == ExternalFocusedSuccess,
    state.promoted.claimState == AbsentClaim,
  }
  val humanSuccessWithForeignClaimReached: bool = and {
    state.promoted.focusedSuccessRecorded,
    state.promoted.successSource == ExternalFocusedSuccess,
    state.promoted.claimState == ForeignClaim,
  }
  val completeGraphBlockedReached: bool = state.promoted.completeGraphObservation == GraphBlocked
  val completeGraphReleasedReached: bool = state.promoted.completeGraphObservation == GraphReleased
  val deleteIntentReached: bool = state.promoted.phase == DeleteIntentRecorded
  val deleteRequestedReached: bool = state.promoted.phase == DeleteRequested
  val deleteResponseLostReached: bool = state.promoted.phase == DeleteResponseLost
  val deleteRetryReadyReached: bool = state.promoted.phase == DeleteRetryReady
  val deleteResponseObservedReached: bool = state.promoted.phase == DeleteResponseObserved
  val cleanupWaitReached: bool = state.promoted.phase == CleanupWait
  val settledReached: bool = state.promoted.phase == Settled
  val emptyFrontierReached: bool = state.frontierEmpty
  val unrelatedResponsibilityReached: bool = state.unrelated.responsibilityHeld

  // These comparisons deliberately do not call promotionProofExact or
  // completionClaimExact. Those helpers guard transitions; the invariant is
  // the independent measurement that must still turn red if a guard is
  // weakened.
  val exactProofAndBinding: bool = and {
    state.promoted.proofPresent implies and {
      state.promoted.proof.runId == RUN_ID,
      state.promoted.proof.taskId == TASK_A,
      state.promoted.proof.attemptId == ATTEMPT_A,
      state.promoted.proof.taskRevision == TASK_REVISION_A,
      state.promoted.proof.candidateCommit == CANDIDATE_A,
      state.promoted.proof.expectedTargetHead == EXPECTED_HEAD_A,
      state.promoted.proof.integrationTarget == INTEGRATION_TARGET_A,
      state.promoted.proof.promotionCorrelation == PROMOTION_CORRELATION_A,
      state.promoted.proof.acceptanceManifest == ACCEPTANCE_MANIFEST_A,
      state.promoted.proof.integrationReviewManifest == INTEGRATION_REVIEW_MANIFEST_A,
      state.promoted.proof.verificationManifest == VERIFICATION_MANIFEST_A,
    },
    state.promoted.completionClaimDerived implies and {
      state.promoted.proofPresent,
      state.promoted.proof.runId == RUN_ID,
      state.promoted.proof.taskId == TASK_A,
      state.promoted.proof.attemptId == ATTEMPT_A,
      state.promoted.proof.taskRevision == TASK_REVISION_A,
      state.promoted.proof.candidateCommit == CANDIDATE_A,
      state.promoted.proof.expectedTargetHead == EXPECTED_HEAD_A,
      state.promoted.proof.integrationTarget == INTEGRATION_TARGET_A,
      state.promoted.proof.promotionCorrelation == PROMOTION_CORRELATION_A,
      state.promoted.proof.acceptanceManifest == ACCEPTANCE_MANIFEST_A,
      state.promoted.proof.integrationReviewManifest == INTEGRATION_REVIEW_MANIFEST_A,
      state.promoted.proof.verificationManifest == VERIFICATION_MANIFEST_A,
      state.promoted.completionClaim.claimId == COMPLETION_CLAIM_A,
      state.promoted.completionClaim.runId == state.promoted.proof.runId,
      state.promoted.completionClaim.taskId == state.promoted.proof.taskId,
      state.promoted.completionClaim.attemptId == state.promoted.proof.attemptId,
      state.promoted.completionClaim.taskRevision == state.promoted.proof.taskRevision,
      state.promoted.completionClaim.predecessorClaimId == state.promoted.originalClaimId,
      state.promoted.completionClaim.promotionCorrelation == state.promoted.proof.promotionCorrelation,
      state.promoted.completionClaim.acceptanceManifest == state.promoted.proof.acceptanceManifest,
      state.promoted.completionClaim.integrationReviewManifest == state.promoted.proof.integrationReviewManifest,
      state.promoted.completionClaim.verificationManifest == state.promoted.proof.verificationManifest,
      state.promoted.completionClaim.claimId != state.promoted.originalClaimId,
    },
  }

  val completionClaimRequiresExactPromotionProof: bool =
    not(state.promoted.completionClaimDerived)
      or and {
        state.promoted.proofPresent,
        state.promoted.proof.runId == RUN_ID,
        state.promoted.proof.taskId == TASK_A,
        state.promoted.proof.attemptId == ATTEMPT_A,
        state.promoted.proof.taskRevision == TASK_REVISION_A,
        state.promoted.proof.candidateCommit == CANDIDATE_A,
        state.promoted.proof.expectedTargetHead == EXPECTED_HEAD_A,
        state.promoted.proof.integrationTarget == INTEGRATION_TARGET_A,
        state.promoted.proof.promotionCorrelation == PROMOTION_CORRELATION_A,
        state.promoted.proof.acceptanceManifest == ACCEPTANCE_MANIFEST_A,
        state.promoted.proof.integrationReviewManifest == INTEGRATION_REVIEW_MANIFEST_A,
        state.promoted.proof.verificationManifest == VERIFICATION_MANIFEST_A,
        state.promoted.completionClaim.claimId == COMPLETION_CLAIM_A,
        state.promoted.completionClaim.runId == state.promoted.proof.runId,
        state.promoted.completionClaim.taskId == state.promoted.proof.taskId,
        state.promoted.completionClaim.attemptId == state.promoted.proof.attemptId,
        state.promoted.completionClaim.taskRevision == state.promoted.proof.taskRevision,
        state.promoted.completionClaim.predecessorClaimId == state.promoted.originalClaimId,
        state.promoted.completionClaim.promotionCorrelation == state.promoted.proof.promotionCorrelation,
        state.promoted.completionClaim.acceptanceManifest == state.promoted.proof.acceptanceManifest,
        state.promoted.completionClaim.integrationReviewManifest == state.promoted.proof.integrationReviewManifest,
        state.promoted.completionClaim.verificationManifest == state.promoted.proof.verificationManifest,
      }

  val completionProofCarriesThreeSealedManifests: bool =
    not(state.promoted.proofPresent)
      or and {
        state.promoted.proof.acceptanceManifest == ACCEPTANCE_MANIFEST_A,
        state.promoted.proof.integrationReviewManifest == INTEGRATION_REVIEW_MANIFEST_A,
        state.promoted.proof.verificationManifest == VERIFICATION_MANIFEST_A,
        not(state.promoted.completionClaimDerived)
          or and {
            state.promoted.completionClaim.acceptanceManifest == state.promoted.proof.acceptanceManifest,
            state.promoted.completionClaim.integrationReviewManifest == state.promoted.proof.integrationReviewManifest,
            state.promoted.completionClaim.verificationManifest == state.promoted.proof.verificationManifest,
          },
      }

  // A request is the ambiguity-crossing effect. Its exact intent must already
  // be in the durable model state.
  val replacementIntentPrecedesRequest: bool =
    state.promoted.replacementRequests == 0 or state.promoted.replacementIntentRecorded

  val deletionIntentPrecedesRequest: bool =
    state.promoted.deleteRequests == 0 or state.promoted.deleteIntentRecorded

  // A second request is permitted only after one fresh read of the owner of the
  // claim. The read count is retained across a lost response/restart.
  val replacementRereadPrecedesRetry: bool =
    state.promoted.replacementRequests <= 1 or state.promoted.replacementReads > 0

  val deletionRereadPrecedesRetry: bool =
    state.promoted.deleteRequests <= 1 or state.promoted.deleteReads > 0

  val completionClaimRequestsAreBounded: bool =
    state.promoted.replacementRequests <= REPLACEMENT_REQUEST_LIMIT

  val completionClaimDeletionRequestsAreBounded: bool =
    state.promoted.deleteRequests <= DELETION_REQUEST_LIMIT

  val completionIntentPrecedesRequest: bool =
    state.promoted.completionRequests == 0 or state.promoted.completionIntentRecorded

  val completionAttemptIntentPrecedesRequest: bool =
    state.promoted.completionRequests <= state.promoted.completionAttemptIntents

  val completionRequestsAreBoundedForIssue61: bool =
    state.promoted.completionRequests <= COMPLETE_TASK_REQUEST_LIMIT

  val completionRetryRequiresExactRequestLookup: bool =
    state.promoted.completionRequests <= state.promoted.completionNotAppliedReads + 1

  val completionLookupRequiresPostLossConfirmation: bool =
    state.promoted.completionConfirmationViolationLookups == 0

  val completionRequestUsesExactPremises: bool =
    state.promoted.completionPremiseViolationCalls == 0

  val completionAcknowledgementIsApplied: bool =
    not(state.promoted.completeTaskAcknowledged)
      or state.promoted.completionOutcome == Applied

  val focusedSuccessRequiresCompletionObservation: bool =
    state.promoted.successSource != PostRequestFocusedSuccess
      or and {
        state.promoted.completionRequests > 0,
        state.promoted.focusedSuccessRecorded,
        or {
          and {
            state.promoted.completeTaskAcknowledged,
            state.promoted.completionOutcome == Applied,
          },
          and {
            not(state.promoted.completeTaskAcknowledged),
            state.promoted.completionOutcome == NoCompletionOutcome,
          },
        },
      }

  val trackerSuccessRequiresFocusedObservation: bool =
    not(state.promoted.trackerSuccessEver) or state.promoted.focusedSuccessRecorded

  // A focused successful lifecycle is authoritative even when another tracker
  // client has already removed or replaced KC. Dalph records success without
  // mutating that absent/foreign claim or turning the human completion into a
  // conflict.
  val humanFocusedSuccessIsAccepted: bool =
    state.promoted.successSource != ExternalFocusedSuccess
      or and {
        state.promoted.focusedSuccessRecorded,
        state.promoted.trackerSuccessEver,
        state.promoted.freshTrackerSuccess,
        state.promoted.trackerObservation == FreshSuccess,
        state.promoted.completionConflict == NoCompletionConflict,
      }

  val dependantReleaseRequiresLaterCompleteGraph: bool =
    not(state.promoted.dependantEligible)
      or and {
        state.promoted.focusedSuccessRecorded,
        state.promoted.completeGraphObservation == GraphReleased,
      }

  val foreignClaimIsNeverMutated: bool = and {
    state.promoted.foreignMutationCount == 0,
    state.promoted.claimState != ForeignClaim
      or state.promoted.lastMutation != ForeignClaimMutation,
  }

  // No later integration session or candidate is allowed after the exact
  // promotion proof has entered this subject-scoped settlement protocol.
  val noReintegration: bool = and {
    state.promoted.reintegrationCount == 0,
    state.reintegrationRequests == 0,
    state.promoted.proof.candidateCommit == CANDIDATE_A,
  }

  // A fresh external success is sticky. Cleanup may wait or fail, but the task
  // never returns to a pre-success integration phase.
  val successfulTaskNeverReopens: bool =
    not(state.promoted.trackerSuccessEver)
      or and {
        successfulPhase(state.promoted.phase),
        not(state.promoted.reopenedAfterSuccess),
      }

  val freshTrackerSuccessPrecedesCompletionClaimDeletion: bool =
    (state.promoted.deleteIntentRecorded or state.promoted.deleteRequests > 0)
      implies and {
        state.promoted.trackerSuccessEver,
        state.promoted.freshTrackerSuccess,
        state.promoted.trackerObservation == FreshSuccess,
        state.promoted.trackerObservationRevision > state.promoted.trackerCompletionRequestRevision,
      }

  val completionClaimDeletionTargetsExactClaim: bool =
    state.promoted.deleteRequests == 0
      or and {
        state.promoted.deleteIntentRecorded,
        state.promoted.lastMutation == CompletionClaimMutation,
      }

  val currentCompletionClaimIsExact: bool =
    not(state.promoted.replacementOutcomeRecorded)
      or state.promoted.currentClaimId == state.promoted.completionClaim.claimId
      or state.promoted.claimState == AbsentClaim
      or state.promoted.claimState == ForeignClaim
      or state.promoted.claimState == UnreadableClaim

  val settledTaskRequiresExactCleanup: bool =
    not(state.promoted.settled)
      or and {
        state.promoted.phase == Settled,
        not(state.promoted.responsibilityHeld),
        state.promoted.trackerSuccessEver,
        state.promoted.freshTrackerSuccess,
        state.promoted.deletionOutcomeRecorded,
        state.promoted.claimState == AbsentClaim,
        state.promoted.currentClaimId == 0,
        state.promoted.deleteIntentRecorded,
      }

  // The A settlement action writes only A. B is intentionally retained to
  // prove subject locality and to keep the Run nonterminal for issue #102.
  val subjectSettlementIsLocal: bool =
    not(state.promoted.settled)
      or and {
        state.unrelated.taskId == TASK_B,
        state.unrelated.responsibilityHeld,
        not(state.unrelated.settled),
      }

  val emptyFrontierDoesNotSettleRetainedResponsibility: bool =
    not(state.frontierEmpty and (state.promoted.responsibilityHeld or state.unrelated.responsibilityHeld))
      or not(state.runTerminated)

  val runTerminationRemainsOwnedByIssue102: bool = not(state.runTerminated)

  // This subject-scoped model never performs the external scheduler action
  // that starts newly eligible dependant work.
  val dependantReleaseBoundaryRemainsExternal: bool = and {
    state.dependantReleases == 0,
  }

  action init: bool = all {
    state' = {
      promoted: {
        taskId: TASK_A,
        attemptId: ATTEMPT_A,
        taskRevision: TASK_REVISION_A,
        originalClaimId: ORIGINAL_CLAIM_A,
        currentClaimId: ORIGINAL_CLAIM_A,
        claimState: OriginalClaim,
        phase: PromotedProof,
        proofPresent: true,
        proof: {
          runId: RUN_ID,
          taskId: TASK_A,
          attemptId: ATTEMPT_A,
          taskRevision: TASK_REVISION_A,
          candidateCommit: CANDIDATE_A,
          expectedTargetHead: EXPECTED_HEAD_A,
          integrationTarget: INTEGRATION_TARGET_A,
          promotionCorrelation: PROMOTION_CORRELATION_A,
          acceptanceManifest: ACCEPTANCE_MANIFEST_A,
          integrationReviewManifest: INTEGRATION_REVIEW_MANIFEST_A,
          verificationManifest: VERIFICATION_MANIFEST_A,
        },
        completionClaimDerived: false,
        completionClaim: {
          claimId: 0,
          runId: 0,
          taskId: 0,
          attemptId: 0,
          taskRevision: 0,
          predecessorClaimId: 0,
          promotionCorrelation: 0,
          acceptanceManifest: 0,
          integrationReviewManifest: 0,
          verificationManifest: 0,
        },
        replacementIntentRecorded: false,
        replacementRequests: 0,
        replacementReads: 0,
        replacementReadBeforeRetry: false,
        replacementOutcomeRecorded: false,
        deleteIntentRecorded: false,
        deleteRequests: 0,
        deleteReads: 0,
        deleteReadBeforeRetry: false,
        deletionOutcomeRecorded: false,
        deletionFailureRecorded: false,
        trackerObservation: NoTrackerObservation,
        trackerCompletionRequestRevision: TRACKER_COMPLETION_REQUEST_REVISION,
        trackerObservationRevision: 0,
        freshTrackerSuccess: false,
        trackerSuccessEver: false,
        focusedSuccessRecorded: false,
        successSource: NoSuccess,
        focusedFactsRecorded: false,
        focusedFactsOpen: false,
        focusedFactsNoBlocker: false,
        completionAncestry: NoCandidateAncestry,
        completionEvidenceRecorded: false,
        completionRequestId: 0,
        completionIntentRecorded: false,
        completionAttemptIntents: 0,
        completionOpenConfirmationRecorded: false,
        completionConfirmationViolationLookups: 0,
        completionRequests: 0,
        completionPremiseViolationCalls: 0,
        completionReads: 0,
        completionNotAppliedReads: 0,
        completionOutcome: NoCompletionOutcome,
        completeTaskAcknowledged: false,
        completionConflict: NoCompletionConflict,
        completeGraphObservation: NoCompleteGraph,
        dependantEligible: false,
        responsibilityHeld: true,
        settled: false,
        foreignMutationCount: 0,
        reintegrationCount: 0,
        lastMutation: NoMutation,
        blockerPresent: false,
        reopenedAfterSuccess: false,
      },
      unrelated: {
        taskId: TASK_B,
        attemptId: ATTEMPT_B,
        taskRevision: TASK_REVISION_B,
        originalClaimId: ORIGINAL_CLAIM_B,
        currentClaimId: ORIGINAL_CLAIM_B,
        claimState: OriginalClaim,
        phase: UnrelatedPending,
        proofPresent: false,
        proof: {
          runId: 0,
          taskId: TASK_B,
          attemptId: ATTEMPT_B,
          taskRevision: TASK_REVISION_B,
          candidateCommit: 0,
          expectedTargetHead: 0,
          integrationTarget: 0,
          promotionCorrelation: 0,
          acceptanceManifest: 0,
          integrationReviewManifest: 0,
          verificationManifest: 0,
        },
        completionClaimDerived: false,
        completionClaim: {
          claimId: 0,
          runId: 0,
          taskId: 0,
          attemptId: 0,
          taskRevision: 0,
          predecessorClaimId: 0,
          promotionCorrelation: 0,
          acceptanceManifest: 0,
          integrationReviewManifest: 0,
          verificationManifest: 0,
        },
        replacementIntentRecorded: false,
        replacementRequests: 0,
        replacementReads: 0,
        replacementReadBeforeRetry: false,
        replacementOutcomeRecorded: false,
        deleteIntentRecorded: false,
        deleteRequests: 0,
        deleteReads: 0,
        deleteReadBeforeRetry: false,
        deletionOutcomeRecorded: false,
        deletionFailureRecorded: false,
        trackerObservation: NoTrackerObservation,
        trackerCompletionRequestRevision: 0,
        trackerObservationRevision: 0,
        freshTrackerSuccess: false,
        trackerSuccessEver: false,
        focusedSuccessRecorded: false,
        successSource: NoSuccess,
        focusedFactsRecorded: false,
        focusedFactsOpen: false,
        focusedFactsNoBlocker: false,
        completionAncestry: NoCandidateAncestry,
        completionEvidenceRecorded: false,
        completionRequestId: 0,
        completionIntentRecorded: false,
        completionAttemptIntents: 0,
        completionOpenConfirmationRecorded: false,
        completionConfirmationViolationLookups: 0,
        completionRequests: 0,
        completionPremiseViolationCalls: 0,
        completionReads: 0,
        completionNotAppliedReads: 0,
        completionOutcome: NoCompletionOutcome,
        completeTaskAcknowledged: false,
        completionConflict: NoCompletionConflict,
        completeGraphObservation: NoCompleteGraph,
        dependantEligible: false,
        responsibilityHeld: true,
        settled: false,
        foreignMutationCount: 0,
        reintegrationCount: 0,
        lastMutation: NoMutation,
        blockerPresent: false,
        reopenedAfterSuccess: false,
      },
      frontierEmpty: false,
      runTerminated: false,
      completeTaskRequests: 0,
      dependantReleases: 0,
      reintegrationRequests: 0,
    }
  }

  action observePostPromotionBlocker: bool = all {
    state.promoted.phase == PromotedProof or state.promoted.phase == CompletionClaimCurrent,
    not(state.promoted.blockerPresent),
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: if (state.promoted.phase == CompletionClaimCurrent) CompletionClaimBlocked else BlockedAfterPromotion,
        blockerPresent: true,
      },
    },
  }

  action observeFreshBlockerClear: bool = all {
    state.promoted.phase == BlockedAfterPromotion or state.promoted.phase == CompletionClaimBlocked,
    state.promoted.blockerPresent,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: if (state.promoted.phase == CompletionClaimBlocked) CompletionClaimCurrent else PromotedProof,
        blockerPresent: false,
      },
    },
  }

  action deriveCompletionClaim: bool = all {
    state.promoted.phase == PromotedProof,
    not(state.promoted.blockerPresent),
    state.promoted.claimState == OriginalClaim,
    promotionProofExact(state.promoted),
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: ReplacementIntentPending,
        completionClaimDerived: true,
        completionClaim: {
          claimId: COMPLETION_CLAIM_A,
          runId: state.promoted.proof.runId,
          taskId: state.promoted.proof.taskId,
          attemptId: state.promoted.proof.attemptId,
          taskRevision: state.promoted.proof.taskRevision,
          predecessorClaimId: state.promoted.originalClaimId,
          promotionCorrelation: state.promoted.proof.promotionCorrelation,
          acceptanceManifest: state.promoted.proof.acceptanceManifest,
          integrationReviewManifest: state.promoted.proof.integrationReviewManifest,
          verificationManifest: state.promoted.proof.verificationManifest,
        },
      },
    },
  }

  action recordCompletionClaimReplacementIntent: bool = all {
    state.promoted.phase == ReplacementIntentPending,
    state.promoted.completionClaimDerived,
    completionClaimExact(state.promoted),
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: ReplacementIntentRecorded,
        replacementIntentRecorded: true,
      },
    },
  }

  action requestCompletionClaimReplacement: bool = all {
    state.promoted.phase == ReplacementIntentRecorded,
    state.promoted.replacementIntentRecorded,
    state.promoted.claimState == OriginalClaim,
    state.promoted.replacementRequests < REPLACEMENT_REQUEST_LIMIT,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: ReplacementRequested,
        replacementRequests: state.promoted.replacementRequests + 1,
        lastMutation: OriginalClaimMutation,
      },
    },
  }

  action observeCompletionClaimReplacement: bool = all {
    state.promoted.phase == ReplacementRequested,
    state.promoted.claimState == OriginalClaim,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionClaimCurrent,
        claimState: CompletionClaim,
        currentClaimId: state.promoted.completionClaim.claimId,
        replacementOutcomeRecorded: true,
      },
    },
  }

  action loseCompletionClaimReplacementResponse: bool = all {
    state.promoted.phase == ReplacementRequested,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: ReplacementResponseLost,
      },
    },
  }

  action reconcileReplacementAsCurrentCompletionClaim: bool = all {
    state.promoted.phase == ReplacementResponseLost,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionClaimCurrent,
        claimState: CompletionClaim,
        currentClaimId: state.promoted.completionClaim.claimId,
        replacementReads: state.promoted.replacementReads + 1,
        replacementReadBeforeRetry: true,
        replacementOutcomeRecorded: true,
      },
    },
  }

  action reconcileReplacementAsOriginalClaim: bool = all {
    state.promoted.phase == ReplacementResponseLost,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase:
          if (state.promoted.replacementRequests < REPLACEMENT_REQUEST_LIMIT)
            ReplacementRetryReady
          else ReplacementExhausted,
        claimState: OriginalClaim,
        currentClaimId: state.promoted.originalClaimId,
        replacementReads: state.promoted.replacementReads + 1,
        replacementReadBeforeRetry: true,
      },
    },
  }

  action reconcileReplacementAsForeignClaim: bool = all {
    state.promoted.phase == ReplacementResponseLost,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: ReplacementWait,
        claimState: ForeignClaim,
        currentClaimId: 999,
        replacementReads: state.promoted.replacementReads + 1,
        replacementReadBeforeRetry: true,
      },
    },
  }

  action reconcileReplacementAsUnreadableClaim: bool = all {
    state.promoted.phase == ReplacementResponseLost,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: ReplacementWait,
        claimState: UnreadableClaim,
        replacementReads: state.promoted.replacementReads + 1,
        replacementReadBeforeRetry: true,
      },
    },
  }

  action retryCompletionClaimReplacement: bool = all {
    state.promoted.phase == ReplacementRetryReady,
    state.promoted.claimState == OriginalClaim,
    state.promoted.replacementReadBeforeRetry,
    state.promoted.replacementRequests < REPLACEMENT_REQUEST_LIMIT,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: ReplacementRequested,
        replacementRequests: state.promoted.replacementRequests + 1,
        lastMutation: OriginalClaimMutation,
      },
    },
  }

  action observeStaleTrackerSuccess: bool = all {
    state.promoted.phase == CompletionClaimCurrent,
    state.promoted.claimState == CompletionClaim,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        trackerObservation: StaleSuccess,
        trackerObservationRevision: STALE_TRACKER_REVISION,
      },
    },
  }

  action observeFocusedCompletionHumanSuccessWithExactClaim: bool = all {
    state.promoted.phase == CompletionIntentRecorded,
    state.promoted.claimState == CompletionClaim,
    state.promoted.completionIntentRecorded,
    state.promoted.focusedFactsRecorded,
    state.promoted.replacementOutcomeRecorded,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: DeleteIntentPending,
        trackerObservation: FreshSuccess,
        trackerObservationRevision: FRESH_TRACKER_REVISION,
        freshTrackerSuccess: true,
        trackerSuccessEver: true,
        focusedSuccessRecorded: true,
        successSource: ExternalFocusedSuccess,
      },
    },
  }

  // Issue #61 first reads the task-local completion facts. This focused read
  // is sufficient for the task's own cleanup and deliberately says nothing
  // about the complete dependant graph.
  action observeFocusedCompletionFacts: bool = all {
    state.promoted.phase == CompletionClaimCurrent,
    state.promoted.claimState == CompletionClaim,
    state.promoted.replacementOutcomeRecorded,
    promotionProofExact(state.promoted),
    completionClaimExact(state.promoted),
    not(state.promoted.blockerPresent),
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionFactsObserved,
        focusedFactsRecorded: true,
        focusedFactsOpen: true,
        focusedFactsNoBlocker: true,
        completionConflict: NoCompletionConflict,
      },
    },
  }

  action observeFocusedCompletionHumanSuccessWithAbsentClaim: bool = all {
    state.promoted.phase == CompletionIntentRecorded,
    state.promoted.completionIntentRecorded,
    state.promoted.focusedFactsRecorded,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: DeleteIntentPending,
        claimState: AbsentClaim,
        currentClaimId: 0,
        trackerObservation: FreshSuccess,
        trackerObservationRevision: FRESH_TRACKER_REVISION,
        freshTrackerSuccess: true,
        trackerSuccessEver: true,
        focusedSuccessRecorded: true,
        successSource: ExternalFocusedSuccess,
        completionConflict: NoCompletionConflict,
      },
    },
  }

  action observeFocusedCompletionHumanSuccessWithForeignClaim: bool = all {
    state.promoted.phase == CompletionIntentRecorded,
    state.promoted.completionIntentRecorded,
    state.promoted.focusedFactsRecorded,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: DeleteIntentPending,
        claimState: ForeignClaim,
        currentClaimId: 999,
        trackerObservation: FreshSuccess,
        trackerObservationRevision: FRESH_TRACKER_REVISION,
        freshTrackerSuccess: true,
        trackerSuccessEver: true,
        focusedSuccessRecorded: true,
        successSource: ExternalFocusedSuccess,
        completionConflict: NoCompletionConflict,
      },
    },
  }

  action observeFocusedCompletionForeignTaskConflict: bool = all {
    state.promoted.phase == CompletionFactsObserved,
    state.promoted.focusedFactsRecorded,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionWait,
        completionConflict: ForeignTask,
      },
    },
  }

  action observeFocusedCompletionRevisionConflict: bool = all {
    state.promoted.phase == CompletionFactsObserved,
    state.promoted.focusedFactsRecorded,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionWait,
        completionConflict: RevisionConflict,
      },
    },
  }

  action observeFocusedCompletionReopenedConflict: bool = all {
    state.promoted.phase == CompletionFactsObserved,
    state.promoted.focusedFactsRecorded,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionWait,
        completionConflict: ReopenedTask,
      },
    },
  }

  action observePromotedCandidateAncestry: bool = all {
    state.promoted.phase == CompletionFactsObserved,
    state.promoted.focusedFactsRecorded,
    state.promoted.focusedFactsOpen,
    state.promoted.focusedFactsNoBlocker,
    state.promoted.completionConflict == NoCompletionConflict,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionAncestryObserved,
        completionAncestry: CandidateAncestor,
      },
    },
  }

  action observePromotedCandidateNotAncestor: bool = all {
    state.promoted.phase == CompletionFactsObserved,
    state.promoted.focusedFactsRecorded,
    state.promoted.completionConflict == NoCompletionConflict,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionWait,
        completionAncestry: CandidateNotAncestor,
      },
    },
  }

  action observePromotedCandidateAncestryUnreadable: bool = all {
    state.promoted.phase == CompletionFactsObserved,
    state.promoted.focusedFactsRecorded,
    state.promoted.completionConflict == NoCompletionConflict,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionWait,
        completionAncestry: UnreadableAncestry,
      },
    },
  }

  action observeCompletionEvidence: bool = all {
    state.promoted.phase == CompletionAncestryObserved,
    state.promoted.completionAncestry == CandidateAncestor,
    promotionProofExact(state.promoted),
    completionClaimExact(state.promoted),
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionEvidenceObserved,
        completionEvidenceRecorded: true,
      },
    },
  }

  action recordCompleteTaskIntent: bool = all {
    state.promoted.phase == CompletionEvidenceObserved,
    state.promoted.completionEvidenceRecorded,
    state.promoted.completionAncestry == CandidateAncestor,
    state.promoted.focusedFactsRecorded,
    state.promoted.focusedFactsOpen,
    state.promoted.focusedFactsNoBlocker,
    state.promoted.completionConflict == NoCompletionConflict,
    promotionProofExact(state.promoted),
    completionClaimExact(state.promoted),
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionIntentRecorded,
        completionIntentRecorded: true,
        completionRequestId: COMPLETION_REQUEST_A,
      },
    },
  }

  action recordCompletionAttemptIntent: bool = all {
    or {
      state.promoted.phase == CompletionIntentRecorded,
      state.promoted.phase == CompletionEvidenceObserved,
    },
    state.promoted.completionIntentRecorded,
    state.promoted.completionAttemptIntents == state.promoted.completionRequests,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionAttemptIntentRecorded,
        completionAttemptIntents: state.promoted.completionAttemptIntents + 1,
      },
    },
  }

  action requestCompleteTask: bool = all {
    state.promoted.phase == CompletionAttemptIntentRecorded,
    state.promoted.completionIntentRecorded,
    state.promoted.completionAttemptIntents >= state.promoted.completionRequests + 1,
    state.promoted.completionRequestId == COMPLETION_REQUEST_A,
    state.promoted.completionRequests < COMPLETE_TASK_REQUEST_LIMIT,
    promotionProofExact(state.promoted),
    completionClaimExact(state.promoted),
    state.promoted.focusedFactsRecorded,
    state.promoted.focusedFactsOpen,
    state.promoted.focusedFactsNoBlocker,
    state.promoted.completionAncestry == CandidateAncestor,
    state.promoted.completionEvidenceRecorded,
    state.promoted.completionConflict == NoCompletionConflict,
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
        completionOutcome: NoCompletionOutcome,
        completeTaskAcknowledged: false,
        lastMutation: CompleteTaskMutation,
      },
      completeTaskRequests: state.completeTaskRequests + 1,
    },
  }

  action observeCompleteTaskAcknowledgement: bool = all {
    state.promoted.phase == CompletionRequested,
    state.promoted.completionRequestId == COMPLETION_REQUEST_A,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionAcknowledged,
        completionOutcome: Applied,
        completeTaskAcknowledged: true,
      },
    },
  }

  action loseCompleteTaskResponse: bool = all {
    state.promoted.phase == CompletionRequested,
    state.promoted.completionRequestId == COMPLETION_REQUEST_A,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionResponseLost,
        completionOpenConfirmationRecorded: false,
      },
    },
  }

  action observeFocusedCompletionOpenAfterLoss: bool = all {
    state.promoted.phase == CompletionResponseLost,
    state.promoted.completionRequestId == COMPLETION_REQUEST_A,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionConfirmationObserved,
        completionOpenConfirmationRecorded: true,
      },
    },
  }

  pure def completionConfirmationViolationLookupsAfterCurrentLookup(subject: SubjectState): int =
    if (subject.phase == CompletionConfirmationObserved and subject.completionOpenConfirmationRecorded)
      subject.completionConfirmationViolationLookups
    else
      subject.completionConfirmationViolationLookups + 1

  action lookupCompletionRequestApplied: bool = all {
    state.promoted.phase == CompletionConfirmationObserved,
    state.promoted.completionOpenConfirmationRecorded,
    state.promoted.completionRequestId == COMPLETION_REQUEST_A,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionAcknowledged,
        completionReads: state.promoted.completionReads + 1,
        completionConfirmationViolationLookups:
          completionConfirmationViolationLookupsAfterCurrentLookup(state.promoted),
        completionOutcome: Applied,
        completeTaskAcknowledged: true,
      },
    },
  }

  action lookupCompletionRequestNotApplied: bool = all {
    state.promoted.phase == CompletionConfirmationObserved,
    state.promoted.completionOpenConfirmationRecorded,
    state.promoted.completionRequestId == COMPLETION_REQUEST_A,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionRetryReady,
        completionReads: state.promoted.completionReads + 1,
        completionConfirmationViolationLookups:
          completionConfirmationViolationLookupsAfterCurrentLookup(state.promoted),
        completionOutcome: NotApplied,
        completionNotAppliedReads: state.promoted.completionNotAppliedReads + 1,
      },
    },
  }

  action lookupCompletionRequestUnreadable: bool = all {
    state.promoted.phase == CompletionConfirmationObserved,
    state.promoted.completionOpenConfirmationRecorded,
    state.promoted.completionRequestId == COMPLETION_REQUEST_A,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionWait,
        completionReads: state.promoted.completionReads + 1,
        completionConfirmationViolationLookups:
          completionConfirmationViolationLookupsAfterCurrentLookup(state.promoted),
        completionOutcome: UnreadableCompletionOutcome,
      },
    },
  }

  action refreshCompletionPremisesForRetry: bool = all {
    state.promoted.phase == CompletionRetryReady,
    state.promoted.completionOutcome == NotApplied,
    state.promoted.completionNotAppliedReads > 0,
    state.promoted.completionRequests < COMPLETE_TASK_REQUEST_LIMIT,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CompletionFactsObserved,
        completionOutcome: NoCompletionOutcome,
        completeTaskAcknowledged: false,
        completionOpenConfirmationRecorded: false,
      },
    },
  }

  action observeFocusedCompletionSuccess: bool = all {
    or {
      and {
        state.promoted.phase == CompletionAcknowledged,
        state.promoted.completionOutcome == Applied,
        state.promoted.completeTaskAcknowledged,
      },
      and {
        state.promoted.phase == CompletionResponseLost,
        state.promoted.completionOutcome == NoCompletionOutcome,
        not(state.promoted.completeTaskAcknowledged),
      },
    },
    state.promoted.claimState == CompletionClaim,
    state.promoted.replacementOutcomeRecorded,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: DeleteIntentPending,
        trackerObservation: FreshSuccess,
        trackerObservationRevision: FRESH_TRACKER_REVISION,
        freshTrackerSuccess: true,
        trackerSuccessEver: true,
        focusedSuccessRecorded: true,
        successSource: PostRequestFocusedSuccess,
      },
    },
  }

  // The complete graph is a later tracker read. It can release a dependant
  // only after the focused task-local success has already been observed.
  action observeLaterCompleteGraphBlocked: bool = all {
    state.promoted.focusedSuccessRecorded,
    state.promoted.trackerSuccessEver,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        completeGraphObservation: GraphBlocked,
        dependantEligible: false,
      },
    },
  }

  action observeLaterCompleteGraphReleased: bool = all {
    state.promoted.focusedSuccessRecorded,
    state.promoted.trackerSuccessEver,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        completeGraphObservation: GraphReleased,
        dependantEligible: true,
      },
    },
  }

  action observeLaterCompleteGraphUnreadable: bool = all {
    state.promoted.focusedSuccessRecorded,
    state.promoted.trackerSuccessEver,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        completeGraphObservation: UnreadableGraph,
        dependantEligible: false,
      },
    },
  }

  action recordCompletionClaimDeletionIntent: bool = all {
    state.promoted.phase == DeleteIntentPending,
    state.promoted.freshTrackerSuccess,
    state.promoted.trackerObservation == FreshSuccess,
    state.promoted.claimState == CompletionClaim,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: DeleteIntentRecorded,
        deleteIntentRecorded: true,
      },
    },
  }

  action requestCompletionClaimDeletion: bool = all {
    state.promoted.phase == DeleteIntentRecorded,
    state.promoted.deleteIntentRecorded,
    state.promoted.freshTrackerSuccess,
    state.promoted.claimState == CompletionClaim,
    state.promoted.deleteRequests < DELETION_REQUEST_LIMIT,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: DeleteRequested,
        deleteRequests: state.promoted.deleteRequests + 1,
        lastMutation: CompletionClaimMutation,
      },
    },
  }

  action observeCompletionClaimDeleted: bool = all {
    state.promoted.phase == DeleteRequested,
    state.promoted.claimState == CompletionClaim,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: DeleteResponseObserved,
        claimState: AbsentClaim,
        currentClaimId: 0,
        deletionOutcomeRecorded: true,
      },
    },
  }

  action loseCompletionClaimDeletionResponse: bool = all {
    state.promoted.phase == DeleteRequested,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: DeleteResponseLost,
      },
    },
  }

  action reconcileDeletionAsAbsent: bool = all {
    state.promoted.phase == DeleteResponseLost,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: DeleteResponseObserved,
        claimState: AbsentClaim,
        currentClaimId: 0,
        deleteReads: state.promoted.deleteReads + 1,
        deleteReadBeforeRetry: true,
        deletionOutcomeRecorded: true,
      },
    },
  }

  action reconcileDeletionAsCurrentCompletionClaim: bool = all {
    state.promoted.phase == DeleteResponseLost,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase:
          if (state.promoted.deleteRequests < DELETION_REQUEST_LIMIT)
            DeleteRetryReady
          else CleanupWait,
        claimState: CompletionClaim,
        currentClaimId: state.promoted.completionClaim.claimId,
        deleteReads: state.promoted.deleteReads + 1,
        deleteReadBeforeRetry: true,
      },
    },
  }

  action reconcileDeletionAsForeignClaim: bool = all {
    state.promoted.phase == DeleteResponseLost,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CleanupWait,
        claimState: ForeignClaim,
        currentClaimId: 998,
        deleteReads: state.promoted.deleteReads + 1,
        deleteReadBeforeRetry: true,
      },
    },
  }

  action reconcileDeletionAsUnreadableClaim: bool = all {
    state.promoted.phase == DeleteResponseLost,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CleanupWait,
        claimState: UnreadableClaim,
        deleteReads: state.promoted.deleteReads + 1,
        deleteReadBeforeRetry: true,
      },
    },
  }

  action retryCompletionClaimDeletion: bool = all {
    state.promoted.phase == DeleteRetryReady,
    state.promoted.claimState == CompletionClaim,
    state.promoted.deleteReadBeforeRetry,
    state.promoted.deleteRequests < DELETION_REQUEST_LIMIT,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: DeleteRequested,
        deleteRequests: state.promoted.deleteRequests + 1,
        lastMutation: CompletionClaimMutation,
      },
    },
  }

  // A definite failure leaves the fresh success and exact cleanup obligation
  // visible. It is not a reason to reopen or reintegrate the task.
  action rejectCompletionClaimDeletion: bool = all {
    state.promoted.phase == DeleteRequested,
    state.promoted.claimState == CompletionClaim,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: CleanupWait,
        deletionFailureRecorded: true,
      },
    },
  }

  action settlePromotedTask: bool = all {
    state.promoted.phase == DeleteResponseObserved,
    state.promoted.claimState == AbsentClaim,
    state.promoted.freshTrackerSuccess,
    state.promoted.deletionOutcomeRecorded,
    state' = {
      ...state,
      promoted: {
        ...state.promoted,
        phase: Settled,
        responsibilityHeld: false,
        settled: true,
      },
    },
  }

  action markEmptyFrontier: bool = all {
    not(state.frontierEmpty),
    state.promoted.responsibilityHeld or state.unrelated.responsibilityHeld,
    state' = { ...state, frontierEmpty: true },
  }

  action step: bool = any {
    observePostPromotionBlocker,
    observeFreshBlockerClear,
    deriveCompletionClaim,
    recordCompletionClaimReplacementIntent,
    requestCompletionClaimReplacement,
    observeCompletionClaimReplacement,
    loseCompletionClaimReplacementResponse,
    reconcileReplacementAsCurrentCompletionClaim,
    reconcileReplacementAsOriginalClaim,
    reconcileReplacementAsForeignClaim,
    reconcileReplacementAsUnreadableClaim,
    retryCompletionClaimReplacement,
    observeStaleTrackerSuccess,
    observeFocusedCompletionHumanSuccessWithExactClaim,
    observeFocusedCompletionFacts,
    observeFocusedCompletionHumanSuccessWithAbsentClaim,
    observeFocusedCompletionHumanSuccessWithForeignClaim,
    observeFocusedCompletionForeignTaskConflict,
    observeFocusedCompletionRevisionConflict,
    observeFocusedCompletionReopenedConflict,
    observePromotedCandidateAncestry,
    observePromotedCandidateNotAncestor,
    observePromotedCandidateAncestryUnreadable,
    observeCompletionEvidence,
    recordCompleteTaskIntent,
    recordCompletionAttemptIntent,
    requestCompleteTask,
    observeCompleteTaskAcknowledgement,
    loseCompleteTaskResponse,
    observeFocusedCompletionOpenAfterLoss,
    lookupCompletionRequestApplied,
    lookupCompletionRequestNotApplied,
    lookupCompletionRequestUnreadable,
    refreshCompletionPremisesForRetry,
    observeFocusedCompletionSuccess,
    observeLaterCompleteGraphBlocked,
    observeLaterCompleteGraphReleased,
    observeLaterCompleteGraphUnreadable,
    recordCompletionClaimDeletionIntent,
    requestCompletionClaimDeletion,
    observeCompletionClaimDeleted,
    loseCompletionClaimDeletionResponse,
    reconcileDeletionAsAbsent,
    reconcileDeletionAsCurrentCompletionClaim,
    reconcileDeletionAsForeignClaim,
    reconcileDeletionAsUnreadableClaim,
    retryCompletionClaimDeletion,
    rejectCompletionClaimDeletion,
    settlePromotedTask,
    markEmptyFrontier,
  }
}
