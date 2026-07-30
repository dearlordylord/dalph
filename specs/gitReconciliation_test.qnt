module gitReconciliationTest {
  import gitReconciliation.* from "./gitReconciliation"

  run compatibleAdvanceContinues = {
    init
      .then(observeCompatibleTargetAdvance)
      .expect(compatibleTargetAdvanceDoesNotConstrainAttempt and state.decision == ContinueAttempt)
  }

  run incompatibleRewriteSuspendsOnlyAffectedAttempt = {
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

  run lostWorktreePreservesEvidenceAndNeverRepairs = {
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

  run registrationConflictRemainsDistinctAndNeverRepairs = {
    init
      .then(observeRegistrationConflict)
      .then(reportSafelySuspended)
      .expect(
        registrationConflictWaitReached
          and registrationConflictNeverAuthorizesRepair
          and state.constraint == RegistrationConflictConstraint
      )
  }

  run missingResultIsRejectedWithWorktreePreserved = {
    init
      .then(observeMissingResultCommit)
      .expect(missingResultRejectedReached and rejectedResultPreservesWorktree)
  }

  run nonDescendantResultIsRejectedWithWorktreePreserved = {
    init
      .then(observeNonDescendantResultCommit)
      .expect(nonDescendantResultRejectedReached and rejectedResultPreservesWorktree)
  }

  run exactVerifiedPromotionUsesCompareAndSet = {
    init
      .then(observeEligibleResultCommit)
      .then(observeExactExpectedTargetWithVerifiedCandidate)
      .expect(exactCompareAndSetReached and promotionRequiresExactExpectedHead)
  }

  run staleTargetReconcilesWithoutOverwrite = {
    init
      .then(observeEligibleResultCommit)
      .then(observeStaleTargetAfterVerification)
      .expect(staleTargetReconciliationReached and staleTargetNeverOverwrites)
  }

  run ambiguousTargetRequiresReread = {
    init
      .then(observeEligibleResultCommit)
      .then(observeAmbiguousTargetAfterVerification)
      .expect(ambiguousTargetRereadReached and ambiguousTargetNeverPromotes)
  }

  run unverifiedCandidateCannotPromote = {
    init
      .then(observeEligibleResultCommit)
      .then(observeExactTargetWithUnverifiedCandidate)
      .expect(unverifiedCandidateRejectionReached and unverifiedCandidateNeverPromotes)
  }
}
