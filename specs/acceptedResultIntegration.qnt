// Models issue #56's accepted-result queue, serialized integration target,
// non-cancellable start cutoff, and dependency-wait release. Git verification,
// candidate construction, promotion, executor internals, and retry policy are
// intentionally absent. Update this model before changing responsibility
// ordering, target serialization, cancellation cutoff, or blocker-wait rules.
module acceptedResultIntegration {
  type Phase =
    | NoAcceptedResult
    | AcceptedResult
    | Queued
    | Started
    | DependencyWait
    | Cancelled

  type ResultState = {
    phase: Phase,
    queuePosition: int,
    preIntegrationCancellation: bool,
    targetHeld: bool,
  }

  type State = {
    results: int -> ResultState,
    nextJournalPosition: int,
    recovered: bool,
  }

  pure val RESULT_IDS = Set(1, 2)
  var state: State

  pure def canStart(s: State, id: int): bool = {
    val result = s.results.get(id)
    and {
      result.phase == Queued,
      not(RESULT_IDS.exists(other =>
        s.results.get(other).phase == Started
          and s.results.get(other).targetHeld
      )),
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

  val targetHeldExactlyStarted: bool =
    RESULT_IDS.forall(id =>
      state.results.get(id).targetHeld
        == (state.results.get(id).phase == Started)
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
      results: RESULT_IDS.mapBy(_ => {
        phase: NoAcceptedResult,
        queuePosition: 0,
        preIntegrationCancellation: false,
        targetHeld: false,
      }),
      nextJournalPosition: 1,
      recovered: false,
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

  action cancelQueuedResult(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == Queued,
      result.preIntegrationCancellation,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: Cancelled,
          preIntegrationCancellation: false,
        }),
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
        }),
      },
    }
  }

  action waitOnDependency(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == Started,
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
    state' = { ...state, recovered: true },
  }

  action step: bool = any {
    acceptResult(1),
    acceptResult(2),
    queueAcceptedResult(1),
    queueAcceptedResult(2),
    cancelQueuedResult(1),
    cancelQueuedResult(2),
    startIntegration(1),
    startIntegration(2),
    waitOnDependency(1),
    waitOnDependency(2),
    recoverCoordinator,
  }
}
