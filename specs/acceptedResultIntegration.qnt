// Models issues #56 and #57: accepted-result admission plus one fixed
// integration session that accepts only an explicit submitted commit whose
// ordered direct parents are [current target head, accepted result]. Git
// verification, promotion, executor internals, and post-milestone retry policy
// remain absent.
module acceptedResultIntegration {
  type Phase =
    | NoAcceptedResult
    | AcceptedResult
    | Queued
    | Started
    | DependencyWait
    | CandidatePending
    | CorrectionRequired
    | CandidateReady
    | CorrectionLimitReached
    | ContinuationLimitReached

  type ResultState = {
    phase: Phase,
    queuePosition: int,
    preIntegrationCancellation: bool,
    targetHeld: bool,
    integrationSession: int,
    submittedCandidate: int,
    expectedTargetHead: int,
    acceptedResultCommit: int,
    observedFirstParent: int,
    observedSecondParent: int,
    correctionCount: int,
    continuationCount: int,
  }

  type State = {
    results: int -> ResultState,
    nextJournalPosition: int,
    recovered: bool,
    trackerFactsCurrent: bool,
  }

  pure val RESULT_IDS = Set(1, 2)
  pure val CORRECTION_LIMIT = 1
  pure val CONTINUATION_LIMIT = 2
  var state: State

  pure def canStart(s: State, id: int): bool = {
    val result = s.results.get(id)
    and {
      result.phase == Queued,
      s.trackerFactsCurrent,
      not(RESULT_IDS.exists(other => s.results.get(other).targetHeld)),
      not(RESULT_IDS.exists(other =>
        s.results.get(other).phase == DependencyWait
          and s.results.get(other).queuePosition < result.queuePosition
      )),
      not(RESULT_IDS.exists(other =>
        s.results.get(other).phase == Queued
          and s.results.get(other).queuePosition < result.queuePosition
      )),
    }
  }

  val acceptedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == AcceptedResult)

  val queuedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == Queued)

  val startedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == Started)

  val dependencyWaitReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == DependencyWait)

  val restartReached: bool = state.recovered

  val candidateReadyReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == CandidateReady)

  val correctionRequiredReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == CorrectionRequired)

  val correctionLimitReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == CorrectionLimitReached)

  val continuationLimitReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == ContinuationLimitReached)

  val dependencyWaitReleasedTarget: bool =
    state.results.get(1).phase == DependencyWait
      and not(state.results.get(1).targetHeld)

  val cancellationExactlyQueued: bool =
    RESULT_IDS.forall(id =>
      state.results.get(id).preIntegrationCancellation
        == (state.results.get(id).phase == Queued)
    )

  val queuePositionsAreUnique: bool =
    RESULT_IDS.forall(left =>
      RESULT_IDS.forall(right =>
        left == right
          or state.results.get(left).queuePosition == 0
          or state.results.get(right).queuePosition == 0
          or state.results.get(left).queuePosition != state.results.get(right).queuePosition
      )
    )

  val targetHeldExactlyActiveIntegration: bool =
    RESULT_IDS.forall(id =>
      state.results.get(id).targetHeld
        == Set(Started, CandidatePending, CorrectionRequired, CandidateReady).contains(state.results.get(id).phase)
    )

  val candidateReadyHasExactOrderedParents: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      result.phase != CandidateReady
        or and {
          result.submittedCandidate != 0,
          result.observedFirstParent == result.expectedTargetHead,
          result.observedSecondParent == result.acceptedResultCommit,
        }
    })

  val sessionIdentityFixedAfterStart: bool =
    RESULT_IDS.forall(id =>
      Set(Started, CandidatePending, CorrectionRequired, CandidateReady, CorrectionLimitReached, ContinuationLimitReached).contains(state.results.get(id).phase)
        implies state.results.get(id).integrationSession == id
    )

  val atMostOneTargetHolder: bool =
    RESULT_IDS.filter(id => state.results.get(id).targetHeld).size() <= 1

  val startedPrecedesRemainingQueue: bool =
    RESULT_IDS.forall(started =>
      RESULT_IDS.forall(queued =>
        state.results.get(started).phase != Started
          or state.results.get(queued).phase != Queued
          or state.results.get(started).queuePosition < state.results.get(queued).queuePosition
      )
    )

  val dependencyWaitPreservesQueueOrder: bool =
    RESULT_IDS.forall(waiting =>
      RESULT_IDS.forall(queued =>
        state.results.get(waiting).phase != DependencyWait
          or state.results.get(queued).phase != Queued
          or state.results.get(waiting).queuePosition < state.results.get(queued).queuePosition
      )
    )

  action init: bool = all {
    state' = {
      results: RESULT_IDS.mapBy(id => {
        phase: NoAcceptedResult,
        queuePosition: 0,
        preIntegrationCancellation: false,
        targetHeld: false,
        integrationSession: 0,
        submittedCandidate: 0,
        expectedTargetHead: 0,
        acceptedResultCommit: id + 20,
        observedFirstParent: 0,
        observedSecondParent: 0,
        correctionCount: 0,
        continuationCount: 0,
      }),
      nextJournalPosition: 1,
      recovered: false,
      trackerFactsCurrent: true,
    }
  }

  action acceptResult(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == NoAcceptedResult,
      state' = {
        ...state,
        results: state.results.put(id, { ...result, phase: AcceptedResult }),
      },
    }
  }

  action queueAcceptedResult(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == AcceptedResult,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: Queued,
          queuePosition: state.nextJournalPosition,
          preIntegrationCancellation: true,
        }),
        nextJournalPosition: state.nextJournalPosition + 1,
      },
    }
  }

  action startIntegration(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      canStart(state, id),
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: Started,
          preIntegrationCancellation: false,
          targetHeld: true,
          integrationSession: id,
          expectedTargetHead: id + 10,
        }),
      },
    }
  }

  action submitCandidate(id: int, candidate: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      Set(Started, CorrectionRequired).contains(result.phase),
      candidate != 0,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: CandidatePending,
          submittedCandidate: candidate,
          observedFirstParent: 0,
          observedSecondParent: 0,
        }),
      },
    }
  }

  // Conflict, working, and exited-without-candidate reports may continue the
  // same session only up to its durable automatic-continuation limit.
  action reportWithoutCandidate(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      Set(Started, CorrectionRequired).contains(result.phase),
      state' = {
        ...state,
        results: state.results.put(id,
          if (result.continuationCount + 1 >= CONTINUATION_LIMIT) {
            ...result,
            phase: ContinuationLimitReached,
            targetHeld: false,
            continuationCount: result.continuationCount + 1,
          } else {
            ...result,
            continuationCount: result.continuationCount + 1,
          }
        ),
      },
    }
  }

  action observeExactCandidate(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == CandidatePending,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: CandidateReady,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
        }),
      },
    }
  }

  action observeInvalidCandidate(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == CandidatePending,
      state' = {
        ...state,
        results: state.results.put(id,
          if (result.correctionCount >= CORRECTION_LIMIT) {
            ...result,
            phase: CorrectionLimitReached,
            targetHeld: false,
            observedFirstParent: 99,
            observedSecondParent: 98,
          } else {
            ...result,
            phase: CorrectionRequired,
            correctionCount: result.correctionCount + 1,
            observedFirstParent: 99,
            observedSecondParent: 98,
          }
        ),
      },
    }
  }

  // A failed Git read records no candidate fact, so restart rereads the same submission.
  action gitReadFails(id: int): bool = all {
    RESULT_IDS.contains(id),
    state.results.get(id).phase == CandidatePending,
    state' = state,
  }

  action waitOnDependency(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == Started,
      state.trackerFactsCurrent,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: DependencyWait,
          targetHeld: false,
        }),
      },
    }
  }

  action recoverCoordinator: bool = all {
    not(state.recovered),
    state' = { ...state, recovered: true, trackerFactsCurrent: false },
  }

  action observeTrackerFacts: bool = all {
    not(state.trackerFactsCurrent),
    state' = { ...state, trackerFactsCurrent: true },
  }

  action step: bool = any {
    acceptResult(1),
    acceptResult(2),
    queueAcceptedResult(1),
    queueAcceptedResult(2),
    startIntegration(1),
    startIntegration(2),
    waitOnDependency(1),
    waitOnDependency(2),
    submitCandidate(1, 31),
    submitCandidate(1, 32),
    submitCandidate(2, 31),
    submitCandidate(2, 32),
    observeExactCandidate(1),
    observeExactCandidate(2),
    observeInvalidCandidate(1),
    observeInvalidCandidate(2),
    gitReadFails(1),
    gitReadFails(2),
    reportWithoutCandidate(1),
    reportWithoutCandidate(2),
    recoverCoordinator,
    observeTrackerFacts,
  }
}
