// Models Alice's Continue-or-Stop choice for one exact changed-task attempt.
// The choice is durable before fresh authority reads or boundary effects. A
// Continue can resume only the immutable planned attempt P after every exact
// authority agrees. A Stop abandons implementation only after exact unbroken
// quiescence, preserves all artifacts, and reconciles claim release separately.
module taskFactReconciliation {
  type Fingerprint = F1 | F2 | F3
  type Attempt = NoAttempt | AttemptP | AttemptQ
  type Choice = NoChoice | ContinueChoice | StopChoice

  type RequestId = { runId: int, nonce: int }
  type ChoiceSubject = {
    runId: int,
    taskId: int,
    attemptId: int,
    plannedFingerprint: Fingerprint,
    observedFingerprint: Fingerprint,
  }

  type ControlResult =
    | NoControlResult
    | ChoiceApplied
    | ExactRedelivery
    | RequestRunBindingMismatch
    | PersistedRequestContentContradiction
    | ChoiceAlreadyApplied
    | ChoiceOutsidePreIntegration

  type IntegrationPhase = PreIntegration | IntegrationStarted
  type ExecutorEvidence =
    | ExactSafelySuspended
    | ExactTerminal
    | ExactRunning
    | ExecutorUnavailable
    | ExecutorContradiction

  type ContinueStage =
    | NotContinuing
    | NeedFreshGraph
    | NeedFreshSpecification
    | NeedFreshClaim
    | NeedFreshWorktree
    | NeedFreshLineage
    | NeedFreshExecutor
    | ReadyToResume
    | ContinueResumed
    | NewChoiceRequired
    | ContinueWaiting

  type StopStage =
    | NotStopping
    | NeedQuiescence
    | ImplementationAbandoned
    | NeedClaimObservation
    | NeedClaimRelease
    | ClaimReleaseAmbiguous
    | ClaimReleaseRetryWait
    | StopWaiting
    | StopComplete

  type ClaimObservation = ClaimNotRead | ClaimExact | ClaimAbsent | ClaimForeign | ClaimUnreadable
  type ClaimResult = NoClaimResult | ExactClaimReleased | NoReleaseAbsent | NoReleaseForeign
  type Constraint =
    | NoConstraint
    | MembershipConstraint
    | LifecycleConstraint
    | SpecificationConstraint
    | ExternalSuccessConstraint
    | MissingClaimConstraint
    | ForeignClaimConstraint
    | UnreadableClaimConstraint
  type FactDecision =
    | ContinueWork
    | RequestSafeSuspension
    | MembershipWait
    | LifecycleWait
    | SpecificationChoices
    | ReleaseExternalSuccessClaim
    | ExternalSuccessSettled
    | MissingClaimWait
    | ForeignClaimWait
    | UnreadableClaimWait
    | AllocateReplacementClaim
    | ObserveReplacementClaim
  type ClaimState = ExactClaim | MissingClaim | ForeignClaim | UnreadableClaim | ReplacementClaim
  type ClaimMutationTarget = NoClaimMutation | OwnedClaimMutation | ForeignClaimMutation

  // LastAction makes each protocol transition independently witnessable.
  type ActionTag =
    | InitializedAction
    | F2ObservedAction
    | ContinueF2AppliedAction
    | StopF2AppliedAction
    | ExactRedeliveredAction
    | RunMismatchRejectedAction
    | ContentReuseRejectedAction
    | LosingChoiceRejectedAction
    | TerminalObservedAction
    | IntegrationStartedAction
    | PostCutoffContinueRejectedAction
    | PostCutoffStopRejectedAction
    | FreshGraphReadAction
    | FreshSpecificationReadAction
    | FreshClaimReadAction
    | FreshWorktreeReadAction
    | FreshLineageReadAction
    | FreshExecutorReadAction
    | ContinueAdmittedAction
    | F3ObservedAction
    | ContinueF3AppliedAction
    | StoppageReconciliationRequiredAction
    | StoppageIntentRecordedAction
    | StoppageCalledAction
    | StoppageResponseLostAction
    | StoppageRunningProjectedAction
    | StoppageSafeProjectedAction
    | StoppageTerminalProjectedAction
    | StoppageReadOnlySafeProjectedAction
    | StopRecoveryActivatedAction
    | ImplementationAbandonedAction
    | ExactClaimObservedAction
    | AbsentClaimObservedAction
    | ForeignClaimObservedAction
    | UnreadableClaimObservedAction
    | ClaimReleaseIntentRecordedAction
    | ClaimReleasedAction
    | ClaimReleaseResponseLostAction
    | ClaimReleaseReleasedProjectedAction
    | ClaimReleaseStillExactProjectedAction
    | ClaimRecoveryActivatedAction
    | IndependentTaskSelectedAction
    | MembershipLossObservedAction
    | LifecycleClosureObservedAction
    | SpecificationChangeObservedAction
    | ExternalSuccessObservedAction
    | IncompleteMembershipReadObservedAction
    | MissingClaimConstraintObservedAction
    | ForeignClaimConstraintObservedAction
    | UnreadableClaimConstraintObservedAction
    | TaskFactsSafelySuspendedAction
    | MissingClaimDirectionAppliedAction
    | ForeignClaimDirectionAppliedAction
    | ForeignClaimReacquisitionRejectedAction
    | ReplacementClaimPlannedAction
    | ReplacementClaimObservedAction
    | LifecycleReopenedAction
    | ExternalSuccessClaimReleasedAction
    | OwnedClaimMutationRequestedAction

  type State = {
    phase: IntegrationPhase,
    currentFingerprint: Fingerprint,
    firstF2Choice: Choice,
    f2WinningChoice: Choice,
    f3WinningChoice: Choice,
    winningRequestId: RequestId,
    winningSubject: ChoiceSubject,
    appliedChoiceCount: int,
    lastControlResult: ControlResult,
    authorizedFingerprint: Fingerprint,
    continueStage: ContinueStage,
    freshGraphExact: bool,
    freshSpecificationExact: bool,
    freshClaimExact: bool,
    freshWorktreeExact: bool,
    freshLineageExact: bool,
    freshExecutorExact: bool,
    resumedAttempt: Attempt,
    executorEvidence: ExecutorEvidence,
    quiescenceUnbroken: bool,
    implementationResponsibilityRetained: bool,
    positionHeld: bool,
    stopStage: StopStage,
    nextStopCommandOrdinal: int,
    activeStopCommandOrdinal: int,
    lastSettledStopCommandOrdinal: int,
    stopCommandIntentCount: int,
    stopCommandCallCount: int,
    stopCommandSettlementCount: int,
    stopCommandCalled: bool,
    stopResponseAmbiguous: bool,
    runningProjectionSettledStopIntent: bool,
    stopProjectionsThisActivation: int,
    stopRecoveryCount: int,
    claimObservation: ClaimObservation,
    claimResult: ClaimResult,
    claimReadsThisActivation: int,
    claimRecoveryCount: int,
    claimReleaseAuthorizedByExactRead: bool,
    claimReleaseIntentRecorded: bool,
    claimReleaseCallCount: int,
    // Boundary-call count when current claim authority last became non-exact.
    // Earlier calls authorized by an exact read remain valid history.
    claimReleaseCallCountAtNonExactObservation: int,
    claimReleaseResponseAmbiguous: bool,
    claimReleaseProjectionsThisActivation: int,
    unresolvedClaimReleaseResponsibility: bool,
    worktreePreserved: bool,
    wipPreserved: bool,
    sessionHistoryPreserved: bool,
    logsPreserved: bool,
    evidencePreserved: bool,
    cleanupSelected: bool,
    integrationSelected: bool,
    independentTaskEligible: bool,
    independentTaskSelected: bool,
    constraint: Constraint,
    factDecision: FactDecision,
    exactClaimHeld: bool,
    dependantsReleasedByFreshGraph: bool,
    duplicateDeliveryPrevented: bool,
    claimState: ClaimState,
    reacquisitionDirectionApplied: bool,
    replacementIntentRecorded: bool,
    lastClaimMutationTarget: ClaimMutationTarget,
    originalClaimIdentity: int,
    currentClaimIdentity: int,
    lastAction: ActionTag,
  }

  pure val RUN_R = 65
  pure val OTHER_RUN = 66
  pure val TASK_A = 1
  pure val ATTEMPT_P = 1
  pure val STOP_COMMAND_LIMIT = 3
  pure val RECOVERY_LIMIT = 3

  pure val SUBJECT_F2: ChoiceSubject = {
    runId: RUN_R,
    taskId: TASK_A,
    attemptId: ATTEMPT_P,
    plannedFingerprint: F1,
    observedFingerprint: F2,
  }
  pure val SUBJECT_F3: ChoiceSubject = {
    ...SUBJECT_F2,
    observedFingerprint: F3,
  }
  pure val CONTINUE_D1: RequestId = { runId: RUN_R, nonce: 1 }
  pure val STOP_D2: RequestId = { runId: RUN_R, nonce: 2 }
  pure val CONTINUE_D3: RequestId = { runId: RUN_R, nonce: 3 }
  pure val WRONG_RUN_D1: RequestId = { runId: OTHER_RUN, nonce: 1 }
  pure val NO_REQUEST: RequestId = { runId: 0, nonce: 0 }

  pure def sameRequestId(left: RequestId, right: RequestId): bool =
    left.runId == right.runId and left.nonce == right.nonce

  pure def exactContinueFacts(s: State): bool = and {
    s.freshGraphExact,
    s.freshSpecificationExact,
    s.freshClaimExact,
    s.freshWorktreeExact,
    s.freshLineageExact,
    s.freshExecutorExact,
    s.currentFingerprint == s.authorizedFingerprint,
  }

  pure def exactQuiescence(s: State): bool =
    s.quiescenceUnbroken
      and (s.executorEvidence == ExactSafelySuspended or s.executorEvidence == ExactTerminal)

  pure def stopChoiceApplied(s: State): bool =
    s.f2WinningChoice == StopChoice or s.f3WinningChoice == StopChoice

  pure def stopCommandActive(s: State): bool = s.activeStopCommandOrdinal > 0

  var state: State

  // One request identity includes both its Run binding and nonce. A mismatch
  // at that self-binding is distinct from reusing an already persisted
  // identity with different request contents.
  val requestIdentityErrorsRemainDistinct: bool = and {
    state.lastAction != RunMismatchRejectedAction
      or state.lastControlResult == RequestRunBindingMismatch,
    state.lastAction != ContentReuseRejectedAction
      or state.lastControlResult == PersistedRequestContentContradiction,
  }

  val firstJournaledChoiceWins: bool = and {
    state.f2WinningChoice == state.firstF2Choice,
    state.f2WinningChoice != NoChoice implies state.appliedChoiceCount >= 1,
    state.f3WinningChoice != NoChoice implies state.appliedChoiceCount == 2,
    state.appliedChoiceCount <= 2,
  }

  val postCutoffChoiceNeverApplies: bool =
    not(
      state.lastAction == PostCutoffContinueRejectedAction
        or state.lastAction == PostCutoffStopRejectedAction
    )
      or and {
        state.f2WinningChoice == NoChoice,
        state.continueStage == NotContinuing,
        state.stopStage == NotStopping,
      }

  val terminalObservationAloneExposesNoChoice: bool =
    state.lastAction != TerminalObservedAction or state.f2WinningChoice == NoChoice

  val continueRequiresEveryFreshExactAuthority: bool =
    state.continueStage != ContinueResumed or exactContinueFacts(state)

  val continueResumesOnlyImmutableAttemptP: bool =
    state.resumedAttempt == NoAttempt or state.resumedAttempt == AttemptP

  val changedAgainRequiresNewChoice: bool =
    state.currentFingerprint != F3
      or state.continueStage == NewChoiceRequired
      or state.f3WinningChoice != NoChoice

  val projectedRunningSettlesOnlyItsIntent: bool =
    not(state.runningProjectionSettledStopIntent)
      or and {
        state.executorEvidence == ExactRunning,
        state.stopCommandSettlementCount > 0,
        state.lastSettledStopCommandOrdinal == state.stopCommandSettlementCount + 1,
        state.implementationResponsibilityRetained,
        state.stopStage == NeedQuiescence,
      }

  val stoppageCallsHaveExactDurableIntents: bool = and {
    state.stopCommandCallCount <= state.stopCommandIntentCount,
    state.stopCommandSettlementCount <= state.stopCommandCallCount,
    state.stopCommandIntentCount
      == state.stopCommandSettlementCount + (if (stopCommandActive(state)) 1 else 0),
    state.stopCommandCallCount
      == state.stopCommandSettlementCount + (if (state.stopCommandCalled) 1 else 0),
    state.nextStopCommandOrdinal == state.stopCommandIntentCount + 2,
    state.lastSettledStopCommandOrdinal
      == if (state.stopCommandSettlementCount == 0) 0 else state.stopCommandSettlementCount + 1,
  }

  val stoppageIsBounded: bool = and {
    state.stopCommandIntentCount <= STOP_COMMAND_LIMIT,
    state.stopCommandCallCount <= STOP_COMMAND_LIMIT,
    state.stopProjectionsThisActivation <= 1,
    state.stopRecoveryCount <= RECOVERY_LIMIT,
  }

  val stoppageLimitPreservesReadOnlyRecovery: bool =
    state.stopCommandIntentCount != STOP_COMMAND_LIMIT
      or stopCommandActive(state)
      or state.executorEvidence != ExactRunning
      or state.stopProjectionsThisActivation != 1
      or state.stopRecoveryCount <= RECOVERY_LIMIT

  val abandonmentRequiresExactUnbrokenQuiescence: bool =
    not(state.implementationResponsibilityRetained) implies and {
      stopChoiceApplied(state),
      exactQuiescence(state),
      state.phase == PreIntegration,
    }

  val stopPreservesEveryArtifact: bool = and {
    state.worktreePreserved,
    state.wipPreserved,
    state.sessionHistoryPreserved,
    state.logsPreserved,
    state.evidencePreserved,
    not(state.cleanupSelected),
  }

  val stopNeverSelectsIntegration: bool =
    not(stopChoiceApplied(state)) or not(state.integrationSelected)

  val quiescentStopNeedNotHoldPosition: bool =
    state.implementationResponsibilityRetained
      or exactQuiescence(state)
      or not(state.positionHeld)

  val unprovedWriterRetainsPositionAndClaim: bool =
    not(stopChoiceApplied(state))
      or state.stopStage != NeedQuiescence
      or exactQuiescence(state)
      or and {
        state.positionHeld,
        state.implementationResponsibilityRetained,
        state.claimResult == NoClaimResult,
      }

  val claimChangesOnlyAfterAbandonmentAndExactRead: bool =
    state.claimReleaseCallCount == 0 or and {
      not(state.implementationResponsibilityRetained),
      state.claimReleaseAuthorizedByExactRead,
    }

  val absentForeignUnreadableClaimsAreNeverMutated: bool =
    not(
      state.claimObservation == ClaimAbsent
        or state.claimObservation == ClaimForeign
        or state.claimObservation == ClaimUnreadable
    ) or state.claimReleaseCallCount == state.claimReleaseCallCountAtNonExactObservation

  val claimReleaseIsBoundedAndReconciled: bool = and {
    state.claimReleaseCallCount <= 3,
    state.claimReadsThisActivation <= 1,
    state.claimReleaseProjectionsThisActivation <= 1,
    state.claimRecoveryCount <= RECOVERY_LIMIT,
  }

  val unreadableClaimRemainsSeparateResponsibility: bool =
    state.claimObservation != ClaimUnreadable
      or and {
        state.unresolvedClaimReleaseResponsibility,
        not(state.implementationResponsibilityRetained),
      }

  val unrelatedTaskBRemainsEligible: bool = state.independentTaskEligible

  // Existing #136/#137 task-fact constraints remain owned by this model. They
  // preserve P and expose their decisions only after exact safe suspension.
  val changedFactsPreserveWip: bool = state.wipPreserved
  val specificationOffersEveryExactChoice: bool =
    state.factDecision != SpecificationChoices
      or and {
        state.constraint == SpecificationConstraint,
        exactQuiescence(state),
      }
  val externalSuccessPreventsDuplicateDelivery: bool =
    state.constraint != ExternalSuccessConstraint or state.duplicateDeliveryPrevented
  val externalSuccessSettlesAfterExactClaimRelease: bool =
    state.factDecision != ExternalSuccessSettled
      or and {
        not(state.exactClaimHeld),
        state.dependantsReleasedByFreshGraph,
      }
  val replacementClaimRequiresDirectionAndIntent: bool =
    state.claimState != ReplacementClaim
      or and { state.reacquisitionDirectionApplied, state.replacementIntentRecorded }
  val replacementClaimIdentityIsFresh: bool =
    state.claimState != ReplacementClaim
      or state.currentClaimIdentity != state.originalClaimIdentity
  val foreignClaimIsNeverChanged: bool =
    state.claimState != ForeignClaim or state.lastClaimMutationTarget != ForeignClaimMutation
  val unreadableClaimCannotAuthorizeReplacement: bool =
    state.claimState != UnreadableClaim
      or and { not(state.reacquisitionDirectionApplied), not(state.replacementIntentRecorded) }

  val membershipWaitReached: bool = state.factDecision == MembershipWait
  val lifecycleWaitReached: bool = state.factDecision == LifecycleWait
  val specificationChoicesReached: bool = state.factDecision == SpecificationChoices
  val externalSuccessSettledReached: bool = state.factDecision == ExternalSuccessSettled
  val missingClaimWaitReached: bool = state.factDecision == MissingClaimWait
  val foreignClaimWaitReached: bool = state.factDecision == ForeignClaimWait
  val unreadableClaimWaitReached: bool = state.factDecision == UnreadableClaimWait
  val replacementClaimObserved: bool =
    state.currentClaimIdentity != state.originalClaimIdentity
      and state.claimState == ExactClaim
      and state.factDecision == ContinueWork

  val continueF2AppliedReached: bool = state.lastAction == ContinueF2AppliedAction
  val f2ObservedReached: bool = state.lastAction == F2ObservedAction
  val stopF2AppliedReached: bool = state.lastAction == StopF2AppliedAction
  val exactRedeliveredReached: bool = state.lastAction == ExactRedeliveredAction
  val runMismatchRejectedReached: bool = state.lastAction == RunMismatchRejectedAction
  val contentReuseRejectedReached: bool = state.lastAction == ContentReuseRejectedAction
  val losingChoiceRejectedReached: bool = state.lastAction == LosingChoiceRejectedAction
  val postCutoffContinueRejectedReached: bool = state.lastAction == PostCutoffContinueRejectedAction
  val postCutoffStopRejectedReached: bool = state.lastAction == PostCutoffStopRejectedAction
  val terminalObservedReached: bool = state.lastAction == TerminalObservedAction
  val integrationStartedReached: bool = state.lastAction == IntegrationStartedAction
  val freshGraphReadReached: bool = state.lastAction == FreshGraphReadAction
  val freshSpecificationReadReached: bool = state.lastAction == FreshSpecificationReadAction
  val freshClaimReadReached: bool = state.lastAction == FreshClaimReadAction
  val freshWorktreeReadReached: bool = state.lastAction == FreshWorktreeReadAction
  val freshLineageReadReached: bool = state.lastAction == FreshLineageReadAction
  val freshExecutorReadReached: bool = state.lastAction == FreshExecutorReadAction
  val continueAdmittedReached: bool = state.lastAction == ContinueAdmittedAction
  val f3ObservedReached: bool = state.lastAction == F3ObservedAction
  val continueF3AppliedReached: bool = state.lastAction == ContinueF3AppliedAction
  val stoppageReconciliationRequiredReached: bool =
    state.lastAction == StoppageReconciliationRequiredAction
  val stoppageIntentRecordedReached: bool = state.lastAction == StoppageIntentRecordedAction
  val stoppageCalledReached: bool = state.lastAction == StoppageCalledAction
  val stoppageResponseLostReached: bool = state.lastAction == StoppageResponseLostAction
  val stoppageRunningProjectedReached: bool = state.lastAction == StoppageRunningProjectedAction
  val stoppageSafeProjectedReached: bool = state.lastAction == StoppageSafeProjectedAction
  val stoppageReadOnlySafeProjectedReached: bool =
    state.lastAction == StoppageReadOnlySafeProjectedAction
  val stopRecoveryActivatedReached: bool = state.lastAction == StopRecoveryActivatedAction
  val implementationAbandonedReached: bool = state.lastAction == ImplementationAbandonedAction
  val exactClaimObservedReached: bool = state.lastAction == ExactClaimObservedAction
  val absentClaimObservedReached: bool = state.lastAction == AbsentClaimObservedAction
  val foreignClaimObservedReached: bool = state.lastAction == ForeignClaimObservedAction
  val unreadableClaimObservedReached: bool = state.lastAction == UnreadableClaimObservedAction
  val claimReleaseIntentRecordedReached: bool = state.lastAction == ClaimReleaseIntentRecordedAction
  val claimReleasedReached: bool = state.lastAction == ClaimReleasedAction
  val claimReleaseResponseLostReached: bool = state.lastAction == ClaimReleaseResponseLostAction
  val claimReleaseReleasedProjectedReached: bool =
    state.lastAction == ClaimReleaseReleasedProjectedAction
  val claimReleaseStillExactProjectedReached: bool =
    state.lastAction == ClaimReleaseStillExactProjectedAction
  val claimRecoveryActivatedReached: bool = state.lastAction == ClaimRecoveryActivatedAction
  val independentTaskSelectedReached: bool = state.lastAction == IndependentTaskSelectedAction
  val membershipLossObservedReached: bool = state.lastAction == MembershipLossObservedAction
  val lifecycleClosureObservedReached: bool = state.lastAction == LifecycleClosureObservedAction
  val specificationChangeObservedReached: bool = state.lastAction == SpecificationChangeObservedAction
  val externalSuccessObservedReached: bool = state.lastAction == ExternalSuccessObservedAction
  val incompleteMembershipReadObservedReached: bool =
    state.lastAction == IncompleteMembershipReadObservedAction
  val missingClaimConstraintObservedReached: bool =
    state.lastAction == MissingClaimConstraintObservedAction
  val foreignClaimConstraintObservedReached: bool =
    state.lastAction == ForeignClaimConstraintObservedAction
  val unreadableClaimConstraintObservedReached: bool =
    state.lastAction == UnreadableClaimConstraintObservedAction
  val taskFactsSafelySuspendedReached: bool = state.lastAction == TaskFactsSafelySuspendedAction
  val missingClaimDirectionAppliedReached: bool = state.lastAction == MissingClaimDirectionAppliedAction
  val foreignClaimDirectionAppliedReached: bool = state.lastAction == ForeignClaimDirectionAppliedAction
  val foreignClaimReacquisitionRejectedReached: bool =
    state.lastAction == ForeignClaimReacquisitionRejectedAction
  val replacementClaimPlannedReached: bool = state.lastAction == ReplacementClaimPlannedAction
  val replacementClaimObservedReached: bool = state.lastAction == ReplacementClaimObservedAction
  val lifecycleReopenedReached: bool = state.lastAction == LifecycleReopenedAction
  val externalSuccessClaimReleasedReached: bool =
    state.lastAction == ExternalSuccessClaimReleasedAction
  val ownedClaimMutationRequestedReached: bool = state.lastAction == OwnedClaimMutationRequestedAction

  action init: bool = all {
    state' = {
      phase: PreIntegration,
      currentFingerprint: F1,
      firstF2Choice: NoChoice,
      f2WinningChoice: NoChoice,
      f3WinningChoice: NoChoice,
      winningRequestId: NO_REQUEST,
      winningSubject: SUBJECT_F2,
      appliedChoiceCount: 0,
      lastControlResult: NoControlResult,
      authorizedFingerprint: F1,
      continueStage: NotContinuing,
      freshGraphExact: false,
      freshSpecificationExact: false,
      freshClaimExact: false,
      freshWorktreeExact: false,
      freshLineageExact: false,
      freshExecutorExact: false,
      resumedAttempt: NoAttempt,
      executorEvidence: ExactSafelySuspended,
      quiescenceUnbroken: true,
      implementationResponsibilityRetained: true,
      positionHeld: false,
      stopStage: NotStopping,
      // The accepted attempt already journaled StartOrContinue ordinal 1.
      nextStopCommandOrdinal: 2,
      activeStopCommandOrdinal: 0,
      lastSettledStopCommandOrdinal: 0,
      stopCommandIntentCount: 0,
      stopCommandCallCount: 0,
      stopCommandSettlementCount: 0,
      stopCommandCalled: false,
      stopResponseAmbiguous: false,
      runningProjectionSettledStopIntent: false,
      stopProjectionsThisActivation: 0,
      stopRecoveryCount: 0,
      claimObservation: ClaimNotRead,
      claimResult: NoClaimResult,
      claimReadsThisActivation: 0,
      claimRecoveryCount: 0,
      claimReleaseAuthorizedByExactRead: false,
      claimReleaseIntentRecorded: false,
      claimReleaseCallCount: 0,
      claimReleaseCallCountAtNonExactObservation: 0,
      claimReleaseResponseAmbiguous: false,
      claimReleaseProjectionsThisActivation: 0,
      unresolvedClaimReleaseResponsibility: false,
      worktreePreserved: true,
      wipPreserved: true,
      sessionHistoryPreserved: true,
      logsPreserved: true,
      evidencePreserved: true,
      cleanupSelected: false,
      integrationSelected: false,
      independentTaskEligible: true,
      independentTaskSelected: false,
      constraint: NoConstraint,
      factDecision: ContinueWork,
      exactClaimHeld: true,
      dependantsReleasedByFreshGraph: false,
      duplicateDeliveryPrevented: false,
      claimState: ExactClaim,
      reacquisitionDirectionApplied: false,
      replacementIntentRecorded: false,
      lastClaimMutationTarget: NoClaimMutation,
      originalClaimIdentity: 1,
      currentClaimIdentity: 1,
      lastAction: InitializedAction,
    }
  }

  action observeF2Change: bool = all {
    state.currentFingerprint == F1,
    state.f2WinningChoice == NoChoice,
    state' = {
      ...state,
      currentFingerprint: F2,
      lastAction: F2ObservedAction,
    },
  }

  action applyContinueF2: bool = all {
    state.phase == PreIntegration,
    state.f2WinningChoice == NoChoice,
    state.currentFingerprint == F2,
    state.executorEvidence == ExactSafelySuspended,
    state.quiescenceUnbroken,
    CONTINUE_D1.runId == SUBJECT_F2.runId,
    state' = {
      ...state,
      f2WinningChoice: ContinueChoice,
      firstF2Choice: ContinueChoice,
      winningRequestId: CONTINUE_D1,
      winningSubject: SUBJECT_F2,
      appliedChoiceCount: 1,
      lastControlResult: ChoiceApplied,
      authorizedFingerprint: F2,
      continueStage: NeedFreshGraph,
      factDecision: ContinueWork,
      lastAction: ContinueF2AppliedAction,
    },
  }

  action applyStopF2: bool = all {
    state.phase == PreIntegration,
    state.f2WinningChoice == NoChoice,
    state.currentFingerprint == F2,
    state.executorEvidence == ExactSafelySuspended,
    state.quiescenceUnbroken,
    STOP_D2.runId == SUBJECT_F2.runId,
    state' = {
      ...state,
      f2WinningChoice: StopChoice,
      firstF2Choice: StopChoice,
      winningRequestId: STOP_D2,
      winningSubject: SUBJECT_F2,
      appliedChoiceCount: 1,
      lastControlResult: ChoiceApplied,
      stopStage: NeedQuiescence,
      factDecision: ContinueWork,
      lastAction: StopF2AppliedAction,
    },
  }

  action redeliverExactF2Choice: bool = all {
    state.f2WinningChoice != NoChoice,
    state.lastControlResult == ChoiceApplied,
    state' = {
      ...state,
      lastControlResult: ExactRedelivery,
      lastAction: ExactRedeliveredAction,
    },
  }

  action rejectRunMismatchedRequest: bool = all {
    WRONG_RUN_D1.runId != SUBJECT_F2.runId,
    state.lastControlResult == NoControlResult,
    state' = {
      ...state,
      lastControlResult: RequestRunBindingMismatch,
      lastAction: RunMismatchRejectedAction,
    },
  }

  action rejectPersistedRequestContentReuse: bool = all {
    state.f2WinningChoice != NoChoice,
    state.lastControlResult != PersistedRequestContentContradiction,
    sameRequestId(state.winningRequestId, state.winningRequestId),
    state' = {
      ...state,
      lastControlResult: PersistedRequestContentContradiction,
      lastAction: ContentReuseRejectedAction,
    },
  }

  action rejectLosingF2Choice: bool = all {
    state.f2WinningChoice != NoChoice,
    state.lastControlResult != ChoiceAlreadyApplied,
    state' = {
      ...state,
      lastControlResult: ChoiceAlreadyApplied,
      lastAction: LosingChoiceRejectedAction,
    },
  }

  action observeExactTerminal: bool = all {
    state.f2WinningChoice == NoChoice,
    state.executorEvidence == ExactSafelySuspended,
    state.constraint == NoConstraint,
    state' = {
      ...state,
      executorEvidence: ExactTerminal,
      quiescenceUnbroken: true,
      positionHeld: false,
      lastAction: TerminalObservedAction,
    },
  }

  action beginIntegration: bool = all {
    state.f2WinningChoice == NoChoice,
    state.currentFingerprint == F1,
    state.executorEvidence == ExactTerminal,
    state' = {
      ...state,
      phase: IntegrationStarted,
      integrationSelected: true,
      lastAction: IntegrationStartedAction,
    },
  }

  action rejectContinuePastIntegrationCutoff: bool = all {
    state.phase == IntegrationStarted,
    state.currentFingerprint == F2,
    state.f2WinningChoice == NoChoice,
    state.lastControlResult != ChoiceOutsidePreIntegration,
    state' = {
      ...state,
      lastControlResult: ChoiceOutsidePreIntegration,
      lastAction: PostCutoffContinueRejectedAction,
    },
  }

  action rejectStopPastIntegrationCutoff: bool = all {
    state.phase == IntegrationStarted,
    state.currentFingerprint == F2,
    state.f2WinningChoice == NoChoice,
    state.lastControlResult != ChoiceOutsidePreIntegration,
    state' = {
      ...state,
      lastControlResult: ChoiceOutsidePreIntegration,
      lastAction: PostCutoffStopRejectedAction,
    },
  }

  action readFreshExactGraph: bool = all {
    state.continueStage == NeedFreshGraph,
    state' = { ...state, freshGraphExact: true, continueStage: NeedFreshSpecification, lastAction: FreshGraphReadAction },
  }

  action readFreshExactSpecification: bool = all {
    state.continueStage == NeedFreshSpecification,
    state.currentFingerprint == state.authorizedFingerprint,
    state' = {
      ...state,
      freshSpecificationExact: true,
      continueStage: NeedFreshClaim,
      lastAction: FreshSpecificationReadAction,
    },
  }

  action readFreshExactClaim: bool = all {
    state.continueStage == NeedFreshClaim,
    state' = { ...state, freshClaimExact: true, continueStage: NeedFreshWorktree, lastAction: FreshClaimReadAction },
  }

  action readFreshExactWorktree: bool = all {
    state.continueStage == NeedFreshWorktree,
    state' = {
      ...state,
      freshWorktreeExact: true,
      continueStage: NeedFreshLineage,
      lastAction: FreshWorktreeReadAction,
    },
  }

  action readFreshExactLineage: bool = all {
    state.continueStage == NeedFreshLineage,
    state' = {
      ...state,
      freshLineageExact: true,
      continueStage: NeedFreshExecutor,
      lastAction: FreshLineageReadAction,
    },
  }

  action readFreshExactExecutor: bool = all {
    state.continueStage == NeedFreshExecutor,
    state.executorEvidence == ExactSafelySuspended,
    state' = {
      ...state,
      freshExecutorExact: true,
      continueStage: ReadyToResume,
      lastAction: FreshExecutorReadAction,
    },
  }

  action admitSameAttemptP: bool = all {
    state.continueStage == ReadyToResume,
    exactContinueFacts(state),
    state' = {
      ...state,
      continueStage: ContinueResumed,
      resumedAttempt: AttemptP,
      executorEvidence: ExactRunning,
      quiescenceUnbroken: false,
      runningProjectionSettledStopIntent: false,
      positionHeld: true,
      lastAction: ContinueAdmittedAction,
    },
  }

  action observeF3BeforeContinuation: bool = all {
    state.f2WinningChoice == ContinueChoice,
    state.f3WinningChoice == NoChoice,
    state.authorizedFingerprint == F2,
    state.continueStage == NeedFreshSpecification,
    state' = {
      ...state,
      currentFingerprint: F3,
      continueStage: NewChoiceRequired,
      constraint: SpecificationConstraint,
      factDecision: SpecificationChoices,
      freshGraphExact: false,
      freshSpecificationExact: false,
      freshClaimExact: false,
      freshWorktreeExact: false,
      freshLineageExact: false,
      freshExecutorExact: false,
      lastAction: F3ObservedAction,
    },
  }

  action applyContinueF3: bool = all {
    state.continueStage == NewChoiceRequired,
    state.f3WinningChoice == NoChoice,
    CONTINUE_D3.runId == SUBJECT_F3.runId,
    state' = {
      ...state,
      f3WinningChoice: ContinueChoice,
      winningRequestId: CONTINUE_D3,
      winningSubject: SUBJECT_F3,
      appliedChoiceCount: 2,
      lastControlResult: ChoiceApplied,
      authorizedFingerprint: F3,
      continueStage: NeedFreshGraph,
      factDecision: ContinueWork,
      lastAction: ContinueF3AppliedAction,
    },
  }

  // A later exact Running projection breaks retained proof. Stop now needs its
  // durable stoppage intent and exact command-projection protocol.
  action requireStoppageReconciliation: bool = all {
    state.stopStage == NeedQuiescence,
    exactQuiescence(state),
    state' = {
      ...state,
      executorEvidence: ExactRunning,
      quiescenceUnbroken: false,
      runningProjectionSettledStopIntent: false,
      positionHeld: true,
      lastAction: StoppageReconciliationRequiredAction,
    },
  }

  action recordStoppageIntent: bool = all {
    state.stopStage == NeedQuiescence,
    not(exactQuiescence(state)),
    not(stopCommandActive(state)),
    state.stopCommandIntentCount < STOP_COMMAND_LIMIT,
    state' = {
      ...state,
      activeStopCommandOrdinal: state.nextStopCommandOrdinal,
      nextStopCommandOrdinal: state.nextStopCommandOrdinal + 1,
      stopCommandIntentCount: state.stopCommandIntentCount + 1,
      lastAction: StoppageIntentRecordedAction,
    },
  }

  action callStoppage: bool = all {
    stopCommandActive(state),
    not(state.stopCommandCalled),
    state' = {
      ...state,
      stopCommandCalled: true,
      stopCommandCallCount: state.stopCommandCallCount + 1,
      lastAction: StoppageCalledAction,
    },
  }

  action loseStoppageResponse: bool = all {
    state.stopCommandCalled,
    not(state.stopResponseAmbiguous),
    state' = { ...state, stopResponseAmbiguous: true, lastAction: StoppageResponseLostAction },
  }

  action projectExactRunningForStoppage: bool = all {
    state.stopCommandCalled,
    state.stopResponseAmbiguous,
    state.stopProjectionsThisActivation == 0,
    state' = {
      ...state,
      executorEvidence: ExactRunning,
      runningProjectionSettledStopIntent: true,
      quiescenceUnbroken: false,
      lastSettledStopCommandOrdinal: state.activeStopCommandOrdinal,
      activeStopCommandOrdinal: 0,
      stopCommandSettlementCount: state.stopCommandSettlementCount + 1,
      stopCommandCalled: false,
      stopResponseAmbiguous: false,
      stopProjectionsThisActivation: 1,
      positionHeld: true,
      lastAction: StoppageRunningProjectedAction,
    },
  }

  action projectExactSafeForStoppage: bool = all {
    state.stopCommandCalled,
    state.stopResponseAmbiguous,
    state.stopProjectionsThisActivation == 0,
    state' = {
      ...state,
      executorEvidence: ExactSafelySuspended,
      runningProjectionSettledStopIntent: false,
      quiescenceUnbroken: true,
      lastSettledStopCommandOrdinal: state.activeStopCommandOrdinal,
      activeStopCommandOrdinal: 0,
      stopCommandSettlementCount: state.stopCommandSettlementCount + 1,
      stopCommandCalled: false,
      stopResponseAmbiguous: false,
      stopProjectionsThisActivation: 1,
      positionHeld: false,
      lastAction: StoppageSafeProjectedAction,
    },
  }

  action projectExactTerminalForStoppage: bool = all {
    state.stopCommandCalled,
    state.stopResponseAmbiguous,
    state.stopProjectionsThisActivation == 0,
    state' = {
      ...state,
      executorEvidence: ExactTerminal,
      runningProjectionSettledStopIntent: false,
      quiescenceUnbroken: true,
      lastSettledStopCommandOrdinal: state.activeStopCommandOrdinal,
      activeStopCommandOrdinal: 0,
      stopCommandSettlementCount: state.stopCommandSettlementCount + 1,
      stopCommandCalled: false,
      stopResponseAmbiguous: false,
      stopProjectionsThisActivation: 1,
      positionHeld: false,
      lastAction: StoppageTerminalProjectedAction,
    },
  }

  action recoverStopActivation: bool = all {
    state.stopStage == NeedQuiescence,
    if (stopCommandActive(state) and state.stopCommandCalled and state.stopResponseAmbiguous)
      state.stopProjectionsThisActivation <= 1
    else
      not(stopCommandActive(state)) and state.stopProjectionsThisActivation == 1,
    state.stopRecoveryCount < RECOVERY_LIMIT
      or and {
        state.stopCommandIntentCount == STOP_COMMAND_LIMIT,
        not(stopCommandActive(state)),
        state.stopProjectionsThisActivation == 1,
        state.stopRecoveryCount == RECOVERY_LIMIT,
      },
    state' = {
      ...state,
      stopProjectionsThisActivation: 0,
      stopRecoveryCount:
        if (state.stopRecoveryCount < RECOVERY_LIMIT) state.stopRecoveryCount + 1
        else state.stopRecoveryCount,
      lastAction: StopRecoveryActivatedAction,
    },
  }

  action projectReadOnlyExactSafeAfterStoppageLimit: bool = all {
    state.stopStage == NeedQuiescence,
    state.stopCommandIntentCount == STOP_COMMAND_LIMIT,
    not(stopCommandActive(state)),
    not(state.stopCommandCalled),
    state.stopProjectionsThisActivation == 0,
    state.executorEvidence == ExactRunning,
    state' = {
      ...state,
      executorEvidence: ExactSafelySuspended,
      quiescenceUnbroken: true,
      runningProjectionSettledStopIntent: false,
      stopProjectionsThisActivation: 1,
      positionHeld: false,
      implementationResponsibilityRetained: false,
      unresolvedClaimReleaseResponsibility: true,
      stopStage: NeedClaimObservation,
      lastAction: StoppageReadOnlySafeProjectedAction,
    },
  }

  action abandonImplementation: bool = all {
    state.stopStage == NeedQuiescence,
    stopChoiceApplied(state),
    exactQuiescence(state),
    state.phase == PreIntegration,
    state' = {
      ...state,
      implementationResponsibilityRetained: false,
      positionHeld: false,
      unresolvedClaimReleaseResponsibility: true,
      stopStage: NeedClaimObservation,
      lastAction: ImplementationAbandonedAction,
    },
  }

  action observeExactClaim: bool = all {
    state.stopStage == NeedClaimObservation,
    state.claimReadsThisActivation == 0,
    state' = {
      ...state,
      claimObservation: ClaimExact,
      claimReadsThisActivation: 1,
      claimReleaseAuthorizedByExactRead: true,
      unresolvedClaimReleaseResponsibility: true,
      stopStage: NeedClaimRelease,
      lastAction: ExactClaimObservedAction,
    },
  }

  action observeAbsentClaim: bool = all {
    state.stopStage == NeedClaimObservation,
    state.claimReadsThisActivation == 0,
    state' = {
      ...state,
      claimObservation: ClaimAbsent,
      claimResult: NoReleaseAbsent,
      exactClaimHeld: false,
      claimReadsThisActivation: 1,
      claimReleaseCallCountAtNonExactObservation: state.claimReleaseCallCount,
      unresolvedClaimReleaseResponsibility: false,
      stopStage: StopComplete,
      lastAction: AbsentClaimObservedAction,
    },
  }

  action observeForeignClaim: bool = all {
    state.stopStage == NeedClaimObservation,
    state.claimReadsThisActivation == 0,
    state' = {
      ...state,
      claimObservation: ClaimForeign,
      claimResult: NoReleaseForeign,
      exactClaimHeld: false,
      claimReadsThisActivation: 1,
      claimReleaseCallCountAtNonExactObservation: state.claimReleaseCallCount,
      unresolvedClaimReleaseResponsibility: false,
      stopStage: StopComplete,
      lastAction: ForeignClaimObservedAction,
    },
  }

  action observeUnreadableClaim: bool = all {
    state.stopStage == NeedClaimObservation,
    state.claimReadsThisActivation == 0,
    state' = {
      ...state,
      claimObservation: ClaimUnreadable,
      claimReadsThisActivation: 1,
      claimReleaseCallCountAtNonExactObservation: state.claimReleaseCallCount,
      unresolvedClaimReleaseResponsibility: true,
      stopStage: StopWaiting,
      lastAction: UnreadableClaimObservedAction,
    },
  }

  action recordClaimReleaseIntent: bool = all {
    state.stopStage == NeedClaimRelease,
    state.claimObservation == ClaimExact,
    state.claimReleaseAuthorizedByExactRead,
    not(state.claimReleaseIntentRecorded),
    state' = {
      ...state,
      claimReleaseIntentRecorded: true,
      lastAction: ClaimReleaseIntentRecordedAction,
    },
  }

  action releaseExactClaim: bool = all {
    state.stopStage == NeedClaimRelease,
    state.claimReleaseIntentRecorded,
    state.claimReleaseAuthorizedByExactRead,
    state.claimReleaseCallCount < 3,
    state' = {
      ...state,
      claimReleaseCallCount: state.claimReleaseCallCount + 1,
      claimReleaseCallCountAtNonExactObservation: state.claimReleaseCallCount + 1,
      claimObservation: ClaimAbsent,
      claimResult: ExactClaimReleased,
      exactClaimHeld: false,
      unresolvedClaimReleaseResponsibility: false,
      stopStage: StopComplete,
      lastAction: ClaimReleasedAction,
    },
  }

  action loseClaimReleaseResponse: bool = all {
    state.stopStage == NeedClaimRelease,
    state.claimReleaseIntentRecorded,
    state.claimReleaseAuthorizedByExactRead,
    state.claimReleaseCallCount < 3,
    state' = {
      ...state,
      claimReleaseCallCount: state.claimReleaseCallCount + 1,
      claimReleaseResponseAmbiguous: true,
      stopStage: ClaimReleaseAmbiguous,
      lastAction: ClaimReleaseResponseLostAction,
    },
  }

  action projectClaimReleased: bool = all {
    state.stopStage == ClaimReleaseAmbiguous,
    state.claimReleaseResponseAmbiguous,
    state.claimReleaseProjectionsThisActivation == 0,
    state' = {
      ...state,
      claimReleaseResponseAmbiguous: false,
      claimReleaseProjectionsThisActivation: 1,
      claimObservation: ClaimAbsent,
      claimReleaseCallCountAtNonExactObservation: state.claimReleaseCallCount,
      claimResult: ExactClaimReleased,
      unresolvedClaimReleaseResponsibility: false,
      stopStage: StopComplete,
      lastAction: ClaimReleaseReleasedProjectedAction,
    },
  }

  action projectClaimStillExact: bool = all {
    state.stopStage == ClaimReleaseAmbiguous,
    state.claimReleaseResponseAmbiguous,
    state.claimReleaseProjectionsThisActivation == 0,
    state' = {
      ...state,
      claimReleaseResponseAmbiguous: false,
      claimReleaseProjectionsThisActivation: 1,
      claimObservation: ClaimExact,
      stopStage: ClaimReleaseRetryWait,
      lastAction: ClaimReleaseStillExactProjectedAction,
    },
  }

  action recoverClaimActivation: bool = all {
    state.stopStage == StopWaiting or state.stopStage == ClaimReleaseRetryWait,
    state.claimRecoveryCount < RECOVERY_LIMIT,
    state' = {
      ...state,
      claimReadsThisActivation: 0,
      claimReleaseProjectionsThisActivation: 0,
      claimReleaseResponseAmbiguous: false,
      claimRecoveryCount: state.claimRecoveryCount + 1,
      stopStage: NeedClaimObservation,
      lastAction: ClaimRecoveryActivatedAction,
    },
  }

  action selectIndependentTaskB: bool = all {
    state.independentTaskEligible,
    not(state.independentTaskSelected),
    (stopChoiceApplied(state) and state.stopStage != StopComplete)
      or state.constraint == MissingClaimConstraint
      or state.constraint == ForeignClaimConstraint
      or state.constraint == UnreadableClaimConstraint,
    state' = { ...state, independentTaskSelected: true, lastAction: IndependentTaskSelectedAction },
  }

  action observeMembershipLoss: bool = all {
    state.phase == PreIntegration,
    state.f2WinningChoice == NoChoice,
    state.factDecision == ContinueWork,
    state.constraint == NoConstraint,
    state' = {
      ...state,
      constraint: MembershipConstraint,
      factDecision: RequestSafeSuspension,
      executorEvidence: ExactRunning,
      quiescenceUnbroken: false,
      positionHeld: true,
      lastAction: MembershipLossObservedAction,
    },
  }

  action observeLifecycleClosure: bool = all {
    state.phase == PreIntegration,
    state.f2WinningChoice == NoChoice,
    state.factDecision == ContinueWork,
    state.constraint == NoConstraint,
    state' = {
      ...state,
      constraint: LifecycleConstraint,
      factDecision: RequestSafeSuspension,
      executorEvidence: ExactRunning,
      quiescenceUnbroken: false,
      positionHeld: true,
      lastAction: LifecycleClosureObservedAction,
    },
  }

  action observeSpecificationChange: bool = all {
    state.phase == PreIntegration,
    state.f2WinningChoice == NoChoice,
    state.factDecision == ContinueWork,
    state.constraint == NoConstraint,
    state' = {
      ...state,
      constraint: SpecificationConstraint,
      factDecision: RequestSafeSuspension,
      executorEvidence: ExactRunning,
      quiescenceUnbroken: false,
      positionHeld: true,
      lastAction: SpecificationChangeObservedAction,
    },
  }

  action observeExternalSuccess: bool = all {
    state.phase == PreIntegration,
    state.f2WinningChoice == NoChoice,
    state.factDecision == ContinueWork,
    state.constraint == NoConstraint,
    state' = {
      ...state,
      constraint: ExternalSuccessConstraint,
      factDecision: RequestSafeSuspension,
      executorEvidence: ExactRunning,
      quiescenceUnbroken: false,
      positionHeld: true,
      dependantsReleasedByFreshGraph: true,
      duplicateDeliveryPrevented: true,
      lastAction: ExternalSuccessObservedAction,
    },
  }

  action observeIncompleteMembershipRead: bool = all {
    state.phase == PreIntegration,
    state.f2WinningChoice == NoChoice,
    state.factDecision == ContinueWork,
    state.constraint == NoConstraint,
    state.lastAction != IncompleteMembershipReadObservedAction,
    state' = { ...state, lastAction: IncompleteMembershipReadObservedAction },
  }

  action observeMissingClaimConstraint: bool = all {
    state.phase == PreIntegration,
    state.f2WinningChoice == NoChoice,
    state.factDecision == ContinueWork,
    state.constraint == NoConstraint,
    state' = {
      ...state,
      constraint: MissingClaimConstraint,
      factDecision: RequestSafeSuspension,
      executorEvidence: ExactRunning,
      quiescenceUnbroken: false,
      positionHeld: true,
      claimState: MissingClaim,
      exactClaimHeld: false,
      lastAction: MissingClaimConstraintObservedAction,
    },
  }

  action observeForeignClaimConstraint: bool = all {
    state.phase == PreIntegration,
    state.f2WinningChoice == NoChoice,
    state.factDecision == ContinueWork,
    state.constraint == NoConstraint,
    state' = {
      ...state,
      constraint: ForeignClaimConstraint,
      factDecision: RequestSafeSuspension,
      executorEvidence: ExactRunning,
      quiescenceUnbroken: false,
      positionHeld: true,
      claimState: ForeignClaim,
      exactClaimHeld: false,
      lastClaimMutationTarget: NoClaimMutation,
      lastAction: ForeignClaimConstraintObservedAction,
    },
  }

  action observeUnreadableClaimConstraint: bool = all {
    state.phase == PreIntegration,
    state.f2WinningChoice == NoChoice,
    state.factDecision == ContinueWork,
    state.constraint == NoConstraint,
    state' = {
      ...state,
      constraint: UnreadableClaimConstraint,
      factDecision: RequestSafeSuspension,
      executorEvidence: ExactRunning,
      quiescenceUnbroken: false,
      positionHeld: true,
      claimState: UnreadableClaim,
      lastAction: UnreadableClaimConstraintObservedAction,
    },
  }

  action reportSafelySuspended: bool = all {
    state.factDecision == RequestSafeSuspension,
    state' = {
      ...state,
      executorEvidence: ExactSafelySuspended,
      quiescenceUnbroken: true,
      positionHeld: false,
      factDecision:
        if (state.constraint == MembershipConstraint) MembershipWait
        else if (state.constraint == LifecycleConstraint) LifecycleWait
        else if (state.constraint == SpecificationConstraint) SpecificationChoices
        else if (state.constraint == ExternalSuccessConstraint) ReleaseExternalSuccessClaim
        else if (state.constraint == MissingClaimConstraint) MissingClaimWait
        else if (state.constraint == ForeignClaimConstraint) ForeignClaimWait
        else UnreadableClaimWait,
      lastAction: TaskFactsSafelySuspendedAction,
    },
  }

  action applyMissingClaimReacquisitionDirection: bool = all {
    state.factDecision == MissingClaimWait,
    state' = {
      ...state,
      factDecision: AllocateReplacementClaim,
      reacquisitionDirectionApplied: true,
      lastAction: MissingClaimDirectionAppliedAction,
    },
  }

  action applyForeignClaimReacquisitionDirection: bool = all {
    state.factDecision == ForeignClaimWait,
    state' = {
      ...state,
      reacquisitionDirectionApplied: true,
      lastAction: ForeignClaimDirectionAppliedAction,
    },
  }

  action rejectForeignClaimReacquisition: bool = all {
    state.factDecision == ForeignClaimWait,
    state.reacquisitionDirectionApplied,
    state.lastAction != ForeignClaimReacquisitionRejectedAction,
    state' = { ...state, lastAction: ForeignClaimReacquisitionRejectedAction },
  }

  action planReplacementClaim: bool = {
    nondet allocatedIdentity = Set(state.originalClaimIdentity, state.originalClaimIdentity + 1).oneOf()
    all {
      state.factDecision == AllocateReplacementClaim,
      state.reacquisitionDirectionApplied,
      allocatedIdentity != state.originalClaimIdentity,
      state' = {
        ...state,
        factDecision: ObserveReplacementClaim,
        claimState: ReplacementClaim,
        exactClaimHeld: true,
        replacementIntentRecorded: true,
        currentClaimIdentity: allocatedIdentity,
        lastAction: ReplacementClaimPlannedAction,
      },
    }
  }

  action observeExactReplacementClaim: bool = all {
    state.factDecision == ObserveReplacementClaim,
    state.claimState == ReplacementClaim,
    state' = {
      ...state,
      constraint: NoConstraint,
      factDecision: ContinueWork,
      claimState: ExactClaim,
      reacquisitionDirectionApplied: false,
      replacementIntentRecorded: false,
      lastAction: ReplacementClaimObservedAction,
    },
  }

  action observeFreshLifecycleReopen: bool = all {
    state.factDecision == LifecycleWait,
    state' = {
      ...state,
      constraint: NoConstraint,
      factDecision: ContinueWork,
      lastAction: LifecycleReopenedAction,
    },
  }

  action releaseExternalSuccessExactClaim: bool = all {
    state.factDecision == ReleaseExternalSuccessClaim,
    state.exactClaimHeld,
    state' = {
      ...state,
      factDecision: ExternalSuccessSettled,
      exactClaimHeld: false,
      lastAction: ExternalSuccessClaimReleasedAction,
    },
  }

  action requestOwnedClaimMutation: bool = all {
    state.claimState == ExactClaim or state.claimState == ReplacementClaim,
    state' = {
      ...state,
      lastClaimMutationTarget: OwnedClaimMutation,
      lastAction: OwnedClaimMutationRequestedAction,
    },
  }

  action step: bool = any {
    observeF2Change,
    applyContinueF2,
    applyStopF2,
    redeliverExactF2Choice,
    rejectRunMismatchedRequest,
    rejectPersistedRequestContentReuse,
    rejectLosingF2Choice,
    observeExactTerminal,
    beginIntegration,
    rejectContinuePastIntegrationCutoff,
    rejectStopPastIntegrationCutoff,
    readFreshExactGraph,
    readFreshExactSpecification,
    readFreshExactClaim,
    readFreshExactWorktree,
    readFreshExactLineage,
    readFreshExactExecutor,
    admitSameAttemptP,
    observeF3BeforeContinuation,
    applyContinueF3,
    requireStoppageReconciliation,
    recordStoppageIntent,
    callStoppage,
    loseStoppageResponse,
      projectExactRunningForStoppage,
      projectExactSafeForStoppage,
      projectExactTerminalForStoppage,
    recoverStopActivation,
    projectReadOnlyExactSafeAfterStoppageLimit,
    abandonImplementation,
    observeExactClaim,
    observeAbsentClaim,
    observeForeignClaim,
    observeUnreadableClaim,
    recordClaimReleaseIntent,
    releaseExactClaim,
    loseClaimReleaseResponse,
    projectClaimReleased,
    projectClaimStillExact,
    recoverClaimActivation,
    selectIndependentTaskB,
    observeMembershipLoss,
    observeLifecycleClosure,
    observeSpecificationChange,
    observeExternalSuccess,
    observeIncompleteMembershipRead,
    observeMissingClaimConstraint,
    observeForeignClaimConstraint,
    observeUnreadableClaimConstraint,
    reportSafelySuspended,
    applyMissingClaimReacquisitionDirection,
    applyForeignClaimReacquisitionDirection,
    rejectForeignClaimReacquisition,
    planReplacementClaim,
    observeExactReplacementClaim,
    observeFreshLifecycleReopen,
    releaseExternalSuccessExactClaim,
    requestOwnedClaimMutation,
  }

  // Executable conformance intentionally exercises the #65 boundary slice.
  // The older task-fact scenarios remain collected above and in `step`, while
  // this phase-directed relation avoids spending samples on actions whose
  // guards cannot hold while retaining every #65 branch as a real choice.
  // Keep every phase guard inline under the top-level disjunction. The Quint
  // TypeScript backend otherwise reports a named helper action instead of the
  // selected production action for some nested branches.
  action mbtStep: bool = any {
    all {
      state.f2WinningChoice == NoChoice,
      if (state.phase == IntegrationStarted)
        any { observeF2Change, rejectContinuePastIntegrationCutoff, rejectStopPastIntegrationCutoff }
      else if (state.currentFingerprint == F1)
        any { observeF2Change, rejectRunMismatchedRequest, observeExactTerminal, beginIntegration }
      else any { applyContinueF2, applyStopF2, rejectRunMismatchedRequest, observeExactTerminal },
    },
    all {
      state.f2WinningChoice == ContinueChoice,
      state.continueStage == NeedFreshGraph,
      any { readFreshExactGraph, redeliverExactF2Choice, rejectPersistedRequestContentReuse, rejectLosingF2Choice },
    },
    all {
      state.f2WinningChoice == ContinueChoice,
      state.continueStage == NeedFreshSpecification,
      any {
        readFreshExactSpecification,
        observeF3BeforeContinuation,
        redeliverExactF2Choice,
        rejectPersistedRequestContentReuse,
        rejectLosingF2Choice,
      },
    },
    all {
      state.f2WinningChoice == ContinueChoice,
      state.continueStage == NeedFreshClaim,
      any { readFreshExactClaim, redeliverExactF2Choice, rejectPersistedRequestContentReuse, rejectLosingF2Choice },
    },
    all {
      state.f2WinningChoice == ContinueChoice,
      state.continueStage == NeedFreshWorktree,
      any { readFreshExactWorktree, redeliverExactF2Choice, rejectPersistedRequestContentReuse, rejectLosingF2Choice },
    },
    all {
      state.f2WinningChoice == ContinueChoice,
      state.continueStage == NeedFreshLineage,
      any { readFreshExactLineage, redeliverExactF2Choice, rejectPersistedRequestContentReuse, rejectLosingF2Choice },
    },
    all {
      state.f2WinningChoice == ContinueChoice,
      state.continueStage == NeedFreshExecutor,
      any { readFreshExactExecutor, redeliverExactF2Choice, rejectPersistedRequestContentReuse, rejectLosingF2Choice },
    },
    all {
      state.f2WinningChoice == ContinueChoice,
      state.continueStage == ReadyToResume,
      any { admitSameAttemptP, redeliverExactF2Choice, rejectPersistedRequestContentReuse, rejectLosingF2Choice },
    },
    all {
      state.f2WinningChoice == ContinueChoice,
      state.continueStage == NewChoiceRequired,
      any { applyContinueF3, redeliverExactF2Choice, rejectPersistedRequestContentReuse, rejectLosingF2Choice },
    },
    all {
      state.f2WinningChoice == ContinueChoice,
      state.continueStage == ContinueResumed or state.continueStage == ContinueWaiting,
      any { redeliverExactF2Choice, rejectPersistedRequestContentReuse, rejectLosingF2Choice },
    },
    all {
      state.f2WinningChoice == StopChoice,
      state.stopStage == NeedQuiescence,
      stopCommandActive(state),
      not(state.stopCommandCalled),
      any { callStoppage },
    },
    all {
      state.f2WinningChoice == StopChoice,
      state.stopStage == NeedQuiescence,
      stopCommandActive(state),
      state.stopCommandCalled,
      not(state.stopResponseAmbiguous),
      any { loseStoppageResponse },
    },
    all {
      state.f2WinningChoice == StopChoice,
      state.stopStage == NeedQuiescence,
      stopCommandActive(state),
      state.stopCommandCalled,
      state.stopResponseAmbiguous,
      state.stopProjectionsThisActivation == 0,
      any {
        projectExactRunningForStoppage,
        projectExactSafeForStoppage,
        projectExactTerminalForStoppage,
        recoverStopActivation,
      },
    },
    all {
      state.f2WinningChoice == StopChoice,
      state.stopStage == NeedQuiescence,
      stopCommandActive(state),
      state.stopCommandCalled,
      state.stopResponseAmbiguous,
      state.stopProjectionsThisActivation != 0,
      any { recoverStopActivation },
    },
    all {
      state.f2WinningChoice == StopChoice,
      state.stopStage == NeedQuiescence,
      not(stopCommandActive(state)),
      exactQuiescence(state),
      any {
        requireStoppageReconciliation,
        abandonImplementation,
        redeliverExactF2Choice,
        rejectPersistedRequestContentReuse,
        rejectLosingF2Choice,
      },
    },
    all {
      state.f2WinningChoice == StopChoice,
      state.stopStage == NeedQuiescence,
      not(stopCommandActive(state)),
      not(exactQuiescence(state)),
      state.stopProjectionsThisActivation == 1,
      any { recoverStopActivation },
    },
    all {
      state.f2WinningChoice == StopChoice,
      state.stopStage == NeedQuiescence,
      not(stopCommandActive(state)),
      not(exactQuiescence(state)),
      state.stopProjectionsThisActivation != 1,
      state.stopCommandIntentCount == STOP_COMMAND_LIMIT,
      any { projectReadOnlyExactSafeAfterStoppageLimit },
    },
    all {
      state.f2WinningChoice == StopChoice,
      state.stopStage == NeedQuiescence,
      not(stopCommandActive(state)),
      not(exactQuiescence(state)),
      state.stopProjectionsThisActivation != 1,
      state.stopCommandIntentCount != STOP_COMMAND_LIMIT,
      any {
        recordStoppageIntent,
        selectIndependentTaskB,
        redeliverExactF2Choice,
        rejectPersistedRequestContentReuse,
        rejectLosingF2Choice,
      },
    },
    all {
      state.f2WinningChoice == StopChoice,
      state.stopStage == NeedClaimObservation,
      any {
        observeExactClaim,
        observeAbsentClaim,
        observeForeignClaim,
        observeUnreadableClaim,
        selectIndependentTaskB,
      },
    },
    all {
      state.f2WinningChoice == StopChoice,
      state.stopStage == NeedClaimRelease,
      any { recordClaimReleaseIntent, releaseExactClaim, loseClaimReleaseResponse },
    },
    all {
      state.f2WinningChoice == StopChoice,
      state.stopStage == ClaimReleaseAmbiguous,
      any { projectClaimReleased, projectClaimStillExact, selectIndependentTaskB },
    },
    all {
      state.f2WinningChoice == StopChoice,
      state.stopStage == ClaimReleaseRetryWait,
      any { recoverClaimActivation },
    },
    all {
      state.f2WinningChoice == StopChoice,
      state.stopStage == StopWaiting,
      any { recoverClaimActivation, selectIndependentTaskB },
    },
    all {
      state.f2WinningChoice == StopChoice,
      state.stopStage == ImplementationAbandoned or state.stopStage == StopComplete,
      any { redeliverExactF2Choice, rejectPersistedRequestContentReuse, rejectLosingF2Choice },
    },
  }
}
