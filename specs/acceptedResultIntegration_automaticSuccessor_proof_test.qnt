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
      .then(loseAutomaticSuccessorResponse)
      .then(crashCoordinator)
      .then(restartCoordinator)
      .then(rereadAuthorityFacts)
      .then(proveAutomaticSuccessorWriterStopped)
      .then(resumeAutomaticSuccessorSameRun)
      .expect(and {
        state.successorResumeCount == MAX_SUCCESSOR_RESUMES,
        state.successorSession == INITIAL_SESSION + 1,
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

  // S2's own conclusive Q does not authorize another Integrator call by
  // itself. Run ordinal two starts only after exact Operator Retry D and a
  // fresh unchanged-head lineage observation for the same automatic session.
  run exactOperatorRetryOfAutomaticS2AfterConclusiveQTest = {
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
      .then(applyOperatorRetryToAutomaticSuccessor)
      .then(observeFreshLineageAfterAutomaticSuccessorRetry)
      .then(startAuthorizedAutomaticSuccessorRetry)
      .expect(and {
        state.phase == AutomaticSuccessorRetryInFlight,
        state.successorSession == INITIAL_SESSION + 1,
        state.successorRunOrdinal == 2,
        state.successorRetryRunOrdinal == 2,
        state.successorRetryRunStartCount == 1,
        state.successorRetryInvocationCount == 1,
        state.successorResultPosition < state.successorQuarantinePosition,
        state.successorQuarantinePosition < state.successorRetryDirectionPosition,
        state.successorRetryDirectionPosition < state.successorRetryLineagePosition,
        state.successorRetryLineagePosition < state.successorRetryRunStartPosition,
        automaticSuccessorRetryRequiresExactOperatorChronology,
        exactTaskAndResponsibilityAreRetained,
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
      .expect(and {
        state.phase == AutomaticSuccessorPushRejected,
        state.remoteHead == state.successorExpectedHead + 1,
        state.successorExpectedHead == state.successorFixedRemoteHead,
        state.successorExpectedHead == state.authorizationRemoteHead,
        state.publicationAuthorizationRecorded,
        state.publicationWait == NoPublicationWait,
        state.sessionCount == INITIAL_SESSION + 1,
      })
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(beginNextAutomaticCompetingHeadCycle)
      .expect(and {
        state.phase == PublicationCompetingHead,
        not(state.publicationAuthorizationRecorded),
        state.authorizationCount == 1,
        state.baselineReadIntentCount == 1,
        state.baselineReadCountForAuthorization == 1,
        state.baselineReadIntentCount == state.baselineReadCountForAuthorization,
        state.catchUpCasCountForAuthorization == 1,
        state.catchUpCasCountForAuthorization <= state.baselineReadCountForAuthorization,
        not(state.catchUpIntentRecorded),
        state.catchUpCasCountForBaselineRound == 0,
        state.catchUpCasCount == 1,
      })
      .then(recordAutomaticSuccessorAuthorization)
      .expect(and {
        state.publicationAuthorizationRecorded,
        state.authorizationCount == 2,
        state.authorizationPublicationOccurrence == state.competitionOccurrence,
        state.baselineReadIntentCount == 0,
        state.baselineReadCountForAuthorization == 0,
        state.catchUpCasCountForAuthorization == 0,
        state.catchUpCasCountForBaselineRound == 0,
        state.catchUpCasCount == 1,
      })
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
        state.authorizationPublicationOccurrence == state.competitionOccurrence - 1,
        journalFirstAutomaticAuthorization,
        automaticAuthorizationIsOccurrenceScoped,
        successorUsesLatestBaselineRoundUnderOriginalAuthorization,
        authorizationRequiresCurrentExactAuthority,
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

  // H3 arrives after the durable H2 authorization but before any S2 baseline.
  // The first S2 observation is H3, and catch-up/fixation retain that one auth.
  run compatibleH3BeforeBaselineFixesUnderSameAuthorizationTest = {
    init
      .then(recordInitialPublicationIntent)
      .then(outsidePushBeforeInitialDiscovery)
      .then(discoverCompatibleCompetingHead)
      .then(recordAutomaticSuccessorAuthorization)
      .then(outsideRemoteAdvancesBeforeFirstSuccessorBaseline)
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(recordRemoteBaselineReadIntent)
      .then(observeAncestorLocalBaseline)
      .expect(and {
        state.authorizationRemoteHead == INITIAL_HEAD + 1,
        state.baselineReadRemoteHead == INITIAL_HEAD + 2,
        state.baselineReadIntentCount == 1,
        state.authorizationCount == 1,
        refreshedH3BaselineReached,
        oneGitObservationOrCompareAndSetPerActivation,
      })
      .then(recordCatchUpIntent)
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(compareAndSetLocalTargetToRemoteHead)
      .then(recordCatchUpResult)
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(proveBaseAncestorOfSuccessorHead)
      .then(fixAutomaticSuccessorSession)
      .expect(and {
        state.successorExpectedHead == INITIAL_HEAD + 2,
        state.successorSessionCount == 1,
        state.authorizationCount == 1,
        successorKeepsAcceptedResultLineage,
        successorUsesLatestBaselineRoundUnderOriginalAuthorization,
        oneGitObservationOrCompareAndSetPerActivation,
      })
  }

  // A completed H2 baseline survives process restart in SQLite. After a
  // compatible H3 advance, the next activation journals a second baseline
  // round, catches the exact H2 local ancestor up to H3, then fixes one S2.
  run compatibleH3AfterBaselineAndSQLiteRestartFixesUnderSameAuthorizationTest = {
    init
      .then(selectReopenedSQLiteJournal)
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
      .then(outsideRemoteAdvancesAfterReadyBaselineBeforeSuccessorFixation)
      .then(crashCoordinator)
      .then(restartCoordinator)
      .then(rereadAuthorityFacts)
      .then(recordRemoteBaselineReadIntent)
      .then(crashCoordinator)
      .then(restartCoordinator)
      .then(rereadAuthorityFacts)
      .then(observeAncestorLocalBaseline)
      .expect(and {
        state.baselineReadRemoteHead == INITIAL_HEAD + 2,
        state.baselineReadLocalHead == INITIAL_HEAD + 1,
        state.baselineReadIntentCount == 2,
        state.authorizationRemoteHead == INITIAL_HEAD + 1,
        state.authorizationCount == 1,
        state.store == ReopenedSQLiteJournal,
        refreshedH3BaselineReached,
      })
      .then(recordCatchUpIntent)
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(compareAndSetLocalTargetToRemoteHead)
      .then(crashCoordinator)
      .then(restartCoordinator)
      .then(rereadAuthorityFacts)
      .then(observeCatchUpAfterRecovery)
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(proveBaseAncestorOfSuccessorHead)
      .then(fixAutomaticSuccessorSession)
      .expect(and {
        state.successorExpectedHead == INITIAL_HEAD + 2,
        state.successorSessionCount == 1,
        state.authorizationCount == 1,
        state.catchUpCasCount == MAX_BASELINE_READS_PER_AUTHORIZATION,
        state.catchUpCasCount <= MAX_CATCH_UP_CAS,
        proofStateIsBounded,
        state.store == ReopenedSQLiteJournal,
        successorKeepsAcceptedResultLineage,
        successorUsesLatestBaselineRoundUnderOriginalAuthorization,
        oneGitObservationOrCompareAndSetPerActivation,
      })
  }

  // Recovery must perform at most one fresh baseline round even if the
  // provider head stayed at H2; the refresh trigger comes from the stable
  // entry boundary, not from an already observed H3 value.
  run recoveredReadyBaselineRefreshesSameHeadOnceTest = {
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
      .then(crashCoordinator)
      .then(restartCoordinator)
      .then(rereadAuthorityFacts)
      .then(recordRemoteBaselineReadIntent)
      .then(outsideTargetAlreadyMatchesRemote)
      .then(observeAlreadyCurrentLocalBaseline)
      .expect(and {
        state.baselineReadRemoteHead == INITIAL_HEAD + 1,
        state.baselineReadIntentCount == 2,
        state.refreshRoundCount == 1,
        state.authorizationCount == 1,
        successorRefreshRoundsAreBounded,
      })
      .then(beginNextActivation)
      .then(rereadAuthorityFacts)
      .then(proveBaseAncestorOfSuccessorHead)
      .then(fixAutomaticSuccessorSession)
      .expect(and {
        state.successorExpectedHead == INITIAL_HEAD + 1,
        state.successorSessionCount == 1,
        state.authorizationCount == 1,
        successorUsesLatestBaselineRoundUnderOriginalAuthorization,
        successorRefreshRoundsAreBounded,
      })
  }
  run repeatedOperatorRetryOfAutomaticS2RetainsGenerationTest = {
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
      .then(applyOperatorRetryToAutomaticSuccessor)
      .then(observeFreshLineageAfterAutomaticSuccessorRetry)
      .then(startAuthorizedAutomaticSuccessorRetry)
      .expect(and {
        state.phase == AutomaticSuccessorRetryInFlight,
        state.successorSession == INITIAL_SESSION + 1,
        state.successorRunOrdinal == 2,
        state.successorRetryRunOrdinal == 2,
        state.successorRetryRunStartCount == 1,
        state.successorRetryInvocationCount == 1,
        state.successorResultPosition < state.successorQuarantinePosition,
        state.successorQuarantinePosition < state.successorRetryDirectionPosition,
        state.successorRetryDirectionPosition < state.successorRetryLineagePosition,
        state.successorRetryLineagePosition < state.successorRetryRunStartPosition,
        automaticSuccessorRetryRequiresExactOperatorChronology,
        exactTaskAndResponsibilityAreRetained,
        automaticSuccessorBoundsAreFinite,
      })
      .then(recordAutomaticSuccessorNotPrepared).then(quarantineAutomaticSuccessorNotPrepared)
      .then(applyOperatorRetryToAutomaticSuccessor).then(observeFreshLineageAfterAutomaticSuccessorRetry).then(startAuthorizedAutomaticSuccessorRetry)
      .then(recordAutomaticSuccessorNotPrepared).then(quarantineAutomaticSuccessorNotPrepared)
      .then(applyOperatorRetryToAutomaticSuccessor).then(observeFreshLineageAfterAutomaticSuccessorRetry).then(startAuthorizedAutomaticSuccessorRetry)
      .expect(and { state.successorRunOrdinal == 4, state.successorSession == INITIAL_SESSION + 1,
        automaticSuccessorRetryRequiresExactOperatorChronology, exactTaskAndResponsibilityAreRetained })

  }
}
