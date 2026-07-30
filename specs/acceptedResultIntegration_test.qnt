module acceptedResultIntegrationTest {
  import acceptedResultIntegration.* from "./acceptedResultIntegration"

  run journalOrderSurvivesRestart = {
    init
      .then(acceptResult(1))
      .then(acceptResult(2))
      .then(queueAcceptedResult(1))
      .then(queueAcceptedResult(2))
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(startIntegration(1))
      .expect(and {
        restartReached,
        state.results.get(1).phase == Started,
        state.results.get(2).phase == Queued,
        state.results.get(1).queuePosition < state.results.get(2).queuePosition,
      })
  }

  run acceptedTerminalReconcilesAfterRestart = {
    init
      .then(acceptResult(1))
      .then(recoverCoordinator)
      .then(queueAcceptedResult(1))
      .expect(and {
        restartReached,
        state.results.get(1).phase == Queued,
        state.results.get(1).queuePosition == 1,
        state.results.get(1).preIntegrationCancellation,
      })
  }

  run restartRequiresFreshTrackerFactsBeforeStart = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(recoverCoordinator)
      .then(all {
        assert(not(canStart(state, 1))),
        observeTrackerFacts,
      })
      .then(startIntegration(1))
      .expect(and {
        restartReached,
        state.trackerFactsCurrent,
        state.results.get(1).phase == Started,
      })
  }

  run startConsumesCancellationCapability = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .expect(and {
        startedReached,
        targetHeldExactlyStarted,
        cancellationExactlyQueued,
        not(state.results.get(1).preIntegrationCancellation),
      })
  }

  run blockerReleasesTargetWithoutDiscardingResult = {
    init
      .then(acceptResult(1))
      .then(acceptResult(2))
      .then(queueAcceptedResult(1))
      .then(queueAcceptedResult(2))
      .then(startIntegration(1))
      .then(waitOnDependency(1))
      .expect(and {
        dependencyWaitReleasedTarget,
        state.results.get(1).queuePosition == 1,
        state.results.get(1).phase == DependencyWait,
        state.results.get(2).phase == Queued,
        not(state.results.get(2).targetHeld),
      })
  }
}
