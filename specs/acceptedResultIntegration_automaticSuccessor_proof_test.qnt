module acceptedResultIntegrationAutomaticSuccessorProofTest {
  import acceptedResultIntegrationAutomaticSuccessorProof.* from "./acceptedResultIntegration_automaticSuccessor_proof"

  // Competing remote work is discovered before the first push. Authorization
  // is one journal event for the predecessor occurrence; local catch-up uses
  // one exact intent and CAS per fresh activation and recovery reuses it.
  run beforeDiscoveryCatchesUpExactAncestorAndFixesOneSuccessorTest = {
    init
      .then(recordInitialPublicationIntent)
      .then(outsidePushBeforeInitialDiscovery)
      .then(discoverCompatibleCompetingHead)
      .expect(and {
        state.phase == PublicationCompetingHead,
        state.racePlacement == BeforeInitialDiscovery,
        state.competingHead == INITIAL_HEAD + 1,
        state.publicationWait == CompatibleCompetingHeadWait,
        state.publicationPushCount == 0,
        competingHeadRetainedReached,
      })
      .then(recordAutomaticSuccessorAuthorization)
      .expect(and {
        state.publicationAuthorizationRecorded,
        state.authorizationCount == 1,
        state.authorizationPredecessorSession == INITIAL_SESSION,
        state.authorizationPublicationOccurrence == state.competitionOccurrence,
        state.authorizationBaseCommit == BASE_COMMIT,
        state.authorizationTaskCommit == ACCEPTED_TASK_COMMIT,
        state.authorizationQueuePosition == ORIGINAL_QUEUE_POSITION,
        journalFirstAutomaticAuthorization,
        authorizationRequiresCurrentExactAuthority,
      })
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(recordRemoteBaselineReadIntent)
      .then(observeAncestorLocalBaseline)
      .expect(and {
        state.baselineReadCount == 1,
        state.baselineReadRemoteHead == INITIAL_HEAD + 1,
        state.baselineReadLocalHead == INITIAL_HEAD,
        oneGitObservationOrCompareAndSetPerActivation,
      })
      .then(recordCatchUpIntent)
      .expect(and {
        state.catchUpIntentRecorded,
        state.catchUpIntentFrom == INITIAL_HEAD,
        state.catchUpIntentTo == INITIAL_HEAD + 1,
        state.catchUpIntentPosition > state.baselineReadIntentPosition,
      })
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(compareAndSetLocalTargetToRemoteHead)
      .expect(and {
        state.catchUpCasCount == 1,
        state.catchUpCasPosition > state.catchUpIntentPosition,
        state.localTargetHead == state.competingHead,
        catchUpRequiresJournaledExactCompareAndSet,
        oneGitObservationOrCompareAndSetPerActivation,
      })
      .then(crashCoordinator)
      .then(restartCoordinator)
      .then(rereadAuthorityFacts)
      .then(observeCatchUpAfterRecovery)
      .expect(and {
        state.catchUpCasCount == 1,
        state.catchUpResultRecorded,
        state.localTargetHead == state.competingHead,
        state.store == MemoryJournal,
        catchUpRequiresJournaledExactCompareAndSet,
      })
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(proveBaseAncestorOfSuccessorHead)
      .then(fixAutomaticSuccessorSession)
      .expect(and {
        state.phase == AutomaticSuccessorSessionFixed,
        state.currentSession == INITIAL_SESSION + 1,
        state.successorExpectedHead == INITIAL_HEAD + 1,
        state.successorSessionCount == 1,
        state.currentCandidateResource != INITIAL_RESOURCE,
        state.predecessorResourcesPreserved == 1,
        successorKeepsAcceptedResultLineage,
        successorRequiresFreshBaseLineageAndJournaledAuthorization,
        exactTaskAndResponsibilityAreRetained,
        automaticSuccessorBoundsAreFinite,
      })
  }

  // A race after discovery but before the push is reconciled after one fresh
  // activation. If local L already equals H2, Dalph records no catch-up CAS.
  // A fixed S2 survives restart; a lost provider response reuses its run only
  // after exact writer custody is stopped.
  run betweenDiscoveryAndPushUsesSameHeadAndProviderRunAfterRecoveryTest = {
    init
      .then(recordInitialPublicationIntent)
      .then(discoverInitialFixedHead)
      .then(outsidePushBetweenDiscoveryAndPublication)
      .then(sendInitialCandidate)
      .then(rejectInitialPushAtCompetingHead)
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(discoverCompatibleCompetingHead)
      .then(recordAutomaticSuccessorAuthorization)
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(recordRemoteBaselineReadIntent)
      .then(outsideTargetAlreadyMatchesRemote)
      .then(observeAlreadyCurrentLocalBaseline)
      .expect(and {
        state.localTargetHead == state.competingHead,
        state.baselineReadLocalHead == state.baselineReadRemoteHead,
        state.catchUpCasCount == 0,
        oneGitObservationOrCompareAndSetPerActivation,
      })
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(proveBaseAncestorOfSuccessorHead)
      .then(fixAutomaticSuccessorSession)
      .then(crashCoordinator)
      .then(restartCoordinator)
      .then(rereadAuthorityFacts)
      .then(invokeAutomaticSuccessor)
      .then(loseAutomaticSuccessorResponse)
      .expect(and {
        state.phase == AutomaticSuccessorResponseLost,
        state.successorSession == INITIAL_SESSION + 1,
        state.successorInvocationCount == 1,
        state.successorRunOrdinal == 1,
        not(state.successorWriterStopped),
        predecessorCleanupRequiresStoppedWriter,
      })
      .then(crashCoordinator)
      .then(restartCoordinator)
      .then(rereadAuthorityFacts)
      .then(proveAutomaticSuccessorWriterStopped)
      .then(resumeAutomaticSuccessorSameRun)
      .expect(and {
        state.successorResumeCount == 1,
        state.successorInvocationCount == 1,
        state.successorRunOrdinal == 1,
        state.successorStoppedWriterReconciled,
        successorRecoveryReusesOneFixedRun,
      })
      .then(reportAutomaticSuccessorCandidate)
      .expect(and {
        state.phase == AutomaticSuccessorCandidateRecorded,
        state.successorCandidateFirstParent == state.successorExpectedHead,
        state.successorCandidateSecondParent == ACCEPTED_TASK_COMMIT,
        state.taskBeginCount == 1,
        successorKeepsAcceptedResultLineage,
      })
  }

  // The lost-publication-response cut and the post-authorization crash recover
  // from a reopened SQLite journal. No second authorization or task Begin is
  // created; the fixed S2 publishes a candidate with exact [H2, C] parents.
  run lostPushResponseAndAuthorizationCutRecoverFromReopenedSQLiteTest = {
    init
      .then(selectReopenedSQLiteJournal)
      .then(recordInitialPublicationIntent)
      .then(sendInitialCandidate)
      .then(outsidePushAfterAmbiguousInitialResponse)
      .then(loseInitialPushResponse)
      .then(discoverCompatibleCompetingHead)
      .then(recordAutomaticSuccessorAuthorization)
      .then(crashCoordinator)
      .then(restartCoordinator)
      .then(rereadAuthorityFacts)
      .expect(and {
        state.phase == AutomaticAuthorizationRecorded,
        state.publicationAuthorizationRecorded,
        state.authorizationCount == 1,
        state.store == ReopenedSQLiteJournal,
      })
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
      .then(reportAutomaticSuccessorCandidate)
      .then(recordSuccessorPublicationIntent)
      .then(sendSuccessorPublication)
      .then(settleSuccessorPublication)
      .expect(and {
        state.phase == AutomaticSuccessorPublicationProved,
        state.successorSession == INITIAL_SESSION + 1,
        state.publicationAuthorizationRecorded,
        state.authorizationCount == 1,
        state.successorCandidateFirstParent == state.successorExpectedHead,
        state.successorCandidateSecondParent == ACCEPTED_TASK_COMMIT,
        state.publicationPushCount == 2,
        state.store == ReopenedSQLiteJournal,
        state.taskBeginCount == 1,
        successorKeepsAcceptedResultLineage,
        journalFirstAutomaticAuthorization,
        automaticSuccessorBoundsAreFinite,
      })
  }

  // A compatible outside update at the third fixed session remains a typed
  // retained wait. There is no automatic authorization or fourth session.
  run thirdSessionAndThirdPushExhaustWithoutUnrequestedFourthSessionTest = {
    init
      .then(recordInitialPublicationIntent)
      .then(sendInitialCandidate)
      .then(outsidePushAfterAmbiguousInitialResponse)
      .then(loseInitialPushResponse)
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
      .then(reportAutomaticSuccessorCandidate)
      .then(recordSuccessorPublicationIntent)
      .then(sendSuccessorPublication)
      .then(outsideAdvanceBeforeSuccessorPushSettles)
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(beginNextAutomaticCompetingHeadCycle)
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
      .then(reportAutomaticSuccessorCandidate)
      .then(recordSuccessorPublicationIntent)
      .then(sendSuccessorPublication)
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(retainThirdCompetingHeadAtBatchLimit)
      .expect(and {
        state.phase == BoundedRetainedWait,
        state.sessionCount == MAX_SESSIONS,
        state.successorSession == MAX_SESSIONS,
        state.authorizationCount == MAX_SESSIONS - 1,
        state.successorPublicationIntentCount == MAX_SESSIONS - 1,
        state.publicationPushCount == MAX_PUBLICATION_PUSHES,
        state.publicationAuthorizationRecorded,
        state.publicationWait == CompatibleCompetingHeadWait,
        state.currentSession == MAX_SESSIONS,
        state.taskBeginCount == 1,
        state.queuePosition == ORIGINAL_QUEUE_POSITION,
        state.baseCommit == BASE_COMMIT,
        state.acceptedTaskCommit == ACCEPTED_TASK_COMMIT,
        noUnrequestedFourthSession,
        automaticSuccessorBoundsAreFinite,
        exactTaskAndResponsibilityAreRetained,
      })
  }

  run unsafeLocalWorkKeepsTypedDispositionAndNoCatchUpTest = {
    init
      .then(recordInitialPublicationIntent)
      .then(outsidePushBeforeInitialDiscovery)
      .then(discoverCompatibleCompetingHead)
      .then(recordAutomaticSuccessorAuthorization)
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(recordRemoteBaselineReadIntent)
      .then(observeUnsafeLocalBaseline(LocalIsDirty))
      .expect(and {
        state.phase == UnsafeLocalWorkRetained,
        state.localTargetState == LocalIsDirty,
        state.unsafeDisposition == PreserveDirtyTarget,
        not(state.catchUpIntentRecorded),
        state.catchUpCasCount == 0,
        localCatchUpPreservesUnsafeWork,
      })
  }

  run conclusiveDeniedPublicationDoesNotAuthorizeSuccessorTest = {
    init
      .then(recordInitialPublicationIntent)
      .then(sendInitialCandidate)
      .then(recordConclusiveDeniedWait)
      .expect(and {
        state.phase == ConclusivePublicationWait,
        state.publicationWait == ConclusiveDeniedWait,
        not(state.publicationAuthorizationRecorded),
        state.authorizationCount == 0,
        authorizationRequiresCurrentExactAuthority,
      })
  }

  run pauseRetainsAuthorizedSuccessorWithoutForwardEffectsTest = {
    init
      .then(recordInitialPublicationIntent)
      .then(outsidePushBeforeInitialDiscovery)
      .then(discoverCompatibleCompetingHead)
      .then(recordAutomaticSuccessorAuthorization)
      .then(pauseRun)
      .expect(and {
        state.lifecycle == Paused,
        state.phase == AutomaticAuthorizationRecorded,
        state.publicationAuthorizationRecorded,
        pauseAndExitStopNewSuccessorActions,
        exactTaskAndResponsibilityAreRetained,
      })
  }

  run exitRetainsAuthorizedSuccessorAtCutoffTest = {
    init
      .then(recordInitialPublicationIntent)
      .then(outsidePushBeforeInitialDiscovery)
      .then(discoverCompatibleCompetingHead)
      .then(recordAutomaticSuccessorAuthorization)
      .then(admitExit)
      .expect(and {
        state.lifecycle == ExitAdmitted,
        state.phase == AutomaticAuthorizationRecorded,
        state.publicationAuthorizationRecorded,
        pauseAndExitStopNewSuccessorActions,
        exactTaskAndResponsibilityAreRetained,
      })
  }
}
