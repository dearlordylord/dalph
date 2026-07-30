module taskFactReconciliationTest {
  import taskFactReconciliation.* from "./taskFactReconciliation"

  run changedInstructionsExposeChoicesAfterSafeSuspension = {
    init
      .then(observeSpecificationChange)
      .then(reportSafelySuspended)
      .expect(specificationChoicesReached and changedFactsPreserveWip)
  }

  run lifecycleCloseReopenPreservesAttempt = {
    init
      .then(observeLifecycleClosure)
      .then(reportSafelySuspended)
      .then(observeFreshLifecycleReopen)
      .expect(state.decision == ContinueWork and changedFactsPreserveWip)
  }

  run membershipLossWaitsAfterSafeSuspension = {
    init
      .then(observeMembershipLoss)
      .then(reportSafelySuspended)
      .expect(membershipWaitReached and changedFactsPreserveWip)
  }

  run incompleteReadCannotProveMembershipLoss = {
    init
      .then(observeIncompleteMembershipRead)
      .expect(state.decision == ContinueWork and state.constraint == NoConstraint)
  }

  run externalSuccessIsFinalWithoutDuplicateDelivery = {
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

  run foreignClaimStopsOnlyA = {
    init
      .then(observeForeignClaim)
      .then(reportSafelySuspended)
      .then(recordForeignClaimReacquisitionCommand)
      .then(rejectForeignClaimReacquisition)
      .then(selectIndependentTask)
      .expect(
        foreignClaimWaitReached
          and foreignClaimIsNeverChanged
          and claimConstraintPreservesIndependentEligibility
          and state.independentTaskSelected
      )
  }

  run missingClaimRequiresCommand = {
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
      .then(recordMissingClaimReacquisitionCommand)
      .then(planReplacementClaim)
      .then(observeExactReplacementClaim)
      .expect(
        replacementClaimObserved
          and replacementClaimRequiresCommandAndIntent
          and replacementClaimIdentityIsFresh
      )
  }

  run unreadableClaimCannotAuthorizeProgressOrLoss = {
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
