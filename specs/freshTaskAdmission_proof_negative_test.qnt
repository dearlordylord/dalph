module freshTaskAdmissionCapacityProofNegativeTest {
  import freshTaskAdmissionCapacityProof.* from "./freshTaskAdmission_proof"

  // Deliberately leave the finite capacity-proof domain. This negative
  // control makes the proof's type-bound invariant fail for an otherwise
  // unchanged initialized state.
  action leaveCapacityProofDomain: bool = all {
    state' = { ...state, capacity: 4 },
  }

  action overCapacityFourth: bool = all {
    occupiedCount(state) == 3,
    state' = {
      ...state,
      disposition: state.disposition.put(D, Occupied),
      lastEvent: FreshEntered(D),
      entryPastCapacity: true,
    },
  }

  action outOfOrder: bool = all {
    state' = {
      ...state,
      disposition: state.disposition.put(C, Occupied),
      lastEvent: FreshEntered(C),
      entryOutOfStableOrder: true,
    },
  }

  action candidateOperation: bool = all {
    state.disposition.get(D) == Candidate,
    state' = { ...state, operationStartedWhileCandidate: true },
  }

  action evictOnContraction: bool = all {
    state.disposition.get(A) == Occupied,
    state' = {
      ...state,
      capacity: 2,
      disposition: state.disposition.put(A, Candidate),
      contractionEvicted: true,
      dispositionLost: true,
      lastEvent: CapacityContracted,
    },
  }

  action gapHandoff: bool = all {
    state.disposition.get(A) == Occupied,
    state' = {
      ...state,
      disposition: state.disposition.put(A, Candidate),
      handoffGap: true,
      lastEvent: FreshHandedOff(A),
    },
  }

  action bypassReady: bool = all {
    state.disposition.get(A) == ReadyExisting,
    state' = {
      ...state,
      disposition: state.disposition.put(B, Occupied),
      lastEvent: FreshEntered(B),
      freshBypassedReady: true,
    },
  }

  action reserveExistingPastCapacity: bool = all {
    state.disposition.get(A) == ReadyExisting,
    occupiedCount(state) >= state.capacity,
    state' = {
      ...state,
      disposition: state.disposition.put(A, ExistingReserved),
      existingEntryPastCapacity: true,
      lastEvent: ExistingEntered(A),
    },
  }

  run fourthEntryIsDetectedTest = {
    init.then(reserveNext(A)).then(reserveNext(B)).then(reserveNext(C)).then(overCapacityFourth)
      .expect(not(freshEntryRespectsCapacityAtDecision))
  }

  run overRankedEntryIsDetectedTest =
    init.then(outOfOrder).expect(not(freshEntryUsesStableOrder))

  run candidateOperationIsDetectedTest =
    init.then(candidateOperation).expect(not(graphCandidateStartsNoOperation))

  run contractionEvictionIsDetectedTest = {
    init.then(reserveNext(A)).then(evictOnContraction)
      .expect(and { not(contractionRetainsOccupants), not(committedTaskHasExactDisposition) })
  }

  run handoffGapIsDetectedTest = {
    init.then(reserveNext(A)).then(gapHandoff)
      .expect(not(responsibilityHandoffHasNoGap))
  }

  run readyBypassIsDetectedTest = {
    init.then(reserveNext(A)).then(releaseOccupiedNotReady(A)).then(makeExistingReady(A))
      .then(bypassReady).expect(not(readyExistingPrecedesFresh))
  }

  run existingEntryPastCapacityIsDetectedTest = {
    init.then(reserveNext(A)).then(reserveNext(B))
      .then(releaseOccupiedNotReady(A)).then(makeExistingReady(A))
      .then(contract).then(contract).then(reserveExistingPastCapacity)
      .expect(not(existingEntryRespectsCapacityAtDecision))
  }

  run capacityProofTypeViolationTurnsInvariantRedTest =
    init.then(leaveCapacityProofDomain).expect(not(capacityProofTypeOk))
}

module freshTaskAdmissionAmbiguityProofNegativeTest {
  import freshTaskAdmissionAmbiguityProof.* from "./freshTaskAdmission_proof"

  action releaseAmbiguousIntent: bool = all {
    match state.stage {
      | ClaimIntentAppendUnknown(_) => all { state' = { ...state, stage: Candidate } }
      | ClaimOutcomeUnknown(_) => all { state' = { ...state, stage: Candidate } }
      | _ => all { false, state' = state }
    },
  }

  action releaseAmbiguousResponsibility: bool = all {
    match state.stage {
      | ResponsibilityAppendUnknown(_) => all { state' = { ...state, stage: Candidate } }
      | _ => all { false, state' = state }
    },
  }

  action blindIntentReappend: bool = all {
    match state.stage {
      | ClaimIntentAppendUnknown(_) => all {
          state' = { ...state, stage: ClaimIntentRecorded, blindIntentReappend: true },
        }
      | ClaimOutcomeUnknown(_) => all {
          state' = { ...state, stage: ClaimRequestCalled(ClaimAbsent), blindIntentReappend: true },
        }
      | _ => all { false, state' = state }
    },
  }

  action blindResponsibilityReappend: bool = all {
    match state.stage {
      | ResponsibilityAppendUnknown(_) => all {
          state' = { ...state, stage: ExactAttemptHeld(LineageA), blindResponsibilityReappend: true },
        }
      | _ => all { false, state' = state }
    },
  }

  action retryDifferentClaimOperation: bool = all {
    state.stage == ClaimRetryAuthorized,
    state' = { ...state, stage: ClaimRequestCalled(ClaimAbsent), claimOperationChanged: true },
  }

  action retryDifferentWorktreeOperation: bool = all {
    state.stage == WorktreeRetryAuthorized,
    state' = { ...state, stage: WorktreeRequestCalled(WorktreeAbsent), worktreeOperationChanged: true },
  }

  action loseAcceptedIntentOnCrash: bool = all {
    state.journalIntent == Present,
    state' = {
      ...state,
      stage: Candidate,
      process: Down,
      crashedOnce: true,
      lastEvent: ProcessCrashed,
    },
  }

  action gapAcceptedResponsibility: bool = all {
    state.journalResponsibility == Present,
    state' = { ...state, stage: Candidate },
  }

  action releaseConstrainedOwned: bool = all {
    state.stage == PostOwnershipConstrained,
    state' = { ...state, stage: Candidate },
  }

  action authorizeOutsidePrematurely: bool = all {
    selectedOccupies(state.stage),
    state' = { ...state, outsideEntered: true, lastEvent: OutsideAuthorized },
  }

  action planForeignLineage: bool = all {
    state.stage == SpecificationKnown,
    state' = { ...state, stage: AttemptPlanned(ForeignLineage) },
  }

  action acceptForeignReadyEvidence: bool = all {
    state.stage == WorktreeIntentRecorded(LineageA),
    state' = {
      ...state,
      stage: WorktreeReady({ lineage: LineageA, evidence: ForeignReadyEvidence }),
    },
  }

  action handoffBeforeReady: bool = all {
    state.stage == AttemptPlanned(LineageA),
    state' = {
      ...state,
      stage: ExactAttemptHeld(LineageA),
      journalResponsibility: Present,
      responsibilityHandoffFollowedReady: false,
    },
  }

  action handoffForeignReadyEvidence: bool = all {
    state.stage == WorktreeReady({ lineage: LineageA, evidence: ForeignReadyEvidence }),
    state' = {
      ...state,
      stage: ExactAttemptHeld(LineageA),
      journalResponsibility: Present,
      responsibilityHandoffFollowedReady: true,
      exactReadyEvidenceAccepted: false,
    },
  }

  run ambiguousIntentReleaseIsDetectedTest = {
    init.then(reserve).then(beginClaimIntentAppend(Present)).then(releaseAmbiguousIntent)
      .expect(and {
        not(ambiguousIntentRetainsReservation),
        not(acceptedIntentSurvivesUntilExactDisposition),
      })
  }

  run ambiguousResponsibilityReleaseIsDetectedTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ExactClaim)).then(observeClaimAuthority)
      .then(acceptPostClaimGraph).then(acceptSpecification).then(acceptPlan)
      .then(appendWorktreeIntent).then(callWorktree(ExactWorktree)).then(observeWorktreeAuthority)
      .then(beginResponsibilityAppend(Present)).then(releaseAmbiguousResponsibility)
      .expect(and {
        not(ambiguousResponsibilityRetainsCommitment),
        not(acceptedResponsibilityHasNoGap),
      })
  }

  run blindIntentReappendIsDetectedTest = {
    init.then(reserve).then(beginClaimIntentAppend(Present)).then(blindIntentReappend)
      .expect(not(reconcileBeforeAnyReappend))
  }

  run blindResponsibilityReappendIsDetectedTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ExactClaim)).then(observeClaimAuthority)
      .then(acceptPostClaimGraph).then(acceptSpecification).then(acceptPlan)
      .then(appendWorktreeIntent).then(callWorktree(ExactWorktree)).then(observeWorktreeAuthority)
      .then(beginResponsibilityAppend(Present)).then(blindResponsibilityReappend)
      .expect(not(reconcileBeforeAnyReappend))
  }

  run changedClaimRetryIsDetectedTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ClaimAbsent)).then(loseClaimResponse).then(observeClaimAuthority)
      .then(retryDifferentClaimOperation).expect(not(retriesKeepExactOperation))
  }

  run changedWorktreeRetryIsDetectedTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ExactClaim)).then(observeClaimAuthority)
      .then(acceptPostClaimGraph).then(acceptSpecification).then(acceptPlan)
      .then(appendWorktreeIntent).then(callWorktree(WorktreeAbsent))
      .then(loseWorktreeResponse).then(observeWorktreeAuthority)
      .then(retryDifferentWorktreeOperation).expect(not(retriesKeepExactOperation))
  }

  run acceptedIntentLossIsDetectedTest = {
    init.then(reserve).then(appendIntent).then(loseAcceptedIntentOnCrash)
      .expect(and {
        not(acceptedIntentSurvivesUntilExactDisposition),
        not(processLossDoesNotRelease),
      })
  }

  run acceptedResponsibilityGapIsDetectedTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ExactClaim)).then(observeClaimAuthority)
      .then(acceptPostClaimGraph).then(acceptSpecification).then(acceptPlan)
      .then(appendWorktreeIntent).then(callWorktree(ExactWorktree)).then(observeWorktreeAuthority)
      .then(appendResponsibility).then(gapAcceptedResponsibility)
      .expect(not(acceptedResponsibilityHasNoGap))
  }

  run postOwnershipReleaseIsDetectedTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ExactClaim)).then(observeClaimAuthority).then(constrainOwned)
      .then(releaseConstrainedOwned).expect(and {
        not(postOwnershipConstraintDoesNotRelease),
        not(acceptedIntentSurvivesUntilExactDisposition),
      })
  }

  run prematureOutsideAuthorizationIsDetectedTest = {
    init.then(reserve).then(appendIntent).then(authorizeOutsidePrematurely)
      .expect(and { not(outsideAuthorizationRequiresDisposition), not(ambiguityProofTypeOk) })
  }


  run foreignPlannedLineageIsDetectedTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ExactClaim)).then(observeClaimAuthority)
      .then(acceptPostClaimGraph).then(acceptSpecification).then(planForeignLineage)
      .expect(not(plannedWorktreeAndHeldLineageStayExact))
  }

  run foreignReadyEvidenceIsDetectedTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ExactClaim)).then(observeClaimAuthority)
      .then(acceptPostClaimGraph).then(acceptSpecification).then(acceptPlan)
      .then(appendWorktreeIntent).then(acceptForeignReadyEvidence)
      .expect(not(plannedWorktreeAndHeldLineageStayExact))
  }

  run handoffBeforeReadyIsDetectedTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ExactClaim)).then(observeClaimAuthority)
      .then(acceptPostClaimGraph).then(acceptSpecification).then(acceptPlan)
      .then(handoffBeforeReady)
      .expect(and {
        not(responsibilityRequiresExactReadyWorktreeEvidence),
        not(responsibilityHandoffFollowsReadyWorktree),
      })
  }

  run handoffWithForeignReadyEvidenceIsDetectedTest = {
    init.then(reserve).then(appendIntent)
      .then(callClaim(ExactClaim)).then(observeClaimAuthority)
      .then(acceptPostClaimGraph).then(acceptSpecification).then(acceptPlan)
      .then(appendWorktreeIntent).then(acceptForeignReadyEvidence)
      .then(handoffForeignReadyEvidence)
      .expect(not(responsibilityRequiresExactReadyWorktreeEvidence))
  }
}
