module gitReconciliationTest {
  import gitReconciliation.* from "./gitReconciliation"

  run compatibleAdvanceContinuesTest = {
    init
      .then(observeCompatibleTargetAdvance)
      .expect(compatibleTargetAdvanceDoesNotConstrainAttempt and state.decision == ContinueAttempt)
  }

  run incompatibleRewriteSuspendsOnlyAffectedAttemptTest = {
    init
      .then(observeIncompatibleTargetRewrite)
      .then(reportSafelySuspended)
      .then(selectIndependentTask)
      .then(awaitOwnedFollowup)
      .expect(
        targetRewriteWaitReached
          and incompatibleRewriteConstrainsOnlyAffectedAttempt
          and gitConstraintPreservesIndependentEligibility
          and state.independentTaskSelected
      )
  }

  run lostWorktreePreservesEvidenceAndNeverRepairsTest = {
    init
      .then(observeLostWorktree)
      .then(reportSafelySuspended)
      .then(selectIndependentTask)
      .expect(
        lostWorktreeWaitReached
          and lostWorktreeNeverAuthorizesRepair
          and state.claimPreserved
          and state.worktreePreserved
          and state.evidencePreserved
          and state.independentTaskSelected
      )
  }

  run registrationConflictRemainsDistinctAndNeverRepairsTest = {
    init
      .then(observeRegistrationConflict)
      .then(reportSafelySuspended)
      .expect(
        registrationConflictWaitReached
          and registrationConflictNeverAuthorizesRepair
          and state.constraint == RegistrationConflictConstraint
      )
  }

  run missingResultIsRejectedWithWorktreePreservedTest = {
    init
      .then(observeMissingResultCommit)
      .expect(missingResultRejectedReached and rejectedResultPreservesWorktree)
  }

  run nonDescendantResultIsRejectedWithWorktreePreservedTest = {
    init
      .then(observeNonDescendantResultCommit)
      .expect(nonDescendantResultRejectedReached and rejectedResultPreservesWorktree)
  }

  run exactVerifiedPromotionUsesCompareAndSetTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeExactExpectedTargetWithVerifiedCandidate)
      .expect(exactCompareAndSetReached and promotionRequiresExactExpectedHead)
  }

  run staleTargetReconcilesWithoutOverwriteTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeStaleTargetAfterVerification)
      .expect(staleTargetReconciliationReached and staleTargetNeverOverwrites)
  }

  run ambiguousTargetRequiresRereadTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeAmbiguousTargetAfterVerification)
      .expect(ambiguousTargetRereadReached and ambiguousTargetNeverPromotes)
  }

  run unverifiedCandidateCannotPromoteTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeExactTargetWithUnverifiedCandidate)
      .expect(unverifiedCandidateRejectionReached and unverifiedCandidateNeverPromotes)
  }

  run prePromotionBlockerPreservesCandidateAndReleasesTargetTest = {
    init
      .then(observePrePromotionDependencyBlocker)
      .then(selectIndependentTask)
      .expect(
        prePromotionBlockerPreservesCandidate
          and prePromotionBlockerReleasesTarget
          and state.independentTaskSelected
          and state.decision == GitConstraintWait
      )
  }

  run prePromotionBlockerRecoveryPreservesCandidateAndEmptyTargetTest = {
    init
      .then(observePrePromotionDependencyBlocker)
      .then(reopenPrePromotionBlockerAfterRestart)
      .expect(prePromotionBlockerPreservesCandidate and prePromotionBlockerReleasesTarget)
  }

  run prePromotionClearRereadsAndSupersedesBeforeOneSuccessorTest = {
    init
      .then(recordUnrelatedSessionSupersession)
      .then(observePrePromotionDependencyBlocker)
      .then(clearPrePromotionDependencyBlocker)
      .then(observeFreshTargetAfterPrePromotionBlocker)
      .then(recordIntegrationSessionSupersession)
      .then(startOneSuccessorCandidate)
      .expect(
        state.successorStarted
          and state.successorOrdinal == 1
          and successorIdentityUsesOwnSessionChain
          and oneSuccessorRequiresDurableSupersession
      )
  }

  run postPromotionBlockerPreservesProofAndWaitsTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeExactExpectedTargetWithVerifiedCandidate)
      .then(observePostPromotionDependencyBlocker)
      .expect(postPromotionBlockerPreservesProof and postPromotionBlockerNeverRollsBack and state.decision == GitConstraintWait)
  }

  run clearedPromotionRequiresFreshAncestryAndNeverReintegratesTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeExactExpectedTargetWithVerifiedCandidate)
      .then(observePostPromotionDependencyBlocker)
      .then(clearPostPromotionDependencyBlocker)
      .then(observeFreshPromotedCandidateAncestry)
      .then(completeAfterPromotedCandidateAncestry)
      .expect(clearedPromotionRequiresFreshAncestry and clearedPromotionNeverReintegrates)
  }

  run incompleteTrackerFactsReleaseTargetWithoutTransitionTest = {
    init
      .then(observeIncompleteTrackerFacts)
      .expect(incompleteFactsReleaseTarget and state.decision == GitConstraintWait)
  }

  run completionRacePreservesAcceptedCompletionAndDerivedWarningTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeExactExpectedTargetWithVerifiedCandidate)
      .then(observePostPromotionDependencyBlocker)
      .then(clearPostPromotionDependencyBlocker)
      .then(observeFreshPromotedCandidateAncestry)
      .then(completeAfterPromotedCandidateAncestry)
      .then(acceptCompletionAcrossPrerequisiteRace)
      .expect(completionRacePreservesAcceptedCompletion and completionWarningIsDerivedOnly)
  }
}
