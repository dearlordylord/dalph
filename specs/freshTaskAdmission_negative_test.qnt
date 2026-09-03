// Deliberately illegal transitions prove each safety family can turn red.
module freshTaskAdmissionNegativeTest {
  import freshTaskAdmission.* from "./freshTaskAdmission"

  action admitOutsideTaskPastCapacity: bool = all {
    occupiedCount(state) == 3,
    state.admission.get(TaskD) == Unoccupied,
    state' = {
      ...state,
      admission: state.admission.put(TaskD, FreshEntryReserved),
      trace: {
        ...state.trace,
        entered: state.trace.entered.put(TaskD, true),
        admissionCapacity: state.trace.admissionCapacity.put(TaskD, 3),
        admissionOrdinal: state.trace.admissionOrdinal.put(TaskD, 4),
      },
    },
  }

  action enterOutOfStableOrder: bool = all {
    state.admission.get(TaskC) == Unoccupied,
    state' = {
      ...state,
      admission: state.admission.put(TaskC, FreshEntryReserved),
      trace: {
        ...state.trace,
        entered: state.trace.entered.put(TaskC, true),
        admissionCapacity: state.trace.admissionCapacity.put(TaskC, state.capacity),
        admissionOrdinal: state.trace.admissionOrdinal.put(TaskC, 1),
      },
    },
  }

  action callClaimWithoutAcceptedIntent: bool = {
    nondet task = TASKS.oneOf()
    all {
      not(state.trace.claimIntentAccepted.get(task)),
      state' = { ...state, trace: { ...state.trace, claimCalled: state.trace.claimCalled.put(task, true) } },
    }
  }

  action ownClaimWithoutClaimCall: bool = all {
    state' = { ...state, trace: { ...state.trace, claimOwned: state.trace.claimOwned.put(TaskA, true) } },
  }
  action readSpecificationWithoutOwnedClaim: bool = all {
    state' = { ...state, trace: { ...state.trace, specificationRead: state.trace.specificationRead.put(TaskA, true) } },
  }
  action recordPlanWithoutSpecification: bool = all {
    state' = { ...state, trace: { ...state.trace, planRecorded: state.trace.planRecorded.put(TaskA, true) } },
  }
  action callWorktreeWithoutPlan: bool = all {
    state' = { ...state, trace: { ...state.trace, worktreeCalled: state.trace.worktreeCalled.put(TaskA, true) } },
  }
  action beginResponsibilityWithoutWorktree: bool = all {
    state' = { ...state, trace: { ...state.trace, responsibilityBegan: state.trace.responsibilityBegan.put(TaskA, true) } },
  }
  action beginResponsibilityWithForeignWorktreeEvidence: bool = all {
    state' = {
      ...state,
      trace: {
        ...state.trace,
        responsibilityBegan: state.trace.responsibilityBegan.put(TaskA, true),
        worktreeReadyAccepted: state.trace.worktreeReadyAccepted.put(
          TaskA,
          AcceptedExactWorktreeReady({ attemptId: AttemptE, baseSha: BaseE, locator: WorktreeE }))
      },
    },
  }
  action releaseAmbiguousClaimIntent: bool = all {
    state.ambiguousClaimIntentAppend.get(TaskA),
    state' = { ...state, admission: state.admission.put(TaskA, Unoccupied) },
  }
  action blindlyReappendAmbiguousClaimIntent: bool = all {
    state.ambiguousClaimIntentAppend.get(TaskA),
    state' = {
      ...state,
      admission: state.admission.put(TaskA, exactClaimIntent(TaskA)),
      trace: { ...state.trace, blindClaimIntentReappend: true },
    },
  }
  action releaseAmbiguousResponsibilityAppend: bool = all {
    state.ambiguousResponsibilityAppend.get(TaskA),
    state' = { ...state, admission: state.admission.put(TaskA, Unoccupied) },
  }
  action blindlyReappendAmbiguousResponsibility: bool = all {
    state.ambiguousResponsibilityAppend.get(TaskA),
    state' = {
      ...state,
      admission: state.admission.put(TaskA, ExactAttemptHeld(AttemptA)),
      trace: { ...state.trace, blindResponsibilityReappend: true },
    },
  }

  action loseDurableCommitmentOnCrash: bool = all {
    state.admission.get(TaskA) == exactClaimIntent(TaskA),
    state' = {
      ...state,
      admission: state.admission.put(TaskA, Unoccupied),
      trace: { ...state.trace, processLosses: OneProcessLoss },
    },
  }
  action evictCommitmentDuringContraction: bool = all {
    state.admission.get(TaskA) == exactClaimIntent(TaskA),
    state.capacity > 1,
    state' = { ...state, capacity: state.capacity - 1, admission: state.admission.put(TaskA, Unoccupied) },
  }

  action createExecutorHandoffGap: bool = all {
    state.admission.get(TaskA) == exactWorktreeReady(TaskA),
    state' = {
      ...state,
      admission: state.admission.put(TaskA, Unoccupied),
      trace: { ...state.trace, responsibilityBegan: state.trace.responsibilityBegan.put(TaskA, true) },
    },
  }

  action releaseAfterPostOwnershipConstraint: bool = all {
    state.admission.get(TaskA) == exactClaimOwned(TaskA),
    state.continuationConstraint.get(TaskA) == PostOwnershipConstrained,
    state' = { ...state, admission: state.admission.put(TaskA, Unoccupied) },
  }

  action enterDespiteForeignClaimConstraint: bool = all {
    state.admission.get(TaskA) == Unoccupied,
    state.freshEntryConstraint.get(TaskA) == ForeignClaimConstraint,
    state' = { ...state, admission: state.admission.put(TaskA, FreshEntryReserved) },
  }
  action reuseRejectedClaimOperationInNextCycle: bool = all {
    state.claimCycle.get(TaskA) == NextClaimCycle,
    state.admission.get(TaskA) == Unoccupied,
    state' = {
      ...state,
      admission: state.admission.put(
        TaskA,
        FreshTaskCommitted(ClaimIntentRecorded(PrimaryClaimOperationA))),
    },
  }

  action reserveFreshPastReadyExistingResponsibility: bool = all {
    state.existingResponsibility.get(TaskA) == ReadyExistingResponsibility(AttemptA),
    state.admission.get(TaskA) == Unoccupied,
    state.admission.get(TaskB) == Unoccupied,
    state' = {
      ...state,
      admission: state.admission.put(TaskB, FreshEntryReserved),
      trace: { ...state.trace, freshEntryBypassedReadyResponsibility: true },
    },
  }

  action reserveReadyResponsibilityPastCapacity: bool = all {
    state.existingResponsibility.get(TaskA) == ReadyExistingResponsibility(AttemptA),
    occupiedCount(state) >= state.capacity,
    state' = {
      ...state,
      admission: state.admission.put(TaskA, ExistingResponsibilityReserved(AttemptA)),
      trace: { ...state.trace, readyResponsibilityEnteredPastCapacity: true },
    },
  }

  action bindForeignAttemptToTask: bool = all {
    state.admission.get(TaskA) == FreshEntryReserved,
    state' = { ...state, admission: state.admission.put(TaskA, ExactAttemptHeld(AttemptE)) },
  }

  run overCapacityEntryTurnsInvariantRedTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(admitOutsideTaskPastCapacity)
      .expect(not(everyEntryWasWithinItsObservedCapacity))
  }
  run outOfOrderEntryTurnsInvariantRedTest = {
    init.then(enterOutOfStableOrder).expect(not(stableFreshEntryOrder))
  }

  run uncommittedClaimCallTurnsInvariantRedTest = {
    init.then(callClaimWithoutAcceptedIntent)
      .expect(not(claimCallsRequireAcceptedIntent))
  }
  run uncalledOwnedClaimTurnsInvariantRedTest = {
    init.then(ownClaimWithoutClaimCall).expect(not(ownedClaimsRequireClaimCalls))
  }
  run unownedSpecificationReadTurnsInvariantRedTest = {
    init.then(readSpecificationWithoutOwnedClaim).expect(not(specificationsRequireOwnedClaims))
  }
  run specificationlessPlanTurnsInvariantRedTest = {
    init.then(recordPlanWithoutSpecification).expect(not(plansRequireSpecifications))
  }
  run planlessWorktreeCallTurnsInvariantRedTest = {
    init.then(callWorktreeWithoutPlan).expect(not(worktreeCallsRequirePlans))
  }
  run worktreelessResponsibilityTurnsInvariantRedTest = {
    init.then(beginResponsibilityWithoutWorktree)
      .expect(not(responsibilitiesRequireAcceptedExactWorktreeReady))
  }
  run foreignWorktreeEvidenceTurnsResponsibilityInvariantRedTest = {
    init.then(beginResponsibilityWithForeignWorktreeEvidence)
      .expect(not(responsibilitiesRequireAcceptedExactWorktreeReady))
  }
  run ambiguousClaimIntentReleaseTurnsInvariantRedTest = {
    init.then(reserveFreshEntry).then(loseClaimIntentAppendResponse).then(releaseAmbiguousClaimIntent)
      .expect(not(ambiguousClaimIntentRetainsEntryReservation))
  }
  run blindClaimIntentReappendTurnsInvariantRedTest = {
    init
      .then(reserveFreshEntry).then(loseAcceptedClaimIntentAppendResponse)
      .then(blindlyReappendAmbiguousClaimIntent)
      .expect(not(ambiguityRequiresReconciliationBeforeReappend))
  }

  run crashReleaseOfDurableCommitmentTurnsInvariantRedTest = {
    init.then(reserveFreshEntry).then(recordClaimIntent).then(loseDurableCommitmentOnCrash)
      .expect(not(durableCommitmentHasExactDisposition))
  }
  run contractionEvictionTurnsInvariantRedTest = {
    init.then(reserveFreshEntry).then(recordClaimIntent).then(evictCommitmentDuringContraction)
      .expect(not(durableCommitmentHasExactDisposition))
  }


  run postOwnershipConstraintReleaseTurnsInvariantRedTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(observePostOwnershipConstraint)
      .then(releaseAfterPostOwnershipConstraint)
      .expect(not(durableCommitmentHasExactDisposition))
  }

  run foreignClaimConstraintEntryTurnsInvariantRedTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(rejectForeignClaim)
      .then(enterDespiteForeignClaimConstraint)
      .expect(not(foreignClaimConstraintPreventsOccupancy))
  }
  run rejectedClaimOperationReuseTurnsInvariantRedTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(rejectForeignClaim)
      .then(observeForeignClaimCleared)
      .then(reuseRejectedClaimOperationInNextCycle)
      .expect(not(newClaimCycleNeverReusesRejectedOperation))
  }

  run handoffGapTurnsInvariantRedTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(createExecutorHandoffGap)
      .expect(not(responsibilityHandoffNeverCreatesAdmissionGap))
  }
  run ambiguousResponsibilityAppendReleaseTurnsInvariantRedTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(loseExecutorResponsibilityAppendResponse)
      .then(releaseAmbiguousResponsibilityAppend)
      .expect(not(ambiguousResponsibilityAppendRetainsCommitment))
  }
  run blindResponsibilityReappendTurnsInvariantRedTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(loseAcceptedExecutorResponsibilityAppendResponse)
      .then(blindlyReappendAmbiguousResponsibility)
      .expect(not(ambiguityRequiresReconciliationBeforeReappend))
  }

  run readyResponsibilityBypassTurnsInvariantRedTest = {
    init
      .then(contractCapacity).then(contractCapacity)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(handoffToExecutorResponsibility).then(releaseHeldPositionReady)
      .then(reserveFreshPastReadyExistingResponsibility)
      .expect(not(retainedReadyResponsibilityBlocksFreshEntry))
  }

  run readyResponsibilityOverCapacityTurnsInvariantRedTest = {
    init
      .then(contractCapacity)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(handoffToExecutorResponsibility)
      .then(reserveFreshEntry)
      .then(releaseHeldPositionReady)
      .then(contractCapacity)
      .then(reserveReadyResponsibilityPastCapacity)
      .expect(not(readyResponsibilityEntryRespectsCapacity))
  }

  run mismatchedAttemptBindingTurnsInvariantRedTest = {
    init.then(reserveFreshEntry).then(bindForeignAttemptToTask)
      .expect(and {
        not(currentOccupancyHasOneClosedRepresentation),
        not(existingResponsibilityInputIsExactlyCorrelated),
      })
  }
}
