module acceptedResultIntegrationAutomaticSuccessorCountersProofTest {
  import acceptedResultIntegrationAutomaticSuccessorCountersProof.* from "./acceptedResultIntegration_automaticSuccessor_counters_proof"

  run twoBaselineRoundsRequireTwoObservedReadsAndOneCasEachTest = {
    init
      .then(recordAutomaticSuccessorAuthorization)
      .then(recordRemoteBaselineReadIntent)
      .then(observeAncestorLocalBaseline)
      .then(recordCatchUpIntent)
      .then(compareAndSetLocalTargetToRemoteHead)
      .expect(and {
        state.baselineReadIntentCount == 1,
        state.baselineReadCountForAuthorization == 1,
        state.refreshRoundCount == 0,
        not(state.refreshAvailable),
        state.catchUpCasCountForAuthorization == 1,
        state.catchUpCasCountForBaselineRound == 1,
        catchUpCasIsBoundedByBaselineRounds,
        successorRefreshRoundsAreBounded,
      })
      .then(makeBaselineRefreshAvailable)
      .expect(and {
        state.baselineReadIntentCount == 1,
        state.baselineReadCountForAuthorization == 1,
        state.refreshRoundCount == 0,
        state.refreshAvailable,
        successorRefreshRoundsAreBounded,
      })
      .then(recordRemoteBaselineReadIntent)
      .expect(and {
        state.baselineReadIntentCount == 2,
        state.baselineReadCountForAuthorization == 1,
        state.refreshRoundCount == 1,
        not(state.refreshAvailable),
        state.catchUpCasCountForAuthorization == 1,
        state.catchUpCasCountForBaselineRound == 0,
        catchUpCasIsBoundedByBaselineRounds,
        successorRefreshRoundsAreBounded,
      })
      .then(observeAncestorLocalBaseline)
      .then(recordCatchUpIntent)
      .then(compareAndSetLocalTargetToRemoteHead)
      .expect(and {
        state.baselineReadIntentCount == 2,
        state.baselineReadCountForAuthorization == 2,
        state.catchUpCasCountForAuthorization == 2,
        state.catchUpCasCountForBaselineRound == 1,
        secondRoundCatchUpReached,
        catchUpCasIsBoundedByBaselineRounds,
        successorRefreshRoundsAreBounded,
      })
  }

  run competingHeadCycleRetainsPriorCountersUntilAuthorizationTest = {
    init
      .then(recordAutomaticSuccessorAuthorization)
      .then(recordRemoteBaselineReadIntent)
      .then(observeAncestorLocalBaseline)
      .then(recordCatchUpIntent)
      .then(compareAndSetLocalTargetToRemoteHead)
      .then(beginNextAutomaticCompetingHeadCycle)
      .expect(and {
        state.phase == OccurrenceEnded,
        state.baselineReadIntentCount == 1,
        state.baselineReadCountForAuthorization == 1,
        state.catchUpCasCountForAuthorization == 1,
        state.catchUpCasCountForBaselineRound == 1,
        catchUpCasIsBoundedByBaselineRounds,
        successorRefreshRoundsAreBounded,
      })
      .then(recordAutomaticSuccessorAuthorization)
      .expect(and {
        state.phase == Authorized,
        state.baselineReadIntentCount == 0,
        state.baselineReadCountForAuthorization == 0,
        state.refreshRoundCount == 0,
        not(state.refreshAvailable),
        state.catchUpCasCountForAuthorization == 0,
        state.catchUpCasCountForBaselineRound == 0,
        catchUpCasIsBoundedByBaselineRounds,
        successorRefreshRoundsAreBounded,
      })
  }
}
