// Canonical bounded graph-frontier recovery composition model.
//
// The model keeps authority, durable knowledge, workflow history, control
// commands, and process-local coordination as distinct subrecords. They share
// one top-level variable only to make every Quint action update one cohesive
// model value.
module frontierRecovery {
  // The process supplies the currently configured task-work limit when it
  // instantiates a checking or executable-conformance profile. The workflow
  // journal never supplies or records this projection.
  const CAPACITY: int

  type TaskId = int

  type Boundary =
    | ClaimBoundary
    | WorktreeBoundary
    | SessionBoundary
    | InvocationBoundary
    | PromotionBoundary
    | CompletionClaimBoundary
    | CompletionBoundary
    | ClaimDeleteBoundary
    | NoBoundary

  type Lifecycle = Open | Completed | Closed
  type Claim = Unclaimed | ActiveClaim | CompletionClaim | ForeignClaim
  type Availability = Missing | Available
  type Invocation = NoInvocation | RunningInvocation | AcceptedInvocation | InterruptedInvocation
  type ExecutorOuterInvocationResourceUse =
    | DoesNotUseTaskWorkCapacity
    | UsesOneTaskWorkCapacityPosition
  type Readability = Readable | Unreadable | Conflicting
  type Observation = NeverObserved | UsableObservation | UnreadableObservation | ConflictingObservation
  type Responsibility = Unowned | Outstanding | Settled | Relinquished

  // Capacity is declared by the executor's outer invocation. Internal
  // protocol names and artifacts cannot change this projection.
  pure def executorOuterInvocationCapacityPositions(
    resourceUse: ExecutorOuterInvocationResourceUse
  ): int =
    match resourceUse {
      | DoesNotUseTaskWorkCapacity => 0
      | UsesOneTaskWorkCapacityPosition => 1
    }

  val executorOuterInvocationCapacityUseIsDeclared: bool = and {
    executorOuterInvocationCapacityPositions(
      DoesNotUseTaskWorkCapacity
    ) == 0,
    executorOuterInvocationCapacityPositions(
      UsesOneTaskWorkCapacityPosition
    ) == 1,
  }
  type Isolation =
    | NotIsolated
    | ClaimAuthorityIsolated
    | WorktreeLostIsolated
    | GitLineageIsolated
    | LifecycleIsolated
    | MembershipIsolated
    | ObservationIsolated
    | RequestDidNotConvergeIsolated

  type AttemptOutcome = AttemptPending | AttemptAccepted | AttemptWorktreeLost | AttemptAbandoned
  type TaskSettlement = TaskUnsettled | TrackerCompleted | ResponsibilityRelinquished
  type TargetClosureCompleteness = Complete(())
  type TargetClosureConsistency = PotentiallyMixedTime(())
  type TargetClosureFactFamily = TargetMembership(())
  type TargetClosureFreshness = FreshAtReadBoundary(())
  type TargetClosureReadShape = TargetClosureMembership(())
  type ReconstructionTarget = FrontierRecoveryTargetClosure(())
  // Evidence shared by every normalized target-closure membership read.
  type TargetClosureReadEvidence = {
    completeness: TargetClosureCompleteness,
    consistency: TargetClosureConsistency,
    factFamily: TargetClosureFactFamily,
    freshness: TargetClosureFreshness,
    operationId: int,
    readShape: TargetClosureReadShape,
    revision: int,
    returnedTaskIds: Set[TaskId],
  }

  // The last bounded target-closure observation emitted to the conformance
  // adapter. Profile-specific fields exist only where they are meaningful.
  type ReconstructionGraphEvidence =
    | InitialReconstructionGraphObservation(TargetClosureReadEvidence)
    | CompatibleReplacementGraphObservation(TargetClosureReadEvidence)
    | IncomparableMembershipGraphObservation({
        read: TargetClosureReadEvidence,
        predecessorOperationIds: Set[int],
      })
    | ProvenAbsenceGraphObservation({
        read: TargetClosureReadEvidence,
        explicitlyCoveredTaskIds: Set[TaskId],
      })

  type ReconstructedTargetClosureObservation = {
    completeness: TargetClosureCompleteness,
    consistency: TargetClosureConsistency,
    factFamily: TargetClosureFactFamily,
    freshness: TargetClosureFreshness,
    observedAt: int,
    read: TargetClosureReadEvidence,
    explicitlyCoveredTaskIds: Set[TaskId],
    provenAbsentTaskIds: Set[TaskId],
    target: ReconstructionTarget,
  }

  type ReconstructionGraphKnowledge =
    | ReconstructedTargetClosureObserved(ReconstructedTargetClosureObservation)
    | ReconstructedTargetClosureConflict({
        observations: List[ReconstructedTargetClosureObservation],
      })

  type ReconstructionClaimOwner = FrontierRecoveryClaimOwner(())
  type ReconstructionClaimToken = FrontierRecoveryClaimToken({ taskId: TaskId })

  type ReconstructionWorkflowRecord =
    | ReconstructionGraphObservationIntent({
        position: int,
        operationId: int,
        predecessorOperationIds: Set[int],
        explicitlyCoveredTaskIds: Set[TaskId],
      })
    | ReconstructionGraphOutcome({
        position: int,
        operationId: int,
        revision: int,
        returnedTaskIds: Set[TaskId],
      })
    | ReconstructionClaimIntent({
        position: int,
        operationId: int,
        taskId: TaskId,
        predecessorOperationIds: Set[int],
        owner: ReconstructionClaimOwner,
        token: ReconstructionClaimToken,
      })

  type ReconstructionResponsibility =
    | NoReconstructionResponsibility
    | ReconstructionClaimResponsibility({
        beganAt: int,
        operationId: int,
        taskId: TaskId,
        owner: ReconstructionClaimOwner,
        token: ReconstructionClaimToken,
      })

  // Facts currently owned by the task tracker, Git, or executor provider.
  type Authority = {
    lifecycle: Lifecycle,
    claim: Claim,
    worktree: Availability,
    session: Availability,
    invocation: Invocation,
    promoted: bool,
    baseCompatible: bool,
    blockers: Set[TaskId],
    inTarget: bool,
    readability: Readability,
    revision: int,
  }

  // Best available durable knowledge reconstructed from normalized reads.
  type Knowledge = {
    fact: Authority,
    observation: Observation,
    durableRevision: int,
    observedAuthorityRevision: int,
    activation: int,
    runControlEpoch: int,
    taskControlEpoch: int,
  }

  // Durable workflow facts and the exact responsibility they induce.
  type Workflow = {
    boundary: Boundary,
    operationId: int,
    intentCommitted: bool,
    requestAuthorized: bool,
    observationRequired: bool,
    requestCount: int,
    unreadableCount: int,
    responsibility: Responsibility,
    isolation: Isolation,
    attemptOutcome: AttemptOutcome,
    settlement: TaskSettlement,
    executorResourceUse: ExecutorOuterInvocationResourceUse,
  }

  // Durable user commands. Pause phases and grouping coverage are derived.
  type Control = {
    runPaused: bool,
    runControlEpoch: int,
    taskPaused: TaskId -> bool,
    taskControlEpoch: TaskId -> int,
  }

  // Process-local coordination state. It is reconstructed after a crash.
  type Coordinator = {
    running: bool,
    activation: int,
    crashCount: int,
  }

  type ActivationOwner =
    | NoActivationOwner
    | PreIntentActivationOwner(())
    | PostIntentActivationOwner({ operationId: int })

  type ActivationPosition =
    | ActivationPositionAvailable
    | ActivationPositionReserved({ selectedTaskId: TaskId })
    | ActivationPositionRetained({ operationId: int })
    | ActivationPositionOccupied({ operationId: int })

  type ActivationReleaseCorrelation =
    | NoActivationRelease
    | ActivationReleaseObserved({
        requestedOperationId: int,
        affectedOperationId: int,
      })

  // Process-local activation coordination remains separate from durable
  // workflow responsibility and fresh provider consumption evidence.
  type Activation = {
    triggerPending: bool,
    derivedTransitions: Set[TaskId],
    selectedTransitions: Set[TaskId],
    activationInProgress: Set[TaskId],
    positions: TaskId -> ActivationPosition,
    owners: TaskId -> ActivationOwner,
    ownerRegistrationCounts: TaskId -> int,
    runners: Set[TaskId],
    providerConsuming: Set[TaskId],
    postIntentExited: Set[TaskId],
    freshlyObservedCapacity: Set[TaskId],
    resultsRecorded: Set[TaskId],
    isolatedSubjects: Set[TaskId],
    duplicateReservationLeaks: Set[TaskId],
    preIntentInterrupted: Set[TaskId],
    lastReleaseCorrelation: ActivationReleaseCorrelation,
    configuredCapacity: int,
  }

  type TransitionOperation =
    | FreshTransitionWithoutOperation(())
    | DurableTransitionOperation({ operationId: int })

  // Exact scheduler result exported for the M2 executable adapter.
  type SelectorProjection = {
    capacity: int,
    frontierTaskIds: Set[TaskId],
    admittedTaskIds: Set[TaskId],
    executorResourceUses: TaskId -> ExecutorOuterInvocationResourceUse,
    transitionTags: TaskId -> str,
    transitionOperations: TaskId -> TransitionOperation,
    explanations: Set[{
      taskId: TaskId,
      tag: str,
      wakeCondition: str,
    }],
    reservationTaskIds: Set[TaskId],
    occupiedTaskIds: Set[TaskId],
  }

  type State = {
    authority: TaskId -> Authority,
    knowledge: TaskId -> Knowledge,
    workflow: TaskId -> Workflow,
    intents: TaskId -> Boundary -> Set[int],
    requestOperationIds: TaskId -> Boundary -> Set[int],
    effectOperationIds: TaskId -> Boundary -> Set[int],
    effects: TaskId -> Boundary -> int,
    control: Control,
    coordinator: Coordinator,
    activation: Activation,
    nextKnowledgeRevision: int,
    requestFreshnessViolations: int,
    duplicateEffectViolations: int,
    reconstructionGraphEvidence: ReconstructionGraphEvidence,
    reconstructionGraphKnowledge: ReconstructionGraphKnowledge,
    reconstructionWorkflowHistory: List[ReconstructionWorkflowRecord],
    reconstructionResponsibility: TaskId -> ReconstructionResponsibility,
    selectorProjection: SelectorProjection,
  }

  pure val A: TaskId = 0
  pure val B: TaskId = 1
  pure val C: TaskId = 2
  pure val D: TaskId = 3
  pure val TASKS: Set[TaskId] = Set(A, B, C, D)
  pure val BOUNDARIES: Set[Boundary] =
    Set(
      ClaimBoundary,
      WorktreeBoundary,
      SessionBoundary,
      InvocationBoundary,
      PromotionBoundary,
      CompletionClaimBoundary,
      CompletionBoundary,
      ClaimDeleteBoundary
    )

  pure val REQUEST_BOUND: int = 2
  pure val READ_BOUND: int = 2
  pure val MAX_AUTHORITY_REVISION: int = 16
  pure val MAX_CONTROL_EPOCH: int = 2
  pure val MAX_CRASHES: int = 1

  pure def initialAuthority(task: TaskId): Authority = {
    val initialBlockers = if (task == B) Set(A) else Set()
    {
      lifecycle: Open,
      claim: Unclaimed,
      worktree: Missing,
      session: Missing,
      invocation: NoInvocation,
      promoted: false,
      baseCompatible: true,
      blockers: initialBlockers,
      inTarget: true,
      readability: Readable,
      revision: 0,
    }
  }

  pure def initialKnowledge(task: TaskId): Knowledge = {
    val fact = initialAuthority(task)
    {
      fact: fact,
      observation: UsableObservation,
      durableRevision: 0,
      observedAuthorityRevision: fact.revision,
      activation: 0,
      runControlEpoch: 0,
      taskControlEpoch: 0,
    }
  }

  pure def initialWorkflow(task: TaskId): Workflow = {
    boundary: ClaimBoundary,
    operationId: if (task == C) 3 else 1,
    intentCommitted: false,
    requestAuthorized: false,
    observationRequired: false,
    requestCount: 0,
    unreadableCount: 0,
    responsibility: Unowned,
    isolation: NotIsolated,
    attemptOutcome: AttemptPending,
    settlement: TaskUnsettled,
    executorResourceUse: UsesOneTaskWorkCapacityPosition,
  }

  pure def initialControl: Control = {
    runPaused: false,
    runControlEpoch: 0,
    taskPaused: TASKS.mapBy(_ => false),
    taskControlEpoch: TASKS.mapBy(_ => 0),
  }

  pure def initialActivation: Activation = {
    triggerPending: true,
    derivedTransitions: Set(),
    selectedTransitions: Set(),
    activationInProgress: Set(),
    positions: TASKS.mapBy(_ => ActivationPositionAvailable),
    owners: TASKS.mapBy(_ => NoActivationOwner),
    ownerRegistrationCounts: TASKS.mapBy(_ => 0),
    runners: Set(),
    providerConsuming: Set(),
    postIntentExited: Set(),
    freshlyObservedCapacity: Set(),
    resultsRecorded: Set(),
    isolatedSubjects: Set(),
    duplicateReservationLeaks: Set(),
    preIntentInterrupted: Set(),
    lastReleaseCorrelation: NoActivationRelease,
    configuredCapacity: CAPACITY,
  }

  pure val initialTargetClosureRead: TargetClosureReadEvidence = {
    completeness: Complete(()),
    consistency: PotentiallyMixedTime(()),
    factFamily: TargetMembership(()),
    freshness: FreshAtReadBoundary(()),
    operationId: 0,
    readShape: TargetClosureMembership(()),
    revision: 0,
    returnedTaskIds: TASKS,
  }

  pure val initialTargetClosureObservation: ReconstructedTargetClosureObservation = {
    completeness: Complete(()),
    consistency: PotentiallyMixedTime(()),
    factFamily: TargetMembership(()),
    freshness: FreshAtReadBoundary(()),
    observedAt: 2,
    read: initialTargetClosureRead,
    explicitlyCoveredTaskIds: Set(),
    provenAbsentTaskIds: Set(),
    target: FrontierRecoveryTargetClosure(()),
  }

  pure def initialState: State = {
    authority: TASKS.mapBy(initialAuthority),
    knowledge: TASKS.mapBy(initialKnowledge),
    workflow: TASKS.mapBy(initialWorkflow),
    intents: TASKS.mapBy(_ => BOUNDARIES.mapBy(_ => Set())),
    requestOperationIds: TASKS.mapBy(_ => BOUNDARIES.mapBy(_ => Set())),
    effectOperationIds: TASKS.mapBy(_ => BOUNDARIES.mapBy(_ => Set())),
    effects: TASKS.mapBy(_ => BOUNDARIES.mapBy(_ => 0)),
    control: initialControl,
    coordinator: { running: true, activation: 0, crashCount: 0 },
    activation: initialActivation,
    nextKnowledgeRevision: 1,
    requestFreshnessViolations: 0,
    duplicateEffectViolations: 0,
    reconstructionGraphEvidence:
      InitialReconstructionGraphObservation(initialTargetClosureRead),
    reconstructionGraphKnowledge:
      ReconstructedTargetClosureObserved(initialTargetClosureObservation),
    reconstructionWorkflowHistory: List(
      ReconstructionGraphObservationIntent({
        position: 1,
        operationId: 0,
        predecessorOperationIds: Set(),
        explicitlyCoveredTaskIds: Set(),
      }),
      ReconstructionGraphOutcome({
        position: 2,
        operationId: 0,
        revision: 0,
        returnedTaskIds: TASKS,
      })
    ),
    reconstructionResponsibility:
      TASKS.mapBy(_ => NoReconstructionResponsibility),
    selectorProjection: computeSelectorProjection(
      TASKS.mapBy(initialWorkflow),
      TASKS.mapBy(initialKnowledge),
      initialControl
    ),
  }

  pure def isGroupingPaused(s: State, task: TaskId): bool =
    s.control.taskPaused.get(task) or (task == D and s.control.taskPaused.get(A))

  pure def effectiveTaskControlEpoch(s: State, task: TaskId): int =
    s.control.taskControlEpoch.get(task)
      + (if (task == D) s.control.taskControlEpoch.get(A) else 0)

  pure def knowledgeIsUsable(s: State, task: TaskId): bool = {
    val k = s.knowledge.get(task)
    val a = s.authority.get(task)
    and {
      k.observation == UsableObservation,
      k.observedAuthorityRevision == a.revision,
      k.activation == s.coordinator.activation,
      k.runControlEpoch == s.control.runControlEpoch,
      k.taskControlEpoch == effectiveTaskControlEpoch(s, task),
    }
  }

  pure def blockersComplete(s: State, task: TaskId): bool = {
    val blockers = s.knowledge.get(task).fact.blockers
    blockers.forall(blocker => and {
      knowledgeIsUsable(s, blocker),
      s.knowledge.get(blocker).fact.lifecycle == Completed,
    })
  }

  pure def freshTaskIsEligible(s: State, task: TaskId): bool = {
    val fact = s.knowledge.get(task).fact
    val w = s.workflow.get(task)
    and {
      w.responsibility == Unowned,
      w.boundary == ClaimBoundary,
      w.isolation == NotIsolated,
      knowledgeIsUsable(s, task),
      fact.lifecycle == Open,
      fact.claim == Unclaimed,
      fact.inTarget,
      blockersComplete(s, task),
      not(s.control.runPaused),
      not(isGroupingPaused(s, task)),
    }
  }

  pure def computeSelectorProjection(
    workflow: TaskId -> Workflow,
    knowledge: TaskId -> Knowledge,
    control: Control
  ): SelectorProjection = {
    val profileTasks = Set(A, C)
    val selected = profileTasks.filter(task => {
      val w = workflow.get(task)
      val k = knowledge.get(task)
      or {
        w.responsibility == Outstanding,
        and {
          w.responsibility == Unowned,
          k.fact.lifecycle == Open,
          k.fact.claim == Unclaimed,
          k.fact.inTarget,
          k.observation == UsableObservation,
          not(control.runPaused),
          not(control.taskPaused.get(task)),
        },
      }
    })
    val responsible = selected.filter(task =>
      workflow.get(task).responsibility == Outstanding
    )
    val capacityFree = selected.filter(task =>
      workflow.get(task).executorResourceUse
        == DoesNotUseTaskWorkCapacity
    )
    val capacityUsing = selected.exclude(capacityFree)
    val admittedUsing =
      if (capacityUsing.size() <= CAPACITY)
        capacityUsing
      else if (responsible.contains(A))
        Set(A)
      else if (responsible.contains(C))
        Set(C)
      else if (selected.contains(A))
        Set(A)
      else
        Set(C)
    val admitted = capacityFree.union(admittedUsing)
    val waiting = selected.exclude(admitted)
    {
      capacity: CAPACITY,
      frontierTaskIds: selected,
      admittedTaskIds: admitted,
      executorResourceUses:
        TASKS.mapBy(task => workflow.get(task).executorResourceUse),
      transitionTags: TASKS.mapBy(task =>
        if (workflow.get(task).responsibility == Outstanding)
          "CheckTaskClaim"
        else
          "CommitFreshTaskClaimIntent"
      ),
      transitionOperations: TASKS.mapBy(task => {
        if (workflow.get(task).responsibility == Outstanding)
          DurableTransitionOperation({
            operationId: workflow.get(task).operationId,
          })
        else
          FreshTransitionWithoutOperation(())
      }),
      explanations: waiting.map(task => {
        taskId: task,
        tag: "CapacityWait",
        wakeCondition: "CapacityReleasedOrReconstructedStateChanged",
      }),
      reservationTaskIds: admittedUsing,
      occupiedTaskIds: Set(),
    }
  }

  pure def refreshSelectorProjection(s: State): State = {
    ...s,
    selectorProjection:
      computeSelectorProjection(s.workflow, s.knowledge, s.control),
  }

  pure def initialReservedCount(s: State): int =
    TASKS.filter(task => {
      val w = s.workflow.get(task)
      and {
        w.responsibility == Outstanding,
        w.boundary != PromotionBoundary,
        w.boundary != CompletionClaimBoundary,
        w.boundary != CompletionBoundary,
        w.boundary != ClaimDeleteBoundary,
        w.boundary != NoBoundary,
      }
    }).size()

  pure def hasSmallerEligibleFreshTask(s: State, task: TaskId): bool =
    TASKS.exists(other => other < task and freshTaskIsEligible(s, other))

  pure def nextBoundary(boundary: Boundary): Boundary =
    match boundary {
      | ClaimBoundary => WorktreeBoundary
      | WorktreeBoundary => SessionBoundary
      | SessionBoundary => InvocationBoundary
      | InvocationBoundary => PromotionBoundary
      | PromotionBoundary => CompletionClaimBoundary
      | CompletionClaimBoundary => CompletionBoundary
      | CompletionBoundary => ClaimDeleteBoundary
      | ClaimDeleteBoundary => NoBoundary
      | NoBoundary => NoBoundary
    }

  pure def recordsIntent(s: State, task: TaskId, boundary: Boundary, operationId: int): State = {
    val perTask = s.intents.get(task)
    val identities = perTask.get(boundary).union(Set(operationId))
    {...s, intents: s.intents.put(task, perTask.put(boundary, identities))}
  }

  pure def canCommitFirstIntent(s: State, task: TaskId): bool =
    and {
      s.coordinator.running,
      freshTaskIsEligible(s, task),
      initialReservedCount(s) < CAPACITY,
      not(hasSmallerEligibleFreshTask(s, task)),
    }

  pure def applyCommitFirstIntent(s: State, task: TaskId): State = {
    val current = s.workflow.get(task)
    val position = s.reconstructionWorkflowHistory.length() + 1
    val token = FrontierRecoveryClaimToken({ taskId: task })
    val updated = {
      ...current,
      intentCommitted: true,
      requestAuthorized: true,
      responsibility: Outstanding,
    }
    val withWorkflow = {
      ...s,
      workflow: s.workflow.put(task, updated),
      reconstructionWorkflowHistory:
        s.reconstructionWorkflowHistory.append(
          ReconstructionClaimIntent({
            position: position,
            operationId: current.operationId,
            taskId: task,
            predecessorOperationIds: Set(0),
            owner: FrontierRecoveryClaimOwner(()),
            token: token,
          })
        ),
      reconstructionResponsibility:
        s.reconstructionResponsibility.put(
          task,
          ReconstructionClaimResponsibility({
            beganAt: position,
            operationId: current.operationId,
            taskId: task,
            owner: FrontierRecoveryClaimOwner(()),
            token: token,
          })
        ),
    }
    recordsIntent(withWorkflow, task, ClaimBoundary, current.operationId)
  }

  pure def taskForwardProgressPaused(s: State, task: TaskId): bool =
    s.control.runPaused or isGroupingPaused(s, task)

  pure def continuationFactsPermitProgress(s: State, task: TaskId): bool = {
    val fact = s.knowledge.get(task).fact
    val w = s.workflow.get(task)
    and {
      knowledgeIsUsable(s, task),
      if (w.boundary == ClaimDeleteBoundary)
        fact.lifecycle == Completed
      else
        fact.lifecycle == Open,
      fact.inTarget,
      fact.baseCompatible,
      w.isolation == NotIsolated,
      not(taskForwardProgressPaused(s, task)),
      if (w.boundary == ClaimBoundary) true else fact.claim == ActiveClaim or fact.claim == CompletionClaim,
      if (
        w.boundary == PromotionBoundary
          or w.boundary == CompletionClaimBoundary
          or w.boundary == CompletionBoundary
          or w.boundary == ClaimDeleteBoundary
      ) blockersComplete(s, task) else true,
    }
  }

  pure def canCommitResponsibleIntent(s: State, task: TaskId): bool = {
    val w = s.workflow.get(task)
    and {
      s.coordinator.running,
      w.responsibility == Outstanding,
      w.boundary != ClaimBoundary,
      w.boundary != NoBoundary,
      not(w.intentCommitted),
      continuationFactsPermitProgress(s, task),
    }
  }

  pure def applyCommitResponsibleIntent(s: State, task: TaskId): State = {
    val current = s.workflow.get(task)
    val updated = {
      ...current,
      intentCommitted: true,
      requestAuthorized: true,
    }
    val withWorkflow = {...s, workflow: s.workflow.put(task, updated)}
    recordsIntent(withWorkflow, task, current.boundary, current.operationId)
  }

  pure def canSendRequest(s: State, task: TaskId): bool = {
    val w = s.workflow.get(task)
    and {
      s.coordinator.running,
      w.responsibility == Outstanding,
      w.boundary != NoBoundary,
      w.intentCommitted,
      w.requestAuthorized,
      w.requestCount < REQUEST_BOUND,
      continuationFactsPermitProgress(s, task),
    }
  }

  pure def requestIdsAfter(
    s: State,
    task: TaskId,
    boundary: Boundary,
    operationId: int
  ): TaskId -> Boundary -> Set[int] = {
    val taskRequests = s.requestOperationIds.get(task)
    val boundaryRequests = taskRequests.get(boundary).union(Set(operationId))
    s.requestOperationIds.put(task, taskRequests.put(boundary, boundaryRequests))
  }

  pure def applyRequestWithoutEffect(s: State, task: TaskId): State = {
    val current = s.workflow.get(task)
    val updated = {
      ...current,
      requestAuthorized: false,
      observationRequired: true,
      requestCount: current.requestCount + 1,
    }
    {
      ...s,
      workflow: s.workflow.put(task, updated),
      requestOperationIds:
        requestIdsAfter(s, task, current.boundary, current.operationId),
      requestFreshnessViolations:
        s.requestFreshnessViolations + (if (knowledgeIsUsable(s, task)) 0 else 1),
    }
  }

  pure def authorityAfterEffect(a: Authority, boundary: Boundary): Authority = {
    val changed = match boundary {
      | ClaimBoundary => {...a, claim: ActiveClaim}
      | WorktreeBoundary => {...a, worktree: Available}
      | SessionBoundary => {...a, session: Available}
      | InvocationBoundary => {...a, invocation: RunningInvocation}
      | PromotionBoundary => {...a, promoted: true}
      | CompletionClaimBoundary => {...a, claim: CompletionClaim}
      | CompletionBoundary => {...a, lifecycle: Completed}
      | ClaimDeleteBoundary => {...a, claim: Unclaimed}
      | NoBoundary => a
    }
    {...changed, revision: a.revision + 1}
  }

  pure def applyRequestWithEffect(s: State, task: TaskId): State = {
    val current = s.workflow.get(task)
    val authority = s.authority.get(task)
    val taskEffects = s.effects.get(task)
    val taskEffectOperationIds = s.effectOperationIds.get(task)
    val boundaryEffectOperationIds = taskEffectOperationIds.get(current.boundary)
    val updatedWorkflow = {
      ...current,
      requestAuthorized: false,
      observationRequired: true,
      requestCount: current.requestCount + 1,
    }
    {
      ...s,
      authority:
        s.authority.put(task, authorityAfterEffect(authority, current.boundary)),
      workflow: s.workflow.put(task, updatedWorkflow),
      requestOperationIds:
        requestIdsAfter(s, task, current.boundary, current.operationId),
      effects:
        s.effects.put(
          task,
          taskEffects.put(current.boundary, taskEffects.get(current.boundary) + 1)
        ),
      effectOperationIds:
        s.effectOperationIds.put(
          task,
          taskEffectOperationIds.put(
            current.boundary,
            boundaryEffectOperationIds.union(Set(current.operationId))
          )
        ),
      requestFreshnessViolations:
        s.requestFreshnessViolations + (if (knowledgeIsUsable(s, task)) 0 else 1),
      duplicateEffectViolations:
        s.duplicateEffectViolations
          + (if (boundaryEffectOperationIds.contains(current.operationId)) 1 else 0),
    }
  }

  pure def canApplyRequestEffect(s: State, task: TaskId): bool = {
    val w = s.workflow.get(task)
    and {
      canSendRequest(s, task),
      not(s.effectOperationIds.get(task).get(w.boundary).contains(w.operationId)),
      s.authority.get(task).revision < MAX_AUTHORITY_REVISION,
    }
  }

  pure def canObserveTask(s: State, task: TaskId): bool = {
    val k = s.knowledge.get(task)
    val w = s.workflow.get(task)
    and {
      s.coordinator.running,
      w.isolation == NotIsolated,
      or {
        k.observedAuthorityRevision != s.authority.get(task).revision,
        k.activation != s.coordinator.activation,
        k.runControlEpoch != s.control.runControlEpoch,
        k.taskControlEpoch != effectiveTaskControlEpoch(s, task),
        k.observation == NeverObserved,
        k.observation == UnreadableObservation
          and w.unreadableCount < READ_BOUND,
        w.observationRequired,
      },
    }
  }

  pure def observationFor(readability: Readability): Observation =
    match readability {
      | Readable => UsableObservation
      | Unreadable => UnreadableObservation
      | Conflicting => ConflictingObservation
    }

  pure def applyObserveTask(s: State, task: TaskId): State = {
    val authority = s.authority.get(task)
    val currentWorkflow = s.workflow.get(task)
    val observation = observationFor(authority.readability)
    val knowledge = {
      fact: authority,
      observation: observation,
      durableRevision: s.nextKnowledgeRevision,
      observedAuthorityRevision: authority.revision,
      activation: s.coordinator.activation,
      runControlEpoch: s.control.runControlEpoch,
      taskControlEpoch: effectiveTaskControlEpoch(s, task),
    }
    val updatedWorkflow = {
      ...currentWorkflow,
      observationRequired: false,
      unreadableCount:
        if (observation == UnreadableObservation)
          currentWorkflow.unreadableCount + 1
        else 0,
    }
    {
      ...s,
      knowledge: s.knowledge.put(task, knowledge),
      workflow: s.workflow.put(task, updatedWorkflow),
      nextKnowledgeRevision: s.nextKnowledgeRevision + 1,
    }
  }

  pure def authorityShowsAppliedEffect(s: State, task: TaskId): bool = {
    val fact = s.knowledge.get(task).fact
    val boundary = s.workflow.get(task).boundary
    match boundary {
      | ClaimBoundary => fact.claim == ActiveClaim
      | WorktreeBoundary => fact.worktree == Available
      | SessionBoundary => fact.session == Available
      | InvocationBoundary => fact.invocation == AcceptedInvocation
      | PromotionBoundary => fact.promoted
      | CompletionClaimBoundary => fact.claim == CompletionClaim
      | CompletionBoundary => fact.lifecycle == Completed
      | ClaimDeleteBoundary => fact.claim == Unclaimed
      | NoBoundary => false
    }
  }

  pure def authorityShowsNoEffect(s: State, task: TaskId): bool = {
    val fact = s.knowledge.get(task).fact
    val boundary = s.workflow.get(task).boundary
    match boundary {
      | ClaimBoundary => fact.claim == Unclaimed
      | WorktreeBoundary => fact.worktree == Missing
      | SessionBoundary => fact.session == Missing
      | InvocationBoundary =>
          fact.invocation == NoInvocation or fact.invocation == InterruptedInvocation
      | PromotionBoundary => not(fact.promoted)
      | CompletionClaimBoundary => fact.claim == ActiveClaim
      | CompletionBoundary => fact.lifecycle == Open
      | ClaimDeleteBoundary => fact.claim == CompletionClaim
      | NoBoundary => false
    }
  }

  pure def canAuthorizeRetry(s: State, task: TaskId): bool = {
    val w = s.workflow.get(task)
    and {
      s.coordinator.running,
      w.responsibility == Outstanding,
      w.intentCommitted,
      not(w.requestAuthorized),
      not(w.observationRequired),
      w.requestCount < REQUEST_BOUND,
      knowledgeIsUsable(s, task),
      authorityShowsNoEffect(s, task),
      continuationFactsPermitProgress(s, task),
    }
  }

  pure def applyAuthorizeRetry(s: State, task: TaskId): State = {
    val current = s.workflow.get(task)
    {
      ...s,
      workflow:
        s.workflow.put(task, {...current, requestAuthorized: true}),
    }
  }

  pure def canRecordBoundaryOutcome(s: State, task: TaskId): bool = {
    val w = s.workflow.get(task)
    and {
      s.coordinator.running,
      w.responsibility == Outstanding,
      w.intentCommitted,
      w.requestCount > 0,
      not(w.observationRequired),
      knowledgeIsUsable(s, task),
      authorityShowsAppliedEffect(s, task),
    }
  }

  pure def applyRecordBoundaryOutcome(s: State, task: TaskId): State = {
    val current = s.workflow.get(task)
    val followingBoundary = nextBoundary(current.boundary)
    val finishes = followingBoundary == NoBoundary
    val updated = {
      ...current,
      boundary: followingBoundary,
      operationId: current.operationId + 1,
      intentCommitted: false,
      requestAuthorized: false,
      observationRequired: false,
      requestCount: 0,
      unreadableCount: 0,
      responsibility: if (finishes) Settled else Outstanding,
      attemptOutcome:
        if (current.boundary == InvocationBoundary) AttemptAccepted
        else current.attemptOutcome,
      settlement:
        if (finishes) TrackerCompleted else current.settlement,
    }
    {...s, workflow: s.workflow.put(task, updated)}
  }

  pure def canRecordInterruptedInvocation(s: State, task: TaskId): bool = {
    val w = s.workflow.get(task)
    and {
      s.coordinator.running,
      w.boundary == InvocationBoundary,
      w.intentCommitted,
      w.requestCount > 0,
      not(w.observationRequired),
      knowledgeIsUsable(s, task),
      s.knowledge.get(task).fact.invocation == InterruptedInvocation,
    }
  }

  pure def applyRecordInterruptedInvocation(s: State, task: TaskId): State = {
    val current = s.workflow.get(task)
    val updated = {
      ...current,
      operationId: current.operationId + 1,
      intentCommitted: false,
      requestAuthorized: false,
      observationRequired: false,
      requestCount: 0,
      unreadableCount: 0,
    }
    {...s, workflow: s.workflow.put(task, updated)}
  }

  pure def canCrash(s: State): bool =
    s.coordinator.running and s.coordinator.crashCount < MAX_CRASHES

  pure def applyCrash(s: State): State = {
    val coordinator = s.coordinator
    {
      ...s,
      coordinator: {
        ...coordinator,
        running: false,
        crashCount: coordinator.crashCount + 1,
      },
    }
  }

  pure def canRestart(s: State): bool = not(s.coordinator.running)

  pure def applyRestart(s: State): State = {
    val coordinator = s.coordinator
    {
      ...s,
      coordinator: {
        ...coordinator,
        running: true,
        activation: coordinator.activation + 1,
      },
    }
  }

  pure def applyRunPause(s: State, paused: bool): State = {
    val control = s.control
    {
      ...s,
      control: {
        ...control,
        runPaused: paused,
        runControlEpoch: control.runControlEpoch + 1,
      },
    }
  }

  pure def applyTaskPause(s: State, task: TaskId, paused: bool): State = {
    val control = s.control
    val epochs = control.taskControlEpoch
    {
      ...s,
      control: {
        ...control,
        taskPaused: control.taskPaused.put(task, paused),
        taskControlEpoch:
          epochs.put(task, epochs.get(task) + 1),
      },
    }
  }

  pure def canProviderFinishInvocation(s: State, task: TaskId): bool = {
    val authority = s.authority.get(task)
    and {
      authority.invocation == RunningInvocation,
      authority.revision < MAX_AUTHORITY_REVISION,
    }
  }

  pure def applyProviderInvocationResult(
    s: State,
    task: TaskId,
    result: Invocation
  ): State = {
    val authority = s.authority.get(task)
    {
      ...s,
      authority:
        s.authority.put(
          task,
          {...authority, invocation: result, revision: authority.revision + 1}
        ),
    }
  }

  pure def canInterruptInvocation(s: State, task: TaskId): bool =
    canProviderFinishInvocation(s, task) and taskForwardProgressPaused(s, task)

  pure def canChangeAuthority(s: State, task: TaskId): bool =
    s.authority.get(task).revision < MAX_AUTHORITY_REVISION

  pure def applyAuthorityReadability(
    s: State,
    task: TaskId,
    readability: Readability
  ): State = {
    val authority = s.authority.get(task)
    {
      ...s,
      authority:
        s.authority.put(
          task,
          {...authority, readability: readability, revision: authority.revision + 1}
        ),
    }
  }

  pure def applyClaimLoss(s: State, task: TaskId): State = {
    val authority = s.authority.get(task)
    {
      ...s,
      authority:
        s.authority.put(
          task,
          {...authority, claim: ForeignClaim, revision: authority.revision + 1}
        ),
    }
  }

  pure def applyWorktreeLoss(s: State, task: TaskId): State = {
    val authority = s.authority.get(task)
    {
      ...s,
      authority:
        s.authority.put(
          task,
          {...authority, worktree: Missing, revision: authority.revision + 1}
        ),
    }
  }

  pure def applyGitRewrite(s: State, task: TaskId): State = {
    val authority = s.authority.get(task)
    {
      ...s,
      authority:
        s.authority.put(
          task,
          {...authority, baseCompatible: false, revision: authority.revision + 1}
        ),
    }
  }

  pure def applyCompatibleTargetAdvance(s: State, task: TaskId): State = {
    val authority = s.authority.get(task)
    {
      ...s,
      authority:
        s.authority.put(task, {...authority, revision: authority.revision + 1}),
    }
  }

  pure def canClassifyAuthorityConstraint(s: State, task: TaskId): bool = {
    val k = s.knowledge.get(task)
    val w = s.workflow.get(task)
    or {
      k.observation == ConflictingObservation,
      k.observation == UnreadableObservation and w.unreadableCount >= READ_BOUND,
      and {
        knowledgeIsUsable(s, task),
        or {
          k.fact.lifecycle == Closed,
          not(k.fact.inTarget),
          not(k.fact.baseCompatible),
          w.boundary != ClaimBoundary and k.fact.claim != ActiveClaim and k.fact.claim != CompletionClaim,
          w.boundary != ClaimBoundary
            and w.boundary != WorktreeBoundary
            and k.fact.worktree == Missing,
        },
      },
    }
  }

  pure def canClassifyRequestExhaustion(s: State, task: TaskId): bool = {
    val w = s.workflow.get(task)
    and {
      s.coordinator.running,
      w.responsibility == Outstanding,
      w.isolation == NotIsolated,
      w.intentCommitted,
      not(w.requestAuthorized),
      not(w.observationRequired),
      w.requestCount == REQUEST_BOUND,
      knowledgeIsUsable(s, task),
      authorityShowsNoEffect(s, task),
    }
  }

  pure def applyClassifyRequestExhaustion(s: State, task: TaskId): State = {
    val current = s.workflow.get(task)
    {
      ...s,
      workflow:
        s.workflow.put(task, {
          ...current,
          isolation: RequestDidNotConvergeIsolated,
        }),
    }
  }

  pure def isolationFor(s: State, task: TaskId): Isolation = {
    val k = s.knowledge.get(task)
    val w = s.workflow.get(task)
    if (k.observation == ConflictingObservation) ObservationIsolated
    else if (k.observation == UnreadableObservation) ObservationIsolated
    else if (k.fact.lifecycle == Closed) LifecycleIsolated
    else if (not(k.fact.inTarget)) MembershipIsolated
    else if (not(k.fact.baseCompatible)) GitLineageIsolated
    else if (
      w.boundary != ClaimBoundary
        and w.boundary != WorktreeBoundary
        and k.fact.worktree == Missing
    ) WorktreeLostIsolated
    else ClaimAuthorityIsolated
  }

  pure def applyClassifyAuthorityConstraint(s: State, task: TaskId): State = {
    val current = s.workflow.get(task)
    val isolation = isolationFor(s, task)
    val updated = {
      ...current,
      isolation: isolation,
      attemptOutcome:
        if (isolation == WorktreeLostIsolated) AttemptWorktreeLost
        else current.attemptOutcome,
    }
    {...s, workflow: s.workflow.put(task, updated)}
  }

  pure def canSettleExternalCompletion(s: State, task: TaskId): bool = {
    val w = s.workflow.get(task)
    and {
      s.coordinator.running,
      w.responsibility == Outstanding,
      w.boundary != CompletionBoundary,
      knowledgeIsUsable(s, task),
      s.knowledge.get(task).fact.lifecycle == Completed,
    }
  }

  pure def canRepairIsolatedAuthority(s: State, task: TaskId): bool =
    canChangeAuthority(s, task) and s.workflow.get(task).isolation != NotIsolated

  pure def applyRepairIsolatedAuthority(s: State, task: TaskId): State = {
    val authority = s.authority.get(task)
    val boundary = s.workflow.get(task).boundary
    val repaired = {
      ...authority,
      lifecycle: if (boundary == ClaimDeleteBoundary) Completed else Open,
      claim: if (boundary == ClaimBoundary) Unclaimed
             else if (boundary == ClaimDeleteBoundary) CompletionClaim
             else ActiveClaim,
      worktree: if (boundary == ClaimBoundary or boundary == WorktreeBoundary)
                  authority.worktree
                else Available,
      baseCompatible: true,
      inTarget: true,
      readability: Readable,
      revision: authority.revision + 1,
    }
    {...s, authority: s.authority.put(task, repaired)}
  }

  pure def repairedFactsPermitClearing(s: State, task: TaskId): bool = {
    val fact = s.knowledge.get(task).fact
    val w = s.workflow.get(task)
    and {
      knowledgeIsUsable(s, task),
      fact.readability == Readable,
      fact.inTarget,
      fact.baseCompatible,
      if (w.boundary == ClaimDeleteBoundary)
        fact.lifecycle == Completed
      else
        fact.lifecycle == Open,
      if (w.boundary == ClaimBoundary)
        fact.claim == Unclaimed
      else if (w.boundary == ClaimDeleteBoundary)
        fact.claim == CompletionClaim
      else
        fact.claim == ActiveClaim,
      if (w.boundary == ClaimBoundary or w.boundary == WorktreeBoundary)
        true
      else
        fact.worktree == Available,
    }
  }

  pure def applyClearIsolation(s: State, task: TaskId): State = {
    val current = s.workflow.get(task)
    {
      ...s,
      workflow:
        s.workflow.put(task, {
          ...current,
          isolation: NotIsolated,
          attemptOutcome:
            if (current.attemptOutcome == AttemptWorktreeLost)
              AttemptPending
            else
              current.attemptOutcome,
        }),
    }
  }

  pure def applyExternalCompletion(s: State, task: TaskId): State = {
    val authority = s.authority.get(task)
    {
      ...s,
      authority:
        s.authority.put(
          task,
          {...authority, lifecycle: Completed, revision: authority.revision + 1}
        ),
    }
  }

  pure def applyExternalBlocker(s: State, add: bool): State = {
    val authority = s.authority.get(C)
    val blockers =
      if (add)
        authority.blockers.union(Set(D))
      else
        authority.blockers.exclude(Set(D))
    {
      ...s,
      authority:
        s.authority.put(C, {...authority, blockers: blockers, revision: authority.revision + 1}),
    }
  }

  pure def taskHasCoordinatorAction(s: State, task: TaskId): bool = {
    val w = s.workflow.get(task)
    or {
      canCommitFirstIntent(s, task),
      canCommitResponsibleIntent(s, task),
      canSendRequest(s, task),
      canObserveTask(s, task),
      canAuthorizeRetry(s, task),
      canRecordBoundaryOutcome(s, task),
      canRecordInterruptedInvocation(s, task),
      canClassifyAuthorityConstraint(s, task),
      canClassifyRequestExhaustion(s, task),
      canSettleExternalCompletion(s, task),
      w.isolation != NotIsolated and repairedFactsPermitClearing(s, task),
    }
  }

  pure def taskHasExactNonActionableReason(s: State, task: TaskId): bool = {
    val w = s.workflow.get(task)
    or {
      not(s.coordinator.running),
      w.responsibility == Settled,
      w.responsibility == Relinquished,
      w.isolation != NotIsolated,
      s.activation.isolatedSubjects.contains(task),
      taskForwardProgressPaused(s, task),
      w.responsibility == Unowned and not(freshTaskIsEligible(s, task)),
      w.responsibility == Unowned and hasSmallerEligibleFreshTask(s, task),
      w.responsibility == Outstanding and not(blockersComplete(s, task)),
      w.responsibility == Outstanding
        and w.boundary == InvocationBoundary
        and s.authority.get(task).invocation == RunningInvocation,
      w.responsibility == Unowned
        and initialReservedCount(s) >= CAPACITY
        and w.boundary == ClaimBoundary,
    }
  }

  pure def authorityBeforeBoundary(boundary: Boundary): Authority = {
    val initial = initialAuthority(A)
    match boundary {
      | ClaimBoundary => initial
      | WorktreeBoundary =>
          {...initial, claim: ActiveClaim}
      | SessionBoundary =>
          {...initial, claim: ActiveClaim, worktree: Available}
      | InvocationBoundary =>
          {...initial, claim: ActiveClaim, worktree: Available, session: Available}
      | PromotionBoundary =>
          {
            ...initial,
            claim: ActiveClaim,
            worktree: Available,
            session: Available,
            invocation: AcceptedInvocation,
          }
      | CompletionClaimBoundary =>
          {
            ...initial,
            claim: ActiveClaim,
            worktree: Available,
            session: Available,
            invocation: AcceptedInvocation,
            promoted: true,
          }
      | CompletionBoundary =>
          {
            ...initial,
            claim: CompletionClaim,
            worktree: Available,
            session: Available,
            invocation: AcceptedInvocation,
            promoted: true,
          }
      | ClaimDeleteBoundary =>
          {
            ...initial,
            lifecycle: Completed,
            claim: CompletionClaim,
            worktree: Available,
            session: Available,
            invocation: AcceptedInvocation,
            promoted: true,
          }
      | NoBoundary => initial
    }
  }

  pure def workflowBeforeBoundary(boundary: Boundary): Workflow = {
    val initial = initialWorkflow(A)
    {
      ...initial,
      boundary: boundary,
      operationId:
        if (boundary == ClaimBoundary) 1
        else if (boundary == WorktreeBoundary) 2
        else if (boundary == SessionBoundary) 3
        else if (boundary == InvocationBoundary) 4
        else if (boundary == PromotionBoundary) 5
        else if (boundary == CompletionClaimBoundary) 6
        else if (boundary == CompletionBoundary) 7
        else 8,
      responsibility: if (boundary == ClaimBoundary) Unowned else Outstanding,
      attemptOutcome:
        if (
          boundary == PromotionBoundary
            or boundary == CompletionClaimBoundary
            or boundary == CompletionBoundary
            or boundary == ClaimDeleteBoundary
        ) AttemptAccepted else AttemptPending,
    }
  }

  pure def stateBeforeBoundary(boundary: Boundary): State = {
    val base = initialState
    val authority = authorityBeforeBoundary(boundary)
    val workflow = workflowBeforeBoundary(boundary)
    val knowledge = {
      ...initialKnowledge(A),
      fact: authority,
      observedAuthorityRevision: authority.revision,
    }
    {
      ...base,
      authority: base.authority.put(A, authority),
      knowledge: base.knowledge.put(A, knowledge),
      workflow: base.workflow.put(A, workflow),
    }
  }

  pure def runningInvocationProfileState: State = {
    val base = stateBeforeBoundary(InvocationBoundary)
    val authority = base.authority.get(A)
    val workflow = base.workflow.get(A)
    val taskEffects = base.effects.get(A)
    val taskIntents = base.intents.get(A)
    val taskRequests = base.requestOperationIds.get(A)
    val taskEffectOperationIds = base.effectOperationIds.get(A)
    {
      ...base,
      authority:
        base.authority.put(
          A,
          {...authority, invocation: RunningInvocation, revision: authority.revision + 1}
        ),
      workflow:
        base.workflow.put(A, {
          ...workflow,
          intentCommitted: true,
          observationRequired: true,
          requestCount: 1,
        }),
      intents:
        base.intents.put(
          A,
          taskIntents.put(InvocationBoundary, Set(workflow.operationId))
        ),
      requestOperationIds:
        base.requestOperationIds.put(
          A,
          taskRequests.put(InvocationBoundary, Set(workflow.operationId))
        ),
      effects:
        base.effects.put(A, taskEffects.put(InvocationBoundary, 1)),
      effectOperationIds:
        base.effectOperationIds.put(
          A,
          taskEffectOperationIds.put(InvocationBoundary, Set(workflow.operationId))
        ),
    }
  }

  // The reconciliation profile exhausts two consecutive external revisions.
  // Starting near the shared authority bound keeps that focused state graph
  // repeatable without weakening the production-flow profile.
  pure def reconciliationProfileState: State = {
    val base = stateBeforeBoundary(WorktreeBoundary)
    val authority = {
      ...base.authority.get(A),
      revision: MAX_AUTHORITY_REVISION - 2,
    }
    val knowledge = {
      ...base.knowledge.get(A),
      fact: authority,
      observedAuthorityRevision: authority.revision,
    }
    {
      ...base,
      authority: base.authority.put(A, authority),
      knowledge: base.knowledge.put(A, knowledge),
    }
  }

  // Capacity-one ordering profile: C already has one workflow responsibility
  // while A is a newly eligible task. The selector must keep C first even
  // though A has the smaller task identity.
  pure def capacityOneResponsibilityFirstState: State =
    refreshSelectorProjection(applyCommitFirstIntent(initialState, C))

  pure def applySettleExternalCompletion(s: State, task: TaskId): State = {
    val current = s.workflow.get(task)
    {
      ...s,
      workflow:
        s.workflow.put(task, {
          ...current,
          boundary: NoBoundary,
          intentCommitted: false,
          requestAuthorized: false,
          observationRequired: false,
          responsibility: Settled,
          settlement: TrackerCompleted,
        }),
    }
  }

  pure def activationOwnerExists(s: State, task: TaskId): bool =
    s.activation.owners.get(task) != NoActivationOwner

  pure def activationPositionUsesCapacity(
    position: ActivationPosition
  ): bool =
    position != ActivationPositionAvailable

  pure def activationCapacityUsage(s: State): int =
    TASKS.filter(task =>
      activationPositionUsesCapacity(s.activation.positions.get(task))
    ).size()

  pure def activationFrontier(s: State): Set[TaskId] =
    s.selectorProjection.frontierTaskIds

  pure def noActivationReservationHandoffInProgress(s: State): bool =
    TASKS.forall(task =>
      match s.activation.positions.get(task) {
        | ActivationPositionReserved(_) =>
          activationOwnerExists(s, task)
        | _ => true
      })

  pure def applyActivationOwnershipExclusion(
    s: State,
    derived: Set[TaskId]
  ): Activation = {
    val owned = derived.filter(task => activationOwnerExists(s, task))
    {
      ...s.activation,
      derivedTransitions: derived,
      selectedTransitions:
        derived.exclude(owned.union(s.activation.isolatedSubjects)),
      activationInProgress: owned,
      triggerPending: false,
    }
  }

  action deriveActivationPass: bool = all {
    state.coordinator.running,
    // Reservation and ownership registration are one interruption-masked
    // production handoff. A later pass can overlap a live owner, but cannot
    // enter between those two boundaries.
    noActivationReservationHandoffInProgress(state),
    state' = {
      ...state,
      activation:
        applyActivationOwnershipExclusion(state, activationFrontier(state)),
    },
  }

  action excludeOwnedTransitions: bool = all {
    not(state.activation.triggerPending),
    noActivationReservationHandoffInProgress(state),
    state' = {
      ...state,
      activation:
        applyActivationOwnershipExclusion(
          state,
          state.activation.derivedTransitions
        ),
    },
  }

  action reserveTaskAdmissionPosition(task: TaskId): bool = all {
    // Release/provider observations request a fresh ordered derivation. A
    // stale selection cannot admit another task before that pass consumes the
    // trigger.
    not(state.activation.triggerPending),
    state.activation.selectedTransitions.contains(task),
    state.activation.selectedTransitions.forall(candidate => task <= candidate),
    state.activation.positions.get(task) == ActivationPositionAvailable,
    // Reservation and ownership registration are one serialized production
    // handoff. The model exposes both checkpoints but cannot start a second
    // reservation between them.
    noActivationReservationHandoffInProgress(state),
    activationCapacityUsage(state) < state.activation.configuredCapacity,
    state' = {
      ...state,
      activation: {
        ...state.activation,
        selectedTransitions:
          state.activation.selectedTransitions.exclude(Set(task)),
        // These sets describe the current interrupted attempt, not durable
        // task history. A later exact selection begins a new attempt.
        postIntentExited:
          state.activation.postIntentExited.exclude(Set(task)),
        preIntentInterrupted:
          state.activation.preIntentInterrupted.exclude(Set(task)),
        positions:
          state.activation.positions.put(
            task,
            ActivationPositionReserved({ selectedTaskId: task })
          ),
      },
    },
  }

  action claimActivationOwnership(task: TaskId): bool = all {
    state.activation.positions.get(task)
      == ActivationPositionReserved({ selectedTaskId: task }),
    state.activation.owners.get(task) == NoActivationOwner,
    state' = {
      ...state,
      activation: {
        ...state.activation,
        // Claiming ownership is the other half of the interruption-masked
        // reservation handoff. A separately sampled derivation between the
        // two model actions must not leave the claimed transition selected.
        selectedTransitions:
          state.activation.selectedTransitions.exclude(Set(task)),
        activationInProgress:
          state.activation.activationInProgress.union(Set(task)),
        owners:
          state.activation.owners.put(
            task,
            PreIntentActivationOwner(())
          ),
        ownerRegistrationCounts:
          state.activation.ownerRegistrationCounts.put(task, 1),
        runners: state.activation.runners.union(Set(task)),
      },
    },
  }

  action rejectDuplicateOwnership(task: TaskId): bool = all {
    state.activation.positions.get(task)
      == ActivationPositionReserved({ selectedTaskId: task }),
    state.activation.owners.get(task) == NoActivationOwner,
    state' = {
      ...state,
      activation: {
        ...state.activation,
        selectedTransitions:
          state.activation.selectedTransitions.exclude(Set(task)),
        activationInProgress:
          state.activation.activationInProgress.union(Set(task)),
        owners:
          state.activation.owners.put(
            task,
            PreIntentActivationOwner(())
          ),
        ownerRegistrationCounts:
          state.activation.ownerRegistrationCounts.put(task, 1),
        runners: state.activation.runners.union(Set(task)),
        duplicateReservationLeaks:
          state.activation.duplicateReservationLeaks.exclude(Set(task)),
        isolatedSubjects:
          state.activation.isolatedSubjects.union(Set(task)),
      },
    },
  }

  action recordOwnedOperationIntent(task: TaskId): bool = {
    val operationId = state.workflow.get(task).operationId
    all {
      state.activation.owners.get(task) == PreIntentActivationOwner(()),
      state.activation.positions.get(task)
        == ActivationPositionReserved({ selectedTaskId: task }),
      state' = {
        ...state,
        activation: {
          ...state.activation,
          owners:
            state.activation.owners.put(
              task,
              PostIntentActivationOwner({ operationId: operationId })
            ),
          positions:
            state.activation.positions.put(
              task,
              ActivationPositionRetained({ operationId: operationId })
            ),
        },
      },
    }
  }

  action interruptBeforeOwnership(task: TaskId): bool = all {
    state.activation.positions.get(task)
      == ActivationPositionReserved({ selectedTaskId: task }),
    state.activation.owners.get(task) == NoActivationOwner,
    state' = {
      ...state,
      activation: {
        ...state.activation,
        positions:
          state.activation.positions.put(task, ActivationPositionAvailable),
        preIntentInterrupted:
          state.activation.preIntentInterrupted.union(Set(task)),
        triggerPending: true,
      },
    },
  }

  action interruptAfterOwnershipBeforeIntent(task: TaskId): bool = all {
    state.activation.owners.get(task) == PreIntentActivationOwner(()),
    state' = {
      ...state,
      activation: {
        ...state.activation,
        activationInProgress:
          state.activation.activationInProgress.exclude(Set(task)),
        owners: state.activation.owners.put(task, NoActivationOwner),
        ownerRegistrationCounts:
          state.activation.ownerRegistrationCounts.put(task, 0),
        positions:
          state.activation.positions.put(task, ActivationPositionAvailable),
        runners: state.activation.runners.exclude(Set(task)),
        preIntentInterrupted:
          state.activation.preIntentInterrupted.union(Set(task)),
        triggerPending: true,
      },
    },
  }

  action interruptAfterIntent(task: TaskId): bool = {
    val owner = state.activation.owners.get(task)
    all {
      match owner {
        | PostIntentActivationOwner(_) => true
        | _ => false
      },
      state' = {
        ...state,
        activation: {
          ...state.activation,
          activationInProgress:
            state.activation.activationInProgress.exclude(Set(task)),
          owners: state.activation.owners.put(task, NoActivationOwner),
          ownerRegistrationCounts:
            state.activation.ownerRegistrationCounts.put(task, 0),
          runners: state.activation.runners.exclude(Set(task)),
          postIntentExited:
            state.activation.postIntentExited.union(Set(task)),
          triggerPending: true,
        },
      },
    }
  }

  action recordOwnedResultAndRelease(task: TaskId): bool = all {
    activationOwnerExists(state, task),
    state.activation.runners.contains(task),
    state' = {
      ...state,
      activation: {
        ...state.activation,
        activationInProgress:
          state.activation.activationInProgress.exclude(Set(task)),
        owners: state.activation.owners.put(task, NoActivationOwner),
        ownerRegistrationCounts:
          state.activation.ownerRegistrationCounts.put(task, 0),
        positions:
          state.activation.positions.put(task, ActivationPositionAvailable),
        providerConsuming:
          state.activation.providerConsuming.exclude(Set(task)),
        runners: state.activation.runners.exclude(Set(task)),
        resultsRecorded:
          state.activation.resultsRecorded.union(Set(task)),
        triggerPending: true,
      },
    },
  }

  action observeCapacityConsumed(task: TaskId): bool = {
    val operationId = state.workflow.get(task).operationId
    all {
      state.activation.positions.get(task)
        == ActivationPositionRetained({ operationId: operationId }),
      state' = {
        ...state,
        activation: {
          ...state.activation,
          positions:
            state.activation.positions.put(
              task,
              ActivationPositionOccupied({ operationId: operationId })
            ),
          providerConsuming:
            state.activation.providerConsuming.union(Set(task)),
          freshlyObservedCapacity:
            state.activation.freshlyObservedCapacity.union(Set(task)),
          triggerPending: true,
        },
      },
    }
  }

  action observeCapacityReleased(task: TaskId): bool = {
    val operationId = state.workflow.get(task).operationId
    all {
      state.activation.owners.get(task) == NoActivationOwner,
      or {
        state.activation.positions.get(task)
          == ActivationPositionRetained({ operationId: operationId }),
        state.activation.positions.get(task)
          == ActivationPositionOccupied({ operationId: operationId }),
      },
      state' = {
        ...state,
        activation: {
          ...state.activation,
          positions:
            state.activation.positions.put(task, ActivationPositionAvailable),
          providerConsuming:
            state.activation.providerConsuming.exclude(Set(task)),
          freshlyObservedCapacity:
            state.activation.freshlyObservedCapacity.union(Set(task)),
          lastReleaseCorrelation:
            ActivationReleaseObserved({
              requestedOperationId: operationId,
              affectedOperationId: operationId,
            }),
          triggerPending: true,
        },
      },
    }
  }

  action crashCoordinatorWithActivation: bool = all {
    state.coordinator.running,
    state' = {
      ...state,
      coordinator: {
        ...state.coordinator,
        running: false,
        crashCount: state.coordinator.crashCount + 1,
      },
      activation: {
        ...state.activation,
        triggerPending: false,
        derivedTransitions: Set(),
        selectedTransitions: Set(),
        activationInProgress: Set(),
        positions: TASKS.mapBy(_ => ActivationPositionAvailable),
        owners: TASKS.mapBy(_ => NoActivationOwner),
        ownerRegistrationCounts: TASKS.mapBy(_ => 0),
        runners: Set(),
      },
    },
  }

  action stopProviderWorker(task: TaskId): bool = all {
    state.activation.providerConsuming.contains(task),
    state' = {
      ...state,
      activation: {
        ...state.activation,
        providerConsuming:
          state.activation.providerConsuming.exclude(Set(task)),
        freshlyObservedCapacity:
          state.activation.freshlyObservedCapacity.union(Set(task)),
        triggerPending: true,
      },
    },
  }

  action reconstructActivation: bool = all {
    not(state.coordinator.running),
    state' = {
      ...state,
      coordinator: {
        ...state.coordinator,
        running: true,
        activation: state.coordinator.activation + 1,
      },
      activation: {
        ...initialActivation,
        configuredCapacity: state.activation.configuredCapacity,
        positions: TASKS.mapBy(task =>
          if (state.activation.providerConsuming.contains(task))
            ActivationPositionOccupied({
              operationId: state.workflow.get(task).operationId,
            })
          else if (state.workflow.get(task).responsibility == Outstanding)
            ActivationPositionRetained({
              operationId: state.workflow.get(task).operationId,
            })
          else
            ActivationPositionAvailable
        ),
        providerConsuming: state.activation.providerConsuming,
        freshlyObservedCapacity: state.activation.freshlyObservedCapacity,
      },
    },
  }

  var state: State

  val boundedCapacity: bool = and {
    initialReservedCount(state) <= CAPACITY,
    state.selectorProjection.admittedTaskIds.filter(task =>
      state.selectorProjection.executorResourceUses.get(task)
        == UsesOneTaskWorkCapacityPosition
    ).size() <= CAPACITY,
    state.selectorProjection.reservationTaskIds.size() <= CAPACITY,
  }
  val declaredExecutorResourceUseIsProjected: bool =
    TASKS.forall(task =>
      state.selectorProjection.executorResourceUses.get(task)
        == state.workflow.get(task).executorResourceUse)
  val oneOwnerPerExactTransition: bool =
    TASKS.forall(task => and {
      state.activation.ownerRegistrationCounts.get(task) <= 1,
      match state.activation.owners.get(task) {
        | NoActivationOwner =>
            state.activation.ownerRegistrationCounts.get(task) == 0
        | _ =>
            state.activation.ownerRegistrationCounts.get(task) == 1
              and state.activation.activationInProgress.contains(task)
      },
    })
  val oneExactTransitionPerActivationOwner: bool =
    state.activation.activationInProgress.forall(task =>
      activationOwnerExists(state, task))
  val everyOwnerNamesAnAdmittedTransition: bool =
    TASKS.forall(task =>
      not(activationOwnerExists(state, task))
        or activationPositionUsesCapacity(state.activation.positions.get(task)))
  val ownedTransitionIsNotReadmitted: bool =
    TASKS.forall(task =>
      not(activationOwnerExists(state, task))
        or not(state.activation.selectedTransitions.contains(task)))
  val duplicateOwnershipLeaksNoReservedPosition: bool =
    state.activation.duplicateReservationLeaks.size() == 0
  val preIntentInterruptionLeaksNoReservedPosition: bool =
    state.activation.preIntentInterrupted.forall(task =>
      and {
        state.activation.positions.get(task) == ActivationPositionAvailable,
        state.activation.owners.get(task) == NoActivationOwner,
      })
  val duplicateOwnershipDoesNotStopIndependentResponsibility: bool =
    not(state.activation.isolatedSubjects.contains(A))
      or not(state.activation.derivedTransitions.contains(C))
      or activationCapacityUsage(state) >= state.activation.configuredCapacity
      or state.activation.selectedTransitions.contains(C)
      or activationOwnerExists(state, C)
      or state.activation.isolatedSubjects.contains(C)
      or state.activation.resultsRecorded.contains(C)
      or match state.activation.positions.get(C) {
        | ActivationPositionReserved(_) => true
        | ActivationPositionRetained(_) => true
        | ActivationPositionOccupied(_) => true
        | ActivationPositionAvailable =>
            state.activation.triggerPending
        | _ => false
      }
  val postIntentOwnerUsesStableOperationIdentity: bool =
    TASKS.forall(task =>
      match state.activation.owners.get(task) {
        | PostIntentActivationOwner(owner) =>
            owner.operationId == state.workflow.get(task).operationId
        | _ => true
      })
  val postIntentSelectionAliasIsCorrelationOnly: bool =
    TASKS.forall(task =>
      match state.activation.owners.get(task) {
        | PostIntentActivationOwner(_) =>
            not(state.activation.selectedTransitions.contains(task))
        | _ => true
      })
  val postIntentExitRetainsPositionUntilFreshEvidence: bool =
    state.activation.postIntentExited.forall(task =>
      not(state.coordinator.running)
        or state.activation.freshlyObservedCapacity.contains(task)
        or match state.activation.positions.get(task) {
          | ActivationPositionRetained(_) => true
          | ActivationPositionOccupied(_) => true
          | _ => false
        })
  val everyAmbiguityCrossingEffectHasIntent: bool = everyEffectHasIntent
  val newReservedPositionsRespectConfiguredCapacity: bool = {
    val retainedOrOccupied = TASKS.filter(task =>
      match state.activation.positions.get(task) {
        | ActivationPositionRetained(_) => true
        | ActivationPositionOccupied(_) => true
        | _ => false
      }).size()
    val newlyReserved = TASKS.filter(task =>
      match state.activation.positions.get(task) {
        | ActivationPositionReserved(_) => true
        | _ => false
      }).size()
    if (retainedOrOccupied >= state.activation.configuredCapacity)
      newlyReserved == 0
    else
      retainedOrOccupied + newlyReserved <= state.activation.configuredCapacity
  }
  val lowerRestartCapacityDoesNotPreemptObservedUsage: bool =
    state.activation.providerConsuming.forall(task =>
      match state.activation.positions.get(task) {
        | ActivationPositionOccupied(_) => true
        | _ => not(state.coordinator.running)
      })
  val releaseAffectsOnlyItsExactOperation: bool =
    match state.activation.lastReleaseCorrelation {
      | NoActivationRelease => true
      | ActivationReleaseObserved(release) =>
          release.requestedOperationId == release.affectedOperationId
    }
  val exactActivationIssueDoesNotStopIndependentResponsibility: bool =
    duplicateOwnershipDoesNotStopIndependentResponsibility
  val everyResponsibilityIsActionableOrExactlyExplained: bool =
    everyTaskIsActionableOrExplained
  val currentFactsExcludePausedTransitions: bool =
    TASKS.forall(task =>
      not(isGroupingPaused(state, task))
        or not(state.activation.selectedTransitions.contains(task)))
  val everyEffectHasIntent: bool =
    TASKS.forall(task =>
      BOUNDARIES.forall(boundary =>
        state.effectOperationIds.get(task).get(boundary)
          .forall(operationId =>
            state.intents.get(task).get(boundary).contains(operationId))))
  val noDuplicateAuthorityEffect: bool = state.duplicateEffectViolations == 0
  val everyRequestUsesItsIntentIdentity: bool =
    TASKS.forall(task =>
      BOUNDARIES.forall(boundary => {
        val requests = state.requestOperationIds.get(task).get(boundary)
        val intents = state.intents.get(task).get(boundary)
        requests.forall(operationId => intents.contains(operationId))
      }))
  val noStaleAuthorityUse: bool = state.requestFreshnessViolations == 0
  val everyTaskIsActionableOrExplained: bool =
    TASKS.forall(task =>
      taskHasCoordinatorAction(state, task)
        or taskHasExactNonActionableReason(state, task))
  val branchLocalConstraintDoesNotStopC: bool =
    not(state.coordinator.running)
      or not(freshTaskIsEligible(state, C))
      or initialReservedCount(state) >= CAPACITY
      or canCommitFirstIntent(state, C)
      or hasSmallerEligibleFreshTask(state, C)
  val finalityIsSubjectSpecific: bool =
    TASKS.forall(task => {
      val w = state.workflow.get(task)
      (w.settlement == TrackerCompleted)
        == (w.responsibility == Settled and w.boundary == NoBoundary)
    })

  val firstIntentReached: bool =
    TASKS.exists(task => state.workflow.get(task).intentCommitted)
  val requestReached: bool =
    TASKS.exists(task => state.workflow.get(task).requestCount > 0)
  val retryReached: bool =
    TASKS.exists(task => state.workflow.get(task).requestCount > 1)
  val worktreeBoundaryReached: bool =
    TASKS.exists(task => state.workflow.get(task).boundary == WorktreeBoundary)
  val invocationRunningReached: bool =
    TASKS.exists(task => state.authority.get(task).invocation == RunningInvocation)
  val invocationAcceptedReached: bool =
    TASKS.exists(task => state.workflow.get(task).attemptOutcome == AttemptAccepted)
  val promotionReached: bool =
    TASKS.exists(task => state.authority.get(task).promoted)
  val trackerCompletionReached: bool =
    TASKS.exists(task => state.authority.get(task).lifecycle == Completed)
  val taskSettlementReached: bool =
    TASKS.exists(task => state.workflow.get(task).settlement == TrackerCompleted)
  val crashRestartReached: bool =
    state.coordinator.crashCount > 0 and state.coordinator.running
  val pauseReached: bool =
    state.control.runPaused or TASKS.exists(task => state.control.taskPaused.get(task))
  val isolationReached: bool =
    TASKS.exists(task => state.workflow.get(task).isolation != NotIsolated)
  val unaffectedBranchProgressReached: bool =
    state.control.taskPaused.get(A)
      and state.workflow.get(C).responsibility == Outstanding
  val branchProgressDuringIsolationReached: bool =
    state.workflow.get(A).isolation != NotIsolated
      and state.workflow.get(C).responsibility == Outstanding
  val taskTrackerProvenAbsenceReadReached: bool =
    match state.reconstructionGraphEvidence {
      | ProvenAbsenceGraphObservation(_) => true
      | _ => false
    }
  val taskTrackerIncomparableMembershipReadReached: bool =
    match state.reconstructionGraphEvidence {
      | IncomparableMembershipGraphObservation(_) => true
      | _ => false
    }
  val taskTrackerCompatibleReplacementReadReached: bool =
    match state.reconstructionGraphEvidence {
      | CompatibleReplacementGraphObservation(_) => true
      | _ => false
    }
  val activationOwnershipBeforeIntentReached: bool =
    TASKS.exists(task =>
      state.activation.owners.get(task) == PreIntentActivationOwner(()))
  val activationOwnershipAfterIntentReached: bool =
    TASKS.exists(task =>
      match state.activation.owners.get(task) {
        | PostIntentActivationOwner(_) => true
        | _ => false
      })
  val activationPreIntentInterruptionReached: bool =
    state.activation.triggerPending
      and state.activation.positions.get(A) == ActivationPositionAvailable
  val activationPostIntentInterruptionReached: bool =
    state.activation.postIntentExited.size() > 0
  val activationResultReleaseReached: bool =
    state.activation.resultsRecorded.size() > 0
      and state.activation.triggerPending
  val activationFreshNonConsumptionReached: bool =
    state.activation.freshlyObservedCapacity.size() > 0
      and state.activation.triggerPending
  val activationChangedCapacityReconstructionReached: bool =
    state.coordinator.running
      and state.activation.providerConsuming.size()
        > state.activation.configuredCapacity

  action init: bool = state' = initialState

  action initStoppedCoordinator: bool =
    state' = {
      ...initialState,
      coordinator: {...initialState.coordinator, running: false},
    }

  action initAnyBoundaryProfile: bool = {
    nondet boundary = BOUNDARIES.oneOf()
    state' = stateBeforeBoundary(boundary)
  }

  action initRunningInvocationProfile: bool =
    state' = runningInvocationProfileState

  action initReconciliationProfile: bool =
    state' = reconciliationProfileState

  action initCapacityOneResponsibilityFirstProfile: bool =
    state' = capacityOneResponsibilityFirstState

  action initChangedCapacityActivationProfile: bool = {
    val operationA = initialState.workflow.get(A).operationId
    val operationC = initialState.workflow.get(C).operationId
    state' = {
      ...initialState,
      coordinator: {...initialState.coordinator, running: false},
      activation: {
        ...initialActivation,
        configuredCapacity: 1,
        providerConsuming: Set(A, C),
        positions:
          initialActivation.positions
            .put(A, ActivationPositionOccupied({ operationId: operationA }))
            .put(C, ActivationPositionOccupied({ operationId: operationC })),
      },
    }
  }

  action orchestratorCommitsFreshTaskClaimIntent(task: TaskId): bool = all {
    canCommitFirstIntent(state, task),
    state' = refreshSelectorProjection(applyCommitFirstIntent(state, task)),
  }

  // Nullary Quint-connect lane for the parameterized closed M2 action.
  action orchestratorCommitsFirstFreshTaskClaimIntent: bool =
    orchestratorCommitsFreshTaskClaimIntent(A)

  action commitResponsibleIntent(task: TaskId): bool = all {
    canCommitResponsibleIntent(state, task),
    state' = applyCommitResponsibleIntent(state, task),
  }

  action requestApplies(task: TaskId): bool = all {
    canApplyRequestEffect(state, task),
    state' = applyRequestWithEffect(state, task),
  }

  action requestChangesNothing(task: TaskId): bool = all {
    canSendRequest(state, task),
    state' = applyRequestWithoutEffect(state, task),
  }

  action observeTask(task: TaskId): bool = all {
    canObserveTask(state, task),
    state' = refreshSelectorProjection(applyObserveTask(state, task)),
  }

  action authorizeRetry(task: TaskId): bool = all {
    canAuthorizeRetry(state, task),
    state' = applyAuthorizeRetry(state, task),
  }

  action recordBoundaryOutcome(task: TaskId): bool = all {
    canRecordBoundaryOutcome(state, task),
    state' = applyRecordBoundaryOutcome(state, task),
  }

  action recordInterruptedInvocation(task: TaskId): bool = all {
    canRecordInterruptedInvocation(state, task),
    state' = applyRecordInterruptedInvocation(state, task),
  }

  action crash: bool = all {
    canCrash(state),
    state' = refreshSelectorProjection(applyCrash(state)),
  }

  action restart: bool = all {
    canRestart(state),
    state' = refreshSelectorProjection(applyRestart(state)),
  }

  action requestRunPause: bool = all {
    state.coordinator.running,
    not(state.control.runPaused),
    state.control.runControlEpoch < MAX_CONTROL_EPOCH,
    state' = applyRunPause(state, true),
  }

  action requestRunResume: bool = all {
    state.coordinator.running,
    state.control.runPaused,
    state.control.runControlEpoch < MAX_CONTROL_EPOCH,
    state' = applyRunPause(state, false),
  }

  action requestTaskPause(task: TaskId): bool = all {
    state.coordinator.running,
    not(state.control.taskPaused.get(task)),
    state.control.taskControlEpoch.get(task) < MAX_CONTROL_EPOCH,
    state' = applyTaskPause(state, task, true),
  }

  action requestTaskResume(task: TaskId): bool = all {
    state.coordinator.running,
    state.control.taskPaused.get(task),
    state.control.taskControlEpoch.get(task) < MAX_CONTROL_EPOCH,
    state' = applyTaskPause(state, task, false),
  }

  action providerAcceptsInvocation(task: TaskId): bool = all {
    canProviderFinishInvocation(state, task),
    state' = applyProviderInvocationResult(state, task, AcceptedInvocation),
  }

  action providerInterruptsInvocation(task: TaskId): bool = all {
    canInterruptInvocation(state, task),
    state' = applyProviderInvocationResult(state, task, InterruptedInvocation),
  }

  action authorityBecomesUnreadable(task: TaskId): bool = all {
    canChangeAuthority(state, task),
    state.authority.get(task).readability == Readable,
    state' = applyAuthorityReadability(state, task, Unreadable),
  }

  action authorityBecomesConflicting(task: TaskId): bool = all {
    canChangeAuthority(state, task),
    state.authority.get(task).readability == Readable,
    state' = applyAuthorityReadability(state, task, Conflicting),
  }

  action loseClaim(task: TaskId): bool = all {
    canChangeAuthority(state, task),
    state.authority.get(task).claim == ActiveClaim,
    state' = applyClaimLoss(state, task),
  }

  action loseWorktree(task: TaskId): bool = all {
    canChangeAuthority(state, task),
    state.authority.get(task).worktree == Available,
    state' = applyWorktreeLoss(state, task),
  }

  action rewriteTarget(task: TaskId): bool = all {
    canChangeAuthority(state, task),
    state.authority.get(task).baseCompatible,
    state' = applyGitRewrite(state, task),
  }

  action advanceTargetCompatibly(task: TaskId): bool = all {
    canChangeAuthority(state, task),
    state.authority.get(task).baseCompatible,
    state' = applyCompatibleTargetAdvance(state, task),
  }

  action externallyCompleteTask(task: TaskId): bool = all {
    canChangeAuthority(state, task),
    state.authority.get(task).lifecycle == Open,
    state' = applyExternalCompletion(state, task),
  }

  action addBlockerToC: bool = all {
    canChangeAuthority(state, C),
    not(state.authority.get(C).blockers.contains(D)),
    state' = applyExternalBlocker(state, true),
  }

  action removeBlockerFromC: bool = all {
    canChangeAuthority(state, C),
    state.authority.get(C).blockers.contains(D),
    state' = applyExternalBlocker(state, false),
  }

  action classifyAuthorityConstraint(task: TaskId): bool = all {
    state.coordinator.running,
    state.workflow.get(task).isolation == NotIsolated,
    canClassifyAuthorityConstraint(state, task),
    state' = applyClassifyAuthorityConstraint(state, task),
  }

  action classifyRequestExhaustion(task: TaskId): bool = all {
    canClassifyRequestExhaustion(state, task),
    state' = applyClassifyRequestExhaustion(state, task),
  }

  action repairIsolatedAuthority(task: TaskId): bool = all {
    canRepairIsolatedAuthority(state, task),
    state' = applyRepairIsolatedAuthority(state, task),
  }

  action clearIsolation(task: TaskId): bool = all {
    state.coordinator.running,
    state.workflow.get(task).isolation != NotIsolated,
    repairedFactsPermitClearing(state, task),
    state' = applyClearIsolation(state, task),
  }

  action settleExternalCompletion(task: TaskId): bool = all {
    canSettleExternalCompletion(state, task),
    state' = applySettleExternalCompletion(state, task),
  }

  // Exhaustive profile for the generic intent/request/observation/outcome
  // protocol. The initializer chooses any one of the eight concrete
  // ambiguity-crossing boundaries, and this step operates only on task A.
  action boundaryProfileStep: bool = any {
    orchestratorCommitsFreshTaskClaimIntent(A),
    commitResponsibleIntent(A),
    requestApplies(A),
    requestChangesNothing(A),
    observeTask(A),
    authorizeRetry(A),
    classifyRequestExhaustion(A),
    recordBoundaryOutcome(A),
    providerAcceptsInvocation(A),
  }

  // Exhaustive crash profile for every ambiguity-crossing boundary. Restart
  // invalidates the activation carried by every pre-crash observation.
  action crashProfileStep: bool = any {
    orchestratorCommitsFreshTaskClaimIntent(A),
    commitResponsibleIntent(A),
    requestApplies(A),
    requestChangesNothing(A),
    observeTask(A),
    authorizeRetry(A),
    classifyRequestExhaustion(A),
    recordBoundaryOutcome(A),
    crash,
    restart,
  }

  // Exhaustive task-pause profile beginning with one running executor
  // invocation. Task C remains the independent branch.
  action pauseProfileStep: bool = any {
    requestTaskPause(A),
    requestTaskResume(A),
    providerInterruptsInvocation(A),
    observeTask(A),
    recordInterruptedInvocation(A),
    commitResponsibleIntent(A),
    orchestratorCommitsFreshTaskClaimIntent(C),
  }

  // Exhaustive branch-local external-change profile. A may lose its claim,
  // lineage, worktree, or readable authority while C remains independently
  // eligible when capacity permits.
  action reconciliationProfileStep: bool = any {
    loseClaim(A),
    loseWorktree(A),
    rewriteTarget(A),
    authorityBecomesUnreadable(A),
    authorityBecomesConflicting(A),
    observeTask(A),
    classifyAuthorityConstraint(A),
    repairIsolatedAuthority(A),
    clearIsolation(A),
    orchestratorCommitsFreshTaskClaimIntent(C),
  }

  action activationProfileStep: bool = {
    nondet task = Set(A, C).oneOf()
    any {
      deriveActivationPass,
      excludeOwnedTransitions,
      reserveTaskAdmissionPosition(task),
      claimActivationOwnership(task),
      rejectDuplicateOwnership(task),
      recordOwnedOperationIntent(task),
      interruptBeforeOwnership(task),
      interruptAfterOwnershipBeforeIntent(task),
      interruptAfterIntent(task),
      recordOwnedResultAndRelease(task),
      observeCapacityConsumed(task),
      observeCapacityReleased(task),
      crashCoordinatorWithActivation,
      stopProviderWorker(task),
      reconstructActivation,
    }
  }

  // Focused executable prefix: derive current work, reserve the canonical
  // first transition, establish its exact owner, then derive again before the
  // runner records a result.
  action activationOwnedThenDerivedPrefixStep: bool = {
    nondet task = Set(A, C).oneOf()
    any {
      deriveActivationPass,
      reserveTaskAdmissionPosition(task),
      claimActivationOwnership(task),
    }
  }

  action activationOwnershipProfileStep: bool = {
    nondet task = Set(A, C).oneOf()
    any {
      deriveActivationPass,
      excludeOwnedTransitions,
      reserveTaskAdmissionPosition(task),
      claimActivationOwnership(task),
      rejectDuplicateOwnership(task),
      recordOwnedOperationIntent(task),
      recordOwnedResultAndRelease(task),
    }
  }

  action activationInterruptionProfileStep: bool = {
    nondet task = Set(A, C).oneOf()
    any {
      deriveActivationPass,
      reserveTaskAdmissionPosition(task),
      claimActivationOwnership(task),
      recordOwnedOperationIntent(task),
      interruptBeforeOwnership(task),
      interruptAfterOwnershipBeforeIntent(task),
      interruptAfterIntent(task),
      recordOwnedResultAndRelease(task),
      observeCapacityConsumed(task),
      observeCapacityReleased(task),
    }
  }

  action activationCrashReconstructionProfileStep: bool = {
    nondet task = Set(A, C).oneOf()
    any {
      deriveActivationPass,
      reserveTaskAdmissionPosition(task),
      claimActivationOwnership(task),
      recordOwnedOperationIntent(task),
      observeCapacityConsumed(task),
      all {
        state.coordinator.crashCount < 2,
        crashCoordinatorWithActivation,
      },
      stopProviderWorker(task),
      reconstructActivation,
    }
  }

  // Construction profile: only ordinary successful workflow actions.
  // It exists so every major forward boundary has a reachable sampled witness
  // without external-change actions dominating random walks.
  action progressStep: bool = {
    nondet task = TASKS.oneOf()
    any {
      orchestratorCommitsFreshTaskClaimIntent(task),
      commitResponsibleIntent(task),
      requestApplies(task),
      observeTask(task),
      recordBoundaryOutcome(task),
      providerAcceptsInvocation(task),
    }
  }

  // One selector step records the canonically first admissible intent.
  // Repeating the ordinary selector admits independent C only when the
  // configured profile has another position. The executable adapter compares
  // this exported decision with the production selector and controller at
  // capacities one and two.
  action orchestratorCommitsNextFreshTaskClaimIntent: bool =
    if (canCommitFirstIntent(state, A))
      state' = refreshSelectorProjection(applyCommitFirstIntent(state, A))
    else if (canCommitFirstIntent(state, C))
      state' = refreshSelectorProjection(applyCommitFirstIntent(state, C))
    else
      state' = refreshSelectorProjection(state)

  pure def applyReconstructionTargetClosureRead(
    s: State,
    read: TargetClosureReadEvidence,
    predecessorOperationIds: Set[int],
    explicitlyCoveredTaskIds: Set[TaskId],
    graphEvidence: ReconstructionGraphEvidence,
    graphKnowledge: ReconstructionGraphKnowledge
  ): State = {
    val intentPosition = s.reconstructionWorkflowHistory.length() + 1
    val outcomePosition = intentPosition + 1
    val alreadyRecorded = s.reconstructionWorkflowHistory.select(record =>
      match record {
        | ReconstructionGraphObservationIntent(intent) =>
            intent.operationId == read.operationId
        | _ => false
      }
    ).length() > 0
    if (alreadyRecorded)
      s
    else
      {
        ...s,
        reconstructionGraphEvidence: graphEvidence,
        reconstructionGraphKnowledge: graphKnowledge,
        reconstructionWorkflowHistory:
          s.reconstructionWorkflowHistory.concat(List(
            ReconstructionGraphObservationIntent({
              position: intentPosition,
              operationId: read.operationId,
              predecessorOperationIds: predecessorOperationIds,
              explicitlyCoveredTaskIds: explicitlyCoveredTaskIds,
            }),
            ReconstructionGraphOutcome({
              position: outcomePosition,
              operationId: read.operationId,
              revision: read.revision,
              returnedTaskIds: read.returnedTaskIds,
            })
          )),
      }
  }

  // Named bounded tracker-read profiles used by the M2 reconstruction
  // conformance adapter. Each exports one distinct normalized read result so
  // the sampled state identifies which production evidence must be compared.
  action taskTrackerReturnsTargetClosureReadWithExplicitAbsenceCoverage: bool = {
    val read = {
          completeness: Complete(()),
          consistency: PotentiallyMixedTime(()),
          factFamily: TargetMembership(()),
          freshness: FreshAtReadBoundary(()),
          operationId: 2,
          readShape: TargetClosureMembership(()),
          revision: 1,
          returnedTaskIds: Set(A, C, D),
        }
    val observation = {
      completeness: Complete(()),
      consistency: PotentiallyMixedTime(()),
      factFamily: TargetMembership(()),
      freshness: FreshAtReadBoundary(()),
      observedAt: state.reconstructionWorkflowHistory.length() + 2,
      read: read,
      explicitlyCoveredTaskIds: Set(B),
      provenAbsentTaskIds: Set(B),
      target: FrontierRecoveryTargetClosure(()),
    }
    state' = refreshSelectorProjection(
      applyReconstructionTargetClosureRead(
        state,
        read,
        Set(),
        Set(B),
        ProvenAbsenceGraphObservation({
          explicitlyCoveredTaskIds: Set(B),
          read: read,
        }),
        ReconstructedTargetClosureObserved(observation)
      )
    )
  }

  action taskTrackerReturnsTargetClosureReadWithPredecessor: bool = {
    val read = {
          completeness: Complete(()),
          consistency: PotentiallyMixedTime(()),
          factFamily: TargetMembership(()),
          freshness: FreshAtReadBoundary(()),
          operationId: 2,
          readShape: TargetClosureMembership(()),
          revision: 1,
          returnedTaskIds: Set(A, C, D),
        }
    val observation = {
      completeness: Complete(()),
      consistency: PotentiallyMixedTime(()),
      factFamily: TargetMembership(()),
      freshness: FreshAtReadBoundary(()),
      observedAt: state.reconstructionWorkflowHistory.length() + 2,
      read: read,
      explicitlyCoveredTaskIds: Set(),
      provenAbsentTaskIds: Set(),
      target: FrontierRecoveryTargetClosure(()),
    }
    state' = refreshSelectorProjection(
      applyReconstructionTargetClosureRead(
        state,
        read,
        Set(0),
        Set(),
        IncomparableMembershipGraphObservation({
          predecessorOperationIds: Set(0),
          read: read,
        }),
        ReconstructedTargetClosureConflict({
          observations: List(initialTargetClosureObservation, observation),
        })
      )
    )
  }

  action taskTrackerReturnsTargetClosureReadAtNextRevision: bool = {
    val read = {
        completeness: Complete(()),
        consistency: PotentiallyMixedTime(()),
        factFamily: TargetMembership(()),
        freshness: FreshAtReadBoundary(()),
        operationId: 2,
        readShape: TargetClosureMembership(()),
        revision: 1,
        returnedTaskIds: TASKS,
      }
    val observation = {
      completeness: Complete(()),
      consistency: PotentiallyMixedTime(()),
      factFamily: TargetMembership(()),
      freshness: FreshAtReadBoundary(()),
      observedAt: state.reconstructionWorkflowHistory.length() + 2,
      read: read,
      explicitlyCoveredTaskIds: Set(),
      provenAbsentTaskIds: Set(),
      target: FrontierRecoveryTargetClosure(()),
    }
    state' = refreshSelectorProjection(
      applyReconstructionTargetClosureRead(
        state,
        read,
        Set(),
        Set(),
        CompatibleReplacementGraphObservation(read),
        ReconstructedTargetClosureObserved(observation)
      )
    )
  }

  action step: bool = {
    nondet task = TASKS.oneOf()
    any {
      orchestratorCommitsFreshTaskClaimIntent(task),
      commitResponsibleIntent(task),
      requestApplies(task),
      requestChangesNothing(task),
      observeTask(task),
      authorizeRetry(task),
      recordBoundaryOutcome(task),
      recordInterruptedInvocation(task),
      crash,
      restart,
      requestRunPause,
      requestRunResume,
      requestTaskPause(task),
      requestTaskResume(task),
      providerAcceptsInvocation(task),
      providerInterruptsInvocation(task),
      authorityBecomesUnreadable(task),
      authorityBecomesConflicting(task),
      loseClaim(task),
      loseWorktree(task),
      rewriteTarget(task),
      advanceTargetCompatibly(task),
      externallyCompleteTask(task),
      addBlockerToC,
      removeBlockerFromC,
      classifyAuthorityConstraint(task),
      classifyRequestExhaustion(task),
      repairIsolatedAuthority(task),
      clearIsolation(task),
      settleExternalCompletion(task),
      activationProfileStep,
    }
  }
}

module frontierRecoveryCapacityOne {
  import frontierRecovery(CAPACITY = 1).*
}

module frontierRecoveryCapacityTwo {
  import frontierRecovery(CAPACITY = 2).*
}
