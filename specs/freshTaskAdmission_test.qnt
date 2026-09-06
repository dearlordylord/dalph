module freshTaskAdmissionTest {
  import freshTaskAdmission.* from "./freshTaskAdmission"

  // At each reserve step the stable-order guard leaves exactly one task choice.
  run threeEntriesConsumeCapacityBeforeAnyOutsideTaskTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .expect(and {
        threeFreshEntriesReached,
        state.admission.get(TaskD) == Unoccupied,
        state.admission.get(TaskE) == Unoccupied,
        occupiedCount(state) == 3,
        everyEntryWasWithinItsObservedCapacity,
        stableFreshEntryOrder,
      })
  }

  run independentPipelineProgressNeverReleasesAdmissionTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .expect(and {
        worktreeReadyReached,
        occupiedCount(state) == 3,
        state.admission.get(TaskD) == Unoccupied,
        responsibilitiesRequireAcceptedExactWorktreeReady,
      })
  }

  run executorResponsibilityHandoffKeepsOneOccupancyTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(handoffToExecutorResponsibility)
      .expect(and {
        state.admission.get(TaskA) == ExactAttemptHeld(AttemptA),
        occupiedCount(state) == 1,
        responsibilityHandoffNeverCreatesAdmissionGap,
      })
  }

  run ambiguousExecutorResponsibilityAppendRetainsCommitmentTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(loseExecutorResponsibilityAppendResponse)
      .expect(and {
        state.admission.get(TaskA) == exactWorktreeReady(TaskA),
        state.ambiguousResponsibilityAppend.get(TaskA),
        ambiguousResponsibilityAppendRetainsCommitment,
        occupiedCount(state) == 1,
      })
  }

  run lostAcceptedResponsibilityResponseReconstructsHeldPositionAfterCrashTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(loseAcceptedExecutorResponsibilityAppendResponse)
      .then(crash).then(recover)
      .expect(and {
        state.journalResponsibilityPresent.get(TaskA),
        state.admission.get(TaskA) == ExactAttemptHeld(AttemptA),
        state.existingResponsibility.get(TaskA) == RetainedNotReadyResponsibility(AttemptA),
        occupiedCount(state) == 1,
      })
  }

  run conclusiveForeignClaimReleasesOnlyRejectedTaskTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(rejectForeignClaim)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(reserveFreshEntry)
      .expect(and {
        conclusiveRejectionReached,
        state.admission.get(TaskA) == Unoccupied,
        state.graphCandidate.get(TaskA),
        state.freshEntryConstraint.get(TaskA) == ForeignClaimConstraint,
        state.admission.get(TaskD) == FreshEntryReserved,
        not(state.trace.entered.get(TaskE)),
        occupiedCount(state) == 3,
      })
  }

  run laterAuthoritativeForeignClaimClearMakesTaskEntryCapableTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(rejectForeignClaim)
      .then(observeForeignClaimCleared)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .expect(and {
        foreignConstraintClearedReached,
        state.graphCandidate.get(TaskA),
        state.admission.get(TaskA) ==
          FreshTaskCommitted(ClaimIntentRecorded(NextClaimOperationA)),
        currentOccupancyHasOneClosedRepresentation,
        newClaimCycleNeverReusesRejectedOperation,
      })
  }

  run ambiguousFirstIntentAppendRetainsReservationTest = {
    init
      .then(reserveFreshEntry)
      .then(loseClaimIntentAppendResponse)
      .then(contractCapacity)
      .then(contractCapacity)
      .expect(and {
        ambiguousIntentReached,
        state.admission.get(TaskA) == FreshEntryReserved,
        occupiedCount(state) == 1,
      })
  }

  run conclusiveAbsentFirstIntentReleasesReservationTest = {
    init
      .then(reserveFreshEntry)
      .then(loseClaimIntentAppendResponse)
      .then(observeClaimIntentAbsent)
      .expect(and {
        state.admission.get(TaskA) == Unoccupied,
        not(state.ambiguousClaimIntentAppend.get(TaskA)),
        occupiedCount(state) == 0,
      })
  }

  run lostAcceptedIntentResponseReconstructsCommitmentAfterCrashTest = {
    init
      .then(reserveFreshEntry)
      .then(loseAcceptedClaimIntentAppendResponse)
      .then(crash).then(recover)
      .expect(and {
        state.journalClaimIntentPresent.get(TaskA),
        state.admission.get(TaskA) == exactClaimIntent(TaskA),
        state.trace.claimIntentAccepted.get(TaskA),
        occupiedCount(state) == 1,
      })
  }

  run acceptedClaimIntentObservationSettlesAmbiguityTest = {
    init
      .then(reserveFreshEntry)
      .then(loseAcceptedClaimIntentAppendResponse)
      .then(observeClaimIntentPresent)
      .expect(and {
        state.admission.get(TaskA) == exactClaimIntent(TaskA),
        not(state.ambiguousClaimIntentAppend.get(TaskA)),
        occupiedCount(state) == 1,
      })
  }

  run acceptedExecutorResponsibilityObservationSettlesToHeldTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(loseAcceptedExecutorResponsibilityAppendResponse)
      .then(observeExecutorResponsibilityAppendPresent)
      .expect(and {
        state.admission.get(TaskA) == ExactAttemptHeld(AttemptA),
        not(state.ambiguousResponsibilityAppend.get(TaskA)),
        occupiedCount(state) == 1,
      })
  }

  run absentExecutorResponsibilityObservationRetainsCommitmentTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(loseExecutorResponsibilityAppendResponse)
      .then(observeExecutorResponsibilityAppendAbsent)
      .expect(and {
        state.admission.get(TaskA) == exactWorktreeReady(TaskA),
        not(state.ambiguousResponsibilityAppend.get(TaskA)),
        occupiedCount(state) == 1,
      })
  }

  run processLossBeforeIntentDropsOnlyLiveReservationTest = {
    init
      .then(reserveFreshEntry)
      .then(crash).then(recover)
      .expect(and {
        processLossReached,
        state.admission.get(TaskA) == Unoccupied,
        occupiedCount(state) == 0,
      })
  }

  run processLossAfterIntentKeepsDurableCommitmentTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(crash).then(recover)
      .expect(and {
        processLossReached,
        state.admission.get(TaskA) == exactClaimIntent(TaskA),
        occupiedCount(state) == 1,
        durableCommitmentHasExactDisposition,
      })
  }

  run repeatedProcessLossKeepsSameDurableCommitmentTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(crash).then(recover)
      .then(crash).then(recover)
      .then(crash).then(recover)
      .expect(and {
        repeatedProcessLossReached,
        state.admission.get(TaskA) == exactClaimIntent(TaskA),
        occupiedCount(state) == 1,
      })
  }

  run postOwnershipConstraintRetainsCommitmentTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(observePostOwnershipConstraint)
      .expect(and {
        postOwnershipConstraintReached,
        state.admission.get(TaskA) == exactClaimOwned(TaskA),
        occupiedCount(state) == 1,
        durableCommitmentHasExactDisposition,
      })
  }

  run releasedHeldPositionAdmitsOnlyNextFreshCandidateTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(handoffToExecutorResponsibility)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(handoffToExecutorResponsibility)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(handoffToExecutorResponsibility)
      .then(releaseHeldPositionNotReady)
      .then(reserveFreshEntry)
      .expect(and {
        state.admission.get(TaskD) == FreshEntryReserved,
        not(state.trace.entered.get(TaskE)),
        occupiedCount(state) == 3,
      })
  }

  run readyExistingResponsibilityTakesPriorityTest = {
    init
      .then(contractCapacity).then(contractCapacity)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(handoffToExecutorResponsibility)
      .then(releaseHeldPositionReady)
      .then(reserveReadyResponsibility)
      .expect(and {
        state.admission.get(TaskA) == ExistingResponsibilityReserved(AttemptA),
        not(state.trace.entered.get(TaskB)),
        readyResponsibilityReservedReached,
        retainedReadyResponsibilityBlocksFreshEntry,
      })
  }

  run readyResponsibilityHandoffRestoresHeldPositionTest = {
    init
      .then(contractCapacity).then(contractCapacity)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(handoffToExecutorResponsibility)
      .then(releaseHeldPositionReady)
      .then(reserveReadyResponsibility)
      .then(handoffReadyResponsibility)
      .expect(and {
        state.admission.get(TaskA) == ExactAttemptHeld(AttemptA),
        state.existingResponsibility.get(TaskA) == RetainedNotReadyResponsibility(AttemptA),
        occupiedCount(state) == 1,
      })
  }

  run processLossPreservesReadyExistingResponsibilityPriorityTest = {
    init
      .then(contractCapacity).then(contractCapacity)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(callClaimProvider).then(acceptOwnedClaim)
      .then(acceptPostClaimGraph).then(readFocusedSpecification)
      .then(recordAttemptPlan).then(recordWorktreeIntent)
      .then(callWorktreeBoundary).then(acceptWorktreeReady)
      .then(handoffToExecutorResponsibility)
      .then(releaseHeldPositionReady)
      .then(crash).then(recover)
      .then(reserveReadyResponsibility)
      .expect(and {
        state.admission.get(TaskA) == ExistingResponsibilityReserved(AttemptA),
        state.existingResponsibility.get(TaskA) == ReadyExistingResponsibility(AttemptA),
        not(state.trace.entered.get(TaskB)),
      })
  }

  run contractionRetainsOccupantsAndBlocksAnotherEntryTest = {
    init
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(contractCapacity).then(contractCapacity)
      .expect(and {
        contractionReached,
        occupiedCount(state) == 3,
        not(state.trace.entered.get(TaskD)),
      })
  }

  run expansionAdmitsExactlyTheNextTwoCandidatesTest = {
    init
      .then(contractCapacity).then(contractCapacity)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(expandCapacity).then(expandCapacity)
      .then(reserveFreshEntry).then(recordClaimIntent)
      .then(reserveFreshEntry)
      .expect(and {
        state.trace.entered.get(TaskA),
        state.trace.entered.get(TaskB),
        state.trace.entered.get(TaskC),
        not(state.trace.entered.get(TaskD)),
        occupiedCount(state) == 3,
      })
  }
}
