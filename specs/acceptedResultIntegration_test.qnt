module acceptedResultIntegrationTest {
  import acceptedResultIntegration.* from "./acceptedResultIntegration"

  run journalOrderSurvivesRestartTest = {
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

  run acceptedTerminalReconcilesAfterRestartTest = {
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

  run restartRequiresFreshTrackerFactsBeforeStartTest = {
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

  run startConsumesCancellationCapabilityTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .expect(and {
        startedReached,
        targetHeldExactlyActiveIntegration,
        cancellationExactlyQueued,
        not(state.results.get(1).preIntegrationCancellation),
      })
  }

  run blockerReleasesTargetWithoutDiscardingResultTest = {
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

  run explicitExactCandidateFixesOrderedParentsTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeExactCandidate(1))
      .expect(and {
        candidateReadyReached,
        candidateReadyHasExactOrderedParents,
        state.results.get(1).submittedCandidate == 31,
        state.results.get(1).integrationSession == 1,
      })
  }

  run unreadableGitPreservesExplicitSubmissionAcrossRestartTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(gitReadFails(1))
      .then(recoverCoordinator)
      .then(observeExactCandidate(1))
      .expect(and {
        restartReached,
        candidateReadyReached,
        state.results.get(1).submittedCandidate == 31,
        state.results.get(1).integrationSession == 1,
      })
  }

  run correctionReusesSessionAndAcceptsFirstCorrectedSubmissionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeInvalidCandidate(1))
      .then(submitCandidate(1, 32))
      .then(observeExactCandidate(1))
      .expect(and {
        candidateReadyReached,
        state.results.get(1).integrationSession == 1,
        state.results.get(1).submittedCandidate == 32,
        state.results.get(1).correctionCount == 1,
      })
  }

  run correctionExhaustionPreservesWorkAndReleasesTargetTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(submitCandidate(1, 31))
      .then(observeInvalidCandidate(1))
      .then(submitCandidate(1, 32))
      .then(observeInvalidCandidate(1))
      .expect(and {
        correctionLimitReached,
        state.results.get(1).submittedCandidate == 32,
        state.results.get(1).integrationSession == 1,
        not(state.results.get(1).targetHeld),
      })
  }

  run automaticContinuationExhaustionPreservesWorkAndReleasesTargetTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(reportWithoutCandidate(1))
      .then(reportWithoutCandidate(1))
      .expect(and {
        continuationLimitReached,
        state.results.get(1).continuationCount == CONTINUATION_LIMIT,
        state.results.get(1).integrationSession == 1,
        not(state.results.get(1).targetHeld),
      })
  }
}
