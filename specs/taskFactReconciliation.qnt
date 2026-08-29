// Models Alice's Continue, Restart, or Stop choice for one exact changed-task
// attempt. The choice is durable before fresh authority reads or boundary
// effects. Continue resumes only immutable P1. Restart atomically supersedes P1
// and records clean P2 only after current executor quiescence and exact fresh
// F2/K1/W1-H1-B1/H2 evidence. Stop abandons implementation only after exact
// unbroken quiescence and reconciles claim release separately.
module taskFactReconciliation {
  type Fingerprint = F1 | F2 | F3
  type Attempt = NoAttempt | AttemptP | AttemptQ
  type Choice = NoChoice | ContinueChoice | RestartChoice | StopChoice

  // P2 is the one exact successor recorded by PlannedAttemptReplaced. P3 is
  // present only so negative controls can prove that recovery never allocates
  // another successor after P2 is durable.
  type PlannedSuccessor = NoPlannedSuccessor | PlannedP2 | PlannedP3

  // Git commits, branch identities, and worktree identities are different
  // authority facts even in this finite model. Distinct types prevent a
  // branch or locator from accidentally satisfying an exact-SHA guard.
  type GitCommit = NoGitCommit | BaseB1Commit | HeadH1Commit | HeadH2Commit | OtherGitCommit
  type BranchIdentity = NoBranch | P1Branch | P2Branch
  type WorktreeIdentity = NoWorktree | W1Worktree | W2Worktree

  // These phases are the journal- and boundary-visible chronology owned by
  // issue #66. Waiting and rejection reasons remain separate below because a
  // running writer, an unreadable owner, and a conclusive terminal outcome are
  // different phenomena even though none authorizes P2.
  type ReplacementPhase =
    | ReplacementNotRequested
    | RestartApplied
    | NeedCurrentExecutorQuiescence
    | NeedCurrentReplacementTaskFacts
    | NeedCurrentReplacementClaim
    | NeedCurrentOldWorktree
    | NeedCurrentTargetHead
    | ReplacementReadyToAppend
    | PlannedAttemptReplacementRecorded
    | SuccessorWaitingForAdmission
    | SuccessorAdmitted
    | SuccessorRunning
    | ReplacementWaiting
    | ReplacementRejected

  type ReplacementDisposition =
    | NoReplacementDisposition
    | RunningWriterWait
    | ExecutorUnreadableWait
    | ExecutorCorrelationContradiction
    | CompletedDoesNotAuthorizeReplacement
    | FailedDoesNotAuthorizeReplacement
    | NewFingerprintChoiceRequired
    | TaskFactsUnreadableWait
    | TaskNotEligibleWait
    | ClaimAbsentWait
    | ClaimForeignWait
    | ClaimUnreadableWait
    | OldWorktreeNotReadyWait
    | OldWorktreeUnreadableWait
    | TargetHeadUnreadableWait
    | PastIntegrationCutoff

  type ReplacementTaskFacts =
    | ReplacementTaskFactsNotRead
    | ExactF2OpenInClosureUnblocked
    | ReplacementF3Observed
    | ReplacementTaskFactsUnreadable
    | ReplacementTaskNotEligible

  type ReplacementClaimFacts =
    | ReplacementClaimNotRead
    | ExactK1Observed
    | ReplacementClaimAbsent
    | ReplacementClaimForeign
    | ReplacementClaimUnreadable

  type OldWorktreeFacts =
    | OldWorktreeNotRead
    | ExactW1Ready
    | OldWorktreeNotReady
    | OldWorktreeUnreadable

  type ReplacementTargetHeadFacts =
    | ReplacementTargetHeadNotRead
    | ExactH2Observed
    | ReplacementTargetHeadUnreadable

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
    | ExactCompletedTerminal
    | ExactFailedTerminal
    | ExactAcceptedTerminal
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
  // AuthorityReadPurpose distinguishes an ordinary continuation projection
  // from the tracker/timer opportunity that rereads authority for Running work.
  type AuthorityReadPurpose = OrdinaryContinuationRead | ActiveWorkRefreshRead
  // Only these two process-local triggers may mint an active refresh. Ordinary
  // AcceptedFactPublication and OperatorWake entries keep NoRefreshSource and
  // therefore remain ordinary continuation projections.
  type RefreshSource = NoRefreshSource | TrackerNotification | Timer
  type FactDecision =
    | ContinueWork
    | AwaitNextActiveWorkRefresh
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
    | RestartF2AppliedAction
    | StopF2AppliedAction
    | ExactRedeliveredAction
    | RunMismatchRejectedAction
    | ContentReuseRejectedAction
    | LosingChoiceRejectedAction
    | TerminalObservedAction
    | IntegrationStartedAction
    | PostCutoffContinueRejectedAction
    | PostCutoffRestartRejectedAction
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
    | RestartFactsBeganAction
    | RestartQuiescenceBrokenAction
    | RestartRunningObservedAction
    | RestartSafeObservedAction
    | RestartAcceptedObservedAction
    | RestartCompletedObservedAction
    | RestartFailedObservedAction
    | RestartExecutorUnavailableObservedAction
    | RestartExecutorContradictionObservedAction
    | ReplacementF2FactsObservedAction
    | ReplacementF3FactsObservedAction
    | ReplacementTaskFactsUnreadableAction
    | ReplacementTaskNotEligibleAction
    | ReplacementK1ObservedAction
    | ReplacementClaimAbsentAction
    | ReplacementClaimForeignAction
    | ReplacementClaimUnreadableAction
    | ReplacementClaimReadActivationRecoveredAction
    | ReplacementW1ReadyAction
    | ReplacementW1NotReadyAction
    | ReplacementW1UnreadableAction
    | ReplacementH2ObservedAction
    | ReplacementH2UnreadableAction
    | ReplacementAppendAbsentAfterCrashAction
    | PlannedAttemptReplacementRecordedAction
    | ReplacementAppendPresentAfterCrashAction
    | SuccessorW2ReadyAction
    | SuccessorOrdinarilyAdmittedAction
    | SuccessorExecutorStartedAction
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
    | ActiveWorkRunningEstablishedAction
    | ActiveRefreshTrackerNotificationOfferedAction
    | ActiveRefreshTimerOfferedAction
    | ActiveRefreshHealthyObservedAction
    | ActiveRefreshUnreadableObservedAction
    | ActiveRefreshGitFailuresObservedAction
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
    // The shared executor protocol resets its three-Suspend budget whenever
    // exact safe evidence is published; lifetime intent totals do not reset.
    suspensionCommandCountSinceSafeEvidence: int,
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
    claimReleaseCallCountAtRestart: int,
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
    authorityReadPurpose: AuthorityReadPurpose,
    refreshSource: RefreshSource,
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
    replacementPhase: ReplacementPhase,
    replacementDisposition: ReplacementDisposition,
    replacementTaskFacts: ReplacementTaskFacts,
    replacementClaimFacts: ReplacementClaimFacts,
    replacementClaimReadsThisActivation: int,
    oldWorktreeFacts: OldWorktreeFacts,
    replacementTargetHeadFacts: ReplacementTargetHeadFacts,
    observedOldWorktreeHead: GitCommit,
    oldBaseB1IsAncestor: bool,
    observedReplacementTargetHead: GitCommit,
    p1Unsettled: bool,
    p1Superseded: bool,
    plannedSuccessor: PlannedSuccessor,
    replacementEventRecorded: bool,
    replacementEventCount: int,
    successorAllocationCount: int,
    successorBaseHead: GitCommit,
    successorBranchIdentity: BranchIdentity,
    successorWorktreeIdentity: WorktreeIdentity,
    successorCarriesP1Content: bool,
    successorWorktreeReady: bool,
    successorAdmissionCount: int,
    successorPositionHeld: bool,
    successorExecutorStartCount: int,
    successorExecutorResponsibilityRetained: bool,
    replacementProcessLossCount: int,
    completedResultPreserved: bool,
    failedResultPreserved: bool,
    lateAcceptedCommitPreserved: bool,
    lateAcceptedEvidencePreserved: bool,
    lateAcceptedIntegrationResponsibilityCount: int,
    p1BranchPreserved: bool,
    p1CommitsPreserved: bool,
    p1JournalEvidencePreserved: bool,
    replacementCleanupCallCount: int,
    replacementClaimMutationCallCount: int,
    lastAction: ActionTag,
  }

  pure val RUN_R = 65
  pure val OTHER_RUN = 66
  pure val TASK_A = 1
  pure val ATTEMPT_P = 1
  pure val BASE_B1: GitCommit = BaseB1Commit
  pure val CURRENT_W1_HEAD_H1: GitCommit = HeadH1Commit
  pure val TARGET_HEAD_H2: GitCommit = HeadH2Commit
  pure val BRANCH_P1: BranchIdentity = P1Branch
  pure val BRANCH_P2: BranchIdentity = P2Branch
  pure val WORKTREE_W1: WorktreeIdentity = W1Worktree
  pure val WORKTREE_W2: WorktreeIdentity = W2Worktree
  pure val TASK_WORK_CAPACITY = 1
  pure val REPLACEMENT_CLAIM_READ_LIMIT = 3
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
  // The finite nonce is only an encoding. This value is issue #66's exact D1
  // Restart request identity and is distinct from the older #65 fixtures.
  pure val RESTART_D1: RequestId = { runId: RUN_R, nonce: 4 }
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
      and Set(
        ExactSafelySuspended,
        ExactTerminal,
        ExactCompletedTerminal,
        ExactFailedTerminal,
        ExactAcceptedTerminal,
      ).contains(s.executorEvidence)

  pure def replacementQuiescence(s: State): bool =
    s.quiescenceUnbroken
      and (s.executorEvidence == ExactSafelySuspended or s.executorEvidence == ExactAcceptedTerminal)

  pure def replacementPendingBeforeAppend(s: State): bool =
    Set(
      RestartApplied,
      NeedCurrentReplacementTaskFacts,
      NeedCurrentReplacementClaim,
      NeedCurrentOldWorktree,
      NeedCurrentTargetHead,
      ReplacementReadyToAppend,
    ).contains(s.replacementPhase)

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
        or state.lastAction == PostCutoffRestartRejectedAction
        or state.lastAction == PostCutoffStopRejectedAction
    )
      or and {
        state.f2WinningChoice == NoChoice,
        state.continueStage == NotContinuing,
        state.stopStage == NotStopping,
        not(state.replacementEventRecorded),
        state.lastAction != PostCutoffRestartRejectedAction or and {
          state.replacementPhase == ReplacementRejected,
          state.replacementDisposition == PastIntegrationCutoff,
        },
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
      or and {
        state.f2WinningChoice == RestartChoice,
        state.replacementPhase == ReplacementRejected,
        state.replacementDisposition == NewFingerprintChoiceRequired,
        not(state.replacementEventRecorded),
      }
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
    // Executor command ordinals are shared with StartOrContinue. Restart may
    // therefore advance the next ordinal without adding a stoppage intent.
    state.nextStopCommandOrdinal >= state.stopCommandIntentCount + 2,
    state.activeStopCommandOrdinal == 0
      or and {
        state.activeStopCommandOrdinal >= 2,
        state.activeStopCommandOrdinal < state.nextStopCommandOrdinal,
      },
    (state.stopCommandSettlementCount == 0) == (state.lastSettledStopCommandOrdinal == 0),
    state.lastSettledStopCommandOrdinal == 0
      or and {
        state.lastSettledStopCommandOrdinal >= state.stopCommandSettlementCount + 1,
        state.lastSettledStopCommandOrdinal < state.nextStopCommandOrdinal,
      },
  }

  // The existing executor protocol counts Suspend commands only since the
  // most recent exact safe report, then switches to read-only observation at
  // the limit. Restart and Stop share that same episode-local allowance.
  val stoppageIsBounded: bool = and {
    state.suspensionCommandCountSinceSafeEvidence <= STOP_COMMAND_LIMIT,
    state.stopProjectionsThisActivation <= 1,
    state.stopRecoveryCount <= RECOVERY_LIMIT,
  }

  val stoppageLimitPreservesReadOnlyRecovery: bool =
    state.suspensionCommandCountSinceSafeEvidence != STOP_COMMAND_LIMIT
      or stopCommandActive(state)
      or state.executorEvidence != ExactRunning
      or state.stopProjectionsThisActivation != 1
      or state.stopRecoveryCount <= RECOVERY_LIMIT

  val abandonmentRequiresExactUnbrokenQuiescence: bool =
    not(state.implementationResponsibilityRetained) implies or {
      and {
        stopChoiceApplied(state),
        exactQuiescence(state),
        state.phase == PreIntegration,
      },
      and {
        state.f2WinningChoice == RestartChoice,
        state.phase == PreIntegration,
        state.quiescenceUnbroken,
        or {
          state.executorEvidence == ExactAcceptedTerminal,
          state.executorEvidence == ExactCompletedTerminal,
          state.executorEvidence == ExactFailedTerminal,
          and {
            state.replacementEventRecorded,
            state.executorEvidence == ExactSafelySuspended,
          },
        },
      },
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
    if (state.f2WinningChoice == RestartChoice)
      state.replacementClaimFacts != ReplacementClaimUnreadable
        or and {
          not(state.replacementEventRecorded),
          state.replacementClaimMutationCallCount == 0,
        }
    else
      state.claimState != UnreadableClaim
        or and { not(state.reacquisitionDirectionApplied), not(state.replacementIntentRecorded) }

  // An unreadable tracker response during a refresh of Running work is not
  // evidence that the task must be suspended and is never continuation
  // authorization. The same position and implementation responsibility stay
  // held until a later tracker/timer opportunity can obtain exact facts.
  val activeRefreshUnreadableAuthorizesNoExecutorAction: bool =
    state.lastAction != ActiveRefreshUnreadableObservedAction or and {
      state.authorityReadPurpose == ActiveWorkRefreshRead,
      state.factDecision == AwaitNextActiveWorkRefresh,
      state.constraint == NoConstraint,
      state.executorEvidence == ExactRunning,
      state.positionHeld,
      state.implementationResponsibilityRetained,
      not(state.cleanupSelected),
      not(state.integrationSelected),
    }

  // A healthy active refresh is an observation-only handoff. It preserves
  // the exact Running responsibility and waits for the next tracker/timer
  // opportunity instead of authorizing another executor call.
  val healthyActiveRefreshAuthorizesNoExecutorAction: bool =
    state.lastAction != ActiveRefreshHealthyObservedAction or and {
      state.authorityReadPurpose == ActiveWorkRefreshRead,
      state.factDecision == AwaitNextActiveWorkRefresh,
      state.constraint == NoConstraint,
      state.executorEvidence == ExactRunning,
      state.positionHeld,
      state.implementationResponsibilityRetained,
      not(state.cleanupSelected),
      not(state.integrationSelected),
    }

  // Worktree and target-lineage read failures during an active refresh are
  // durable unreadable waits. Replaying either exact operation must not issue
  // another Git call, and the current Running position remains held.
  val activeRefreshGitFailuresAuthorizeNoExecutorAction: bool =
    state.lastAction != ActiveRefreshGitFailuresObservedAction or and {
      state.authorityReadPurpose == ActiveWorkRefreshRead,
      state.refreshSource == TrackerNotification or state.refreshSource == Timer,
      state.factDecision == AwaitNextActiveWorkRefresh,
      state.constraint == NoConstraint,
      state.executorEvidence == ExactRunning,
      state.positionHeld,
      state.implementationResponsibilityRetained,
      not(state.cleanupSelected),
      not(state.integrationSelected),
    }

  // A refresh source is meaningful only for an active-refresh read. This is
  // the model-level correspondence for ordinary AcceptedFactPublication and
  // OperatorWake entries: they retain NoRefreshSource and cannot mint this
  // active authority path.
  val ordinaryAuthorityReadHasNoRefreshSource: bool =
    state.authorityReadPurpose != OrdinaryContinuationRead
      or state.refreshSource == NoRefreshSource

  val activeRefreshSourceIsTrackerOrTimer: bool =
    not(
      state.lastAction == ActiveRefreshTrackerNotificationOfferedAction
        or state.lastAction == ActiveRefreshTimerOfferedAction
        or state.lastAction == ActiveRefreshHealthyObservedAction
        or state.lastAction == ActiveRefreshUnreadableObservedAction
    ) or state.refreshSource == TrackerNotification or state.refreshSource == Timer

  // The setup action that establishes already Running work is distinct from
  // the later tracker/timer offer and cannot itself be mistaken for a refresh.
  val activeWorkRunningEstablishmentRetainsAuthority: bool =
    state.lastAction != ActiveWorkRunningEstablishedAction or and {
      state.authorityReadPurpose == OrdinaryContinuationRead,
      state.factDecision == ContinueWork,
      state.constraint == NoConstraint,
      state.executorEvidence == ExactRunning,
      state.positionHeld,
      state.implementationResponsibilityRetained,
      not(state.cleanupSelected),
      not(state.integrationSelected),
    }

  // The ordinary activation path remains fail-closed: an unreadable claim
  // while deciding whether work may continue requests the existing exact safe
  // suspension route.
  val ordinaryUnreadableStillRequestsSafeSuspension: bool =
    state.lastAction != UnreadableClaimConstraintObservedAction or and {
      state.authorityReadPurpose == OrdinaryContinuationRead,
      state.factDecision == RequestSafeSuspension,
      state.constraint == UnreadableClaimConstraint,
      state.executorEvidence == ExactRunning,
      state.positionHeld,
    }

  // The action guard and this requirement deliberately spell the authorization
  // separately. A weakened choice, task, claim, worktree, lineage, target, or
  // quiescence guard must make this invariant fail.
  val plannedAttemptReplacementRequiresExactCurrentEvidence: bool =
    not(state.replacementEventRecorded) or and {
      state.phase == PreIntegration,
      state.f2WinningChoice == RestartChoice,
      state.firstF2Choice == RestartChoice,
      state.winningRequestId.runId == RUN_R,
      state.winningRequestId.nonce == RESTART_D1.nonce,
      state.winningSubject.runId == SUBJECT_F2.runId,
      state.winningSubject.taskId == SUBJECT_F2.taskId,
      state.winningSubject.attemptId == SUBJECT_F2.attemptId,
      state.winningSubject.plannedFingerprint == F1,
      state.winningSubject.observedFingerprint == F2,
      state.currentFingerprint == F2,
      state.quiescenceUnbroken,
      state.executorEvidence == ExactSafelySuspended
        or state.executorEvidence == ExactAcceptedTerminal,
      state.replacementTaskFacts == ExactF2OpenInClosureUnblocked,
      state.replacementClaimFacts == ExactK1Observed,
      state.oldWorktreeFacts == ExactW1Ready,
      state.observedOldWorktreeHead == CURRENT_W1_HEAD_H1,
      state.oldBaseB1IsAncestor,
      state.replacementTargetHeadFacts == ExactH2Observed,
      state.observedReplacementTargetHead == TARGET_HEAD_H2,
    }

  // PlannedAttemptReplaced is one Journal event. No retained prefix can say
  // that P1 is superseded without carrying P2 in that same event.
  val plannedAttemptReplacementIsAtomic: bool = and {
    state.p1Superseded == state.replacementEventRecorded,
    not(state.p1Unsettled) == state.replacementEventRecorded,
    (state.plannedSuccessor == PlannedP2) == state.replacementEventRecorded,
    state.replacementEventCount == if (state.replacementEventRecorded) 1 else 0,
    state.successorAllocationCount == if (state.replacementEventRecorded) 1 else 0,
  }

  val replacementLeavesAtMostOneUnsettledAttempt: bool = or {
    and {
      state.p1Unsettled,
      not(state.p1Superseded),
      state.plannedSuccessor == NoPlannedSuccessor,
    },
    and {
      not(state.p1Unsettled),
      state.p1Superseded,
      state.plannedSuccessor == PlannedP2,
    },
  }

  val replacementNeverAllocatesP3: bool = and {
    state.plannedSuccessor != PlannedP3,
    state.successorAllocationCount <= 1,
  }

  val restartPreservesP1Resources: bool =
    state.f2WinningChoice != RestartChoice or and {
      state.worktreePreserved,
      state.wipPreserved,
      state.p1BranchPreserved,
      state.p1CommitsPreserved,
      state.p1JournalEvidencePreserved,
      state.sessionHistoryPreserved,
      state.logsPreserved,
      state.evidencePreserved,
      not(state.cleanupSelected),
      state.replacementCleanupCallCount == 0,
    }

  val restartRetainsExactK1WithoutTrackerMutation: bool =
    state.f2WinningChoice != RestartChoice
      or state.replacementClaimFacts != ExactK1Observed
      or and {
        state.exactClaimHeld,
        state.currentClaimIdentity == state.originalClaimIdentity,
        state.replacementClaimMutationCallCount == 0,
        state.claimReleaseCallCount == state.claimReleaseCallCountAtRestart,
      }

  val restartSendsNoClaimMutation: bool =
    state.f2WinningChoice != RestartChoice or and {
      state.replacementClaimMutationCallCount == 0,
      state.claimReleaseCallCount == state.claimReleaseCallCountAtRestart,
    }

  val replacementClaimReadsAreBounded: bool = and {
    state.replacementClaimReadsThisActivation >= 0,
    state.replacementClaimReadsThisActivation <= REPLACEMENT_CLAIM_READ_LIMIT,
  }

  val successorPlanIsCleanW2AtExactH2: bool =
    not(state.replacementEventRecorded) or and {
      state.plannedSuccessor == PlannedP2,
      state.successorBaseHead == TARGET_HEAD_H2,
      state.successorBranchIdentity == BRANCH_P2,
      state.successorBranchIdentity != BRANCH_P1,
      state.successorWorktreeIdentity == WORKTREE_W2,
      state.successorWorktreeIdentity != WORKTREE_W1,
      not(state.successorCarriesP1Content),
    }

  val replacementEventDoesNotClaimW2OrExecutorWork: bool =
    state.lastAction != PlannedAttemptReplacementRecordedAction or and {
      not(state.successorWorktreeReady),
      state.successorAdmissionCount == 0,
      not(state.successorPositionHeld),
      state.successorExecutorStartCount == 0,
      not(state.successorExecutorResponsibilityRetained),
    }

  val successorUsesOrdinaryBoundedAdmission: bool = and {
    state.successorAdmissionCount >= 0,
    state.successorAdmissionCount <= 1,
    (if (state.successorPositionHeld) 1 else 0) <= TASK_WORK_CAPACITY,
    not(state.successorPositionHeld) or state.successorAdmissionCount == 1,
    state.successorExecutorStartCount == 0 or and {
      state.replacementEventRecorded,
      state.successorWorktreeReady,
      state.successorAdmissionCount == 1,
      state.successorPositionHeld,
      state.successorExecutorResponsibilityRetained,
      state.replacementPhase == SuccessorRunning,
    },
    state.successorExecutorStartCount <= 1,
  }

  val p1AndP2ExecutorResponsibilitiesNeverOverlap: bool =
    state.successorExecutorResponsibilityRetained implies
      not(state.implementationResponsibilityRetained)

  val crashKeepsEitherNoP2OrTheSameP2: bool = and {
    state.lastAction != ReplacementAppendAbsentAfterCrashAction or and {
      state.p1Unsettled,
      not(state.p1Superseded),
      state.plannedSuccessor == NoPlannedSuccessor,
      not(state.replacementEventRecorded),
      state.successorAllocationCount == 0,
    },
    state.lastAction != ReplacementAppendPresentAfterCrashAction or and {
      not(state.p1Unsettled),
      state.p1Superseded,
      state.plannedSuccessor == PlannedP2,
      state.replacementEventRecorded,
      state.successorAllocationCount == 1,
    },
  }

  val replacementTerminalOutcomesRemainDistinct: bool = and {
    state.lastAction != RestartCompletedObservedAction or and {
      state.executorEvidence == ExactCompletedTerminal,
      state.completedResultPreserved,
      not(state.failedResultPreserved),
      not(state.lateAcceptedCommitPreserved),
    },
    state.lastAction != RestartFailedObservedAction or and {
      state.executorEvidence == ExactFailedTerminal,
      state.failedResultPreserved,
      not(state.completedResultPreserved),
      not(state.lateAcceptedCommitPreserved),
    },
    state.lastAction != RestartAcceptedObservedAction or and {
      state.executorEvidence == ExactAcceptedTerminal,
      state.lateAcceptedCommitPreserved,
      state.lateAcceptedEvidencePreserved,
      not(state.completedResultPreserved),
      not(state.failedResultPreserved),
    },
  }

  val nonAuthorizingExecutorEvidenceNeverRecordsReplacement: bool =
    not(Set(
      ExactRunning,
      ExecutorUnavailable,
      ExecutorContradiction,
      ExactCompletedTerminal,
      ExactFailedTerminal,
    ).contains(state.executorEvidence)) or not(state.replacementEventRecorded)

  val lateAcceptedNeverCreatesIntegrationResponsibility: bool =
    not(state.lateAcceptedCommitPreserved) or and {
      state.lateAcceptedEvidencePreserved,
      state.lateAcceptedIntegrationResponsibilityCount == 0,
      not(state.integrationSelected),
    }

  val restartNeverSelectsIntegration: bool =
    state.f2WinningChoice != RestartChoice or and {
      not(state.integrationSelected),
      state.lateAcceptedIntegrationResponsibilityCount == 0,
    }

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
  val restartF2AppliedReached: bool = state.lastAction == RestartF2AppliedAction
  val f2ObservedReached: bool = state.lastAction == F2ObservedAction
  val stopF2AppliedReached: bool = state.lastAction == StopF2AppliedAction
  val exactRedeliveredReached: bool = state.lastAction == ExactRedeliveredAction
  val runMismatchRejectedReached: bool = state.lastAction == RunMismatchRejectedAction
  val contentReuseRejectedReached: bool = state.lastAction == ContentReuseRejectedAction
  val losingChoiceRejectedReached: bool = state.lastAction == LosingChoiceRejectedAction
  val postCutoffContinueRejectedReached: bool = state.lastAction == PostCutoffContinueRejectedAction
  val postCutoffRestartRejectedReached: bool = state.lastAction == PostCutoffRestartRejectedAction
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
  val activeWorkRefreshOfferedReached: bool =
    state.lastAction == ActiveRefreshTrackerNotificationOfferedAction
      or state.lastAction == ActiveRefreshTimerOfferedAction
  val activeRefreshTrackerNotificationOfferedReached: bool =
    state.lastAction == ActiveRefreshTrackerNotificationOfferedAction
  val activeRefreshTimerOfferedReached: bool =
    state.lastAction == ActiveRefreshTimerOfferedAction
  val activeWorkRunningEstablishedReached: bool =
    state.lastAction == ActiveWorkRunningEstablishedAction
  val activeRefreshUnreadableReached: bool =
    state.lastAction == ActiveRefreshUnreadableObservedAction
  val activeRefreshHealthyReached: bool =
    state.lastAction == ActiveRefreshHealthyObservedAction
  val activeRefreshGitFailuresReached: bool =
    state.lastAction == ActiveRefreshGitFailuresObservedAction
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

  // Every enterable issue-66 replacement phase has a gated reachability
  // witness. The reason-specific collected tests below prevent the shared
  // waiting and rejection phases from hiding dead boundary branches.
  val replacementNotRequestedReached: bool = state.replacementPhase == ReplacementNotRequested
  val restartAppliedReached: bool = state.replacementPhase == RestartApplied
  val replacementQuiescenceRequiredReached: bool =
    state.replacementPhase == NeedCurrentExecutorQuiescence
  val replacementTaskFactsRequiredReached: bool =
    state.replacementPhase == NeedCurrentReplacementTaskFacts
  val replacementClaimRequiredReached: bool =
    state.replacementPhase == NeedCurrentReplacementClaim
  val replacementClaimReadLimitReached: bool =
    state.replacementClaimReadsThisActivation == REPLACEMENT_CLAIM_READ_LIMIT
  val replacementClaimReadActivationRecoveredReached: bool =
    state.lastAction == ReplacementClaimReadActivationRecoveredAction
  val oldWorktreeFactsRequiredReached: bool =
    state.replacementPhase == NeedCurrentOldWorktree
  val replacementTargetHeadRequiredReached: bool =
    state.replacementPhase == NeedCurrentTargetHead
  val replacementAppendReadyReached: bool =
    state.replacementPhase == ReplacementReadyToAppend
  val plannedAttemptReplacementRecordedReached: bool =
    state.replacementPhase == PlannedAttemptReplacementRecorded
  val successorWaitingAdmissionReached: bool =
    state.replacementPhase == SuccessorWaitingForAdmission
  val successorAdmittedReached: bool = state.replacementPhase == SuccessorAdmitted
  val successorRunningReached: bool = state.replacementPhase == SuccessorRunning
  val replacementWaitingReached: bool = state.replacementPhase == ReplacementWaiting
  val replacementRejectedReached: bool = state.replacementPhase == ReplacementRejected
  val lateAcceptedReplacementEvidenceReached: bool =
    state.executorEvidence == ExactAcceptedTerminal and state.lateAcceptedCommitPreserved
  val completedReplacementEvidenceReached: bool =
    state.executorEvidence == ExactCompletedTerminal and state.completedResultPreserved
  val failedReplacementEvidenceReached: bool =
    state.executorEvidence == ExactFailedTerminal and state.failedResultPreserved

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
      suspensionCommandCountSinceSafeEvidence: 0,
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
      claimReleaseCallCountAtRestart: 0,
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
      authorityReadPurpose: OrdinaryContinuationRead,
      refreshSource: NoRefreshSource,
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
      replacementPhase: ReplacementNotRequested,
      replacementDisposition: NoReplacementDisposition,
      replacementTaskFacts: ReplacementTaskFactsNotRead,
      replacementClaimFacts: ReplacementClaimNotRead,
      replacementClaimReadsThisActivation: 0,
      oldWorktreeFacts: OldWorktreeNotRead,
      replacementTargetHeadFacts: ReplacementTargetHeadNotRead,
      observedOldWorktreeHead: NoGitCommit,
      oldBaseB1IsAncestor: false,
      observedReplacementTargetHead: NoGitCommit,
      p1Unsettled: true,
      p1Superseded: false,
      plannedSuccessor: NoPlannedSuccessor,
      replacementEventRecorded: false,
      replacementEventCount: 0,
      successorAllocationCount: 0,
      successorBaseHead: NoGitCommit,
      successorBranchIdentity: NoBranch,
      successorWorktreeIdentity: NoWorktree,
      successorCarriesP1Content: false,
      successorWorktreeReady: false,
      successorAdmissionCount: 0,
      successorPositionHeld: false,
      successorExecutorStartCount: 0,
      successorExecutorResponsibilityRetained: false,
      replacementProcessLossCount: 0,
      completedResultPreserved: false,
      failedResultPreserved: false,
      lateAcceptedCommitPreserved: false,
      lateAcceptedEvidencePreserved: false,
      lateAcceptedIntegrationResponsibilityCount: 0,
      p1BranchPreserved: true,
      p1CommitsPreserved: true,
      p1JournalEvidencePreserved: true,
      replacementCleanupCallCount: 0,
      replacementClaimMutationCallCount: 0,
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

  action applyRestartF2: bool = all {
    state.phase == PreIntegration,
    state.f2WinningChoice == NoChoice,
    state.currentFingerprint == F2,
    state.executorEvidence == ExactSafelySuspended,
    state.quiescenceUnbroken,
    RESTART_D1.runId == SUBJECT_F2.runId,
    state' = {
      ...state,
      f2WinningChoice: RestartChoice,
      firstF2Choice: RestartChoice,
      winningRequestId: RESTART_D1,
      winningSubject: SUBJECT_F2,
      appliedChoiceCount: 1,
      lastControlResult: ChoiceApplied,
      authorizedFingerprint: F2,
      constraint: NoConstraint,
      factDecision: ContinueWork,
      replacementPhase: RestartApplied,
      claimReleaseCallCountAtRestart: state.claimReleaseCallCount,
      replacementDisposition: NoReplacementDisposition,
      replacementTaskFacts: ReplacementTaskFactsNotRead,
      replacementClaimFacts: ReplacementClaimNotRead,
      replacementClaimReadsThisActivation: 0,
      oldWorktreeFacts: OldWorktreeNotRead,
      replacementTargetHeadFacts: ReplacementTargetHeadNotRead,
      observedOldWorktreeHead: NoGitCommit,
      oldBaseB1IsAncestor: false,
      observedReplacementTargetHead: NoGitCommit,
      lastAction: RestartF2AppliedAction,
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

  action rejectRestartPastIntegrationCutoff: bool = all {
    state.phase == IntegrationStarted,
    state.currentFingerprint == F2,
    state.f2WinningChoice == NoChoice,
    state.lastControlResult != ChoiceOutsidePreIntegration,
    state' = {
      ...state,
      lastControlResult: ChoiceOutsidePreIntegration,
      replacementPhase: ReplacementRejected,
      replacementDisposition: PastIntegrationCutoff,
      lastAction: PostCutoffRestartRejectedAction,
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

  // The already applied Restart choice begins its read-only authorization
  // sequence directly when the exact safe-suspension proof remains unbroken.
  action beginReplacementFactsFromRetainedSafeSuspension: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == RestartApplied,
    state.executorEvidence == ExactSafelySuspended,
    state.quiescenceUnbroken,
    state' = {
      ...state,
      replacementPhase: NeedCurrentReplacementTaskFacts,
      replacementDisposition: NoReplacementDisposition,
      lastAction: RestartFactsBeganAction,
    },
  }

  // A later StartOrContinue command breaks the retained proof. Every task/Git
  // observation made before this new writer fact is cleared so a later exact
  // Accepted or safely-suspended report is followed by fresh reads.
  action breakRestartSafeSuspension: bool = all {
    state.f2WinningChoice == RestartChoice,
    replacementPendingBeforeAppend(state),
    not(state.replacementEventRecorded),
    state.implementationResponsibilityRetained,
    state' = {
      ...state,
      replacementPhase: NeedCurrentExecutorQuiescence,
      replacementDisposition: NoReplacementDisposition,
      executorEvidence: ExactRunning,
      quiescenceUnbroken: false,
      positionHeld: true,
      nextStopCommandOrdinal: state.nextStopCommandOrdinal + 1,
      replacementTaskFacts: ReplacementTaskFactsNotRead,
      replacementClaimFacts: ReplacementClaimNotRead,
      replacementClaimReadsThisActivation: 0,
      oldWorktreeFacts: OldWorktreeNotRead,
      replacementTargetHeadFacts: ReplacementTargetHeadNotRead,
      observedOldWorktreeHead: NoGitCommit,
      oldBaseB1IsAncestor: false,
      observedReplacementTargetHead: NoGitCommit,
      lastAction: RestartQuiescenceBrokenAction,
    },
  }

  action observeRestartRunning: bool = all {
    state.f2WinningChoice == RestartChoice,
    Set(NeedCurrentExecutorQuiescence, ReplacementWaiting).contains(state.replacementPhase),
    state.implementationResponsibilityRetained,
    state' = {
      ...state,
      executorEvidence: ExactRunning,
      quiescenceUnbroken: false,
      positionHeld: true,
      lastSettledStopCommandOrdinal:
        if (state.suspensionCommandCountSinceSafeEvidence < STOP_COMMAND_LIMIT)
          state.nextStopCommandOrdinal
        else state.lastSettledStopCommandOrdinal,
      nextStopCommandOrdinal:
        state.nextStopCommandOrdinal
          + (if (state.suspensionCommandCountSinceSafeEvidence < STOP_COMMAND_LIMIT) 1 else 0),
      stopCommandIntentCount:
        state.stopCommandIntentCount
          + (if (state.suspensionCommandCountSinceSafeEvidence < STOP_COMMAND_LIMIT) 1 else 0),
      stopCommandCallCount:
        state.stopCommandCallCount
          + (if (state.suspensionCommandCountSinceSafeEvidence < STOP_COMMAND_LIMIT) 1 else 0),
      stopCommandSettlementCount:
        state.stopCommandSettlementCount
          + (if (state.suspensionCommandCountSinceSafeEvidence < STOP_COMMAND_LIMIT) 1 else 0),
      suspensionCommandCountSinceSafeEvidence:
        state.suspensionCommandCountSinceSafeEvidence
          + (if (state.suspensionCommandCountSinceSafeEvidence < STOP_COMMAND_LIMIT) 1 else 0),
      replacementPhase: ReplacementWaiting,
      replacementDisposition: RunningWriterWait,
      lastAction: RestartRunningObservedAction,
    },
  }

  action observeRestartExecutorUnavailable: bool = all {
    state.f2WinningChoice == RestartChoice,
    Set(NeedCurrentExecutorQuiescence, ReplacementWaiting).contains(state.replacementPhase),
    state.implementationResponsibilityRetained,
    state' = {
      ...state,
      executorEvidence: ExecutorUnavailable,
      quiescenceUnbroken: false,
      replacementPhase: ReplacementWaiting,
      replacementDisposition: ExecutorUnreadableWait,
      lastAction: RestartExecutorUnavailableObservedAction,
    },
  }

  action observeRestartExecutorContradiction: bool = all {
    state.f2WinningChoice == RestartChoice,
    Set(NeedCurrentExecutorQuiescence, ReplacementWaiting).contains(state.replacementPhase),
    state.implementationResponsibilityRetained,
    state' = {
      ...state,
      executorEvidence: ExecutorContradiction,
      quiescenceUnbroken: false,
      replacementPhase: ReplacementWaiting,
      replacementDisposition: ExecutorCorrelationContradiction,
      lastAction: RestartExecutorContradictionObservedAction,
    },
  }

  action observeRestartSafelySuspended: bool = all {
    state.f2WinningChoice == RestartChoice,
    Set(NeedCurrentExecutorQuiescence, ReplacementWaiting).contains(state.replacementPhase),
    not(state.replacementEventRecorded),
    state.implementationResponsibilityRetained,
    state' = {
      ...state,
      executorEvidence: ExactSafelySuspended,
      quiescenceUnbroken: true,
      positionHeld: false,
      lastSettledStopCommandOrdinal:
        if (state.suspensionCommandCountSinceSafeEvidence < STOP_COMMAND_LIMIT)
          state.nextStopCommandOrdinal
        else state.lastSettledStopCommandOrdinal,
      nextStopCommandOrdinal:
        state.nextStopCommandOrdinal
          + (if (state.suspensionCommandCountSinceSafeEvidence < STOP_COMMAND_LIMIT) 1 else 0),
      stopCommandIntentCount:
        state.stopCommandIntentCount
          + (if (state.suspensionCommandCountSinceSafeEvidence < STOP_COMMAND_LIMIT) 1 else 0),
      stopCommandCallCount:
        state.stopCommandCallCount
          + (if (state.suspensionCommandCountSinceSafeEvidence < STOP_COMMAND_LIMIT) 1 else 0),
      stopCommandSettlementCount:
        state.stopCommandSettlementCount
          + (if (state.suspensionCommandCountSinceSafeEvidence < STOP_COMMAND_LIMIT) 1 else 0),
      suspensionCommandCountSinceSafeEvidence: 0,
      replacementPhase: NeedCurrentReplacementTaskFacts,
      replacementDisposition: NoReplacementDisposition,
      replacementTaskFacts: ReplacementTaskFactsNotRead,
      replacementClaimFacts: ReplacementClaimNotRead,
      replacementClaimReadsThisActivation: 0,
      oldWorktreeFacts: OldWorktreeNotRead,
      replacementTargetHeadFacts: ReplacementTargetHeadNotRead,
      observedOldWorktreeHead: NoGitCommit,
      oldBaseB1IsAncestor: false,
      observedReplacementTargetHead: NoGitCommit,
      lastAction: RestartSafeObservedAction,
    },
  }

  action observeRestartAccepted: bool = all {
    state.f2WinningChoice == RestartChoice,
    Set(NeedCurrentExecutorQuiescence, ReplacementWaiting).contains(state.replacementPhase),
    not(state.replacementEventRecorded),
    state.implementationResponsibilityRetained,
    not(state.completedResultPreserved),
    not(state.failedResultPreserved),
    state' = {
      ...state,
      executorEvidence: ExactAcceptedTerminal,
      quiescenceUnbroken: true,
      implementationResponsibilityRetained: false,
      positionHeld: false,
      nextStopCommandOrdinal: state.nextStopCommandOrdinal + 1,
      lateAcceptedCommitPreserved: true,
      lateAcceptedEvidencePreserved: true,
      lateAcceptedIntegrationResponsibilityCount: 0,
      integrationSelected: false,
      replacementPhase: NeedCurrentReplacementTaskFacts,
      replacementDisposition: NoReplacementDisposition,
      replacementTaskFacts: ReplacementTaskFactsNotRead,
      replacementClaimFacts: ReplacementClaimNotRead,
      replacementClaimReadsThisActivation: 0,
      oldWorktreeFacts: OldWorktreeNotRead,
      replacementTargetHeadFacts: ReplacementTargetHeadNotRead,
      observedOldWorktreeHead: NoGitCommit,
      oldBaseB1IsAncestor: false,
      observedReplacementTargetHead: NoGitCommit,
      lastAction: RestartAcceptedObservedAction,
    },
  }

  action observeRestartCompleted: bool = all {
    state.f2WinningChoice == RestartChoice,
    Set(NeedCurrentExecutorQuiescence, ReplacementWaiting).contains(state.replacementPhase),
    not(state.replacementEventRecorded),
    state.implementationResponsibilityRetained,
    not(state.lateAcceptedCommitPreserved),
    not(state.failedResultPreserved),
    state' = {
      ...state,
      executorEvidence: ExactCompletedTerminal,
      quiescenceUnbroken: true,
      implementationResponsibilityRetained: false,
      positionHeld: false,
      nextStopCommandOrdinal: state.nextStopCommandOrdinal + 1,
      completedResultPreserved: true,
      replacementPhase: ReplacementRejected,
      replacementDisposition: CompletedDoesNotAuthorizeReplacement,
      lastAction: RestartCompletedObservedAction,
    },
  }

  action observeRestartFailed: bool = all {
    state.f2WinningChoice == RestartChoice,
    Set(NeedCurrentExecutorQuiescence, ReplacementWaiting).contains(state.replacementPhase),
    not(state.replacementEventRecorded),
    state.implementationResponsibilityRetained,
    not(state.lateAcceptedCommitPreserved),
    not(state.completedResultPreserved),
    state' = {
      ...state,
      executorEvidence: ExactFailedTerminal,
      quiescenceUnbroken: true,
      implementationResponsibilityRetained: false,
      positionHeld: false,
      nextStopCommandOrdinal: state.nextStopCommandOrdinal + 1,
      failedResultPreserved: true,
      replacementPhase: ReplacementRejected,
      replacementDisposition: FailedDoesNotAuthorizeReplacement,
      lastAction: RestartFailedObservedAction,
    },
  }

  action observeReplacementExactF2TaskFacts: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == NeedCurrentReplacementTaskFacts,
    state.currentFingerprint == F2,
    replacementQuiescence(state),
    state' = {
      ...state,
      replacementTaskFacts: ExactF2OpenInClosureUnblocked,
      replacementClaimReadsThisActivation: 0,
      replacementPhase: NeedCurrentReplacementClaim,
      lastAction: ReplacementF2FactsObservedAction,
    },
  }

  action observeReplacementF3TaskFacts: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == NeedCurrentReplacementTaskFacts,
    state' = {
      ...state,
      currentFingerprint: F3,
      replacementTaskFacts: ReplacementF3Observed,
      replacementPhase: ReplacementRejected,
      replacementDisposition: NewFingerprintChoiceRequired,
      continueStage: NewChoiceRequired,
      constraint: SpecificationConstraint,
      factDecision: SpecificationChoices,
      lastAction: ReplacementF3FactsObservedAction,
    },
  }

  action observeReplacementTaskFactsUnreadable: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == NeedCurrentReplacementTaskFacts,
    state' = {
      ...state,
      replacementTaskFacts: ReplacementTaskFactsUnreadable,
      replacementPhase: ReplacementWaiting,
      replacementDisposition: TaskFactsUnreadableWait,
      lastAction: ReplacementTaskFactsUnreadableAction,
    },
  }

  action observeReplacementTaskNotEligible: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == NeedCurrentReplacementTaskFacts,
    state' = {
      ...state,
      replacementTaskFacts: ReplacementTaskNotEligible,
      replacementPhase: ReplacementWaiting,
      replacementDisposition: TaskNotEligibleWait,
      lastAction: ReplacementTaskNotEligibleAction,
    },
  }

  action observeReplacementExactK1: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == NeedCurrentReplacementClaim,
    state' = {
      ...state,
      replacementClaimFacts: ExactK1Observed,
      replacementClaimReadsThisActivation: state.replacementClaimReadsThisActivation + 1,
      claimState: ExactClaim,
      exactClaimHeld: true,
      currentClaimIdentity: state.originalClaimIdentity,
      replacementPhase: NeedCurrentOldWorktree,
      lastAction: ReplacementK1ObservedAction,
    },
  }

  action observeReplacementClaimAbsent: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == NeedCurrentReplacementClaim,
    state' = {
      ...state,
      replacementClaimFacts: ReplacementClaimAbsent,
      replacementClaimReadsThisActivation: state.replacementClaimReadsThisActivation + 1,
      claimState: MissingClaim,
      exactClaimHeld: false,
      replacementPhase: ReplacementWaiting,
      replacementDisposition: ClaimAbsentWait,
      lastAction: ReplacementClaimAbsentAction,
    },
  }

  action observeReplacementClaimForeign: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == NeedCurrentReplacementClaim,
    state' = {
      ...state,
      replacementClaimFacts: ReplacementClaimForeign,
      replacementClaimReadsThisActivation: state.replacementClaimReadsThisActivation + 1,
      claimState: ForeignClaim,
      exactClaimHeld: false,
      replacementPhase: ReplacementWaiting,
      replacementDisposition: ClaimForeignWait,
      lastAction: ReplacementClaimForeignAction,
    },
  }

  action observeReplacementClaimUnreadable: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == NeedCurrentReplacementClaim,
    state.replacementClaimReadsThisActivation < REPLACEMENT_CLAIM_READ_LIMIT,
    state' = {
      ...state,
      replacementClaimFacts: ReplacementClaimUnreadable,
      replacementClaimReadsThisActivation: state.replacementClaimReadsThisActivation + 1,
      claimState: UnreadableClaim,
      replacementPhase:
        if (state.replacementClaimReadsThisActivation + 1 == REPLACEMENT_CLAIM_READ_LIMIT)
          ReplacementWaiting
        else
          NeedCurrentReplacementClaim,
      replacementDisposition: ClaimUnreadableWait,
      lastAction: ReplacementClaimUnreadableAction,
    },
  }

  // The production interpreter owns the three raw tracker reads and returns
  // one exhausted observation to the Restart protocol. This action exposes
  // that composed boundary at the production-backed MBT's granularity while
  // the lower-level action above retains crash-between-read exploration.
  action observeReplacementClaimUnreadableBounded: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == NeedCurrentReplacementClaim,
    state.replacementClaimReadsThisActivation == 0,
    state' = {
      ...state,
      replacementClaimFacts: ReplacementClaimUnreadable,
      replacementClaimReadsThisActivation: REPLACEMENT_CLAIM_READ_LIMIT,
      claimState: UnreadableClaim,
      replacementPhase: ReplacementWaiting,
      replacementDisposition: ClaimUnreadableWait,
      lastAction: ReplacementClaimUnreadableAction,
    },
  }

  // A coordinator loss discards only the per-activation read budget. It does
  // not convert an unreadable observation into proof that K1 exists or is
  // absent, and it crosses no tracker mutation boundary.
  action recoverReplacementClaimReadActivation: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == NeedCurrentReplacementClaim,
    state.replacementClaimReadsThisActivation > 0,
    state.replacementClaimReadsThisActivation < REPLACEMENT_CLAIM_READ_LIMIT,
    state' = {
      ...state,
      replacementClaimFacts: ReplacementClaimNotRead,
      replacementClaimReadsThisActivation: 0,
      replacementProcessLossCount: state.replacementProcessLossCount + 1,
      lastAction: ReplacementClaimReadActivationRecoveredAction,
    },
  }

  action observeReplacementExactW1Ready: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == NeedCurrentOldWorktree,
    state' = {
      ...state,
      oldWorktreeFacts: ExactW1Ready,
      observedOldWorktreeHead: CURRENT_W1_HEAD_H1,
      oldBaseB1IsAncestor: true,
      replacementPhase: NeedCurrentTargetHead,
      lastAction: ReplacementW1ReadyAction,
    },
  }

  action observeReplacementW1NotReady: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == NeedCurrentOldWorktree,
    state' = {
      ...state,
      oldWorktreeFacts: OldWorktreeNotReady,
      replacementPhase: ReplacementWaiting,
      replacementDisposition: OldWorktreeNotReadyWait,
      lastAction: ReplacementW1NotReadyAction,
    },
  }

  action observeReplacementW1Unreadable: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == NeedCurrentOldWorktree,
    state' = {
      ...state,
      oldWorktreeFacts: OldWorktreeUnreadable,
      replacementPhase: ReplacementWaiting,
      replacementDisposition: OldWorktreeUnreadableWait,
      lastAction: ReplacementW1UnreadableAction,
    },
  }

  action observeReplacementExactH2: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == NeedCurrentTargetHead,
    state' = {
      ...state,
      replacementTargetHeadFacts: ExactH2Observed,
      observedReplacementTargetHead: TARGET_HEAD_H2,
      replacementPhase: ReplacementReadyToAppend,
      lastAction: ReplacementH2ObservedAction,
    },
  }

  action observeReplacementH2Unreadable: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == NeedCurrentTargetHead,
    state' = {
      ...state,
      replacementTargetHeadFacts: ReplacementTargetHeadUnreadable,
      replacementPhase: ReplacementWaiting,
      replacementDisposition: TargetHeadUnreadableWait,
      lastAction: ReplacementH2UnreadableAction,
    },
  }

  // The absent crash prefix discards only process-local observations. No
  // successor identity was durable, so retry must reread every authority and
  // may still allocate only P2 in the later atomic append.
  action recoverReplacementAppendAbsent: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == ReplacementReadyToAppend,
    not(state.replacementEventRecorded),
    state' = {
      ...state,
      replacementPhase: NeedCurrentReplacementTaskFacts,
      replacementTaskFacts: ReplacementTaskFactsNotRead,
      replacementClaimFacts: ReplacementClaimNotRead,
      replacementClaimReadsThisActivation: 0,
      oldWorktreeFacts: OldWorktreeNotRead,
      replacementTargetHeadFacts: ReplacementTargetHeadNotRead,
      observedOldWorktreeHead: NoGitCommit,
      oldBaseB1IsAncestor: false,
      observedReplacementTargetHead: NoGitCommit,
      replacementProcessLossCount: state.replacementProcessLossCount + 1,
      lastAction: ReplacementAppendAbsentAfterCrashAction,
    },
  }

  // One state transition is the one Journal append: P1 becomes superseded and
  // immutable P2 appears together. No W2 or executor fact is claimed here.
  action recordPlannedAttemptReplacement: bool = all {
    state.phase == PreIntegration,
    state.f2WinningChoice == RestartChoice,
    state.firstF2Choice == RestartChoice,
    state.winningRequestId.runId == RUN_R,
    state.winningRequestId.nonce == RESTART_D1.nonce,
    state.winningSubject.runId == SUBJECT_F2.runId,
    state.winningSubject.taskId == SUBJECT_F2.taskId,
    state.winningSubject.attemptId == SUBJECT_F2.attemptId,
    state.winningSubject.plannedFingerprint == F1,
    state.winningSubject.observedFingerprint == F2,
    state.replacementPhase == ReplacementReadyToAppend,
    state.currentFingerprint == F2,
    state.quiescenceUnbroken,
    state.executorEvidence == ExactSafelySuspended
      or state.executorEvidence == ExactAcceptedTerminal,
    state.replacementTaskFacts == ExactF2OpenInClosureUnblocked,
    state.replacementClaimFacts == ExactK1Observed,
    state.oldWorktreeFacts == ExactW1Ready,
    state.observedOldWorktreeHead == CURRENT_W1_HEAD_H1,
    state.oldBaseB1IsAncestor,
    state.replacementTargetHeadFacts == ExactH2Observed,
    state.observedReplacementTargetHead == TARGET_HEAD_H2,
    state.p1Unsettled,
    not(state.p1Superseded),
    state.plannedSuccessor == NoPlannedSuccessor,
    not(state.replacementEventRecorded),
    state' = {
      ...state,
      p1Unsettled: false,
      p1Superseded: true,
      plannedSuccessor: PlannedP2,
      replacementEventRecorded: true,
      replacementEventCount: 1,
      successorAllocationCount: 1,
      successorBaseHead: TARGET_HEAD_H2,
      successorBranchIdentity: BRANCH_P2,
      successorWorktreeIdentity: WORKTREE_W2,
      successorCarriesP1Content: false,
      implementationResponsibilityRetained: false,
      positionHeld: false,
      replacementPhase: PlannedAttemptReplacementRecorded,
      replacementDisposition: NoReplacementDisposition,
      lastAction: PlannedAttemptReplacementRecordedAction,
    },
  }

  // The present crash prefix reconstructs exact P2 from the one event. It
  // cannot allocate P3 merely because no P2 executor report exists yet.
  action recoverReplacementAppendPresent: bool = all {
    state.replacementPhase == PlannedAttemptReplacementRecorded,
    state.replacementEventRecorded,
    state.plannedSuccessor == PlannedP2,
    state' = {
      ...state,
      replacementProcessLossCount: state.replacementProcessLossCount + 1,
      lastAction: ReplacementAppendPresentAfterCrashAction,
    },
  }

  action prepareCleanSuccessorW2: bool = all {
    state.replacementPhase == PlannedAttemptReplacementRecorded,
    state.replacementEventRecorded,
    state.plannedSuccessor == PlannedP2,
    state.successorWorktreeIdentity == WORKTREE_W2,
    state.successorWorktreeIdentity != WORKTREE_W1,
    state.successorBaseHead == TARGET_HEAD_H2,
    not(state.successorCarriesP1Content),
    not(state.successorWorktreeReady),
    state' = {
      ...state,
      successorWorktreeReady: true,
      replacementPhase: SuccessorWaitingForAdmission,
      lastAction: SuccessorW2ReadyAction,
    },
  }

  action admitSuccessorThroughOrdinaryCapacity: bool = all {
    state.replacementPhase == SuccessorWaitingForAdmission,
    state.successorWorktreeReady,
    state.successorAdmissionCount == 0,
    not(state.successorPositionHeld),
    state.successorAdmissionCount < TASK_WORK_CAPACITY,
    state' = {
      ...state,
      successorAdmissionCount: 1,
      successorPositionHeld: true,
      replacementPhase: SuccessorAdmitted,
      lastAction: SuccessorOrdinarilyAdmittedAction,
    },
  }

  action startSuccessorExecutor: bool = all {
    state.replacementPhase == SuccessorAdmitted,
    state.replacementEventRecorded,
    state.plannedSuccessor == PlannedP2,
    state.successorWorktreeReady,
    state.successorAdmissionCount == 1,
    state.successorPositionHeld,
    state.successorExecutorStartCount == 0,
    not(state.successorExecutorResponsibilityRetained),
    state' = {
      ...state,
      successorExecutorStartCount: 1,
      successorExecutorResponsibilityRetained: true,
      replacementPhase: SuccessorRunning,
      lastAction: SuccessorExecutorStartedAction,
    },
  }

  // A later exact Running projection breaks retained proof. Stop now needs its
  // durable stoppage intent and exact command-projection protocol.
  action requireStoppageReconciliation: bool = all {
    state.f2WinningChoice == StopChoice or state.f3WinningChoice == StopChoice,
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
    state.f2WinningChoice == StopChoice or state.f3WinningChoice == StopChoice,
    state.stopStage == NeedQuiescence,
    not(exactQuiescence(state)),
    not(stopCommandActive(state)),
    state.suspensionCommandCountSinceSafeEvidence < STOP_COMMAND_LIMIT,
    state' = {
      ...state,
      activeStopCommandOrdinal: state.nextStopCommandOrdinal,
      nextStopCommandOrdinal: state.nextStopCommandOrdinal + 1,
      stopCommandIntentCount: state.stopCommandIntentCount + 1,
      suspensionCommandCountSinceSafeEvidence: state.suspensionCommandCountSinceSafeEvidence + 1,
      lastAction: StoppageIntentRecordedAction,
    },
  }

  action callStoppage: bool = all {
    state.f2WinningChoice == StopChoice or state.f3WinningChoice == StopChoice,
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
    state.f2WinningChoice == StopChoice or state.f3WinningChoice == StopChoice,
    state.stopCommandCalled,
    not(state.stopResponseAmbiguous),
    state' = { ...state, stopResponseAmbiguous: true, lastAction: StoppageResponseLostAction },
  }

  action projectExactRunningForStoppage: bool = all {
    state.f2WinningChoice == StopChoice or state.f3WinningChoice == StopChoice,
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
    state.f2WinningChoice == StopChoice or state.f3WinningChoice == StopChoice,
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
      suspensionCommandCountSinceSafeEvidence: 0,
      stopCommandCalled: false,
      stopResponseAmbiguous: false,
      stopProjectionsThisActivation: 1,
      positionHeld: false,
      lastAction: StoppageSafeProjectedAction,
    },
  }

  action projectExactTerminalForStoppage: bool = all {
    state.f2WinningChoice == StopChoice or state.f3WinningChoice == StopChoice,
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
    state.f2WinningChoice == StopChoice or state.f3WinningChoice == StopChoice,
    state.stopStage == NeedQuiescence,
    if (stopCommandActive(state) and state.stopCommandCalled and state.stopResponseAmbiguous)
      state.stopProjectionsThisActivation <= 1
    else
      not(stopCommandActive(state)) and state.stopProjectionsThisActivation == 1,
    state.stopRecoveryCount < RECOVERY_LIMIT
      or and {
        state.suspensionCommandCountSinceSafeEvidence == STOP_COMMAND_LIMIT,
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
    state.f2WinningChoice == StopChoice or state.f3WinningChoice == StopChoice,
    state.stopStage == NeedQuiescence,
    state.suspensionCommandCountSinceSafeEvidence == STOP_COMMAND_LIMIT,
    not(stopCommandActive(state)),
    not(state.stopCommandCalled),
    state.stopProjectionsThisActivation == 0,
    state.executorEvidence == ExactRunning,
    state' = {
      ...state,
      executorEvidence: ExactSafelySuspended,
      suspensionCommandCountSinceSafeEvidence: 0,
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
      or state.f2WinningChoice == RestartChoice
      or state.constraint == MissingClaimConstraint
      or state.constraint == ForeignClaimConstraint
      or state.constraint == UnreadableClaimConstraint
      or and {
        state.authorityReadPurpose == ActiveWorkRefreshRead,
        state.factDecision == AwaitNextActiveWorkRefresh,
      },
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
    state.authorityReadPurpose == OrdinaryContinuationRead,
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

  // Scenario setup establishes the already-Running attempt before the
  // TrackerNotification or Timer trigger. The setup command is not caused by
  // the later refresh opportunity.
  action establishRunningAttemptForActiveRefresh: bool = all {
    state.phase == PreIntegration,
    state.f2WinningChoice == NoChoice,
    state.factDecision == ContinueWork,
    state.constraint == NoConstraint,
    state.executorEvidence == ExactSafelySuspended,
    state' = {
      ...state,
      authorityReadPurpose: OrdinaryContinuationRead,
      refreshSource: NoRefreshSource,
      executorEvidence: ExactRunning,
      quiescenceUnbroken: false,
      positionHeld: true,
      lastAction: ActiveWorkRunningEstablishedAction,
    },
  }

  // A tracker notification refreshes work already proven Running and does not
  // authorize another executor command.
  action offerActiveWorkAuthorityRefreshFromTrackerNotification: bool = all {
    state.phase == PreIntegration,
    state.f2WinningChoice == NoChoice,
    state.factDecision == ContinueWork or state.factDecision == AwaitNextActiveWorkRefresh,
    state.constraint == NoConstraint,
    state.executorEvidence == ExactRunning,
    state' = {
      ...state,
      authorityReadPurpose: ActiveWorkRefreshRead,
      refreshSource: TrackerNotification,
      factDecision: ContinueWork,
      executorEvidence: ExactRunning,
      quiescenceUnbroken: false,
      positionHeld: true,
      lastAction: ActiveRefreshTrackerNotificationOfferedAction,
    },
  }

  // A configured timer is a distinct active-refresh source with the same
  // authority and no-action guarantees as a tracker notification.
  action offerActiveWorkAuthorityRefreshFromTimer: bool = all {
    state.phase == PreIntegration,
    state.f2WinningChoice == NoChoice,
    state.factDecision == ContinueWork or state.factDecision == AwaitNextActiveWorkRefresh,
    state.constraint == NoConstraint,
    state.executorEvidence == ExactRunning,
    state' = {
      ...state,
      authorityReadPurpose: ActiveWorkRefreshRead,
      refreshSource: Timer,
      factDecision: ContinueWork,
      executorEvidence: ExactRunning,
      quiescenceUnbroken: false,
      positionHeld: true,
      lastAction: ActiveRefreshTimerOfferedAction,
    },
  }

  action observeHealthyActiveWorkRefresh: bool = all {
    state.lastAction == ActiveRefreshTrackerNotificationOfferedAction
      or state.lastAction == ActiveRefreshTimerOfferedAction,
    state.authorityReadPurpose == ActiveWorkRefreshRead,
    state.refreshSource == TrackerNotification or state.refreshSource == Timer,
    state.factDecision == ContinueWork,
    state.constraint == NoConstraint,
    state' = {
      ...state,
      factDecision: AwaitNextActiveWorkRefresh,
      claimState: ExactClaim,
      exactClaimHeld: true,
      lastAction: ActiveRefreshHealthyObservedAction,
    },
  }

  action observeUnreadableClaimDuringActiveRefresh: bool = all {
    state.lastAction == ActiveRefreshTrackerNotificationOfferedAction
      or state.lastAction == ActiveRefreshTimerOfferedAction,
    state.authorityReadPurpose == ActiveWorkRefreshRead,
    state.refreshSource == TrackerNotification or state.refreshSource == Timer,
    state.factDecision == ContinueWork,
    state.constraint == NoConstraint,
    state' = {
      ...state,
      factDecision: AwaitNextActiveWorkRefresh,
      claimState: UnreadableClaim,
      lastAction: ActiveRefreshUnreadableObservedAction,
    },
  }

  // The executable conformance driver performs both Git authority reads,
  // replays each exact operation, and then opens a fresh opportunity. The
  // model records their shared no-command outcome while the driver witnesses
  // typed events, identity reuse, and the next durable ordinal.
  action observeActiveRefreshGitFailures: bool = all {
    state.lastAction == ActiveRefreshTrackerNotificationOfferedAction
      or state.lastAction == ActiveRefreshTimerOfferedAction,
    state.authorityReadPurpose == ActiveWorkRefreshRead,
    state.refreshSource == TrackerNotification or state.refreshSource == Timer,
    state.factDecision == ContinueWork,
    state.constraint == NoConstraint,
    state' = {
      ...state,
      factDecision: AwaitNextActiveWorkRefresh,
      claimState: ExactClaim,
      exactClaimHeld: true,
      lastAction: ActiveRefreshGitFailuresObservedAction,
    },
  }

  action reportSafelySuspended: bool = all {
    state.factDecision == RequestSafeSuspension,
    state' = {
      ...state,
      executorEvidence: ExactSafelySuspended,
      quiescenceUnbroken: true,
      suspensionCommandCountSinceSafeEvidence: 0,
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
    state.f2WinningChoice != RestartChoice,
    state' = {
      ...state,
      lastClaimMutationTarget: OwnedClaimMutation,
      lastAction: OwnedClaimMutationRequestedAction,
    },
  }

  action step: bool = any {
    observeF2Change,
    applyContinueF2,
    applyRestartF2,
    applyStopF2,
    redeliverExactF2Choice,
    rejectRunMismatchedRequest,
    rejectPersistedRequestContentReuse,
    rejectLosingF2Choice,
    observeExactTerminal,
    beginIntegration,
    rejectContinuePastIntegrationCutoff,
    rejectRestartPastIntegrationCutoff,
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
    beginReplacementFactsFromRetainedSafeSuspension,
    breakRestartSafeSuspension,
    observeRestartRunning,
    observeRestartExecutorUnavailable,
    observeRestartExecutorContradiction,
    observeRestartSafelySuspended,
    observeRestartAccepted,
    observeRestartCompleted,
    observeRestartFailed,
    observeReplacementExactF2TaskFacts,
    observeReplacementF3TaskFacts,
    observeReplacementTaskFactsUnreadable,
    observeReplacementTaskNotEligible,
    observeReplacementExactK1,
    observeReplacementClaimAbsent,
    observeReplacementClaimForeign,
    observeReplacementClaimUnreadable,
    observeReplacementClaimUnreadableBounded,
    recoverReplacementClaimReadActivation,
    observeReplacementExactW1Ready,
    observeReplacementW1NotReady,
    observeReplacementW1Unreadable,
    observeReplacementExactH2,
    observeReplacementH2Unreadable,
    recoverReplacementAppendAbsent,
    recordPlannedAttemptReplacement,
    recoverReplacementAppendPresent,
    prepareCleanSuccessorW2,
    admitSuccessorThroughOrdinaryCapacity,
    startSuccessorExecutor,
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
    establishRunningAttemptForActiveRefresh,
    offerActiveWorkAuthorityRefreshFromTrackerNotification,
    offerActiveWorkAuthorityRefreshFromTimer,
    observeHealthyActiveWorkRefresh,
    observeUnreadableClaimDuringActiveRefresh,
    observeActiveRefreshGitFailures,
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

  // Focused production-backed MBT slice for the active-work refresh chronology.
  action activeRefreshMbtStep: bool = any {
    all { state.lastAction == InitializedAction, establishRunningAttemptForActiveRefresh },
    all {
      state.lastAction == ActiveWorkRunningEstablishedAction
        or state.lastAction == ActiveRefreshHealthyObservedAction
        or state.lastAction == ActiveRefreshUnreadableObservedAction,
      any { offerActiveWorkAuthorityRefreshFromTrackerNotification, offerActiveWorkAuthorityRefreshFromTimer },
    },
    all {
      state.lastAction == ActiveRefreshTrackerNotificationOfferedAction
        or state.lastAction == ActiveRefreshTimerOfferedAction,
      any { observeHealthyActiveWorkRefresh, observeUnreadableClaimDuringActiveRefresh },
    },
    all { state.lastAction == ActiveRefreshUnreadableObservedAction, selectIndependentTaskB },
  }

  // Deterministic source-specific witnesses keep both production owner paths
  // exercised by MBT; the randomized relation above still permits either
  // source on later refresh opportunities.
  action activeRefreshTrackerNotificationMbtStep: bool = any {
    all { state.lastAction == InitializedAction, establishRunningAttemptForActiveRefresh },
    all {
      state.lastAction == ActiveWorkRunningEstablishedAction,
      offerActiveWorkAuthorityRefreshFromTrackerNotification,
    },
    all {
      state.lastAction == ActiveRefreshTrackerNotificationOfferedAction,
      any { observeHealthyActiveWorkRefresh, observeUnreadableClaimDuringActiveRefresh },
    },
    all { state.lastAction == ActiveRefreshUnreadableObservedAction, selectIndependentTaskB },
  }

  action activeRefreshTimerMbtStep: bool = any {
    all { state.lastAction == InitializedAction, establishRunningAttemptForActiveRefresh },
    all {
      state.lastAction == ActiveWorkRunningEstablishedAction,
      offerActiveWorkAuthorityRefreshFromTimer,
    },
    all {
      state.lastAction == ActiveRefreshTimerOfferedAction,
      any { observeHealthyActiveWorkRefresh, observeUnreadableClaimDuringActiveRefresh },
    },
    all { state.lastAction == ActiveRefreshUnreadableObservedAction, selectIndependentTaskB },
  }

  // Production-backed lifecycle slice: an active refresh is closed, the
  // Running executor is safely suspended, a fresh lifecycle reopens, and the
  // next establishment must return to ordinary-read/no-source provenance.
  // This composes the canonical actions without introducing another behavior
  // rule for the lifecycle.
  action activeRefreshLifecycleReestablishmentMbtStep: bool = any {
    all { state.lastAction == InitializedAction, establishRunningAttemptForActiveRefresh },
    all {
      state.lastAction == ActiveWorkRunningEstablishedAction,
      offerActiveWorkAuthorityRefreshFromTimer,
    },
    all {
      state.lastAction == ActiveRefreshTimerOfferedAction,
      observeLifecycleClosure,
    },
    all {
      state.lastAction == LifecycleClosureObservedAction,
      reportSafelySuspended,
    },
    all {
      state.lastAction == TaskFactsSafelySuspendedAction,
      observeFreshLifecycleReopen,
    },
    all {
      state.lastAction == LifecycleReopenedAction,
      establishRunningAttemptForActiveRefresh,
    },
  }

  action activeRefreshGitFailureTrackerNotificationMbtStep: bool = any {
    all { state.lastAction == InitializedAction, establishRunningAttemptForActiveRefresh },
    all {
      state.lastAction == ActiveWorkRunningEstablishedAction,
      offerActiveWorkAuthorityRefreshFromTrackerNotification,
    },
    all {
      state.lastAction == ActiveRefreshTrackerNotificationOfferedAction,
      observeActiveRefreshGitFailures,
    },
  }

  action activeRefreshGitFailureTimerMbtStep: bool = any {
    all { state.lastAction == InitializedAction, establishRunningAttemptForActiveRefresh },
    all {
      state.lastAction == ActiveWorkRunningEstablishedAction,
      offerActiveWorkAuthorityRefreshFromTimer,
    },
    all {
      state.lastAction == ActiveRefreshTimerOfferedAction,
      observeActiveRefreshGitFailures,
    },
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
      state.suspensionCommandCountSinceSafeEvidence == STOP_COMMAND_LIMIT,
      any { projectReadOnlyExactSafeAfterStoppageLimit },
    },
    all {
      state.f2WinningChoice == StopChoice,
      state.stopStage == NeedQuiescence,
      not(stopCommandActive(state)),
      not(exactQuiescence(state)),
      state.stopProjectionsThisActivation != 1,
      state.suspensionCommandCountSinceSafeEvidence != STOP_COMMAND_LIMIT,
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

  // The issue-66 executable relation keeps replacement traces focused while
  // the established `mbtStep` continues to sample the Stop and Continue
  // protocols with its stable seed.
  action restartMbtStep: bool = any {
    all {
      state.f2WinningChoice == NoChoice,
      state.phase == PreIntegration,
      state.currentFingerprint == F1,
      state.executorEvidence == ExactSafelySuspended,
      any { observeF2Change, observeExactTerminal },
    },
    all {
      state.f2WinningChoice == NoChoice,
      state.phase == PreIntegration,
      state.currentFingerprint == F1,
      state.executorEvidence == ExactTerminal,
      beginIntegration,
    },
    all {
      state.f2WinningChoice == NoChoice,
      state.phase == IntegrationStarted,
      state.currentFingerprint == F1,
      observeF2Change,
    },
    all {
      state.f2WinningChoice == NoChoice,
      state.phase == IntegrationStarted,
      state.currentFingerprint == F2,
      rejectRestartPastIntegrationCutoff,
    },
    all {
      state.f2WinningChoice == NoChoice,
      state.phase == PreIntegration,
      state.currentFingerprint == F2,
      applyRestartF2,
    },
    all {
      state.f2WinningChoice == RestartChoice,
      state.replacementPhase == RestartApplied,
      any { beginReplacementFactsFromRetainedSafeSuspension, breakRestartSafeSuspension },
    },
    all {
      state.f2WinningChoice == RestartChoice,
      state.replacementPhase == NeedCurrentExecutorQuiescence,
      any {
        observeRestartRunning,
        observeRestartExecutorUnavailable,
        observeRestartExecutorContradiction,
        observeRestartSafelySuspended,
        observeRestartAccepted,
        observeRestartCompleted,
        observeRestartFailed,
      },
    },
    all {
      state.f2WinningChoice == RestartChoice,
      Set(ReplacementWaiting, ReplacementRejected).contains(state.replacementPhase),
      not(state.independentTaskSelected),
      selectIndependentTaskB,
    },
    all {
      state.f2WinningChoice == RestartChoice,
      state.replacementPhase == NeedCurrentReplacementTaskFacts,
      any {
        observeReplacementExactF2TaskFacts,
        observeReplacementF3TaskFacts,
        observeReplacementTaskFactsUnreadable,
        observeReplacementTaskNotEligible,
      },
    },
    all {
      state.f2WinningChoice == RestartChoice,
      state.replacementPhase == NeedCurrentReplacementClaim,
      any {
        observeReplacementExactK1,
        observeReplacementClaimAbsent,
        observeReplacementClaimForeign,
        observeReplacementClaimUnreadableBounded,
      },
    },
    all {
      state.f2WinningChoice == RestartChoice,
      state.replacementPhase == NeedCurrentOldWorktree,
      any { observeReplacementExactW1Ready, observeReplacementW1NotReady, observeReplacementW1Unreadable },
    },
    all {
      state.f2WinningChoice == RestartChoice,
      state.replacementPhase == NeedCurrentTargetHead,
      any { observeReplacementExactH2, observeReplacementH2Unreadable },
    },
    all {
      state.f2WinningChoice == RestartChoice,
      state.replacementPhase == ReplacementReadyToAppend,
      if (state.replacementProcessLossCount == 0)
        any { recoverReplacementAppendAbsent, recordPlannedAttemptReplacement }
      else
        recordPlannedAttemptReplacement,
    },
    all {
      state.f2WinningChoice == RestartChoice,
      state.replacementPhase == PlannedAttemptReplacementRecorded,
      if (state.replacementProcessLossCount == 0)
        any { recoverReplacementAppendPresent, prepareCleanSuccessorW2 }
      else
        prepareCleanSuccessorW2,
    },
    all {
      state.f2WinningChoice == RestartChoice,
      state.replacementPhase == SuccessorWaitingForAdmission,
      admitSuccessorThroughOrdinaryCapacity,
    },
    all {
      state.f2WinningChoice == RestartChoice,
      state.replacementPhase == SuccessorAdmitted,
      startSuccessorExecutor,
    },
  }

  // A deterministic executable witness keeps the full successful production
  // path live in the adapter even when the reason-rich randomized relation
  // samples only rejection or waiting branches for a particular seed.
  action restartSuccessMbtStep: bool = any {
    all {
      state.f2WinningChoice == NoChoice,
      state.currentFingerprint == F1,
      observeF2Change,
    },
    all {
      state.f2WinningChoice == NoChoice,
      state.currentFingerprint == F2,
      applyRestartF2,
    },
    all {
      state.replacementPhase == RestartApplied,
      beginReplacementFactsFromRetainedSafeSuspension,
    },
    all {
      state.replacementPhase == NeedCurrentReplacementTaskFacts,
      observeReplacementExactF2TaskFacts,
    },
    all {
      state.replacementPhase == NeedCurrentReplacementClaim,
      observeReplacementExactK1,
    },
    all {
      state.replacementPhase == NeedCurrentOldWorktree,
      observeReplacementExactW1Ready,
    },
    all {
      state.replacementPhase == NeedCurrentTargetHead,
      observeReplacementExactH2,
    },
    all {
      state.replacementPhase == ReplacementReadyToAppend,
      recordPlannedAttemptReplacement,
    },
    all {
      state.replacementPhase == PlannedAttemptReplacementRecorded,
      prepareCleanSuccessorW2,
    },
    all {
      state.replacementPhase == SuccessorWaitingForAdmission,
      admitSuccessorThroughOrdinaryCapacity,
    },
    all {
      state.replacementPhase == SuccessorAdmitted,
      startSuccessorExecutor,
    },
  }
}
