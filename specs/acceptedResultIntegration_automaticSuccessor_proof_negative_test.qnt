// Independent mutation controls for the automatic successor proof projection.
// These deliberately model a second pre-fixation Git read in one activation.
module acceptedResultIntegrationAutomaticSuccessorProofNegativeTest {
  import acceptedResultIntegrationAutomaticSuccessorProof.* from "./acceptedResultIntegration_automaticSuccessor_proof"

  action startAutomaticSuccessorRetryWithoutOperatorDirection: bool = all {
    state.phase == AutomaticSuccessorRetryQuarantined,
    state.successorRetryRunStartCount == 0,
    state' = {
      ...state,
      phase: AutomaticSuccessorRetryInFlight,
      successorRetryRunStartPosition: state.nextJournalPosition,
      successorRetryRunSession: state.successorSession,
      successorRetryRunOrdinal: 2,
      successorRetryRunStartCount: 1,
      successorRetryInvocationCount: 1,
      successorRunOrdinal: 2,
      nextJournalPosition: state.nextJournalPosition + 1,
    },
  }

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

  action duplicateAuthorizationOccurrence: bool = all {
    state.phase == AutomaticAuthorizationRecorded,
    state.authorizationCount == 1,
    state' = { ...state, authorizationCount: state.authorizationCount + 1 },
  }

  action forceStaleH2FixationDuringRequiredRefresh: bool = all {
    state.refreshRoundAvailable,
    state.successorSession == 0,
    state' = {
      ...state,
      successorSession: INITIAL_SESSION + 1,
      successorExpectedHead: state.baselineReadRemoteHead,
      successorFixedBaselineReadHead: state.baselineReadRemoteHead,
      successorFixedRemoteHead: state.baselineReadRemoteHead,
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

  run staleH2FixationBeforeRequiredRefreshIsDetectedTest = {
    init
      .then(recordInitialPublicationIntent)
      .then(outsidePushBeforeInitialDiscovery)
      .then(discoverCompatibleCompetingHead)
      .then(recordAutomaticSuccessorAuthorization)
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(recordRemoteBaselineReadIntent)
      .then(outsideTargetAlreadyMatchesRemote)
      .then(observeAlreadyCurrentLocalBaseline)
      .then(outsideRemoteAdvancesAfterReadyBaselineBeforeSuccessorFixation)
      .then(crashCoordinator)
      .then(restartCoordinator)
      .then(forceStaleH2FixationDuringRequiredRefresh)
      .expect(not(successorRefreshRoundsAreBounded))
  }

  run incompatibleH3StaysInOriginalRetainedWaitTest = {
    init
      .then(recordInitialPublicationIntent)
      .then(outsidePushBeforeInitialDiscovery)
      .then(discoverCompatibleCompetingHead)
      .then(recordAutomaticSuccessorAuthorization)
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(recordRemoteBaselineReadIntent)
      .then(outsideTargetAlreadyMatchesRemote)
      .then(observeAlreadyCurrentLocalBaseline)
      .then(outsideRemoteAdvancesToIncompatibleHead)
      .then(crashCoordinator)
      .then(restartCoordinator)
      .then(rereadAuthorityFacts)
      .then(recordRemoteBaselineReadIntent)
      .then(observeAncestorLocalBaseline)
      .expect(and {
        state.baselineReadRemoteHead == INITIAL_HEAD + 2,
        not(state.remoteHeadCompatibleWithAuthorization),
        state.phase == BaselineObserved,
        state.publicationWait == CompatibleCompetingHeadWait,
        state.authorizationCount == 1,
        state.successorSessionCount == 0,
        not(state.catchUpIntentRecorded),
      })
  }

  run duplicateAuthorizationForOneOccurrenceIsDetectedTest = {
    init
      .then(recordInitialPublicationIntent)
      .then(outsidePushBeforeInitialDiscovery)
      .then(discoverCompatibleCompetingHead)
      .then(recordAutomaticSuccessorAuthorization)
      .then(duplicateAuthorizationOccurrence)
      .expect(not(automaticAuthorizationIsOccurrenceScoped))
  }

  run automaticSuccessorRunTwoCannotStartWithoutExactOperatorRetryTest = {
    init
      .then(recordInitialPublicationIntent)
      .then(outsidePushBeforeInitialDiscovery)
      .then(discoverCompatibleCompetingHead)
      .then(recordAutomaticSuccessorAuthorization)
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(recordRemoteBaselineReadIntent)
      .then(observeAncestorLocalBaseline)
      .then(recordCatchUpIntent)
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(compareAndSetLocalTargetToRemoteHead)
      .then(recordCatchUpResult)
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(proveBaseAncestorOfSuccessorHead)
      .then(fixAutomaticSuccessorSession)
      .then(invokeAutomaticSuccessor)
      .then(recordAutomaticSuccessorNotPrepared)
      .then(quarantineAutomaticSuccessorNotPrepared)
      .then(startAutomaticSuccessorRetryWithoutOperatorDirection)
      .expect(not(automaticSuccessorRetryRequiresExactOperatorChronology))
  }
}
