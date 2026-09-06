module freshTaskAdmissionCapacityProofTest {
  import freshTaskAdmissionCapacityProof.* from "./freshTaskAdmission_proof"

  run threeOccupantsExcludeFourthTest = {
    init.then(reserveNext(A)).then(reserveNext(B)).then(reserveNext(C))
      .expect(and {
        threeOccupantsReached,
        state.disposition.get(D) == Candidate,
        freshEntryRespectsCapacityAtDecision,
        freshEntryUsesStableOrder,
      })
  }

  run releasedPositionAdmitsOnlyDTest = {
    init.then(reserveNext(A)).then(reserveNext(B)).then(reserveNext(C))
      .then(releaseOccupiedNotReady(B)).then(reserveNext(D))
      .expect(and {
        outsideCandidateEnteredReached,
        state.disposition.get(E) == Candidate,
        occupiedCount(state) == 3,
      })
  }

  run foreignRejectionAdmitsOnlyDTest = {
    init.then(reserveNext(A)).then(reserveNext(B)).then(reserveNext(C))
      .then(rejectPreownership(A)).then(reserveNext(D))
      .expect(and {
        state.disposition.get(A) == ForeignBlocked,
        state.disposition.get(D) == Occupied,
        state.disposition.get(E) == Candidate,
        occupiedCount(state) == 3,
      })
  }

  run ownedConstraintRetainsCommitmentTest = {
    init.then(reserveNext(A)).then(constrainOwned(A))
      .expect(and { ownedConstraintReached, occupiedCount(state) == 1, committedTaskHasExactDisposition })
  }

  run freshHandoffKeepsOneOccupancyTest = {
    init.then(reserveNext(A)).then(handoffFresh(A))
      .expect(and { handoffReached, occupiedCount(state) == 1, responsibilityHandoffHasNoGap })
  }

  run readyExistingPrecedesFreshTest = {
    init.then(reserveNext(A)).then(releaseOccupiedNotReady(A)).then(makeExistingReady(A))
      .then(reserveExisting(A))
      .expect(and {
        existingReservationReached,
        state.disposition.get(B) == Candidate,
        readyExistingPrecedesFresh,
      })
  }

  run retainedNotReadyDoesNotBlockFreshTest = {
    init.then(reserveNext(A)).then(reserveNext(B)).then(reserveNext(C))
      .then(releaseOccupiedNotReady(B)).then(reserveNext(D))
      .expect(and { retainedNotReadyReached, state.disposition.get(D) == Occupied })
  }

  run contractionRetainsThreeOccupantsTest = {
    init.then(reserveNext(A)).then(reserveNext(B)).then(reserveNext(C))
      .then(contract).then(contract)
      .expect(and {
        contractionReached,
        state.capacity == 1,
        occupiedCount(state) == 3,
        contractionRetainsOccupants,
      })
  }

  run expansionAdmitsNextInStableOrderTest = {
    init.then(contract).then(contract).then(reserveNext(A)).then(expand).then(reserveNext(B))
      .expect(and {
        state.capacity == 2,
        state.disposition.get(B) == Occupied,
        state.disposition.get(C) == Candidate,
        freshEntryUsesStableOrder,
      })
  }

  run preIntentRecoveryReturnsTaskToCandidateTest = {
    init.then(reserveNext(A)).then(releasePreIntentReservation(A))
      .expect(and { state.disposition.get(A) == Candidate, occupiedCount(state) == 0 })
  }

  run readyReleaseAndReservationRecoveryStayReadyTest = {
    init.then(reserveNext(A)).then(releaseHeldPositionReady(A))
      .then(reserveExisting(A)).then(recoverExistingReservation(A))
      .expect(and {
        state.disposition.get(A) == ReadyExisting,
        occupiedCount(state) == 0,
      })
  }

  run clearedForeignConstraintStartsNewCandidateCycleTest = {
    init.then(reserveNext(A)).then(rejectPreownership(A)).then(clearForeignConstraint(A))
      .expect(and {
        state.disposition.get(A) == Candidate,
        state.lastEvent == ForeignConstraintCleared(A),
      })
  }
}

module freshTaskAdmissionAmbiguityProofTest {
  import freshTaskAdmissionAmbiguityProof.* from "./freshTaskAdmission_proof"

  run absentIntentAppendReleasesOnlyReservationTest = {
    init.then(reserve).then(beginClaimIntentAppend(Absent)).then(reconcileClaimIntent)
      .expect(and {
        state.stage == Candidate,
        state.journalIntent == Absent,
        acceptedIntentSurvivesUntilExactDisposition,
      })
  }

  run acceptedIntentAppendReconstructsCommitmentTest = {
    init.then(reserve).then(beginClaimIntentAppend(Present))
      .then(crash).then(recover).then(reconcileClaimIntent)
      .expect(and { reconstructedClaimReached, acceptedIntentSurvivesUntilExactDisposition })
  }

  run preIntentReservationDisappearsOnRecoveryTest = {
    init.then(reserve).then(crash).then(recover)
      .expect(and {
        state.stage == Candidate,
        state.journalIntent == Absent,
        not(selectedOccupies(state.stage)),
      })
  }

  run lostClaimResponseRequiresReadBeforeRetryTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ClaimAbsent)).then(loseClaimResponse).then(observeClaimAuthority)
      .expect(and { claimRetryReached, reconcileBeforeAnyReappend, retriesKeepExactOperation })
  }

  run lostClaimResponseCanObserveExactOwnershipTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ExactClaim)).then(loseClaimResponse).then(observeClaimAuthority)
      .expect(and { state.stage == ClaimOwned, acceptedIntentSurvivesUntilExactDisposition })
  }

  run foreignClaimRejectionAuthorizesOutsideTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ForeignClaim)).then(observeClaimAuthority).then(authorizeOutside)
      .expect(and { rejectedReached, outsideEnteredReached, outsideAuthorizationRequiresDisposition })
  }

  run clearedForeignConstraintBeginsDistinctCycleTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ForeignClaim)).then(observeClaimAuthority)
      .then(clearForeignConstraintForNewCycle)
      .expect(and {
        foreignConstraintClearedReached,
        state.stage == Candidate,
        state.journalIntent == Absent,
      })
  }

  run unreadableClaimRetainsCommitmentTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ClaimUnreadable)).then(observeClaimAuthority)
      .expect(and {
        claimUnreadableReached,
        selectedOccupies(state.stage),
        ambiguousIntentRetainsReservation,
      })
  }

  run lostWorktreeResponseRequiresReadBeforeRetryTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ExactClaim)).then(observeClaimAuthority)
      .then(acceptPostClaimGraph).then(acceptSpecification).then(acceptPlan)
      .then(appendWorktreeIntent).then(callWorktree(WorktreeAbsent))
      .then(loseWorktreeResponse).then(observeWorktreeAuthority)
      .expect(and { worktreeRetryReached, reconcileBeforeAnyReappend, retriesKeepExactOperation })
  }

  run unreadableWorktreeRetainsCommitmentTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ExactClaim)).then(observeClaimAuthority)
      .then(acceptPostClaimGraph).then(acceptSpecification).then(acceptPlan)
      .then(appendWorktreeIntent).then(callWorktree(WorktreeUnreadable))
      .then(observeWorktreeAuthority)
      .expect(and {
        worktreeUnreadableReached,
        selectedOccupies(state.stage),
        ambiguousIntentRetainsReservation,
      })
  }

  run acceptedResponsibilityAppendReconstructsHeldTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ExactClaim)).then(observeClaimAuthority)
      .then(acceptPostClaimGraph).then(acceptSpecification).then(acceptPlan)
      .then(appendWorktreeIntent).then(callWorktree(ExactWorktree)).then(observeWorktreeAuthority)
      .then(beginResponsibilityAppend(Present)).then(crash).then(recover)
      .then(reconcileResponsibility)
      .expect(and {
        reconstructedHeldReached,
        acceptedResponsibilityHasNoGap,
        plannedWorktreeAndHeldLineageStayExact,
        responsibilityRequiresExactReadyWorktreeEvidence,
        responsibilityHandoffFollowsReadyWorktree,
      })
  }

  run absentResponsibilityAppendRetainsPreparedCommitmentTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ExactClaim)).then(observeClaimAuthority)
      .then(acceptPostClaimGraph).then(acceptSpecification).then(acceptPlan)
      .then(appendWorktreeIntent).then(callWorktree(ExactWorktree)).then(observeWorktreeAuthority)
      .then(beginResponsibilityAppend(Absent)).then(reconcileResponsibility)
      .expect(and { state.stage == WorktreeReady(EXACT_READY_WORKTREE), selectedOccupies(state.stage) })
  }

  run postOwnershipConstraintRetainsOccupancyTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ExactClaim)).then(observeClaimAuthority).then(constrainOwned)
      .expect(and { constrainedReached, selectedOccupies(state.stage), postOwnershipConstraintDoesNotRelease })
  }

  run repeatedCrashRecoveryPreservesAcceptedIntentTest = {
    init.then(reserve).then(appendIntent)
      .then(crash).then(recover).then(crash).then(recover)
      .expect(and {
        repeatedCrashReached,
        state.stage == ClaimIntentRecorded,
        acceptedIntentSurvivesUntilExactDisposition,
        processLossDoesNotRelease,
      })
  }

  run heldReleaseAuthorizesOutsideTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ExactClaim)).then(observeClaimAuthority)
      .then(acceptPostClaimGraph).then(acceptSpecification).then(acceptPlan)
      .then(appendWorktreeIntent).then(callWorktree(ExactWorktree)).then(observeWorktreeAuthority)
      .then(appendResponsibility).then(releaseHeld).then(authorizeOutside)
      .expect(and { state.stage == HeldReleased, outsideEnteredReached, outsideAuthorizationRequiresDisposition })
  }
}
