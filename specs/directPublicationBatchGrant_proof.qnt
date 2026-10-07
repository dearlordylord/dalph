// Transition-restricted projection for directPublicationBatchGrantGrantControlProof.
// State, action bodies, and invariant declarations are copied from the canonical model.
// Only the generated step transition set is restricted by the reviewed profile contract.
// #386 models a bounded Operator grant for one exact, retained publication
// exhaustion. Run/journal identity remains one authority; Git and tracker
// outcomes enter only as fresh boundary observations. Counters below are
// projection instrumentation for the finite trace, not a new runtime ledger.
module directPublicationBatchGrantGrantControlProof {
  type Phase =
    | InitialBatchReady
    | InitialSessionOpen
    | InitialIntentPending
    | Exhausted
    | GrantRequestPending
    | GrantRecorded
    | GrantBatchReady
    | GrantSessionOpen
    | GrantIntentPending
    | GrantBatchExhausted
    | GrantWaiting
    | ExactPublicationProofRecorded
    | LocalPromotionRecorded
    | FreshTaskPermissionRecorded
    | TaskCompletionRecorded
    | ResponsibilitySettled

  type Lifecycle = Running | Paused | ExitCutoff
  type ExhaustionCause = NoExhaustion | ThirdSessionExhaustion | ThirdPushIntentExhaustion | QuarantineExhaustion
  type OperatorDirection = NoDirection | FullRerun | IntegrationQuarantine
  type PushObservation = NoPushObservation | UnresolvedPushIntent | Unapplied | ExactRemoteProof
  type PostGrantPath = NoPostGrantPath | AlreadyPublished | ReusableCandidate | SameCommitSuccessor | BlockedConstraint

  type State = {
    phase: Phase,
    lifecycle: Lifecycle,
    hostLive: bool,
    activation: int,
    requestPending: bool,
    requestId: int,
    requestDirection: OperatorDirection,
    requestOccurrence: int,
    exhaustionOccurrence: int,
    exhaustionCause: ExhaustionCause,
    initialSessions: int,
    initialPushIntents: int,
    initialSessionOpen: bool,
    grantedSessionsUsed: int,
    grantedPushesUsed: int,
    grantCount: int,
    grantsForOccurrence: int,
    grantOccurrence: int,
    grantRunId: int,
    grantResponsibilityId: int,
    grantRequestId: int,
    grantReceiptId: int,
    grantDirection: OperatorDirection,
    grantExhaustionCause: ExhaustionCause,
    grantAcknowledged: bool,
    sameRequestReplays: int,
    lastReplayRequestId: int,
    lastReplayReceiptId: int,
    lastReplayGrantRequestId: int,
    lastReplayOccurrence: int,
    differentRequestReplays: int,
    grantSessionEvents: int,
    grantPushEvents: int,
    totalSessionOrdinal: int,
    totalPushIntentOrdinal: int,
    currentSessionOrdinal: int,
    currentPushOrdinal: int,
    pushObservation: PushObservation,
    postGrantPath: PostGrantPath,
    selectedPostGrantPath: PostGrantPath,
    exactRemoteProof: bool,
    proofFromGrant: bool,
    localPromotion: bool,
    freshTaskPermission: bool,
    taskCompleted: bool,
    cleanupComplete: bool,
    responsibilitySettled: bool,
    runTerminated: bool,
    taskBeginCount: int,
    successorParent: int,
    successorSecondParent: int,
    successorCandidateRecorded: bool,
    successorCandidateSessions: Set[int],
    successorCandidateSessionOrdinal: int,
    pausedForwardEffects: int,
    exitForwardEffects: int,
    qForwardEffectOrdinal: int,
    unrelatedProgress: int,
  }

  var state: State

  pure val RUN_R = 1
  pure val RESPONSIBILITY_Q = 10
  pure val RESPONSIBILITY_B = 11
  pure val BASE_CANDIDATE = 20
  pure val ACCEPTED_TASK_COMMIT = 30
  pure val MAX_BATCH_SESSIONS = 3
  pure val MAX_BATCH_PUSH_INTENTS = 3
  pure val MAX_EXHAUSTION_OCCURRENCES = 2
  pure val MAX_ACTIVATIONS = 3
  pure val FIRST_REQUEST_ID = 100
  pure val SECOND_REQUEST_ID = 101
  pure val FIRST_GRANT_RECEIPT = 200
  pure val SECOND_GRANT_RECEIPT = 201

  // Every modeled Q-owned forward boundary records its ordinal and notes
  // whether it crossed while Pause or Exit was active. Grant receipt append,
  // replay, and recovery are control-plane operations and do not use this.
  pure def recordQForwardEffect(before: State, after: State): State = {
    ...after,
    pausedForwardEffects: before.pausedForwardEffects + (if (before.lifecycle == Paused) 1 else 0),
    exitForwardEffects: before.exitForwardEffects + (if (before.lifecycle == ExitCutoff) 1 else 0),
    qForwardEffectOrdinal: before.qForwardEffectOrdinal + 1,
  }

  // These properties restate accepted outcomes from retained facts. They are
  // not transition guards, so mutant transitions can violate them in tests.
  val grantIsBoundToRetainedExhaustion: bool =
    state.grantCount == 0
      or and {
        state.grantRunId == RUN_R,
        state.grantResponsibilityId == RESPONSIBILITY_Q,
        state.grantOccurrence > 0,
        state.grantOccurrence <= state.exhaustionOccurrence,
        state.grantDirection == FullRerun,
        state.grantExhaustionCause == ThirdSessionExhaustion
          or state.grantExhaustionCause == ThirdPushIntentExhaustion,
      }

  val oneGrantPerExactOccurrence: bool =
    state.grantsForOccurrence >= 0
      and state.grantsForOccurrence <= 1
      and state.grantCount <= state.exhaustionOccurrence

  val grantReplayIsIdempotent: bool =
    state.sameRequestReplays == 0
      or and {
        state.lastReplayRequestId == state.lastReplayGrantRequestId,
        state.lastReplayOccurrence > 0,
        (state.lastReplayOccurrence == 1 and state.lastReplayReceiptId == FIRST_GRANT_RECEIPT)
          or (state.lastReplayOccurrence == 2 and state.lastReplayReceiptId == SECOND_GRANT_RECEIPT),
      }

  val grantReceiptMatchesExactOccurrence: bool =
    state.grantCount == 0
      or (state.grantOccurrence == 1 and state.grantReceiptId == FIRST_GRANT_RECEIPT)
      or (state.grantOccurrence == 2 and state.grantReceiptId == SECOND_GRANT_RECEIPT)

  val grantAcknowledgementMatchesProgress: bool = and {
    not(state.phase == GrantRecorded and state.grantAcknowledged),
    state.phase != GrantBatchReady or state.grantAcknowledged,
    not(state.grantAcknowledged) or state.grantCount > 0,
  }

  val batchBoundsHold: bool = and {
    state.initialSessions >= 0,
    state.initialSessions <= MAX_BATCH_SESSIONS,
    state.initialPushIntents >= 0,
    state.initialPushIntents <= MAX_BATCH_PUSH_INTENTS,
    state.grantedSessionsUsed >= 0,
    state.grantedSessionsUsed <= MAX_BATCH_SESSIONS,
    state.grantedPushesUsed >= 0,
    state.grantedPushesUsed <= MAX_BATCH_PUSH_INTENTS,
  }

  val cumulativeOrdinalsAreNotReset: bool = and {
    state.totalSessionOrdinal == state.initialSessions + state.grantSessionEvents,
    state.totalPushIntentOrdinal == state.initialPushIntents + state.grantPushEvents,
    state.totalSessionOrdinal >= state.currentSessionOrdinal,
    state.totalPushIntentOrdinal >= state.currentPushOrdinal,
  }

  val pauseDefersQForwardEffects: bool = state.pausedForwardEffects == 0
  val exitCutoffStopsQForwardEffects: bool = state.exitForwardEffects == 0

  val taskBeginIsRetainedOnce: bool = state.taskBeginCount == 1

  val grantDoesNotProvePublication: bool =
    not(state.proofFromGrant)
      and (not(state.taskCompleted) or state.exactRemoteProof)

  val completionRequiresProofPromotionAndCurrentPermission: bool =
    not(state.taskCompleted)
      or and { state.exactRemoteProof, state.localPromotion, state.freshTaskPermission }

  val settlementRequiresExactCompletionAndCleanup: bool =
    not(state.responsibilitySettled)
      or and { state.taskCompleted, state.cleanupComplete, state.exactRemoteProof }

  val exactSuccessorParentsAreRetained: bool =
    not(state.successorCandidateRecorded)
      or and {
        state.successorParent == BASE_CANDIDATE,
        state.successorSecondParent == ACCEPTED_TASK_COMMIT,
      }

  val successorCandidateIsBoundToItsSession: bool =
    state.successorCandidateRecorded == (state.successorCandidateSessions.size() > 0)
      and state.successorCandidateSessions.forall(sessionOrdinal =>
        sessionOrdinal > 0 and sessionOrdinal <= state.currentSessionOrdinal
      )
      and ((not(state.successorCandidateRecorded) and state.successorCandidateSessionOrdinal == 0)
        or (state.successorCandidateRecorded
          and state.successorCandidateSessions.contains(state.successorCandidateSessionOrdinal)
          and state.successorCandidateSessionOrdinal > 0
          and state.successorCandidateSessionOrdinal <= state.currentSessionOrdinal))

  val postGrantEffectsMatchSelectedPath: bool =
    (state.selectedPostGrantPath != NoPostGrantPath or and { state.grantedSessionsUsed == 0, state.grantedPushesUsed == 0 })
      and (state.selectedPostGrantPath != AlreadyPublished or and { state.grantedSessionsUsed == 0, state.grantedPushesUsed == 0 })
      and (state.selectedPostGrantPath != ReusableCandidate or state.grantedSessionsUsed == 0)
      and (state.selectedPostGrantPath != SameCommitSuccessor or state.grantedSessionsUsed > 0)
      and (state.selectedPostGrantPath != BlockedConstraint or and { state.grantedSessionsUsed == 0, state.grantedPushesUsed == 0 })

  // Keep the original branch choice separate from a later blocked wait result.
  // This makes path-switch mutations visible even when the new path's counters
  // would otherwise look locally consistent.
  val postGrantPathMatchesSelectedPath: bool =
    state.postGrantPath == state.selectedPostGrantPath
      or (state.postGrantPath == BlockedConstraint and state.phase == GrantWaiting)

  val grantReceiptIsVisibleBeforeForwardEffects: bool =
    state.grantSessionEvents == 0 and state.grantPushEvents == 0
      or state.grantCount > 0

  val runTerminationRequiresSettledResponsibility: bool =
    not(state.runTerminated) or state.responsibilitySettled

  val exactExhaustionReached: bool =
    state.exhaustionOccurrence > 0
      and (state.exhaustionCause == ThirdSessionExhaustion or state.exhaustionCause == ThirdPushIntentExhaustion)

  val grantCommittedReached: bool = state.grantCount > 0
  val pausedGrantReached: bool = state.lifecycle == Paused and state.grantCount > 0
  val grantSessionReached: bool = state.grantedSessionsUsed > 0
  val grantPushReached: bool = state.grantedPushesUsed > 0
  val secondExhaustionReached: bool = state.exhaustionOccurrence == 2
  val secondGrantReached: bool = state.grantCount == 2 and state.grantOccurrence == 2
  val unrelatedProgressReached: bool = state.unrelatedProgress > 0
  val exactProofReached: bool = state.exactRemoteProof
  val blockedWaitReached: bool = state.phase == GrantWaiting
  val settledReached: bool = state.responsibilitySettled

  action init: bool = all {
    state' = {
      phase: InitialBatchReady,
      lifecycle: Running,
      hostLive: true,
      activation: 1,
      requestPending: false,
      requestId: 0,
      requestDirection: NoDirection,
      requestOccurrence: 0,
      exhaustionOccurrence: 0,
      exhaustionCause: NoExhaustion,
      initialSessions: 0,
      initialPushIntents: 0,
      initialSessionOpen: false,
      grantedSessionsUsed: 0,
      grantedPushesUsed: 0,
      grantCount: 0,
      grantsForOccurrence: 0,
      grantOccurrence: 0,
      grantRunId: 0,
      grantResponsibilityId: 0,
      grantRequestId: 0,
      grantReceiptId: 0,
      grantDirection: NoDirection,
      grantExhaustionCause: NoExhaustion,
      grantAcknowledged: false,
      sameRequestReplays: 0,
      lastReplayRequestId: 0,
      lastReplayReceiptId: 0,
      lastReplayGrantRequestId: 0,
      lastReplayOccurrence: 0,
      differentRequestReplays: 0,
      grantSessionEvents: 0,
      grantPushEvents: 0,
      totalSessionOrdinal: 0,
      totalPushIntentOrdinal: 0,
      currentSessionOrdinal: 0,
      currentPushOrdinal: 0,
      pushObservation: NoPushObservation,
      postGrantPath: NoPostGrantPath,
      selectedPostGrantPath: NoPostGrantPath,
      exactRemoteProof: false,
      proofFromGrant: false,
      localPromotion: false,
      freshTaskPermission: false,
      taskCompleted: false,
      cleanupComplete: false,
      responsibilitySettled: false,
      runTerminated: false,
      taskBeginCount: 1,
      successorParent: 0,
      successorSecondParent: 0,
      successorCandidateRecorded: false,
      successorCandidateSessions: Set(),
      successorCandidateSessionOrdinal: 0,
      pausedForwardEffects: 0,
      exitForwardEffects: 0,
      qForwardEffectOrdinal: 0,
      unrelatedProgress: 0,
    },
  }

  action startInitialSession: bool = all {
    state.phase == InitialBatchReady,
    state.lifecycle == Running,
    state.hostLive,
    state.initialSessions < MAX_BATCH_SESSIONS,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: InitialSessionOpen,
      initialSessions: state.initialSessions + 1,
      initialSessionOpen: true,
      totalSessionOrdinal: state.totalSessionOrdinal + 1,
      currentSessionOrdinal: state.totalSessionOrdinal + 1,
    }),
  }

  action closeInitialSession: bool = all {
    state.phase == InitialSessionOpen,
    state.initialSessionOpen,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, { ...state, phase: InitialBatchReady, initialSessionOpen: false }),
  }

  action recordInitialPushIntent: bool = all {
    state.phase == InitialSessionOpen,
    state.initialSessionOpen,
    state.lifecycle == Running,
    state.hostLive,
    state.initialPushIntents < MAX_BATCH_PUSH_INTENTS,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: InitialIntentPending,
      initialPushIntents: state.initialPushIntents + 1,
      totalPushIntentOrdinal: state.totalPushIntentOrdinal + 1,
      currentPushOrdinal: state.totalPushIntentOrdinal + 1,
      pushObservation: UnresolvedPushIntent,
    }),
  }

  action resolveInitialIntentWithoutProof: bool = all {
    state.phase == InitialIntentPending,
    state.pushObservation == UnresolvedPushIntent,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: InitialSessionOpen,
      pushObservation: Unapplied,
    }),
  }

  action retainInitialPublicationExhaustion: bool = all {
    state.phase == InitialBatchReady or state.phase == InitialSessionOpen,
    state.exhaustionOccurrence == 0,
    state.lifecycle == Running,
    state.hostLive,
    state.initialSessions == MAX_BATCH_SESSIONS or state.initialPushIntents == MAX_BATCH_PUSH_INTENTS,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: Exhausted,
      initialSessionOpen: false,
      exhaustionOccurrence: 1,
      exhaustionCause: if (state.initialSessions == MAX_BATCH_SESSIONS)
        ThirdSessionExhaustion
      else ThirdPushIntentExhaustion,
      grantsForOccurrence: 0,
    }),
  }

  action applyPause: bool = all {
    state.lifecycle == Running,
    state' = { ...state, lifecycle: Paused },
  }

  action applyUnpause: bool = all {
    state.lifecycle == Paused,
    state' = { ...state, lifecycle: Running },
  }

  action applyExitCutoff: bool = all {
    state.lifecycle != ExitCutoff,
    state' = { ...state, lifecycle: ExitCutoff },
  }

  action submitExactFullRerunRequest(requestId: int): bool = all {
    state.phase == Exhausted,
    state.lifecycle != ExitCutoff,
    state.hostLive,
    not(state.requestPending),
    state.exhaustionCause == ThirdSessionExhaustion or state.exhaustionCause == ThirdPushIntentExhaustion,
    requestId == FIRST_REQUEST_ID or requestId == SECOND_REQUEST_ID,
    state.grantCount == 0 or requestId != state.grantRequestId,
    state' = {
      ...state,
      phase: GrantRequestPending,
      requestPending: true,
      requestId: requestId,
      requestDirection: FullRerun,
      requestOccurrence: state.exhaustionOccurrence,
    },
  }

  action appendExactExhaustionGrant(receiptId: int): bool = all {
    state.phase == GrantRequestPending,
    state.requestPending,
    state.lifecycle != ExitCutoff,
    state.hostLive,
    state.requestDirection == FullRerun,
    state.requestOccurrence == state.exhaustionOccurrence,
    state.exhaustionCause == ThirdSessionExhaustion or state.exhaustionCause == ThirdPushIntentExhaustion,
    state.grantsForOccurrence == 0,
    (state.exhaustionOccurrence == 1 and receiptId == FIRST_GRANT_RECEIPT)
      or (state.exhaustionOccurrence == 2 and receiptId == SECOND_GRANT_RECEIPT),
    state' = {
      ...state,
      phase: GrantRecorded,
      requestPending: false,
      grantCount: state.grantCount + 1,
      grantsForOccurrence: state.grantsForOccurrence + 1,
      grantOccurrence: state.exhaustionOccurrence,
      grantRunId: RUN_R,
      grantResponsibilityId: RESPONSIBILITY_Q,
      grantRequestId: state.requestId,
      grantReceiptId: receiptId,
      grantDirection: FullRerun,
      grantExhaustionCause: state.exhaustionCause,
      grantAcknowledged: false,
      grantedSessionsUsed: 0,
      grantedPushesUsed: 0,
      postGrantPath: NoPostGrantPath,
      selectedPostGrantPath: NoPostGrantPath,
    },
  }

  action acknowledgeGrant: bool = all {
    state.phase == GrantRecorded,
    state.hostLive,
    not(state.grantAcknowledged),
    state' = { ...state, phase: GrantBatchReady, grantAcknowledged: true },
  }

  action replaySameGrantRequest: bool = all {
    state.grantCount > 0,
    state.phase != Exhausted,
    state.hostLive,
    state.sameRequestReplays == 0,
    state.requestId == state.grantRequestId,
    state.grantOccurrence == state.exhaustionOccurrence,
    state' = {
      ...state,
      phase: if (state.phase == GrantRecorded) GrantBatchReady else state.phase,
      grantAcknowledged: true,
      sameRequestReplays: state.sameRequestReplays + 1,
      lastReplayRequestId: state.requestId,
      lastReplayReceiptId: state.grantReceiptId,
      lastReplayGrantRequestId: state.grantRequestId,
      lastReplayOccurrence: state.grantOccurrence,
    },
  }

  action replayDifferentRequestForSameOccurrence(requestId: int): bool = all {
    state.grantCount > 0,
    state.grantOccurrence == state.exhaustionOccurrence,
    state.hostLive,
    state.differentRequestReplays == 0,
    requestId != state.grantRequestId,
    state' = {
      ...state,
      differentRequestReplays: state.differentRequestReplays + 1,
    },
  }

  action crashBeforeGrantAppend: bool = all {
    state.phase == GrantRequestPending,
    state.requestPending,
    state.grantsForOccurrence == 0,
    state' = {
      ...state,
      phase: Exhausted,
      hostLive: false,
      requestPending: false,
      requestId: 0,
      requestDirection: NoDirection,
      requestOccurrence: 0,
    },
  }

  action rejectPendingGrantAtExitCutoff: bool = all {
    state.phase == GrantRequestPending,
    state.requestPending,
    state.lifecycle == ExitCutoff,
    state' = {
      ...state,
      phase: Exhausted,
      requestPending: false,
      requestId: 0,
      requestDirection: NoDirection,
      requestOccurrence: 0,
    },
  }

  action crashAfterGrantAppendBeforeAck: bool = all {
    state.phase == GrantRecorded,
    state.grantCount > 0,
    not(state.grantAcknowledged),
    state' = { ...state, hostLive: false },
  }

  action crashAfterGrantSessionFixation: bool = all {
    state.phase == GrantSessionOpen,
    state.hostLive,
    state.grantAcknowledged,
    state.grantedSessionsUsed > 0,
    state' = { ...state, hostLive: false },
  }

  action crashAfterCommittedGrantIntent: bool = all {
    state.phase == GrantIntentPending,
    state.hostLive,
    state.grantAcknowledged,
    state.pushObservation == UnresolvedPushIntent,
    state.grantedPushesUsed > 0,
    state' = { ...state, hostLive: false },
  }

  action restartHost: bool = all {
    not(state.hostLive),
    state.activation < MAX_ACTIVATIONS,
    state' = { ...state, hostLive: true, activation: state.activation + 1 },
  }

  action recoverCommittedGrant: bool = all {
    state.phase == GrantRecorded,
    state.hostLive,
    state.grantCount > 0,
    not(state.grantAcknowledged),
    state' = { ...state, phase: GrantBatchReady, grantAcknowledged: true },
  }

  val grantedSuccessorSessionAllowed: bool = all {
    state.phase == GrantBatchReady,
    state.lifecycle == Running,
    state.hostLive,
    state.grantAcknowledged,
    state.grantOccurrence == state.exhaustionOccurrence,
    state.grantedSessionsUsed < MAX_BATCH_SESSIONS,
    state.selectedPostGrantPath == NoPostGrantPath or state.selectedPostGrantPath == SameCommitSuccessor,
    state.postGrantPath == state.selectedPostGrantPath,
  }

  action startGrantedSuccessorSession: bool = all {
    grantedSuccessorSessionAllowed,
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

  action recordGrantedPushIntent: bool = all {
    state.phase == GrantSessionOpen,
    state.lifecycle == Running,
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

  action resolveGrantedIntentWithoutProof: bool = all {
    state.phase == GrantIntentPending,
    state.pushObservation == UnresolvedPushIntent,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: GrantBatchReady,
      pushObservation: Unapplied,
    }),
  }

  action observeExactPushPublicationProof: bool = all {
    state.phase == GrantIntentPending,
    state.pushObservation == UnresolvedPushIntent,
    state.lifecycle == Running,
    state.hostLive,
    state.selectedPostGrantPath == ReusableCandidate or state.selectedPostGrantPath == SameCommitSuccessor,
    state.postGrantPath == state.selectedPostGrantPath,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: ExactPublicationProofRecorded,
      pushObservation: ExactRemoteProof,
      exactRemoteProof: true,
      proofFromGrant: false,
    }),
  }

  val alreadyPublishedReconciliationAllowed: bool = all {
    state.phase == GrantBatchReady,
    state.lifecycle == Running,
    state.grantAcknowledged,
    state.postGrantPath == NoPostGrantPath,
    state.selectedPostGrantPath == NoPostGrantPath,
    state.grantedSessionsUsed == 0,
    state.grantedPushesUsed == 0,
  }

  action reconcileAlreadyPublishedCandidate: bool = all {
    alreadyPublishedReconciliationAllowed,
    state.hostLive,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: ExactPublicationProofRecorded,
      exactRemoteProof: true,
      proofFromGrant: false,
      postGrantPath: AlreadyPublished,
      selectedPostGrantPath: AlreadyPublished,
    }),
  }

  val reusableCandidatePushIntentAllowed: bool = all {
    state.phase == GrantBatchReady,
    state.lifecycle == Running,
    state.grantAcknowledged,
    state.grantedPushesUsed < MAX_BATCH_PUSH_INTENTS,
    state.grantedSessionsUsed == 0,
    state.selectedPostGrantPath == NoPostGrantPath or state.selectedPostGrantPath == ReusableCandidate,
    state.postGrantPath == state.selectedPostGrantPath,
  }

  action recordReusableCandidatePushIntent: bool = all {
    reusableCandidatePushIntentAllowed,
    state.hostLive,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: GrantIntentPending,
      grantedPushesUsed: state.grantedPushesUsed + 1,
      grantPushEvents: state.grantPushEvents + 1,
      totalPushIntentOrdinal: state.totalPushIntentOrdinal + 1,
      currentPushOrdinal: state.totalPushIntentOrdinal + 1,
      pushObservation: UnresolvedPushIntent,
      postGrantPath: ReusableCandidate,
      selectedPostGrantPath: ReusableCandidate,
    }),
  }

  action retainBlockedConstraint: bool = all {
    state.phase == GrantBatchReady,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: GrantWaiting,
      postGrantPath: BlockedConstraint,
      selectedPostGrantPath: if (state.selectedPostGrantPath == NoPostGrantPath)
        BlockedConstraint
      else state.selectedPostGrantPath,
    }),
  }

  action closeGrantSessionWithoutIntent: bool = all {
    state.phase == GrantSessionOpen,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, { ...state, phase: GrantBatchReady }),
  }

  action recordSameCommitSuccessorCandidate: bool = all {
    state.phase == GrantSessionOpen,
    state.lifecycle == Running,
    state.hostLive,
    state.grantedSessionsUsed > 0,
    state.selectedPostGrantPath == SameCommitSuccessor,
    state.postGrantPath == SameCommitSuccessor,
    state.successorCandidateSessionOrdinal != state.currentSessionOrdinal,
    state' = recordQForwardEffect(state, {
      ...state,
      successorParent: BASE_CANDIDATE,
      successorSecondParent: ACCEPTED_TASK_COMMIT,
      successorCandidateRecorded: true,
      successorCandidateSessions: state.successorCandidateSessions.union(Set(state.currentSessionOrdinal)),
      successorCandidateSessionOrdinal: state.currentSessionOrdinal,
    }),
  }

  action retainNextPublicationExhaustion: bool = all {
    state.phase == GrantBatchReady,
    state.lifecycle == Running,
    state.hostLive,
    state.exhaustionOccurrence == state.grantOccurrence,
    state.exhaustionOccurrence < MAX_EXHAUSTION_OCCURRENCES,
    state.grantedSessionsUsed == MAX_BATCH_SESSIONS or state.grantedPushesUsed == MAX_BATCH_PUSH_INTENTS,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: Exhausted,
      exhaustionOccurrence: state.exhaustionOccurrence + 1,
      exhaustionCause: if (state.grantedSessionsUsed == MAX_BATCH_SESSIONS)
        ThirdSessionExhaustion
      else ThirdPushIntentExhaustion,
      grantsForOccurrence: 0,
      grantAcknowledged: false,
      requestId: 0,
      requestDirection: NoDirection,
      requestOccurrence: 0,
    }),
  }

  action progressUnrelatedResponsibility: bool = all {
    state.lifecycle != ExitCutoff,
    state.unrelatedProgress == 0,
    state' = { ...state, unrelatedProgress: state.unrelatedProgress + 1 },
  }

  action recordLocalPromotion: bool = all {
    state.phase == ExactPublicationProofRecorded,
    state.exactRemoteProof,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, { ...state, phase: LocalPromotionRecorded, localPromotion: true }),
  }

  action refreshTaskPermission: bool = all {
    state.phase == LocalPromotionRecorded,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, { ...state, phase: FreshTaskPermissionRecorded, freshTaskPermission: true }),
  }

  action completeTaskFromExactProof: bool = all {
    state.phase == FreshTaskPermissionRecorded,
    state.exactRemoteProof,
    state.localPromotion,
    state.freshTaskPermission,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, { ...state, phase: TaskCompletionRecorded, taskCompleted: true }),
  }

  action recordExactCleanup: bool = all {
    state.phase == TaskCompletionRecorded,
    state.taskCompleted,
    not(state.cleanupComplete),
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, { ...state, cleanupComplete: true }),
  }

  action settleResponsibility: bool = all {
    state.phase == TaskCompletionRecorded,
    state.taskCompleted,
    state.cleanupComplete,
    state.exactRemoteProof,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, { ...state, phase: ResponsibilitySettled, responsibilitySettled: true }),
  }

  action terminateRunAfterResponsibilitySettlement: bool = all {
    state.responsibilitySettled,
    state' = { ...state, runTerminated: true },
  }

  action step: bool = any {
    startInitialSession,
    closeInitialSession,
    recordInitialPushIntent,
    resolveInitialIntentWithoutProof,
    retainInitialPublicationExhaustion,
    applyPause,
    applyUnpause,
    applyExitCutoff,
    submitExactFullRerunRequest(FIRST_REQUEST_ID),
    submitExactFullRerunRequest(SECOND_REQUEST_ID),
    appendExactExhaustionGrant(FIRST_GRANT_RECEIPT),
    appendExactExhaustionGrant(SECOND_GRANT_RECEIPT),
    acknowledgeGrant,
    replaySameGrantRequest,
    replayDifferentRequestForSameOccurrence(SECOND_REQUEST_ID),
    crashBeforeGrantAppend,
    rejectPendingGrantAtExitCutoff,
    crashAfterGrantAppendBeforeAck,
    crashAfterGrantSessionFixation,
    crashAfterCommittedGrantIntent,
    restartHost,
    recoverCommittedGrant,
    startGrantedSuccessorSession,
    recordGrantedPushIntent,
    resolveGrantedIntentWithoutProof,
    observeExactPushPublicationProof,
    reconcileAlreadyPublishedCandidate,
    recordReusableCandidatePushIntent,
    retainBlockedConstraint,
    closeGrantSessionWithoutIntent,
    retainNextPublicationExhaustion,
    progressUnrelatedResponsibility,
  }
}


// Transition-restricted projection for directPublicationBatchGrantBatchFinalityProof.
// State, action bodies, and invariant declarations are copied from the canonical model.
// Only the generated step transition set is restricted by the reviewed profile contract.
// #386 models a bounded Operator grant for one exact, retained publication
// exhaustion. Run/journal identity remains one authority; Git and tracker
// outcomes enter only as fresh boundary observations. Counters below are
// projection instrumentation for the finite trace, not a new runtime ledger.
module directPublicationBatchGrantBatchFinalityProof {
  type Phase =
    | InitialBatchReady
    | InitialSessionOpen
    | InitialIntentPending
    | Exhausted
    | GrantRequestPending
    | GrantRecorded
    | GrantBatchReady
    | GrantSessionOpen
    | GrantIntentPending
    | GrantBatchExhausted
    | GrantWaiting
    | ExactPublicationProofRecorded
    | LocalPromotionRecorded
    | FreshTaskPermissionRecorded
    | TaskCompletionRecorded
    | ResponsibilitySettled

  type Lifecycle = Running | Paused | ExitCutoff
  type ExhaustionCause = NoExhaustion | ThirdSessionExhaustion | ThirdPushIntentExhaustion | QuarantineExhaustion
  type OperatorDirection = NoDirection | FullRerun | IntegrationQuarantine
  type PushObservation = NoPushObservation | UnresolvedPushIntent | Unapplied | ExactRemoteProof
  type PostGrantPath = NoPostGrantPath | AlreadyPublished | ReusableCandidate | SameCommitSuccessor | BlockedConstraint

  type State = {
    phase: Phase,
    lifecycle: Lifecycle,
    hostLive: bool,
    activation: int,
    requestPending: bool,
    requestId: int,
    requestDirection: OperatorDirection,
    requestOccurrence: int,
    exhaustionOccurrence: int,
    exhaustionCause: ExhaustionCause,
    initialSessions: int,
    initialPushIntents: int,
    initialSessionOpen: bool,
    grantedSessionsUsed: int,
    grantedPushesUsed: int,
    grantCount: int,
    grantsForOccurrence: int,
    grantOccurrence: int,
    grantRunId: int,
    grantResponsibilityId: int,
    grantRequestId: int,
    grantReceiptId: int,
    grantDirection: OperatorDirection,
    grantExhaustionCause: ExhaustionCause,
    grantAcknowledged: bool,
    sameRequestReplays: int,
    lastReplayRequestId: int,
    lastReplayReceiptId: int,
    lastReplayGrantRequestId: int,
    lastReplayOccurrence: int,
    differentRequestReplays: int,
    grantSessionEvents: int,
    grantPushEvents: int,
    totalSessionOrdinal: int,
    totalPushIntentOrdinal: int,
    currentSessionOrdinal: int,
    currentPushOrdinal: int,
    pushObservation: PushObservation,
    postGrantPath: PostGrantPath,
    selectedPostGrantPath: PostGrantPath,
    exactRemoteProof: bool,
    proofFromGrant: bool,
    localPromotion: bool,
    freshTaskPermission: bool,
    taskCompleted: bool,
    cleanupComplete: bool,
    responsibilitySettled: bool,
    runTerminated: bool,
    taskBeginCount: int,
    successorParent: int,
    successorSecondParent: int,
    successorCandidateRecorded: bool,
    successorCandidateSessions: Set[int],
    successorCandidateSessionOrdinal: int,
    pausedForwardEffects: int,
    exitForwardEffects: int,
    qForwardEffectOrdinal: int,
    unrelatedProgress: int,
  }

  var state: State

  pure val RUN_R = 1
  pure val RESPONSIBILITY_Q = 10
  pure val RESPONSIBILITY_B = 11
  pure val BASE_CANDIDATE = 20
  pure val ACCEPTED_TASK_COMMIT = 30
  pure val MAX_BATCH_SESSIONS = 3
  pure val MAX_BATCH_PUSH_INTENTS = 3
  pure val MAX_EXHAUSTION_OCCURRENCES = 2
  pure val MAX_ACTIVATIONS = 3
  pure val FIRST_REQUEST_ID = 100
  pure val SECOND_REQUEST_ID = 101
  pure val FIRST_GRANT_RECEIPT = 200
  pure val SECOND_GRANT_RECEIPT = 201

  // Every modeled Q-owned forward boundary records its ordinal and notes
  // whether it crossed while Pause or Exit was active. Grant receipt append,
  // replay, and recovery are control-plane operations and do not use this.
  pure def recordQForwardEffect(before: State, after: State): State = {
    ...after,
    pausedForwardEffects: before.pausedForwardEffects + (if (before.lifecycle == Paused) 1 else 0),
    exitForwardEffects: before.exitForwardEffects + (if (before.lifecycle == ExitCutoff) 1 else 0),
    qForwardEffectOrdinal: before.qForwardEffectOrdinal + 1,
  }

  // These properties restate accepted outcomes from retained facts. They are
  // not transition guards, so mutant transitions can violate them in tests.
  val grantIsBoundToRetainedExhaustion: bool =
    state.grantCount == 0
      or and {
        state.grantRunId == RUN_R,
        state.grantResponsibilityId == RESPONSIBILITY_Q,
        state.grantOccurrence > 0,
        state.grantOccurrence <= state.exhaustionOccurrence,
        state.grantDirection == FullRerun,
        state.grantExhaustionCause == ThirdSessionExhaustion
          or state.grantExhaustionCause == ThirdPushIntentExhaustion,
      }

  val oneGrantPerExactOccurrence: bool =
    state.grantsForOccurrence >= 0
      and state.grantsForOccurrence <= 1
      and state.grantCount <= state.exhaustionOccurrence

  val grantReplayIsIdempotent: bool =
    state.sameRequestReplays == 0
      or and {
        state.lastReplayRequestId == state.lastReplayGrantRequestId,
        state.lastReplayOccurrence > 0,
        (state.lastReplayOccurrence == 1 and state.lastReplayReceiptId == FIRST_GRANT_RECEIPT)
          or (state.lastReplayOccurrence == 2 and state.lastReplayReceiptId == SECOND_GRANT_RECEIPT),
      }

  val grantReceiptMatchesExactOccurrence: bool =
    state.grantCount == 0
      or (state.grantOccurrence == 1 and state.grantReceiptId == FIRST_GRANT_RECEIPT)
      or (state.grantOccurrence == 2 and state.grantReceiptId == SECOND_GRANT_RECEIPT)

  val grantAcknowledgementMatchesProgress: bool = and {
    not(state.phase == GrantRecorded and state.grantAcknowledged),
    state.phase != GrantBatchReady or state.grantAcknowledged,
    not(state.grantAcknowledged) or state.grantCount > 0,
  }

  val batchBoundsHold: bool = and {
    state.initialSessions >= 0,
    state.initialSessions <= MAX_BATCH_SESSIONS,
    state.initialPushIntents >= 0,
    state.initialPushIntents <= MAX_BATCH_PUSH_INTENTS,
    state.grantedSessionsUsed >= 0,
    state.grantedSessionsUsed <= MAX_BATCH_SESSIONS,
    state.grantedPushesUsed >= 0,
    state.grantedPushesUsed <= MAX_BATCH_PUSH_INTENTS,
  }

  val cumulativeOrdinalsAreNotReset: bool = and {
    state.totalSessionOrdinal == state.initialSessions + state.grantSessionEvents,
    state.totalPushIntentOrdinal == state.initialPushIntents + state.grantPushEvents,
    state.totalSessionOrdinal >= state.currentSessionOrdinal,
    state.totalPushIntentOrdinal >= state.currentPushOrdinal,
  }

  val pauseDefersQForwardEffects: bool = state.pausedForwardEffects == 0
  val exitCutoffStopsQForwardEffects: bool = state.exitForwardEffects == 0

  val taskBeginIsRetainedOnce: bool = state.taskBeginCount == 1

  val grantDoesNotProvePublication: bool =
    not(state.proofFromGrant)
      and (not(state.taskCompleted) or state.exactRemoteProof)

  val completionRequiresProofPromotionAndCurrentPermission: bool =
    not(state.taskCompleted)
      or and { state.exactRemoteProof, state.localPromotion, state.freshTaskPermission }

  val settlementRequiresExactCompletionAndCleanup: bool =
    not(state.responsibilitySettled)
      or and { state.taskCompleted, state.cleanupComplete, state.exactRemoteProof }

  val exactSuccessorParentsAreRetained: bool =
    not(state.successorCandidateRecorded)
      or and {
        state.successorParent == BASE_CANDIDATE,
        state.successorSecondParent == ACCEPTED_TASK_COMMIT,
      }

  val successorCandidateIsBoundToItsSession: bool =
    state.successorCandidateRecorded == (state.successorCandidateSessions.size() > 0)
      and state.successorCandidateSessions.forall(sessionOrdinal =>
        sessionOrdinal > 0 and sessionOrdinal <= state.currentSessionOrdinal
      )
      and ((not(state.successorCandidateRecorded) and state.successorCandidateSessionOrdinal == 0)
        or (state.successorCandidateRecorded
          and state.successorCandidateSessions.contains(state.successorCandidateSessionOrdinal)
          and state.successorCandidateSessionOrdinal > 0
          and state.successorCandidateSessionOrdinal <= state.currentSessionOrdinal))

  val postGrantEffectsMatchSelectedPath: bool =
    (state.selectedPostGrantPath != NoPostGrantPath or and { state.grantedSessionsUsed == 0, state.grantedPushesUsed == 0 })
      and (state.selectedPostGrantPath != AlreadyPublished or and { state.grantedSessionsUsed == 0, state.grantedPushesUsed == 0 })
      and (state.selectedPostGrantPath != ReusableCandidate or state.grantedSessionsUsed == 0)
      and (state.selectedPostGrantPath != SameCommitSuccessor or state.grantedSessionsUsed > 0)
      and (state.selectedPostGrantPath != BlockedConstraint or and { state.grantedSessionsUsed == 0, state.grantedPushesUsed == 0 })

  // Keep the original branch choice separate from a later blocked wait result.
  // This makes path-switch mutations visible even when the new path's counters
  // would otherwise look locally consistent.
  val postGrantPathMatchesSelectedPath: bool =
    state.postGrantPath == state.selectedPostGrantPath
      or (state.postGrantPath == BlockedConstraint and state.phase == GrantWaiting)

  val grantReceiptIsVisibleBeforeForwardEffects: bool =
    state.grantSessionEvents == 0 and state.grantPushEvents == 0
      or state.grantCount > 0

  val runTerminationRequiresSettledResponsibility: bool =
    not(state.runTerminated) or state.responsibilitySettled

  val exactExhaustionReached: bool =
    state.exhaustionOccurrence > 0
      and (state.exhaustionCause == ThirdSessionExhaustion or state.exhaustionCause == ThirdPushIntentExhaustion)

  val grantCommittedReached: bool = state.grantCount > 0
  val pausedGrantReached: bool = state.lifecycle == Paused and state.grantCount > 0
  val grantSessionReached: bool = state.grantedSessionsUsed > 0
  val grantPushReached: bool = state.grantedPushesUsed > 0
  val secondExhaustionReached: bool = state.exhaustionOccurrence == 2
  val secondGrantReached: bool = state.grantCount == 2 and state.grantOccurrence == 2
  val unrelatedProgressReached: bool = state.unrelatedProgress > 0
  val exactProofReached: bool = state.exactRemoteProof
  val blockedWaitReached: bool = state.phase == GrantWaiting
  val settledReached: bool = state.responsibilitySettled

  action init: bool = all {
    state' = {
      phase: InitialBatchReady,
      lifecycle: Running,
      hostLive: true,
      activation: 1,
      requestPending: false,
      requestId: 0,
      requestDirection: NoDirection,
      requestOccurrence: 0,
      exhaustionOccurrence: 0,
      exhaustionCause: NoExhaustion,
      initialSessions: 0,
      initialPushIntents: 0,
      initialSessionOpen: false,
      grantedSessionsUsed: 0,
      grantedPushesUsed: 0,
      grantCount: 0,
      grantsForOccurrence: 0,
      grantOccurrence: 0,
      grantRunId: 0,
      grantResponsibilityId: 0,
      grantRequestId: 0,
      grantReceiptId: 0,
      grantDirection: NoDirection,
      grantExhaustionCause: NoExhaustion,
      grantAcknowledged: false,
      sameRequestReplays: 0,
      lastReplayRequestId: 0,
      lastReplayReceiptId: 0,
      lastReplayGrantRequestId: 0,
      lastReplayOccurrence: 0,
      differentRequestReplays: 0,
      grantSessionEvents: 0,
      grantPushEvents: 0,
      totalSessionOrdinal: 0,
      totalPushIntentOrdinal: 0,
      currentSessionOrdinal: 0,
      currentPushOrdinal: 0,
      pushObservation: NoPushObservation,
      postGrantPath: NoPostGrantPath,
      selectedPostGrantPath: NoPostGrantPath,
      exactRemoteProof: false,
      proofFromGrant: false,
      localPromotion: false,
      freshTaskPermission: false,
      taskCompleted: false,
      cleanupComplete: false,
      responsibilitySettled: false,
      runTerminated: false,
      taskBeginCount: 1,
      successorParent: 0,
      successorSecondParent: 0,
      successorCandidateRecorded: false,
      successorCandidateSessions: Set(),
      successorCandidateSessionOrdinal: 0,
      pausedForwardEffects: 0,
      exitForwardEffects: 0,
      qForwardEffectOrdinal: 0,
      unrelatedProgress: 0,
    },
  }

  action startInitialSession: bool = all {
    state.phase == InitialBatchReady,
    state.lifecycle == Running,
    state.hostLive,
    state.initialSessions < MAX_BATCH_SESSIONS,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: InitialSessionOpen,
      initialSessions: state.initialSessions + 1,
      initialSessionOpen: true,
      totalSessionOrdinal: state.totalSessionOrdinal + 1,
      currentSessionOrdinal: state.totalSessionOrdinal + 1,
    }),
  }

  action closeInitialSession: bool = all {
    state.phase == InitialSessionOpen,
    state.initialSessionOpen,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, { ...state, phase: InitialBatchReady, initialSessionOpen: false }),
  }

  action recordInitialPushIntent: bool = all {
    state.phase == InitialSessionOpen,
    state.initialSessionOpen,
    state.lifecycle == Running,
    state.hostLive,
    state.initialPushIntents < MAX_BATCH_PUSH_INTENTS,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: InitialIntentPending,
      initialPushIntents: state.initialPushIntents + 1,
      totalPushIntentOrdinal: state.totalPushIntentOrdinal + 1,
      currentPushOrdinal: state.totalPushIntentOrdinal + 1,
      pushObservation: UnresolvedPushIntent,
    }),
  }

  action resolveInitialIntentWithoutProof: bool = all {
    state.phase == InitialIntentPending,
    state.pushObservation == UnresolvedPushIntent,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: InitialSessionOpen,
      pushObservation: Unapplied,
    }),
  }

  action retainInitialPublicationExhaustion: bool = all {
    state.phase == InitialBatchReady or state.phase == InitialSessionOpen,
    state.exhaustionOccurrence == 0,
    state.lifecycle == Running,
    state.hostLive,
    state.initialSessions == MAX_BATCH_SESSIONS or state.initialPushIntents == MAX_BATCH_PUSH_INTENTS,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: Exhausted,
      initialSessionOpen: false,
      exhaustionOccurrence: 1,
      exhaustionCause: if (state.initialSessions == MAX_BATCH_SESSIONS)
        ThirdSessionExhaustion
      else ThirdPushIntentExhaustion,
      grantsForOccurrence: 0,
    }),
  }

  action applyPause: bool = all {
    state.lifecycle == Running,
    state' = { ...state, lifecycle: Paused },
  }

  action applyUnpause: bool = all {
    state.lifecycle == Paused,
    state' = { ...state, lifecycle: Running },
  }

  action applyExitCutoff: bool = all {
    state.lifecycle != ExitCutoff,
    state' = { ...state, lifecycle: ExitCutoff },
  }

  action submitExactFullRerunRequest(requestId: int): bool = all {
    state.phase == Exhausted,
    state.lifecycle != ExitCutoff,
    state.hostLive,
    not(state.requestPending),
    state.exhaustionCause == ThirdSessionExhaustion or state.exhaustionCause == ThirdPushIntentExhaustion,
    requestId == FIRST_REQUEST_ID or requestId == SECOND_REQUEST_ID,
    state.grantCount == 0 or requestId != state.grantRequestId,
    state' = {
      ...state,
      phase: GrantRequestPending,
      requestPending: true,
      requestId: requestId,
      requestDirection: FullRerun,
      requestOccurrence: state.exhaustionOccurrence,
    },
  }

  action appendExactExhaustionGrant(receiptId: int): bool = all {
    state.phase == GrantRequestPending,
    state.requestPending,
    state.lifecycle != ExitCutoff,
    state.hostLive,
    state.requestDirection == FullRerun,
    state.requestOccurrence == state.exhaustionOccurrence,
    state.exhaustionCause == ThirdSessionExhaustion or state.exhaustionCause == ThirdPushIntentExhaustion,
    state.grantsForOccurrence == 0,
    (state.exhaustionOccurrence == 1 and receiptId == FIRST_GRANT_RECEIPT)
      or (state.exhaustionOccurrence == 2 and receiptId == SECOND_GRANT_RECEIPT),
    state' = {
      ...state,
      phase: GrantRecorded,
      requestPending: false,
      grantCount: state.grantCount + 1,
      grantsForOccurrence: state.grantsForOccurrence + 1,
      grantOccurrence: state.exhaustionOccurrence,
      grantRunId: RUN_R,
      grantResponsibilityId: RESPONSIBILITY_Q,
      grantRequestId: state.requestId,
      grantReceiptId: receiptId,
      grantDirection: FullRerun,
      grantExhaustionCause: state.exhaustionCause,
      grantAcknowledged: false,
      grantedSessionsUsed: 0,
      grantedPushesUsed: 0,
      postGrantPath: NoPostGrantPath,
      selectedPostGrantPath: NoPostGrantPath,
    },
  }

  action acknowledgeGrant: bool = all {
    state.phase == GrantRecorded,
    state.hostLive,
    not(state.grantAcknowledged),
    state' = { ...state, phase: GrantBatchReady, grantAcknowledged: true },
  }

  action replaySameGrantRequest: bool = all {
    state.grantCount > 0,
    state.phase != Exhausted,
    state.hostLive,
    state.sameRequestReplays == 0,
    state.requestId == state.grantRequestId,
    state.grantOccurrence == state.exhaustionOccurrence,
    state' = {
      ...state,
      phase: if (state.phase == GrantRecorded) GrantBatchReady else state.phase,
      grantAcknowledged: true,
      sameRequestReplays: state.sameRequestReplays + 1,
      lastReplayRequestId: state.requestId,
      lastReplayReceiptId: state.grantReceiptId,
      lastReplayGrantRequestId: state.grantRequestId,
      lastReplayOccurrence: state.grantOccurrence,
    },
  }

  action replayDifferentRequestForSameOccurrence(requestId: int): bool = all {
    state.grantCount > 0,
    state.grantOccurrence == state.exhaustionOccurrence,
    state.hostLive,
    state.differentRequestReplays == 0,
    requestId != state.grantRequestId,
    state' = {
      ...state,
      differentRequestReplays: state.differentRequestReplays + 1,
    },
  }

  action crashBeforeGrantAppend: bool = all {
    state.phase == GrantRequestPending,
    state.requestPending,
    state.grantsForOccurrence == 0,
    state' = {
      ...state,
      phase: Exhausted,
      hostLive: false,
      requestPending: false,
      requestId: 0,
      requestDirection: NoDirection,
      requestOccurrence: 0,
    },
  }

  action rejectPendingGrantAtExitCutoff: bool = all {
    state.phase == GrantRequestPending,
    state.requestPending,
    state.lifecycle == ExitCutoff,
    state' = {
      ...state,
      phase: Exhausted,
      requestPending: false,
      requestId: 0,
      requestDirection: NoDirection,
      requestOccurrence: 0,
    },
  }

  action crashAfterGrantAppendBeforeAck: bool = all {
    state.phase == GrantRecorded,
    state.grantCount > 0,
    not(state.grantAcknowledged),
    state' = { ...state, hostLive: false },
  }

  action crashAfterGrantSessionFixation: bool = all {
    state.phase == GrantSessionOpen,
    state.hostLive,
    state.grantAcknowledged,
    state.grantedSessionsUsed > 0,
    state' = { ...state, hostLive: false },
  }

  action crashAfterCommittedGrantIntent: bool = all {
    state.phase == GrantIntentPending,
    state.hostLive,
    state.grantAcknowledged,
    state.pushObservation == UnresolvedPushIntent,
    state.grantedPushesUsed > 0,
    state' = { ...state, hostLive: false },
  }

  action restartHost: bool = all {
    not(state.hostLive),
    state.activation < MAX_ACTIVATIONS,
    state' = { ...state, hostLive: true, activation: state.activation + 1 },
  }

  action recoverCommittedGrant: bool = all {
    state.phase == GrantRecorded,
    state.hostLive,
    state.grantCount > 0,
    not(state.grantAcknowledged),
    state' = { ...state, phase: GrantBatchReady, grantAcknowledged: true },
  }

  val grantedSuccessorSessionAllowed: bool = all {
    state.phase == GrantBatchReady,
    state.lifecycle == Running,
    state.hostLive,
    state.grantAcknowledged,
    state.grantOccurrence == state.exhaustionOccurrence,
    state.grantedSessionsUsed < MAX_BATCH_SESSIONS,
    state.selectedPostGrantPath == NoPostGrantPath or state.selectedPostGrantPath == SameCommitSuccessor,
    state.postGrantPath == state.selectedPostGrantPath,
  }

  action startGrantedSuccessorSession: bool = all {
    grantedSuccessorSessionAllowed,
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

  action recordGrantedPushIntent: bool = all {
    state.phase == GrantSessionOpen,
    state.lifecycle == Running,
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

  action resolveGrantedIntentWithoutProof: bool = all {
    state.phase == GrantIntentPending,
    state.pushObservation == UnresolvedPushIntent,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: GrantBatchReady,
      pushObservation: Unapplied,
    }),
  }

  action observeExactPushPublicationProof: bool = all {
    state.phase == GrantIntentPending,
    state.pushObservation == UnresolvedPushIntent,
    state.lifecycle == Running,
    state.hostLive,
    state.selectedPostGrantPath == ReusableCandidate or state.selectedPostGrantPath == SameCommitSuccessor,
    state.postGrantPath == state.selectedPostGrantPath,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: ExactPublicationProofRecorded,
      pushObservation: ExactRemoteProof,
      exactRemoteProof: true,
      proofFromGrant: false,
    }),
  }

  val alreadyPublishedReconciliationAllowed: bool = all {
    state.phase == GrantBatchReady,
    state.lifecycle == Running,
    state.grantAcknowledged,
    state.postGrantPath == NoPostGrantPath,
    state.selectedPostGrantPath == NoPostGrantPath,
    state.grantedSessionsUsed == 0,
    state.grantedPushesUsed == 0,
  }

  action reconcileAlreadyPublishedCandidate: bool = all {
    alreadyPublishedReconciliationAllowed,
    state.hostLive,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: ExactPublicationProofRecorded,
      exactRemoteProof: true,
      proofFromGrant: false,
      postGrantPath: AlreadyPublished,
      selectedPostGrantPath: AlreadyPublished,
    }),
  }

  val reusableCandidatePushIntentAllowed: bool = all {
    state.phase == GrantBatchReady,
    state.lifecycle == Running,
    state.grantAcknowledged,
    state.grantedPushesUsed < MAX_BATCH_PUSH_INTENTS,
    state.grantedSessionsUsed == 0,
    state.selectedPostGrantPath == NoPostGrantPath or state.selectedPostGrantPath == ReusableCandidate,
    state.postGrantPath == state.selectedPostGrantPath,
  }

  action recordReusableCandidatePushIntent: bool = all {
    reusableCandidatePushIntentAllowed,
    state.hostLive,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: GrantIntentPending,
      grantedPushesUsed: state.grantedPushesUsed + 1,
      grantPushEvents: state.grantPushEvents + 1,
      totalPushIntentOrdinal: state.totalPushIntentOrdinal + 1,
      currentPushOrdinal: state.totalPushIntentOrdinal + 1,
      pushObservation: UnresolvedPushIntent,
      postGrantPath: ReusableCandidate,
      selectedPostGrantPath: ReusableCandidate,
    }),
  }

  action retainBlockedConstraint: bool = all {
    state.phase == GrantBatchReady,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: GrantWaiting,
      postGrantPath: BlockedConstraint,
      selectedPostGrantPath: if (state.selectedPostGrantPath == NoPostGrantPath)
        BlockedConstraint
      else state.selectedPostGrantPath,
    }),
  }

  action closeGrantSessionWithoutIntent: bool = all {
    state.phase == GrantSessionOpen,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, { ...state, phase: GrantBatchReady }),
  }

  action recordSameCommitSuccessorCandidate: bool = all {
    state.phase == GrantSessionOpen,
    state.lifecycle == Running,
    state.hostLive,
    state.grantedSessionsUsed > 0,
    state.selectedPostGrantPath == SameCommitSuccessor,
    state.postGrantPath == SameCommitSuccessor,
    state.successorCandidateSessionOrdinal != state.currentSessionOrdinal,
    state' = recordQForwardEffect(state, {
      ...state,
      successorParent: BASE_CANDIDATE,
      successorSecondParent: ACCEPTED_TASK_COMMIT,
      successorCandidateRecorded: true,
      successorCandidateSessions: state.successorCandidateSessions.union(Set(state.currentSessionOrdinal)),
      successorCandidateSessionOrdinal: state.currentSessionOrdinal,
    }),
  }

  action retainNextPublicationExhaustion: bool = all {
    state.phase == GrantBatchReady,
    state.lifecycle == Running,
    state.hostLive,
    state.exhaustionOccurrence == state.grantOccurrence,
    state.exhaustionOccurrence < MAX_EXHAUSTION_OCCURRENCES,
    state.grantedSessionsUsed == MAX_BATCH_SESSIONS or state.grantedPushesUsed == MAX_BATCH_PUSH_INTENTS,
    state' = recordQForwardEffect(state, {
      ...state,
      phase: Exhausted,
      exhaustionOccurrence: state.exhaustionOccurrence + 1,
      exhaustionCause: if (state.grantedSessionsUsed == MAX_BATCH_SESSIONS)
        ThirdSessionExhaustion
      else ThirdPushIntentExhaustion,
      grantsForOccurrence: 0,
      grantAcknowledged: false,
      requestId: 0,
      requestDirection: NoDirection,
      requestOccurrence: 0,
    }),
  }

  action progressUnrelatedResponsibility: bool = all {
    state.lifecycle != ExitCutoff,
    state.unrelatedProgress == 0,
    state' = { ...state, unrelatedProgress: state.unrelatedProgress + 1 },
  }

  action recordLocalPromotion: bool = all {
    state.phase == ExactPublicationProofRecorded,
    state.exactRemoteProof,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, { ...state, phase: LocalPromotionRecorded, localPromotion: true }),
  }

  action refreshTaskPermission: bool = all {
    state.phase == LocalPromotionRecorded,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, { ...state, phase: FreshTaskPermissionRecorded, freshTaskPermission: true }),
  }

  action completeTaskFromExactProof: bool = all {
    state.phase == FreshTaskPermissionRecorded,
    state.exactRemoteProof,
    state.localPromotion,
    state.freshTaskPermission,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, { ...state, phase: TaskCompletionRecorded, taskCompleted: true }),
  }

  action recordExactCleanup: bool = all {
    state.phase == TaskCompletionRecorded,
    state.taskCompleted,
    not(state.cleanupComplete),
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, { ...state, cleanupComplete: true }),
  }

  action settleResponsibility: bool = all {
    state.phase == TaskCompletionRecorded,
    state.taskCompleted,
    state.cleanupComplete,
    state.exactRemoteProof,
    state.lifecycle == Running,
    state.hostLive,
    state' = recordQForwardEffect(state, { ...state, phase: ResponsibilitySettled, responsibilitySettled: true }),
  }

  action terminateRunAfterResponsibilitySettlement: bool = all {
    state.responsibilitySettled,
    state' = { ...state, runTerminated: true },
  }

  action step: bool = any {
    startInitialSession,
    closeInitialSession,
    recordInitialPushIntent,
    resolveInitialIntentWithoutProof,
    retainInitialPublicationExhaustion,
    applyPause,
    applyUnpause,
    applyExitCutoff,
    submitExactFullRerunRequest(FIRST_REQUEST_ID),
    submitExactFullRerunRequest(SECOND_REQUEST_ID),
    appendExactExhaustionGrant(FIRST_GRANT_RECEIPT),
    appendExactExhaustionGrant(SECOND_GRANT_RECEIPT),
    acknowledgeGrant,
    replaySameGrantRequest,
    crashBeforeGrantAppend,
    rejectPendingGrantAtExitCutoff,
    crashAfterGrantAppendBeforeAck,
    crashAfterGrantSessionFixation,
    crashAfterCommittedGrantIntent,
    restartHost,
    recoverCommittedGrant,
    startGrantedSuccessorSession,
    recordGrantedPushIntent,
    resolveGrantedIntentWithoutProof,
    observeExactPushPublicationProof,
    reconcileAlreadyPublishedCandidate,
    recordReusableCandidatePushIntent,
    retainBlockedConstraint,
    closeGrantSessionWithoutIntent,
    recordSameCommitSuccessorCandidate,
    retainNextPublicationExhaustion,
    progressUnrelatedResponsibility,
    recordLocalPromotion,
    refreshTaskPermission,
    completeTaskFromExactProof,
    recordExactCleanup,
    settleResponsibility,
    terminateRunAfterResponsibilitySettlement,
  }
}
