// Exhaustive proof projection for the issue #65 slice of
// taskFactReconciliation. The canonical model and its production-backed MBT
// remain the source of executable behavior. These smaller modules retain the
// accepted chronology while collapsing unrelated #136/#137 task-fact state so
// TLC can enumerate each complete finite graph, as permitted by ADR 0010.
module taskFactChoiceProof {
  type Choice = NoChoice | ContinueChoice | StopChoice
  type Fingerprint = F1 | F2 | F3
  type Attempt = NoAttempt | AttemptP
  type ContinueStage =
    | NotContinuing
    | NeedGraph
    | NeedSpecification
    | NeedClaim
    | NeedWorktree
    | NeedLineage
    | NeedExecutor
    | ReadyToResume
    | Resumed
    | NewChoiceRequired
  type ControlResult =
    | NoControlResult
    | ChoiceApplied
    | ExactRedelivery
    | RequestRunBindingMismatch
    | PersistedRequestContentContradiction
    | ChoiceAlreadyApplied
    | ChoiceOutsidePreIntegration
  type Event =
    | Initialized
    | F2Observed
    | ContinueF2Applied
    | StopF2Applied
    | ExactChoiceRedelivered
    | RunMismatchRejected
    | ContentReuseRejected
    | LosingChoiceRejected
    | GraphRead
    | SpecificationRead
    | ClaimRead
    | WorktreeRead
    | LineageRead
    | ExecutorRead
    | AttemptPResumed
    | F3Observed
    | ContinueF3Applied
    | IntegrationStarted
    | PostCutoffChoiceRejected

  type Reads = {
    graph: bool,
    specification: bool,
    claim: bool,
    worktree: bool,
    lineage: bool,
    executor: bool,
  }

  type State = {
    currentFingerprint: Fingerprint,
    plannedFingerprint: Fingerprint,
    f2Choice: Choice,
    firstF2Choice: Choice,
    f3Choice: Choice,
    f2JournalWrites: int,
    f3JournalWrites: int,
    appliedChoiceCount: int,
    appliedChoiceCountAtLastIdempotentResult: int,
    controlResult: ControlResult,
    continueStage: ContinueStage,
    authorizedFingerprint: Fingerprint,
    reads: Reads,
    resumedAttempt: Attempt,
    integrationCutoff: bool,
    executorRestartedByRejectedChoice: bool,
    claimReleasedByRejectedChoice: bool,
    cleanupSelectedByRejectedChoice: bool,
    rejectedChoicePastCutoff: Choice,
    lastEvent: Event,
  }

  var state: State

  pure val NO_READS: Reads = {
    graph: false,
    specification: false,
    claim: false,
    worktree: false,
    lineage: false,
    executor: false,
  }

  val firstChoiceAndExactRedeliveryAreIdempotent: bool = and {
    state.f2Choice == state.firstF2Choice,
    state.f2JournalWrites <= 1,
    state.f3JournalWrites <= 1,
    state.f2Choice != NoChoice implies state.appliedChoiceCount >= 1,
    state.f3Choice != NoChoice implies state.appliedChoiceCount == 2,
    state.appliedChoiceCount <= 2,
    state.lastEvent != ExactChoiceRedelivered
      or state.appliedChoiceCount == state.appliedChoiceCountAtLastIdempotentResult,
    state.lastEvent != LosingChoiceRejected
      or state.appliedChoiceCount == state.appliedChoiceCountAtLastIdempotentResult,
  }

  val requestIdentityErrorsStayDistinct: bool = and {
    state.lastEvent != RunMismatchRejected
      or state.controlResult == RequestRunBindingMismatch,
    state.lastEvent != ContentReuseRejected
      or state.controlResult == PersistedRequestContentContradiction,
  }

  val continueUsesSixFreshReadsForImmutableP: bool =
    state.lastEvent != AttemptPResumed or and {
      state.reads.graph,
      state.reads.specification,
      state.reads.claim,
      state.reads.worktree,
      state.reads.lineage,
      state.reads.executor,
      state.currentFingerprint == state.authorizedFingerprint,
      state.plannedFingerprint == F1,
      state.resumedAttempt == AttemptP,
    }

  val laterF3RequiresItsOwnChoiceAndFreshReads: bool = and {
    state.currentFingerprint != F3
      or state.continueStage == NewChoiceRequired
      or state.f3Choice == ContinueChoice,
    state.lastEvent != ContinueF3Applied or and {
      state.f3Choice == ContinueChoice,
      state.reads == NO_READS,
      state.authorizedFingerprint == F3,
    },
  }

  val postCutoffChoiceHasNoDownstreamEffect: bool =
    state.lastEvent != PostCutoffChoiceRejected or and {
      state.controlResult == ChoiceOutsidePreIntegration,
      state.f2Choice == NoChoice,
      state.appliedChoiceCount == 0,
      state.rejectedChoicePastCutoff != NoChoice,
      not(state.executorRestartedByRejectedChoice),
      not(state.claimReleasedByRejectedChoice),
      not(state.cleanupSelectedByRejectedChoice),
    }

  val choiceProofTypeOk: bool = and {
    state.plannedFingerprint == F1,
    state.f2JournalWrites >= 0,
    state.f2JournalWrites <= 1,
    state.f3JournalWrites >= 0,
    state.f3JournalWrites <= 1,
    state.appliedChoiceCount >= 0,
    state.appliedChoiceCount <= 2,
  }

  val exactRedeliveryReached: bool = state.lastEvent == ExactChoiceRedelivered
  val bothIdentityErrorsReached: bool = state.lastEvent == ContentReuseRejected
  val stopWinnerReached: bool = state.lastEvent == StopF2Applied
  val immutableAttemptPResumedReached: bool = state.lastEvent == AttemptPResumed
  val continueF3Reached: bool = state.lastEvent == ContinueF3Applied
  val postCutoffContinueRejectionReached: bool =
    state.lastEvent == PostCutoffChoiceRejected
      and state.rejectedChoicePastCutoff == ContinueChoice
  val postCutoffStopRejectionReached: bool =
    state.lastEvent == PostCutoffChoiceRejected
      and state.rejectedChoicePastCutoff == StopChoice

  action init: bool = all {
    state' = {
      currentFingerprint: F1,
      plannedFingerprint: F1,
      f2Choice: NoChoice,
      firstF2Choice: NoChoice,
      f3Choice: NoChoice,
      f2JournalWrites: 0,
      f3JournalWrites: 0,
      appliedChoiceCount: 0,
      appliedChoiceCountAtLastIdempotentResult: 0,
      controlResult: NoControlResult,
      continueStage: NotContinuing,
      authorizedFingerprint: F1,
      reads: NO_READS,
      resumedAttempt: NoAttempt,
      integrationCutoff: false,
      executorRestartedByRejectedChoice: false,
      claimReleasedByRejectedChoice: false,
      cleanupSelectedByRejectedChoice: false,
      rejectedChoicePastCutoff: NoChoice,
      lastEvent: Initialized,
    },
  }

  action observeF2: bool = all {
    state.currentFingerprint == F1,
    state.f2Choice == NoChoice,
    state' = { ...state, currentFingerprint: F2, lastEvent: F2Observed },
  }

  action applyContinueF2: bool = all {
    state.currentFingerprint == F2,
    state.f2Choice == NoChoice,
    not(state.integrationCutoff),
    state' = {
      ...state,
      f2Choice: ContinueChoice,
      firstF2Choice: ContinueChoice,
      f2JournalWrites: 1,
      appliedChoiceCount: 1,
      controlResult: ChoiceApplied,
      continueStage: NeedGraph,
      authorizedFingerprint: F2,
      reads: NO_READS,
      lastEvent: ContinueF2Applied,
    },
  }

  action applyStopF2: bool = all {
    state.currentFingerprint == F2,
    state.f2Choice == NoChoice,
    not(state.integrationCutoff),
    state' = {
      ...state,
      f2Choice: StopChoice,
      firstF2Choice: StopChoice,
      f2JournalWrites: 1,
      appliedChoiceCount: 1,
      controlResult: ChoiceApplied,
      lastEvent: StopF2Applied,
    },
  }

  action redeliverExactChoice: bool = all {
    state.f2Choice != NoChoice,
    state.controlResult == ChoiceApplied,
    state' = {
      ...state,
      appliedChoiceCountAtLastIdempotentResult: state.appliedChoiceCount,
      controlResult: ExactRedelivery,
      lastEvent: ExactChoiceRedelivered,
    },
  }

  action rejectRunMismatch: bool = all {
    state.lastEvent == Initialized,
    state' = {
      ...state,
      controlResult: RequestRunBindingMismatch,
      lastEvent: RunMismatchRejected,
    },
  }

  action rejectContentReuse: bool = all {
    state.f2Choice != NoChoice,
    state.controlResult == ChoiceApplied,
    state' = {
      ...state,
      controlResult: PersistedRequestContentContradiction,
      lastEvent: ContentReuseRejected,
    },
  }

  action rejectLosingChoice: bool = all {
    state.f2Choice != NoChoice,
    state.controlResult == ChoiceApplied,
    state' = {
      ...state,
      appliedChoiceCountAtLastIdempotentResult: state.appliedChoiceCount,
      controlResult: ChoiceAlreadyApplied,
      lastEvent: LosingChoiceRejected,
    },
  }

  action readFreshGraph: bool = all {
    state.continueStage == NeedGraph,
    state' = {
      ...state,
      reads: { ...state.reads, graph: true },
      continueStage: NeedSpecification,
      lastEvent: GraphRead,
    },
  }

  action readFreshSpecification: bool = all {
    state.continueStage == NeedSpecification,
    state' = {
      ...state,
      reads: { ...state.reads, specification: true },
      continueStage: NeedClaim,
      lastEvent: SpecificationRead,
    },
  }

  action readFreshClaim: bool = all {
    state.continueStage == NeedClaim,
    state' = {
      ...state,
      reads: { ...state.reads, claim: true },
      continueStage: NeedWorktree,
      lastEvent: ClaimRead,
    },
  }

  action readFreshWorktree: bool = all {
    state.continueStage == NeedWorktree,
    state' = {
      ...state,
      reads: { ...state.reads, worktree: true },
      continueStage: NeedLineage,
      lastEvent: WorktreeRead,
    },
  }

  action readFreshLineage: bool = all {
    state.continueStage == NeedLineage,
    state' = {
      ...state,
      reads: { ...state.reads, lineage: true },
      continueStage: NeedExecutor,
      lastEvent: LineageRead,
    },
  }

  action readFreshExecutor: bool = all {
    state.continueStage == NeedExecutor,
    state' = {
      ...state,
      reads: { ...state.reads, executor: true },
      continueStage: ReadyToResume,
      lastEvent: ExecutorRead,
    },
  }

  action resumeAttemptP: bool = all {
    state.continueStage == ReadyToResume,
    state.currentFingerprint == state.authorizedFingerprint,
    state' = {
      ...state,
      resumedAttempt: AttemptP,
      continueStage: Resumed,
      lastEvent: AttemptPResumed,
    },
  }

  action observeF3: bool = all {
    state.currentFingerprint == F2,
    state.f2Choice == ContinueChoice,
    state.continueStage != Resumed,
    state' = {
      ...state,
      currentFingerprint: F3,
      continueStage: NewChoiceRequired,
      reads: NO_READS,
      lastEvent: F3Observed,
    },
  }

  action applyContinueF3: bool = all {
    state.currentFingerprint == F3,
    state.continueStage == NewChoiceRequired,
    state.f3Choice == NoChoice,
    state' = {
      ...state,
      f3Choice: ContinueChoice,
      f3JournalWrites: 1,
      appliedChoiceCount: 2,
      controlResult: ChoiceApplied,
      continueStage: NeedGraph,
      authorizedFingerprint: F3,
      reads: NO_READS,
      lastEvent: ContinueF3Applied,
    },
  }

  action beginIntegration: bool = all {
    state.f2Choice == NoChoice,
    not(state.integrationCutoff),
    state' = { ...state, integrationCutoff: true, lastEvent: IntegrationStarted },
  }

  action rejectContinuePastCutoff: bool = all {
    state.integrationCutoff,
    state.currentFingerprint == F2,
    state.f2Choice == NoChoice,
    state.controlResult == NoControlResult,
    state' = {
      ...state,
      controlResult: ChoiceOutsidePreIntegration,
      rejectedChoicePastCutoff: ContinueChoice,
      lastEvent: PostCutoffChoiceRejected,
    },
  }

  action rejectStopPastCutoff: bool = all {
    state.integrationCutoff,
    state.currentFingerprint == F2,
    state.f2Choice == NoChoice,
    state.controlResult == NoControlResult,
    state' = {
      ...state,
      controlResult: ChoiceOutsidePreIntegration,
      rejectedChoicePastCutoff: StopChoice,
      lastEvent: PostCutoffChoiceRejected,
    },
  }

  action step: bool = any {
    observeF2,
    applyContinueF2,
    applyStopF2,
    redeliverExactChoice,
    rejectRunMismatch,
    rejectContentReuse,
    rejectLosingChoice,
    readFreshGraph,
    readFreshSpecification,
    readFreshClaim,
    readFreshWorktree,
    readFreshLineage,
    readFreshExecutor,
    resumeAttemptP,
    observeF3,
    applyContinueF3,
    beginIntegration,
    rejectContinuePastCutoff,
    rejectStopPastCutoff,
  }
}

module taskFactStopProof {
  type Evidence = ExactRunning | ExactSafelySuspended | ExactTerminal
  type Stage =
    | ChoiceReady
    | NeedQuiescence
    | IntentRecorded
    | CommandCalled
    | AmbiguousResponse
    | ProjectionReady
    | ReadOnlyProjectionReady
    | NeedClaimObservation
  type Event =
    | Initialized
    | StopApplied
    | SafeProofBroken
    | StopIntentRecorded
    | StopCalled
    | StopResponseLost
    | RecoveryActivated
    | RunningProjected
    | SafeProjected
    | TerminalProjected
    | ReadOnlyRecoveryActivated
    | ReadOnlySafeProjected
    | ImplementationAbandoned

  type State = {
    stage: Stage,
    stopApplied: bool,
    evidence: Evidence,
    quiescenceUnbroken: bool,
    implementationRetained: bool,
    positionHeld: bool,
    claimHeld: bool,
    intentCount: int,
    callCount: int,
    settlementCount: int,
    activeOrdinal: int,
    nextOrdinal: int,
    lastSettledOrdinal: int,
    projectionsThisActivation: int,
    recoveryCount: int,
    worktreePreserved: bool,
    wipPreserved: bool,
    sessionHistoryPreserved: bool,
    logsPreserved: bool,
    evidencePreserved: bool,
    cleanupSelected: bool,
    integrationSelected: bool,
    lastEvent: Event,
  }

  var state: State

  pure val STOP_COMMAND_LIMIT = 3
  pure val RECOVERY_LIMIT = 3

  val stopCallsFollowExactDurableIntents: bool = and {
    state.callCount <= state.intentCount,
    state.settlementCount <= state.callCount,
    state.intentCount
      == state.settlementCount + (if (state.activeOrdinal > 0) 1 else 0),
    state.nextOrdinal == state.intentCount + 2,
    state.lastSettledOrdinal
      == if (state.settlementCount == 0) 0 else state.settlementCount + 1,
  }

  val stoppageAndRecoveryAreBounded: bool = and {
    state.intentCount >= 0,
    state.intentCount <= STOP_COMMAND_LIMIT,
    state.callCount >= 0,
    state.callCount <= STOP_COMMAND_LIMIT,
    state.settlementCount >= 0,
    state.settlementCount <= STOP_COMMAND_LIMIT,
    state.projectionsThisActivation >= 0,
    state.projectionsThisActivation <= 1,
    state.recoveryCount >= 0,
    state.recoveryCount <= RECOVERY_LIMIT,
  }

  val thirdRunningResultLeavesOnlyReadOnlyRecovery: bool =
    not(
      state.callCount == STOP_COMMAND_LIMIT
        and state.settlementCount == STOP_COMMAND_LIMIT
        and state.evidence == ExactRunning
    ) or and {
      state.activeOrdinal == 0,
      state.stage == NeedQuiescence or state.stage == ReadOnlyProjectionReady,
    }

  val abandonmentRequiresExactUnbrokenQuiescence: bool =
    state.implementationRetained or and {
      state.stopApplied,
      state.quiescenceUnbroken,
      state.evidence == ExactSafelySuspended or state.evidence == ExactTerminal,
      not(state.positionHeld),
    }

  val unprovedWriterRetainsPositionAndClaim: bool =
    not(
      state.stopApplied
        and state.implementationRetained
        and not(state.quiescenceUnbroken)
    ) or and { state.positionHeld, state.claimHeld }

  val stopPreservesArtifactsAndNeverIntegrates: bool = and {
    state.worktreePreserved,
    state.wipPreserved,
    state.sessionHistoryPreserved,
    state.logsPreserved,
    state.evidencePreserved,
    not(state.cleanupSelected),
    not(state.integrationSelected),
  }

  val readOnlyRecoveryIssuesNoFourthCommand: bool =
    state.lastEvent != ReadOnlySafeProjected or and {
      state.callCount == STOP_COMMAND_LIMIT,
      state.intentCount == STOP_COMMAND_LIMIT,
      state.settlementCount == STOP_COMMAND_LIMIT,
      state.recoveryCount == RECOVERY_LIMIT,
    }

  val retainedSafeProofAbandonedReached: bool =
    state.lastEvent == ImplementationAbandoned and state.intentCount == 0
  val ambiguousSafeProjectionReached: bool = state.lastEvent == SafeProjected
  val thirdRunningProjectionReached: bool =
    state.lastEvent == RunningProjected and state.settlementCount == STOP_COMMAND_LIMIT
  val readOnlySafeRecoveryReached: bool = state.lastEvent == ReadOnlySafeProjected

  action init: bool = all {
    state' = {
      stage: ChoiceReady,
      stopApplied: false,
      evidence: ExactSafelySuspended,
      quiescenceUnbroken: true,
      implementationRetained: true,
      positionHeld: false,
      claimHeld: true,
      intentCount: 0,
      callCount: 0,
      settlementCount: 0,
      activeOrdinal: 0,
      nextOrdinal: 2,
      lastSettledOrdinal: 0,
      projectionsThisActivation: 0,
      recoveryCount: 0,
      worktreePreserved: true,
      wipPreserved: true,
      sessionHistoryPreserved: true,
      logsPreserved: true,
      evidencePreserved: true,
      cleanupSelected: false,
      integrationSelected: false,
      lastEvent: Initialized,
    },
  }

  action applyStop: bool = all {
    state.stage == ChoiceReady,
    state' = { ...state, stopApplied: true, stage: NeedQuiescence, lastEvent: StopApplied },
  }

  action breakRetainedSafeProof: bool = all {
    state.stage == NeedQuiescence,
    state.quiescenceUnbroken,
    state.implementationRetained,
    state' = {
      ...state,
      evidence: ExactRunning,
      quiescenceUnbroken: false,
      positionHeld: true,
      lastEvent: SafeProofBroken,
    },
  }

  action recordStopIntent: bool = all {
    state.stage == NeedQuiescence,
    not(state.quiescenceUnbroken),
    state.activeOrdinal == 0,
    state.intentCount < STOP_COMMAND_LIMIT,
    state' = {
      ...state,
      stage: IntentRecorded,
      activeOrdinal: state.nextOrdinal,
      nextOrdinal: state.nextOrdinal + 1,
      intentCount: state.intentCount + 1,
      lastEvent: StopIntentRecorded,
    },
  }

  action callStop: bool = all {
    state.stage == IntentRecorded,
    state.activeOrdinal > 0,
    state' = {
      ...state,
      stage: CommandCalled,
      callCount: state.callCount + 1,
      lastEvent: StopCalled,
    },
  }

  action loseStopResponse: bool = all {
    state.stage == CommandCalled,
    state' = { ...state, stage: AmbiguousResponse, lastEvent: StopResponseLost },
  }

  action activateRecovery: bool = all {
    state.stage == AmbiguousResponse,
    state.recoveryCount < RECOVERY_LIMIT,
    state' = {
      ...state,
      stage: ProjectionReady,
      projectionsThisActivation: 0,
      recoveryCount: state.recoveryCount + 1,
      lastEvent: RecoveryActivated,
    },
  }

  action projectRunning: bool = all {
    state.stage == ProjectionReady,
    state.projectionsThisActivation == 0,
    state' = {
      ...state,
      stage: NeedQuiescence,
      evidence: ExactRunning,
      quiescenceUnbroken: false,
      positionHeld: true,
      lastSettledOrdinal: state.activeOrdinal,
      activeOrdinal: 0,
      settlementCount: state.settlementCount + 1,
      projectionsThisActivation: 1,
      lastEvent: RunningProjected,
    },
  }

  action projectSafe: bool = all {
    state.stage == ProjectionReady,
    state.projectionsThisActivation == 0,
    state' = {
      ...state,
      stage: NeedQuiescence,
      evidence: ExactSafelySuspended,
      quiescenceUnbroken: true,
      positionHeld: false,
      lastSettledOrdinal: state.activeOrdinal,
      activeOrdinal: 0,
      settlementCount: state.settlementCount + 1,
      projectionsThisActivation: 1,
      lastEvent: SafeProjected,
    },
  }

  action projectTerminal: bool = all {
    state.stage == ProjectionReady,
    state.projectionsThisActivation == 0,
    state' = {
      ...state,
      stage: NeedQuiescence,
      evidence: ExactTerminal,
      quiescenceUnbroken: true,
      positionHeld: false,
      lastSettledOrdinal: state.activeOrdinal,
      activeOrdinal: 0,
      settlementCount: state.settlementCount + 1,
      projectionsThisActivation: 1,
      lastEvent: TerminalProjected,
    },
  }

  action abandonImplementation: bool = all {
    state.stage == NeedQuiescence,
    state.stopApplied,
    state.quiescenceUnbroken,
    state.evidence == ExactSafelySuspended or state.evidence == ExactTerminal,
    state' = {
      ...state,
      stage: NeedClaimObservation,
      implementationRetained: false,
      positionHeld: false,
      lastEvent: ImplementationAbandoned,
    },
  }

  action activateReadOnlyRecovery: bool = all {
    state.stage == NeedQuiescence,
    state.intentCount == STOP_COMMAND_LIMIT,
    state.callCount == STOP_COMMAND_LIMIT,
    state.settlementCount == STOP_COMMAND_LIMIT,
    state.evidence == ExactRunning,
    state.activeOrdinal == 0,
    state.projectionsThisActivation == 1,
    state.recoveryCount == RECOVERY_LIMIT,
    state' = {
      ...state,
      stage: ReadOnlyProjectionReady,
      projectionsThisActivation: 0,
      lastEvent: ReadOnlyRecoveryActivated,
    },
  }

  action projectReadOnlySafe: bool = all {
    state.stage == ReadOnlyProjectionReady,
    state.projectionsThisActivation == 0,
    state' = {
      ...state,
      stage: NeedClaimObservation,
      evidence: ExactSafelySuspended,
      quiescenceUnbroken: true,
      positionHeld: false,
      implementationRetained: false,
      projectionsThisActivation: 1,
      lastEvent: ReadOnlySafeProjected,
    },
  }

  action step: bool = any {
    applyStop,
    breakRetainedSafeProof,
    recordStopIntent,
    callStop,
    loseStopResponse,
    activateRecovery,
    projectRunning,
    projectSafe,
    projectTerminal,
    abandonImplementation,
    activateReadOnlyRecovery,
    projectReadOnlySafe,
  }
}

module taskFactClaimProof {
  type ClaimObservation = ClaimNotRead | ClaimExact | ClaimAbsent | ClaimForeign | ClaimUnreadable
  type ClaimResult = NoClaimResult | ExactClaimReleased | NoReleaseAbsent | NoReleaseForeign
  type Stage =
    | NeedObservation
    | NeedReleaseIntent
    | ReleaseAmbiguous
    | RetryWait
    | UnreadableWait
    | Complete
  type Event =
    | Initialized
    | ExactObserved
    | AbsentObserved
    | ForeignObserved
    | UnreadableObserved
    | ReleaseIntentRecorded
    | ClaimReleased
    | ReleaseResponseLost
    | ReleasedProjected
    | StillExactProjected
    | LaterActivation
    | IndependentTaskSelected

  type State = {
    stage: Stage,
    implementationAbandoned: bool,
    observation: ClaimObservation,
    result: ClaimResult,
    authorizedByExactRead: bool,
    releaseIntentRecorded: bool,
    releaseCallCount: int,
    lastCallFollowedAbandonment: bool,
    lastCallHadExactRead: bool,
    lastCallHadDurableIntent: bool,
    releaseCallCountAtNonExactObservation: int,
    readsThisActivation: int,
    projectionsThisActivation: int,
    recoveryCount: int,
    unresolvedClaimReleaseResponsibility: bool,
    independentTaskEligible: bool,
    independentTaskSelected: bool,
    lastEvent: Event,
  }

  var state: State

  pure val RELEASE_LIMIT = 3
  pure val RECOVERY_LIMIT = 3

  val claimChangesOnlyAfterAbandonmentExactReadAndIntent: bool =
    state.releaseCallCount == 0 or and {
      state.lastCallFollowedAbandonment,
      state.lastCallHadExactRead,
      state.lastCallHadDurableIntent,
    }

  val absentForeignUnreadableClaimsAreNeverMutated: bool =
    not(
      state.observation == ClaimAbsent
        or state.observation == ClaimForeign
        or state.observation == ClaimUnreadable
    ) or state.releaseCallCount == state.releaseCallCountAtNonExactObservation

  val unreadableClaimRetainsSeparateResponsibility: bool =
    state.observation != ClaimUnreadable or and {
      state.implementationAbandoned,
      state.unresolvedClaimReleaseResponsibility,
      state.stage == UnreadableWait,
    }

  val claimReleaseIsBoundedAndReconciled: bool = and {
    state.releaseCallCount >= 0,
    state.releaseCallCount <= RELEASE_LIMIT,
    state.readsThisActivation >= 0,
    state.readsThisActivation <= 1,
    state.projectionsThisActivation >= 0,
    state.projectionsThisActivation <= 1,
    state.recoveryCount >= 0,
    state.recoveryCount <= RECOVERY_LIMIT,
  }

  val unrelatedTaskRemainsEligible: bool = state.independentTaskEligible

  val exactReleaseReached: bool = state.lastEvent == ClaimReleased
  val absentDispositionReached: bool = state.lastEvent == AbsentObserved
  val foreignDispositionReached: bool = state.lastEvent == ForeignObserved
  val unreadableDispositionReached: bool = state.lastEvent == UnreadableObserved
  val ambiguousReleaseSettledReached: bool = state.lastEvent == ReleasedProjected
  val laterReadAfterAmbiguityReached: bool =
    state.lastEvent == ExactObserved and state.recoveryCount > 0
  val unrelatedTaskSelectedReached: bool = state.lastEvent == IndependentTaskSelected

  action init: bool = all {
    state' = {
      stage: NeedObservation,
      implementationAbandoned: true,
      observation: ClaimNotRead,
      result: NoClaimResult,
      authorizedByExactRead: false,
      releaseIntentRecorded: false,
      releaseCallCount: 0,
      lastCallFollowedAbandonment: false,
      lastCallHadExactRead: false,
      lastCallHadDurableIntent: false,
      releaseCallCountAtNonExactObservation: 0,
      readsThisActivation: 0,
      projectionsThisActivation: 0,
      recoveryCount: 0,
      unresolvedClaimReleaseResponsibility: true,
      independentTaskEligible: true,
      independentTaskSelected: false,
      lastEvent: Initialized,
    },
  }

  action observeExactClaim: bool = all {
    state.stage == NeedObservation,
    state.readsThisActivation == 0,
    state' = {
      ...state,
      stage: NeedReleaseIntent,
      observation: ClaimExact,
      authorizedByExactRead: true,
      readsThisActivation: 1,
      unresolvedClaimReleaseResponsibility: true,
      lastEvent: ExactObserved,
    },
  }

  action observeAbsentClaim: bool = all {
    state.stage == NeedObservation,
    state.readsThisActivation == 0,
    state' = {
      ...state,
      stage: Complete,
      observation: ClaimAbsent,
      result: NoReleaseAbsent,
      readsThisActivation: 1,
      releaseCallCountAtNonExactObservation: state.releaseCallCount,
      unresolvedClaimReleaseResponsibility: false,
      lastEvent: AbsentObserved,
    },
  }

  action observeForeignClaim: bool = all {
    state.stage == NeedObservation,
    state.readsThisActivation == 0,
    state' = {
      ...state,
      stage: Complete,
      observation: ClaimForeign,
      result: NoReleaseForeign,
      readsThisActivation: 1,
      releaseCallCountAtNonExactObservation: state.releaseCallCount,
      unresolvedClaimReleaseResponsibility: false,
      lastEvent: ForeignObserved,
    },
  }

  action observeUnreadableClaim: bool = all {
    state.stage == NeedObservation,
    state.readsThisActivation == 0,
    state' = {
      ...state,
      stage: UnreadableWait,
      observation: ClaimUnreadable,
      readsThisActivation: 1,
      releaseCallCountAtNonExactObservation: state.releaseCallCount,
      unresolvedClaimReleaseResponsibility: true,
      lastEvent: UnreadableObserved,
    },
  }

  action recordReleaseIntent: bool = all {
    state.stage == NeedReleaseIntent,
    state.observation == ClaimExact,
    state.authorizedByExactRead,
    not(state.releaseIntentRecorded),
    state' = { ...state, releaseIntentRecorded: true, lastEvent: ReleaseIntentRecorded },
  }

  action releaseExactClaim: bool = all {
    state.stage == NeedReleaseIntent,
    state.authorizedByExactRead,
    state.releaseIntentRecorded,
    state.releaseCallCount < RELEASE_LIMIT,
    state' = {
      ...state,
      stage: Complete,
      observation: ClaimAbsent,
      result: ExactClaimReleased,
      releaseCallCount: state.releaseCallCount + 1,
      lastCallFollowedAbandonment: state.implementationAbandoned,
      lastCallHadExactRead: state.authorizedByExactRead,
      lastCallHadDurableIntent: state.releaseIntentRecorded,
      releaseCallCountAtNonExactObservation: state.releaseCallCount + 1,
      unresolvedClaimReleaseResponsibility: false,
      lastEvent: ClaimReleased,
    },
  }

  action loseReleaseResponse: bool = all {
    state.stage == NeedReleaseIntent,
    state.authorizedByExactRead,
    state.releaseIntentRecorded,
    state.releaseCallCount < RELEASE_LIMIT,
    state' = {
      ...state,
      stage: ReleaseAmbiguous,
      releaseCallCount: state.releaseCallCount + 1,
      lastCallFollowedAbandonment: state.implementationAbandoned,
      lastCallHadExactRead: state.authorizedByExactRead,
      lastCallHadDurableIntent: state.releaseIntentRecorded,
      lastEvent: ReleaseResponseLost,
    },
  }

  action projectClaimReleased: bool = all {
    state.stage == ReleaseAmbiguous,
    state.projectionsThisActivation == 0,
    state' = {
      ...state,
      stage: Complete,
      observation: ClaimAbsent,
      result: ExactClaimReleased,
      releaseCallCountAtNonExactObservation: state.releaseCallCount,
      projectionsThisActivation: 1,
      unresolvedClaimReleaseResponsibility: false,
      lastEvent: ReleasedProjected,
    },
  }

  action projectClaimStillExact: bool = all {
    state.stage == ReleaseAmbiguous,
    state.projectionsThisActivation == 0,
    state' = {
      ...state,
      stage: RetryWait,
      observation: ClaimExact,
      projectionsThisActivation: 1,
      lastEvent: StillExactProjected,
    },
  }

  action recoverLaterActivation: bool = all {
    state.stage == RetryWait or state.stage == UnreadableWait,
    state.recoveryCount < RECOVERY_LIMIT,
    state' = {
      ...state,
      stage: NeedObservation,
      observation: ClaimNotRead,
      authorizedByExactRead: false,
      readsThisActivation: 0,
      projectionsThisActivation: 0,
      recoveryCount: state.recoveryCount + 1,
      lastEvent: LaterActivation,
    },
  }

  action selectIndependentTask: bool = all {
    state.independentTaskEligible,
    not(state.independentTaskSelected),
    state.stage != Complete,
    state' = {
      ...state,
      independentTaskSelected: true,
      lastEvent: IndependentTaskSelected,
    },
  }

  action step: bool = any {
    observeExactClaim,
    observeAbsentClaim,
    observeForeignClaim,
    observeUnreadableClaim,
    recordReleaseIntent,
    releaseExactClaim,
    loseReleaseResponse,
    projectClaimReleased,
    projectClaimStillExact,
    recoverLaterActivation,
    selectIndependentTask,
  }
}

// Exhaustive projection of the active-work authority-refresh distinction. It
// keeps only the facts needed to prove that a tracker/timer refresh of Running
// work cannot accidentally become either continuation authorization or an
// ordinary unreadable-claim suspension request.
module taskFactActiveRefreshProof {
  type ReadPurpose = OrdinaryRead | ActiveRefreshRead
  type Decision = ContinueWork | AwaitNextRefresh | RequestSafeSuspension | UnreadableWait
  type Constraint = NoConstraint | UnreadableClaimConstraint
  type RefreshSource = NoRefreshSource | TrackerNotification | Timer
  type ExecutorEvidence = ExactRunning | ExactSafelySuspended
  type ExecutorAction = NoExecutorAction | SuspendExecutor
  type Event =
    | Initialized
    | ActiveWorkRunningEstablished
    | ActiveRefreshOffered
    | ActiveRefreshHealthyObserved
    | ActiveRefreshUnreadableObserved
    | OrdinaryUnreadableObserved
    | SafelySuspended
    | IndependentTaskSelected

  type State = {
    purpose: ReadPurpose,
    decision: Decision,
    constraint: Constraint,
    refreshSource: RefreshSource,
    evidence: ExecutorEvidence,
    executorAction: ExecutorAction,
    runningEstablished: bool,
    positionHeld: bool,
    implementationResponsibilityRetained: bool,
    independentTaskEligible: bool,
    independentTaskSelected: bool,
    lastEvent: Event,
  }

  var state: State

  val activeRefreshUnreadableAuthorizesNoExecutorAction: bool =
    state.lastEvent != ActiveRefreshUnreadableObserved or and {
      state.purpose == ActiveRefreshRead,
      state.decision == AwaitNextRefresh,
      state.constraint == NoConstraint,
      state.evidence == ExactRunning,
      state.executorAction == NoExecutorAction,
      state.positionHeld,
      state.implementationResponsibilityRetained,
    }

  val healthyActiveRefreshAuthorizesNoExecutorAction: bool =
    state.lastEvent != ActiveRefreshHealthyObserved or and {
      state.purpose == ActiveRefreshRead,
      state.decision == AwaitNextRefresh,
      state.constraint == NoConstraint,
      state.refreshSource == TrackerNotification or state.refreshSource == Timer,
      state.executorAction == NoExecutorAction,
      state.evidence == ExactRunning,
      state.positionHeld,
      state.implementationResponsibilityRetained,
    }

  val runningEstablishmentRetainsAuthority: bool =
    state.lastEvent != ActiveWorkRunningEstablished or and {
      state.runningEstablished,
      state.evidence == ExactRunning,
      state.executorAction == NoExecutorAction,
      state.positionHeld,
      state.implementationResponsibilityRetained,
      state.refreshSource == NoRefreshSource,
    }

  val activeRefreshOfferRequiresRunningEstablished: bool =
    state.lastEvent != ActiveRefreshOffered or and {
      state.runningEstablished,
      state.evidence == ExactRunning,
      state.positionHeld,
      state.refreshSource == TrackerNotification or state.refreshSource == Timer,
    }

  val activeRefreshSourceIsTrackerOrTimer: bool =
    not(
      state.lastEvent == ActiveRefreshOffered
        or state.lastEvent == ActiveRefreshHealthyObserved
        or state.lastEvent == ActiveRefreshUnreadableObserved
    ) or state.refreshSource == TrackerNotification or state.refreshSource == Timer

  val ordinaryUnreadableStillRequestsSafeSuspension: bool =
    state.lastEvent != OrdinaryUnreadableObserved or and {
      state.purpose == OrdinaryRead,
      state.decision == RequestSafeSuspension,
      state.constraint == UnreadableClaimConstraint,
      state.executorAction == SuspendExecutor,
      state.positionHeld,
    }

  val positionReleasesOnlyOnExactSafeEvidence: bool =
    not(state.positionHeld) implies state.evidence == ExactSafelySuspended

  val independentTaskRemainsEligible: bool = state.independentTaskEligible

  val activeRefreshProofTypeOk: bool =
    not(state.independentTaskSelected) or state.independentTaskEligible

  val activeRefreshOfferedReached: bool = state.lastEvent == ActiveRefreshOffered
  val activeRefreshRunningEstablishedReached: bool = state.lastEvent == ActiveWorkRunningEstablished
  val activeRefreshTrackerOfferedReached: bool =
    state.lastEvent == ActiveRefreshOffered and state.refreshSource == TrackerNotification
  val activeRefreshTimerOfferedReached: bool =
    state.lastEvent == ActiveRefreshOffered and state.refreshSource == Timer
  val activeRefreshHealthyReached: bool = state.lastEvent == ActiveRefreshHealthyObserved
  val activeRefreshUnreadableReached: bool = state.lastEvent == ActiveRefreshUnreadableObserved
  val ordinaryUnreadableReached: bool = state.lastEvent == OrdinaryUnreadableObserved
  val safelySuspendedReached: bool = state.lastEvent == SafelySuspended
  val independentTaskSelectedReached: bool = state.lastEvent == IndependentTaskSelected

  action init: bool = all {
    state' = {
      purpose: OrdinaryRead,
      decision: ContinueWork,
      constraint: NoConstraint,
      refreshSource: NoRefreshSource,
      evidence: ExactSafelySuspended,
      executorAction: NoExecutorAction,
      runningEstablished: false,
      positionHeld: false,
      implementationResponsibilityRetained: true,
      independentTaskEligible: true,
      independentTaskSelected: false,
      lastEvent: Initialized,
    }
  }

  action establishRunningAttempt: bool = all {
    state.lastEvent == Initialized,
    state.purpose == OrdinaryRead,
    state.decision == ContinueWork,
    state.constraint == NoConstraint,
    state.evidence == ExactSafelySuspended,
    not(state.runningEstablished),
    state' = {
      ...state,
      evidence: ExactRunning,
      runningEstablished: true,
      positionHeld: true,
      lastEvent: ActiveWorkRunningEstablished,
    },
  }

  action offerTrackerRefresh: bool = all {
    state.lastEvent == ActiveWorkRunningEstablished
      or state.lastEvent == ActiveRefreshHealthyObserved
      or state.lastEvent == ActiveRefreshUnreadableObserved,
    state.runningEstablished,
    state.evidence == ExactRunning,
    state.decision == ContinueWork or state.decision == AwaitNextRefresh,
    state.constraint == NoConstraint,
    state' = {
      ...state,
      purpose: ActiveRefreshRead,
      decision: ContinueWork,
      evidence: ExactRunning,
      executorAction: NoExecutorAction,
      positionHeld: true,
      refreshSource: TrackerNotification,
      lastEvent: ActiveRefreshOffered,
    },
  }

  action offerTimerRefresh: bool = all {
    state.lastEvent == ActiveWorkRunningEstablished
      or state.lastEvent == ActiveRefreshHealthyObserved
      or state.lastEvent == ActiveRefreshUnreadableObserved,
    state.runningEstablished,
    state.evidence == ExactRunning,
    state.decision == ContinueWork or state.decision == AwaitNextRefresh,
    state.constraint == NoConstraint,
    state' = {
      ...state,
      purpose: ActiveRefreshRead,
      decision: ContinueWork,
      evidence: ExactRunning,
      executorAction: NoExecutorAction,
      positionHeld: true,
      refreshSource: Timer,
      lastEvent: ActiveRefreshOffered,
    },
  }

  action observeHealthyActiveRefresh: bool = all {
    state.lastEvent == ActiveRefreshOffered,
    state' = {
      ...state,
      decision: AwaitNextRefresh,
      executorAction: NoExecutorAction,
      lastEvent: ActiveRefreshHealthyObserved,
    },
  }

  action observeUnreadableActiveRefresh: bool = all {
    state.lastEvent == ActiveRefreshOffered,
    state' = {
      ...state,
      decision: AwaitNextRefresh,
      executorAction: NoExecutorAction,
      lastEvent: ActiveRefreshUnreadableObserved,
    },
  }

  action observeUnreadableOrdinaryRead: bool = all {
    state.purpose == OrdinaryRead,
    state.decision == ContinueWork,
    state' = {
      ...state,
      decision: RequestSafeSuspension,
      constraint: UnreadableClaimConstraint,
      evidence: ExactRunning,
      executorAction: SuspendExecutor,
      positionHeld: true,
      runningEstablished: true,
      refreshSource: NoRefreshSource,
      lastEvent: OrdinaryUnreadableObserved,
    },
  }

  action reportSafelySuspended: bool = all {
    state.decision == RequestSafeSuspension,
    state.executorAction == SuspendExecutor,
    state' = {
      ...state,
      decision: UnreadableWait,
      evidence: ExactSafelySuspended,
      executorAction: NoExecutorAction,
      positionHeld: false,
      lastEvent: SafelySuspended,
    },
  }

  action selectIndependentTask: bool = all {
    state.independentTaskEligible,
    not(state.independentTaskSelected),
    state.decision == AwaitNextRefresh or state.decision == UnreadableWait,
    state' = { ...state, independentTaskSelected: true, lastEvent: IndependentTaskSelected },
  }

  action step: bool = any {
    establishRunningAttempt,
    offerTrackerRefresh,
    offerTimerRefresh,
    observeHealthyActiveRefresh,
    observeUnreadableActiveRefresh,
    observeUnreadableOrdinaryRead,
    reportSafelySuspended,
    selectIndependentTask,
  }
}
