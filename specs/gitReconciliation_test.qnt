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
}
