module freshTaskAdmissionTest {
  import freshTaskAdmission.* from "./freshTaskAdmission"

  // A/B/C start; B suspends and D takes B's vacancy; capacity contracts.
  // C closes and suspends. Alice selects B; A releases and B resumes.
  // G4 then permits C while B and D execute at capacity two.
  run retainedCWithBD = init
    .then(reserveFreshEntryFor(TaskA)).then(recordClaimIntentFor(TaskA))
    .then(projectAcceptedWorktreeReadyFor(TaskA)).then(handoffToExecutorResponsibilityFor(TaskA))
    .then(reserveFreshEntryFor(TaskB)).then(recordClaimIntentFor(TaskB))
    .then(projectAcceptedWorktreeReadyFor(TaskB)).then(handoffToExecutorResponsibilityFor(TaskB))
    .then(reserveFreshEntryFor(TaskC)).then(recordClaimIntentFor(TaskC))
    .then(projectAcceptedWorktreeReadyFor(TaskC)).then(handoffToExecutorResponsibilityFor(TaskC))
    .then(acceptSafeReportFor(TaskB))
    .then(reserveFreshEntryFor(TaskD)).then(recordClaimIntentFor(TaskD))
    .then(projectAcceptedWorktreeReadyFor(TaskD)).then(handoffToExecutorResponsibilityFor(TaskD))
    .then(contractCapacity)
    .then(observeLifecycleClosureFor(TaskC)).then(acceptSafeReportFor(TaskC))
    .then(projectOrdinarySafeContinuationReadyFor(TaskB))
    .then(releaseHeldPositionNotReadyFor(TaskA))
    .then(reserveReadyResponsibilityFor(TaskB)).then(handoffReadyResponsibilityFor(TaskB))
    .then(observeLifecycleReopenFor(TaskC)).then(selectSafeContinuationFor(TaskC))

  run ordinarySafeBDoesNotEnterLifecycleRevalidationTest = init
    .then(reserveFreshEntryFor(TaskA)).then(recordClaimIntentFor(TaskA))
    .then(projectAcceptedWorktreeReadyFor(TaskA)).then(handoffToExecutorResponsibilityFor(TaskA))
    .then(releaseHeldPositionNotReadyFor(TaskA))
    .then(reserveFreshEntryFor(TaskB)).then(recordClaimIntentFor(TaskB))
    .then(projectAcceptedWorktreeReadyFor(TaskB)).then(handoffToExecutorResponsibilityFor(TaskB))
    .then(acceptSafeReportFor(TaskB)).then(selectSafeContinuationFor(TaskB).fail())

  run cWaitsAtTwoBeforeAnyFocusedReadTest = retainedCWithBD
    .expect(and {
    state.capacity == 2,
    state.admission.get(TaskB) == ExactAttemptHeld(AttemptB),
    state.admission.get(TaskD) == ExactAttemptHeld(AttemptD),
  })

  run capTwoRejectsCReservationTest = retainedCWithBD.then(reserveReadyResponsibilityFor(TaskC).fail())
  run capTwoRejectsFocusedCReadTest = retainedCWithBD.then(readContinuationWitnessFor(TaskC, AuthoredSpecification).fail())
  run capThreeRejectsFreshEBypassTest = retainedCWithBD.then(expandCapacity).then(reserveFreshEntryFor(TaskE).fail())
  run reservedCRejectsEarlyResumeTest = retainedCWithBD.then(expandCapacity)
    .then(reserveReadyResponsibilityFor(TaskC)).then(handoffReadyResponsibilityFor(TaskC).fail())
  run reservedCRejectsMissingWitnessAuthorizationTest = retainedCWithBD.then(expandCapacity)
    .then(reserveReadyResponsibilityFor(TaskC)).then(authorizeSafeContinuationFor(TaskC).fail())
  run reservedCRejectsDoubleOccupancyTest = retainedCWithBD.then(expandCapacity)
    .then(reserveReadyResponsibilityFor(TaskC)).then(reserveReadyResponsibilityFor(TaskC).fail())
  run independentlyConstrainedCRejectsReservationTest = {
    nondet constraint = Set(TrackerClosed, OperatorPaused, SpecificationBlocked, ClaimBlocked, GitBlocked).oneOf()
    retainedCWithBD.then(constrainSafeContinuationFor(TaskC, constraint)).then(expandCapacity)
      .then(selectSafeContinuationFor(TaskC).fail())
  }

  run cReservesThirdPositionBeforeFreshETest = retainedCWithBD.then(expandCapacity)
    .then(reserveReadyResponsibilityFor(TaskC))
    .then(readContinuationWitnessFor(TaskC, AuthoredSpecification))
    .expect(and {
      occupiedCount(state) == 3,
    })
    .then(readContinuationWitnessFor(TaskC, ExactClaim))
    .then(readContinuationWitnessFor(TaskC, PlannedWorktree))
    .then(readContinuationWitnessFor(TaskC, TargetLineage))
    .then(authorizeSafeContinuationFor(TaskC)).then(handoffReadyResponsibilityFor(TaskC))
    .expect(and {
      occupiedCount(state) == 3,
      state.admission.get(TaskC) == ExactAttemptHeld(AttemptC),
      safeContinuationAuthorizationRequiresEveryWitness,
      currentOccupancyHasOneClosedRepresentation,
    })

  run resumedExecutingDiscardsProcessLocalContinuationWitnessesTest = cReservesThirdPositionBeforeFreshETest
    .then(observeResumedExecutingFor(TaskC))
    .expect(and {
      not(state.resumeIntentPending.get(TaskC)),
      state.admission.get(TaskC) == ExactAttemptHeld(AttemptC),
      state.existingResponsibility.get(TaskC) == RetainedNotReadyResponsibility(AttemptC),
      state.continuationWitnesses.get(TaskC) == Set(),
      continuationWitnessesRemainWithinExactContinuation,
    })

  run canonicalWorktreeReadyRequiresClaimBoundaryTest = init
    .then(reserveFreshEntryFor(TaskA)).then(recordClaimIntentFor(TaskA))
    .then(acceptWorktreeReadyFor(TaskA).fail())

  run canonicalWorktreeReadyRequiresPlanBoundaryTest = init
    .then(reserveFreshEntryFor(TaskA)).then(recordClaimIntentFor(TaskA))
    .then(callClaimProviderFor(TaskA)).then(acceptOwnedClaimFor(TaskA))
    .then(acceptWorktreeReadyFor(TaskA).fail())

  run canonicalWorktreeReadyRequiresWorktreeCallBoundaryTest = init
    .then(reserveFreshEntryFor(TaskA)).then(recordClaimIntentFor(TaskA))
    .then(callClaimProviderFor(TaskA)).then(acceptOwnedClaimFor(TaskA))
    .then(acceptPostClaimGraphFor(TaskA)).then(readFocusedSpecificationFor(TaskA))
    .then(recordAttemptPlanFor(TaskA)).then(recordWorktreeIntentFor(TaskA))
    .then(acceptWorktreeReadyFor(TaskA).fail())

  run canonicalWorktreeReadyFollowsEveryProviderBoundaryTest = init
    .then(reserveFreshEntryFor(TaskA)).then(recordClaimIntentFor(TaskA))
    .then(callClaimProviderFor(TaskA)).then(acceptOwnedClaimFor(TaskA))
    .then(acceptPostClaimGraphFor(TaskA)).then(readFocusedSpecificationFor(TaskA))
    .then(recordAttemptPlanFor(TaskA)).then(recordWorktreeIntentFor(TaskA))
    .then(callWorktreeBoundaryFor(TaskA)).then(acceptWorktreeReadyFor(TaskA))
    .expect(state.admission.get(TaskA) == exactWorktreeReady(TaskA))

  run failedCReadReleasesReservationAndAllowsETest = retainedCWithBD.then(expandCapacity)
    .then(reserveReadyResponsibilityFor(TaskC))
    .then(constrainSafeContinuationFor(TaskC, EvidenceUnavailable))
    .then(reserveFreshEntryFor(TaskE))
    .expect(and {
      state.admission.get(TaskC) == Unoccupied,
      state.existingResponsibility.get(TaskC) == RetainedNotReadyResponsibility(AttemptC),
      occupiedCount(state) == 3,
      constrainedSafeContinuationCannotReserve,
    })

  run pausedClosedOrConflictingCCannotReserveTest = {
    nondet constraint = Set(TrackerClosed, OperatorPaused, SpecificationBlocked, ClaimBlocked, GitBlocked).oneOf()
    retainedCWithBD.then(constrainSafeContinuationFor(TaskC, constraint)).then(expandCapacity)
      .then(reserveFreshEntryFor(TaskE))
      .expect(and {
        state.admission.get(TaskE) == FreshEntryReserved,
        state.admission.get(TaskC) == Unoccupied,
      })
  }

  run crashAfterG4PreservesCapacityWaitTest = retainedCWithBD.then(crash).then(recover)
    .expect(occupiedCount(state) == 2)

  run crashAfterCapacityStillSelectsCBeforeETest = retainedCWithBD.then(expandCapacity).then(crash).then(recover)
    .then(reserveReadyResponsibilityFor(TaskC)).expect(occupiedCount(state) == 3)

  run crashDuringReadsDiscardsReservationAndRequiresReadsAgainTest = retainedCWithBD.then(expandCapacity)
    .then(reserveReadyResponsibilityFor(TaskC)).then(readContinuationWitnessFor(TaskC, AuthoredSpecification))
    .then(crash).then(recover)
    .expect(and {
      occupiedCount(state) == 2,
      state.continuationWitnesses.get(TaskC) == Set(),
    })
    .then(reserveReadyResponsibilityFor(TaskC))
    .expect(occupiedCount(state) == 3)

  run crashAfterAuthorizationBeforeResumeRequiresNewReadsTest = retainedCWithBD.then(expandCapacity)
    .then(reserveReadyResponsibilityFor(TaskC))
    .then(readContinuationWitnessFor(TaskC, AuthoredSpecification))
    .then(readContinuationWitnessFor(TaskC, ExactClaim))
    .then(readContinuationWitnessFor(TaskC, PlannedWorktree))
    .then(readContinuationWitnessFor(TaskC, TargetLineage))
    .then(authorizeSafeContinuationFor(TaskC)).then(crash).then(recover)
    .then(reserveReadyResponsibilityFor(TaskC))
    .expect(and {
      occupiedCount(state) == 3,
    })

  run intendedCResumeRecoveredStillSafe = retainedCWithBD.then(expandCapacity)
    .then(reserveReadyResponsibilityFor(TaskC))
    .then(readContinuationWitnessFor(TaskC, AuthoredSpecification))
    .then(readContinuationWitnessFor(TaskC, ExactClaim))
    .then(readContinuationWitnessFor(TaskC, PlannedWorktree))
    .then(readContinuationWitnessFor(TaskC, TargetLineage))
    .then(authorizeSafeContinuationFor(TaskC)).then(handoffReadyResponsibilityFor(TaskC))
    .then(crash).then(recover).then(reconcileResumeAsStillSafeFor(TaskC))

  run reconciledSafeResumeRejectsFreshEBypassTest = intendedCResumeRecoveredStillSafe
    .then(reserveFreshEntryFor(TaskE).fail())

  run reconciledSafeResumeReacquiresOnePositionBeforeReadsTest = intendedCResumeRecoveredStillSafe
    .expect(occupiedCount(state) == 2)
    .then(reserveReadyResponsibilityFor(TaskC))
    .then(readContinuationWitnessFor(TaskC, AuthoredSpecification))
    .expect(and { occupiedCount(state) == 3, pendingResumeRevalidationRequiresExactSafeReconciliation })

  run safeProjectionRequiresPriorResumeIntentTest = retainedCWithBD
    .then(reconcileResumeAsStillSafeFor(TaskC).fail())

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
