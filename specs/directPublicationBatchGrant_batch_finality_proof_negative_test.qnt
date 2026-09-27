// Mutation controls for the accepted S4/S5/S7/S8 grant boundary. Each mutant
// corrupts durable chronology or performs a forbidden effect; invariants stay
// independent of the positive action guards.
module directPublicationBatchGrantBatchFinalityProofNegativeTest {
  import directPublicationBatchGrantBatchFinalityProof.* from "./directPublicationBatchGrant_proof"

  action mutateSessionStartWithoutLifecycleGuard: bool = all {
    state.phase == GrantBatchReady,
    state.lifecycle == Paused or state.lifecycle == ExitCutoff,
    state.hostLive,
    state.grantAcknowledged,
    state.grantOccurrence == state.exhaustionOccurrence,
    state.grantedSessionsUsed < MAX_BATCH_SESSIONS,
    state.selectedPostGrantPath == NoPostGrantPath or state.selectedPostGrantPath == SameCommitSuccessor,
    state.postGrantPath == state.selectedPostGrantPath,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: GrantSessionOpen,
      grantedSessionsUsed: state.grantedSessionsUsed + 1,
      grantSessionEvents: state.grantSessionEvents + 1,
      totalSessionOrdinal: state.totalSessionOrdinal + 1,
      currentSessionOrdinal: state.totalSessionOrdinal + 1,
      postGrantPath: SameCommitSuccessor,
      selectedPostGrantPath: SameCommitSuccessor,
    }),
  }

  action mutateIntentCommitWithoutLifecycleGuard: bool = all {
    state.phase == GrantSessionOpen,
    state.lifecycle == Paused or state.lifecycle == ExitCutoff,
    state.hostLive,
    state.grantAcknowledged,
    state.grantedPushesUsed < MAX_BATCH_PUSH_INTENTS,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: GrantIntentPending,
      grantedPushesUsed: state.grantedPushesUsed + 1,
      grantPushEvents: state.grantPushEvents + 1,
      totalPushIntentOrdinal: state.totalPushIntentOrdinal + 1,
      currentPushOrdinal: state.totalPushIntentOrdinal + 1,
      pushObservation: UnresolvedPushIntent,
    }),
  }

  action mutateReplayBeforeAcknowledgementWithoutPhaseAdvance: bool = all {
    state.phase == GrantRecorded,
    state.grantCount > 0,
    not(state.grantAcknowledged),
    state.sameRequestReplays == 0,
    state.requestId == state.grantRequestId,
    state.grantOccurrence == state.exhaustionOccurrence,
    state' = {
      ...state,
      grantAcknowledged: true,
      sameRequestReplays: state.sameRequestReplays + 1,
      lastReplayRequestId: state.requestId,
      lastReplayReceiptId: state.grantReceiptId,
      lastReplayGrantRequestId: state.grantRequestId,
      lastReplayOccurrence: state.grantOccurrence,
    },
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

  action mutateSettlementWithoutCleanupOrCompletion: bool = all {
    state.grantCount > 0,
    not(state.taskCompleted),
    not(state.cleanupComplete),
    not(state.responsibilitySettled),
    state' = { ...state, responsibilitySettled: true },
  }

  action mutateTerminateBeforeResponsibilitySettled: bool = all {
    not(state.responsibilitySettled),
    not(state.runTerminated),
    state' = { ...state, runTerminated: true },
  }

  // invariant: pauseDefersQForwardEffects
  // mutant: mutateSessionStartWithoutLifecycleGuard
  run detectsGuardRemovedSessionStartDuringPauseTest = {
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
      .then(mutateSessionStartWithoutLifecycleGuard)
      .expect(not(pauseDefersQForwardEffects))
  }

  run detectsGuardRemovedIntentCommitDuringPauseTest = {
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
      .then(applyPause)
      .then(mutateIntentCommitWithoutLifecycleGuard)
      .expect(not(pauseDefersQForwardEffects))
  }

  // invariant: exitCutoffStopsQForwardEffects
  // mutant: mutateSessionStartWithoutLifecycleGuard
  run detectsGuardRemovedSessionStartAfterExitTest = {
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
      .then(mutateSessionStartWithoutLifecycleGuard)
      .expect(not(exitCutoffStopsQForwardEffects))
  }

  run detectsGuardRemovedIntentCommitAfterExitTest = {
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
      .then(applyExitCutoff)
      .then(mutateIntentCommitWithoutLifecycleGuard)
      .expect(not(exitCutoffStopsQForwardEffects))
  }

  // invariant: grantAcknowledgementMatchesProgress
  // mutant: mutateReplayBeforeAcknowledgementWithoutPhaseAdvance
  run detectsReplayBeforeAcknowledgementMustAdvanceGrantPhaseTest = {
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
      .then(mutateReplayBeforeAcknowledgementWithoutPhaseAdvance)
      .expect(and {
        state.phase == GrantRecorded,
        state.grantAcknowledged,
        not(grantAcknowledgementMatchesProgress),
      })
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

  // invariant: oneGrantPerExactOccurrence
  // mutant: mintDuplicateGrantForSameOccurrence
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

  // invariant: grantIsBoundToRetainedExhaustion
  // mutant: mintGrantFromUnrelatedQuarantine
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

  // invariant: cumulativeOrdinalsAreNotReset
  // mutant: resetCumulativeOrdinals
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

  // invariant: taskBeginIsRetainedOnce
  // mutant: rerunTaskFromGrant
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

  // invariant: grantDoesNotProvePublication
  // mutant: useGrantAsPublicationProof
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

  // invariant: postGrantPathMatchesSelectedPath
  // mutant: mutateStartedSuccessorIntoReusableCandidate
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

  // invariant: postGrantEffectsMatchSelectedPath
  // mutant: mutateReusableCandidateIntoSuccessorSession
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

  // invariant: exactSuccessorParentsAreRetained
  // mutant: discardRecordedSuccessorParentEvidence
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

  // invariant: successorCandidateIsBoundToItsSession
  // mutant: assignSuccessorCandidateToFutureSession
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

  // invariant: batchBoundsHold
  // mutant: exceedGrantedBatchBound
  run detectsGrantedBatchBoundExceededTest = {
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
      .then(exceedGrantedBatchBound)
      .expect(not(batchBoundsHold))
  }

  // invariant: completionRequiresProofPromotionAndCurrentPermission
  // mutant: useGrantAsPublicationProof
  run detectsCompletionWithoutProofPromotionOrPermissionTest = {
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
      .expect(not(completionRequiresProofPromotionAndCurrentPermission))
  }

  // invariant: settlementRequiresExactCompletionAndCleanup
  // mutant: mutateSettlementWithoutCleanupOrCompletion
  run detectsSettlementWithoutExactCompletionOrCleanupTest = {
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
      .then(mutateSettlementWithoutCleanupOrCompletion)
      .expect(not(settlementRequiresExactCompletionAndCleanup))
  }

  // invariant: runTerminationRequiresSettledResponsibility
  // mutant: mutateTerminateBeforeResponsibilitySettled
  run detectsRunTerminationBeforeResponsibilitySettledTest = {
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
      .then(mutateTerminateBeforeResponsibilitySettled)
      .expect(not(runTerminationRequiresSettledResponsibility))
  }
}
