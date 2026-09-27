// Mutation controls for the accepted S4/S5/S7/S8 grant boundary. Each mutant
// corrupts durable chronology or performs a forbidden effect; invariants stay
// independent of the positive action guards.
module directPublicationBatchGrantNegativeTest {
  import directPublicationBatchGrant.* from "./directPublicationBatchGrant"

  action mutateQForwardEffectDuringPause: bool = all {
    state.lifecycle == Paused,
    state.grantCount == 1,
    state' = { ...state, pausedForwardEffects: state.pausedForwardEffects + 1 },
  }

  action mutateQForwardEffectAfterExit: bool = all {
    state.lifecycle == ExitCutoff,
    state' = { ...state, exitForwardEffects: state.exitForwardEffects + 1 },
  }

  action mintDuplicateGrantForSameOccurrence: bool = all {
    state.grantCount == 1,
    state.grantsForOccurrence == 1,
    state' = {
      ...state,
      grantCount: state.grantCount + 1,
      grantsForOccurrence: state.grantsForOccurrence + 1,
      grantRequestId: SECOND_REQUEST_ID,
      grantReceiptId: SECOND_GRANT_RECEIPT,
    },
  }

  action mintGrantFromUnrelatedQuarantine: bool = all {
    state.grantCount == 1,
    state' = {
      ...state,
      grantDirection: IntegrationQuarantine,
      grantResponsibilityId: RESPONSIBILITY_B,
    },
  }

  action resetCumulativeOrdinals: bool = all {
    state.totalSessionOrdinal > 0,
    state.totalPushIntentOrdinal > 0,
    state' = { ...state, totalSessionOrdinal: 0, totalPushIntentOrdinal: 0 },
  }

  action exceedGrantedBatchBound: bool = all {
    state.grantCount > 0,
    state' = {
      ...state,
      grantedSessionsUsed: MAX_BATCH_SESSIONS + 1,
      grantedPushesUsed: MAX_BATCH_PUSH_INTENTS + 1,
    },
  }

  action rerunTaskFromGrant: bool = all {
    state.grantCount > 0,
    state' = { ...state, taskBeginCount: state.taskBeginCount + 1 },
  }

  action useGrantAsPublicationProof: bool = all {
    state.grantCount > 0,
    not(state.exactRemoteProof),
    state' = {
      ...state,
      exactRemoteProof: true,
      proofFromGrant: true,
      taskCompleted: true,
    },
  }

  action mutateStartedSuccessorIntoAlreadyPublishedOutcome: bool = all {
    state.phase == GrantBatchReady,
    state.postGrantPath == SameCommitSuccessor,
    state.grantedSessionsUsed > 0,
    state' = {
      ...state,
      phase: ExactPublicationProofRecorded,
      exactRemoteProof: true,
      postGrantPath: AlreadyPublished,
    },
  }

  action mutateStartedSuccessorIntoReusableCandidate: bool = all {
    state.phase == GrantBatchReady,
    state.selectedPostGrantPath == SameCommitSuccessor,
    state.grantedSessionsUsed > 0,
    state' = { ...state, postGrantPath: ReusableCandidate },
  }

  action mutateReusableCandidateIntoSuccessorSession: bool = all {
    state.phase == GrantBatchReady,
    state.selectedPostGrantPath == ReusableCandidate,
    state.grantedSessionsUsed == 0,
    state' = {
      ...state,
      phase: GrantSessionOpen,
      grantedSessionsUsed: state.grantedSessionsUsed + 1,
      grantSessionEvents: state.grantSessionEvents + 1,
      totalSessionOrdinal: state.totalSessionOrdinal + 1,
      currentSessionOrdinal: state.totalSessionOrdinal + 1,
      postGrantPath: SameCommitSuccessor,
      successorParent: BASE_CANDIDATE,
      successorSecondParent: 0,
    },
  }

  action discardRecordedSuccessorParentEvidence: bool = all {
    state.successorCandidateRecorded,
    state.successorParent == BASE_CANDIDATE,
    state.successorSecondParent == ACCEPTED_TASK_COMMIT,
    state' = {
      ...state,
      successorSecondParent: 0,
      successorCandidateSessionOrdinal: 0,
    },
  }

  action assignSuccessorCandidateToFutureSession: bool = all {
    state.successorCandidateRecorded,
    state.successorCandidateSessionOrdinal > 0,
    state' = {
      ...state,
      successorCandidateSessionOrdinal: state.currentSessionOrdinal + 1,
    },
  }

  run detectsPausedBatchStartAndExitCutoffViolationsTest = {
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
      .then(mutateQForwardEffectDuringPause)
      .expect(not(pauseDefersQForwardEffects))
      .then(applyUnpause)
      .then(applyExitCutoff)
      .then(mutateQForwardEffectAfterExit)
      .expect(not(exitCutoffStopsQForwardEffects))
  }

  run detectsDuplicateOrMismatchedGrantMintingSecondBatchTest = {
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
      .then(mintDuplicateGrantForSameOccurrence)
      .expect(not(oneGrantPerExactOccurrence))
  }

  run detectsDifferentRequestIdMintingSecondGrantForSameExhaustionTest = {
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
      .then(mintDuplicateGrantForSameOccurrence)
      .expect(and {
        state.grantRequestId == SECOND_REQUEST_ID,
        not(oneGrantPerExactOccurrence),
      })
  }

  run detectsUnrelatedQuarantineFullRerunGrantTest = {
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
      .then(mintGrantFromUnrelatedQuarantine)
      .expect(not(grantIsBoundToRetainedExhaustion))
  }

  run detectsBudgetResetAndNonmonotonicOrdinalTest = {
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
      .expect(cumulativeOrdinalsAreNotReset and batchBoundsHold)
      .then(resetCumulativeOrdinals)
      .expect(not(cumulativeOrdinalsAreNotReset))
      .then(exceedGrantedBatchBound)
      .expect(not(batchBoundsHold))
  }

  run detectsGrantStartingTaskExecutionTest = {
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
      .then(rerunTaskFromGrant)
      .expect(not(taskBeginIsRetainedOnce))
  }

  run detectsGrantReceiptUsedAsPublicationProofTest = {
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
      .then(useGrantAsPublicationProof)
      .expect(and {
        not(grantDoesNotProvePublication),
        not(completionRequiresProofPromotionAndCurrentPermission),
      })
  }

  run detectsAlreadyPublishedOutcomeAfterStartedSuccessorSessionTest = {
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
      .then(mutateStartedSuccessorIntoAlreadyPublishedOutcome)
      .expect(and {
        state.postGrantPath == AlreadyPublished,
        state.grantedSessionsUsed == 1,
        not(postGrantPathMatchesSelectedPath),
      })
  }

  run detectsSameCommitSuccessorRelabeledAsReusableCandidateTest = {
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
      .then(mutateStartedSuccessorIntoReusableCandidate)
      .expect(and {
        state.postGrantPath == ReusableCandidate,
        state.selectedPostGrantPath == SameCommitSuccessor,
        not(postGrantPathMatchesSelectedPath),
        postGrantEffectsMatchSelectedPath,
      })
  }

  run detectsReusableCandidateRelabeledAsSameCommitSuccessorTest = {
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
      .then(mutateReusableCandidateIntoSuccessorSession)
      .expect(and {
        state.postGrantPath == SameCommitSuccessor,
        state.selectedPostGrantPath == ReusableCandidate,
        not(postGrantPathMatchesSelectedPath),
        not(postGrantEffectsMatchSelectedPath),
      })
  }

  run detectsDiscardedRecordedSuccessorParentEvidenceTest = {
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
      .then(discardRecordedSuccessorParentEvidence)
      .expect(and {
        not(exactSuccessorParentsAreRetained),
        not(successorCandidateIsBoundToItsSession),
      })
  }

  run detectsSuccessorCandidateClaimedForFutureSessionTest = {
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
      .then(assignSuccessorCandidateToFutureSession)
      .expect(not(successorCandidateIsBoundToItsSession))
  }
}
