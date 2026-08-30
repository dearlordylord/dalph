// Models #203's process-local application Exit decisions. The application is
// one actor coordinating shared admission, owner, executor, drain-resource,
// and durable-projection state, so the model uses plain Quint rather than a
// message-passing choreography.
//
// Scenario ownership:
// - cutoff and joined request actions: idle Exit and control/Exit races;
// - owner actions: in-flight interruptible and admitted atomic boundaries;
// - executor actions: executing-work suspension and exact evidence;
// - ticks, reports, and process endings: success, failure, timeout, and death;
// - restart: the one ordinary Run-entry path after every process ending.
//
// The runtime clock, fibers, Journal implementation, executor protocol, and
// host-process termination are deliberately outside this decision model. The
// paired production-backed MBT drives the pure application-lifecycle kernel;
// tickets #204-#210 own the concrete orchestration and boundary calls.
module applicationExit {
  type LifecyclePhase =
    | Serving
    | Draining
    | SuccessReported
    | FailureReported
    | ProcessGoneGraceful
    | ProcessGoneFailure
    | ProcessGoneTimeout
    | ProcessGoneUnexpected

  type ExitResult = NoExitResult | Succeeded | Failed | TimedOut
  type RequestedStatus = NoRequestedStatus | ZeroStatus | NonzeroStatus

  type ForwardOwnerKind =
    | InterruptibleBoundary
    | AtomicBoundary
    | AuthorizedRunTerminationAppend

  type ForwardOwnerSlot =
    | NoForwardOwner
    | PreparingForwardOwner(ForwardOwnerKind)
    | RegisteredForwardOwner(ForwardOwnerKind)

  type ExecutorAttempt =
    | AttemptNotStarted
    | AttemptExecuting
    | SuspensionIntentRecorded
    | FastSuspensionCalled
    | AttemptSafelySuspended
    | AttemptTerminal
    | SuspensionCallFailed

  type ProducedWrite = NoProducedWrite | ProducedWritePending | ProducedWriteAcknowledged | ProducedWriteFailed

  // This is the only durable state in this subject model. It contains
  // ordinary workflow facts and preservation evidence, never an Exit fact.
  type DurableProjection = {
    ownerAIntentAcknowledged: bool,
    ownerBIntentAcknowledged: bool,
    ownerAKnownObservationRecorded: bool,
    ownerBKnownObservationRecorded: bool,
    attemptASuspensionIntentAcknowledged: bool,
    attemptBSuspensionIntentAcknowledged: bool,
    pauseApplied: bool,
    runTerminationAuthorized: bool,
    runTerminated: bool,
    durableResourcesPreserved: bool,
    workflowExitRecords: int,
  }

  // Trace fields make forbidden transitions measurable. They are model-checker
  // instrumentation, not proposed Dalph state or Journal records.
  type TraceEvidence = {
    postCutoffForwardRegistrations: int,
    ambiguousReleasesWithoutIntent: int,
    foreignExecutorReleases: int,
    timerResets: int,
    tickRegressions: int,
    joinedResultMismatches: int,
    llmRequests: int,
    freshReconciliationReads: int,
    stabilizationReads: int,
    durableCleanupCalls: int,
    attemptReplacements: int,
    postCutoffControlApplications: int,
    postCutoffTerminationStarts: int,
    manufacturedWorkflowOutcomes: int,
    gracefulTerminationRequested: bool,
    forcedTerminationRequested: bool,
    unexpectedDeathObserved: bool,
    restarted: bool,
    restartClearedLifecycle: bool,
  }

  type State = {
    phase: LifecyclePhase,
    tick: int,
    cutoffCount: int,
    requestCount: int,
    result: ExitResult,
    requestedStatus: RequestedStatus,
    ownerA: ForwardOwnerSlot,
    ownerB: ForwardOwnerSlot,
    attemptA: ExecutorAttempt,
    attemptB: ExecutorAttempt,
    attemptAPositionHeld: bool,
    attemptBPositionHeld: bool,
    write: ProducedWrite,
    reservationHeld: bool,
    fiberOpen: bool,
    coordinatorLockHeld: bool,
    failureDiagnosticRetained: bool,
    ownerAAmbiguous: bool,
    ownerBAmbiguous: bool,
    durable: DurableProjection,
    trace: TraceEvidence,
  }

  var state: State

  pure def ownerIsPreparing(owner: ForwardOwnerSlot): bool = match owner {
    | PreparingForwardOwner(_) => true
    | _ => false
  }

  pure def ownerIsRegistered(owner: ForwardOwnerSlot): bool = match owner {
    | RegisteredForwardOwner(_) => true
    | _ => false
  }

  pure def registeredOwnerIs(owner: ForwardOwnerSlot, kind: ForwardOwnerKind): bool =
    owner == RegisteredForwardOwner(kind)

  pure def rollbackPreparation(owner: ForwardOwnerSlot): ForwardOwnerSlot = match owner {
    | PreparingForwardOwner(_) => NoForwardOwner
    | _ => owner
  }

  pure def attemptNeedsUsefulQuickWork(attempt: ExecutorAttempt): bool = or {
    attempt == AttemptExecuting,
    attempt == SuspensionIntentRecorded,
    attempt == FastSuspensionCalled,
  }

  pure def attemptIsSafeForSuccess(attempt: ExecutorAttempt): bool = or {
    attempt == AttemptNotStarted,
    attempt == AttemptSafelySuspended,
    attempt == AttemptTerminal,
  }

  pure def writeNeedsUsefulQuickWork(write: ProducedWrite): bool = write == ProducedWritePending

  pure def noUsefulQuickWorkRemains(s: State): bool = and {
    not(ownerIsRegistered(s.ownerA)),
    not(ownerIsRegistered(s.ownerB)),
    not(attemptNeedsUsefulQuickWork(s.attemptA)),
    not(attemptNeedsUsefulQuickWork(s.attemptB)),
    not(writeNeedsUsefulQuickWork(s.write)),
    not(s.reservationHeld),
    not(s.fiberOpen),
    not(s.coordinatorLockHeld),
  }

  pure def successBoundaryReached(s: State): bool = and {
    not(s.failureDiagnosticRetained),
    s.ownerA == NoForwardOwner,
    s.ownerB == NoForwardOwner,
    attemptIsSafeForSuccess(s.attemptA),
    attemptIsSafeForSuccess(s.attemptB),
    s.write != ProducedWritePending,
    s.write != ProducedWriteFailed,
    not(s.reservationHeld),
    not(s.fiberOpen),
    not(s.coordinatorLockHeld),
  }

  pure def processIsGone(phase: LifecyclePhase): bool = or {
    phase == ProcessGoneGraceful,
    phase == ProcessGoneFailure,
    phase == ProcessGoneTimeout,
    phase == ProcessGoneUnexpected,
  }

  action init: bool = all {
    state' = {
      phase: Serving,
      tick: 0,
      cutoffCount: 0,
      requestCount: 0,
      result: NoExitResult,
      requestedStatus: NoRequestedStatus,
      ownerA: NoForwardOwner,
      ownerB: NoForwardOwner,
      attemptA: AttemptNotStarted,
      attemptB: AttemptNotStarted,
      attemptAPositionHeld: false,
      attemptBPositionHeld: false,
      write: NoProducedWrite,
      reservationHeld: false,
      fiberOpen: false,
      coordinatorLockHeld: true,
      failureDiagnosticRetained: false,
      ownerAAmbiguous: false,
      ownerBAmbiguous: false,
      durable: {
        ownerAIntentAcknowledged: false,
        ownerBIntentAcknowledged: false,
        ownerAKnownObservationRecorded: false,
        ownerBKnownObservationRecorded: false,
        attemptASuspensionIntentAcknowledged: false,
        attemptBSuspensionIntentAcknowledged: false,
        pauseApplied: false,
        runTerminationAuthorized: false,
        runTerminated: false,
        durableResourcesPreserved: true,
        workflowExitRecords: 0,
      },
      trace: {
        postCutoffForwardRegistrations: 0,
        ambiguousReleasesWithoutIntent: 0,
        foreignExecutorReleases: 0,
        timerResets: 0,
        tickRegressions: 0,
        joinedResultMismatches: 0,
        llmRequests: 0,
        freshReconciliationReads: 0,
        stabilizationReads: 0,
        durableCleanupCalls: 0,
        attemptReplacements: 0,
        postCutoffControlApplications: 0,
        postCutoffTerminationStarts: 0,
        manufacturedWorkflowOutcomes: 0,
        gracefulTerminationRequested: false,
        forcedTerminationRequested: false,
        unexpectedDeathObserved: false,
        restarted: false,
        restartClearedLifecycle: false,
      },
    }
  }

  // Serving setup represents facts that can already exist when Exit arrives.
  action acknowledgeOwnerAIntent: bool = all {
    state.phase == Serving,
    not(state.durable.ownerAIntentAcknowledged),
    state' = { ...state, durable: { ...state.durable, ownerAIntentAcknowledged: true } },
  }

  action acknowledgeOwnerBIntent: bool = all {
    state.phase == Serving,
    not(state.durable.ownerBIntentAcknowledged),
    state' = { ...state, durable: { ...state.durable, ownerBIntentAcknowledged: true } },
  }

  action prepareInterruptibleOwnerA: bool = all {
    state.phase == Serving,
    state.ownerA == NoForwardOwner,
    state.durable.ownerAIntentAcknowledged,
    state' = { ...state, ownerA: PreparingForwardOwner(InterruptibleBoundary) },
  }

  action prepareAtomicOwnerA: bool = all {
    state.phase == Serving,
    state.ownerA == NoForwardOwner,
    state' = { ...state, ownerA: PreparingForwardOwner(AtomicBoundary) },
  }

  action prepareTerminationAppendOwnerA: bool = all {
    state.phase == Serving,
    state.ownerA == NoForwardOwner,
    state' = { ...state, ownerA: PreparingForwardOwner(AuthorizedRunTerminationAppend) },
  }

  action prepareInterruptibleOwnerB: bool = all {
    state.phase == Serving,
    state.ownerB == NoForwardOwner,
    state.durable.ownerBIntentAcknowledged,
    state' = { ...state, ownerB: PreparingForwardOwner(InterruptibleBoundary) },
  }

  action registerOwnerA: bool = {
    nondet kind = Set(
      InterruptibleBoundary,
      AtomicBoundary,
      AuthorizedRunTerminationAppend,
    ).oneOf()
    all {
      state.phase == Serving,
      state.ownerA == PreparingForwardOwner(kind),
      state' = {
        ...state,
        ownerA: RegisteredForwardOwner(kind),
        durable: {
          ...state.durable,
          runTerminationAuthorized:
            state.durable.runTerminationAuthorized or kind == AuthorizedRunTerminationAppend,
        },
      },
    }
  }

  action registerOwnerB: bool = all {
    state.phase == Serving,
    state.ownerB == PreparingForwardOwner(InterruptibleBoundary),
    state' = { ...state, ownerB: RegisteredForwardOwner(InterruptibleBoundary) },
  }

  action startAttemptA: bool = all {
    state.phase == Serving,
    state.attemptA == AttemptNotStarted,
    state' = { ...state, attemptA: AttemptExecuting, attemptAPositionHeld: true },
  }

  action startAttemptB: bool = all {
    state.phase == Serving,
    state.attemptB == AttemptNotStarted,
    state' = { ...state, attemptB: AttemptExecuting, attemptBPositionHeld: true },
  }

  action produceJournalWrite: bool = all {
    state.phase == Serving,
    state.write == NoProducedWrite,
    state' = { ...state, write: ProducedWritePending },
  }

  action holdReservation: bool = all {
    state.phase == Serving,
    not(state.reservationHeld),
    state' = { ...state, reservationHeld: true },
  }

  action openFiber: bool = all {
    state.phase == Serving,
    not(state.fiberOpen),
    state' = { ...state, fiberOpen: true },
  }

  action applyPauseBeforeCutoff: bool = all {
    state.phase == Serving,
    not(state.durable.pauseApplied),
    state' = { ...state, durable: { ...state.durable, pauseApplied: true } },
  }

  // The first request and cutoff are one transition. A reservation that has
  // not registered loses the handoff; an earlier registered owner remains.
  action acceptExit: bool = all {
    state.phase == Serving,
    state.cutoffCount == 0,
    state' = {
      ...state,
      phase: Draining,
      tick: 0,
      cutoffCount: 1,
      requestCount: 1,
      result: NoExitResult,
      requestedStatus: NoRequestedStatus,
      ownerA: rollbackPreparation(state.ownerA),
      ownerB: rollbackPreparation(state.ownerB),
    },
  }

  action joinExit: bool = all {
    or {
      state.phase == Draining,
      state.phase == SuccessReported,
      state.phase == FailureReported,
    },
    state.requestCount == 1,
    state' = { ...state, requestCount: 2 },
  }

  // Enumerated quick drain actions begin here. None can admit a successor.
  action observeOwnerAKnownResult: bool = all {
    state.phase == Draining,
    registeredOwnerIs(state.ownerA, InterruptibleBoundary),
    state' = {
      ...state,
      ownerA: NoForwardOwner,
      durable: { ...state.durable, ownerAKnownObservationRecorded: true },
    },
  }

  action observeOwnerBKnownResult: bool = all {
    state.phase == Draining,
    registeredOwnerIs(state.ownerB, InterruptibleBoundary),
    state' = {
      ...state,
      ownerB: NoForwardOwner,
      durable: { ...state.durable, ownerBKnownObservationRecorded: true },
    },
  }

  action interruptOwnerAWithRecoverableAmbiguity: bool = all {
    state.phase == Draining,
    registeredOwnerIs(state.ownerA, InterruptibleBoundary),
    state.durable.ownerAIntentAcknowledged,
    state' = { ...state, ownerA: NoForwardOwner, ownerAAmbiguous: true },
  }

  action interruptOwnerBWithRecoverableAmbiguity: bool = all {
    state.phase == Draining,
    registeredOwnerIs(state.ownerB, InterruptibleBoundary),
    state.durable.ownerBIntentAcknowledged,
    state' = { ...state, ownerB: NoForwardOwner, ownerBAmbiguous: true },
  }

  action finishAtomicOwnerA: bool = all {
    state.phase == Draining,
    registeredOwnerIs(state.ownerA, AtomicBoundary),
    state' = { ...state, ownerA: NoForwardOwner },
  }

  action finishAuthorizedTerminationAppendA: bool = all {
    state.phase == Draining,
    registeredOwnerIs(state.ownerA, AuthorizedRunTerminationAppend),
    state.durable.runTerminationAuthorized,
    state' = {
      ...state,
      ownerA: NoForwardOwner,
      durable: { ...state.durable, runTerminated: true },
    },
  }

  action recordAttemptASuspensionIntent: bool = all {
    state.phase == Draining,
    state.attemptA == AttemptExecuting,
    state' = {
      ...state,
      attemptA: SuspensionIntentRecorded,
      durable: { ...state.durable, attemptASuspensionIntentAcknowledged: true },
    },
  }

  action recordAttemptBSuspensionIntent: bool = all {
    state.phase == Draining,
    state.attemptB == AttemptExecuting,
    state' = {
      ...state,
      attemptB: SuspensionIntentRecorded,
      durable: { ...state.durable, attemptBSuspensionIntentAcknowledged: true },
    },
  }

  action callFastSuspensionA: bool = all {
    state.phase == Draining,
    state.attemptA == SuspensionIntentRecorded,
    state.durable.attemptASuspensionIntentAcknowledged,
    state' = { ...state, attemptA: FastSuspensionCalled },
  }

  action callFastSuspensionB: bool = all {
    state.phase == Draining,
    state.attemptB == SuspensionIntentRecorded,
    state.durable.attemptBSuspensionIntentAcknowledged,
    state' = { ...state, attemptB: FastSuspensionCalled },
  }

  action reportAttemptASafelySuspended: bool = all {
    state.phase == Draining,
    state.attemptA == FastSuspensionCalled,
    state' = { ...state, attemptA: AttemptSafelySuspended, attemptAPositionHeld: false },
  }

  action reportAttemptBSafelySuspended: bool = all {
    state.phase == Draining,
    state.attemptB == FastSuspensionCalled,
    state' = { ...state, attemptB: AttemptSafelySuspended, attemptBPositionHeld: false },
  }

  action reportAttemptATerminal: bool = all {
    state.phase == Draining,
    or {
      state.attemptA == AttemptExecuting,
      state.attemptA == SuspensionIntentRecorded,
      state.attemptA == FastSuspensionCalled,
    },
    state' = { ...state, attemptA: AttemptTerminal, attemptAPositionHeld: false },
  }

  action reportAttemptBTerminal: bool = all {
    state.phase == Draining,
    or {
      state.attemptB == AttemptExecuting,
      state.attemptB == SuspensionIntentRecorded,
      state.attemptB == FastSuspensionCalled,
    },
    state' = { ...state, attemptB: AttemptTerminal, attemptBPositionHeld: false },
  }

  action failFastSuspensionA: bool = all {
    state.phase == Draining,
    state.attemptA == FastSuspensionCalled,
    state' = { ...state, attemptA: SuspensionCallFailed, failureDiagnosticRetained: true },
  }

  action acknowledgeProducedWrite: bool = all {
    state.phase == Draining,
    state.write == ProducedWritePending,
    state' = { ...state, write: ProducedWriteAcknowledged },
  }

  action failProducedWrite: bool = all {
    state.phase == Draining,
    state.write == ProducedWritePending,
    state' = { ...state, write: ProducedWriteFailed, failureDiagnosticRetained: true },
  }

  action releaseReservation: bool = all {
    state.phase == Draining,
    state.reservationHeld,
    state' = { ...state, reservationHeld: false },
  }

  action closeFiber: bool = all {
    state.phase == Draining,
    state.fiberOpen,
    state' = { ...state, fiberOpen: false },
  }

  action releaseCoordinatorLock: bool = all {
    state.phase == Draining,
    state.coordinatorLockHeld,
    state' = { ...state, coordinatorLockHeld: false },
  }

  action reportSuccess: bool = all {
    state.phase == Draining,
    state.tick < 5,
    successBoundaryReached(state),
    state' = {
      ...state,
      phase: SuccessReported,
      result: Succeeded,
      requestedStatus: ZeroStatus,
    },
  }

  action reportFailure: bool = all {
    state.phase == Draining,
    state.tick < 5,
    state.failureDiagnosticRetained,
    noUsefulQuickWorkRemains(state),
    state' = {
      ...state,
      phase: FailureReported,
      result: Failed,
      requestedStatus: NonzeroStatus,
    },
  }

  // The fifth monotonic tick atomically chooses timed-out forced termination.
  action advanceTick: bool = all {
    state.phase == Draining,
    state.tick < 5,
    if (state.tick == 4)
      state' = {
        ...state,
        phase: ProcessGoneTimeout,
        tick: 5,
        result: TimedOut,
        requestedStatus: NonzeroStatus,
        trace: { ...state.trace, forcedTerminationRequested: true },
      }
    else
      state' = { ...state, tick: state.tick + 1 },
  }

  action stopAfterSuccess: bool = all {
    state.phase == SuccessReported,
    state.result == Succeeded,
    state.requestedStatus == ZeroStatus,
    state' = {
      ...state,
      phase: ProcessGoneGraceful,
      trace: { ...state.trace, gracefulTerminationRequested: true },
    },
  }

  action forceAfterFailure: bool = all {
    state.phase == FailureReported,
    state.result == Failed,
    state.requestedStatus == NonzeroStatus,
    state' = {
      ...state,
      phase: ProcessGoneFailure,
      trace: { ...state.trace, forcedTerminationRequested: true },
    },
  }

  action unexpectedDeath: bool = all {
    state.phase == Serving or state.phase == Draining,
    state' = {
      ...state,
      phase: ProcessGoneUnexpected,
      result: NoExitResult,
      requestedStatus: NoRequestedStatus,
      ownerA: NoForwardOwner,
      ownerB: NoForwardOwner,
      attemptA: AttemptNotStarted,
      attemptB: AttemptNotStarted,
      attemptAPositionHeld: false,
      attemptBPositionHeld: false,
      write: NoProducedWrite,
      reservationHeld: false,
      fiberOpen: false,
      coordinatorLockHeld: false,
      trace: { ...state.trace, unexpectedDeathObserved: true },
    },
  }

  action restartApplication: bool = all {
    processIsGone(state.phase),
    state' = {
      ...state,
      phase: Serving,
      tick: 0,
      cutoffCount: 0,
      requestCount: 0,
      result: NoExitResult,
      requestedStatus: NoRequestedStatus,
      ownerA: NoForwardOwner,
      ownerB: NoForwardOwner,
      attemptA: AttemptNotStarted,
      attemptB: AttemptNotStarted,
      attemptAPositionHeld: false,
      attemptBPositionHeld: false,
      write: NoProducedWrite,
      reservationHeld: false,
      fiberOpen: false,
      coordinatorLockHeld: true,
      failureDiagnosticRetained: false,
      ownerAAmbiguous: false,
      ownerBAmbiguous: false,
      trace: { ...state.trace, restarted: true, restartClearedLifecycle: true },
    },
  }

  // D50: the cutoff is unique and no owner registration crosses it.
  val cutoffClosesAtMostOncePerApplicationIncarnation: bool =
    state.cutoffCount >= 0 and state.cutoffCount <= 1

  val preparingAdmissionNeverSurvivesTheCutoff: bool =
    state.phase == Serving
      or and {
        state.ownerA != PreparingForwardOwner(InterruptibleBoundary),
        state.ownerA != PreparingForwardOwner(AtomicBoundary),
        state.ownerA != PreparingForwardOwner(AuthorizedRunTerminationAppend),
        state.ownerB != PreparingForwardOwner(InterruptibleBoundary),
        state.ownerB != PreparingForwardOwner(AtomicBoundary),
        state.ownerB != PreparingForwardOwner(AuthorizedRunTerminationAppend),
      }

  val forwardOwnerRegistrationRequiresServing: bool =
    state.trace.postCutoffForwardRegistrations == 0

  val joinedRequestNeverResetsTheDrain: bool = and {
    state.trace.timerResets == 0,
    state.trace.tickRegressions == 0,
    state.requestCount != 2 or state.cutoffCount == 1,
  }

  val joinedRequestsReceiveOneSharedResult: bool =
    state.trace.joinedResultMismatches == 0

  // D50/D51: only the accepted quick drain action families may start.
  val onlyEnumeratedQuickDrainActionsBeginAfterCutoff: bool = and {
    state.trace.llmRequests == 0,
    state.trace.freshReconciliationReads == 0,
    state.trace.stabilizationReads == 0,
    state.trace.durableCleanupCalls == 0,
    state.trace.attemptReplacements == 0,
    state.trace.postCutoffControlApplications == 0,
    state.trace.postCutoffTerminationStarts == 0,
  }

  val recoverableAmbiguityRequiresAcknowledgedExactIntent: bool = and {
    not(state.ownerAAmbiguous)
      or and {
        state.durable.ownerAIntentAcknowledged,
        state.ownerA == NoForwardOwner,
      },
    not(state.ownerBAmbiguous)
      or and {
        state.durable.ownerBIntentAcknowledged,
        state.ownerB == NoForwardOwner,
      },
    state.trace.ambiguousReleasesWithoutIntent == 0,
  }

  val knownBoundaryObservationRequiresItsAcknowledgedIntent: bool = and {
    not(state.durable.ownerAKnownObservationRecorded) or state.durable.ownerAIntentAcknowledged,
    not(state.durable.ownerBKnownObservationRecorded) or state.durable.ownerBIntentAcknowledged,
  }

  val exactSafeOrTerminalEvidenceControlsPositionRelease: bool = and {
    state.attemptAPositionHeld
      == or {
        state.attemptA == AttemptExecuting,
        state.attemptA == SuspensionIntentRecorded,
        state.attemptA == FastSuspensionCalled,
        state.attemptA == SuspensionCallFailed,
      },
    state.attemptBPositionHeld
      == or {
        state.attemptB == AttemptExecuting,
        state.attemptB == SuspensionIntentRecorded,
        state.attemptB == FastSuspensionCalled,
        state.attemptB == SuspensionCallFailed,
      },
    state.trace.foreignExecutorReleases == 0,
  }

  val fastSuspensionRequiresAcknowledgedCommandIntent: bool = and {
    state.attemptA != FastSuspensionCalled or state.durable.attemptASuspensionIntentAcknowledged,
    state.attemptB != FastSuspensionCalled or state.durable.attemptBSuspensionIntentAcknowledged,
  }

  val successfulExitRequiresRecoverableBoundary: bool =
    state.result != Succeeded
      or and {
        not(state.failureDiagnosticRetained),
        state.ownerA == NoForwardOwner,
        state.ownerB == NoForwardOwner,
        or {
          state.attemptA == AttemptNotStarted,
          state.attemptA == AttemptSafelySuspended,
          state.attemptA == AttemptTerminal,
        },
        or {
          state.attemptB == AttemptNotStarted,
          state.attemptB == AttemptSafelySuspended,
          state.attemptB == AttemptTerminal,
        },
        state.write != ProducedWritePending,
        state.write != ProducedWriteFailed,
        not(state.reservationHeld),
        not(state.fiberOpen),
        not(state.coordinatorLockHeld),
        state.requestedStatus == ZeroStatus,
      }

  val conclusiveFailureWaitsForUsefulQuickWork: bool =
    state.result != Failed
      or and {
        state.failureDiagnosticRetained,
        state.ownerA != RegisteredForwardOwner(InterruptibleBoundary),
        state.ownerA != RegisteredForwardOwner(AtomicBoundary),
        state.ownerA != RegisteredForwardOwner(AuthorizedRunTerminationAppend),
        state.ownerB != RegisteredForwardOwner(InterruptibleBoundary),
        state.ownerB != RegisteredForwardOwner(AtomicBoundary),
        state.ownerB != RegisteredForwardOwner(AuthorizedRunTerminationAppend),
        state.attemptA != AttemptExecuting,
        state.attemptA != SuspensionIntentRecorded,
        state.attemptA != FastSuspensionCalled,
        state.attemptB != AttemptExecuting,
        state.attemptB != SuspensionIntentRecorded,
        state.attemptB != FastSuspensionCalled,
        state.write != ProducedWritePending,
        not(state.reservationHeld),
        not(state.fiberOpen),
        not(state.coordinatorLockHeld),
      }

  val fifthTickAtomicallyForcesTimedOutTermination: bool = and {
    state.tick != 5
      or and {
        state.phase == ProcessGoneTimeout,
        state.result == TimedOut,
        state.requestedStatus == NonzeroStatus,
        state.trace.forcedTerminationRequested,
      },
    state.phase != ProcessGoneTimeout or state.tick == 5,
  }

  val failureAndTimeoutRequestNonzeroForcedTermination: bool = and {
    state.phase != ProcessGoneFailure
      or and {
        state.result == Failed,
        state.requestedStatus == NonzeroStatus,
        state.trace.forcedTerminationRequested,
      },
    state.phase != ProcessGoneTimeout
      or and {
        state.result == TimedOut,
        state.requestedStatus == NonzeroStatus,
        state.trace.forcedTerminationRequested,
      },
  }

  val successReportsBeforeGracefulProcessEnd: bool =
    state.phase != ProcessGoneGraceful
      or and {
        state.result == Succeeded,
        state.requestedStatus == ZeroStatus,
        state.trace.gracefulTerminationRequested,
      }

  val unexpectedDeathNeverReportsGracefulSuccess: bool =
    state.phase != ProcessGoneUnexpected
      or and {
        state.result == NoExitResult,
        state.requestedStatus == NoRequestedStatus,
        state.trace.unexpectedDeathObserved,
      }

  // D51/D52: only an already-authorized termination append may change Run
  // finality; every other lifecycle value remains outside workflow history.
  val runTerminationRequiresPreCutoffAuthorization: bool =
    not(state.durable.runTerminated) or state.durable.runTerminationAuthorized

  val applicationLifecycleNeverEntersWorkflowHistory: bool = and {
    state.durable.workflowExitRecords == 0,
    state.trace.manufacturedWorkflowOutcomes == 0,
  }

  val exitNeverDisposesDurableWorkflowResources: bool = and {
    state.durable.durableResourcesPreserved,
    state.trace.durableCleanupCalls == 0,
  }

  val restartRestoresNoApplicationLifecycleState: bool =
    not(state.trace.restarted) or state.trace.restartClearedLifecycle

  val modelStateIsFiniteAndBounded: bool = and {
    state.tick >= 0,
    state.tick <= 5,
    state.requestCount >= 0,
    state.requestCount <= 2,
    state.durable.workflowExitRecords >= 0,
    state.durable.workflowExitRecords <= 0,
  }

  // Witnesses cover every application lifecycle phase and every distinct
  // owner/executor/drain evidence phase used by a guard.
  val servingReached: bool = state.phase == Serving
  val drainingReached: bool = state.phase == Draining
  val successReportedReached: bool = state.phase == SuccessReported
  val failureReportedReached: bool = state.phase == FailureReported
  val gracefulProcessGoneReached: bool = state.phase == ProcessGoneGraceful
  val failedProcessGoneReached: bool = state.phase == ProcessGoneFailure
  val timedOutProcessGoneReached: bool = state.phase == ProcessGoneTimeout
  val unexpectedProcessGoneReached: bool = state.phase == ProcessGoneUnexpected
  val restartedServingReached: bool = state.phase == Serving and state.trace.restarted
  val ownerPreparingReached: bool = ownerIsPreparing(state.ownerA) or ownerIsPreparing(state.ownerB)
  val interruptibleOwnerRegisteredReached: bool =
    registeredOwnerIs(state.ownerA, InterruptibleBoundary)
      or registeredOwnerIs(state.ownerB, InterruptibleBoundary)
  val atomicOwnerRegisteredReached: bool = registeredOwnerIs(state.ownerA, AtomicBoundary)
  val terminationAppendOwnerRegisteredReached: bool =
    registeredOwnerIs(state.ownerA, AuthorizedRunTerminationAppend)
  val joinedRequestReached: bool = state.requestCount == 2
  val recoverableAmbiguityReached: bool = state.ownerAAmbiguous or state.ownerBAmbiguous
  val executingAttemptReached: bool = state.attemptA == AttemptExecuting or state.attemptB == AttemptExecuting
  val suspensionIntentReached: bool =
    state.attemptA == SuspensionIntentRecorded or state.attemptB == SuspensionIntentRecorded
  val fastSuspensionCalledReached: bool =
    state.attemptA == FastSuspensionCalled or state.attemptB == FastSuspensionCalled
  val safelySuspendedReached: bool =
    state.attemptA == AttemptSafelySuspended or state.attemptB == AttemptSafelySuspended
  val terminalAttemptReached: bool = state.attemptA == AttemptTerminal or state.attemptB == AttemptTerminal
  val suspensionFailureReached: bool =
    state.attemptA == SuspensionCallFailed or state.attemptB == SuspensionCallFailed
  val producedWriteReached: bool = state.write == ProducedWritePending
  val acknowledgedWriteReached: bool = state.write == ProducedWriteAcknowledged
  val failedWriteReached: bool = state.write == ProducedWriteFailed
  val pausePreservedReached: bool = state.durable.pauseApplied and state.phase != Serving
  val authorizedTerminationFinishedReached: bool = state.durable.runTerminated
  val fourthTickReached: bool = state.phase == Draining and state.tick == 4

  action step: bool = any {
    acknowledgeOwnerAIntent,
    acknowledgeOwnerBIntent,
    prepareInterruptibleOwnerA,
    prepareAtomicOwnerA,
    prepareTerminationAppendOwnerA,
    prepareInterruptibleOwnerB,
    registerOwnerA,
    registerOwnerB,
    startAttemptA,
    startAttemptB,
    produceJournalWrite,
    holdReservation,
    openFiber,
    applyPauseBeforeCutoff,
    acceptExit,
    joinExit,
    observeOwnerAKnownResult,
    observeOwnerBKnownResult,
    interruptOwnerAWithRecoverableAmbiguity,
    interruptOwnerBWithRecoverableAmbiguity,
    finishAtomicOwnerA,
    finishAuthorizedTerminationAppendA,
    recordAttemptASuspensionIntent,
    recordAttemptBSuspensionIntent,
    callFastSuspensionA,
    callFastSuspensionB,
    reportAttemptASafelySuspended,
    reportAttemptBSafelySuspended,
    reportAttemptATerminal,
    reportAttemptBTerminal,
    failFastSuspensionA,
    acknowledgeProducedWrite,
    failProducedWrite,
    releaseReservation,
    closeFiber,
    releaseCoordinatorLock,
    reportSuccess,
    reportFailure,
    advanceTick,
    stopAfterSuccess,
    forceAfterFailure,
    unexpectedDeath,
    restartApplication,
  }
}
