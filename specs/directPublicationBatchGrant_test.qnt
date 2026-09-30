module directPublicationBatchGrantTest {
  import directPublicationBatchGrant.* from "./directPublicationBatchGrant"

  run recordsExactPausedGrantAndDefersOneBoundedBatchUntilUnpauseTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .expect(exactExhaustionReached and state.exhaustionOccurrence == 1)
      .then(applyPause)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .expect(and {
        state.lifecycle == Paused,
        state.grantCount == 1,
        state.grantOccurrence == 1,
        state.grantRunId == RUN_R,
        state.grantResponsibilityId == RESPONSIBILITY_Q,
        state.grantDirection == FullRerun,
        state.grantReceiptId == FIRST_GRANT_RECEIPT,
        state.grantedSessionsUsed == 0,
        state.grantedPushesUsed == 0,
        state.pausedForwardEffects == 0,
        state.qForwardEffectOrdinal > 0,
        pauseDefersQForwardEffects,
      })
      .then(progressUnrelatedResponsibility)
      .expect(unrelatedProgressReached and state.pausedForwardEffects == 0)
      .then(applyUnpause)
      .then(startGrantedSuccessorSession)
      .then(recordGrantedPushIntent)
      .then(resolveGrantedIntentWithoutProof)
      .expect(and {
        state.lifecycle == Running,
        state.grantedSessionsUsed == 1,
        state.grantedPushesUsed == 1,
        state.totalSessionOrdinal == 4,
        state.totalPushIntentOrdinal == 4,
        state.taskBeginCount == 1,
        grantIsBoundToRetainedExhaustion,
        cumulativeOrdinalsAreNotReset,
      })
  }

  run crashBeforeAppendRetriesExactOccurrenceWithoutGrantTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(crashBeforeGrantAppend)
      .expect(state.grantCount == 0 and state.exhaustionOccurrence == 1)
      .then(restartHost)
      .then(submitExactFullRerunRequest(SECOND_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .expect(and {
        state.grantCount == 1,
        state.grantOccurrence == 1,
        state.grantRequestId == SECOND_REQUEST_ID,
        state.exhaustionOccurrence == 1,
      })
  }

  run committedGrantRecoversAfterLostAcknowledgementWithoutSecondBatchTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(crashAfterGrantAppendBeforeAck)
      .then(restartHost)
      .then(recoverCommittedGrant)
      .expect(and {
        state.grantCount == 1,
        state.grantOccurrence == 1,
        state.grantRequestId == FIRST_REQUEST_ID,
        state.grantReceiptId == FIRST_GRANT_RECEIPT,
        state.grantAcknowledged,
        state.grantedSessionsUsed == 0,
        state.grantedPushesUsed == 0,
        grantIsBoundToRetainedExhaustion,
      })
  }

  run crashAfterSessionFixationResumesSameSessionWithoutRepetitionTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .then(startGrantedSuccessorSession)
      .expect(and {
        state.phase == GrantSessionOpen,
        state.hostLive,
        state.currentSessionOrdinal == 4,
        state.grantedSessionsUsed == 1,
        state.grantSessionEvents == 1,
      })
      .then(crashAfterGrantSessionFixation)
      .expect(and {
        not(state.hostLive),
        state.currentSessionOrdinal == 4,
        state.grantedSessionsUsed == 1,
        state.grantSessionEvents == 1,
      })
      .then(restartHost)
      .expect(and {
        state.hostLive,
        state.activation == 2,
        state.phase == GrantSessionOpen,
        state.currentSessionOrdinal == 4,
        state.grantedSessionsUsed == 1,
        state.grantSessionEvents == 1,
      })
      .then(recordGrantedPushIntent)
      .expect(and {
        state.phase == GrantIntentPending,
        state.currentSessionOrdinal == 4,
        state.grantedSessionsUsed == 1,
        state.grantedPushesUsed == 1,
        state.grantSessionEvents == 1,
        state.grantPushEvents == 1,
      })
  }

  run crashAfterCommittedGrantIntentReconcilesOriginalOrdinalTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .then(startGrantedSuccessorSession)
      .then(recordGrantedPushIntent)
      .expect(and {
        state.phase == GrantIntentPending,
        state.pushObservation == UnresolvedPushIntent,
        state.currentPushOrdinal == 4,
        state.grantedPushesUsed == 1,
        state.grantPushEvents == 1,
      })
      .then(crashAfterCommittedGrantIntent)
      .expect(and {
        not(state.hostLive),
        state.phase == GrantIntentPending,
        state.currentPushOrdinal == 4,
        state.grantedPushesUsed == 1,
        state.grantPushEvents == 1,
      })
      .then(restartHost)
      .then(resolveGrantedIntentWithoutProof)
      .expect(and {
        state.hostLive,
        state.activation == 2,
        state.phase == GrantBatchReady,
        state.pushObservation == Unapplied,
        state.currentPushOrdinal == 4,
        state.grantedPushesUsed == 1,
        state.grantPushEvents == 1,
        state.grantSessionEvents == 1,
        state.qForwardEffectOrdinal > 0,
        cumulativeOrdinalsAreNotReset,
        batchBoundsHold,
      })
  }

  run exactGrantReplayBeforeAcknowledgementEnablesOneBatchTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .expect(state.phase == GrantRecorded and not(state.grantAcknowledged))
      .then(replaySameGrantRequest)
      .expect(and {
        state.phase == GrantBatchReady,
        state.grantAcknowledged,
        state.grantCount == 1,
        state.grantReceiptId == FIRST_GRANT_RECEIPT,
        state.sameRequestReplays == 1,
        grantAcknowledgementMatchesProgress,
        grantReceiptIsVisibleBeforeForwardEffects,
      })
      .then(startGrantedSuccessorSession)
      .expect(and {
        state.grantedSessionsUsed == 1,
        state.grantSessionEvents == 1,
        state.qForwardEffectOrdinal > 0,
        grantAcknowledgementMatchesProgress,
      })
  }

  run sameRequestReplayIsExactAndDifferentRequestCannotMintAnotherGrantTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .then(replaySameGrantRequest)
      .then(replayDifferentRequestForSameOccurrence(SECOND_REQUEST_ID))
      .expect(and {
        state.grantCount == 1,
        state.grantsForOccurrence == 1,
        state.grantRequestId == FIRST_REQUEST_ID,
        state.grantReceiptId == FIRST_GRANT_RECEIPT,
        state.sameRequestReplays == 1,
        state.differentRequestReplays == 1,
        grantIsBoundToRetainedExhaustion,
        oneGrantPerExactOccurrence,
      })
  }

  run nextExactExhaustionRequiresFreshGrantWithoutResettingOrdinalsTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .then(startGrantedSuccessorSession)
      .then(recordGrantedPushIntent)
      .then(resolveGrantedIntentWithoutProof)
      .then(startGrantedSuccessorSession)
      .then(recordGrantedPushIntent)
      .then(resolveGrantedIntentWithoutProof)
      .then(startGrantedSuccessorSession)
      .then(recordGrantedPushIntent)
      .then(resolveGrantedIntentWithoutProof)
      .then(retainNextPublicationExhaustion)
      .expect(and {
        state.exhaustionOccurrence == 2,
        state.grantCount == 1,
        state.grantOccurrence == 1,
        state.grantedSessionsUsed == MAX_BATCH_SESSIONS,
        state.grantedPushesUsed == MAX_BATCH_PUSH_INTENTS,
        state.postGrantPath == SameCommitSuccessor,
        state.selectedPostGrantPath == SameCommitSuccessor,
        state.totalSessionOrdinal == 6,
        state.totalPushIntentOrdinal == 6,
        cumulativeOrdinalsAreNotReset,
      })
      .then(submitExactFullRerunRequest(SECOND_REQUEST_ID))
      .then(appendExactExhaustionGrant(SECOND_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .expect(and {
        secondExhaustionReached,
        secondGrantReached,
        state.grantCount == 2,
        state.grantsForOccurrence == 1,
        state.totalSessionOrdinal == 6,
        state.totalPushIntentOrdinal == 6,
        state.grantedSessionsUsed == 0,
        state.grantedPushesUsed == 0,
        state.postGrantPath == NoPostGrantPath,
        state.selectedPostGrantPath == NoPostGrantPath,
        cumulativeOrdinalsAreNotReset,
      })
      .then(reconcileAlreadyPublishedCandidate)
      .expect(and {
        state.postGrantPath == AlreadyPublished,
        state.selectedPostGrantPath == AlreadyPublished,
        postGrantPathMatchesSelectedPath,
        postGrantEffectsMatchSelectedPath,
      })
  }

  run exactPublicationProofAndFinalityRequireFreshBoundariesTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .expect(not(state.exactRemoteProof) and not(state.taskCompleted) and grantDoesNotProvePublication)
      .then(reconcileAlreadyPublishedCandidate)
      .then(recordLocalPromotion)
      .then(refreshTaskPermission)
      .then(completeTaskFromExactProof)
      .then(recordExactCleanup)
      .then(settleResponsibility)
      .then(terminateRunAfterResponsibilitySettlement)
      .expect(and {
        settledReached,
        state.runTerminated,
        state.postGrantPath == AlreadyPublished,
        state.selectedPostGrantPath == AlreadyPublished,
        postGrantPathMatchesSelectedPath,
        settlementRequiresExactCompletionAndCleanup,
        completionRequiresProofPromotionAndCurrentPermission,
        grantDoesNotProvePublication,
    })
  }

  run alreadyPublishedReconciliationCannotReplaceStartedSuccessorSessionTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .then(startGrantedSuccessorSession)
      .then(closeGrantSessionWithoutIntent)
      .expect(and {
        state.postGrantPath == SameCommitSuccessor,
        state.selectedPostGrantPath == SameCommitSuccessor,
        state.grantedSessionsUsed == 1,
        not(alreadyPublishedReconciliationAllowed),
        not(reusableCandidatePushIntentAllowed),
        postGrantEffectsMatchSelectedPath,
        postGrantPathMatchesSelectedPath,
      })
  }

  run sameCommitSuccessorUsesOneTaskAttemptAndExactParentsTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .then(startGrantedSuccessorSession)
      .then(recordSameCommitSuccessorCandidate)
      .expect(and {
        state.successorCandidateRecorded,
        state.successorCandidateSessions == Set(state.currentSessionOrdinal),
        state.successorParent == BASE_CANDIDATE,
        state.successorSecondParent == ACCEPTED_TASK_COMMIT,
        state.successorCandidateSessionOrdinal == state.currentSessionOrdinal,
        state.selectedPostGrantPath == SameCommitSuccessor,
        state.taskBeginCount == 1,
        exactSuccessorParentsAreRetained,
        successorCandidateIsBoundToItsSession,
        taskBeginIsRetainedOnce,
      })
  }

  run laterSuccessorSessionRetainsPreviouslyRecordedExactParentsTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .then(startGrantedSuccessorSession)
      .then(recordSameCommitSuccessorCandidate)
      .then(closeGrantSessionWithoutIntent)
      .then(startGrantedSuccessorSession)
      .expect(and {
        state.successorCandidateRecorded,
        state.successorCandidateSessions.size() == 1,
        state.successorParent == BASE_CANDIDATE,
        state.successorSecondParent == ACCEPTED_TASK_COMMIT,
        state.successorCandidateSessionOrdinal < state.currentSessionOrdinal,
        state.grantedSessionsUsed == 2,
        state.taskBeginCount == 1,
        exactSuccessorParentsAreRetained,
        successorCandidateIsBoundToItsSession,
      })
      .then(recordSameCommitSuccessorCandidate)
      .expect(and {
        state.successorCandidateSessions.size() == 2,
        state.successorCandidateSessionOrdinal == state.currentSessionOrdinal,
        successorCandidateIsBoundToItsSession,
      })
      .then(closeGrantSessionWithoutIntent)
      .then(startGrantedSuccessorSession)
      .expect(and {
        state.successorCandidateSessions.size() == 2,
        state.successorCandidateSessionOrdinal < state.currentSessionOrdinal,
        state.grantedSessionsUsed == 3,
        exactSuccessorParentsAreRetained,
        successorCandidateIsBoundToItsSession,
      })
  }

  run blockedPostUnpauseConstraintRetainsPreciseWaitTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(applyPause)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .then(applyUnpause)
      .then(retainBlockedConstraint)
      .expect(and {
        blockedWaitReached,
        state.postGrantPath == BlockedConstraint,
        state.selectedPostGrantPath == BlockedConstraint,
        state.grantCount == 1,
        state.grantedSessionsUsed == 0,
        state.grantedPushesUsed == 0,
        not(state.exactRemoteProof),
      })
  }

  run blockedWaitOverlaysWithoutErasingStartedSuccessorPathTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .then(startGrantedSuccessorSession)
      .then(closeGrantSessionWithoutIntent)
      .then(retainBlockedConstraint)
      .expect(and {
        state.phase == GrantWaiting,
        state.postGrantPath == BlockedConstraint,
        state.selectedPostGrantPath == SameCommitSuccessor,
        state.grantedSessionsUsed == 1,
        postGrantPathMatchesSelectedPath,
        postGrantEffectsMatchSelectedPath,
      })
  }

  run thirdPushIntentExhaustionCanBeGrantedWithoutAnotherSessionTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(retainInitialPublicationExhaustion)
      .expect(and {
        state.initialSessions == 1,
        state.initialPushIntents == MAX_BATCH_PUSH_INTENTS,
        state.exhaustionCause == ThirdPushIntentExhaustion,
        exactExhaustionReached,
      })
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .expect(and {
        state.grantCount == 1,
        state.grantExhaustionCause == ThirdPushIntentExhaustion,
        state.grantedSessionsUsed == 0,
        grantIsBoundToRetainedExhaustion,
      })
  }

  run thirdSessionExhaustionRetainsExactCauseWithoutPushIntentTest = {
    init
      .then(startInitialSession)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .expect(and {
        state.initialSessions == MAX_BATCH_SESSIONS,
        state.initialPushIntents == 0,
        state.exhaustionCause == ThirdSessionExhaustion,
        exactExhaustionReached,
      })
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .expect(state.grantExhaustionCause == ThirdSessionExhaustion and grantIsBoundToRetainedExhaustion)
  }

  run safelyReusableCandidateUsesPushWithoutNewSessionTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .then(recordReusableCandidatePushIntent)
      .then(observeExactPushPublicationProof)
      .expect(and {
        state.postGrantPath == ReusableCandidate,
        state.selectedPostGrantPath == ReusableCandidate,
        state.grantedSessionsUsed == 0,
        state.grantedPushesUsed == 1,
        state.exactRemoteProof,
        postGrantPathMatchesSelectedPath,
        postGrantEffectsMatchSelectedPath,
      })
  }

  run reusableCandidatePathDoesNotStartAThirdSessionAfterAnUnappliedPushTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .then(recordReusableCandidatePushIntent)
      .then(resolveGrantedIntentWithoutProof)
      .expect(and {
        state.postGrantPath == ReusableCandidate,
        state.selectedPostGrantPath == ReusableCandidate,
        state.grantedSessionsUsed == 0,
        not(grantedSuccessorSessionAllowed),
        postGrantPathMatchesSelectedPath,
        postGrantEffectsMatchSelectedPath,
      })
  }

  run exitBeforeAppendRejectsGrantAndExitAfterCommitRetainsReceiptTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(applyExitCutoff)
      .then(rejectPendingGrantAtExitCutoff)
      .expect(and {
        state.lifecycle == ExitCutoff,
        state.phase == Exhausted,
        state.grantCount == 0,
        state.requestPending == false,
        state.exitForwardEffects == 0,
      })
  }

  run committedGrantSurvivesExitWithoutStartingBatchTest = {
    init
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(startInitialSession)
      .then(recordInitialPushIntent)
      .then(resolveInitialIntentWithoutProof)
      .then(closeInitialSession)
      .then(retainInitialPublicationExhaustion)
      .then(submitExactFullRerunRequest(FIRST_REQUEST_ID))
      .then(appendExactExhaustionGrant(FIRST_GRANT_RECEIPT))
      .then(acknowledgeGrant)
      .then(applyExitCutoff)
      .expect(and {
        state.lifecycle == ExitCutoff,
        state.grantCount == 1,
        state.grantOccurrence == 1,
        state.grantedSessionsUsed == 0,
        state.grantedPushesUsed == 0,
        exitCutoffStopsQForwardEffects,
      })
  }
}
