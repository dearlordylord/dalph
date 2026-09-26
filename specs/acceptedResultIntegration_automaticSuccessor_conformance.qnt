// Replay adapter for the accepted-result automatic-successor proof model.
// It stores only the selected canonical action so a production driver can
// execute the same chronology; no second workflow state is introduced.
module acceptedResultIntegrationAutomaticSuccessorConformance {
  import acceptedResultIntegrationAutomaticSuccessorProof.* from "./acceptedResultIntegration_automaticSuccessor_proof"

  var replayAction: { tag: str, value: { unused: bool } }

  action replayInit: bool = all { init, replayAction' = { tag: "init", value: { unused: true } } }
  action replayRecordInitialPublicationIntent: bool = all {
    recordInitialPublicationIntent,
    replayAction' = { tag: "recordInitialPublicationIntent", value: { unused: true } },
  }
  action replayOutsidePushBeforeInitialDiscovery: bool = all {
    outsidePushBeforeInitialDiscovery,
    replayAction' = { tag: "outsidePushBeforeInitialDiscovery", value: { unused: true } },
  }
  action replayDiscoverCompatibleCompetingHead: bool = all {
    discoverCompatibleCompetingHead,
    replayAction' = { tag: "discoverCompatibleCompetingHead", value: { unused: true } },
  }
  action replayRecordAutomaticSuccessorAuthorization: bool = all {
    recordAutomaticSuccessorAuthorization,
    replayAction' = { tag: "recordAutomaticSuccessorAuthorization", value: { unused: true } },
  }
  action replayBeginNextActivation: bool = all {
    beginNextActivation,
    replayAction' = { tag: "beginNextActivation", value: { unused: true } },
  }
  action replayRereadAuthorityFacts: bool = all {
    rereadAuthorityFacts,
    replayAction' = { tag: "rereadAuthorityFacts", value: { unused: true } },
  }
  action replayRecordRemoteBaselineReadIntent: bool = all {
    recordRemoteBaselineReadIntent,
    replayAction' = { tag: "recordRemoteBaselineReadIntent", value: { unused: true } },
  }
  action replayObserveAncestorLocalBaseline: bool = all {
    observeAncestorLocalBaseline,
    replayAction' = { tag: "observeAncestorLocalBaseline", value: { unused: true } },
  }
  action replayRecordCatchUpIntent: bool = all {
    recordCatchUpIntent,
    replayAction' = { tag: "recordCatchUpIntent", value: { unused: true } },
  }
  action replayCompareAndSetLocalTargetToRemoteHead: bool = all {
    compareAndSetLocalTargetToRemoteHead,
    replayAction' = { tag: "compareAndSetLocalTargetToRemoteHead", value: { unused: true } },
  }
  action replayRecordCatchUpResult: bool = all {
    recordCatchUpResult,
    replayAction' = { tag: "recordCatchUpResult", value: { unused: true } },
  }
  action replayCrashCoordinator: bool = all {
    crashCoordinator,
    replayAction' = { tag: "crashCoordinator", value: { unused: true } },
  }
  action replayRestartCoordinator: bool = all {
    restartCoordinator,
    replayAction' = { tag: "restartCoordinator", value: { unused: true } },
  }
  action replayObserveCatchUpAfterRecovery: bool = all {
    observeCatchUpAfterRecovery,
    replayAction' = { tag: "observeCatchUpAfterRecovery", value: { unused: true } },
  }
  action replayProveBaseAncestorOfSuccessorHead: bool = all {
    proveBaseAncestorOfSuccessorHead,
    replayAction' = { tag: "proveBaseAncestorOfSuccessorHead", value: { unused: true } },
  }
  action replayFixAutomaticSuccessorSession: bool = all {
    fixAutomaticSuccessorSession,
    replayAction' = { tag: "fixAutomaticSuccessorSession", value: { unused: true } },
  }

  run automaticSuccessorProductionConformanceTest = {
    replayInit
      .then(replayRecordInitialPublicationIntent)
      .then(replayOutsidePushBeforeInitialDiscovery)
      .then(replayDiscoverCompatibleCompetingHead)
      .then(replayRecordAutomaticSuccessorAuthorization)
      .then(replayBeginNextActivation)
      .then(replayRereadAuthorityFacts)
      .then(replayRecordRemoteBaselineReadIntent)
      .then(replayObserveAncestorLocalBaseline)
      .then(replayRecordCatchUpIntent)
      .then(replayBeginNextActivation)
      .then(replayRereadAuthorityFacts)
      .then(replayCompareAndSetLocalTargetToRemoteHead)
      .then(replayRecordCatchUpResult)
      .then(replayBeginNextActivation)
      .then(replayRereadAuthorityFacts)
      .then(replayProveBaseAncestorOfSuccessorHead)
      .then(replayFixAutomaticSuccessorSession)
      .expect(and {
        state.phase == AutomaticSuccessorSessionFixed,
        state.successorSessionCount == 1,
        state.successorSession == INITIAL_SESSION + 1,
        state.successorExpectedHead == INITIAL_HEAD + 1,
        state.successorResource != INITIAL_RESOURCE,
        successorKeepsAcceptedResultLineage,
        exactTaskAndResponsibilityAreRetained,
      })
  }
}
