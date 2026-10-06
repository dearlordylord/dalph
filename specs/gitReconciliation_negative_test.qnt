// Mutation profile proving the safety properties reject the forbidden
// repair, evidence-discard, and stale-overwrite implementations they govern.
module gitReconciliationNegativeTest {
  import gitReconciliation.* from "./gitReconciliation"

  action authorizeForbiddenWorktreeRepair: bool = all {
    state.constraint == WorktreeLostConstraint,
    state' = { ...state, repairAuthorized: true },
  }

  action discardRejectedResultEvidence: bool = all {
    state.decision == ResultCommitRejected,
    state' = { ...state, worktreePreserved: false, evidencePreserved: false },
  }

  action overwriteStaleTarget: bool = all {
    state.decision == ReconcileCandidateFromCurrentTarget,
    state' = { ...state, overwriteAuthorized: true },
  }

  action dropCandidateDuringPrePromotionBlocker: bool = all {
    state.trackerBlocker == BeforePromotionBlocker,
    state' = { ...state, candidatePreserved: false },
  }

  action retainTargetDuringTrackerBlocker: bool = all {
    state.trackerBlocker != NoTrackerBlocker,
    state' = { ...state, positionHeld: true },
  }

  action promoteWhilePostPromotionBlockerWaits: bool = all {
    state.trackerBlocker == AfterPromotionBlocker,
    state' = { ...state, reintegrationAuthorized: true },
  }

  action startSuccessorWithoutSupersession: bool = all {
    not(state.sessionSuperseded),
    state' = { ...state, successorStarted: true },
  }

  action completeWithoutFreshPromotedAncestry: bool = all {
    state.promotionProof,
    not(state.promotedCandidateAncestryProven),
    state' = { ...state, completionAuthorized: true },
  }

  action completeWhilePostPromotionBlockerWaits: bool = all {
    state.trackerBlocker == AfterPromotionBlocker,
    state' = { ...state, completionAuthorized: true },
  }

  action reintegrateAfterPromotion: bool = all {
    state.promotionProof,
    state' = { ...state, reintegrationAuthorized: true },
  }

  action inventCompletionWarning: bool = all {
    not(state.completionAccepted),
    state' = { ...state, completionWarning: true },
  }

  action authorizeConstrainedCompatibleAdvance: bool = all {
    state.compatibleAdvanceObserved,
    state' = { ...state, constraint: TargetRewriteConstraint },
  }

  action restorePromotionAuthorizationAfterAmbiguousRead: bool = all {
    state.decision == RereadTargetBeforePromotion,
    state' = { ...state, compareAndSetAuthorized: true },
  }

  run unsafeRepairIsDetectedTest = {
    init
      .then(observeLostWorktree)
      .then(authorizeForbiddenWorktreeRepair)
      .expect(not(lostWorktreeNeverAuthorizesRepair))
  }

  run rejectedResultDiscardIsDetectedTest = {
    init
      .then(observeMissingResultCommit)
      .then(discardRejectedResultEvidence)
      .expect(not(rejectedResultPreservesWorktree))
  }

  run staleOverwriteIsDetectedTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeStaleTargetAfterGitQualification)
      .then(overwriteStaleTarget)
      .expect(not(staleTargetNeverOverwrites))
  }

  run prePromotionCandidateDropIsDetectedTest = {
    init
      .then(observePrePromotionDependencyBlocker)
      .then(dropCandidateDuringPrePromotionBlocker)
      .expect(not(prePromotionBlockerPreservesCandidate))
  }

  run trackerBlockerTargetRetentionIsDetectedTest = {
    init
      .then(observePrePromotionDependencyBlocker)
      .then(retainTargetDuringTrackerBlocker)
      .expect(not(prePromotionBlockerReleasesTarget))
  }

  run postPromotionRollbackIsDetectedTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeExactExpectedTargetWithGitQualifiedCandidate)
      .then(observePostPromotionDependencyBlocker)
      .then(promoteWhilePostPromotionBlockerWaits)
      .expect(not(postPromotionBlockerNeverRollsBack))
  }

  run successorWithoutDurableSupersessionIsDetectedTest = {
    init
      .then(startSuccessorWithoutSupersession)
      .expect(not(oneSuccessorRequiresDurableSupersession))
  }

  run duplicatePriorSupersessionIsDetectedTest = {
    init
      .then(observePrePromotionDependencyBlocker)
      .then(clearPrePromotionDependencyBlocker)
      .then(observeFreshTargetAfterPrePromotionBlocker)
      .then(recordIntegrationSessionSupersession)
      .then(recordDuplicatePriorSessionSupersession)
      .expect(not(onePriorSessionHasOneSupersession))
  }

  run unrelatedTaskOrdinalPerturbationIsDetectedTest = {
    init
      .then(recordUnrelatedSessionSupersession)
      .then(observePrePromotionDependencyBlocker)
      .then(clearPrePromotionDependencyBlocker)
      .then(observeFreshTargetAfterPrePromotionBlocker)
      .then(recordIntegrationSessionSupersession)
      .then(startSuccessorUsingUnrelatedOrdinal)
      .expect(not(successorIdentityUsesOwnSessionChain))
  }

  run completionWithoutFreshAncestryIsDetectedTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeExactExpectedTargetWithGitQualifiedCandidate)
      .then(completeWithoutFreshPromotedAncestry)
      .expect(not(clearedPromotionRequiresFreshAncestry))
  }

  run completionDuringPostPromotionBlockerIsDetectedTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeExactExpectedTargetWithGitQualifiedCandidate)
      .then(observePostPromotionDependencyBlocker)
      .then(completeWhilePostPromotionBlockerWaits)
      .expect(not(clearedPromotionRequiresFreshAncestry))
  }

  run reintegrationAfterPromotionIsDetectedTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeExactExpectedTargetWithGitQualifiedCandidate)
      .then(reintegrateAfterPromotion)
      .expect(not(clearedPromotionNeverReintegrates))
  }

  run completionWarningWithoutAcceptedCompletionIsDetectedTest = {
    init
      .then(inventCompletionWarning)
      .expect(not(completionWarningIsDerivedOnly))
  }

  run constrainedCompatibleAdvanceIsDetectedTest = {
    init
      .then(observeCompatibleTargetAdvance)
      .then(authorizeConstrainedCompatibleAdvance)
      .expect(not(compatibleTargetAdvanceDoesNotConstrainAttempt))
  }

  run stalePromotionAuthorizationAfterAmbiguousReadIsDetectedTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeExactExpectedTargetWithGitQualifiedCandidate)
      .then(observePostPromotionDependencyBlocker)
      .then(clearPostPromotionDependencyBlocker)
      .then(restorePromotionAuthorizationAfterAmbiguousRead)
      .expect(not(ambiguousTargetNeverPromotes))
  }

  action readSelectionWithoutIntent: bool = all {
    state.baseSelection == NoBaseSelection,
    state' = { ...state, baseSelection: BaseSelectionReadCalled(baseEvidenceFor(ExactBaseRead, Head1)),
      baseReadCalledWithoutIntent: true },
  }
  action acceptUnqualifiedSelection(readCase: BaseReadCase): bool = all {
    state.baseSelection == BaseSelectionReadCalled(baseEvidenceFor(readCase, Head1)),
    state' = { ...state, baseSelection: QualifiedBaseObserved(baseEvidenceFor(readCase, Head1)) },
  }
  action replaceSelectedHeadAtPlanning: bool = all {
    state.baseSelection == QualifiedBaseObserved(baseEvidenceFor(ExactBaseRead, Head1)),
    state' = { ...state, baseSelection: BasePlanRecorded({
      observation: baseEvidenceFor(ExactBaseRead, Head1), plannedBase: Head2,
    }) },
  }
  run missingBaseIntentTurnsInvariantRedTest = init.then(readSelectionWithoutIntent)
    .expect(not(baseSelectionReadsRequireIntent))
  run eachUnqualifiedAuthorityTurnsInvariantRedTest = {
    nondet readCase = BASE_READ_CASES.exclude(Set(ExactBaseRead)).oneOf()
    init.then(recordBaseSelectionIntent).then(callBaseSelectionRead(readCase)).then(acceptUnqualifiedSelection(readCase))
      .expect(not(qualifiedBaseRequiresExactAuthority))
  }
  run rewrittenSelectedHeadTurnsInvariantRedTest = init.then(recordBaseSelectionIntent)
    .then(callBaseSelectionRead(ExactBaseRead)).then(acceptQualifiedBaseSelection).then(advanceBaseTargetHead)
    .then(replaceSelectedHeadAtPlanning).expect(not(basePlanUsesObservedHead))
  run retryingQualifiedSelectionBreaksImmutabilityTest = init.then(recordBaseSelectionIntent)
    .then(callBaseSelectionRead(ExactBaseRead)).then(acceptQualifiedBaseSelection)
    .then(unsafeRetryQualifiedBase).expect(not(qualifiedSelectionIsNeverRetried))
  run retryBeforeTrackerConfirmationBreaksAuthorityTest = init.then(recordBaseSelectionIntent)
    .then(callBaseSelectionRead(MissingExecutionObject)).then(refuseBaseSelection)
    .then(requestExplicitBaseRetry).then(unsafeRetryWithoutTrackerFacts)
    .expect(not(retryReadHasExplicitTrackerAuthority))
  action callSuccessorWithoutNewIntent: bool = all {
    state.baseSelection == BaseRetrySpecificationConfirmed,
    state' = { ...state, baseSelection: BaseSelectionReadCalled(baseEvidenceFor(ExactBaseRead, Head1)),
      baseReadCalledWithoutIntent: not(state.baseIntentAccepted) },
  }
  run successorReadWithoutOwnIntentIsDetectedTest = init.then(recordBaseSelectionIntent)
    .then(callBaseSelectionRead(MissingExecutionObject)).then(refuseBaseSelection)
    .then(requestExplicitBaseRetry).then(confirmRetryGraph).then(confirmRetryExactClaim)
    .then(confirmRetryUnchangedSpecification).then(callSuccessorWithoutNewIntent)
    .expect(not(baseSelectionReadsRequireIntent))
}
