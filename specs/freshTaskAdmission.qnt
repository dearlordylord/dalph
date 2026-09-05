// Models the one scheduling boundary between a process-local fresh-entry
// reservation and an exact executor-work position. One closed per-task sum is
// the sole admission authority, so reservation/commitment/position overlap is
// unrepresentable. Run establishment and Begin remain in their owning models.
module freshTaskAdmission {
  type TaskId = TaskA | TaskB | TaskC | TaskD | TaskE
  type AttemptId = AttemptA | AttemptB | AttemptC | AttemptD | AttemptE
  type ClaimOperationId =
    | PrimaryClaimOperationA | PrimaryClaimOperationB | PrimaryClaimOperationC
    | PrimaryClaimOperationD | PrimaryClaimOperationE
    | NextClaimOperationA | NextClaimOperationB | NextClaimOperationC
    | NextClaimOperationD | NextClaimOperationE
  type ClaimCycle = PrimaryClaimCycle | NextClaimCycle
  type ClaimId = ClaimA | ClaimB | ClaimC | ClaimD | ClaimE
  type SpecificationRevision = SpecificationA | SpecificationB | SpecificationC | SpecificationD | SpecificationE
  type BaseSha = BaseA | BaseB | BaseC | BaseD | BaseE
  type WorktreeOperationId = WorktreeOperationA | WorktreeOperationB | WorktreeOperationC | WorktreeOperationD | WorktreeOperationE
  type WorktreeLocator = WorktreeA | WorktreeB | WorktreeC | WorktreeD | WorktreeE

  // Each variant is one accepted durable prefix. The task cannot carry two
  // stages at once.
  type FreshCommitmentStage =
    | ClaimIntentRecorded(ClaimOperationId)
    | ClaimRequestCalled(ClaimOperationId)
    | ClaimOwned(ClaimId)
    | PostClaimGraphKnown(ClaimId)
    | SpecificationKnown({ claimId: ClaimId, revision: SpecificationRevision })
    | AttemptPlanned({ claimId: ClaimId, attemptId: AttemptId, baseSha: BaseSha })
    | WorktreeIntentRecorded({
        attemptId: AttemptId,
        baseSha: BaseSha,
        operationId: WorktreeOperationId,
        locator: WorktreeLocator,
      })
    | WorktreeRequestCalled({
        attemptId: AttemptId,
        baseSha: BaseSha,
        operationId: WorktreeOperationId,
        locator: WorktreeLocator,
      })
    | WorktreeReady({ attemptId: AttemptId, baseSha: BaseSha, locator: WorktreeLocator })

  type ProcessState = ProcessUp | ProcessDown
  type ProcessLossEvidence = NoProcessLoss | OneProcessLoss | RepeatedProcessLoss
  type FreshEntryConstraint = FreshEntryUnconstrained | ForeignClaimConstraint
  type ContinuationConstraint = NoContinuationConstraint | PostOwnershipConstrained
  type WorktreeReadyEvidence =
    | NoAcceptedWorktreeReady
    | AcceptedExactWorktreeReady({
        attemptId: AttemptId,
        baseSha: BaseSha,
        locator: WorktreeLocator,
      })

  // This is the complete occupancy sum owned by #315. FreshEntryReserved and
  // ExistingResponsibilityReserved are process-local; FreshTaskCommitted and
  // ExactAttemptHeld are reconstructed from accepted Journal history.
  type TaskAdmissionState =
    | Unoccupied
    | FreshEntryReserved
    | FreshTaskCommitted(FreshCommitmentStage)
    | ExistingResponsibilityReserved(AttemptId)
    | ExactAttemptHeld(AttemptId)

  // Existing responsibility readiness is supplied by the executor-work model;
  // #315 consumes it only to give ready work priority over a fresh candidate.
  type ExistingResponsibility =
    | NoExistingResponsibility
    | ReadyExistingResponsibility(AttemptId)
    | RetainedNotReadyResponsibility(AttemptId)

  type TaskAdmissions = TaskId -> TaskAdmissionState
  type ExistingResponsibilities = TaskId -> ExistingResponsibility
  type TaskFlags = TaskId -> bool
  type TaskNumbers = TaskId -> int

  // Trace fields are verification instrumentation, not proposed authority.
  type TraceEvidence = {
    entered: TaskFlags,
    admissionCapacity: TaskNumbers,
    admissionOrdinal: TaskNumbers,
    claimIntentAccepted: TaskFlags,
    claimCalled: TaskFlags,
    claimOwned: TaskFlags,
    specificationRead: TaskFlags,
    planRecorded: TaskFlags,
    worktreeCalled: TaskFlags,
    worktreeReadyAccepted: TaskId -> WorktreeReadyEvidence,
    responsibilityBegan: TaskFlags,
    positionReleased: TaskFlags,
    preOwnershipRejected: TaskFlags,
    freshEntryBypassedReadyResponsibility: bool,
    readyResponsibilityEnteredPastCapacity: bool,
    blindClaimIntentReappend: bool,
    blindResponsibilityReappend: bool,
    processLosses: ProcessLossEvidence,
  }

  type State = {
    capacity: int,
    process: ProcessState,
    // These current graph facts are inputs, not admission authority.
    graphCandidate: TaskFlags,
    // Claim and post-ownership constraints can prevent a new admission without
    // changing the tracker's descriptive graph candidacy.
    freshEntryConstraint: TaskId -> FreshEntryConstraint,
    continuationConstraint: TaskId -> ContinuationConstraint,
    claimCycle: TaskId -> ClaimCycle,
    admission: TaskAdmissions,
    existingResponsibility: ExistingResponsibilities,
    // Relative Journal order supplied with the existing-responsibility input.
    responsibilityOrder: TaskNumbers,
    // Actual Journal presence is authority; ambiguity is process knowledge.
    journalClaimIntentPresent: TaskFlags,
    journalResponsibilityPresent: TaskFlags,
    ambiguousClaimIntentAppend: TaskFlags,
    ambiguousResponsibilityAppend: TaskFlags,
    trace: TraceEvidence,
  }

  var state: State

  pure val TASKS: Set[TaskId] = Set(TaskA, TaskB, TaskC, TaskD, TaskE)
  pure def flags(value: bool): TaskFlags = TASKS.mapBy(task => value)
  pure def numbers(value: int): TaskNumbers = TASKS.mapBy(task => value)
  pure def noResponsibilities: ExistingResponsibilities =
    TASKS.mapBy(task => NoExistingResponsibility)
  pure def noWorktreeReadyEvidence: TaskId -> WorktreeReadyEvidence =
    TASKS.mapBy(task => NoAcceptedWorktreeReady)

  pure def taskRank(task: TaskId): int = match task {
    | TaskA => 1 | TaskB => 2 | TaskC => 3 | TaskD => 4 | TaskE => 5
  }
  pure def attemptFor(task: TaskId): AttemptId = match task {
    | TaskA => AttemptA | TaskB => AttemptB | TaskC => AttemptC | TaskD => AttemptD | TaskE => AttemptE
  }
  pure def claimOperationFor(task: TaskId): ClaimOperationId = match task {
    | TaskA => PrimaryClaimOperationA | TaskB => PrimaryClaimOperationB
    | TaskC => PrimaryClaimOperationC | TaskD => PrimaryClaimOperationD
    | TaskE => PrimaryClaimOperationE
  }
  pure def nextClaimOperationFor(task: TaskId): ClaimOperationId = match task {
    | TaskA => NextClaimOperationA | TaskB => NextClaimOperationB
    | TaskC => NextClaimOperationC | TaskD => NextClaimOperationD
    | TaskE => NextClaimOperationE
  }
  pure def claimFor(task: TaskId): ClaimId = match task {
    | TaskA => ClaimA | TaskB => ClaimB | TaskC => ClaimC | TaskD => ClaimD | TaskE => ClaimE
  }
  pure def specificationFor(task: TaskId): SpecificationRevision = match task {
    | TaskA => SpecificationA | TaskB => SpecificationB | TaskC => SpecificationC | TaskD => SpecificationD | TaskE => SpecificationE
  }
  pure def baseFor(task: TaskId): BaseSha = match task {
    | TaskA => BaseA | TaskB => BaseB | TaskC => BaseC | TaskD => BaseD | TaskE => BaseE
  }
  pure def worktreeOperationFor(task: TaskId): WorktreeOperationId = match task {
    | TaskA => WorktreeOperationA | TaskB => WorktreeOperationB | TaskC => WorktreeOperationC | TaskD => WorktreeOperationD | TaskE => WorktreeOperationE
  }
  pure def worktreeFor(task: TaskId): WorktreeLocator = match task {
    | TaskA => WorktreeA | TaskB => WorktreeB | TaskC => WorktreeC | TaskD => WorktreeD | TaskE => WorktreeE
  }

  pure def exactClaimIntent(task: TaskId): TaskAdmissionState =
    FreshTaskCommitted(ClaimIntentRecorded(claimOperationFor(task)))
  pure def exactClaimCalled(task: TaskId): TaskAdmissionState =
    FreshTaskCommitted(ClaimRequestCalled(claimOperationFor(task)))
  pure def currentClaimOperation(s: State, task: TaskId): ClaimOperationId =
    if (s.claimCycle.get(task) == PrimaryClaimCycle)
      claimOperationFor(task)
    else
      nextClaimOperationFor(task)
  pure def currentClaimIntent(s: State, task: TaskId): TaskAdmissionState =
    FreshTaskCommitted(ClaimIntentRecorded(currentClaimOperation(s, task)))
  pure def currentClaimCalled(s: State, task: TaskId): TaskAdmissionState =
    FreshTaskCommitted(ClaimRequestCalled(currentClaimOperation(s, task)))
  pure def exactClaimOwned(task: TaskId): TaskAdmissionState =
    FreshTaskCommitted(ClaimOwned(claimFor(task)))
  pure def exactPostClaimGraph(task: TaskId): TaskAdmissionState =
    FreshTaskCommitted(PostClaimGraphKnown(claimFor(task)))
  pure def exactSpecification(task: TaskId): TaskAdmissionState =
    FreshTaskCommitted(SpecificationKnown({ claimId: claimFor(task), revision: specificationFor(task) }))
  pure def exactPlan(task: TaskId): TaskAdmissionState =
    FreshTaskCommitted(AttemptPlanned({ claimId: claimFor(task), attemptId: attemptFor(task), baseSha: baseFor(task) }))
  pure def exactWorktreeIntent(task: TaskId): TaskAdmissionState =
    FreshTaskCommitted(WorktreeIntentRecorded({
      attemptId: attemptFor(task), baseSha: baseFor(task),
      operationId: worktreeOperationFor(task), locator: worktreeFor(task),
    }))
  pure def exactWorktreeCalled(task: TaskId): TaskAdmissionState =
    FreshTaskCommitted(WorktreeRequestCalled({
      attemptId: attemptFor(task), baseSha: baseFor(task),
      operationId: worktreeOperationFor(task), locator: worktreeFor(task),
    }))
  pure def exactWorktreeReady(task: TaskId): TaskAdmissionState =
    FreshTaskCommitted(WorktreeReady({
      attemptId: attemptFor(task), baseSha: baseFor(task), locator: worktreeFor(task),
    }))

  pure def isOccupied(admission: TaskAdmissionState): bool = admission != Unoccupied
  pure def commitmentOwnsClaim(stage: FreshCommitmentStage): bool = match stage {
    | ClaimOwned(_) => true
    | PostClaimGraphKnown(_) => true
    | SpecificationKnown(_) => true
    | AttemptPlanned(_) => true
    | WorktreeIntentRecorded(_) => true
    | WorktreeRequestCalled(_) => true
    | WorktreeReady(_) => true
    | _ => false
  }
  pure def ownsClaim(admission: TaskAdmissionState): bool = match admission {
    | FreshTaskCommitted(stage) => commitmentOwnsClaim(stage)
    | ExactAttemptHeld(_) => true
    | _ => false
  }
  pure def stageUsesPrimaryClaimOperation(stage: FreshCommitmentStage, task: TaskId): bool =
    match stage {
      | ClaimIntentRecorded(operation) => operation == claimOperationFor(task)
      | ClaimRequestCalled(operation) => operation == claimOperationFor(task)
      | _ => false
    }
  pure def reusesPrimaryClaimOperationInNextCycle(s: State, task: TaskId): bool =
    if (s.claimCycle.get(task) != NextClaimCycle) false
    else match s.admission.get(task) {
      | FreshTaskCommitted(stage) => stageUsesPrimaryClaimOperation(stage, task)
      | _ => false
    }
  pure def occupiedCount(s: State): int =
    (if (isOccupied(s.admission.get(TaskA))) 1 else 0)
    + (if (isOccupied(s.admission.get(TaskB))) 1 else 0)
    + (if (isOccupied(s.admission.get(TaskC))) 1 else 0)
    + (if (isOccupied(s.admission.get(TaskD))) 1 else 0)
    + (if (isOccupied(s.admission.get(TaskE))) 1 else 0)

  pure def noExistingResponsibility(value: ExistingResponsibility): bool =
    value == NoExistingResponsibility
  pure def readyExistingResponsibility(value: ExistingResponsibility): bool = match value {
    | ReadyExistingResponsibility(_) => true
    | _ => false
  }
  pure def freshEntryCapable(s: State, task: TaskId): bool = and {
    s.graphCandidate.get(task),
    s.freshEntryConstraint.get(task) == FreshEntryUnconstrained,
    s.admission.get(task) == Unoccupied,
    noExistingResponsibility(s.existingResponsibility.get(task)),
  }
  pure def lowerRankedFreshCandidateExists(s: State, task: TaskId): bool = or {
    and { taskRank(TaskA) < taskRank(task), freshEntryCapable(s, TaskA) },
    and { taskRank(TaskB) < taskRank(task), freshEntryCapable(s, TaskB) },
    and { taskRank(TaskC) < taskRank(task), freshEntryCapable(s, TaskC) },
    and { taskRank(TaskD) < taskRank(task), freshEntryCapable(s, TaskD) },
    and { taskRank(TaskE) < taskRank(task), freshEntryCapable(s, TaskE) },
  }
  pure def readyResponsibilityWaits(s: State): bool = or {
    and { readyExistingResponsibility(s.existingResponsibility.get(TaskA)), s.admission.get(TaskA) == Unoccupied },
    and { readyExistingResponsibility(s.existingResponsibility.get(TaskB)), s.admission.get(TaskB) == Unoccupied },
    and { readyExistingResponsibility(s.existingResponsibility.get(TaskC)), s.admission.get(TaskC) == Unoccupied },
    and { readyExistingResponsibility(s.existingResponsibility.get(TaskD)), s.admission.get(TaskD) == Unoccupied },
    and { readyExistingResponsibility(s.existingResponsibility.get(TaskE)), s.admission.get(TaskE) == Unoccupied },
  }
  pure def maxInt(left: int, right: int): int = if (left > right) left else right
  pure def maxResponsibilityOrder(s: State): int =
    maxInt(
      maxInt(maxInt(s.responsibilityOrder.get(TaskA), s.responsibilityOrder.get(TaskB)),
        maxInt(s.responsibilityOrder.get(TaskC), s.responsibilityOrder.get(TaskD))),
      s.responsibilityOrder.get(TaskE))
  pure def earlierReadyResponsibilityExists(s: State, task: TaskId): bool = or {
    and { readyExistingResponsibility(s.existingResponsibility.get(TaskA)), s.admission.get(TaskA) == Unoccupied, s.responsibilityOrder.get(TaskA) < s.responsibilityOrder.get(task) },
    and { readyExistingResponsibility(s.existingResponsibility.get(TaskB)), s.admission.get(TaskB) == Unoccupied, s.responsibilityOrder.get(TaskB) < s.responsibilityOrder.get(task) },
    and { readyExistingResponsibility(s.existingResponsibility.get(TaskC)), s.admission.get(TaskC) == Unoccupied, s.responsibilityOrder.get(TaskC) < s.responsibilityOrder.get(task) },
    and { readyExistingResponsibility(s.existingResponsibility.get(TaskD)), s.admission.get(TaskD) == Unoccupied, s.responsibilityOrder.get(TaskD) < s.responsibilityOrder.get(task) },
    and { readyExistingResponsibility(s.existingResponsibility.get(TaskE)), s.admission.get(TaskE) == Unoccupied, s.responsibilityOrder.get(TaskE) < s.responsibilityOrder.get(task) },
  }
  pure def recoveredAdmission(s: State, task: TaskId): TaskAdmissionState =
    if (and {
      s.admission.get(task) == exactWorktreeReady(task),
      s.journalResponsibilityPresent.get(task),
    }) ExactAttemptHeld(attemptFor(task))
    else match s.admission.get(task) {
      | FreshEntryReserved =>
          if (s.journalClaimIntentPresent.get(task)) currentClaimIntent(s, task) else Unoccupied
      | ExistingResponsibilityReserved(_) => Unoccupied
      | FreshTaskCommitted(stage) => FreshTaskCommitted(stage)
      | ExactAttemptHeld(attempt) => ExactAttemptHeld(attempt)
      | Unoccupied => Unoccupied
    }
  pure def crashExistingResponsibility(s: State, task: TaskId): ExistingResponsibility =
    if (and {
      s.admission.get(task) == exactWorktreeReady(task),
      s.journalResponsibilityPresent.get(task),
    })
      RetainedNotReadyResponsibility(attemptFor(task))
    else s.existingResponsibility.get(task)
  pure def recordProcessLoss(evidence: ProcessLossEvidence): ProcessLossEvidence = match evidence {
    | NoProcessLoss => OneProcessLoss
    | OneProcessLoss => RepeatedProcessLoss
    | RepeatedProcessLoss => RepeatedProcessLoss
  }

  action init: bool = {
    state' = {
      capacity: 3,
      process: ProcessUp,
      graphCandidate: flags(true),
      freshEntryConstraint: TASKS.mapBy(task => FreshEntryUnconstrained),
      continuationConstraint: TASKS.mapBy(task => NoContinuationConstraint),
      claimCycle: TASKS.mapBy(task => PrimaryClaimCycle),
      admission: TASKS.mapBy(task => Unoccupied),
      existingResponsibility: noResponsibilities,
      responsibilityOrder: numbers(0),
      journalClaimIntentPresent: flags(false),
      journalResponsibilityPresent: flags(false),
      ambiguousClaimIntentAppend: flags(false),
      ambiguousResponsibilityAppend: flags(false),
      trace: {
        entered: flags(false), admissionCapacity: numbers(0), admissionOrdinal: numbers(0),
        claimIntentAccepted: flags(false), claimCalled: flags(false), claimOwned: flags(false),
        specificationRead: flags(false), planRecorded: flags(false), worktreeCalled: flags(false),
        worktreeReadyAccepted: noWorktreeReadyEvidence,
        responsibilityBegan: flags(false),
        positionReleased: flags(false),
        preOwnershipRejected: flags(false),
        freshEntryBypassedReadyResponsibility: false,
        readyResponsibilityEnteredPastCapacity: false,
        blindClaimIntentReappend: false,
        blindResponsibilityReappend: false,
        processLosses: NoProcessLoss,
      },
    }
  }

  action reserveFreshEntryFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      freshEntryCapable(state, task),
      not(readyResponsibilityWaits(state)),
      not(lowerRankedFreshCandidateExists(state, task)),
      occupiedCount(state) < state.capacity,
      state' = {
        ...state,
        admission: state.admission.put(task, FreshEntryReserved),
        trace: {
          ...state.trace,
          entered: state.trace.entered.put(task, true),
          admissionCapacity: state.trace.admissionCapacity.put(task, state.capacity),
          admissionOrdinal: state.trace.admissionOrdinal.put(task, occupiedCount(state) + 1),
          freshEntryBypassedReadyResponsibility:
            state.trace.freshEntryBypassedReadyResponsibility or readyResponsibilityWaits(state),
        },
      },
    }
  }

  action recordClaimIntentFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == FreshEntryReserved,
      not(state.ambiguousClaimIntentAppend.get(task)),
      not(state.journalClaimIntentPresent.get(task)),
      state' = {
        ...state,
        admission: state.admission.put(task, currentClaimIntent(state, task)),
        journalClaimIntentPresent: state.journalClaimIntentPresent.put(task, true),
        ambiguousClaimIntentAppend: state.ambiguousClaimIntentAppend.put(task, false),
        trace: {
          ...state.trace,
          claimIntentAccepted: state.trace.claimIntentAccepted.put(task, true),
          blindClaimIntentReappend:
            state.trace.blindClaimIntentReappend or state.ambiguousClaimIntentAppend.get(task),
        },
      },
    }
  }

  action loseClaimIntentAppendResponseFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == FreshEntryReserved,
      not(state.ambiguousClaimIntentAppend.get(task)),
      state' = { ...state, ambiguousClaimIntentAppend: state.ambiguousClaimIntentAppend.put(task, true) },
    }
  }

  action loseAcceptedClaimIntentAppendResponseFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == FreshEntryReserved,
      not(state.ambiguousClaimIntentAppend.get(task)),
      state' = {
        ...state,
        journalClaimIntentPresent: state.journalClaimIntentPresent.put(task, true),
        ambiguousClaimIntentAppend: state.ambiguousClaimIntentAppend.put(task, true),
        trace: { ...state.trace, claimIntentAccepted: state.trace.claimIntentAccepted.put(task, true) },
      },
    }
  }

  action observeClaimIntentPresentFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == FreshEntryReserved,
      state.ambiguousClaimIntentAppend.get(task),
      state.journalClaimIntentPresent.get(task),
      state' = {
        ...state,
        admission: state.admission.put(task, currentClaimIntent(state, task)),
        ambiguousClaimIntentAppend: state.ambiguousClaimIntentAppend.put(task, false),
      },
    }
  }

  action observeClaimIntentAbsentFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == FreshEntryReserved,
      state.ambiguousClaimIntentAppend.get(task),
      not(state.journalClaimIntentPresent.get(task)),
      state' = {
        ...state,
        admission: state.admission.put(task, Unoccupied),
        ambiguousClaimIntentAppend: state.ambiguousClaimIntentAppend.put(task, false),
      },
    }
  }

  action callClaimProviderFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == currentClaimIntent(state, task),
      state' = {
        ...state,
        admission: state.admission.put(task, currentClaimCalled(state, task)),
        trace: { ...state.trace, claimCalled: state.trace.claimCalled.put(task, true) },
      },
    }
  }

  action acceptOwnedClaimFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == currentClaimCalled(state, task),
      state' = {
        ...state,
        admission: state.admission.put(task, exactClaimOwned(task)),
        trace: { ...state.trace, claimOwned: state.trace.claimOwned.put(task, true) },
      },
    }
  }

  action rejectForeignClaimFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == currentClaimCalled(state, task),
      state' = {
        ...state,
        admission: state.admission.put(task, Unoccupied),
        journalClaimIntentPresent:
          state.journalClaimIntentPresent.put(task, false),
        freshEntryConstraint:
          state.freshEntryConstraint.put(task, ForeignClaimConstraint),
        trace: { ...state.trace, preOwnershipRejected: state.trace.preOwnershipRejected.put(task, true) },
      },
    }
  }

  action observeForeignClaimClearedFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == Unoccupied,
      state.freshEntryConstraint.get(task) == ForeignClaimConstraint,
      state' = {
        ...state,
        freshEntryConstraint:
          state.freshEntryConstraint.put(task, FreshEntryUnconstrained),
        claimCycle: state.claimCycle.put(task, NextClaimCycle),
      },
    }
  }

  action acceptPostClaimGraphFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == exactClaimOwned(task),
      state' = { ...state, admission: state.admission.put(task, exactPostClaimGraph(task)) },
    }
  }
  action observePostOwnershipConstraintFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      ownsClaim(state.admission.get(task)),
      state' = {
        ...state,
        continuationConstraint:
          state.continuationConstraint.put(task, PostOwnershipConstrained),
      },
    }
  }
  action readFocusedSpecificationFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == exactPostClaimGraph(task),
      state' = {
        ...state, admission: state.admission.put(task, exactSpecification(task)),
        trace: { ...state.trace, specificationRead: state.trace.specificationRead.put(task, true) },
      },
    }
  }
  action recordAttemptPlanFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == exactSpecification(task),
      state' = {
        ...state, admission: state.admission.put(task, exactPlan(task)),
        trace: { ...state.trace, planRecorded: state.trace.planRecorded.put(task, true) },
      },
    }
  }
  action recordWorktreeIntentFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == exactPlan(task),
      state' = { ...state, admission: state.admission.put(task, exactWorktreeIntent(task)) },
    }
  }
  action callWorktreeBoundaryFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == exactWorktreeIntent(task),
      state' = {
        ...state,
        admission: state.admission.put(task, exactWorktreeCalled(task)),
        trace: { ...state.trace, worktreeCalled: state.trace.worktreeCalled.put(task, true) },
      },
    }
  }
  action acceptWorktreeReadyFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == exactWorktreeCalled(task),
      state' = {
        ...state,
        admission: state.admission.put(task, exactWorktreeReady(task)),
        trace: {
          ...state.trace,
          worktreeReadyAccepted: state.trace.worktreeReadyAccepted.put(
            task,
            AcceptedExactWorktreeReady({
              attemptId: attemptFor(task),
              baseSha: baseFor(task),
              locator: worktreeFor(task),
            }))
        },
      },
    }
  }

  // The TypeScript MBT treats the already-accepted claim-through-worktree
  // Journal prefix as one projection input. Provider chronology is exercised
  // by production scenario tests, not represented as no-op adapter calls.
  action projectAcceptedWorktreeReadyFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == currentClaimIntent(state, task),
      state' = {
        ...state,
        admission: state.admission.put(task, exactWorktreeReady(task)),
        trace: {
          ...state.trace,
          claimCalled: state.trace.claimCalled.put(task, true),
          claimOwned: state.trace.claimOwned.put(task, true),
          specificationRead: state.trace.specificationRead.put(task, true),
          planRecorded: state.trace.planRecorded.put(task, true),
          worktreeCalled: state.trace.worktreeCalled.put(task, true),
          worktreeReadyAccepted: state.trace.worktreeReadyAccepted.put(
            task,
            AcceptedExactWorktreeReady({
              attemptId: attemptFor(task),
              baseSha: baseFor(task),
              locator: worktreeFor(task),
            })
          ),
        },
      },
    }
  }

  action projectForeignClaimRejectionFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == currentClaimIntent(state, task),
      state' = {
        ...state,
        admission: state.admission.put(task, Unoccupied),
        journalClaimIntentPresent: state.journalClaimIntentPresent.put(task, false),
        freshEntryConstraint: state.freshEntryConstraint.put(task, ForeignClaimConstraint),
        trace: { ...state.trace, preOwnershipRejected: state.trace.preOwnershipRejected.put(task, true) },
      },
    }
  }

  // The accepted Journal event and exact position are one scheduling action.
  action loseExecutorResponsibilityAppendResponseFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == exactWorktreeReady(task),
      not(state.ambiguousResponsibilityAppend.get(task)),
      state' = {
        ...state,
        ambiguousResponsibilityAppend: state.ambiguousResponsibilityAppend.put(task, true),
      },
    }
  }

  action loseAcceptedExecutorResponsibilityAppendResponseFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == exactWorktreeReady(task),
      not(state.ambiguousResponsibilityAppend.get(task)),
      state' = {
        ...state,
        journalResponsibilityPresent: state.journalResponsibilityPresent.put(task, true),
        ambiguousResponsibilityAppend: state.ambiguousResponsibilityAppend.put(task, true),
        responsibilityOrder:
          state.responsibilityOrder.put(task, maxResponsibilityOrder(state) + 1),
        trace: {
          ...state.trace,
          responsibilityBegan: state.trace.responsibilityBegan.put(task, true),
        },
      },
    }
  }

  action observeExecutorResponsibilityAppendPresentFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == exactWorktreeReady(task),
      state.ambiguousResponsibilityAppend.get(task),
      state.journalResponsibilityPresent.get(task),
      state' = {
        ...state,
        admission: state.admission.put(task, ExactAttemptHeld(attemptFor(task))),
        existingResponsibility:
          state.existingResponsibility.put(task, RetainedNotReadyResponsibility(attemptFor(task))),
        ambiguousResponsibilityAppend: state.ambiguousResponsibilityAppend.put(task, false),
      },
    }
  }

  action observeExecutorResponsibilityAppendAbsentFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == exactWorktreeReady(task),
      state.ambiguousResponsibilityAppend.get(task),
      not(state.journalResponsibilityPresent.get(task)),
      state' = {
        ...state,
        ambiguousResponsibilityAppend: state.ambiguousResponsibilityAppend.put(task, false),
      },
    }
  }

  action handoffToExecutorResponsibilityFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == exactWorktreeReady(task),
      not(state.ambiguousResponsibilityAppend.get(task)),
      not(state.journalResponsibilityPresent.get(task)),
      state' = {
        ...state,
        admission: state.admission.put(task, ExactAttemptHeld(attemptFor(task))),
        journalResponsibilityPresent: state.journalResponsibilityPresent.put(task, true),
        existingResponsibility: state.existingResponsibility.put(task, RetainedNotReadyResponsibility(attemptFor(task))),
        ambiguousResponsibilityAppend: state.ambiguousResponsibilityAppend.put(task, false),
        responsibilityOrder:
          state.responsibilityOrder.put(task, maxResponsibilityOrder(state) + 1),
        trace: {
          ...state.trace,
          responsibilityBegan: state.trace.responsibilityBegan.put(task, true),
          blindResponsibilityReappend:
            state.trace.blindResponsibilityReappend or state.ambiguousResponsibilityAppend.get(task),
        },
      },
    }
  }

  action releaseHeldPositionNotReadyFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == ExactAttemptHeld(attemptFor(task)),
      state' = {
        ...state,
        admission: state.admission.put(task, Unoccupied),
        existingResponsibility: state.existingResponsibility.put(task, RetainedNotReadyResponsibility(attemptFor(task))),
        continuationConstraint:
          state.continuationConstraint.put(task, NoContinuationConstraint),
        trace: { ...state.trace, positionReleased: state.trace.positionReleased.put(task, true) },
      },
    }
  }
  action releaseHeldPositionReadyFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == ExactAttemptHeld(attemptFor(task)),
      state' = {
        ...state,
        admission: state.admission.put(task, Unoccupied),
        existingResponsibility: state.existingResponsibility.put(task, ReadyExistingResponsibility(attemptFor(task))),
        continuationConstraint:
          state.continuationConstraint.put(task, NoContinuationConstraint),
        trace: { ...state.trace, positionReleased: state.trace.positionReleased.put(task, true) },
      },
    }
  }
  action reserveReadyResponsibilityFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == Unoccupied,
      state.existingResponsibility.get(task) == ReadyExistingResponsibility(attemptFor(task)),
      not(earlierReadyResponsibilityExists(state, task)),
      occupiedCount(state) < state.capacity,
      state' = {
        ...state,
        admission: state.admission.put(task, ExistingResponsibilityReserved(attemptFor(task))),
        trace: {
          ...state.trace,
          readyResponsibilityEnteredPastCapacity:
            state.trace.readyResponsibilityEnteredPastCapacity or occupiedCount(state) >= state.capacity,
        },
      },
    }
  }
  action handoffReadyResponsibilityFor(task: TaskId): bool = {
    all {
      state.process == ProcessUp,
      state.admission.get(task) == ExistingResponsibilityReserved(attemptFor(task)),
      state.existingResponsibility.get(task) == ReadyExistingResponsibility(attemptFor(task)),
      state' = {
        ...state,
        admission: state.admission.put(task, ExactAttemptHeld(attemptFor(task))),
        existingResponsibility:
          state.existingResponsibility.put(task, RetainedNotReadyResponsibility(attemptFor(task))),
        trace: { ...state.trace, positionReleased: state.trace.positionReleased.put(task, false) },
      },
    }
  }

  action contractCapacity: bool = all {
    state.process == ProcessUp,
    state.capacity > 1,
    state' = { ...state, capacity: state.capacity - 1 },
  }
  action expandCapacity: bool = all {
    state.process == ProcessUp,
    state.capacity < 3,
    state' = { ...state, capacity: state.capacity + 1 },
  }
  action crash: bool = all {
    state.process == ProcessUp,
    state' = {
      ...state,
      process: ProcessDown,
      trace: {
        ...state.trace,
        processLosses: recordProcessLoss(state.trace.processLosses),
      },
    },
  }
  action recover: bool = all {
    state.process == ProcessDown,
    state' = {
      ...state,
      process: ProcessUp,
      admission: TASKS.mapBy(task => recoveredAdmission(state, task)),
      existingResponsibility:
        TASKS.mapBy(task => crashExistingResponsibility(state, task)),
      ambiguousClaimIntentAppend: flags(false),
      ambiguousResponsibilityAppend: flags(false),
    },
  }

  // These exported wrappers retain the original nondeterministic action
  // surface used by the proof and collected tests. The parameterized actions
  // above are behavior-preserving MBT instrumentation: they expose the chosen
  // task identity to the production driver without adding model authority.
  action reserveFreshEntry: bool = { nondet task = TASKS.oneOf() reserveFreshEntryFor(task) }
  action recordClaimIntent: bool = { nondet task = TASKS.oneOf() recordClaimIntentFor(task) }
  action loseClaimIntentAppendResponse: bool = { nondet task = TASKS.oneOf() loseClaimIntentAppendResponseFor(task) }
  action loseAcceptedClaimIntentAppendResponse: bool = { nondet task = TASKS.oneOf() loseAcceptedClaimIntentAppendResponseFor(task) }
  action observeClaimIntentPresent: bool = { nondet task = TASKS.oneOf() observeClaimIntentPresentFor(task) }
  action observeClaimIntentAbsent: bool = { nondet task = TASKS.oneOf() observeClaimIntentAbsentFor(task) }
  action callClaimProvider: bool = { nondet task = TASKS.oneOf() callClaimProviderFor(task) }
  action acceptOwnedClaim: bool = { nondet task = TASKS.oneOf() acceptOwnedClaimFor(task) }
  action rejectForeignClaim: bool = { nondet task = TASKS.oneOf() rejectForeignClaimFor(task) }
  action observeForeignClaimCleared: bool = { nondet task = TASKS.oneOf() observeForeignClaimClearedFor(task) }
  action acceptPostClaimGraph: bool = { nondet task = TASKS.oneOf() acceptPostClaimGraphFor(task) }
  action observePostOwnershipConstraint: bool = { nondet task = TASKS.oneOf() observePostOwnershipConstraintFor(task) }
  action readFocusedSpecification: bool = { nondet task = TASKS.oneOf() readFocusedSpecificationFor(task) }
  action recordAttemptPlan: bool = { nondet task = TASKS.oneOf() recordAttemptPlanFor(task) }
  action recordWorktreeIntent: bool = { nondet task = TASKS.oneOf() recordWorktreeIntentFor(task) }
  action callWorktreeBoundary: bool = { nondet task = TASKS.oneOf() callWorktreeBoundaryFor(task) }
  action acceptWorktreeReady: bool = { nondet task = TASKS.oneOf() acceptWorktreeReadyFor(task) }
  action loseExecutorResponsibilityAppendResponse: bool = { nondet task = TASKS.oneOf() loseExecutorResponsibilityAppendResponseFor(task) }
  action loseAcceptedExecutorResponsibilityAppendResponse: bool = { nondet task = TASKS.oneOf() loseAcceptedExecutorResponsibilityAppendResponseFor(task) }
  action observeExecutorResponsibilityAppendPresent: bool = { nondet task = TASKS.oneOf() observeExecutorResponsibilityAppendPresentFor(task) }
  action observeExecutorResponsibilityAppendAbsent: bool = { nondet task = TASKS.oneOf() observeExecutorResponsibilityAppendAbsentFor(task) }
  action handoffToExecutorResponsibility: bool = { nondet task = TASKS.oneOf() handoffToExecutorResponsibilityFor(task) }
  action releaseHeldPositionNotReady: bool = { nondet task = TASKS.oneOf() releaseHeldPositionNotReadyFor(task) }
  action releaseHeldPositionReady: bool = { nondet task = TASKS.oneOf() releaseHeldPositionReadyFor(task) }
  action reserveReadyResponsibility: bool = { nondet task = TASKS.oneOf() reserveReadyResponsibilityFor(task) }
  action handoffReadyResponsibility: bool = { nondet task = TASKS.oneOf() handoffReadyResponsibilityFor(task) }

  // These restate the requirements rather than calling scheduling guards.
  val everyEntryWasWithinItsObservedCapacity = TASKS.forall(task =>
    not(state.trace.entered.get(task)) or and {
      state.trace.admissionOrdinal.get(task) >= 1,
      state.trace.admissionOrdinal.get(task) <= state.trace.admissionCapacity.get(task),
    }
  )
  val stableFreshEntryOrder = and {
    not(state.trace.entered.get(TaskB)) or state.trace.entered.get(TaskA),
    not(state.trace.entered.get(TaskC)) or and { state.trace.entered.get(TaskA), state.trace.entered.get(TaskB) },
    not(state.trace.entered.get(TaskD)) or and { state.trace.entered.get(TaskA), state.trace.entered.get(TaskB), state.trace.entered.get(TaskC) },
    not(state.trace.entered.get(TaskE)) or and { state.trace.entered.get(TaskA), state.trace.entered.get(TaskB), state.trace.entered.get(TaskC), state.trace.entered.get(TaskD) },
  }
  val claimCallsRequireAcceptedIntent = TASKS.forall(task => not(state.trace.claimCalled.get(task)) or state.trace.claimIntentAccepted.get(task))
  val ambiguousClaimIntentRetainsEntryReservation = TASKS.forall(task =>
    not(state.ambiguousClaimIntentAppend.get(task)) or state.admission.get(task) == FreshEntryReserved
  )
  val ownedClaimsRequireClaimCalls = TASKS.forall(task => not(state.trace.claimOwned.get(task)) or state.trace.claimCalled.get(task))
  val specificationsRequireOwnedClaims = TASKS.forall(task => not(state.trace.specificationRead.get(task)) or state.trace.claimOwned.get(task))
  val plansRequireSpecifications = TASKS.forall(task => not(state.trace.planRecorded.get(task)) or state.trace.specificationRead.get(task))
  val worktreeCallsRequirePlans = TASKS.forall(task => not(state.trace.worktreeCalled.get(task)) or state.trace.planRecorded.get(task))
  val responsibilitiesRequireAcceptedExactWorktreeReady = TASKS.forall(task =>
    not(state.trace.responsibilityBegan.get(task)) or
      state.trace.worktreeReadyAccepted.get(task) == AcceptedExactWorktreeReady({
        attemptId: attemptFor(task),
        baseSha: baseFor(task),
        locator: worktreeFor(task),
      })
  )
  val responsibilityHandoffNeverCreatesAdmissionGap = TASKS.forall(task =>
    not(state.trace.responsibilityBegan.get(task)) or or {
      state.admission.get(task) == ExactAttemptHeld(attemptFor(task)),
      state.admission.get(task) == ExistingResponsibilityReserved(attemptFor(task)),
      and {
        state.admission.get(task) == exactWorktreeReady(task),
        state.journalResponsibilityPresent.get(task),
        state.ambiguousResponsibilityAppend.get(task),
      },
      state.trace.positionReleased.get(task),
    }
  )
  val ambiguousResponsibilityAppendRetainsCommitment = TASKS.forall(task =>
    not(state.ambiguousResponsibilityAppend.get(task)) or state.admission.get(task) == exactWorktreeReady(task)
  )
  val ambiguityRequiresReconciliationBeforeReappend = and {
    not(state.trace.blindClaimIntentReappend),
    not(state.trace.blindResponsibilityReappend),
  }
  val durableCommitmentHasExactDisposition = TASKS.forall(task =>
    not(state.journalClaimIntentPresent.get(task)) or or {
      state.admission.get(task) != Unoccupied,
      state.trace.positionReleased.get(task),
    }
  )
  val currentOccupancyHasOneClosedRepresentation = TASKS.forall(task => or {
    state.admission.get(task) == Unoccupied,
    state.admission.get(task) == FreshEntryReserved,
    state.admission.get(task) == ExistingResponsibilityReserved(attemptFor(task)),
    state.admission.get(task) == ExactAttemptHeld(attemptFor(task)),
    state.admission.get(task) == currentClaimIntent(state, task),
    state.admission.get(task) == currentClaimCalled(state, task),
    state.admission.get(task) == exactClaimOwned(task),
    state.admission.get(task) == exactPostClaimGraph(task),
    state.admission.get(task) == exactSpecification(task),
    state.admission.get(task) == exactPlan(task),
    state.admission.get(task) == exactWorktreeIntent(task),
    state.admission.get(task) == exactWorktreeCalled(task),
    state.admission.get(task) == exactWorktreeReady(task),
  })
  val existingResponsibilityInputIsExactlyCorrelated = TASKS.forall(task => and {
    or {
      state.existingResponsibility.get(task) == NoExistingResponsibility,
      and {
        state.existingResponsibility.get(task) == ReadyExistingResponsibility(attemptFor(task)),
        state.responsibilityOrder.get(task) >= 1,
      },
      and {
        state.existingResponsibility.get(task) == RetainedNotReadyResponsibility(attemptFor(task)),
        state.responsibilityOrder.get(task) >= 1,
      },
    },
    match state.admission.get(task) {
      | FreshEntryReserved => state.existingResponsibility.get(task) == NoExistingResponsibility
      | FreshTaskCommitted(_) => state.existingResponsibility.get(task) == NoExistingResponsibility
      | ExistingResponsibilityReserved(attempt) => and {
          attempt == attemptFor(task),
          state.existingResponsibility.get(task) == ReadyExistingResponsibility(attemptFor(task)),
        }
      | ExactAttemptHeld(attempt) => and {
          attempt == attemptFor(task),
          state.existingResponsibility.get(task) == RetainedNotReadyResponsibility(attemptFor(task)),
        }
      | Unoccupied => true
    },
  })
  val retainedReadyResponsibilityBlocksFreshEntry =
    not(state.trace.freshEntryBypassedReadyResponsibility)
  val readyResponsibilityEntryRespectsCapacity =
    not(state.trace.readyResponsibilityEnteredPastCapacity)
  val foreignClaimConstraintPreventsOccupancy = TASKS.forall(task =>
    state.freshEntryConstraint.get(task) != ForeignClaimConstraint or
      state.admission.get(task) == Unoccupied
  )
  val newClaimCycleNeverReusesRejectedOperation = TASKS.forall(task =>
    not(reusesPrimaryClaimOperationInNextCycle(state, task))
  )
  val postOwnershipConstraintRetainsOccupancy = TASKS.forall(task =>
    state.continuationConstraint.get(task) != PostOwnershipConstrained or
      isOccupied(state.admission.get(task))
  )
  val modelStateIsFiniteAndClosed = and {
    state.capacity >= 1,
    state.capacity <= 3,
    or { state.process == ProcessUp, state.process == ProcessDown },
  }

  val threeFreshEntriesReached = and { state.trace.entered.get(TaskA), state.trace.entered.get(TaskB), state.trace.entered.get(TaskC) }
  val outsideTaskEnteredReached = state.trace.entered.get(TaskD)
  val claimIntentReached = TASKS.exists(task => state.admission.get(task) == exactClaimIntent(task))
  val claimOwnedReached = TASKS.exists(task => state.admission.get(task) == exactClaimOwned(task))
  val specificationReached = TASKS.exists(task => state.admission.get(task) == exactSpecification(task))
  val planReached = TASKS.exists(task => state.admission.get(task) == exactPlan(task))
  val worktreeIntentReached = TASKS.exists(task => state.admission.get(task) == exactWorktreeIntent(task))
  val worktreeReadyReached = TASKS.exists(task => state.admission.get(task) == exactWorktreeReady(task))
  val executorResponsibilityReached = TASKS.exists(task => state.admission.get(task) == ExactAttemptHeld(attemptFor(task)))
  val conclusiveRejectionReached = TASKS.exists(task => state.trace.preOwnershipRejected.get(task))
  val foreignConstraintClearedReached = TASKS.exists(task => and {
    state.trace.preOwnershipRejected.get(task),
    state.freshEntryConstraint.get(task) == FreshEntryUnconstrained,
  })
  val postOwnershipConstraintReached = TASKS.exists(task => and {
    state.continuationConstraint.get(task) == PostOwnershipConstrained,
    state.graphCandidate.get(task),
    state.admission.get(task) != Unoccupied,
  })
  val ambiguousIntentReached = TASKS.exists(task => state.ambiguousClaimIntentAppend.get(task))
  val acceptedIntentResponseLostReached = TASKS.exists(task => and {
    state.ambiguousClaimIntentAppend.get(task), state.journalClaimIntentPresent.get(task),
  })
  val acceptedResponsibilityResponseLostReached = TASKS.exists(task => and {
    state.ambiguousResponsibilityAppend.get(task), state.journalResponsibilityPresent.get(task),
  })
  val reconstructedResponsibilityAfterLossReached = TASKS.exists(task => and {
    state.trace.processLosses != NoProcessLoss,
    state.journalResponsibilityPresent.get(task),
    state.admission.get(task) == ExactAttemptHeld(attemptFor(task)),
  })
  val readyResponsibilityReached = TASKS.exists(task => readyExistingResponsibility(state.existingResponsibility.get(task)))
  val readyResponsibilityReservedReached = TASKS.exists(task => state.admission.get(task) == ExistingResponsibilityReserved(attemptFor(task)))
  val processLossReached = state.trace.processLosses != NoProcessLoss
  val repeatedProcessLossReached = state.trace.processLosses == RepeatedProcessLoss
  val contractionReached = state.capacity == 1

  action step: bool = any {
    reserveFreshEntry, recordClaimIntent, loseClaimIntentAppendResponse,
    loseAcceptedClaimIntentAppendResponse, observeClaimIntentPresent,
    observeClaimIntentAbsent,
    callClaimProvider, acceptOwnedClaim, rejectForeignClaim, observeForeignClaimCleared,
    acceptPostClaimGraph,
    observePostOwnershipConstraint,
    readFocusedSpecification, recordAttemptPlan, recordWorktreeIntent, callWorktreeBoundary,
    acceptWorktreeReady, loseExecutorResponsibilityAppendResponse,
    loseAcceptedExecutorResponsibilityAppendResponse,
    observeExecutorResponsibilityAppendPresent,
    observeExecutorResponsibilityAppendAbsent, handoffToExecutorResponsibility,
    releaseHeldPositionNotReady,
    releaseHeldPositionReady, reserveReadyResponsibility, handoffReadyResponsibility,
    contractCapacity, expandCapacity, crash, recover,
  }

  // Executable conformance uses the same transition relations as `step`, but
  // reports the chosen task as an action argument. Its surface contains only
  // production admission/controller operations and accepted-Journal projection;
  // the full provider chronology remains in `step` and production scenarios.
  action acceptedClaimRecoveryMbtStep: bool = {
    nondet task = Set(TaskA).oneOf()
    any {
      reserveFreshEntryFor(task),
      loseAcceptedClaimIntentAppendResponseFor(task),
      observeClaimIntentPresentFor(task),
    }
  }

  action acceptedResponsibilityRecoveryMbtStep: bool = {
    nondet task = Set(TaskA).oneOf()
    any {
      reserveFreshEntryFor(task), recordClaimIntentFor(task),
      projectAcceptedWorktreeReadyFor(task),
      loseAcceptedExecutorResponsibilityAppendResponseFor(task),
      observeExecutorResponsibilityAppendPresentFor(task),
    }
  }

  action absentResponsibilityRecoveryMbtStep: bool = {
    nondet task = Set(TaskA).oneOf()
    any {
      reserveFreshEntryFor(task), recordClaimIntentFor(task),
      projectAcceptedWorktreeReadyFor(task),
      loseExecutorResponsibilityAppendResponseFor(task),
      observeExecutorResponsibilityAppendAbsentFor(task),
    }
  }

  action notReadyReleaseMbtStep: bool = {
    nondet task = Set(TaskA).oneOf()
    any {
      reserveFreshEntryFor(task), recordClaimIntentFor(task),
      projectAcceptedWorktreeReadyFor(task), handoffToExecutorResponsibilityFor(task),
      releaseHeldPositionNotReadyFor(task),
    }
  }

  action readyResponsibilityHandoffMbtStep: bool = {
    nondet task = Set(TaskA).oneOf()
    any {
      reserveFreshEntryFor(task), recordClaimIntentFor(task),
      projectAcceptedWorktreeReadyFor(task), handoffToExecutorResponsibilityFor(task),
      releaseHeldPositionReadyFor(task), reserveReadyResponsibilityFor(task),
      handoffReadyResponsibilityFor(task),
    }
  }

  action mbtStep: bool = {
    nondet task = TASKS.oneOf()
    if (TASKS.exists(candidate =>
      state.ambiguousClaimIntentAppend.get(candidate) or state.ambiguousResponsibilityAppend.get(candidate))) {
      any {
        observeClaimIntentPresentFor(task),
        observeExecutorResponsibilityAppendPresentFor(task),
        crash,
      }
    } else {
      any {
        reserveFreshEntryFor(task), recordClaimIntentFor(task),
        loseAcceptedClaimIntentAppendResponseFor(task),
        projectForeignClaimRejectionFor(task), observeForeignClaimClearedFor(task),
        projectAcceptedWorktreeReadyFor(task), loseAcceptedExecutorResponsibilityAppendResponseFor(task),
        handoffToExecutorResponsibilityFor(task), releaseHeldPositionNotReadyFor(task),
        releaseHeldPositionReadyFor(task), reserveReadyResponsibilityFor(task), handoffReadyResponsibilityFor(task),
        contractCapacity, expandCapacity, crash, recover,
      }
    }
  }

}
