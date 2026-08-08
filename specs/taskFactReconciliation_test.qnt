module taskFactReconciliationTest {
  import taskFactReconciliation.* from "./taskFactReconciliation"

  run changedInstructionsExposeChoicesAfterSafeSuspensionTest = {
    init
      .then(observeSpecificationChange)
      .then(reportSafelySuspended)
      .expect(specificationChoicesReached and changedFactsPreserveWip)
  }

  run lifecycleCloseReopenPreservesAttemptTest = {
    init
      .then(observeLifecycleClosure)
      .then(reportSafelySuspended)
      .then(observeFreshLifecycleReopen)
      .expect(state.decision == ContinueWork and changedFactsPreserveWip)
  }

  run membershipLossWaitsAfterSafeSuspensionTest = {
    init
      .then(observeMembershipLoss)
      .then(reportSafelySuspended)
      .expect(membershipWaitReached and changedFactsPreserveWip)
  }

  run incompleteReadCannotProveMembershipLossTest = {
    init
      .then(observeIncompleteMembershipRead)
      .expect(state.decision == ContinueWork and state.constraint == NoConstraint)
  }

  run externalSuccessIsFinalWithoutDuplicateDeliveryTest = {
    init
      .then(observeExternalSuccess)
      .then(reportSafelySuspended)
      .then(releaseExactClaim)
      .expect(
        externalSuccessSettledReached
          and externalSuccessPreventsDuplicateDelivery
          and changedFactsPreserveWip
      )
  }

  run foreignClaimStopsOnlyATest = {
    init
      .then(observeForeignClaim)
      .then(reportSafelySuspended)
      .then(applyForeignClaimReacquisitionDirection)
      .then(rejectForeignClaimReacquisition)
      .then(selectIndependentTask)
      .expect(
        foreignClaimWaitReached
          and foreignClaimIsNeverChanged
          and claimConstraintPreservesIndependentEligibility
          and state.independentTaskSelected
      )
  }

  run missingClaimRequiresAppliedDirectionTest = {
    init
      .then(observeMissingClaim)
      .then(reportSafelySuspended)
      .then(selectIndependentTask)
      .expect(
        missingClaimWaitReached
          and not(state.replacementIntentRecorded)
          and claimConstraintPreservesIndependentEligibility
          and state.independentTaskSelected
      )
      .then(applyMissingClaimReacquisitionDirection)
      .then(planReplacementClaim)
      .then(observeExactReplacementClaim)
      .expect(
        replacementClaimObserved
          and replacementClaimRequiresDirectionAndIntent
          and replacementClaimIdentityIsFresh
      )
  }

  run unreadableClaimCannotAuthorizeProgressOrLossTest = {
    init
      .then(observeUnreadableClaim)
      .then(reportSafelySuspended)
      .then(selectIndependentTask)
      .expect(
        unreadableClaimWaitReached
          and unreadableClaimCannotAuthorizeReplacement
          and state.exactClaimHeld
          and claimConstraintPreservesIndependentEligibility
          and state.independentTaskSelected
      )
  }
}
