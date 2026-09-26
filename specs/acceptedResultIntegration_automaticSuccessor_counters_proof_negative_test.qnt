// Independent negative controls. These deliberately inject forbidden counter
// transitions and confirm that the unchanged two-conjunct invariant detects them.
module acceptedResultIntegrationAutomaticSuccessorCountersProofNegativeTest {
  import acceptedResultIntegrationAutomaticSuccessorCountersProof.* from "./acceptedResultIntegration_automaticSuccessor_counters_proof"

  action casWithoutObservedBaseline: bool = all {
    state.phase == Authorized,
    state' = {
      ...state,
      phase: CatchUpApplied,
      catchUpCasCountForAuthorization: state.catchUpCasCountForAuthorization + 1,
      catchUpCasCountForBaselineRound: state.catchUpCasCountForBaselineRound + 1,
    },
  }

  action duplicateCasInSameRound: bool = all {
    state.phase == CatchUpApplied,
    state.catchUpCasCountForBaselineRound == 1,
    state' = {
      ...state,
      catchUpCasCountForAuthorization: state.catchUpCasCountForAuthorization + 1,
      catchUpCasCountForBaselineRound: state.catchUpCasCountForBaselineRound + 1,
    },
  }

  run casWithoutObservedBaselineViolatesAuthorizationBoundTest = {
    init
      .then(recordAutomaticSuccessorAuthorization)
      .then(casWithoutObservedBaseline)
      .expect(and {
        state.catchUpCasCountForAuthorization == 1,
        state.baselineReadCountForAuthorization == 0,
        not(catchUpCasIsBoundedByBaselineRounds),
      })
  }

  run duplicateCasInOneBaselineRoundViolatesRoundBoundTest = {
    init
      .then(recordAutomaticSuccessorAuthorization)
      .then(recordRemoteBaselineReadIntent)
      .then(observeOtherBaseline)
      .then(makeBaselineRefreshAvailable)
      .then(recordRemoteBaselineReadIntent)
      .then(observeAncestorLocalBaseline)
      .then(recordCatchUpIntent)
      .then(compareAndSetLocalTargetToRemoteHead)
      .expect(and {
        state.baselineReadCountForAuthorization == 2,
        state.catchUpCasCountForAuthorization == 1,
        state.catchUpCasCountForBaselineRound == 1,
        catchUpCasIsBoundedByBaselineRounds,
      })
      .then(duplicateCasInSameRound)
      .expect(and {
        state.catchUpCasCountForAuthorization == 2,
        state.baselineReadCountForAuthorization == 2,
        state.catchUpCasCountForBaselineRound == 2,
        not(catchUpCasIsBoundedByBaselineRounds),
      })
  }
}
