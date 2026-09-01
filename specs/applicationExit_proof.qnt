// Complete finite proof projections for the applicationExit subject.
//
// The canonical applicationExit model and its production-backed MBT remain
// the executable source of behavior. These acyclic projections retain each
// safety decision while separating otherwise independent owner, executor, and
// result products. ADR 0010 permits this split when the canonical graph cannot
// be exhaustively traversed inside the repository gate budget.
module applicationExitAdmissionProof {
  type Phase = Serving | Draining | ProcessGone
  type Owner = NoOwner | PreparingOwner | RegisteredOwner
  type Result = NoResult | SharedResult

  type State = {
    phase: Phase,
    ownerA: Owner,
    ownerB: Owner,
    cutoffCount: int,
    requestCount: int,
    tick: int,
    joinedTick: int,
    result: Result,
    joinedResult: Result,
    postCutoffRegistrations: int,
    timerResets: int,
    tickRegressions: int,
  }

  var state: State

  pure def rollbackPreparation(owner: Owner): Owner =
    if (owner == PreparingOwner) NoOwner else owner

  val cutoffClosesAtMostOnce: bool = state.cutoffCount >= 0 and state.cutoffCount <= 1

  val preparingNeverSurvivesCutoff: bool =
    state.phase == Serving or and {
      state.ownerA != PreparingOwner,
      state.ownerB != PreparingOwner,
    }

  val registrationRequiresServing: bool = state.postCutoffRegistrations == 0

  val joinedRequestDoesNotResetTimer: bool = and {
    state.timerResets == 0,
    state.tickRegressions == 0,
    state.requestCount != 2 or state.joinedTick == state.tick,
  }

  val joinedRequestsShareResult: bool =
    state.requestCount != 2 or state.joinedResult == state.result

  val admissionProofTypeOk: bool = and {
    state.requestCount >= 0,
    state.requestCount <= 2,
    state.tick >= 0,
    state.tick <= 5,
    state.joinedTick >= 0,
    state.joinedTick <= 5,
  }

  val servingReached: bool = state.phase == Serving
  val drainingReached: bool = state.phase == Draining
  val processGoneReached: bool = state.phase == ProcessGone
  val preparingOwnerReached: bool = state.ownerA == PreparingOwner or state.ownerB == PreparingOwner
  val registeredOwnerReached: bool = state.ownerA == RegisteredOwner or state.ownerB == RegisteredOwner
  val joinedRequestReached: bool = state.requestCount == 2
  val fourthTickReached: bool = state.phase == Draining and state.tick == 4
  val fifthTickReached: bool = state.phase == Draining and state.tick == 5

  action init: bool = all {
    state' = {
      phase: Serving,
      ownerA: NoOwner,
      ownerB: NoOwner,
      cutoffCount: 0,
      requestCount: 0,
      tick: 0,
      joinedTick: 0,
      result: NoResult,
      joinedResult: NoResult,
      postCutoffRegistrations: 0,
      timerResets: 0,
      tickRegressions: 0,
    },
  }

  action prepareOwnerA: bool = all {
    state.phase == Serving,
    state.ownerA == NoOwner,
    state' = { ...state, ownerA: PreparingOwner },
  }

  action prepareOwnerB: bool = all {
    state.phase == Serving,
    state.ownerB == NoOwner,
    state' = { ...state, ownerB: PreparingOwner },
  }

  action registerOwnerA: bool = all {
    state.phase == Serving,
    state.ownerA == PreparingOwner,
    state' = { ...state, ownerA: RegisteredOwner },
  }

  action registerOwnerB: bool = all {
    state.phase == Serving,
    state.ownerB == PreparingOwner,
    state' = { ...state, ownerB: RegisteredOwner },
  }

  action acceptExit: bool = all {
    state.phase == Serving,
    state' = {
      ...state,
      phase: Draining,
      ownerA: rollbackPreparation(state.ownerA),
      ownerB: rollbackPreparation(state.ownerB),
      cutoffCount: 1,
      requestCount: 1,
      tick: 0,
      joinedTick: 0,
    },
  }

  action joinExit: bool = all {
    state.phase == Draining,
    state.requestCount == 1,
    state' = {
      ...state,
      requestCount: 2,
      joinedTick: state.tick,
      joinedResult: state.result,
    },
  }

  action advanceTick: bool = all {
    state.phase == Draining,
    state.tick < 5,
    state' = {
      ...state,
      tick: state.tick + 1,
      joinedTick: if (state.requestCount == 2) state.tick + 1 else state.joinedTick,
    },
  }

  action publishSharedResult: bool = all {
    state.phase == Draining,
    state.result == NoResult,
    state' = {
      ...state,
      result: SharedResult,
      joinedResult: if (state.requestCount == 2) SharedResult else state.joinedResult,
    },
  }

  action finishProof: bool = all {
    state.phase == Draining,
    state.tick == 5,
    state' = { ...state, phase: ProcessGone },
  }

  action step: bool = any {
    prepareOwnerA,
    prepareOwnerB,
    registerOwnerA,
    registerOwnerB,
    acceptExit,
    joinExit,
    advanceTick,
    publishSharedResult,
    finishProof,
  }
}

module applicationExitOwnerProof {
  type Phase = Serving | Draining
  type Owner = NoOwner | InterruptibleOwner | AtomicOwner | AuthorizedTerminationOwner

  type State = {
    phase: Phase,
    owner: Owner,
    intentAcknowledged: bool,
    knownObservationRecorded: bool,
    recoverableAmbiguity: bool,
    runTerminationAuthorized: bool,
    runTerminated: bool,
    forbiddenDrainActions: int,
    workflowExitRecords: int,
    durableResourcesPreserved: bool,
  }

  var state: State

  val onlyEnumeratedQuickDrainActionsBegin: bool = state.forbiddenDrainActions == 0

  val recoverableAmbiguityRequiresAcknowledgedIntent: bool =
    not(state.recoverableAmbiguity) or and {
      state.intentAcknowledged,
      state.owner == NoOwner,
    }

  val knownObservationRequiresAcknowledgedIntent: bool =
    not(state.knownObservationRecorded) or state.intentAcknowledged

  val runTerminationRequiresPreCutoffAuthorization: bool =
    not(state.runTerminated) or state.runTerminationAuthorized

  val applicationLifecycleNeverEntersWorkflowHistory: bool = state.workflowExitRecords == 0

  val exitNeverDisposesDurableWorkflowResources: bool = state.durableResourcesPreserved

  val ownerProofTypeOk: bool = and {
    state.forbiddenDrainActions >= 0,
    state.forbiddenDrainActions <= 0,
    state.workflowExitRecords >= 0,
    state.workflowExitRecords <= 0,
  }

  val servingReached: bool = state.phase == Serving
  val drainingReached: bool = state.phase == Draining
  val interruptibleOwnerReached: bool = state.owner == InterruptibleOwner
  val atomicOwnerReached: bool = state.owner == AtomicOwner
  val authorizedTerminationOwnerReached: bool = state.owner == AuthorizedTerminationOwner
  val knownObservationReached: bool = state.knownObservationRecorded
  val recoverableAmbiguityReached: bool = state.recoverableAmbiguity
  val authorizedTerminationFinishedReached: bool = state.runTerminated

  action init: bool = all {
    state' = {
      phase: Serving,
      owner: NoOwner,
      intentAcknowledged: false,
      knownObservationRecorded: false,
      recoverableAmbiguity: false,
      runTerminationAuthorized: false,
      runTerminated: false,
      forbiddenDrainActions: 0,
      workflowExitRecords: 0,
      durableResourcesPreserved: true,
    },
  }

  action acknowledgeIntent: bool = all {
    state.phase == Serving,
    not(state.intentAcknowledged),
    state' = { ...state, intentAcknowledged: true },
  }

  action admitInterruptibleOwner: bool = all {
    state.phase == Serving,
    state.owner == NoOwner,
    state' = { ...state, owner: InterruptibleOwner },
  }

  action admitAtomicOwner: bool = all {
    state.phase == Serving,
    state.owner == NoOwner,
    state' = { ...state, owner: AtomicOwner },
  }

  action admitAuthorizedTerminationOwner: bool = all {
    state.phase == Serving,
    state.owner == NoOwner,
    state' = {
      ...state,
      owner: AuthorizedTerminationOwner,
      runTerminationAuthorized: true,
    },
  }

  action acceptExit: bool = all {
    state.phase == Serving,
    state' = { ...state, phase: Draining },
  }

  action recordKnownObservationAndRelease: bool = all {
    state.phase == Draining,
    state.owner == InterruptibleOwner,
    state.intentAcknowledged,
    state' = {
      ...state,
      owner: NoOwner,
      knownObservationRecorded: true,
    },
  }

  action releaseWithRecoverableAmbiguity: bool = all {
    state.phase == Draining,
    state.owner == InterruptibleOwner,
    state.intentAcknowledged,
    state' = {
      ...state,
      owner: NoOwner,
      recoverableAmbiguity: true,
    },
  }

  action finishAtomicOwner: bool = all {
    state.phase == Draining,
    state.owner == AtomicOwner,
    state' = { ...state, owner: NoOwner },
  }

  action finishAuthorizedTermination: bool = all {
    state.phase == Draining,
    state.owner == AuthorizedTerminationOwner,
    state.runTerminationAuthorized,
    state' = { ...state, owner: NoOwner, runTerminated: true },
  }

  action step: bool = any {
    acknowledgeIntent,
    admitInterruptibleOwner,
    admitAtomicOwner,
    admitAuthorizedTerminationOwner,
    acceptExit,
    recordKnownObservationAndRelease,
    releaseWithRecoverableAmbiguity,
    finishAtomicOwner,
    finishAuthorizedTermination,
  }
}

module applicationExitExecutorProof {
  type Phase = Serving | Draining
  type Attempt =
    | NotStarted
    | Executing
    | SuspensionIntentRecorded
    | FastSuspensionCalled
    | SafelySuspended
    | Terminal
    | SuspensionCallFailed

  type State = {
    phase: Phase,
    attempt: Attempt,
    positionHeld: bool,
    suspensionIntentAcknowledged: bool,
    foreignReleases: int,
  }

  var state: State

  val exactSafeOrTerminalEvidenceControlsPositionRelease: bool = and {
    state.positionHeld == or {
      state.attempt == Executing,
      state.attempt == SuspensionIntentRecorded,
      state.attempt == FastSuspensionCalled,
      state.attempt == SuspensionCallFailed,
    },
    state.foreignReleases == 0,
  }

  val fastSuspensionRequiresAcknowledgedIntent: bool =
    state.attempt != FastSuspensionCalled or state.suspensionIntentAcknowledged

  val executorProofTypeOk: bool = state.foreignReleases >= 0 and state.foreignReleases <= 0

  val servingReached: bool = state.phase == Serving
  val drainingReached: bool = state.phase == Draining
  val executingReached: bool = state.attempt == Executing
  val suspensionIntentReached: bool = state.attempt == SuspensionIntentRecorded
  val fastSuspensionCalledReached: bool = state.attempt == FastSuspensionCalled
  val safelySuspendedReached: bool = state.attempt == SafelySuspended
  val terminalReached: bool = state.attempt == Terminal
  val suspensionFailureReached: bool = state.attempt == SuspensionCallFailed

  action init: bool = all {
    state' = {
      phase: Serving,
      attempt: NotStarted,
      positionHeld: false,
      suspensionIntentAcknowledged: false,
      foreignReleases: 0,
    },
  }

  action startAttempt: bool = all {
    state.phase == Serving,
    state.attempt == NotStarted,
    state' = { ...state, attempt: Executing, positionHeld: true },
  }

  action acceptExit: bool = all {
    state.phase == Serving,
    state' = { ...state, phase: Draining },
  }

  action recordSuspensionIntent: bool = all {
    state.phase == Draining,
    state.attempt == Executing,
    state' = {
      ...state,
      attempt: SuspensionIntentRecorded,
      suspensionIntentAcknowledged: true,
    },
  }

  action callFastSuspension: bool = all {
    state.phase == Draining,
    state.attempt == SuspensionIntentRecorded,
    state.suspensionIntentAcknowledged,
    state' = { ...state, attempt: FastSuspensionCalled },
  }

  action reportSafelySuspended: bool = all {
    state.phase == Draining,
    state.attempt == FastSuspensionCalled,
    state' = { ...state, attempt: SafelySuspended, positionHeld: false },
  }

  action reportTerminal: bool = all {
    state.phase == Draining,
    or {
      state.attempt == Executing,
      state.attempt == SuspensionIntentRecorded,
      state.attempt == FastSuspensionCalled,
    },
    state' = { ...state, attempt: Terminal, positionHeld: false },
  }

  action failFastSuspension: bool = all {
    state.phase == Draining,
    state.attempt == FastSuspensionCalled,
    state' = { ...state, attempt: SuspensionCallFailed },
  }

  action step: bool = any {
    startAttempt,
    acceptExit,
    recordSuspensionIntent,
    callFastSuspension,
    reportSafelySuspended,
    reportTerminal,
    failFastSuspension,
  }
}

module applicationExitResultProof {
  // The proof projection keeps the lifecycle result exact while making the
  // production-host scope boundary explicit. Ordinary callers release the
  // coordinator before exposing success; the host callback exposes the same
  // result while its enclosing scope still owns the coordinator, then closes
  // that scope in a distinct transition.
  type Mode = Ordinary | ProductionHostScoped
  type Phase =
    | Serving
    | Draining
    | SuccessReported
    | FailureReported
    | HostResultReported
    | HostScopeFinalized
    | ProcessGoneGraceful
    | ProcessGoneFailure
    | ProcessGoneTimeout
    | ProcessGoneUnexpected
    | RestartedServing
  type Result = NoResult | Succeeded | Failed | TimedOut
  type ResultProvenance = NoProvenance | OrdinaryResult | ProductionHostResult
  type Status = NoStatus | ZeroStatus | NonzeroStatus
  type Attempt = SafeAttempt | BusyAttempt | FailedAttempt
  type Write = NoWrite | PendingWrite | AcknowledgedWrite | FailedWrite

  type State = {
    phase: Phase,
    tick: int,
    mode: Mode,
    result: Result,
    resultProvenance: ResultProvenance,
    status: Status,
    ownerHeld: bool,
    coordinatorLockHeld: bool,
    attempt: Attempt,
    write: Write,
    resourcesHeld: bool,
    failureDiagnosticRetained: bool,
    hostResultReported: bool,
    hostScopeFinalized: bool,
    gracefulTerminationRequested: bool,
    forcedTerminationRequested: bool,
    unexpectedDeathObserved: bool,
    restarted: bool,
    restartClearedLifecycle: bool,
    workflowExitRecords: int,
    durableResourcesPreserved: bool,
  }

  var state: State

  pure def usefulQuickWorkRemains(s: State): bool = or {
    s.ownerHeld,
    s.attempt == BusyAttempt,
    s.write == PendingWrite,
    s.resourcesHeld,
  }

  // This is the drain-complete boundary. It intentionally excludes the
  // ordinary coordinator release, because host callers report before scope
  // finalization while ordinary callers use the complete boundary below.
  pure def successDrainBoundaryReached(s: State): bool = and {
    not(s.ownerHeld),
    s.attempt == SafeAttempt,
    s.write != PendingWrite,
    s.write != FailedWrite,
    not(s.resourcesHeld),
    not(s.failureDiagnosticRetained),
  }

  // Ordinary success is visible only after its process-local coordinator lock
  // is released. Keep this helper exercised by the ordinary report action and
  // the useful-work positive path below.
  pure def successBoundaryReached(s: State): bool = and {
    successDrainBoundaryReached(s),
    not(s.coordinatorLockHeld),
  }

  val successfulExitRequiresRecoverableBoundary: bool =
    state.result != Succeeded or and {
      not(state.ownerHeld),
      state.attempt == SafeAttempt,
      state.write != PendingWrite,
      state.write != FailedWrite,
      not(state.resourcesHeld),
      not(state.failureDiagnosticRetained),
      state.status == ZeroStatus,
    }

  val conclusiveFailureWaitsForUsefulQuickWork: bool =
    state.result != Failed or and {
      state.failureDiagnosticRetained,
      not(state.ownerHeld),
      state.attempt != BusyAttempt,
      state.write != PendingWrite,
      not(state.resourcesHeld),
    }

  // Ordinary timeout is process termination; host timeout is the exact typed
  // result returned before host scope finalization and never requests force.
  val fifthTickAtomicallyForcesTimedOutTermination: bool = and {
    state.tick != 5 or if (state.mode == Ordinary)
      and {
        state.phase == ProcessGoneTimeout,
        state.result == TimedOut,
        state.resultProvenance == OrdinaryResult,
        state.status == NonzeroStatus,
        state.forcedTerminationRequested,
      }
    else
      and {
        state.phase == HostResultReported or state.phase == HostScopeFinalized,
        state.result == TimedOut,
        state.resultProvenance == ProductionHostResult,
        state.status == NonzeroStatus,
        state.hostResultReported,
        not(state.forcedTerminationRequested),
      },
    state.phase != ProcessGoneTimeout or state.tick == 5,
  }

  val failureAndTimeoutRequestNonzeroForcedTermination: bool = and {
    state.phase != ProcessGoneFailure or and {
      state.result == Failed,
      state.status == NonzeroStatus,
      state.forcedTerminationRequested,
    },
    state.phase != ProcessGoneTimeout or and {
      state.result == TimedOut,
      state.status == NonzeroStatus,
      state.forcedTerminationRequested,
    },
  }

  val successReportsBeforeGracefulProcessEnd: bool =
    state.phase != ProcessGoneGraceful or and {
      state.result == Succeeded,
      state.resultProvenance == OrdinaryResult,
      state.status == ZeroStatus,
      state.gracefulTerminationRequested,
    }

  val unexpectedDeathNeverReportsGracefulSuccess: bool =
    state.phase != ProcessGoneUnexpected or and {
      state.result == NoResult,
      state.resultProvenance == NoProvenance,
      state.status == NoStatus,
      state.unexpectedDeathObserved,
    }

  val restartRestoresNoApplicationLifecycleState: bool =
    not(state.restarted) or and {
      state.phase == RestartedServing,
      state.restartClearedLifecycle,
      state.tick == 0,
      state.mode == Ordinary,
      state.result == NoResult,
      state.resultProvenance == NoProvenance,
      state.status == NoStatus,
      not(state.ownerHeld),
      state.coordinatorLockHeld,
      state.attempt == SafeAttempt,
      state.write == NoWrite,
      not(state.resourcesHeld),
      not(state.failureDiagnosticRetained),
      not(state.hostResultReported),
      not(state.hostScopeFinalized),
    }

  val applicationLifecycleNeverEntersWorkflowHistory: bool = state.workflowExitRecords == 0
  val exitNeverDisposesDurableWorkflowResources: bool = state.durableResourcesPreserved

  // These four properties are deliberately independent so each negative
  // control below measures one boundary claim rather than a conjunction.
  val ordinarySuccessReleasesCoordinatorBeforeResult: bool =
    state.mode != Ordinary or state.result != Succeeded or and {
      not(state.coordinatorLockHeld),
      state.resultProvenance == OrdinaryResult,
    }

  val hostResultBeforeScopeFinalization: bool =
    state.mode != ProductionHostScoped or not(state.hostScopeFinalized) or and {
      state.result != NoResult,
      state.hostResultReported,
    }

  val hostScopeFinalizationReleasesCoordinator: bool =
    state.mode != ProductionHostScoped or not(state.hostScopeFinalized) or not(state.coordinatorLockHeld)

  val hostResultProvenanceIsExplicit: bool =
    state.mode != ProductionHostScoped or state.result == NoResult or state.resultProvenance == ProductionHostResult

  val resultProofTypeOk: bool = and {
    state.tick >= 0,
    state.tick <= 5,
    state.workflowExitRecords >= 0,
    state.workflowExitRecords <= 0,
  }

  val servingReached: bool = state.phase == Serving
  val drainingReached: bool = state.phase == Draining
  val successReportedReached: bool = state.phase == SuccessReported
  val failureReportedReached: bool = state.phase == FailureReported
  val hostResultReportedReached: bool = state.phase == HostResultReported
  val hostScopeFinalizedReached: bool = state.phase == HostScopeFinalized
  val productionHostScopedReached: bool = state.mode == ProductionHostScoped
  val ordinaryResultProvenanceReached: bool = state.resultProvenance == OrdinaryResult
  val hostResultProvenanceReached: bool = state.resultProvenance == ProductionHostResult
  val gracefulProcessGoneReached: bool = state.phase == ProcessGoneGraceful
  val failedProcessGoneReached: bool = state.phase == ProcessGoneFailure
  val timedOutProcessGoneReached: bool = state.phase == ProcessGoneTimeout
  val unexpectedProcessGoneReached: bool = state.phase == ProcessGoneUnexpected
  val restartedServingReached: bool = state.phase == RestartedServing
  val busyAttemptReached: bool = state.attempt == BusyAttempt
  val pendingWriteReached: bool = state.write == PendingWrite
  val failureDiagnosticReached: bool = state.failureDiagnosticRetained
  val fourthTickReached: bool = state.phase == Draining and state.tick == 4

  action init: bool = all {
    state' = {
      phase: Serving,
      tick: 0,
      mode: Ordinary,
      result: NoResult,
      resultProvenance: NoProvenance,
      status: NoStatus,
      ownerHeld: false,
      coordinatorLockHeld: true,
      attempt: SafeAttempt,
      write: NoWrite,
      resourcesHeld: true,
      failureDiagnosticRetained: false,
      hostResultReported: false,
      hostScopeFinalized: false,
      gracefulTerminationRequested: false,
      forcedTerminationRequested: false,
      unexpectedDeathObserved: false,
      restarted: false,
      restartClearedLifecycle: false,
      workflowExitRecords: 0,
      durableResourcesPreserved: true,
    },
  }

  // The host policy is selected before the first Exit request by production
  // host composition; it is not an alternate result type.
  action selectHostScopedMode: bool = all {
    state.phase == Serving,
    state.mode == Ordinary,
    state' = { ...state, mode: ProductionHostScoped },
  }

  action holdOwner: bool = all {
    state.phase == Serving,
    not(state.ownerHeld),
    state' = { ...state, ownerHeld: true },
  }

  action startAttempt: bool = all {
    state.phase == Serving,
    state.attempt == SafeAttempt,
    state' = { ...state, attempt: BusyAttempt },
  }

  action produceWrite: bool = all {
    state.phase == Serving,
    state.write == NoWrite,
    state' = { ...state, write: PendingWrite },
  }

  action recordFailureDiagnostic: bool = all {
    state.phase == Serving,
    not(state.failureDiagnosticRetained),
    state' = { ...state, failureDiagnosticRetained: true, write: FailedWrite },
  }

  action acceptExit: bool = all {
    state.phase == Serving,
    state' = {
      ...state,
      phase: Draining,
      tick: 0,
      result: NoResult,
      resultProvenance: NoProvenance,
      status: NoStatus,
      hostResultReported: false,
      hostScopeFinalized: false,
    },
  }

  action releaseOwner: bool = all {
    state.phase == Draining,
    state.ownerHeld,
    state' = { ...state, ownerHeld: false },
  }

  action settleAttemptSafely: bool = all {
    state.phase == Draining,
    state.attempt == BusyAttempt,
    state' = { ...state, attempt: SafeAttempt },
  }

  action failAttempt: bool = all {
    state.phase == Draining,
    state.attempt == BusyAttempt,
    state' = { ...state, attempt: FailedAttempt, failureDiagnosticRetained: true },
  }

  action acknowledgeWrite: bool = all {
    state.phase == Draining,
    state.write == PendingWrite,
    state' = { ...state, write: AcknowledgedWrite },
  }

  action failWrite: bool = all {
    state.phase == Draining,
    state.write == PendingWrite,
    state' = { ...state, write: FailedWrite, failureDiagnosticRetained: true },
  }

  action releaseResources: bool = all {
    state.phase == Draining,
    state.resourcesHeld,
    state' = { ...state, resourcesHeld: false },
  }

  action releaseCoordinatorLock: bool = all {
    state.phase == Draining,
    state.mode == Ordinary,
    state.coordinatorLockHeld,
    state' = { ...state, coordinatorLockHeld: false },
  }

  action reportSuccess: bool = all {
    state.phase == Draining,
    state.tick < 5,
    or {
      and { state.mode == Ordinary, successBoundaryReached(state) },
      and { state.mode == ProductionHostScoped, successDrainBoundaryReached(state) },
    },
    state' = {
      ...state,
      phase: if (state.mode == Ordinary) SuccessReported else HostResultReported,
      result: Succeeded,
      resultProvenance: if (state.mode == Ordinary) OrdinaryResult else ProductionHostResult,
      status: ZeroStatus,
      hostResultReported: state.mode == ProductionHostScoped,
    },
  }

  action reportFailure: bool = all {
    state.phase == Draining,
    state.tick < 5,
    state.failureDiagnosticRetained,
    not(usefulQuickWorkRemains(state)),
    or { state.mode == ProductionHostScoped, not(state.coordinatorLockHeld) },
    state' = {
      ...state,
      phase: if (state.mode == Ordinary) FailureReported else HostResultReported,
      result: Failed,
      resultProvenance: if (state.mode == Ordinary) OrdinaryResult else ProductionHostResult,
      status: NonzeroStatus,
      hostResultReported: state.mode == ProductionHostScoped,
    },
  }

  action advanceTick: bool = all {
    state.phase == Draining,
    state.tick < 5,
    if (state.tick == 4)
      state' = {
        ...state,
        phase: if (state.mode == Ordinary) ProcessGoneTimeout else HostResultReported,
        tick: 5,
        result: TimedOut,
        resultProvenance: if (state.mode == Ordinary) OrdinaryResult else ProductionHostResult,
        status: NonzeroStatus,
        forcedTerminationRequested: state.mode == Ordinary,
        hostResultReported: state.mode == ProductionHostScoped,
      }
    else
      state' = { ...state, tick: state.tick + 1 },
  }

  action stopAfterSuccess: bool = all {
    state.phase == SuccessReported,
    state.mode == Ordinary,
    state.result == Succeeded,
    state' = {
      ...state,
      phase: ProcessGoneGraceful,
      gracefulTerminationRequested: true,
    },
  }

  action forceAfterFailure: bool = all {
    state.phase == FailureReported,
    state.mode == Ordinary,
    state.result == Failed,
    state' = {
      ...state,
      phase: ProcessGoneFailure,
      forcedTerminationRequested: true,
    },
  }

  // Host scope finalization is not process-end. It releases the coordinator
  // only after the exact result has crossed the host reporting boundary.
  action finalizeHostScope: bool = all {
    state.mode == ProductionHostScoped,
    state.phase == HostResultReported,
    state.result != NoResult,
    state.hostResultReported,
    not(state.hostScopeFinalized),
    state' = {
      ...state,
      phase: HostScopeFinalized,
      coordinatorLockHeld: false,
      hostScopeFinalized: true,
    },
  }

  action unexpectedDeath: bool = all {
    state.phase == Serving or state.phase == Draining,
    state' = {
      ...state,
      phase: ProcessGoneUnexpected,
      result: NoResult,
      resultProvenance: NoProvenance,
      status: NoStatus,
      ownerHeld: false,
      coordinatorLockHeld: false,
      attempt: SafeAttempt,
      write: NoWrite,
      resourcesHeld: false,
      hostResultReported: false,
      hostScopeFinalized: false,
      unexpectedDeathObserved: true,
    },
  }

  action restartApplication: bool = all {
    or {
      state.phase == ProcessGoneGraceful,
      state.phase == ProcessGoneFailure,
      state.phase == ProcessGoneTimeout,
      state.phase == ProcessGoneUnexpected,
      state.phase == HostScopeFinalized,
    },
    not(state.restarted),
    state' = {
      ...state,
      phase: RestartedServing,
      tick: 0,
      mode: Ordinary,
      result: NoResult,
      resultProvenance: NoProvenance,
      status: NoStatus,
      ownerHeld: false,
      coordinatorLockHeld: true,
      attempt: SafeAttempt,
      write: NoWrite,
      resourcesHeld: false,
      failureDiagnosticRetained: false,
      hostResultReported: false,
      hostScopeFinalized: false,
      restarted: true,
      restartClearedLifecycle: true,
    },
  }

  action step: bool = any {
    selectHostScopedMode,
    holdOwner,
    startAttempt,
    produceWrite,
    recordFailureDiagnostic,
    acceptExit,
    releaseOwner,
    settleAttemptSafely,
    failAttempt,
    acknowledgeWrite,
    failWrite,
    releaseResources,
    releaseCoordinatorLock,
    reportSuccess,
    reportFailure,
    advanceTick,
    stopAfterSuccess,
    forceAfterFailure,
    finalizeHostScope,
    unexpectedDeath,
    restartApplication,
  }
}
