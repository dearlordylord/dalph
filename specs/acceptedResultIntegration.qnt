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
    | CorrelationContradiction
    | CorrelationContradictionReleased

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

  val correlationContradictionReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == CorrelationContradiction)

  val correlationContradictionReleasedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == CorrelationContradictionReleased)

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

  val targetHeldOnlyForActiveIntegration: bool =
    RESULT_IDS.forall(id =>
      state.results.get(id).targetHeld implies
        Set(Started, CandidatePending, CorrectionRequired, CandidateReady, CorrelationContradiction).contains(state.results.get(id).phase)
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
      Set(Started, CandidatePending, CorrectionRequired, CandidateReady, CorrectionLimitReached, ContinuationLimitReached, CorrelationContradiction, CorrelationContradictionReleased).contains(state.results.get(id).phase)
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
      result.targetHeld,
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
      result.targetHeld,
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

  // A report for another session stops this operation before any Git read. The
  // exact external correlation is exercised by the TypeScript protocol and
  // cassette adapter; this model retains the fixed session and existing work.
  action reportForeignCorrelation(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      Set(Started, CorrectionRequired).contains(result.phase),
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: CorrelationContradiction,
          targetHeld: true,
        }),
      },
    }
  }

  action releaseForeignCorrelationTarget(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == CorrelationContradiction,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: CorrelationContradictionReleased,
          targetHeld: false,
        }),
      },
    }
  }

  action observeExactCandidate(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == CandidatePending,
      result.targetHeld,
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
      result.targetHeld,
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
    state.results.get(id).targetHeld,
    state' = state,
  }

  action waitOnDependency(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == Started,
      result.targetHeld,
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
    state' = {
      ...state,
      results: RESULT_IDS.mapBy(id => {
        val result = state.results.get(id)
        {
          ...result,
          phase:
            if (result.phase == CorrelationContradictionReleased)
              CorrelationContradiction
            else
              result.phase,
          targetHeld: false,
        }
      }),
      recovered: true,
      trackerFactsCurrent: false,
    },
  }

  action observeTrackerFacts: bool = all {
    not(state.trackerFactsCurrent),
    state' = { ...state, trackerFactsCurrent: true },
  }

  pure def canReacquireTarget(s: State, id: int): bool = {
    val result = s.results.get(id)
    and {
      RESULT_IDS.contains(id),
      s.trackerFactsCurrent,
      Set(Started, CandidatePending, CorrectionRequired).contains(result.phase),
      not(result.targetHeld),
      not(RESULT_IDS.exists(other => s.results.get(other).targetHeld)),
    }
  }

  action reacquireIntegrationTarget(id: int): bool = {
    val result = state.results.get(id)
    all {
      canReacquireTarget(state, id),
      state' = {
        ...state,
        results: state.results.put(id, { ...result, targetHeld: true }),
      },
    }
  }

  // Quint traces retain action names but not the arguments passed to action
  // definitions. These concrete executable actions preserve the parameterized
  // helpers above for exact tests while giving the TypeScript conformance
  // adapter an unambiguous production operation for every trace step.
  action acceptResultOne: bool = acceptResult(1)
  action acceptResultTwo: bool = acceptResult(2)
  action queueAcceptedResultOne: bool = queueAcceptedResult(1)
  action queueAcceptedResultTwo: bool = queueAcceptedResult(2)
  action startIntegrationOne: bool = startIntegration(1)
  action startIntegrationTwo: bool = startIntegration(2)
  action waitOnDependencyOne: bool = waitOnDependency(1)
  action waitOnDependencyTwo: bool = waitOnDependency(2)
  action submitCandidateOne31: bool = submitCandidate(1, 31)
  action submitCandidateOne32: bool = submitCandidate(1, 32)
  action submitCandidateTwo31: bool = submitCandidate(2, 31)
  action submitCandidateTwo32: bool = submitCandidate(2, 32)
  action observeExactCandidateOne: bool = observeExactCandidate(1)
  action observeExactCandidateTwo: bool = observeExactCandidate(2)
  action observeInvalidCandidateOne: bool = observeInvalidCandidate(1)
  action observeInvalidCandidateTwo: bool = observeInvalidCandidate(2)
  action gitReadFailsOne: bool = gitReadFails(1)
  action gitReadFailsTwo: bool = gitReadFails(2)
  action reportWithoutCandidateOne: bool = reportWithoutCandidate(1)
  action reportWithoutCandidateTwo: bool = reportWithoutCandidate(2)
  action reportForeignCorrelationOne: bool = reportForeignCorrelation(1)
  action reportForeignCorrelationTwo: bool = reportForeignCorrelation(2)
  action releaseForeignCorrelationTargetOne: bool = releaseForeignCorrelationTarget(1)
  action releaseForeignCorrelationTargetTwo: bool = releaseForeignCorrelationTarget(2)
  action reacquireIntegrationTargetOne: bool = reacquireIntegrationTarget(1)
  action reacquireIntegrationTargetTwo: bool = reacquireIntegrationTarget(2)

  action step: bool = any {
    acceptResultOne,
    acceptResultTwo,
    queueAcceptedResultOne,
    queueAcceptedResultTwo,
    startIntegrationOne,
    startIntegrationTwo,
    waitOnDependencyOne,
    waitOnDependencyTwo,
    submitCandidateOne31,
    submitCandidateOne32,
    submitCandidateTwo31,
    submitCandidateTwo32,
    observeExactCandidateOne,
    observeExactCandidateTwo,
    observeInvalidCandidateOne,
    observeInvalidCandidateTwo,
    gitReadFailsOne,
    gitReadFailsTwo,
    reportWithoutCandidateOne,
    reportWithoutCandidateTwo,
    reportForeignCorrelationOne,
    reportForeignCorrelationTwo,
    releaseForeignCorrelationTargetOne,
    releaseForeignCorrelationTargetTwo,
    reacquireIntegrationTargetOne,
    reacquireIntegrationTargetTwo,
    recoverCoordinator,
    observeTrackerFacts,
  }
}
