// Issue #385's finite projection of the accepted-result S2 successor boundary.
// It reuses the canonical accepted-result identities as fixed values (B, C,
// target, queue position) and abstracts Git, the Journal, the tracker, and the
// Integrator at their existing boundaries. The production-backed conformance
// lane is responsible for showing those actions compose with the canonical
// accepted-result workflow; this projection does not define a second runtime.
module acceptedResultIntegrationAutomaticSuccessorProof {
  type Phase =
    | CandidateReady
    | InitialPublicationIntent
    | InitialDiscoveryAtFixedHead
    | InitialPushInFlight
    | InitialPushRejected
    | InitialPushResponseLost
    | PublicationCompetingHead
    | ConclusivePublicationWait
    | AutomaticAuthorizationRecorded
    | BaselineReadIntentRecorded
    | BaselineObserved
    | CatchUpIntentRecorded
    | CatchUpEffectUncertain
    | CatchUpResultRecorded
    | TargetLineageProven
    | AutomaticSuccessorSessionFixed
    | AutomaticSuccessorInFlight
    | AutomaticSuccessorResponseLost
    | AutomaticSuccessorCandidateRecorded
    | AutomaticSuccessorPublicationIntent
    | AutomaticSuccessorPushInFlight
    | AutomaticSuccessorPushRejected
    | AutomaticSuccessorPublicationProved
    | BoundedRetainedWait
    | UnsafeLocalWorkRetained

  type RacePlacement =
    | NoRacePlacement
    | BeforeInitialDiscovery
    | BetweenDiscoveryAndPush
    | AfterLostPushResponse

  type LocalTargetState =
    | LocalStateUnobserved
    | LocalIsRemoteHead
    | LocalIsRemoteAncestor
    | LocalIsAhead
    | LocalIsDivergent
    | LocalIsDirty
    | LocalHasForeignWorktree
    | LocalRefIsOccupied
    | LocalStateUnreadable

  type UnsafeDisposition =
    | NoUnsafeDisposition
    | PreserveAheadTarget
    | PreserveDivergentTarget
    | PreserveDirtyTarget
    | PreserveForeignWorktree
    | PreserveOccupiedTarget
    | PreserveUnreadableTarget

  type PublicationWait =
    | NoPublicationWait
    | CompatibleCompetingHeadWait
    | ConclusiveDeniedWait
    | ThrottledWait
    | IncompatibleRemoteWait

  type ResourceDisposition =
    | NoResourceDisposition
    | PredecessorPreserved
    | PredecessorPreservedAfterStoppedWriter

  type JournalStore = MemoryJournal | ReopenedSQLiteJournal
  type Lifecycle = Running | Paused | ExitAdmitted

  type State = {
    phase: Phase,
    racePlacement: RacePlacement,
    localTargetState: LocalTargetState,
    unsafeDisposition: UnsafeDisposition,
    publicationWait: PublicationWait,
    predecessorDisposition: ResourceDisposition,
    store: JournalStore,
    lifecycle: Lifecycle,
    coordinatorLive: bool,
    lifecycleFreezeSessionCount: int,
    lifecycleFreezeAuthorizationCount: int,
    lifecycleFreezePushCount: int,
    lifecycleFreezeJournalPosition: int,
    activation: int,
    gitBoundariesThisActivation: int,
    nextJournalPosition: int,
    baseCommit: int,
    acceptedTaskCommit: int,
    acceptedEvidenceRetained: bool,
    taskBeginCount: int,
    integrationTarget: int,
    pinnedEndpoint: int,
    pinnedBranch: int,
    queuePosition: int,
    currentSession: int,
    sessionCount: int,
    predecessorSession: int,
    predecessorCandidate: int,
    predecessorCandidateFirstParent: int,
    predecessorCandidateSecondParent: int,
    predecessorWriterStopped: bool,
    currentCandidateResource: int,
    predecessorResourcesPreserved: int,
    currentExpectedHead: int,
    currentCandidate: int,
    currentCandidateFirstParent: int,
    currentCandidateSecondParent: int,
    remoteHead: int,
    localTargetHead: int,
    competingHead: int,
    competitionOccurrence: int,
    initialDiscoveryCount: int,
    publicationPushCount: int,
    publicationIntentRecorded: bool,
    publicationResponseAmbiguous: bool,
    publicationSenderStopped: bool,
    publicationOccurrenceCount: int,
    publicationAuthorizationRecorded: bool,
    authorizationCount: int,
    authorizationJournalPosition: int,
    authorizationPredecessorSession: int,
    authorizationPublicationOccurrence: int,
    authorizationBaseCommit: int,
    authorizationTaskCommit: int,
    authorizationTarget: int,
    authorizationQueuePosition: int,
    authorizationFactsCurrentWhenRecorded: bool,
    trackerFactsCurrent: bool,
    exactClaimCurrent: bool,
    controlAllowsProgress: bool,
    baselineReadIntentRecorded: bool,
    baselineReadIntentPosition: int,
    baselineReadCount: int,
    baselineReadRemoteHead: int,
    baselineReadLocalHead: int,
    catchUpIntentRecorded: bool,
    catchUpIntentPosition: int,
    catchUpIntentFrom: int,
    catchUpIntentTo: int,
    catchUpCasCount: int,
    catchUpCasCountForAuthorization: int,
    catchUpCasPosition: int,
    catchUpEffectApplied: bool,
    catchUpResultRecorded: bool,
    targetLineageObservationCount: int,
    targetLineageObservedBaseCommit: int,
    baseAncestorOfSuccessorHead: bool,
    successorSessionCount: int,
    successorFixedWithCurrentAuthority: bool,
    successorSession: int,
    successorResource: int,
    successorResourceBoundTarget: int,
    successorResourceBoundHead: int,
    successorResourceBoundCommit: int,
    successorExpectedHead: int,
    successorCandidate: int,
    successorCandidateFirstParent: int,
    successorCandidateSecondParent: int,
    successorRunOrdinal: int,
    successorInvocationCount: int,
    successorResumeCount: int,
    successorStoppedWriterReconciled: bool,
    successorWriterInFlight: bool,
    successorWriterStopped: bool,
    successorPublicationIntentCount: int,
    successorPublicationForceRequested: bool,
    taskWorktreeRetained: bool,
    resourceHeadUsedAsCandidate: bool,
    processSuccessUsedAsProof: bool,
  }

  var state: State

  pure val BASE_COMMIT = 5
  pure val INITIAL_HEAD = 10
  pure val ACCEPTED_TASK_COMMIT = 20
  pure val INITIAL_CANDIDATE = 30
  pure val TASK_TARGET = 40
  pure val PINNED_ENDPOINT = 50
  pure val PINNED_BRANCH = 60
  pure val ORIGINAL_QUEUE_POSITION = 1
  pure val INITIAL_SESSION = 1
  pure val INITIAL_RESOURCE = 101
  pure val MAX_SESSIONS = 3
  pure val MAX_PUBLICATION_PUSHES = 3

  pure def isRunning(s: State): bool =
    s.lifecycle == Running and s.coordinatorLive

  pure def safeLocalTarget(s: State): bool =
    s.localTargetState == LocalIsRemoteHead or s.localTargetState == LocalIsRemoteAncestor

  pure def unsafeDispositionFor(local: LocalTargetState): UnsafeDisposition =
    if (local == LocalIsAhead) PreserveAheadTarget
    else if (local == LocalIsDivergent) PreserveDivergentTarget
    else if (local == LocalIsDirty) PreserveDirtyTarget
    else if (local == LocalHasForeignWorktree) PreserveForeignWorktree
    else if (local == LocalRefIsOccupied) PreserveOccupiedTarget
    else PreserveUnreadableTarget

  val journalFirstAutomaticAuthorization: bool =
    not(state.publicationAuthorizationRecorded) or and {
      state.authorizationJournalPosition > 0,
      state.authorizationPredecessorSession == state.predecessorSession,
      state.authorizationPublicationOccurrence == state.competitionOccurrence,
      state.authorizationBaseCommit == BASE_COMMIT,
      state.authorizationTaskCommit == ACCEPTED_TASK_COMMIT,
      state.authorizationTarget == TASK_TARGET,
      state.authorizationQueuePosition == ORIGINAL_QUEUE_POSITION,
      state.phase != BaselineReadIntentRecorded or
        state.authorizationJournalPosition < state.baselineReadIntentPosition,
      state.baselineReadIntentPosition == 0 or
        state.authorizationJournalPosition < state.baselineReadIntentPosition,
    }

  val authorizationRequiresCurrentExactAuthority: bool =
    not(state.publicationAuthorizationRecorded) or and {
      state.authorizationFactsCurrentWhenRecorded,
      state.publicationWait == CompatibleCompetingHeadWait,
      state.competitionOccurrence > 0,
      state.predecessorWriterStopped,
      state.authorizationPredecessorSession == state.predecessorSession,
      state.sessionCount < MAX_SESSIONS,
      state.authorizationCount <= MAX_SESSIONS - 1,
    }

  val catchUpRequiresJournaledExactCompareAndSet: bool =
    state.catchUpCasCountForAuthorization == 0 or and {
      state.catchUpIntentRecorded,
      state.catchUpIntentPosition > 0,
      state.catchUpIntentPosition < state.catchUpCasPosition,
      state.catchUpIntentFrom == state.baselineReadLocalHead,
      state.catchUpIntentTo == state.baselineReadRemoteHead,
      state.catchUpIntentTo == state.competingHead,
      state.baselineReadLocalHead < state.baselineReadRemoteHead,
      state.localTargetHead == state.catchUpIntentTo,
      state.localTargetState == LocalIsRemoteHead,
      state.catchUpCasCountForAuthorization == 1,
      state.catchUpEffectApplied,
    }

  val localCatchUpPreservesUnsafeWork: bool =
    state.localTargetState != LocalIsAhead
      and state.localTargetState != LocalIsDivergent
      and state.localTargetState != LocalIsDirty
      and state.localTargetState != LocalHasForeignWorktree
      and state.localTargetState != LocalRefIsOccupied
      and state.localTargetState != LocalStateUnreadable
      or and {
        state.phase == UnsafeLocalWorkRetained,
        state.unsafeDisposition == unsafeDispositionFor(state.localTargetState),
        not(state.catchUpIntentRecorded),
        state.catchUpCasCountForAuthorization == 0,
        state.localTargetHead == state.baselineReadLocalHead,
        not(state.baseAncestorOfSuccessorHead),
      }

  val successorKeepsAcceptedResultLineage: bool =
    state.successorSession == 0 or and {
      state.currentSession == state.successorSession,
      state.successorExpectedHead == state.competingHead,
      state.successorResource != INITIAL_RESOURCE,
      state.successorResourceBoundTarget == TASK_TARGET,
      state.successorResourceBoundHead == state.successorExpectedHead,
      state.successorResourceBoundCommit == ACCEPTED_TASK_COMMIT,
      state.successorCandidate == 0 or and {
        state.successorCandidateFirstParent == state.successorExpectedHead,
        state.successorCandidateSecondParent == ACCEPTED_TASK_COMMIT,
      },
      state.acceptedTaskCommit == ACCEPTED_TASK_COMMIT,
      state.authorizationBaseCommit == BASE_COMMIT,
      state.authorizationQueuePosition == ORIGINAL_QUEUE_POSITION,
      state.taskBeginCount == 1,
      state.taskWorktreeRetained,
    }

  val successorRequiresFreshBaseLineageAndJournaledAuthorization: bool =
    state.successorSession == 0 or and {
      state.publicationAuthorizationRecorded,
      state.authorizationCount == state.successorSessionCount,
      state.baseAncestorOfSuccessorHead,
      state.targetLineageObservationCount > 0,
      state.targetLineageObservedBaseCommit == BASE_COMMIT,
      state.successorFixedWithCurrentAuthority,
      state.authorizationFactsCurrentWhenRecorded,
      state.predecessorWriterStopped,
      state.predecessorResourcesPreserved == state.successorSessionCount,
    }

  val successorRecoveryReusesOneFixedRun: bool =
    state.successorResumeCount == 0 or and {
      state.successorSession != 0,
      state.successorRunOrdinal == 1,
      state.successorInvocationCount == 1,
      state.successorResumeCount <= 2,
      state.successorStoppedWriterReconciled,
    }

  val automaticSuccessorBoundsAreFinite: bool = and {
    state.sessionCount >= 1,
    state.sessionCount <= MAX_SESSIONS,
    state.authorizationCount >= 0,
    state.authorizationCount <= MAX_SESSIONS - 1,
    state.successorSessionCount >= 0,
    state.successorSessionCount <= MAX_SESSIONS - 1,
    state.sessionCount == 1 + state.successorSessionCount,
      state.publicationPushCount >= 0,
      state.publicationPushCount <= MAX_PUBLICATION_PUSHES,
    state.successorPublicationIntentCount >= 0,
    state.successorPublicationIntentCount <= MAX_PUBLICATION_PUSHES - 1,
    state.publicationSenderStopped
      or state.phase == InitialPushInFlight
      or state.phase == AutomaticSuccessorPushInFlight,
  }

  val automaticAuthorizationIsOccurrenceScoped: bool =
    not(state.publicationAuthorizationRecorded) or and {
      state.authorizationCount > 0,
      state.authorizationCount == state.successorSessionCount
        or state.authorizationCount == state.successorSessionCount + 1,
      state.authorizationPredecessorSession == state.predecessorSession,
      state.authorizationPublicationOccurrence == state.competitionOccurrence,
    }

  val predecessorCleanupRequiresStoppedWriter: bool =
    state.predecessorDisposition != PredecessorPreservedAfterStoppedWriter
      or state.predecessorWriterStopped

  val noUnrequestedFourthSession: bool =
    state.sessionCount < MAX_SESSIONS or and {
      state.phase == BoundedRetainedWait
        or state.phase == AutomaticSuccessorSessionFixed
        or state.phase == AutomaticSuccessorInFlight
        or state.phase == AutomaticSuccessorResponseLost
        or state.phase == AutomaticSuccessorCandidateRecorded
        or state.phase == AutomaticSuccessorPublicationIntent
        or state.phase == AutomaticSuccessorPushInFlight
        or state.phase == AutomaticSuccessorPushRejected
        or state.phase == AutomaticSuccessorPublicationProved,
      state.authorizationCount <= MAX_SESSIONS - 1,
      state.successorSession <= MAX_SESSIONS,
    }

  val oneGitObservationOrCompareAndSetPerActivation: bool =
    state.gitBoundariesThisActivation >= 0 and state.gitBoundariesThisActivation <= 1

  val noReadUntilStableLoop: bool = and {
    state.baselineReadCount <= state.activation,
    state.catchUpCasCount <= state.authorizationCount,
  }

  val pauseAndExitStopNewSuccessorActions: bool =
    state.lifecycle == Running or and {
      state.sessionCount == state.lifecycleFreezeSessionCount,
      state.authorizationCount == state.lifecycleFreezeAuthorizationCount,
      state.publicationPushCount == state.lifecycleFreezePushCount,
      state.nextJournalPosition == state.lifecycleFreezeJournalPosition,
    }

  val exactTaskAndResponsibilityAreRetained: bool = and {
    state.baseCommit == BASE_COMMIT,
    state.acceptedTaskCommit == ACCEPTED_TASK_COMMIT,
    state.acceptedEvidenceRetained,
    state.taskBeginCount == 1,
    state.integrationTarget == TASK_TARGET,
    state.pinnedEndpoint == PINNED_ENDPOINT,
    state.pinnedBranch == PINNED_BRANCH,
      state.queuePosition == ORIGINAL_QUEUE_POSITION,
      state.taskWorktreeRetained,
  }

  val forbiddenProofAndForceShortcutsRemainFalse: bool = and {
    not(state.successorPublicationForceRequested),
    not(state.resourceHeadUsedAsCandidate),
    not(state.processSuccessUsedAsProof),
  }

  val proofStateIsBounded: bool = and {
    state.activation >= 0,
    state.activation <= 8,
    state.nextJournalPosition >= 1,
    state.baselineReadCount >= 0,
    state.baselineReadCount <= 8,
    state.catchUpCasCount >= 0,
    state.catchUpCasCount <= MAX_SESSIONS - 1,
    state.targetLineageObservationCount >= 0,
    state.targetLineageObservationCount <= 8,
    state.successorInvocationCount >= 0,
    state.successorInvocationCount <= 1,
    state.successorResumeCount >= 0,
    state.successorResumeCount <= 2,
  }

  val competingHeadRetainedReached: bool = state.phase == PublicationCompetingHead
  val automaticAuthorizationReached: bool = state.publicationAuthorizationRecorded
  val baselineReadReached: bool = state.baselineReadCount > 0
  val catchUpIntentReached: bool = state.catchUpIntentRecorded
  val catchUpAppliedReached: bool = state.catchUpResultRecorded
  val successorSessionFixedReached: bool = state.successorSession != 0
  val successorRecoveryReached: bool = state.successorResumeCount > 0
  val boundedWaitReached: bool = state.phase == BoundedRetainedWait
  val unsafeLocalWaitReached: bool = state.phase == UnsafeLocalWorkRetained

  action init: bool = all {
    state' = {
      phase: CandidateReady,
      racePlacement: NoRacePlacement,
      localTargetState: LocalStateUnobserved,
      unsafeDisposition: NoUnsafeDisposition,
      publicationWait: NoPublicationWait,
      predecessorDisposition: PredecessorPreserved,
      store: MemoryJournal,
      lifecycle: Running,
      coordinatorLive: true,
      lifecycleFreezeSessionCount: 0,
      lifecycleFreezeAuthorizationCount: 0,
      lifecycleFreezePushCount: 0,
      lifecycleFreezeJournalPosition: 0,
      activation: 0,
      gitBoundariesThisActivation: 0,
      nextJournalPosition: 1,
      baseCommit: BASE_COMMIT,
      acceptedTaskCommit: ACCEPTED_TASK_COMMIT,
      acceptedEvidenceRetained: true,
      taskBeginCount: 1,
      integrationTarget: TASK_TARGET,
      pinnedEndpoint: PINNED_ENDPOINT,
      pinnedBranch: PINNED_BRANCH,
      queuePosition: ORIGINAL_QUEUE_POSITION,
      currentSession: INITIAL_SESSION,
      sessionCount: 1,
      predecessorSession: INITIAL_SESSION,
      predecessorCandidate: INITIAL_CANDIDATE,
      predecessorCandidateFirstParent: INITIAL_HEAD,
      predecessorCandidateSecondParent: ACCEPTED_TASK_COMMIT,
      predecessorWriterStopped: true,
      currentCandidateResource: INITIAL_RESOURCE,
      predecessorResourcesPreserved: 0,
      currentExpectedHead: INITIAL_HEAD,
      currentCandidate: INITIAL_CANDIDATE,
      currentCandidateFirstParent: INITIAL_HEAD,
      currentCandidateSecondParent: ACCEPTED_TASK_COMMIT,
      remoteHead: INITIAL_HEAD,
      localTargetHead: INITIAL_HEAD,
      competingHead: 0,
      competitionOccurrence: 0,
      initialDiscoveryCount: 0,
      publicationPushCount: 0,
      publicationIntentRecorded: false,
      publicationResponseAmbiguous: false,
      publicationSenderStopped: true,
      publicationOccurrenceCount: 0,
      publicationAuthorizationRecorded: false,
      authorizationCount: 0,
      authorizationJournalPosition: 0,
      authorizationPredecessorSession: 0,
      authorizationPublicationOccurrence: 0,
      authorizationBaseCommit: 0,
      authorizationTaskCommit: 0,
      authorizationTarget: 0,
      authorizationQueuePosition: 0,
      authorizationFactsCurrentWhenRecorded: false,
      trackerFactsCurrent: true,
      exactClaimCurrent: true,
      controlAllowsProgress: true,
      baselineReadIntentRecorded: false,
      baselineReadIntentPosition: 0,
      baselineReadCount: 0,
      baselineReadRemoteHead: 0,
      baselineReadLocalHead: 0,
      catchUpIntentRecorded: false,
      catchUpIntentPosition: 0,
      catchUpIntentFrom: 0,
      catchUpIntentTo: 0,
      catchUpCasCount: 0,
      catchUpCasCountForAuthorization: 0,
      catchUpCasPosition: 0,
      catchUpEffectApplied: false,
      catchUpResultRecorded: false,
      targetLineageObservationCount: 0,
      targetLineageObservedBaseCommit: 0,
      baseAncestorOfSuccessorHead: false,
      successorSessionCount: 0,
      successorFixedWithCurrentAuthority: false,
      successorSession: 0,
      successorResource: 0,
      successorResourceBoundTarget: 0,
      successorResourceBoundHead: 0,
      successorResourceBoundCommit: 0,
      successorExpectedHead: 0,
      successorCandidate: 0,
      successorCandidateFirstParent: 0,
      successorCandidateSecondParent: 0,
      successorRunOrdinal: 0,
      successorInvocationCount: 0,
      successorResumeCount: 0,
      successorStoppedWriterReconciled: false,
      successorWriterInFlight: false,
      successorWriterStopped: false,
      successorPublicationIntentCount: 0,
      successorPublicationForceRequested: false,
      taskWorktreeRetained: true,
      resourceHeadUsedAsCandidate: false,
      processSuccessUsedAsProof: false,
    },
  }

  action selectReopenedSQLiteJournal: bool = all {
    state.phase == CandidateReady,
    state' = { ...state, store: ReopenedSQLiteJournal },
  }

  action recordInitialPublicationIntent: bool = all {
    isRunning(state),
    state.phase == CandidateReady,
    state.nextJournalPosition > 0,
    state' = {
      ...state,
      phase: InitialPublicationIntent,
      publicationIntentRecorded: true,
      publicationSenderStopped: true,
      nextJournalPosition: state.nextJournalPosition + 1,
    },
  }

  // Outside Git work is a real event; it never writes Dalph's local target.
  action outsidePushBeforeInitialDiscovery: bool = all {
    isRunning(state),
    state.phase == InitialPublicationIntent,
    state.racePlacement == NoRacePlacement,
    state' = {
      ...state,
      racePlacement: BeforeInitialDiscovery,
      remoteHead: INITIAL_HEAD + 1,
    },
  }

  action discoverInitialFixedHead: bool = all {
    isRunning(state),
    state.phase == InitialPublicationIntent,
    state.racePlacement == NoRacePlacement,
    state.gitBoundariesThisActivation == 0,
    state.remoteHead == INITIAL_HEAD,
    state' = {
      ...state,
      phase: InitialDiscoveryAtFixedHead,
      initialDiscoveryCount: 1,
      gitBoundariesThisActivation: 1,
    },
  }

  action outsidePushBetweenDiscoveryAndPublication: bool = all {
    isRunning(state),
    state.phase == InitialDiscoveryAtFixedHead,
    state.racePlacement == NoRacePlacement,
    state.remoteHead == INITIAL_HEAD,
    state' = {
      ...state,
      racePlacement: BetweenDiscoveryAndPush,
      remoteHead: INITIAL_HEAD + 1,
    },
  }

  action sendInitialCandidate: bool = all {
    isRunning(state),
    state.publicationIntentRecorded,
    state.publicationPushCount == 0,
    state.phase == InitialPublicationIntent or state.phase == InitialDiscoveryAtFixedHead,
    state' = {
      ...state,
      phase: InitialPushInFlight,
      publicationPushCount: 1,
      publicationSenderStopped: false,
    },
  }

  action rejectInitialPushAtCompetingHead: bool = all {
    isRunning(state),
    state.phase == InitialPushInFlight,
    state.racePlacement == BetweenDiscoveryAndPush,
    state.initialDiscoveryCount == 1,
    state.remoteHead == INITIAL_HEAD + 1,
    state.publicationPushCount == 1,
    state' = {
      ...state,
      phase: InitialPushRejected,
      publicationSenderStopped: true,
      publicationWait: NoPublicationWait,
    },
  }

  action outsidePushAfterAmbiguousInitialResponse: bool = all {
    isRunning(state),
    state.phase == InitialPushInFlight,
    state.racePlacement == NoRacePlacement,
    state' = {
      ...state,
      racePlacement: AfterLostPushResponse,
      remoteHead: INITIAL_HEAD + 1,
    },
  }

  action loseInitialPushResponse: bool = all {
    isRunning(state),
    state.phase == InitialPushInFlight,
    state.racePlacement == AfterLostPushResponse,
    state.publicationPushCount == 1,
    state' = {
      ...state,
      phase: InitialPushResponseLost,
      publicationResponseAmbiguous: true,
      publicationSenderStopped: true,
    },
  }

  action discoverCompatibleCompetingHead: bool = all {
    isRunning(state),
    state.publicationIntentRecorded,
    state.remoteHead == INITIAL_HEAD + 1,
    state.phase == InitialPublicationIntent
      or state.phase == InitialPushRejected
      or state.phase == InitialPushResponseLost,
    state.racePlacement == BeforeInitialDiscovery
      or state.racePlacement == BetweenDiscoveryAndPush
      or state.racePlacement == AfterLostPushResponse,
    state.gitBoundariesThisActivation == 0,
    state.phase != InitialPushResponseLost or and {
      state.publicationResponseAmbiguous,
      state.publicationSenderStopped,
    },
    state' = {
      ...state,
      phase: PublicationCompetingHead,
      publicationWait: CompatibleCompetingHeadWait,
      competingHead: state.remoteHead,
      competitionOccurrence: state.publicationOccurrenceCount + 1,
      publicationOccurrenceCount: state.publicationOccurrenceCount + 1,
      publicationResponseAmbiguous: false,
      publicationSenderStopped: true,
      gitBoundariesThisActivation: 1,
    },
  }

  // The coordinator starts a new activation after the one admitted Git
  // observation. The durable authorization remains the same; current tracker,
  // claim, and control facts must be reread before its next external effect.
  action beginNextActivation: bool = all {
    isRunning(state),
    state.gitBoundariesThisActivation == 1,
    state.activation < 8,
    state' = {
      ...state,
      activation: state.activation + 1,
      gitBoundariesThisActivation: 0,
      trackerFactsCurrent: false,
      exactClaimCurrent: false,
      controlAllowsProgress: false,
    },
  }

  action recordConclusiveDeniedWait: bool = all {
    isRunning(state),
    state.phase == InitialPushInFlight,
    state' = {
      ...state,
      phase: ConclusivePublicationWait,
      publicationWait: ConclusiveDeniedWait,
      publicationSenderStopped: true,
      publicationOccurrenceCount: state.publicationOccurrenceCount + 1,
    },
  }

  action recordThrottledWait: bool = all {
    isRunning(state),
    state.phase == InitialPushInFlight,
    state' = {
      ...state,
      phase: ConclusivePublicationWait,
      publicationWait: ThrottledWait,
      publicationSenderStopped: true,
      publicationOccurrenceCount: state.publicationOccurrenceCount + 1,
    },
  }

  action recordIncompatibleRemoteWait: bool = all {
    isRunning(state),
    state.phase == InitialPushInFlight,
    state' = {
      ...state,
      phase: ConclusivePublicationWait,
      publicationWait: IncompatibleRemoteWait,
      publicationSenderStopped: true,
      publicationOccurrenceCount: state.publicationOccurrenceCount + 1,
    },
  }

  action setCurrentAuthorityFacts: bool = all {
    isRunning(state),
    state.phase == PublicationCompetingHead or state.phase == AutomaticAuthorizationRecorded,
    state' = {
      ...state,
      trackerFactsCurrent: true,
      exactClaimCurrent: true,
      controlAllowsProgress: true,
    },
  }

  action denyCurrentAuthorityFacts: bool = all {
    isRunning(state),
    state.phase == PublicationCompetingHead,
    state' = {
      ...state,
      trackerFactsCurrent: false,
      exactClaimCurrent: false,
      controlAllowsProgress: false,
    },
  }

  action recordAutomaticSuccessorAuthorization: bool = all {
    isRunning(state),
    state.phase == PublicationCompetingHead,
    state.publicationWait == CompatibleCompetingHeadWait,
    state.sessionCount < MAX_SESSIONS,
    state.authorizationCount == state.successorSessionCount,
    state.trackerFactsCurrent,
    state.exactClaimCurrent,
    state.controlAllowsProgress,
    state.predecessorWriterStopped,
    state.predecessorSession == state.currentSession,
    state.competitionOccurrence > 0,
    state.nextJournalPosition > 0,
    state' = {
      ...state,
      phase: AutomaticAuthorizationRecorded,
      publicationAuthorizationRecorded: true,
      authorizationCount: state.authorizationCount + 1,
      authorizationJournalPosition: state.nextJournalPosition,
      authorizationPredecessorSession: state.predecessorSession,
      authorizationPublicationOccurrence: state.competitionOccurrence,
      authorizationBaseCommit: BASE_COMMIT,
      authorizationTaskCommit: ACCEPTED_TASK_COMMIT,
      authorizationTarget: TASK_TARGET,
      authorizationQueuePosition: ORIGINAL_QUEUE_POSITION,
      authorizationFactsCurrentWhenRecorded: true,
      predecessorDisposition: PredecessorPreservedAfterStoppedWriter,
      predecessorResourcesPreserved: state.predecessorResourcesPreserved + 1,
      nextJournalPosition: state.nextJournalPosition + 1,
      baselineReadIntentRecorded: false,
      baselineReadIntentPosition: 0,
      baselineReadRemoteHead: 0,
      baselineReadLocalHead: 0,
      catchUpIntentRecorded: false,
      catchUpIntentPosition: 0,
      catchUpIntentFrom: 0,
      catchUpIntentTo: 0,
      catchUpEffectApplied: false,
      catchUpResultRecorded: false,
      catchUpCasCountForAuthorization: 0,
      baseAncestorOfSuccessorHead: false,
      targetLineageObservationCount: 0,
      targetLineageObservedBaseCommit: 0,
      successorSession: 0,
      successorResource: 0,
      successorResourceBoundTarget: 0,
      successorResourceBoundHead: 0,
      successorResourceBoundCommit: 0,
      successorExpectedHead: 0,
      successorCandidate: 0,
      successorCandidateFirstParent: 0,
      successorCandidateSecondParent: 0,
      successorRunOrdinal: 0,
      successorInvocationCount: 0,
      successorResumeCount: 0,
      successorStoppedWriterReconciled: false,
      successorWriterInFlight: false,
      successorWriterStopped: false,
    },
  }

  action recordRemoteBaselineReadIntent: bool = all {
    isRunning(state),
    state.phase == AutomaticAuthorizationRecorded,
    state.publicationAuthorizationRecorded,
    state.trackerFactsCurrent,
    state.exactClaimCurrent,
    state.controlAllowsProgress,
    state.authorizationJournalPosition > 0,
    state.nextJournalPosition > state.authorizationJournalPosition,
    not(state.baselineReadIntentRecorded),
    state' = {
      ...state,
      phase: BaselineReadIntentRecorded,
      baselineReadIntentRecorded: true,
      baselineReadIntentPosition: state.nextJournalPosition,
      nextJournalPosition: state.nextJournalPosition + 1,
    },
  }

  action observeAncestorLocalBaseline: bool = all {
    isRunning(state),
    state.phase == BaselineReadIntentRecorded,
    state.baselineReadIntentRecorded,
    state.authorizationJournalPosition < state.baselineReadIntentPosition,
    state.gitBoundariesThisActivation == 0,
    state.remoteHead == state.competingHead,
    state.localTargetHead < state.remoteHead,
    state' = {
      ...state,
      phase: BaselineObserved,
      localTargetState: LocalIsRemoteAncestor,
      baselineReadCount: state.baselineReadCount + 1,
      baselineReadRemoteHead: state.remoteHead,
      baselineReadLocalHead: state.localTargetHead,
      gitBoundariesThisActivation: 1,
    },
  }

  action observeAlreadyCurrentLocalBaseline: bool = all {
    isRunning(state),
    state.phase == BaselineReadIntentRecorded,
    state.gitBoundariesThisActivation == 0,
    state.remoteHead == state.competingHead,
    state.localTargetHead == state.remoteHead,
    state' = {
      ...state,
      phase: BaselineObserved,
      localTargetState: LocalIsRemoteHead,
      baselineReadCount: state.baselineReadCount + 1,
      baselineReadRemoteHead: state.remoteHead,
      baselineReadLocalHead: state.localTargetHead,
      gitBoundariesThisActivation: 1,
    },
  }

  action outsideTargetAlreadyMatchesRemote: bool = all {
    isRunning(state),
    state.phase == BaselineReadIntentRecorded,
    state.remoteHead == state.competingHead,
    state' = { ...state, localTargetHead: state.remoteHead },
  }

  action observeUnsafeLocalBaseline(local: LocalTargetState): bool = all {
    isRunning(state),
    state.phase == BaselineReadIntentRecorded,
    state.gitBoundariesThisActivation == 0,
    local == LocalIsAhead
      or local == LocalIsDivergent
      or local == LocalIsDirty
      or local == LocalHasForeignWorktree
      or local == LocalRefIsOccupied
      or local == LocalStateUnreadable,
    state' = {
      ...state,
      phase: UnsafeLocalWorkRetained,
      localTargetState: local,
      unsafeDisposition: unsafeDispositionFor(local),
      baselineReadCount: state.baselineReadCount + 1,
      baselineReadRemoteHead: state.remoteHead,
      baselineReadLocalHead: state.localTargetHead,
      gitBoundariesThisActivation: 1,
    },
  }

  action observeAnyUnsafeLocalBaseline: bool = {
    nondet local = Set(
      LocalIsAhead,
      LocalIsDivergent,
      LocalIsDirty,
      LocalHasForeignWorktree,
      LocalRefIsOccupied,
      LocalStateUnreadable,
    ).oneOf()
    all {
      isRunning(state),
      state.phase == BaselineReadIntentRecorded,
      state.gitBoundariesThisActivation == 0,
      state' = {
        ...state,
        phase: UnsafeLocalWorkRetained,
        localTargetState: local,
        unsafeDisposition: unsafeDispositionFor(local),
        baselineReadCount: state.baselineReadCount + 1,
        baselineReadRemoteHead: state.remoteHead,
        baselineReadLocalHead: state.localTargetHead,
        gitBoundariesThisActivation: 1,
      },
    }
  }

  action recordCatchUpIntent: bool = all {
    isRunning(state),
    state.phase == BaselineObserved,
    state.localTargetState == LocalIsRemoteAncestor,
    state.baselineReadIntentRecorded,
    not(state.catchUpIntentRecorded),
    state.baselineReadLocalHead < state.baselineReadRemoteHead,
    state.baselineReadRemoteHead == state.competingHead,
    state.nextJournalPosition > state.baselineReadIntentPosition,
    state' = {
      ...state,
      phase: CatchUpIntentRecorded,
      catchUpIntentRecorded: true,
      catchUpIntentPosition: state.nextJournalPosition,
      catchUpIntentFrom: state.baselineReadLocalHead,
      catchUpIntentTo: state.baselineReadRemoteHead,
      nextJournalPosition: state.nextJournalPosition + 1,
    },
  }

  action compareAndSetLocalTargetToRemoteHead: bool = all {
    isRunning(state),
    state.phase == CatchUpIntentRecorded,
    state.catchUpIntentRecorded,
    state.trackerFactsCurrent,
    state.exactClaimCurrent,
    state.controlAllowsProgress,
    state.catchUpCasCountForAuthorization == 0,
    state.gitBoundariesThisActivation == 0,
    state.localTargetHead == state.catchUpIntentFrom,
    state.localTargetState == LocalIsRemoteAncestor,
    state.remoteHead == state.catchUpIntentTo,
    state.catchUpIntentFrom < state.catchUpIntentTo,
    state.predecessorWriterStopped,
    state' = {
      ...state,
      phase: CatchUpEffectUncertain,
      localTargetHead: state.catchUpIntentTo,
      localTargetState: LocalIsRemoteHead,
      catchUpCasCount: state.catchUpCasCount + 1,
      catchUpCasCountForAuthorization: state.catchUpCasCountForAuthorization + 1,
      catchUpCasPosition: state.nextJournalPosition,
      catchUpEffectApplied: true,
      predecessorDisposition: PredecessorPreservedAfterStoppedWriter,
      gitBoundariesThisActivation: 1,
    },
  }

  action recordCatchUpResult: bool = all {
    isRunning(state),
    state.phase == CatchUpEffectUncertain,
    state.catchUpEffectApplied,
    state.localTargetHead == state.catchUpIntentTo,
    state.localTargetState == LocalIsRemoteHead,
    state' = {
      ...state,
      phase: CatchUpResultRecorded,
      catchUpResultRecorded: true,
      nextJournalPosition: state.nextJournalPosition + 1,
    },
  }

  action observeCatchUpAfterRecovery: bool = all {
    isRunning(state),
    state.coordinatorLive,
    state.phase == CatchUpEffectUncertain,
    state.activation > 0,
    state.gitBoundariesThisActivation == 0,
    state.trackerFactsCurrent,
    state.exactClaimCurrent,
    state.controlAllowsProgress,
    state.catchUpIntentRecorded,
    state.catchUpIntentPosition < state.catchUpCasPosition,
    state.localTargetHead == state.catchUpIntentTo,
    state.localTargetState == LocalIsRemoteHead,
    state.remoteHead == state.catchUpIntentTo,
    state' = {
      ...state,
      phase: CatchUpResultRecorded,
      catchUpResultRecorded: true,
      gitBoundariesThisActivation: 1,
      nextJournalPosition: state.nextJournalPosition + 1,
    },
  }

  action proveBaseAncestorOfSuccessorHead: bool = all {
    isRunning(state),
    state.phase == BaselineObserved
      or state.phase == CatchUpResultRecorded
      or state.phase == TargetLineageProven,
    state.localTargetHead == state.competingHead,
    state.localTargetState == LocalIsRemoteHead,
    state.catchUpIntentRecorded implies state.catchUpResultRecorded,
    state.gitBoundariesThisActivation == 0,
    state.trackerFactsCurrent,
    state.exactClaimCurrent,
    state.controlAllowsProgress,
    state' = {
      ...state,
      phase: TargetLineageProven,
      targetLineageObservationCount: state.targetLineageObservationCount + 1,
      targetLineageObservedBaseCommit: BASE_COMMIT,
      baseAncestorOfSuccessorHead: true,
      gitBoundariesThisActivation: 1,
    },
  }

  action fixAutomaticSuccessorSession: bool = all {
    isRunning(state),
    state.phase == TargetLineageProven,
    state.publicationAuthorizationRecorded,
    state.authorizationCount == state.successorSessionCount + 1,
    state.sessionCount < MAX_SESSIONS,
    state.baseAncestorOfSuccessorHead,
    state.localTargetHead == state.competingHead,
    state.trackerFactsCurrent,
    state.exactClaimCurrent,
    state.controlAllowsProgress,
    state.predecessorWriterStopped,
    state' = {
      ...state,
      phase: AutomaticSuccessorSessionFixed,
      predecessorSession: state.currentSession,
      predecessorCandidate: state.currentCandidate,
      predecessorCandidateFirstParent: state.currentCandidateFirstParent,
      predecessorCandidateSecondParent: state.currentCandidateSecondParent,
      currentSession: state.currentSession + 1,
      sessionCount: state.sessionCount + 1,
      currentExpectedHead: state.competingHead,
      currentCandidate: 0,
      currentCandidateFirstParent: 0,
      currentCandidateSecondParent: 0,
      currentCandidateResource: INITIAL_RESOURCE + state.currentSession + 1,
      successorSessionCount: state.successorSessionCount + 1,
      successorSession: state.currentSession + 1,
      successorFixedWithCurrentAuthority: true,
      successorResource: INITIAL_RESOURCE + state.currentSession + 1,
      successorResourceBoundTarget: TASK_TARGET,
      successorResourceBoundHead: state.competingHead,
      successorResourceBoundCommit: ACCEPTED_TASK_COMMIT,
      successorExpectedHead: state.competingHead,
      successorCandidate: 0,
      successorCandidateFirstParent: 0,
      successorCandidateSecondParent: 0,
      successorRunOrdinal: 1,
      successorInvocationCount: 0,
      successorResumeCount: 0,
      successorWriterInFlight: false,
      successorWriterStopped: false,
      predecessorDisposition: PredecessorPreservedAfterStoppedWriter,
    },
  }

  action invokeAutomaticSuccessor: bool = all {
    isRunning(state),
    state.phase == AutomaticSuccessorSessionFixed,
    state.successorSession != 0,
    state.successorRunOrdinal == 1,
    state.successorInvocationCount == 0,
    state.trackerFactsCurrent,
    state.exactClaimCurrent,
    state.controlAllowsProgress,
    state' = {
      ...state,
      phase: AutomaticSuccessorInFlight,
      successorInvocationCount: 1,
      successorWriterInFlight: true,
      successorWriterStopped: false,
    },
  }

  action loseAutomaticSuccessorResponse: bool = all {
    isRunning(state),
    state.phase == AutomaticSuccessorInFlight,
    state.successorInvocationCount == 1,
    state' = {
      ...state,
      phase: AutomaticSuccessorResponseLost,
      successorWriterInFlight: true,
      successorWriterStopped: false,
    },
  }

  action proveAutomaticSuccessorWriterStopped: bool = all {
    isRunning(state),
    state.phase == AutomaticSuccessorResponseLost,
    state.successorWriterInFlight,
    state' = {
      ...state,
      successorWriterStopped: true,
      successorStoppedWriterReconciled: true,
      predecessorDisposition: PredecessorPreservedAfterStoppedWriter,
    },
  }

  action resumeAutomaticSuccessorSameRun: bool = all {
    isRunning(state),
    state.phase == AutomaticSuccessorResponseLost,
    state.successorWriterStopped,
    state.successorRunOrdinal == 1,
    state.successorInvocationCount == 1,
    state.trackerFactsCurrent,
    state.exactClaimCurrent,
    state.controlAllowsProgress,
    state' = {
      ...state,
      phase: AutomaticSuccessorInFlight,
      successorResumeCount: state.successorResumeCount + 1,
      successorWriterInFlight: true,
      successorWriterStopped: false,
    },
  }

  action reportAutomaticSuccessorCandidate: bool = all {
    isRunning(state),
    state.phase == AutomaticSuccessorInFlight,
    state.successorSession != 0,
    state.successorWriterInFlight,
    state' = {
      ...state,
      phase: AutomaticSuccessorCandidateRecorded,
      currentCandidate: 300 + state.successorSession,
      currentCandidateFirstParent: state.successorExpectedHead,
      currentCandidateSecondParent: ACCEPTED_TASK_COMMIT,
      successorCandidate: 300 + state.successorSession,
      successorCandidateFirstParent: state.successorExpectedHead,
      successorCandidateSecondParent: ACCEPTED_TASK_COMMIT,
      successorWriterInFlight: false,
      successorWriterStopped: true,
      successorStoppedWriterReconciled: true,
      predecessorDisposition: PredecessorPreservedAfterStoppedWriter,
    },
  }

  action recordSuccessorPublicationIntent: bool = all {
    isRunning(state),
    state.phase == AutomaticSuccessorCandidateRecorded,
    state.successorCandidate != 0,
    state.successorCandidateFirstParent == state.successorExpectedHead,
    state.successorCandidateSecondParent == ACCEPTED_TASK_COMMIT,
    state.publicationPushCount < MAX_PUBLICATION_PUSHES,
    state.nextJournalPosition > 0,
    state' = {
      ...state,
      phase: AutomaticSuccessorPublicationIntent,
      successorPublicationIntentCount: state.successorPublicationIntentCount + 1,
      publicationIntentRecorded: true,
      publicationSenderStopped: true,
      nextJournalPosition: state.nextJournalPosition + 1,
    },
  }

  action sendSuccessorPublication: bool = all {
    isRunning(state),
    state.phase == AutomaticSuccessorPublicationIntent,
    state.successorPublicationIntentCount > 0,
    state.publicationPushCount < MAX_PUBLICATION_PUSHES,
    not(state.successorPublicationForceRequested),
    state' = {
      ...state,
      phase: AutomaticSuccessorPushInFlight,
      publicationPushCount: state.publicationPushCount + 1,
      publicationSenderStopped: false,
    },
  }

  action settleSuccessorPublication: bool = all {
    isRunning(state),
    state.phase == AutomaticSuccessorPushInFlight,
    state.successorCandidate != 0,
    state' = {
      ...state,
      phase: AutomaticSuccessorPublicationProved,
      remoteHead: state.successorCandidate,
      publicationSenderStopped: true,
      publicationResponseAmbiguous: false,
      processSuccessUsedAsProof: false,
    },
  }

  action outsideAdvanceBeforeSuccessorPushSettles: bool = all {
    isRunning(state),
    state.phase == AutomaticSuccessorPushInFlight,
    state.remoteHead == state.successorExpectedHead,
    state.sessionCount < MAX_SESSIONS,
    state' = {
      ...state,
      phase: AutomaticSuccessorPushRejected,
      remoteHead: state.successorExpectedHead + 1,
      publicationSenderStopped: true,
      publicationWait: NoPublicationWait,
    },
  }

  action beginNextAutomaticCompetingHeadCycle: bool = all {
    isRunning(state),
    state.phase == AutomaticSuccessorPushRejected,
    state.publicationWait == NoPublicationWait,
    state.publicationSenderStopped,
    state.competitionOccurrence == state.publicationOccurrenceCount,
    state.sessionCount < MAX_SESSIONS,
    state.gitBoundariesThisActivation == 0,
    state.remoteHead == state.successorExpectedHead + 1,
    state' = {
      ...state,
      phase: PublicationCompetingHead,
      publicationWait: CompatibleCompetingHeadWait,
      publicationOccurrenceCount: state.publicationOccurrenceCount + 1,
      competitionOccurrence: state.publicationOccurrenceCount + 1,
      competingHead: state.remoteHead,
      publicationAuthorizationRecorded: false,
      authorizationJournalPosition: 0,
      authorizationPredecessorSession: 0,
      authorizationPublicationOccurrence: 0,
      authorizationBaseCommit: 0,
      authorizationTaskCommit: 0,
      authorizationTarget: 0,
      authorizationQueuePosition: 0,
      authorizationFactsCurrentWhenRecorded: false,
      baselineReadIntentRecorded: false,
      baselineReadIntentPosition: 0,
      baselineReadRemoteHead: 0,
      baselineReadLocalHead: 0,
      catchUpIntentRecorded: false,
      catchUpIntentPosition: 0,
      catchUpIntentFrom: 0,
      catchUpIntentTo: 0,
      catchUpEffectApplied: false,
      catchUpResultRecorded: false,
      targetLineageObservationCount: 0,
      targetLineageObservedBaseCommit: 0,
      baseAncestorOfSuccessorHead: false,
      predecessorSession: state.currentSession,
      predecessorCandidate: state.successorCandidate,
      predecessorCandidateFirstParent: state.successorCandidateFirstParent,
      predecessorCandidateSecondParent: state.successorCandidateSecondParent,
      predecessorWriterStopped: state.successorWriterStopped,
      successorSession: 0,
      successorFixedWithCurrentAuthority: false,
      successorResource: 0,
      successorResourceBoundTarget: 0,
      successorResourceBoundHead: 0,
      successorResourceBoundCommit: 0,
      successorExpectedHead: 0,
      successorCandidate: 0,
      successorCandidateFirstParent: 0,
      successorCandidateSecondParent: 0,
      successorRunOrdinal: 0,
      successorInvocationCount: 0,
      successorResumeCount: 0,
      successorStoppedWriterReconciled: false,
      successorWriterInFlight: false,
      successorWriterStopped: false,
      currentCandidate: state.successorCandidate,
      currentCandidateFirstParent: state.successorCandidateFirstParent,
      currentCandidateSecondParent: state.successorCandidateSecondParent,
      currentExpectedHead: state.successorExpectedHead,
      localTargetState: LocalStateUnobserved,
      unsafeDisposition: NoUnsafeDisposition,
      gitBoundariesThisActivation: 1,
    },
  }

  action retainThirdCompetingHeadAtBatchLimit: bool = all {
    isRunning(state),
    state.phase == AutomaticSuccessorPushInFlight,
    state.sessionCount == MAX_SESSIONS,
    state.publicationPushCount <= MAX_PUBLICATION_PUSHES,
    state.remoteHead == state.successorExpectedHead,
    state.gitBoundariesThisActivation == 0,
    state' = {
      ...state,
      phase: BoundedRetainedWait,
      remoteHead: state.successorExpectedHead + 1,
      publicationSenderStopped: true,
      publicationWait: CompatibleCompetingHeadWait,
      publicationOccurrenceCount: state.publicationOccurrenceCount + 1,
      competitionOccurrence: state.publicationOccurrenceCount + 1,
      competingHead: state.successorExpectedHead + 1,
      gitBoundariesThisActivation: 1,
    },
  }

  action crashCoordinator: bool = all {
    state.coordinatorLive,
    state.lifecycle == Running,
    state' = {
      ...state,
      coordinatorLive: false,
      trackerFactsCurrent: false,
      exactClaimCurrent: false,
      controlAllowsProgress: false,
      gitBoundariesThisActivation: 0,
      baseAncestorOfSuccessorHead:
        if (state.phase == TargetLineageProven) false else state.baseAncestorOfSuccessorHead,
      successorWriterStopped: state.successorWriterStopped,
    },
  }

  action restartCoordinator: bool = all {
    not(state.coordinatorLive),
    state.lifecycle == Running,
    state.activation < 8,
    state' = {
      ...state,
      coordinatorLive: true,
      activation: state.activation + 1,
      gitBoundariesThisActivation: 0,
      trackerFactsCurrent: false,
      exactClaimCurrent: false,
      controlAllowsProgress: false,
    },
  }

  action rereadAuthorityFacts: bool = all {
    isRunning(state),
    not(state.trackerFactsCurrent or state.exactClaimCurrent or state.controlAllowsProgress),
    state' = {
      ...state,
      trackerFactsCurrent: true,
      exactClaimCurrent: true,
      controlAllowsProgress: true,
    },
  }

  action pauseRun: bool = all {
    state.coordinatorLive,
    state.lifecycle == Running,
    state' = {
      ...state,
      lifecycle: Paused,
      lifecycleFreezeSessionCount: state.sessionCount,
      lifecycleFreezeAuthorizationCount: state.authorizationCount,
      lifecycleFreezePushCount: state.publicationPushCount,
      lifecycleFreezeJournalPosition: state.nextJournalPosition,
    },
  }

  action admitExit: bool = all {
    state.coordinatorLive,
    state.lifecycle == Running,
    state' = {
      ...state,
      lifecycle: ExitAdmitted,
      lifecycleFreezeSessionCount: state.sessionCount,
      lifecycleFreezeAuthorizationCount: state.authorizationCount,
      lifecycleFreezePushCount: state.publicationPushCount,
      lifecycleFreezeJournalPosition: state.nextJournalPosition,
    },
  }

  action step: bool = any {
    recordInitialPublicationIntent,
    outsidePushBeforeInitialDiscovery,
    discoverInitialFixedHead,
    outsidePushBetweenDiscoveryAndPublication,
    sendInitialCandidate,
    rejectInitialPushAtCompetingHead,
    outsidePushAfterAmbiguousInitialResponse,
    loseInitialPushResponse,
    discoverCompatibleCompetingHead,
    beginNextActivation,
    recordConclusiveDeniedWait,
    recordThrottledWait,
    recordIncompatibleRemoteWait,
    recordAutomaticSuccessorAuthorization,
    recordRemoteBaselineReadIntent,
    observeAncestorLocalBaseline,
    observeAlreadyCurrentLocalBaseline,
    outsideTargetAlreadyMatchesRemote,
    observeAnyUnsafeLocalBaseline,
    recordCatchUpIntent,
    compareAndSetLocalTargetToRemoteHead,
    recordCatchUpResult,
    observeCatchUpAfterRecovery,
    proveBaseAncestorOfSuccessorHead,
    fixAutomaticSuccessorSession,
    invokeAutomaticSuccessor,
    loseAutomaticSuccessorResponse,
    proveAutomaticSuccessorWriterStopped,
    resumeAutomaticSuccessorSameRun,
    reportAutomaticSuccessorCandidate,
    recordSuccessorPublicationIntent,
    sendSuccessorPublication,
    settleSuccessorPublication,
    outsideAdvanceBeforeSuccessorPushSettles,
    beginNextAutomaticCompetingHeadCycle,
    retainThirdCompetingHeadAtBatchLimit,
    crashCoordinator,
    restartCoordinator,
    rereadAuthorityFacts,
    pauseRun,
    admitExit,
  }
}
