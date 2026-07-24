// PROTOTYPE — throwaway bounded model for GitHub issue #122.
//
// The model keeps authority, durable knowledge, workflow history, control
// commands, and process-local coordination as distinct subrecords. They share
// one top-level variable only to make every Quint action update one cohesive
// model value.
module frontierRecovery {
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
  type Readability = Readable | Unreadable | Conflicting
  type Observation = NeverObserved | UsableObservation | UnreadableObservation | ConflictingObservation
  type Responsibility = Unowned | Outstanding | Settled | Relinquished
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
    nextKnowledgeRevision: int,
    requestFreshnessViolations: int,
    duplicateEffectViolations: int,
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

  pure val CAPACITY: int = 2
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

  pure def initialWorkflow(_task: TaskId): Workflow = {
    boundary: ClaimBoundary,
    operationId: 1,
    intentCommitted: false,
    requestAuthorized: false,
    observationRequired: false,
    requestCount: 0,
    unreadableCount: 0,
    responsibility: Unowned,
    isolation: NotIsolated,
    attemptOutcome: AttemptPending,
    settlement: TaskUnsettled,
  }

  pure def initialControl: Control = {
    runPaused: false,
    runControlEpoch: 0,
    taskPaused: TASKS.mapBy(_ => false),
    taskControlEpoch: TASKS.mapBy(_ => 0),
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
    nextKnowledgeRevision: 1,
    requestFreshnessViolations: 0,
    duplicateEffectViolations: 0,
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
    val updated = {
      ...current,
      intentCommitted: true,
      requestAuthorized: true,
      responsibility: Outstanding,
    }
    val withWorkflow = {...s, workflow: s.workflow.put(task, updated)}
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

  var state: State

  val boundedCapacity: bool = initialReservedCount(state) <= CAPACITY
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

  action init: bool = state' = initialState

  action initAnyBoundaryProfile: bool = {
    nondet boundary = BOUNDARIES.oneOf()
    state' = stateBeforeBoundary(boundary)
  }

  action initRunningInvocationProfile: bool =
    state' = runningInvocationProfileState

  action initReconciliationProfile: bool =
    state' = reconciliationProfileState

  action commitFirstIntent(task: TaskId): bool = all {
    canCommitFirstIntent(state, task),
    state' = applyCommitFirstIntent(state, task),
  }

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
    state' = applyObserveTask(state, task),
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
    state' = applyCrash(state),
  }

  action restart: bool = all {
    canRestart(state),
    state' = applyRestart(state),
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
    commitFirstIntent(A),
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
    commitFirstIntent(A),
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
    commitFirstIntent(C),
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
    commitFirstIntent(C),
  }

  // Construction profile: only ordinary successful workflow actions.
  // It exists so every major forward boundary has a reachable sampled witness
  // without external-change actions dominating random walks.
  action progressStep: bool = {
    nondet task = TASKS.oneOf()
    any {
      commitFirstIntent(task),
      commitResponsibleIntent(task),
      requestApplies(task),
      observeTask(task),
      recordBoundaryOutcome(task),
      providerAcceptsInvocation(task),
    }
  }

  action step: bool = {
    nondet task = TASKS.oneOf()
    any {
      commitFirstIntent(task),
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
    }
  }
}
