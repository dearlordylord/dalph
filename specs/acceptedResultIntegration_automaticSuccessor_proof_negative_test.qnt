// Independent mutation controls for the automatic successor proof projection.
// These deliberately model a second pre-fixation Git read in one activation.
module acceptedResultIntegrationAutomaticSuccessorProofNegativeTest {
  import acceptedResultIntegrationAutomaticSuccessorProof.* from "./acceptedResultIntegration_automaticSuccessor_proof"

  action secondGitReadBeforeFixation: bool = all {
    state.phase == BaselineObserved,
    state.gitBoundariesThisActivation == 1,
    state.baselineReadCount == 1,
    state' = {
      ...state,
      baselineReadCount: state.baselineReadCount + 1,
      gitBoundariesThisActivation: state.gitBoundariesThisActivation + 1,
    },
  }

  run secondPreFixationGitReadInOneActivationIsDetectedTest = {
    init
      .then(recordInitialPublicationIntent)
      .then(outsidePushBeforeInitialDiscovery)
      .then(discoverCompatibleCompetingHead)
      .then(recordAutomaticSuccessorAuthorization)
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(recordRemoteBaselineReadIntent)
      .then(observeAncestorLocalBaseline)
      .then(secondGitReadBeforeFixation)
      .expect(and {
        not(oneGitObservationOrCompareAndSetPerActivation),
        not(noReadUntilStableLoop),
      })
  }
}
