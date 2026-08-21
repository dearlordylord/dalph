// Deliberately illegal transitions prove that each Run-establishment and
// bounded-activation safety family can turn red.
module runActivationNegativeTest {
  import runActivation.* from "./runActivation"

  action appendSecondBeginning: bool = all {
    state.process.establishmentSource == BeginningAppended,
    state' = {
      ...state,
      trace: { ...state.trace, beginningAppends: state.trace.beginningAppends + 1 },
    },
  }

  action evaluateFallbackForExistingHistory: bool = all {
    exactRequestedUnfinished(state.durable.history, state.requestedRunId, state.requestedTarget),
    state.process.phase == EntryIdle,
    state' = {
      ...state,
      process: {
        ...state.process,
        phase: EstablishingRun,
        establishedRun: ExactEstablishedRun(unfinishedFacts(state.durable.history)),
        establishmentSource: ExistingHistoryReduced,
        initialPolicyEvaluated: true,
      },
      trace: {
        ...state.trace,
        initialPolicyEvaluations: state.trace.initialPolicyEvaluations + 1,
      },
    },
  }

  action recordDifferentBeginningPolicy: bool = all {
    state.process.establishmentSource == BeginningAppended,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: OneUnfinishedHistory({
          ...unfinishedFacts(state.durable.history),
          initialPolicy: LATEST_POLICY,
          latestPolicy: LATEST_POLICY,
        }),
      },
      process: {
        ...state.process,
        establishedRun: ExactEstablishedRun({
          ...establishedFacts(state.process.establishedRun),
          initialPolicy: LATEST_POLICY,
          latestPolicy: LATEST_POLICY,
        }),
      },
    },
  }

  action ignoreLatestDurablePolicy: bool = all {
    state.process.establishmentSource == ExistingHistoryReduced,
    state' = {
      ...state,
      process: {
        ...state.process,
        establishedRun: ExactEstablishedRun({
          ...establishedFacts(state.process.establishedRun),
          latestPolicy: INITIAL_POLICY,
        }),
      },
    },
  }

  action activateMismatchedHistory: bool = all {
    mismatchedUnfinished(state.durable.history, state.requestedRunId, state.requestedTarget),
    state' = {
      ...state,
      process: {
        ...state.process,
        phase: ActivatingRun,
        establishedRun: ExactEstablishedRun(unfinishedFacts(state.durable.history)),
        establishmentSource: ExistingHistoryReduced,
        activationOrdinal: 1,
      },
      trace: { ...state.trace, activationsStarted: state.trace.activationsStarted + 1 },
    },
  }

  action activateFirstOfMultipleHistories: bool = all {
    state.durable.history
      == MultipleUnfinishedHistories({ first: EXISTING_FACTS, second: FOREIGN_FACTS }),
    state' = {
      ...state,
      process: {
        ...state.process,
        phase: ActivatingRun,
        establishedRun: ExactEstablishedRun(EXISTING_FACTS),
        establishmentSource: ExistingHistoryReduced,
        activationOrdinal: 1,
        heldPosition: ExactTaskPosition(RETAINED_ATTEMPT_A),
      },
      trace: { ...state.trace, activationsStarted: state.trace.activationsStarted + 1 },
    },
  }

  action activateTerminatedHistory: bool = all {
    state.durable.history == TerminatedHistory(removeRetainedAttempt(EXISTING_FACTS)),
    state' = {
      ...state,
      process: {
        ...state.process,
        phase: ActivatingRun,
        establishedRun: ExactEstablishedRun(removeRetainedAttempt(EXISTING_FACTS)),
        establishmentSource: ExistingHistoryReduced,
        activationOrdinal: 1,
      },
      trace: { ...state.trace, activationsStarted: state.trace.activationsStarted + 1 },
    },
  }

  action discardReconstructedPosition: bool = all {
    state.process.heldPosition == ExactTaskPosition(RETAINED_ATTEMPT_A),
    state' = { ...state, process: { ...state.process, heldPosition: NoTaskPosition } },
  }

  // Forbidden: settling A does not permit process-local reconstruction to
  // forget B while B remains an unfinished durable responsibility.
  action discardOtherReconstructedPosition: bool = all {
    state.process.phase == ActivatingRun,
    state.process.heldPosition == NoTaskPosition,
    state.process.otherHeldPosition == ExactTaskPosition(RETAINED_ATTEMPT_B),
    state' = { ...state, process: { ...state.process, otherHeldPosition: NoTaskPosition } },
  }

  action admitIndependentTaskWhilePositionIsHeld: bool = all {
    state.process.heldPosition == ExactTaskPosition(RETAINED_ATTEMPT_A),
    state' = {
      ...state,
      process: { ...state.process, independentTaskAdmitted: true },
    },
  }

  action admitIndependentTaskDespiteContractedCapacity: bool = all {
    state.process.phase == ActivatingRun,
    state.process.heldPosition == NoTaskPosition,
    establishedFacts(state.process.establishedRun).latestPolicy.taskCapacity == Capacity1,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: OneUnfinishedHistory(
          retainAttempt(unfinishedFacts(state.durable.history), INDEPENDENT_ATTEMPT_C)
        ),
      },
      process: {
        ...state.process,
        establishedRun: ExactEstablishedRun(
          retainAttempt(establishedFacts(state.process.establishedRun), INDEPENDENT_ATTEMPT_C)
        ),
        heldPosition: ExactTaskPosition(INDEPENDENT_ATTEMPT_C),
        independentTaskAdmitted: true,
        liveActionOwner: true,
      },
    },
  }

  // Forbidden: B's durable responsibility still consumes capacity after its
  // process-local position is lost. C cannot be admitted by trusting the
  // incomplete position map.
  action admitIndependentTaskAfterDroppingRetainedB: bool = all {
    state.process.phase == ActivatingRun,
    state.process.heldPosition == NoTaskPosition,
    state.process.otherHeldPosition == NoTaskPosition,
    unfinishedFacts(state.durable.history).otherRetainedAttempt
      == ExactRetainedAttempt(RETAINED_ATTEMPT_B),
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: OneUnfinishedHistory(
          retainAttempt(unfinishedFacts(state.durable.history), INDEPENDENT_ATTEMPT_C)
        ),
      },
      process: {
        ...state.process,
        establishedRun: ExactEstablishedRun(
          retainAttempt(establishedFacts(state.process.establishedRun), INDEPENDENT_ATTEMPT_C)
        ),
        heldPosition: ExactTaskPosition(INDEPENDENT_ATTEMPT_C),
        independentTaskAdmitted: true,
        liveActionOwner: true,
      },
    },
  }

  action takeSecondPostQuiescenceRead: bool = all {
    state.process.postQuiescenceReads == 1,
    state' = {
      ...state,
      process: { ...state.process, postQuiescenceReads: 2 },
      trace: { ...state.trace, trackerCalls: state.trace.trackerCalls + 1 },
    },
  }

  action readFinalityBeforeQuiescence: bool = all {
    state.process.phase == ActivatingRun,
    not(state.process.quiescent),
    state.process.postQuiescenceReads == 0,
    state' = {
      ...state,
      process: {
        ...state.process,
        postQuiescenceReads: 1,
        finalityObservation: PostQuiescenceObservation({
          targetSettled: state.trackerFinality.targetSettled,
          responsibilitiesSettled: state.trackerFinality.responsibilitiesSettled,
          graphOutcome: state.trackerFinality.graphOutcome,
          evidence: state.trackerFinality.evidence,
        }),
      },
      trace: { ...state.trace, trackerCalls: state.trace.trackerCalls + 1 },
    },
  }

  action readTrackerBeforeBeginning: bool = all {
    state.durable.history == EmptyHistory,
    state' = { ...state, trace: { ...state.trace, trackerCalls: state.trace.trackerCalls + 1 } },
  }

  action terminateWithoutLaterObservation: bool = all {
    state.process.phase == ActivatingRun,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: TerminatedHistory(unfinishedFacts(state.durable.history)),
      },
      process: { ...state.process, phase: ActivationReturned },
      trace: { ...state.trace, terminationAppends: state.trace.terminationAppends + 1 },
    },
  }

  action terminateWithOtherRetainedPosition: bool = all {
    state.process.phase == ActivatingRun,
    state.process.otherHeldPosition == ExactTaskPosition(RETAINED_ATTEMPT_B),
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: TerminatedHistory(unfinishedFacts(state.durable.history)),
      },
      process: { ...state.process, phase: ActivationReturned },
      trace: {
        ...state.trace,
        terminationAppends: state.trace.terminationAppends + 1,
        terminationHadLaterSettledObservation: true,
      },
    },
  }

  // Forbidden: clearing B's process-local position cannot settle B's durable
  // responsibility or permit Run termination.
  action terminateAfterDroppingRetainedB: bool = all {
    state.process.phase == ActivatingRun,
    state.process.heldPosition == NoTaskPosition,
    state.process.otherHeldPosition == NoTaskPosition,
    unfinishedFacts(state.durable.history).otherRetainedAttempt
      == ExactRetainedAttempt(RETAINED_ATTEMPT_B),
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: TerminatedHistory(unfinishedFacts(state.durable.history)),
      },
      process: { ...state.process, phase: ActivationReturned },
      trace: {
        ...state.trace,
        terminationAppends: state.trace.terminationAppends + 1,
        terminationHadLaterSettledObservation: true,
      },
    },
  }

  // Forbidden: a graph read whose run/target/revision/coverage does not match
  // the requested activation cannot support a terminal append.
  action terminateWithMismatchedGraphEvidence: bool = all {
    state.process.phase == ActivatingRun,
    state.process.quiescent,
    state.process.postQuiescenceReads == 0,
    state.trackerFinality.graphOutcome == GraphBlocked,
    state' = {
      ...state,
      trackerFinality: { ...state.trackerFinality, evidence: MismatchedGraphReadEvidence },
      process: {
        ...state.process,
        postQuiescenceReads: 1,
        terminalDisposition: Blocked,
        finalityObservation: PostQuiescenceObservation({
          targetSettled: true,
          responsibilitiesSettled: true,
          graphOutcome: GraphBlocked,
          evidence: MismatchedGraphReadEvidence,
        }),
      },
      trace: {
        ...state.trace,
        trackerCalls: state.trace.trackerCalls + 1,
        terminationAppends: state.trace.terminationAppends + 1,
      },
    },
  }

  // Forbidden: the decisive tracker observation must be cited at its exact
  // Journal position. Matching operation, revision, root, and coverage cannot
  // substitute for that position identity.
  action terminateWithMismatchedObservationPosition: bool = all {
    state.process.phase == ActivatingRun,
    state.process.quiescent,
    state.process.postQuiescenceReads == 0,
    state.trackerFinality.graphOutcome == GraphBlocked,
    state' = {
      ...state,
      trackerFinality: {
        ...state.trackerFinality,
        evidence: exactGraphEvidenceFor(
          state.requestedRunId,
          state.requestedTarget,
          state.trace.trackerCalls + 1,
          state.trackerFinality.observationPosition + 1,
          GraphBlocked,
          ContentRevisionBlocked,
          EXACT_ROOT_TASK_ID,
          trackerCoverageFor(GraphBlocked),
        ),
      },
      process: {
        ...state.process,
        postQuiescenceReads: 1,
        terminalDisposition: Blocked,
        finalityObservation: PostQuiescenceObservation({
          targetSettled: true,
          responsibilitiesSettled: true,
          graphOutcome: GraphBlocked,
          evidence: exactGraphEvidenceFor(
            state.requestedRunId,
            state.requestedTarget,
            state.trace.trackerCalls + 1,
            state.trackerFinality.observationPosition + 1,
            GraphBlocked,
            ContentRevisionBlocked,
            EXACT_ROOT_TASK_ID,
            trackerCoverageFor(GraphBlocked),
          ),
        }),
      },
      trace: {
        ...state.trace,
        trackerCalls: state.trace.trackerCalls + 1,
        terminationAppends: state.trace.terminationAppends + 1,
      },
    },
  }

  // Forbidden: the terminal proof must bind the exact root task returned by
  // the tracker; a Boolean root-present flag cannot substitute for identity.
  action terminateWithWrongRootGraphEvidence: bool = all {
    state.process.phase == ActivatingRun,
    state.process.quiescent,
    state.process.postQuiescenceReads == 0,
    state.trackerFinality.graphOutcome == GraphBlocked,
    state' = {
      ...state,
      trackerFinality: {
        ...state.trackerFinality,
        evidence: exactGraphEvidenceFor(
          state.requestedRunId,
          state.requestedTarget,
          state.trace.trackerCalls + 1,
          state.trackerFinality.observationPosition,
          GraphBlocked,
          ContentRevisionBlocked,
          TaskB,
          trackerCoverageFor(GraphBlocked),
        ),
      },
      process: {
        ...state.process,
        postQuiescenceReads: 1,
        terminalDisposition: Blocked,
        finalityObservation: PostQuiescenceObservation({
          targetSettled: true,
          responsibilitiesSettled: true,
          graphOutcome: GraphBlocked,
          evidence: exactGraphEvidenceFor(
            state.requestedRunId,
            state.requestedTarget,
            state.trace.trackerCalls + 1,
            state.trackerFinality.observationPosition,
            GraphBlocked,
            ContentRevisionBlocked,
            TaskB,
            trackerCoverageFor(GraphBlocked),
          ),
        }),
      },
      trace: {
        ...state.trace,
        trackerCalls: state.trace.trackerCalls + 1,
        terminationAppends: state.trace.terminationAppends + 1,
      },
    },
  }

  // Forbidden: a fresh read's content identity must be independent of the
  // operation ordinal and must match the exact graph revision being classified.
  action terminateWithStaleContentIdentity: bool = all {
    state.process.phase == ActivatingRun,
    state.process.quiescent,
    state.process.postQuiescenceReads == 0,
    state.trackerFinality.graphOutcome == GraphBlocked,
    state' = {
      ...state,
      trackerFinality: {
        ...state.trackerFinality,
        evidence: exactGraphEvidenceFor(
          state.requestedRunId,
          state.requestedTarget,
          state.trace.trackerCalls + 1,
          state.trackerFinality.observationPosition,
          GraphBlocked,
          StaleContentRevision,
          EXACT_ROOT_TASK_ID,
          trackerCoverageFor(GraphBlocked),
        ),
      },
      process: {
        ...state.process,
        postQuiescenceReads: 1,
        terminalDisposition: Blocked,
        finalityObservation: PostQuiescenceObservation({
          targetSettled: true,
          responsibilitiesSettled: true,
          graphOutcome: GraphBlocked,
          evidence: exactGraphEvidenceFor(
            state.requestedRunId,
            state.requestedTarget,
            state.trace.trackerCalls + 1,
            state.trackerFinality.observationPosition,
            GraphBlocked,
            StaleContentRevision,
            EXACT_ROOT_TASK_ID,
            trackerCoverageFor(GraphBlocked),
          ),
        }),
      },
      trace: {
        ...state.trace,
        trackerCalls: state.trace.trackerCalls + 1,
        terminationAppends: state.trace.terminationAppends + 1,
      },
    },
  }

  // Forbidden: a terminal proof with the right Run, operation, revision, root,
  // and outcome is still invalid when its graph coverage is incomplete.
  action terminateWithMismatchedGraphCoverage: bool = all {
    state.process.phase == ActivatingRun,
    state.process.quiescent,
    state.process.postQuiescenceReads == 0,
    state.trackerFinality.graphOutcome == GraphBlocked,
    state' = {
      ...state,
      trackerFinality: {
        ...state.trackerFinality,
        evidence: exactGraphEvidenceFor(
          state.requestedRunId,
          state.requestedTarget,
          state.trace.trackerCalls + 1,
          state.trackerFinality.observationPosition,
          GraphBlocked,
          ContentRevisionBlocked,
          EXACT_ROOT_TASK_ID,
          Set(EXACT_ROOT_TASK_ID),
        ),
      },
      process: {
        ...state.process,
        postQuiescenceReads: 1,
        terminalDisposition: Blocked,
        finalityObservation: PostQuiescenceObservation({
          targetSettled: true,
          responsibilitiesSettled: true,
          graphOutcome: GraphBlocked,
          evidence: exactGraphEvidenceFor(
            state.requestedRunId,
            state.requestedTarget,
            state.trace.trackerCalls + 1,
            state.trackerFinality.observationPosition,
            GraphBlocked,
            ContentRevisionBlocked,
            EXACT_ROOT_TASK_ID,
            Set(EXACT_ROOT_TASK_ID),
          ),
        }),
      },
      trace: {
        ...state.trace,
        trackerCalls: state.trace.trackerCalls + 1,
        terminationAppends: state.trace.terminationAppends + 1,
      },
    },
  }

  // Forbidden: cancellation is not a terminal disposition until its durable
  // direction is present and the fresh classification is otherwise settled.
  action appendCancelledWithoutAppliedDirection: bool = all {
    state.process.phase == ActivatingRun,
    state.process.postQuiescenceReads == 1,
    state.trackerFinality.graphOutcome == GraphBlocked,
    not(state.durable.cancellationApplied),
    state' = {
      ...state,
      durable: { ...state.durable, terminationDisposition: Cancelled },
      process: { ...state.process, phase: ActivationReturned, terminalDisposition: Cancelled },
      trace: { ...state.trace, terminationAppends: state.trace.terminationAppends + 1 },
    },
  }

  // Forbidden: the cancellation direction cannot be hidden while claiming a
  // fresh tracker blockage; the three terminal predicates must remain disjoint.
  action appendBlockedAfterCancellation: bool = all {
    state.process.phase == ActivatingRun,
    state.process.postQuiescenceReads == 1,
    state.trackerFinality.graphOutcome == GraphBlocked,
    state.durable.cancellationApplied,
    state' = {
      ...state,
      durable: { ...state.durable, terminationDisposition: Blocked },
      process: { ...state.process, phase: ActivationReturned, terminalDisposition: Blocked },
      trace: { ...state.trace, terminationAppends: state.trace.terminationAppends + 1 },
    },
  }

  action admitAfterCancellation: bool = all {
    state.process.phase == ActivatingRun,
    state.durable.cancellationApplied,
    state' = {
      ...state,
      process: { ...state.process, independentTaskAdmitted: true },
    },
  }

  action activateInvalidHistory: bool = all {
    match state.durable.history { | InvalidHistory(_) => true | _ => false },
    state' = {
      ...state,
      process: {
        ...state.process,
        phase: ActivatingRun,
        establishedRun: ExactEstablishedRun(EXISTING_FACTS),
        establishmentSource: ExistingHistoryReduced,
        activationOrdinal: 1,
      },
      trace: { ...state.trace, activationsStarted: state.trace.activationsStarted + 1 },
    },
  }

  action crashAndChangeDurableHistory: bool = all {
    state.process.phase != EntryIdle,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        history: InvalidHistory({ runId: R1, issue: InvalidChronology }),
      },
      process: { ...resetProcess, enteredAfterProcessLoss: true },
      trace: {
        ...state.trace,
        processLosses: 1,
        historyAtProcessLoss: state.durable.history,
      },
    },
  }

  run duplicateBeginningIsDetectedTest = {
    init.then(establishAbsentHistory).then(appendSecondBeginning)
      .expect(not(oneBeginningPerRun) and not(modelIsFiniteAndBounded))
  }

  run eagerExistingPolicyEvaluationIsDetectedTest = {
    init.then(selectExactExistingHistory).then(evaluateFallbackForExistingHistory)
      .expect(not(existingHistorySkipsInitialPolicy))
  }

  run wrongBeginningPolicyIsDetectedTest = {
    init.then(establishAbsentHistory).then(recordDifferentBeginningPolicy)
      .expect(not(beginningRecordsExactLazyPolicy))
  }

  run staleExistingPolicyIsDetectedTest = {
    init.then(selectExactExistingHistory).then(establishExistingHistory)
      .then(ignoreLatestDurablePolicy)
      .expect(not(existingHistoryUsesLatestDurablePolicy))
  }

  run mismatchedActivationIsDetectedTest = {
    init.then(selectMismatchedExistingHistory).then(activateMismatchedHistory)
      .expect(not(onlyExactEstablishedRunActivates))
  }

  run selectingOneOfMultipleRunsIsDetectedTest = {
    init.then(selectMultipleUnfinishedHistories).then(activateFirstOfMultipleHistories)
      .expect(not(atMostOneDiscoveredUnfinishedRunMayActivate))
  }

  run terminatedActivationIsDetectedTest = {
    init.then(selectTerminatedHistory).then(activateTerminatedHistory)
      .expect(not(terminatedRunIsFinal) and not(activationStartsAfterDurableBeginning))
  }

  run lostReconstructedPositionIsDetectedTest = {
    init.then(selectExactExistingHistory).then(establishExistingHistory)
      .then(activateEstablishedRun).then(discardReconstructedPosition)
      .expect(not(everyDurableRetainedAttemptHasExactPosition))
  }

  run lostOtherReconstructedPositionIsDetectedTest = {
    init.then(selectContractedExactExistingHistory).then(establishExistingHistory)
      .then(activateEstablishedRun).then(settleRetainedAttempt)
      .then(discardOtherReconstructedPosition)
      .expect(not(everyDurableRetainedAttemptHasExactPosition))
  }

  run admittingCAfterDroppingRetainedBIsDetectedTest = {
    init.then(selectContractedExactExistingHistory).then(establishExistingHistory)
      .then(activateEstablishedRun).then(settleRetainedAttempt)
      .then(discardOtherReconstructedPosition)
      .then(admitIndependentTaskAfterDroppingRetainedB)
      .expect(not(everyDurableRetainedAttemptHasExactPosition))
  }

  run admissionBeforePositionReleaseIsDetectedTest = {
    init.then(selectExactExistingHistory).then(establishExistingHistory)
      .then(activateEstablishedRun).then(admitIndependentTaskWhilePositionIsHeld)
      .expect(not(independentAdmissionRequiresAvailablePosition))
  }

  run admissionBeyondContractedCapacityIsDetectedTest = {
    init.then(selectContractedExactExistingHistory).then(establishExistingHistory)
      .then(activateEstablishedRun).then(settleRetainedAttempt)
      .then(admitIndependentTaskDespiteContractedCapacity)
      .expect(not(latestPolicyControlsAdmission))
  }

  run secondFinalityReadIsDetectedTest = {
    init.then(establishAbsentHistory).then(activateEstablishedRun)
      .then(readInitialTrackerGraph).then(reachQuiescence)
      .then(readPostQuiescenceTrackerGraph).then(takeSecondPostQuiescenceRead)
      .expect(not(establishmentSourceDoesNotChangeActivationBounds))
  }

  run finalityReadBeforeQuiescenceIsDetectedTest = {
    init.then(establishAbsentHistory).then(activateEstablishedRun)
      .then(readInitialTrackerGraph).then(readFinalityBeforeQuiescence)
      .expect(not(finalityReadRequiresQuiescence))
  }

  run trackerReadBeforeBeginningIsDetectedTest = {
    init.then(readTrackerBeforeBeginning).expect(not(trackerCallsRequireEstablishedHistory))
  }

  run terminationWithoutFinalityReadIsDetectedTest = {
    init.then(establishAbsentHistory).then(activateEstablishedRun)
      .then(terminateWithoutLaterObservation)
      .expect(not(terminationRequiresLaterSettledObservation))
  }

  run terminationWithOtherRetainedPositionIsDetectedTest = {
    init.then(selectContractedExactExistingHistory).then(establishExistingHistory)
      .then(activateEstablishedRun).then(terminateWithOtherRetainedPosition)
      .expect(not(terminationRequiresNoRetainedResponsibilityOrPosition))
  }

  run terminatingAfterDroppingRetainedBIsDetectedTest = {
    init.then(selectContractedExactExistingHistory).then(establishExistingHistory)
      .then(activateEstablishedRun).then(settleRetainedAttempt)
      .then(discardOtherReconstructedPosition)
      .then(terminateAfterDroppingRetainedB)
      .expect(not(terminationRequiresNoRetainedResponsibilityOrPosition))
  }

  run invalidHistoryActivationIsDetectedTest = {
    init.then(selectInvalidHistory).then(activateInvalidHistory)
      .expect(not(activationStartsAfterDurableBeginning))
  }

  run crashChangingDurableHistoryIsDetectedTest = {
    init.then(establishAbsentHistory).then(crashAndChangeDurableHistory)
      .expect(not(processLossPreservesDurableHistory))
  }

  run mismatchedGraphEvidenceIsDetectedTest = {
    init.then(selectBlockedRunGraph).then(establishExistingHistory)
      .then(activateEstablishedRun).then(readInitialTrackerGraph)
      .then(reachQuiescence).then(terminateWithMismatchedGraphEvidence)
      .expect(not(terminationRequiresExactFreshGraphEvidence))
  }

  run mismatchedObservationPositionIsDetectedTest = {
    init.then(selectBlockedRunGraph).then(establishExistingHistory)
      .then(activateEstablishedRun).then(readInitialTrackerGraph)
      .then(reachQuiescence).then(terminateWithMismatchedObservationPosition)
      .expect(not(terminationRequiresExactFreshGraphEvidence))
  }

  run wrongRootIdentityIsDetectedTest = {
    init.then(selectBlockedRunGraph).then(establishExistingHistory)
      .then(activateEstablishedRun).then(readInitialTrackerGraph)
      .then(reachQuiescence).then(terminateWithWrongRootGraphEvidence)
      .expect(not(terminationRequiresExactFreshGraphEvidence))
  }

  run staleContentIdentityIsDetectedTest = {
    init.then(selectBlockedRunGraph).then(establishExistingHistory)
      .then(activateEstablishedRun).then(readInitialTrackerGraph)
      .then(reachQuiescence).then(terminateWithStaleContentIdentity)
      .expect(not(terminationRequiresExactFreshGraphEvidence))
  }

  run coverageOnlyMismatchIsDetectedTest = {
    init.then(selectBlockedRunGraph).then(establishExistingHistory)
      .then(activateEstablishedRun).then(readInitialTrackerGraph)
      .then(reachQuiescence).then(terminateWithMismatchedGraphCoverage)
      .expect(not(terminationRequiresExactFreshGraphEvidence))
  }

  run cancelledWithoutAppliedDirectionIsDetectedTest = {
    init.then(selectCancelledRunGraph).then(establishExistingHistory)
      .then(activateEstablishedRun).then(readInitialTrackerGraph)
      .then(reachQuiescence).then(readPostQuiescenceTrackerGraph)
      .then(appendCancelledWithoutAppliedDirection)
      .expect(not(cancelledRequiresAppliedAndSettledDirection))
  }

  run blockedAfterCancellationIsDetectedTest = {
    init.then(selectCancelledRunGraph).then(establishExistingHistory)
      .then(activateEstablishedRun).then(readInitialTrackerGraph)
      .then(applyCancellation).then(reachQuiescence)
      .then(readPostQuiescenceTrackerGraph).then(appendBlockedAfterCancellation)
      .expect(not(blockedRequiresFreshConclusiveTrackerFacts))
  }

  run forwardAdmissionAfterCancellationIsDetectedTest = {
    init.then(establishAbsentHistory).then(activateEstablishedRun)
      .then(readInitialTrackerGraph).then(applyCancellation)
      .then(admitAfterCancellation)
      .expect(not(cancellationClosesForwardAdmission))
  }
}
