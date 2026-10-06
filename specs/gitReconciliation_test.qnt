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

  run exactGitQualifiedPromotionUsesCompareAndSetTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeExactExpectedTargetWithGitQualifiedCandidate)
      .expect(exactCompareAndSetReached and promotionRequiresExactExpectedHead)
  }

  run staleTargetReconcilesWithoutOverwriteTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeStaleTargetAfterGitQualification)
      .expect(staleTargetReconciliationReached and staleTargetNeverOverwrites)
  }

  run ambiguousTargetRequiresRereadTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeAmbiguousTargetAfterGitQualification)
      .expect(ambiguousTargetRereadReached and ambiguousTargetNeverPromotes)
  }

  run unqualifiedCandidateCannotPromoteTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeExactTargetWithUnqualifiedCandidate)
      .expect(unqualifiedCandidateRejectionReached and unqualifiedCandidateNeverPromotes)
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
      .then(observeExactExpectedTargetWithGitQualifiedCandidate)
      .then(observePostPromotionDependencyBlocker)
      .expect(postPromotionBlockerPreservesProof and postPromotionBlockerNeverRollsBack and state.decision == GitConstraintWait)
  }

  run clearedPromotionRequiresFreshAncestryAndNeverReintegratesTest = {
    init
      .then(observeEligibleResultCommit)
      .then(observeExactExpectedTargetWithGitQualifiedCandidate)
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
      .then(observeExactExpectedTargetWithGitQualifiedCandidate)
      .then(observePostPromotionDependencyBlocker)
      .then(clearPostPromotionDependencyBlocker)
      .then(observeFreshPromotedCandidateAncestry)
      .then(completeAfterPromotedCandidateAncestry)
      .then(acceptCompletionAcrossPrerequisiteRace)
      .expect(completionRacePreservesAcceptedCompletion and completionWarningIsDerivedOnly)
  }

  run baseReadRequiresJournalIntentTest = init.then(callBaseSelectionRead(ExactBaseRead).fail())
  run selectedBaseRequiresObservationTest = init.then(recordBaseSelectionIntent)
    .then(callBaseSelectionRead(ExactBaseRead)).then(recordSelectedBasePlan.fail())
  run selectedBaseRemainsOriginalAfterTargetAdvancesTest = init.then(recordBaseSelectionIntent)
    .then(callBaseSelectionRead(ExactBaseRead)).then(advanceBaseTargetHead)
    .then(acceptQualifiedBaseSelection).then(recordSelectedBasePlan)
    .expect(and { baseSelectionReadsRequireIntent, qualifiedBaseRequiresExactAuthority,
      basePlanUsesObservedHead, basePlanPreservedAfterHeadAdvanceReached })
  run laterSelectionUsesLaterQualifiedHeadTest = init.then(advanceBaseTargetHead)
    .then(recordBaseSelectionIntent).then(callBaseSelectionRead(ExactBaseRead))
    .then(acceptQualifiedBaseSelection).then(recordSelectedBasePlan)
    .expect(state.baseSelection == BasePlanRecorded({
      observation: baseEvidenceFor(ExactBaseRead, Head2), plannedBase: Head2,
    }))
  run eachExactAuthorityFailureRefusesSelectionTest = {
    nondet readCase = BASE_READ_CASES.exclude(Set(ExactBaseRead)).oneOf()
    init.then(recordBaseSelectionIntent).then(callBaseSelectionRead(readCase)).then(refuseBaseSelection)
      .expect(and { baseSelectionRefusedReached, qualifiedBaseRequiresExactAuthority,
        state.baseSelection == BaseSelectionRefused(baseRefusalFor(baseEvidenceFor(readCase, Head1))) })
      .then(recordSelectedBasePlan.fail())
  }
  run explicitRetryRevalidatesAllTrackerAuthorityTest = init.then(recordBaseSelectionIntent)
    .then(callBaseSelectionRead(MissingExecutionObject)).then(refuseBaseSelection)
    .then(automaticBaseRetryWake)
    .then(requestExplicitBaseRetry)
    .then(confirmRetryGraph)
    .then(confirmRetryExactClaim)
    .then(confirmRetryUnchangedSpecification).then(recordBaseSelectionIntent)
    .then(callBaseSelectionRead(ExactBaseRead)).then(acceptQualifiedBaseSelection)
    .then(recordSelectedBasePlan)
    .expect(basePlanUsesObservedHead)
  run explicitRetryCannotSkipTrackerChecksTest = init.then(recordBaseSelectionIntent)
    .then(callBaseSelectionRead(MissingExecutionObject)).then(refuseBaseSelection)
    .then(requestExplicitBaseRetry).then(recordBaseSelectionIntent.fail())
  run qualifiedSelectionCannotBeRetriedTest = init.then(recordBaseSelectionIntent)
    .then(callBaseSelectionRead(ExactBaseRead)).then(acceptQualifiedBaseSelection)
    .then(requestExplicitBaseRetry.fail())
  run pendingReadCannotBeRetriedTest = init.then(recordBaseSelectionIntent)
    .then(requestExplicitBaseRetry.fail())
  run explicitRetryRequiresItsOwnIntentTest = init.then(recordBaseSelectionIntent)
    .then(callBaseSelectionRead(MissingExecutionObject)).then(refuseBaseSelection)
    .then(requestExplicitBaseRetry).then(confirmRetryGraph).then(confirmRetryExactClaim)
    .then(confirmRetryUnchangedSpecification).expect(not(state.baseIntentAccepted))
    .then(callBaseSelectionRead(ExactBaseRead).fail())
}
