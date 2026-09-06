// Finite proof projections for fresh-task admission. The capacity projection
// preserves all five task identities because stable A-E order is load-bearing.
// The continuity projection expands one admitted task through every durable and
// ambiguous boundary while retaining one outside-task sentinel.
module freshTaskAdmissionCapacityProof {
  type TaskId = A | B | C | D | E

  // This is the complete scheduling disposition for one task in this
  // projection. Occupied collapses every fresh commitment and exact held
  // attempt; the continuity projection proves that those stages do not vacate.
  type TaskDisposition =
    | Candidate
    | Occupied
    | RetainedNotReady
    | ReadyExisting
    | ExistingReserved
    | ForeignBlocked

  type Event =
    | Initialized
    | FreshEntered(TaskId)
    | OccupiedReleased(TaskId)
    | ExistingBecameReady(TaskId)
    | ExistingEntered(TaskId)
    | ExistingHandedOff(TaskId)
    | FreshHandedOff(TaskId)
    | ForeignRejected(TaskId)
    | OwnedConstrained(TaskId)
    | CapacityContracted
    | CapacityExpanded
    | ForeignConstraintCleared(TaskId)

  type State = {
    capacity: int,
    disposition: TaskId -> TaskDisposition,
    existingOrder: TaskId -> int,
    lastEvent: Event,
    entryPastCapacity: bool,
    entryOutOfStableOrder: bool,
    freshBypassedReady: bool,
    existingEntryPastCapacity: bool,
    operationStartedWhileCandidate: bool,
    dispositionLost: bool,
    handoffGap: bool,
    contractionEvicted: bool,
  }

  var state: State

  pure val TASKS: Set[TaskId] = Set(A, B, C, D, E)

  pure def taskRank(task: TaskId): int = match task {
    | A => 1 | B => 2 | C => 3 | D => 4 | E => 5
  }

  pure def isOccupied(disposition: TaskDisposition): bool =
    disposition == Occupied or disposition == ExistingReserved

  pure def occupiedCount(s: State): int =
    (if (isOccupied(s.disposition.get(A))) 1 else 0)
    + (if (isOccupied(s.disposition.get(B))) 1 else 0)
    + (if (isOccupied(s.disposition.get(C))) 1 else 0)
    + (if (isOccupied(s.disposition.get(D))) 1 else 0)
    + (if (isOccupied(s.disposition.get(E))) 1 else 0)

  pure def lowerCandidateWaits(s: State, task: TaskId): bool =
    TASKS.exists(other => and {
      taskRank(other) < taskRank(task),
      s.disposition.get(other) == Candidate,
    })

  pure def readyExistingWaits(s: State): bool =
    TASKS.exists(task => s.disposition.get(task) == ReadyExisting)

  pure def lowerReadyExistingWaits(s: State, task: TaskId): bool =
    TASKS.exists(other => and {
      s.disposition.get(other) == ReadyExisting,
      or {
        s.existingOrder.get(other) < s.existingOrder.get(task),
        and {
          s.existingOrder.get(other) == s.existingOrder.get(task),
          taskRank(other) < taskRank(task),
        },
      },
    })

  // Write-only violation flags record the decision pre-state without retaining
  // a combinatorial history record. No valid action reads these flags.
  val freshEntryRespectsCapacityAtDecision = not(state.entryPastCapacity)
  val freshEntryUsesStableOrder = not(state.entryOutOfStableOrder)
  val readyExistingPrecedesFresh = not(state.freshBypassedReady)
  val existingEntryRespectsCapacityAtDecision = not(state.existingEntryPastCapacity)

  val graphCandidateStartsNoOperation = not(state.operationStartedWhileCandidate)
  val committedTaskHasExactDisposition = not(state.dispositionLost)
  val responsibilityHandoffHasNoGap = not(state.handoffGap)
  val contractionRetainsOccupants = not(state.contractionEvicted)

  val capacityProofTypeOk = and {
    state.capacity >= 1,
    state.capacity <= 3,
    TASKS.forall(task => state.existingOrder.get(task) >= 1),
  }

  val threeOccupantsReached = occupiedCount(state) == 3
  val outsideCandidateEnteredReached = state.lastEvent == FreshEntered(D)
  val foreignRejectionReached = state.lastEvent == ForeignRejected(A)
  val ownedConstraintReached = state.lastEvent == OwnedConstrained(A)
  val handoffReached = state.lastEvent == FreshHandedOff(A)
  val readyReached = state.lastEvent == ExistingBecameReady(A)
  val existingReservationReached = state.lastEvent == ExistingEntered(A)
  val contractionReached = state.lastEvent == CapacityContracted
  val expansionReached = state.lastEvent == CapacityExpanded
  val retainedNotReadyReached =
    TASKS.exists(task => state.disposition.get(task) == RetainedNotReady)

  action init: bool = all {
    state' = {
      capacity: 3,
      disposition: TASKS.mapBy(_ => Candidate),
      existingOrder: TASKS.mapBy(task => taskRank(task)),
      lastEvent: Initialized,
      entryPastCapacity: false,
      entryOutOfStableOrder: false,
      freshBypassedReady: false,
      existingEntryPastCapacity: false,
      operationStartedWhileCandidate: false,
      dispositionLost: false,
      handoffGap: false,
      contractionEvicted: false,
    },
  }

  action reserveNext(task: TaskId): bool = all {
    state.disposition.get(task) == Candidate,
    occupiedCount(state) < state.capacity,
    not(lowerCandidateWaits(state, task)),
    not(readyExistingWaits(state)),
    state' = {
      ...state,
      disposition: state.disposition.put(task, Occupied),
      lastEvent: FreshEntered(task),
      entryPastCapacity: state.entryPastCapacity or occupiedCount(state) >= state.capacity,
      entryOutOfStableOrder:
        state.entryOutOfStableOrder or lowerCandidateWaits(state, task),
      freshBypassedReady: state.freshBypassedReady or readyExistingWaits(state),
    },
  }

  action releaseOccupiedNotReady(task: TaskId): bool = all {
    state.disposition.get(task) == Occupied,
    state' = {
      ...state,
      disposition: state.disposition.put(task, RetainedNotReady),
      lastEvent: OccupiedReleased(task),
    },
  }

  action makeExistingReady(task: TaskId): bool = all {
    state.disposition.get(task) == RetainedNotReady,
    state' = {
      ...state,
      disposition: state.disposition.put(task, ReadyExisting),
      lastEvent: ExistingBecameReady(task),
    },
  }

  action reserveExisting(task: TaskId): bool = all {
    state.disposition.get(task) == ReadyExisting,
    occupiedCount(state) < state.capacity,
    not(lowerReadyExistingWaits(state, task)),
    state' = {
      ...state,
      disposition: state.disposition.put(task, ExistingReserved),
      lastEvent: ExistingEntered(task),
      existingEntryPastCapacity:
        state.existingEntryPastCapacity or occupiedCount(state) >= state.capacity,
    },
  }

  action handoffExisting(task: TaskId): bool = all {
    state.disposition.get(task) == ExistingReserved,
    state' = {
      ...state,
      disposition: state.disposition.put(task, Occupied),
      lastEvent: ExistingHandedOff(task),
    },
  }

  action handoffFresh(task: TaskId): bool = all {
    state.disposition.get(task) == Occupied,
    state' = { ...state, lastEvent: FreshHandedOff(task) },
  }

  action rejectPreownership(task: TaskId): bool = all {
    state.disposition.get(task) == Occupied,
    state' = {
      ...state,
      disposition: state.disposition.put(task, ForeignBlocked),
      lastEvent: ForeignRejected(task),
    },
  }

  // A later authoritative tracker observation may remove the foreign claim.
  // This creates a new candidate cycle; it does not retry the rejected claim
  // operation represented by ForeignBlocked.
  action clearForeignConstraint(task: TaskId): bool = all {
    state.disposition.get(task) == ForeignBlocked,
    state' = {
      ...state,
      disposition: state.disposition.put(task, Candidate),
      lastEvent: ForeignConstraintCleared(task),
    },
  }

  // These three transitions are the capacity-side refinement images of
  // recovery/release events whose detailed authority is proved elsewhere.
  action releasePreIntentReservation(task: TaskId): bool = all {
    state.disposition.get(task) == Occupied,
    state' = {
      ...state,
      disposition: state.disposition.put(task, Candidate),
      lastEvent: OccupiedReleased(task),
    },
  }

  action releaseHeldPositionReady(task: TaskId): bool = all {
    state.disposition.get(task) == Occupied,
    state' = {
      ...state,
      disposition: state.disposition.put(task, ReadyExisting),
      lastEvent: ExistingBecameReady(task),
    },
  }

  action recoverExistingReservation(task: TaskId): bool = all {
    state.disposition.get(task) == ExistingReserved,
    state' = {
      ...state,
      disposition: state.disposition.put(task, ReadyExisting),
      lastEvent: ExistingBecameReady(task),
    },
  }

  action constrainOwned(task: TaskId): bool = all {
    state.disposition.get(task) == Occupied,
    state' = { ...state, lastEvent: OwnedConstrained(task) },
  }

  action contract: bool = all {
    state.capacity > 1,
    state' = { ...state, capacity: state.capacity - 1, lastEvent: CapacityContracted },
  }

  action expand: bool = all {
    state.capacity < 3,
    state' = { ...state, capacity: state.capacity + 1, lastEvent: CapacityExpanded },
  }

  action step: bool = {
    nondet task = TASKS.oneOf()
    any {
      reserveNext(task),
      releaseOccupiedNotReady(task),
      makeExistingReady(task),
      reserveExisting(task),
      handoffExisting(task),
      handoffFresh(task),
      rejectPreownership(task),
      clearForeignConstraint(task),
      releasePreIntentReservation(task),
      releaseHeldPositionReady(task),
      recoverExistingReservation(task),
      constrainOwned(task),
      contract,
      expand,
    }
  }
}

module freshTaskAdmissionAmbiguityProof {
  type Presence = Absent | Present
  type Process = Up | Down
  type ClaimAuthority = ClaimAbsent | ExactClaim | ForeignClaim | ClaimUnreadable
  type WorktreeAuthority = WorktreeAbsent | ExactWorktree | WorktreeConflict | WorktreeUnreadable
  type ExactLineage = LineageA | ForeignLineage
  type WorktreeReadyEvidence = ExactReadyEvidence | ForeignReadyEvidence
  type ReadyWorktree = {
    lineage: ExactLineage,
    evidence: WorktreeReadyEvidence,
  }

  // One closed sum prevents a reservation, commitment, and exact position from
  // coexisting or disappearing between pipeline stages.
  type ContinuityStage =
    | Candidate
    | EntryReserved
    | ClaimIntentAppendUnknown(Presence)
    | ClaimIntentRecorded
    | ClaimRequestCalled(ClaimAuthority)
    | ClaimOutcomeUnknown(ClaimAuthority)
    | ClaimRetryAuthorized
    | ClaimOwned
    | PostClaimGraphKnown
    | SpecificationKnown
    | AttemptPlanned(ExactLineage)
    | WorktreeIntentRecorded(ExactLineage)
    | WorktreeRequestCalled(WorktreeAuthority)
    | WorktreeOutcomeUnknown(WorktreeAuthority)
    | WorktreeRetryAuthorized
    | WorktreeReady(ReadyWorktree)
    | ResponsibilityAppendUnknown(Presence)
    | ExactAttemptHeld(ExactLineage)
    | PostOwnershipConstrained
    | PreOwnershipRejected
    | HeldReleased

  type Event =
    | Initialized
    | EntryReservedEvent
    | ClaimIntentAppendStarted
    | ClaimIntentAccepted
    | ClaimCalled
    | ClaimResponseLost
    | ClaimAuthorityRead
    | ClaimRetryEnabled
    | ClaimOwnedEvent
    | PostClaimGraphAccepted
    | SpecificationAccepted
    | PlanAccepted
    | WorktreeIntentAccepted
    | WorktreeCalled
    | WorktreeResponseLost
    | WorktreeAuthorityRead
    | WorktreeRetryEnabled
    | WorktreeReadyEvent
    | ResponsibilityAppendStarted
    | ResponsibilityAccepted
    | ConstraintObserved
    | ForeignRejectionObserved
    | ForeignConstraintClearedForNewCycle
    | HeldReleasedEvent
    | OutsideAuthorized
    | ProcessCrashed
    | ProcessRecovered

  type State = {
    stage: ContinuityStage,
    process: Process,
    journalIntent: Presence,
    journalResponsibility: Presence,
    unresolvedBoundaryAmbiguity: bool,
    unresolvedResponsibilityAmbiguity: bool,
    postOwnershipConstraintActive: bool,
    exactReadyEvidenceAccepted: bool,
    responsibilityHandoffFollowedReady: bool,
    outsideEntered: bool,
    blindIntentReappend: bool,
    blindResponsibilityReappend: bool,
    claimOperationChanged: bool,
    worktreeOperationChanged: bool,
    crashedOnce: bool,
    recoveredOnce: bool,
    crashedAgain: bool,
    lastEvent: Event,
  }

  var state: State

  pure val EXACT_READY_WORKTREE: ReadyWorktree = {
    lineage: LineageA,
    evidence: ExactReadyEvidence,
  }

  pure def selectedOccupies(stage: ContinuityStage): bool = match stage {
    | Candidate => false
    | PreOwnershipRejected => false
    | HeldReleased => false
    | _ => true
  }

  pure def afterOwnership(stage: ContinuityStage): bool = match stage {
    | ClaimOwned => true
    | PostClaimGraphKnown => true
    | SpecificationKnown => true
    | AttemptPlanned(_) => true
    | WorktreeIntentRecorded(_) => true
    | WorktreeRequestCalled(_) => true
    | WorktreeOutcomeUnknown(_) => true
    | WorktreeRetryAuthorized => true
    | WorktreeReady(_) => true
    | PostOwnershipConstrained => true
    | _ => false
  }

  val ambiguousIntentRetainsReservation =
    not(state.unresolvedBoundaryAmbiguity) or selectedOccupies(state.stage)

  val ambiguousResponsibilityRetainsCommitment =
    not(state.unresolvedResponsibilityAmbiguity) or selectedOccupies(state.stage)

  val acceptedIntentSurvivesUntilExactDisposition =
    state.journalIntent == Absent or or {
      selectedOccupies(state.stage),
      state.stage == PreOwnershipRejected,
      state.stage == HeldReleased,
    }

  val acceptedResponsibilityHasNoGap =
    state.journalResponsibility == Absent or or {
      match state.stage {
        | ResponsibilityAppendUnknown(presence) => presence == Present
        | ExactAttemptHeld(_) => true
        | HeldReleased => true
        | _ => false
      },
    }

  val postOwnershipConstraintDoesNotRelease =
    not(state.postOwnershipConstraintActive) or selectedOccupies(state.stage)

  val reconcileBeforeAnyReappend = and {
    not(state.blindIntentReappend),
    not(state.blindResponsibilityReappend),
  }

  val retriesKeepExactOperation = and {
    not(state.claimOperationChanged),
    not(state.worktreeOperationChanged),
  }

  val processLossDoesNotRelease =
    state.lastEvent != ProcessCrashed or state.journalIntent == Absent or
      selectedOccupies(state.stage) or
      state.stage == PreOwnershipRejected or
      state.stage == HeldReleased

  val outsideAuthorizationRequiresDisposition =
    not(state.outsideEntered) or
      state.stage == PreOwnershipRejected or
      state.stage == HeldReleased

  val plannedWorktreeAndHeldLineageStayExact = match state.stage {
    | AttemptPlanned(lineage) => lineage == LineageA
    | WorktreeIntentRecorded(lineage) => lineage == LineageA
    | WorktreeReady(ready) => and {
        ready.lineage == LineageA,
        ready.evidence == ExactReadyEvidence,
      }
    | ExactAttemptHeld(lineage) => lineage == LineageA
    | _ => true
  }

  val responsibilityRequiresExactReadyWorktreeEvidence =
    match state.stage {
      | ResponsibilityAppendUnknown(_) => state.exactReadyEvidenceAccepted
      | ExactAttemptHeld(_) => state.exactReadyEvidenceAccepted
      | HeldReleased => state.exactReadyEvidenceAccepted
      | _ => true
    }

  val responsibilityHandoffFollowsReadyWorktree =
    match state.stage {
      | ExactAttemptHeld(_) => state.responsibilityHandoffFollowedReady
      | HeldReleased => state.responsibilityHandoffFollowedReady
      | _ => true
    }

  val ambiguityProofTypeOk = and {
    state.journalResponsibility == Absent or state.journalIntent == Present,
    not(state.outsideEntered) or not(selectedOccupies(state.stage)),
  }

  val claimAmbiguityReached = match state.stage {
    | ClaimOutcomeUnknown(_) => true | _ => false
  }
  val acceptedClaimAmbiguityReached =
    state.stage == ClaimIntentAppendUnknown(Present)
  val responsibilityAmbiguityReached = match state.stage {
    | ResponsibilityAppendUnknown(_) => true | _ => false
  }
  val acceptedResponsibilityAmbiguityReached =
    state.stage == ResponsibilityAppendUnknown(Present)
  val reconstructedClaimReached = and {
    state.recoveredOnce,
    state.stage == ClaimIntentRecorded,
  }
  val reconstructedHeldReached = and {
    state.recoveredOnce,
    state.stage == ExactAttemptHeld(LineageA),
  }
  val rejectedReached = state.stage == PreOwnershipRejected
  val constrainedReached = state.stage == PostOwnershipConstrained
  val repeatedCrashReached = state.crashedAgain
  val claimRetryReached = state.stage == ClaimRetryAuthorized
  val worktreeRetryReached = state.stage == WorktreeRetryAuthorized
  val outsideEnteredReached = state.outsideEntered
  val claimUnreadableReached = state.stage == ClaimOutcomeUnknown(ClaimUnreadable)
  val worktreeUnreadableReached = state.stage == WorktreeOutcomeUnknown(WorktreeUnreadable)
  val foreignConstraintClearedReached = state.lastEvent == ForeignConstraintClearedForNewCycle

  action init: bool = all {
    state' = {
      stage: Candidate,
      process: Up,
      journalIntent: Absent,
      journalResponsibility: Absent,
      unresolvedBoundaryAmbiguity: false,
      unresolvedResponsibilityAmbiguity: false,
      postOwnershipConstraintActive: false,
      exactReadyEvidenceAccepted: false,
      responsibilityHandoffFollowedReady: false,
      outsideEntered: false,
      blindIntentReappend: false,
      blindResponsibilityReappend: false,
      claimOperationChanged: false,
      worktreeOperationChanged: false,
      crashedOnce: false,
      recoveredOnce: false,
      crashedAgain: false,
      lastEvent: Initialized,
    },
  }

  action reserve: bool = all {
    state.process == Up,
    state.stage == Candidate,
    not(state.outsideEntered),
    state' = { ...state, stage: EntryReserved, lastEvent: EntryReservedEvent },
  }

  action beginClaimIntentAppend(presence: Presence): bool = all {
    state.process == Up,
    state.stage == EntryReserved,
    state' = {
      ...state,
      stage: ClaimIntentAppendUnknown(presence),
      journalIntent: presence,
      unresolvedBoundaryAmbiguity: true,
      lastEvent: ClaimIntentAppendStarted,
    },
  }

  action appendIntent: bool = all {
    state.process == Up,
    state.stage == EntryReserved,
    state' = {
      ...state,
      stage: ClaimIntentRecorded,
      journalIntent: Present,
      lastEvent: ClaimIntentAccepted,
    },
  }

  action reconcileClaimIntent: bool = {
    nondet presence = Set(Absent, Present).oneOf()
    all {
      state.process == Up,
      state.stage == ClaimIntentAppendUnknown(presence),
      state' = if (presence == Present)
        { ...state, stage: ClaimIntentRecorded, unresolvedBoundaryAmbiguity: false, lastEvent: ClaimIntentAccepted }
      else
        { ...state, stage: Candidate, unresolvedBoundaryAmbiguity: false, lastEvent: ClaimAuthorityRead },
    }
  }

  action callClaim(authority: ClaimAuthority): bool = all {
    state.process == Up,
    state.stage == ClaimIntentRecorded or state.stage == ClaimRetryAuthorized,
    state' = {
      ...state,
      stage: ClaimRequestCalled(authority),
      lastEvent: ClaimCalled,
    },
  }

  action loseClaimResponse: bool = {
    nondet authority = Set(ClaimAbsent, ExactClaim, ForeignClaim, ClaimUnreadable).oneOf()
    all {
      state.process == Up,
      state.stage == ClaimRequestCalled(authority),
      state' = { ...state, stage: ClaimOutcomeUnknown(authority), unresolvedBoundaryAmbiguity: true, lastEvent: ClaimResponseLost },
    }
  }

  action observeClaimAuthority: bool = {
    nondet authority = Set(ClaimAbsent, ExactClaim, ForeignClaim, ClaimUnreadable).oneOf()
    all {
      state.process == Up,
      or {
        state.stage == ClaimRequestCalled(authority),
        and { state.stage == ClaimOutcomeUnknown(authority), authority != ClaimUnreadable },
      },
      state' = if (authority == ExactClaim)
        { ...state, stage: ClaimOwned, unresolvedBoundaryAmbiguity: false, lastEvent: ClaimOwnedEvent }
      else if (authority == ForeignClaim)
        { ...state, stage: PreOwnershipRejected, unresolvedBoundaryAmbiguity: false, lastEvent: ForeignRejectionObserved }
      else if (authority == ClaimAbsent)
        { ...state, stage: ClaimRetryAuthorized, unresolvedBoundaryAmbiguity: false, lastEvent: ClaimRetryEnabled }
      else
        { ...state, stage: ClaimOutcomeUnknown(ClaimUnreadable), unresolvedBoundaryAmbiguity: true, lastEvent: ClaimAuthorityRead },
    }
  }

  action acceptPostClaimGraph: bool = all {
    state.process == Up,
    state.stage == ClaimOwned,
    state' = { ...state, stage: PostClaimGraphKnown, lastEvent: PostClaimGraphAccepted },
  }

  action acceptSpecification: bool = all {
    state.process == Up,
    state.stage == PostClaimGraphKnown,
    state' = { ...state, stage: SpecificationKnown, lastEvent: SpecificationAccepted },
  }

  action acceptPlan: bool = all {
    state.process == Up,
    state.stage == SpecificationKnown,
    state' = { ...state, stage: AttemptPlanned(LineageA), lastEvent: PlanAccepted },
  }

  action appendWorktreeIntent: bool = all {
    state.process == Up,
    state.stage == AttemptPlanned(LineageA),
    state' = { ...state, stage: WorktreeIntentRecorded(LineageA), lastEvent: WorktreeIntentAccepted },
  }

  action callWorktree(authority: WorktreeAuthority): bool = all {
    state.process == Up,
    state.stage == WorktreeIntentRecorded(LineageA) or state.stage == WorktreeRetryAuthorized,
    state' = { ...state, stage: WorktreeRequestCalled(authority), lastEvent: WorktreeCalled },
  }

  action loseWorktreeResponse: bool = {
    nondet authority = Set(WorktreeAbsent, ExactWorktree, WorktreeConflict, WorktreeUnreadable).oneOf()
    all {
      state.process == Up,
      state.stage == WorktreeRequestCalled(authority),
      state' = { ...state, stage: WorktreeOutcomeUnknown(authority), unresolvedBoundaryAmbiguity: true, lastEvent: WorktreeResponseLost },
    }
  }

  action observeWorktreeAuthority: bool = {
    nondet authority = Set(WorktreeAbsent, ExactWorktree, WorktreeConflict, WorktreeUnreadable).oneOf()
    all {
      state.process == Up,
      or {
        state.stage == WorktreeRequestCalled(authority),
        and { state.stage == WorktreeOutcomeUnknown(authority), authority != WorktreeUnreadable },
      },
      state' = if (authority == ExactWorktree)
        { ...state, stage: WorktreeReady(EXACT_READY_WORKTREE), unresolvedBoundaryAmbiguity: false, exactReadyEvidenceAccepted: true, lastEvent: WorktreeReadyEvent }
      else if (authority == WorktreeAbsent)
        { ...state, stage: WorktreeRetryAuthorized, unresolvedBoundaryAmbiguity: false, lastEvent: WorktreeRetryEnabled }
      else if (authority == WorktreeConflict)
        { ...state, stage: PostOwnershipConstrained, unresolvedBoundaryAmbiguity: false, postOwnershipConstraintActive: true, lastEvent: ConstraintObserved }
      else
        { ...state, stage: WorktreeOutcomeUnknown(WorktreeUnreadable), unresolvedBoundaryAmbiguity: true, lastEvent: WorktreeAuthorityRead },
    }
  }

  action beginResponsibilityAppend(presence: Presence): bool = all {
    state.process == Up,
    state.stage == WorktreeReady(EXACT_READY_WORKTREE),
    state' = {
      ...state,
      stage: ResponsibilityAppendUnknown(presence),
      journalResponsibility: presence,
      responsibilityHandoffFollowedReady: true,
      unresolvedResponsibilityAmbiguity: true,
      lastEvent: ResponsibilityAppendStarted,
    },
  }

  action appendResponsibility: bool = all {
    state.process == Up,
    state.stage == WorktreeReady(EXACT_READY_WORKTREE),
    state' = {
      ...state,
      stage: ExactAttemptHeld(LineageA),
      journalResponsibility: Present,
      responsibilityHandoffFollowedReady: true,
      lastEvent: ResponsibilityAccepted,
    },
  }

  action reconcileResponsibility: bool = {
    nondet presence = Set(Absent, Present).oneOf()
    all {
      state.process == Up,
      state.stage == ResponsibilityAppendUnknown(presence),
      state' = if (presence == Present)
        { ...state, stage: ExactAttemptHeld(LineageA), unresolvedResponsibilityAmbiguity: false, lastEvent: ResponsibilityAccepted }
      else
        { ...state, stage: WorktreeReady(EXACT_READY_WORKTREE), unresolvedResponsibilityAmbiguity: false, lastEvent: WorktreeAuthorityRead },
    }
  }

  action constrainOwned: bool = all {
    state.process == Up,
    afterOwnership(state.stage),
    state.stage != HeldReleased,
    state' = { ...state, stage: PostOwnershipConstrained, postOwnershipConstraintActive: true, lastEvent: ConstraintObserved },
  }

  // This is an environmental reset boundary, not a retry. The canonical model
  // owns the old rejected operation identity and allocates a distinct exact
  // operation if a later tracker read removes the foreign constraint.
  action clearForeignConstraintForNewCycle: bool = all {
    state.process == Up,
    state.stage == PreOwnershipRejected,
    not(state.outsideEntered),
    state' = {
      ...state,
      stage: Candidate,
      journalIntent: Absent,
      journalResponsibility: Absent,
      unresolvedBoundaryAmbiguity: false,
      exactReadyEvidenceAccepted: false,
      responsibilityHandoffFollowedReady: false,
      lastEvent: ForeignConstraintClearedForNewCycle,
    },
  }

  action releaseHeld: bool = all {
    state.process == Up,
    state.stage == ExactAttemptHeld(LineageA),
    state' = { ...state, stage: HeldReleased, lastEvent: HeldReleasedEvent },
  }

  action authorizeOutside: bool = all {
    state.process == Up,
    not(state.outsideEntered),
    state.stage == PreOwnershipRejected or state.stage == HeldReleased,
    state' = { ...state, outsideEntered: true, lastEvent: OutsideAuthorized },
  }

  action crash: bool = all {
    state.process == Up,
    state' = {
      ...state,
      process: Down,
      crashedOnce: true,
      crashedAgain: state.crashedOnce,
      lastEvent: ProcessCrashed,
    },
  }

  action recover: bool = all {
    state.process == Down,
    state' = {
      ...state,
      stage: if (state.stage == EntryReserved) Candidate else state.stage,
      process: Up,
      recoveredOnce: true,
      lastEvent: ProcessRecovered,
    },
  }

  action step: bool = {
    nondet presence = Set(Absent, Present).oneOf()
    nondet claim = Set(ClaimAbsent, ExactClaim, ForeignClaim, ClaimUnreadable).oneOf()
    nondet worktree = Set(WorktreeAbsent, ExactWorktree, WorktreeConflict, WorktreeUnreadable).oneOf()
    any {
      reserve,
      beginClaimIntentAppend(presence),
      appendIntent,
      reconcileClaimIntent,
      callClaim(claim),
      loseClaimResponse,
      observeClaimAuthority,
      acceptPostClaimGraph,
      acceptSpecification,
      acceptPlan,
      appendWorktreeIntent,
      callWorktree(worktree),
      loseWorktreeResponse,
      observeWorktreeAuthority,
      beginResponsibilityAppend(presence),
      appendResponsibility,
      reconcileResponsibility,
      constrainOwned,
      clearForeignConstraintForNewCycle,
      releaseHeld,
      authorizeOutside,
      crash,
      recover,
    }
  }
}
