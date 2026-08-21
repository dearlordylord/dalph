// Models the application boundary that reads one startup scope, establishes
// one exact Run from durable Journal history, and gives it to one bounded
// activation. The coordinator is one actor over shared Journal, authority,
// process-local, and trace-observation state; there is no message medium and
// no recovery-only action surface.
module runActivation {
  type RunId = R1 | R2
  type TrackerTarget = Target1 | Target2
  type TaskId = TaskA | TaskB | TaskC
  type AttemptId = AttemptA | AttemptB | AttemptC

  type PolicyRevision = PolicyRevision0 | PolicyRevision1
  type TaskCapacity = Capacity1 | Capacity2
  type ControlPolicy = { revision: PolicyRevision, taskCapacity: TaskCapacity }

  // These are the only V1 whole-Run terminal dispositions. Failed is
  // deliberately absent until a separately accepted conclusive Run-level
  // failure protocol exists.
  type TerminalDisposition = NoTerminal | Completed | Blocked | Cancelled

  // A complete tracker read can prove all-success, conclusive impossibility,
  // or neither. Temporary waits and unreadable/partial reads are not terminal
  // graph facts.
  type GraphOutcome = GraphAllSucceeded | GraphBlocked | GraphUnsettled

  // Tracker content identity is a provider revision/fingerprint, not the
  // operation ordinal used to count this activation's boundary calls. The
  // stale variant exists only for mutation controls that must make an invalid
  // terminal proof reachable.
  type TrackerContentIdentity =
    | ContentRevisionAllSucceeded
    | ContentRevisionBlocked
    | ContentRevisionUnsettled
    | StaleContentRevision

  type GraphReadEvidence =
    | NoGraphReadEvidence
    | ExactGraphReadEvidence({
        runId: RunId,
        target: TrackerTarget,
        operationOrdinal: int,
        graphOutcome: GraphOutcome,
        contentIdentity: TrackerContentIdentity,
        rootTaskId: TaskId,
        coveredTaskIds: Set[TaskId],
        complete: bool,
      })
    | MismatchedGraphReadEvidence
    | IncompleteGraphReadEvidence

  type AttemptCorrelation = {
    runId: RunId,
    taskId: TaskId,
    attemptId: AttemptId,
  }

  type RetainedAttempt =
    | NoRetainedAttempt
    | ExactRetainedAttempt(AttemptCorrelation)

  // One valid reduced history carries both the policy recorded at the Run
  // beginning and the latest policy reconstructed from every accepted change.
  type RunHistoryFacts = {
    runId: RunId,
    target: TrackerTarget,
    initialPolicy: ControlPolicy,
    latestPolicy: ControlPolicy,
    retainedAttempt: RetainedAttempt,
    otherRetainedAttempt: RetainedAttempt,
  }

  type InvalidHistoryKind =
    | DuplicateBeginning
    | ForeignRunRecord
    | InvalidChronology

  // These variants are the finite startup histories accepted by the scenario:
  // absent, one unfinished, several unfinished, one closed, or invalid.
  type StartupHistory =
    | EmptyHistory
    | OneUnfinishedHistory(RunHistoryFacts)
    | MultipleUnfinishedHistories({ first: RunHistoryFacts, second: RunHistoryFacts })
    | TerminatedHistory(RunHistoryFacts)
    | InvalidHistory({ runId: RunId, issue: InvalidHistoryKind })

  type EstablishedRun =
    | NoEstablishedRun
    | ExactEstablishedRun(RunHistoryFacts)

  type TaskPosition =
    | NoTaskPosition
    | ExactTaskPosition(AttemptCorrelation)

  type EstablishmentSource =
    | NoEstablishmentSource
    | BeginningAppended
    | ExistingHistoryReduced

  type EntryPhase =
    | EntryIdle
    | EstablishingRun
    | ActivatingRun
    | ActivationReturned
    | EntryFailed

  type EntryFailure =
    | NoEntryFailure
    | TargetMismatchFailure
    | OtherUnfinishedRunFailure
    | InvalidChronologyFailure
    | DuplicateBeginningFailure
    | ForeignRunRecordFailure
    | MultipleUnfinishedRunsFailure
    | TerminatedRunFailure

  type FinalityObservation =
    | NoFinalityObservation
    | PostQuiescenceObservation({
        targetSettled: bool,
        responsibilitiesSettled: bool,
        graphOutcome: GraphOutcome,
        evidence: GraphReadEvidence,
      })

  // This is recreated on every process entry. It is never durable authority.
  type ProcessState = {
    phase: EntryPhase,
    establishedRun: EstablishedRun,
    establishmentSource: EstablishmentSource,
    activationOrdinal: int,
    terminalDisposition: TerminalDisposition,
    heldPosition: TaskPosition,
    otherHeldPosition: TaskPosition,
    initialPolicyEvaluated: bool,
    beginningAppended: bool,
    initialTrackerObserved: bool,
    independentTaskAdmitted: bool,
    enteredAfterProcessLoss: bool,
    liveActionOwner: bool,
    quiescent: bool,
    postQuiescenceReads: int,
    finalityObservation: FinalityObservation,
    entryFailure: EntryFailure,
  }

  // These are current facts at the tracker boundary. An activation must obtain
  // its own later observation before either returning incomplete or recording
  // termination; the Journal does not own these current facts.
  type TrackerFinalityFacts = {
    targetSettled: bool,
    responsibilitiesSettled: bool,
    graphOutcome: GraphOutcome,
    contentIdentity: TrackerContentIdentity,
    rootTaskId: TaskId,
    coveredTaskIds: Set[TaskId],
    evidence: GraphReadEvidence,
  }

  pure val NO_GRAPH_EVIDENCE: GraphReadEvidence = NoGraphReadEvidence
  pure val INITIAL_GRAPH_EVIDENCE: GraphReadEvidence = NoGraphReadEvidence
  pure val EXACT_ROOT_TASK_ID: TaskId = TaskA

  // CompleteTargetClosure covers the target transitively; this set records
  // only additional task IDs explicitly named by the read operation. The
  // production G2 read names none, while its tracker result still contains
  // and validates the exact Run root and complete graph facts.
  pure def trackerCoverageFor(_outcome: GraphOutcome): Set[TaskId] = Set()

  pure def trackerContentIdentityFor(outcome: GraphOutcome): TrackerContentIdentity = match outcome {
    | GraphAllSucceeded => ContentRevisionAllSucceeded
    | GraphBlocked => ContentRevisionBlocked
    | GraphUnsettled => ContentRevisionUnsettled
  }

  pure def terminalDispositionFor(
    graphOutcome: GraphOutcome,
    cancellationApplied: bool,
  ): TerminalDisposition = if (graphOutcome == GraphAllSucceeded) Completed
    else if (cancellationApplied) Cancelled
    else if (graphOutcome == GraphBlocked) Blocked
    else NoTerminal

  pure def exactGraphEvidenceFor(
    runId: RunId,
    target: TrackerTarget,
    operationOrdinal: int,
    graphOutcome: GraphOutcome,
    contentIdentity: TrackerContentIdentity,
    rootTaskId: TaskId,
    coveredTaskIds: Set[TaskId],
  ): GraphReadEvidence = ExactGraphReadEvidence({
    runId: runId,
    target: target,
    operationOrdinal: operationOrdinal,
    graphOutcome: graphOutcome,
    contentIdentity: contentIdentity,
    rootTaskId: rootTaskId,
    coveredTaskIds: coveredTaskIds,
    complete: true,
  })

  pure def evidenceIsExactFor(
    evidence: GraphReadEvidence,
    runId: RunId,
    target: TrackerTarget,
    operationOrdinal: int,
    graphOutcome: GraphOutcome,
    contentIdentity: TrackerContentIdentity,
    rootTaskId: TaskId,
    coveredTaskIds: Set[TaskId],
  ): bool = match evidence {
    | ExactGraphReadEvidence(facts) => and {
        facts.runId == runId,
        facts.target == target,
        facts.operationOrdinal == operationOrdinal,
        facts.graphOutcome == graphOutcome,
        facts.contentIdentity == contentIdentity,
        facts.rootTaskId == rootTaskId,
        facts.coveredTaskIds == coveredTaskIds,
        facts.complete,
      }
    | _ => false
  }

  // Trace evidence is model-checker instrumentation, not a Dalph persistence
  // proposal. It makes forbidden duplicate evaluation, append, activation, and
  // boundary calls directly measurable across a modeled process crash.
  type TraceEvidence = {
    initialPolicyEvaluations: int,
    beginningAppends: int,
    terminationAppends: int,
    cancellationAppends: int,
    cancellationRedeliveries: int,
    activationsStarted: int,
    trackerCalls: int,
    gitCalls: int,
    executorCalls: int,
    processLosses: int,
    terminationHadLaterSettledObservation: bool,
    historyAtProcessLoss: StartupHistory,
  }

  type DurableState = {
    history: StartupHistory,
    independentTaskSettled: bool,
    cancellationApplied: bool,
    terminationDisposition: TerminalDisposition,
  }

  type State = {
    requestedRunId: RunId,
    requestedTarget: TrackerTarget,
    lazyInitialPolicy: ControlPolicy,
    durable: DurableState,
    trackerFinality: TrackerFinalityFacts,
    process: ProcessState,
    trace: TraceEvidence,
  }

  var state: State

  pure val INITIAL_POLICY: ControlPolicy = {
    revision: PolicyRevision0,
    taskCapacity: Capacity2,
  }

  pure val LATEST_POLICY: ControlPolicy = {
    revision: PolicyRevision1,
    taskCapacity: Capacity1,
  }

  pure val CONTRACTED_POLICY: ControlPolicy = {
    revision: PolicyRevision1,
    taskCapacity: Capacity1,
  }

  pure val RETAINED_ATTEMPT_A: AttemptCorrelation = {
    runId: R1,
    taskId: TaskA,
    attemptId: AttemptA,
  }

  pure val RETAINED_ATTEMPT_B: AttemptCorrelation = {
    runId: R1,
    taskId: TaskB,
    attemptId: AttemptB,
  }

  pure val INDEPENDENT_ATTEMPT_C: AttemptCorrelation = {
    runId: R1,
    taskId: TaskC,
    attemptId: AttemptC,
  }

  pure val EMPTY_FACTS: RunHistoryFacts = {
    runId: R1,
    target: Target1,
    initialPolicy: INITIAL_POLICY,
    latestPolicy: INITIAL_POLICY,
    retainedAttempt: NoRetainedAttempt,
    otherRetainedAttempt: NoRetainedAttempt,
  }

  pure val EXISTING_FACTS: RunHistoryFacts = {
    runId: R1,
    target: Target1,
    initialPolicy: INITIAL_POLICY,
    latestPolicy: LATEST_POLICY,
    retainedAttempt: ExactRetainedAttempt(RETAINED_ATTEMPT_A),
    otherRetainedAttempt: NoRetainedAttempt,
  }

  // A capacity contraction does not revoke a responsibility that was already
  // admitted. Activation derives positions for this retained holder and one
  // other exact durable responsibility before considering
  // whether the latest policy allows any new admission.
  pure val CONTRACTED_EXISTING_FACTS: RunHistoryFacts = {
    runId: R1,
    target: Target1,
    initialPolicy: INITIAL_POLICY,
    latestPolicy: CONTRACTED_POLICY,
    retainedAttempt: ExactRetainedAttempt(RETAINED_ATTEMPT_A),
    otherRetainedAttempt: ExactRetainedAttempt(RETAINED_ATTEMPT_B),
  }

  pure val TARGET_MISMATCHED_FACTS: RunHistoryFacts = {
    runId: R1,
    target: Target2,
    initialPolicy: INITIAL_POLICY,
    latestPolicy: LATEST_POLICY,
    retainedAttempt: NoRetainedAttempt,
    otherRetainedAttempt: NoRetainedAttempt,
  }

  pure val FOREIGN_FACTS: RunHistoryFacts = {
    runId: R2,
    target: Target2,
    initialPolicy: INITIAL_POLICY,
    latestPolicy: LATEST_POLICY,
    retainedAttempt: NoRetainedAttempt,
    otherRetainedAttempt: NoRetainedAttempt,
  }

  pure def unfinishedFacts(history: StartupHistory): RunHistoryFacts = match history {
    | OneUnfinishedHistory(facts) => facts
    | _ => EMPTY_FACTS
  }

  pure def acceptedHistoryFacts(history: StartupHistory): RunHistoryFacts = match history {
    | OneUnfinishedHistory(facts) => facts
    | TerminatedHistory(facts) => facts
    | _ => EMPTY_FACTS
  }

  pure def establishedFacts(established: EstablishedRun): RunHistoryFacts = match established {
    | ExactEstablishedRun(facts) => facts
    | NoEstablishedRun => EMPTY_FACTS
  }

  pure def exactRequestedUnfinished(
    history: StartupHistory,
    runId: RunId,
    target: TrackerTarget,
  ): bool = match history {
    | OneUnfinishedHistory(facts) =>
        facts.runId == runId and facts.target == target
    | _ => false
  }

  pure def mismatchedUnfinished(
    history: StartupHistory,
    runId: RunId,
    target: TrackerTarget,
  ): bool = match history {
    | OneUnfinishedHistory(facts) =>
        facts.runId != runId or facts.target != target
    | _ => false
  }

  pure def positionFor(retained: RetainedAttempt): TaskPosition = match retained {
    | NoRetainedAttempt => NoTaskPosition
    | ExactRetainedAttempt(correlation) => ExactTaskPosition(correlation)
  }

  pure def removeRetainedAttempt(facts: RunHistoryFacts): RunHistoryFacts = {
    ...facts,
    retainedAttempt: NoRetainedAttempt,
  }

  pure def removeOtherRetainedAttempt(facts: RunHistoryFacts): RunHistoryFacts = {
    ...facts,
    otherRetainedAttempt: NoRetainedAttempt,
  }

  pure def retainAttempt(facts: RunHistoryFacts, correlation: AttemptCorrelation): RunHistoryFacts = {
    ...facts,
    retainedAttempt: ExactRetainedAttempt(correlation),
  }

  pure def taskCapacityValue(capacity: TaskCapacity): int = match capacity {
    | Capacity1 => 1
    | Capacity2 => 2
  }

  pure def otherPositionsValue(position: TaskPosition): int = match position {
    | NoTaskPosition => 0
    | ExactTaskPosition(_) => 1
  }

  pure def resetProcess: ProcessState = {
    phase: EntryIdle,
    establishedRun: NoEstablishedRun,
    establishmentSource: NoEstablishmentSource,
    activationOrdinal: 0,
    terminalDisposition: NoTerminal,
    heldPosition: NoTaskPosition,
    otherHeldPosition: NoTaskPosition,
    initialPolicyEvaluated: false,
    beginningAppended: false,
    initialTrackerObserved: false,
    independentTaskAdmitted: false,
    enteredAfterProcessLoss: false,
    liveActionOwner: false,
    quiescent: false,
    postQuiescenceReads: 0,
    finalityObservation: NoFinalityObservation,
    entryFailure: NoEntryFailure,
  }

  pure def fixtureMayChange: bool = and {
    state.process.phase == EntryIdle,
    state.durable.history == EmptyHistory,
    state.trace.initialPolicyEvaluations == 0,
    state.trace.activationsStarted == 0,
    state.trace.processLosses == 0,
  }

  pure def finalityObservationIsSettled(observation: FinalityObservation): bool = match observation {
    | PostQuiescenceObservation(facts) => and {
        facts.targetSettled,
        facts.responsibilitiesSettled,
        match facts.evidence {
          | ExactGraphReadEvidence(evidence) => and {
              evidence.graphOutcome == facts.graphOutcome,
              evidence.contentIdentity == trackerContentIdentityFor(facts.graphOutcome),
              evidence.rootTaskId == EXACT_ROOT_TASK_ID,
              evidence.coveredTaskIds == trackerCoverageFor(facts.graphOutcome),
              evidence.complete,
            }
          | _ => false
        },
      }
    | NoFinalityObservation => false
  }

  // D13: the current capacity ceiling gates only a new admission. A retained
  // attempt reconstructed from durable history may remain held after the
  // ceiling contracts below the number of existing holders.
  val newIndependentAdmissionAllowed: bool = and {
    state.process.phase == ActivatingRun,
    state.process.initialTrackerObserved,
    state.process.heldPosition == NoTaskPosition,
    otherPositionsValue(state.process.otherHeldPosition)
      < taskCapacityValue(establishedFacts(state.process.establishedRun).latestPolicy.taskCapacity),
    not(state.process.independentTaskAdmitted),
    not(state.durable.independentTaskSettled),
    not(state.durable.cancellationApplied),
    not(state.trackerFinality.targetSettled),
    taskCapacityValue(establishedFacts(state.process.establishedRun).latestPolicy.taskCapacity) >= 1,
    exactRequestedUnfinished(state.durable.history, state.requestedRunId, state.requestedTarget),
  }

  val oneBeginningPerRun: bool = state.trace.beginningAppends <= 1

  val existingHistorySkipsInitialPolicy: bool =
    state.process.establishmentSource != ExistingHistoryReduced
      or and {
        not(state.process.initialPolicyEvaluated),
        not(state.process.beginningAppended),
      }

  val beginningRecordsExactLazyPolicy: bool =
    state.process.establishmentSource != BeginningAppended
      or {
        val facts = establishedFacts(state.process.establishedRun)
        and {
          facts.runId == state.requestedRunId,
          facts.target == state.requestedTarget,
          facts.initialPolicy == state.lazyInitialPolicy,
          facts.latestPolicy == state.lazyInitialPolicy,
        }
      }

  val existingHistoryUsesLatestDurablePolicy: bool =
    state.process.establishmentSource != ExistingHistoryReduced
      or establishedFacts(state.process.establishedRun).latestPolicy
        == acceptedHistoryFacts(state.durable.history).latestPolicy

  val onlyExactEstablishedRunActivates: bool =
    state.process.phase != ActivatingRun
      or match state.process.establishedRun {
        | ExactEstablishedRun(facts) =>
            facts.runId == state.requestedRunId and facts.target == state.requestedTarget
        | NoEstablishedRun => false
      }

  val atMostOneDiscoveredUnfinishedRunMayActivate: bool = match state.durable.history {
    | MultipleUnfinishedHistories(_) => state.process.phase != ActivatingRun
    | _ => true
  }

  val terminatedRunIsFinal: bool = match state.durable.history {
    | TerminatedHistory(_) =>
        state.process.phase != ActivatingRun and state.trace.terminationAppends <= 1
    | _ => true
  }

  val everyDurableRetainedAttemptHasExactPosition: bool = match state.durable.history {
    | OneUnfinishedHistory(facts) =>
        state.process.phase != ActivatingRun
          or and {
            match facts.retainedAttempt {
              | ExactRetainedAttempt(correlation) =>
                  state.process.heldPosition == ExactTaskPosition(correlation)
              | NoRetainedAttempt => state.process.heldPosition == NoTaskPosition
            },
            match facts.otherRetainedAttempt {
              | ExactRetainedAttempt(correlation) =>
                  state.process.otherHeldPosition == ExactTaskPosition(correlation)
              | NoRetainedAttempt => state.process.otherHeldPosition == NoTaskPosition
            },
          }
    | _ => true
  }

  val independentAdmissionRequiresAvailablePosition: bool =
    not(state.process.independentTaskAdmitted)
      or and {
        state.process.heldPosition == ExactTaskPosition(INDEPENDENT_ATTEMPT_C),
        unfinishedFacts(state.durable.history).retainedAttempt
          == ExactRetainedAttempt(INDEPENDENT_ATTEMPT_C),
      }

  val latestPolicyControlsAdmission: bool =
    not(state.process.independentTaskAdmitted)
      or 1 + otherPositionsValue(state.process.otherHeldPosition)
        <= taskCapacityValue(
          establishedFacts(state.process.establishedRun).latestPolicy.taskCapacity
        )

  val establishmentSourceDoesNotChangeActivationBounds: bool = and {
    state.process.activationOrdinal >= 0,
    state.process.activationOrdinal <= 1,
    state.process.postQuiescenceReads >= 0,
    state.process.postQuiescenceReads <= 1,
    state.process.phase != ActivatingRun
      or state.process.establishmentSource != NoEstablishmentSource,
  }

  val activationStartsAfterDurableBeginning: bool =
    state.process.phase != ActivatingRun
      or match state.durable.history {
        | OneUnfinishedHistory(_) => true
        | _ => false
      }

  val finalityReadRequiresQuiescence: bool =
    state.process.postQuiescenceReads == 0 or state.process.quiescent

  val terminationRequiresLaterSettledObservation: bool =
    state.trace.terminationAppends == 0
      or state.trace.terminationHadLaterSettledObservation

  val terminationRequiresNoRetainedResponsibilityOrPosition: bool =
    state.trace.terminationAppends == 0
      or match state.durable.history {
        | TerminatedHistory(facts) => and {
            facts.retainedAttempt == NoRetainedAttempt,
            facts.otherRetainedAttempt == NoRetainedAttempt,
            state.process.heldPosition == NoTaskPosition,
            state.process.otherHeldPosition == NoTaskPosition,
          }
        | _ => false
      }

  // Final classification is derived from the fresh graph and the durable
  // cancellation direction, never from enum ordering or a task outcome alone.
  val terminalDispositionMatchesAcceptedFacts: bool =
    state.trace.terminationAppends == 0
      or and {
        state.trace.terminationAppends == 1,
        (state.trackerFinality.graphOutcome == GraphAllSucceeded
          and state.durable.terminationDisposition == Completed)
          or (state.trackerFinality.graphOutcome != GraphAllSucceeded
            and state.durable.cancellationApplied
            and state.durable.terminationDisposition == Cancelled)
          or (state.trackerFinality.graphOutcome == GraphBlocked
            and not(state.durable.cancellationApplied)
            and state.durable.terminationDisposition == Blocked)
          or (state.trackerFinality.graphOutcome == GraphUnsettled
            and not(state.durable.cancellationApplied)
            and state.durable.terminationDisposition == NoTerminal),
      }

  val completedRequiresAllCurrentTasksSuccessful: bool =
    state.durable.terminationDisposition != Completed
      or and {
        state.trackerFinality.graphOutcome == GraphAllSucceeded,
        state.trace.terminationAppends == 1,
      }

  val blockedRequiresFreshConclusiveTrackerFacts: bool =
    state.durable.terminationDisposition != Blocked
      or and {
        state.trackerFinality.graphOutcome == GraphBlocked,
        not(state.durable.cancellationApplied),
        state.trace.terminationAppends == 1,
      }

  val cancelledRequiresAppliedAndSettledDirection: bool =
    state.durable.terminationDisposition != Cancelled
      or and {
        state.durable.cancellationApplied,
        state.trackerFinality.graphOutcome != GraphAllSucceeded,
        state.trace.terminationAppends == 1,
      }

  val terminationRequiresExactFreshGraphEvidence: bool =
    state.trace.terminationAppends == 0
      or match state.trackerFinality.evidence {
        | ExactGraphReadEvidence(facts) => and {
            facts.runId == state.requestedRunId,
            facts.target == state.requestedTarget,
            facts.operationOrdinal == state.trace.trackerCalls,
            facts.graphOutcome == state.trackerFinality.graphOutcome,
            facts.contentIdentity == trackerContentIdentityFor(state.trackerFinality.graphOutcome),
            facts.rootTaskId == EXACT_ROOT_TASK_ID,
            facts.coveredTaskIds == state.trackerFinality.coveredTaskIds,
            facts.complete,
          }
        | _ => false
      }

  val cancellationAppliedAtMostOnce: bool = state.trace.cancellationAppends <= 1

  val cancellationClosesForwardAdmission: bool =
    not(state.durable.cancellationApplied)
      or not(state.process.independentTaskAdmitted)
      or state.process.liveActionOwner

  val cancellationRedeliveryDoesNotAppend: bool =
    state.trace.cancellationRedeliveries == 0 or state.trace.cancellationAppends == 1

  val trackerCallsRequireEstablishedHistory: bool =
    state.trace.trackerCalls == 0
      or match state.durable.history {
        | OneUnfinishedHistory(_) => true
        | TerminatedHistory(_) => true
        | _ => false
      }

  val processLossPreservesDurableHistory: bool =
    not(state.process.enteredAfterProcessLoss)
      or state.process.phase != EntryIdle
      or state.durable.history == state.trace.historyAtProcessLoss

  val modelIsFiniteAndBounded: bool = and {
    state.trace.initialPolicyEvaluations >= 0,
    state.trace.initialPolicyEvaluations <= 1,
    state.trace.beginningAppends >= 0,
    state.trace.beginningAppends <= 1,
    state.trace.terminationAppends >= 0,
    state.trace.terminationAppends <= 1,
    state.trace.activationsStarted >= 0,
    state.trace.activationsStarted <= 2,
    state.trace.trackerCalls >= 0,
    state.trace.trackerCalls <= 4,
    state.trace.gitCalls == 0,
    state.trace.executorCalls >= 0,
    state.trace.executorCalls <= 4,
    state.trace.processLosses >= 0,
    state.trace.processLosses <= 1,
  }

  val absentHistoryEstablishedReached: bool =
    state.process.phase == EstablishingRun and state.process.establishmentSource == BeginningAppended
  val existingHistoryEstablishedReached: bool =
    state.process.phase == EstablishingRun and state.process.establishmentSource == ExistingHistoryReduced
  val retainedPositionReconstructedReached: bool =
    state.process.phase == ActivatingRun
      and state.process.heldPosition == ExactTaskPosition(RETAINED_ATTEMPT_A)
  val initialTrackerObservationReached: bool = state.process.initialTrackerObserved
  val postQuiescenceAfterBeginningReached: bool =
    state.process.establishmentSource == BeginningAppended and state.process.postQuiescenceReads == 1
  val postQuiescenceAfterExistingReached: bool =
    state.process.establishmentSource == ExistingHistoryReduced and state.process.postQuiescenceReads == 1
  val incompleteReturnReached: bool =
    state.process.phase == ActivationReturned and state.trace.terminationAppends == 0
  val terminatedReached: bool = state.trace.terminationAppends == 1
  val processLossReached: bool = state.trace.processLosses == 1
  val mismatchBlockedReached: bool =
    state.process.phase == EntryFailed
      and mismatchedUnfinished(state.durable.history, state.requestedRunId, state.requestedTarget)
  val targetMismatchBlockedReached: bool =
    state.process.phase == EntryFailed
      and state.durable.history == OneUnfinishedHistory(TARGET_MISMATCHED_FACTS)
  val requestedRunAbsentBlockedReached: bool =
    state.process.phase == EntryFailed
      and state.requestedRunId == R2
      and state.durable.history == OneUnfinishedHistory(EXISTING_FACTS)
  val invalidHistoryBlockedReached: bool =
    state.process.phase == EntryFailed
      and match state.durable.history { | InvalidHistory(_) => true | _ => false }
  val duplicateBeginningBlockedReached: bool =
    state.process.phase == EntryFailed
      and state.durable.history == InvalidHistory({ runId: R1, issue: DuplicateBeginning })
  val foreignRunRecordBlockedReached: bool =
    state.process.phase == EntryFailed
      and state.durable.history == InvalidHistory({ runId: R1, issue: ForeignRunRecord })
  val invalidChronologyBlockedReached: bool =
    state.process.phase == EntryFailed
      and state.durable.history == InvalidHistory({ runId: R1, issue: InvalidChronology })
  val multipleUnfinishedBlockedReached: bool =
    state.process.phase == EntryFailed
      and match state.durable.history { | MultipleUnfinishedHistories(_) => true | _ => false }
  val terminatedHistoryBlockedReached: bool =
    state.process.phase == EntryFailed
      and match state.durable.history { | TerminatedHistory(_) => true | _ => false }
  val independentAdmissionReached: bool =
    state.process.independentTaskAdmitted or state.durable.independentTaskSettled
  val contractedRetainedPositionReached: bool =
    state.process.phase == ActivatingRun
      and establishedFacts(state.process.establishedRun).latestPolicy == CONTRACTED_POLICY
      and state.process.heldPosition == ExactTaskPosition(RETAINED_ATTEMPT_A)
      and state.process.otherHeldPosition == ExactTaskPosition(RETAINED_ATTEMPT_B)
  val otherRetainedAttemptSettledReached: bool =
    state.process.phase == ActivatingRun
      and establishedFacts(state.process.establishedRun).latestPolicy == CONTRACTED_POLICY
      and unfinishedFacts(state.durable.history).otherRetainedAttempt == NoRetainedAttempt
      and state.trace.executorCalls >= 2
  val exactGraphEvidenceReached: bool = match state.trackerFinality.evidence {
    | ExactGraphReadEvidence(_) => true
    | _ => false
  }
  val exactGraphIdentityReached: bool = match state.trackerFinality.evidence {
    | ExactGraphReadEvidence(facts) => and {
        facts.graphOutcome == state.trackerFinality.graphOutcome,
        facts.contentIdentity == trackerContentIdentityFor(state.trackerFinality.graphOutcome),
        facts.rootTaskId == EXACT_ROOT_TASK_ID,
        facts.coveredTaskIds == state.trackerFinality.coveredTaskIds,
      }
    | _ => false
  }
  val blockedGraphReadReached: bool = state.trackerFinality.graphOutcome == GraphBlocked
  val cancellationAppliedReached: bool = state.durable.cancellationApplied
  val cancellationRedeliveredReached: bool = state.trace.cancellationRedeliveries == 1
  val completedDispositionReached: bool = state.process.terminalDisposition == Completed
  val blockedDispositionReached: bool = state.process.terminalDisposition == Blocked
  val cancelledDispositionReached: bool = state.process.terminalDisposition == Cancelled

  action init: bool = all {
    state' = {
      requestedRunId: R1,
      requestedTarget: Target1,
      lazyInitialPolicy: INITIAL_POLICY,
      durable: {
        history: EmptyHistory,
        independentTaskSettled: false,
        cancellationApplied: false,
        terminationDisposition: NoTerminal,
      },
      trackerFinality: {
        targetSettled: false,
        responsibilitiesSettled: true,
        graphOutcome: GraphAllSucceeded,
        contentIdentity: ContentRevisionAllSucceeded,
        rootTaskId: EXACT_ROOT_TASK_ID,
        coveredTaskIds: trackerCoverageFor(GraphAllSucceeded),
        evidence: INITIAL_GRAPH_EVIDENCE,
      },
      process: {
        phase: EntryIdle,
        establishedRun: NoEstablishedRun,
        establishmentSource: NoEstablishmentSource,
        activationOrdinal: 0,
        terminalDisposition: NoTerminal,
        heldPosition: NoTaskPosition,
        otherHeldPosition: NoTaskPosition,
        initialPolicyEvaluated: false,
        beginningAppended: false,
        initialTrackerObserved: false,
        independentTaskAdmitted: false,
        enteredAfterProcessLoss: false,
        liveActionOwner: false,
        quiescent: false,
        postQuiescenceReads: 0,
        finalityObservation: NoFinalityObservation,
        entryFailure: NoEntryFailure,
      },
      trace: {
        initialPolicyEvaluations: 0,
        beginningAppends: 0,
        terminationAppends: 0,
        cancellationAppends: 0,
        cancellationRedeliveries: 0,
        activationsStarted: 0,
        trackerCalls: 0,
        gitCalls: 0,
        executorCalls: 0,
        processLosses: 0,
        terminationHadLaterSettledObservation: false,
        historyAtProcessLoss: EmptyHistory,
      },
    },
  }

  action selectExactExistingHistory: bool = all {
    fixtureMayChange,
    state' = {
      ...state,
      durable: { ...state.durable, history: OneUnfinishedHistory(EXISTING_FACTS) },
      trackerFinality: { ...state.trackerFinality, responsibilitiesSettled: false },
    },
  }

  action selectContractedExactExistingHistory: bool = all {
    fixtureMayChange,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: OneUnfinishedHistory(CONTRACTED_EXISTING_FACTS),
      },
      trackerFinality: { ...state.trackerFinality, responsibilitiesSettled: false },
    },
  }

  action selectMismatchedExistingHistory: bool = all {
    fixtureMayChange,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: OneUnfinishedHistory(TARGET_MISMATCHED_FACTS),
      },
    },
  }

  action selectOtherUnfinishedRun: bool = all {
    fixtureMayChange,
    state' = {
      ...state,
      requestedRunId: R2,
      durable: { ...state.durable, history: OneUnfinishedHistory(EXISTING_FACTS) },
    },
  }

  action selectInvalidHistory: bool = all {
    fixtureMayChange,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: InvalidHistory({ runId: R1, issue: InvalidChronology }),
      },
    },
  }

  action selectDuplicateBeginningHistory: bool = all {
    fixtureMayChange,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: InvalidHistory({ runId: R1, issue: DuplicateBeginning }),
      },
    },
  }

  action selectForeignRunRecordHistory: bool = all {
    fixtureMayChange,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: InvalidHistory({ runId: R1, issue: ForeignRunRecord }),
      },
    },
  }

  action selectMultipleUnfinishedHistories: bool = all {
    fixtureMayChange,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: MultipleUnfinishedHistories({
          first: EXISTING_FACTS,
          second: FOREIGN_FACTS,
        }),
      },
    },
  }

  action selectTerminatedHistory: bool = all {
    fixtureMayChange,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: TerminatedHistory(removeRetainedAttempt(EXISTING_FACTS)),
      },
    },
  }

  action selectExactExistingHistoryWithoutResponsibility: bool = all {
    fixtureMayChange,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: OneUnfinishedHistory(removeRetainedAttempt(EXISTING_FACTS)),
      },
    },
  }

  // A fresh complete graph can prove permanent tracker impossibility without
  // an Operator direction. The retained-history fixture remains otherwise
  // ordinary so the activation still has to settle all work first.
  action selectBlockedRunGraph: bool = all {
    fixtureMayChange,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: OneUnfinishedHistory(EMPTY_FACTS),
      },
      trackerFinality: {
        ...state.trackerFinality,
        targetSettled: true,
        responsibilitiesSettled: true,
        graphOutcome: GraphBlocked,
        contentIdentity: ContentRevisionBlocked,
        rootTaskId: EXACT_ROOT_TASK_ID,
        coveredTaskIds: trackerCoverageFor(GraphBlocked),
        evidence: NO_GRAPH_EVIDENCE,
      },
    },
  }

  // Cancellation is an already-applied Operator direction when activation
  // performs final classification; the separate runCancellation model owns
  // how that fact was established and how outstanding work was settled.
  action selectCancelledRunGraph: bool = all {
    fixtureMayChange,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: OneUnfinishedHistory(EMPTY_FACTS),
        cancellationApplied: false,
      },
      trackerFinality: {
        ...state.trackerFinality,
        targetSettled: true,
        responsibilitiesSettled: true,
        graphOutcome: GraphBlocked,
        contentIdentity: ContentRevisionBlocked,
        rootTaskId: EXACT_ROOT_TASK_ID,
        coveredTaskIds: trackerCoverageFor(GraphBlocked),
        evidence: NO_GRAPH_EVIDENCE,
      },
    },
  }

  action establishAbsentHistory: bool = all {
    state.process.phase == EntryIdle,
    state.durable.history == EmptyHistory,
    state.trace.beginningAppends == 0,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: OneUnfinishedHistory({
          runId: state.requestedRunId,
          target: state.requestedTarget,
          initialPolicy: state.lazyInitialPolicy,
          latestPolicy: state.lazyInitialPolicy,
          retainedAttempt: NoRetainedAttempt,
          otherRetainedAttempt: NoRetainedAttempt,
        }),
      },
      process: {
        ...state.process,
        phase: EstablishingRun,
        establishedRun: ExactEstablishedRun({
          runId: state.requestedRunId,
          target: state.requestedTarget,
          initialPolicy: state.lazyInitialPolicy,
          latestPolicy: state.lazyInitialPolicy,
          retainedAttempt: NoRetainedAttempt,
          otherRetainedAttempt: NoRetainedAttempt,
        }),
        establishmentSource: BeginningAppended,
        initialPolicyEvaluated: true,
        beginningAppended: true,
      },
      trace: {
        ...state.trace,
        initialPolicyEvaluations: state.trace.initialPolicyEvaluations + 1,
        beginningAppends: state.trace.beginningAppends + 1,
      },
    },
  }

  action establishExistingHistory: bool = all {
    state.process.phase == EntryIdle,
    exactRequestedUnfinished(state.durable.history, state.requestedRunId, state.requestedTarget),
    state.trace.activationsStarted < 2,
    state' = {
      ...state,
      process: {
        ...state.process,
        phase: EstablishingRun,
        establishedRun: ExactEstablishedRun(unfinishedFacts(state.durable.history)),
        establishmentSource: ExistingHistoryReduced,
      },
    },
  }

  action rejectMismatchedHistory: bool = all {
    state.process.phase == EntryIdle,
    mismatchedUnfinished(state.durable.history, state.requestedRunId, state.requestedTarget),
    state' = {
      ...state,
      process: {
        ...state.process,
        phase: EntryFailed,
        entryFailure:
          if (state.requestedRunId == R2) OtherUnfinishedRunFailure
          else TargetMismatchFailure,
      },
    },
  }

  action rejectInvalidHistory: bool = all {
    state.process.phase == EntryIdle,
    match state.durable.history { | InvalidHistory(_) => true | _ => false },
    state' = {
      ...state,
      process: {
        ...state.process,
        phase: EntryFailed,
        entryFailure: match state.durable.history {
          | InvalidHistory(facts) => match facts.issue {
              | DuplicateBeginning => DuplicateBeginningFailure
              | ForeignRunRecord => ForeignRunRecordFailure
              | InvalidChronology => InvalidChronologyFailure
            }
          | _ => NoEntryFailure
        },
      },
    },
  }

  action rejectMultipleUnfinishedHistories: bool = all {
    state.process.phase == EntryIdle,
    match state.durable.history { | MultipleUnfinishedHistories(_) => true | _ => false },
    state' = {
      ...state,
      process: { ...state.process, phase: EntryFailed, entryFailure: MultipleUnfinishedRunsFailure },
    },
  }

  action rejectTerminatedHistory: bool = all {
    state.process.phase == EntryIdle,
    match state.durable.history { | TerminatedHistory(_) => true | _ => false },
    state' = {
      ...state,
      process: { ...state.process, phase: EntryFailed, entryFailure: TerminatedRunFailure },
    },
  }

  action activateEstablishedRun: bool = all {
    state.process.phase == EstablishingRun,
    state.process.activationOrdinal == 0,
    state.trace.activationsStarted < 2,
    state' = {
      ...state,
      process: {
        ...state.process,
        phase: ActivatingRun,
        activationOrdinal: 1,
        heldPosition: positionFor(establishedFacts(state.process.establishedRun).retainedAttempt),
        otherHeldPosition: positionFor(establishedFacts(state.process.establishedRun).otherRetainedAttempt),
      },
      trace: { ...state.trace, activationsStarted: state.trace.activationsStarted + 1 },
    },
  }

  action readInitialTrackerGraph: bool = all {
    state.process.phase == ActivatingRun,
    not(state.process.initialTrackerObserved),
    state' = {
      ...state,
      process: { ...state.process, initialTrackerObserved: true },
      trace: { ...state.trace, trackerCalls: state.trace.trackerCalls + 1 },
    },
  }

  action settleRetainedAttempt: bool = all {
    state.process.phase == ActivatingRun,
    state.process.heldPosition == ExactTaskPosition(RETAINED_ATTEMPT_A),
    exactRequestedUnfinished(state.durable.history, state.requestedRunId, state.requestedTarget),
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: OneUnfinishedHistory(removeRetainedAttempt(unfinishedFacts(state.durable.history))),
      },
      trackerFinality: {
        ...state.trackerFinality,
        responsibilitiesSettled: state.process.otherHeldPosition == NoTaskPosition,
      },
      process: {
        ...state.process,
        establishedRun: ExactEstablishedRun(
          removeRetainedAttempt(establishedFacts(state.process.establishedRun))
        ),
        heldPosition: NoTaskPosition,
      },
      trace: { ...state.trace, executorCalls: state.trace.executorCalls + 1 },
    },
  }

  action settleOtherRetainedAttempt: bool = all {
    state.process.phase == ActivatingRun,
    state.process.otherHeldPosition == ExactTaskPosition(RETAINED_ATTEMPT_B),
    unfinishedFacts(state.durable.history).otherRetainedAttempt
      == ExactRetainedAttempt(RETAINED_ATTEMPT_B),
    exactRequestedUnfinished(state.durable.history, state.requestedRunId, state.requestedTarget),
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: OneUnfinishedHistory(
          removeOtherRetainedAttempt(unfinishedFacts(state.durable.history))
        ),
      },
      trackerFinality: {
        ...state.trackerFinality,
        responsibilitiesSettled: state.process.heldPosition == NoTaskPosition,
      },
      process: {
        ...state.process,
        establishedRun: ExactEstablishedRun(
          removeOtherRetainedAttempt(establishedFacts(state.process.establishedRun))
        ),
        otherHeldPosition: NoTaskPosition,
      },
      trace: { ...state.trace, executorCalls: state.trace.executorCalls + 1 },
    },
  }

  action admitIndependentTask: bool = all {
    newIndependentAdmissionAllowed,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: OneUnfinishedHistory(
          retainAttempt(unfinishedFacts(state.durable.history), INDEPENDENT_ATTEMPT_C)
        ),
      },
      trackerFinality: { ...state.trackerFinality, responsibilitiesSettled: false },
      process: {
        ...state.process,
        establishedRun: ExactEstablishedRun(
          retainAttempt(establishedFacts(state.process.establishedRun), INDEPENDENT_ATTEMPT_C)
        ),
        heldPosition: ExactTaskPosition(INDEPENDENT_ATTEMPT_C),
        independentTaskAdmitted: true,
        liveActionOwner: true,
      },
      trace: { ...state.trace, executorCalls: state.trace.executorCalls + 1 },
    },
  }

  action settleIndependentTask: bool = all {
    state.process.phase == ActivatingRun,
    state.process.heldPosition == ExactTaskPosition(INDEPENDENT_ATTEMPT_C),
    exactRequestedUnfinished(state.durable.history, state.requestedRunId, state.requestedTarget),
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: OneUnfinishedHistory(removeRetainedAttempt(unfinishedFacts(state.durable.history))),
        independentTaskSettled: true,
      },
      trackerFinality: { ...state.trackerFinality, responsibilitiesSettled: true },
      process: {
        ...state.process,
        establishedRun: ExactEstablishedRun(
          removeRetainedAttempt(establishedFacts(state.process.establishedRun))
        ),
        heldPosition: NoTaskPosition,
        independentTaskAdmitted: false,
        liveActionOwner: false,
      },
      trace: { ...state.trace, executorCalls: state.trace.executorCalls + 1 },
    },
  }

  action trackerFactsBecomeSettled: bool = all {
    not(state.trackerFinality.targetSettled and state.trackerFinality.responsibilitiesSettled),
    state' = {
      ...state,
      trackerFinality: {
        ...state.trackerFinality,
        targetSettled: true,
        responsibilitiesSettled: true,
      },
    },
  }

  action applyCancellation: bool = all {
    state.process.phase == ActivatingRun,
    // Active-attempt cancellation settlement belongs to runCancellation. This
    // activation composition admits the durable direction only after its
    // abstract responsibility projection is already settled.
    state.trackerFinality.responsibilitiesSettled,
    state.process.heldPosition == NoTaskPosition,
    state.process.otherHeldPosition == NoTaskPosition,
    unfinishedFacts(state.durable.history).retainedAttempt == NoRetainedAttempt,
    unfinishedFacts(state.durable.history).otherRetainedAttempt == NoRetainedAttempt,
    state.trace.executorCalls == 0,
    not(state.durable.cancellationApplied),
    state.trace.cancellationAppends == 0,
    state.trace.terminationAppends == 0,
    state' = {
      ...state,
      durable: { ...state.durable, cancellationApplied: true },
      trace: { ...state.trace, cancellationAppends: state.trace.cancellationAppends + 1 },
    },
  }

  action redeliverCancellation: bool = all {
    state.process.phase == ActivatingRun,
    state.durable.cancellationApplied,
    state.trace.cancellationAppends == 1,
    state.trace.cancellationRedeliveries == 0,
    state' = {
      ...state,
      trace: { ...state.trace, cancellationRedeliveries: state.trace.cancellationRedeliveries + 1 },
    },
  }

  action reachQuiescence: bool = all {
    state.process.phase == ActivatingRun,
    state.process.initialTrackerObserved,
    not(state.process.liveActionOwner),
    not(state.process.quiescent),
    state' = { ...state, process: { ...state.process, quiescent: true } },
  }

  action readPostQuiescenceTrackerGraph: bool = all {
    state.process.phase == ActivatingRun,
    state.process.quiescent,
    state.process.postQuiescenceReads == 0,
    // G2 is the fresh observation used for termination. Every retained
    // responsibility must settle before that observation, so a later
    // executor report cannot invalidate the proof after it was read.
    state.trackerFinality.responsibilitiesSettled,
    state.process.heldPosition == NoTaskPosition,
    state.process.otherHeldPosition == NoTaskPosition,
    unfinishedFacts(state.durable.history).retainedAttempt == NoRetainedAttempt,
    unfinishedFacts(state.durable.history).otherRetainedAttempt == NoRetainedAttempt,
    state' = {
      ...state,
      trackerFinality: {
        ...state.trackerFinality,
        evidence: exactGraphEvidenceFor(
          state.requestedRunId,
          state.requestedTarget,
          state.trace.trackerCalls + 1,
          state.trackerFinality.graphOutcome,
          state.trackerFinality.contentIdentity,
          state.trackerFinality.rootTaskId,
          state.trackerFinality.coveredTaskIds,
        ),
      },
      process: {
        ...state.process,
        postQuiescenceReads: 1,
        finalityObservation: PostQuiescenceObservation({
          targetSettled: state.trackerFinality.targetSettled,
          responsibilitiesSettled: state.trackerFinality.responsibilitiesSettled,
          graphOutcome: state.trackerFinality.graphOutcome,
          evidence: exactGraphEvidenceFor(
            state.requestedRunId,
            state.requestedTarget,
            state.trace.trackerCalls + 1,
            state.trackerFinality.graphOutcome,
            state.trackerFinality.contentIdentity,
            state.trackerFinality.rootTaskId,
            state.trackerFinality.coveredTaskIds,
          ),
        }),
      },
      trace: { ...state.trace, trackerCalls: state.trace.trackerCalls + 1 },
    },
  }

  action returnIncomplete: bool = all {
    state.process.phase == ActivatingRun,
    state.process.postQuiescenceReads == 1,
    not(finalityObservationIsSettled(state.process.finalityObservation)),
    state' = { ...state, process: { ...state.process, phase: ActivationReturned } },
  }

  action terminateRun: bool = all {
    state.process.phase == ActivatingRun,
    state.process.postQuiescenceReads == 1,
    finalityObservationIsSettled(state.process.finalityObservation),
    terminalDispositionFor(
      state.trackerFinality.graphOutcome,
      state.durable.cancellationApplied,
    ) != NoTerminal,
    evidenceIsExactFor(
      state.trackerFinality.evidence,
      state.requestedRunId,
      state.requestedTarget,
      state.trace.trackerCalls,
      state.trackerFinality.graphOutcome,
      trackerContentIdentityFor(state.trackerFinality.graphOutcome),
      EXACT_ROOT_TASK_ID,
      state.trackerFinality.coveredTaskIds,
    ),
    state.process.heldPosition == NoTaskPosition,
    state.process.otherHeldPosition == NoTaskPosition,
    unfinishedFacts(state.durable.history).retainedAttempt == NoRetainedAttempt,
    unfinishedFacts(state.durable.history).otherRetainedAttempt == NoRetainedAttempt,
    not(state.process.liveActionOwner),
    exactRequestedUnfinished(state.durable.history, state.requestedRunId, state.requestedTarget),
    state.trace.terminationAppends == 0,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: TerminatedHistory(unfinishedFacts(state.durable.history)),
        terminationDisposition: terminalDispositionFor(
          state.trackerFinality.graphOutcome,
          state.durable.cancellationApplied,
        ),
      },
      process: {
        ...state.process,
        phase: ActivationReturned,
        terminalDisposition: terminalDispositionFor(
          state.trackerFinality.graphOutcome,
          state.durable.cancellationApplied,
        ),
      },
      trace: {
        ...state.trace,
        terminationAppends: state.trace.terminationAppends + 1,
        terminationHadLaterSettledObservation: true,
      },
    },
  }

  action crash: bool = all {
    state.process.phase != EntryIdle,
    state.trace.processLosses == 0,
    state.trace.activationsStarted < 2,
    state' = {
      ...state,
      process: { ...resetProcess, enteredAfterProcessLoss: true },
      trace: {
        ...state.trace,
        processLosses: state.trace.processLosses + 1,
        historyAtProcessLoss: state.durable.history,
      },
    },
  }

  action invokeSameEntryAgain: bool = all {
    state.process.phase == ActivationReturned,
    state.trace.terminationAppends == 0,
    state.trace.activationsStarted < 2,
    state' = { ...state, process: resetProcess },
  }

  action step: bool = any {
    selectExactExistingHistory,
    selectContractedExactExistingHistory,
    selectMismatchedExistingHistory,
    selectOtherUnfinishedRun,
    selectInvalidHistory,
    selectDuplicateBeginningHistory,
    selectForeignRunRecordHistory,
    selectMultipleUnfinishedHistories,
    selectTerminatedHistory,
    selectBlockedRunGraph,
    selectCancelledRunGraph,
    selectExactExistingHistoryWithoutResponsibility,
    establishAbsentHistory,
    establishExistingHistory,
    rejectMismatchedHistory,
    rejectInvalidHistory,
    rejectMultipleUnfinishedHistories,
    rejectTerminatedHistory,
    activateEstablishedRun,
    readInitialTrackerGraph,
    settleRetainedAttempt,
    settleOtherRetainedAttempt,
    admitIndependentTask,
    settleIndependentTask,
    trackerFactsBecomeSettled,
    applyCancellation,
    redeliverCancellation,
    reachQuiescence,
    readPostQuiescenceTrackerGraph,
    returnIncomplete,
    terminateRun,
    crash,
    invokeSameEntryAgain,
  }
}
