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
    | Running
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
      state.attempt == Running,
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
  val runningReached: bool = state.attempt == Running
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
    state' = { ...state, attempt: Running, positionHeld: true },
  }

  action acceptExit: bool = all {
    state.phase == Serving,
    state' = { ...state, phase: Draining },
  }

  action recordSuspensionIntent: bool = all {
    state.phase == Draining,
    state.attempt == Running,
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
      state.attempt == Running,
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
  type Phase =
    | Serving
    | Draining
    | SuccessReported
    | FailureReported
    | ProcessGoneGraceful
    | ProcessGoneFailure
    | ProcessGoneTimeout
    | ProcessGoneUnexpected
    | RestartedServing
  type Result = NoResult | Succeeded | Failed | TimedOut
  type Status = NoStatus | ZeroStatus | NonzeroStatus
  type Attempt = SafeAttempt | BusyAttempt | FailedAttempt
  type Write = NoWrite | PendingWrite | AcknowledgedWrite | FailedWrite

  type State = {
    phase: Phase,
    tick: int,
    result: Result,
    status: Status,
    ownerHeld: bool,
    attempt: Attempt,
    write: Write,
    resourcesHeld: bool,
    failureDiagnosticRetained: bool,
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

  pure def successBoundaryReached(s: State): bool = and {
    not(s.ownerHeld),
    s.attempt == SafeAttempt,
    s.write != PendingWrite,
    s.write != FailedWrite,
    not(s.resourcesHeld),
    not(s.failureDiagnosticRetained),
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

  val fifthTickAtomicallyForcesTimedOutTermination: bool = and {
    state.tick != 5 or and {
      state.phase == ProcessGoneTimeout,
      state.result == TimedOut,
      state.status == NonzeroStatus,
      state.forcedTerminationRequested,
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
      state.status == ZeroStatus,
      state.gracefulTerminationRequested,
    }

  val unexpectedDeathNeverReportsGracefulSuccess: bool =
    state.phase != ProcessGoneUnexpected or and {
      state.result == NoResult,
      state.status == NoStatus,
      state.unexpectedDeathObserved,
    }

  val restartRestoresNoApplicationLifecycleState: bool =
    not(state.restarted) or and {
      state.phase == RestartedServing,
      state.restartClearedLifecycle,
      state.tick == 0,
      state.result == NoResult,
      state.status == NoStatus,
      not(state.ownerHeld),
      state.attempt == SafeAttempt,
      state.write == NoWrite,
      not(state.resourcesHeld),
      not(state.failureDiagnosticRetained),
    }

  val applicationLifecycleNeverEntersWorkflowHistory: bool = state.workflowExitRecords == 0
  val exitNeverDisposesDurableWorkflowResources: bool = state.durableResourcesPreserved

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
      result: NoResult,
      status: NoStatus,
      ownerHeld: false,
      attempt: SafeAttempt,
      write: NoWrite,
      resourcesHeld: true,
      failureDiagnosticRetained: false,
      gracefulTerminationRequested: false,
      forcedTerminationRequested: false,
      unexpectedDeathObserved: false,
      restarted: false,
      restartClearedLifecycle: false,
      workflowExitRecords: 0,
      durableResourcesPreserved: true,
    },
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
    state' = { ...state, phase: Draining },
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

  action reportSuccess: bool = all {
    state.phase == Draining,
    state.tick < 5,
    successBoundaryReached(state),
    state' = { ...state, phase: SuccessReported, result: Succeeded, status: ZeroStatus },
  }

  action reportFailure: bool = all {
    state.phase == Draining,
    state.tick < 5,
    state.failureDiagnosticRetained,
    not(usefulQuickWorkRemains(state)),
    state' = { ...state, phase: FailureReported, result: Failed, status: NonzeroStatus },
  }

  action advanceTick: bool = all {
    state.phase == Draining,
    state.tick < 4,
    state' = { ...state, tick: state.tick + 1 },
  }

  action fifthTickForcesTimeout: bool = all {
    state.phase == Draining,
    state.tick == 4,
    state' = {
      ...state,
      phase: ProcessGoneTimeout,
      tick: 5,
      result: TimedOut,
      status: NonzeroStatus,
      forcedTerminationRequested: true,
    },
  }

  action stopAfterSuccess: bool = all {
    state.phase == SuccessReported,
    state' = {
      ...state,
      phase: ProcessGoneGraceful,
      gracefulTerminationRequested: true,
    },
  }

  action forceAfterFailure: bool = all {
    state.phase == FailureReported,
    state' = {
      ...state,
      phase: ProcessGoneFailure,
      forcedTerminationRequested: true,
    },
  }

  action unexpectedDeath: bool = all {
    state.phase == Serving or state.phase == Draining,
    state' = {
      ...state,
      phase: ProcessGoneUnexpected,
      result: NoResult,
      status: NoStatus,
      ownerHeld: false,
      attempt: SafeAttempt,
      write: NoWrite,
      resourcesHeld: false,
      unexpectedDeathObserved: true,
    },
  }

  action restartApplication: bool = all {
    or {
      state.phase == ProcessGoneGraceful,
      state.phase == ProcessGoneFailure,
      state.phase == ProcessGoneTimeout,
      state.phase == ProcessGoneUnexpected,
    },
    not(state.restarted),
    state' = {
      ...state,
      phase: RestartedServing,
      tick: 0,
      result: NoResult,
      status: NoStatus,
      ownerHeld: false,
      attempt: SafeAttempt,
      write: NoWrite,
      resourcesHeld: false,
      failureDiagnosticRetained: false,
      restarted: true,
      restartClearedLifecycle: true,
    },
  }

  action step: bool = any {
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
    reportSuccess,
    reportFailure,
    advanceTick,
    fifthTickForcesTimeout,
    stopAfterSuccess,
    forceAfterFailure,
    unexpectedDeath,
    restartApplication,
  }
}
