// Models issue #139's provider-neutral Git decisions plus issue #138's
// blocker chronology. The outer Integrator reports candidate text, Git
// qualifies its exact ordered parents, and ref mutation remains at its own
// boundary; this model records the authority and preservation decisions.
module gitReconciliation {
  // Pre-plan Git selection is separate from later immutable-attempt lineage checks.
  type BaseHead = Head1 | Head2
  type BaseAnchor = Anchor1 | Anchor2
  type BaseTarget = BaseTarget1 | BaseTarget2
  type BaseExecutionRepository = ExecutionRepository1 | ExecutionRepository2
  type BaseReadCase =
    | ExactBaseRead | MissingBaseTarget | UnreadableBaseTarget | ForeignBaseTarget
    | WrongBaseAnchor | DivergentBaseHead | ForeignExecutionRepository
    | MissingExecutionObject | UnreadableExecutionObject
  type BaseRefObservation = TargetMissing | TargetUnreadable | TargetResolved
  type BaseReadEvidence = {
    target: BaseTarget,
    anchor: BaseAnchor,
    executionRepository: BaseExecutionRepository,
    targetHead: BaseHead,
    refObservation: BaseRefObservation,
    anchorIsAncestor: bool,
    objectReadable: bool,
    commitAvailable: bool,
  }
  type BaseRefusal =
    | MissingTargetRefusal | UnreadableTargetRefusal | ForeignTargetRefusal
    | WrongAnchorRefusal | DivergentHeadRefusal | ForeignExecutionRepositoryRefusal
    | MissingObjectRefusal | UnreadableObjectRefusal
  type BaseSelectionStage =
    | NoBaseSelection
    | BaseSelectionIntentRecorded
    | BaseSelectionReadCalled(BaseReadEvidence)
    | QualifiedBaseObserved(BaseReadEvidence)
    | BaseSelectionRefused(BaseRefusal)
    | BaseRetryRequested
    | BaseRetryGraphConfirmed
    | BaseRetryClaimConfirmed
    | BaseRetrySpecificationConfirmed
    | BasePlanRecorded({ observation: BaseReadEvidence, plannedBase: BaseHead })

  pure def baseEvidenceFor(readCase: BaseReadCase, selectedHead: BaseHead): BaseReadEvidence = {
    target: if (readCase == ForeignBaseTarget) BaseTarget2 else BaseTarget1,
    anchor: if (readCase == WrongBaseAnchor) Anchor2 else Anchor1,
    executionRepository: if (readCase == ForeignExecutionRepository) ExecutionRepository2 else ExecutionRepository1,
    targetHead: selectedHead,
    refObservation: if (readCase == MissingBaseTarget) TargetMissing
      else if (readCase == UnreadableBaseTarget) TargetUnreadable else TargetResolved,
    anchorIsAncestor: readCase != DivergentBaseHead,
    objectReadable: readCase != UnreadableExecutionObject,
    commitAvailable: readCase != MissingExecutionObject,
  }
  pure val BASE_READ_CASES = Set(ExactBaseRead, MissingBaseTarget, UnreadableBaseTarget,
    ForeignBaseTarget, WrongBaseAnchor, DivergentBaseHead, ForeignExecutionRepository,
    MissingExecutionObject, UnreadableExecutionObject)
  pure def baseEvidenceQualifies(evidence: BaseReadEvidence): bool = and {
    evidence.target == BaseTarget1, evidence.anchor == Anchor1,
    evidence.executionRepository == ExecutionRepository1,
    evidence.refObservation == TargetResolved, evidence.anchorIsAncestor,
    evidence.objectReadable, evidence.commitAvailable,
  }
  pure def baseRefusalFor(evidence: BaseReadEvidence): BaseRefusal =
    if (evidence.target != BaseTarget1) ForeignTargetRefusal
    else if (evidence.anchor != Anchor1) WrongAnchorRefusal
    else if (evidence.executionRepository != ExecutionRepository1) ForeignExecutionRepositoryRefusal
    else if (evidence.refObservation == TargetMissing) MissingTargetRefusal
    else if (evidence.refObservation == TargetUnreadable) UnreadableTargetRefusal
    else if (not(evidence.anchorIsAncestor)) DivergentHeadRefusal
    else if (not(evidence.objectReadable)) UnreadableObjectRefusal
    else MissingObjectRefusal

  type AttemptStatus = Executing | SafelySuspended
  type GitConstraint =
    | NoGitConstraint
    | WorktreeLostConstraint
    | RegistrationConflictConstraint
    | TargetRewriteConstraint

  type Decision =
    | ContinueAttempt
    | RequestSafeSuspension
    | GitConstraintWait
    | ResultCommitEligible
    | ResultCommitRejected
    | PromoteByExactCompareAndSet
    | ReconcileCandidateFromCurrentTarget
    | RereadTargetBeforePromotion
    | RejectUnqualifiedCandidate

  type ResultRejection = NoResultRejection | MissingResultCommit | NonDescendantResultCommit
  type TrackerBlocker = NoTrackerBlocker | BeforePromotionBlocker | AfterPromotionBlocker | IncompleteTrackerFacts

  type State = {
    baseSelection: BaseSelectionStage,
    currentBaseHead: BaseHead,
    baseIntentAccepted: bool,
    baseQualifiedEver: bool,
    baseRetryRequestAccepted: bool,
    baseRetryFactsConfirmed: bool,
    successorBaseRead: bool,
    baseReadCalledWithoutIntent: bool,
    status: AttemptStatus,
    constraint: GitConstraint,
    decision: Decision,
    compatibleAdvanceObserved: bool,
    resultRejected: bool,
    resultRejection: ResultRejection,
    claimPreserved: bool,
    worktreePreserved: bool,
    evidencePreserved: bool,
    repairAuthorized: bool,
    overwriteAuthorized: bool,
    compareAndSetAuthorized: bool,
    positionHeld: bool,
    independentTaskEligible: bool,
    independentTaskSelected: bool,
    exactExpectedHeadObserved: bool,
    candidateGitQualified: bool,
    candidatePreserved: bool,
    promotionProof: bool,
    trackerBlocker: TrackerBlocker,
    priorSupersessionCount: int,
    unrelatedSupersessionCount: int,
    successorOrdinal: int,
    sessionSuperseded: bool,
    successorStarted: bool,
    promotedCandidateAncestryProven: bool,
    completionAuthorized: bool,
    completionAccepted: bool,
    focusedCompletionConfirmed: bool,
    completionWarning: bool,
    reintegrationAuthorized: bool,
  }

  var state: State

  action init: bool = all {
    state' = {
      baseSelection: NoBaseSelection,
      currentBaseHead: Head1,
      baseIntentAccepted: false,
      baseQualifiedEver: false,
      baseRetryRequestAccepted: false,
      baseRetryFactsConfirmed: false,
      successorBaseRead: false,
      baseReadCalledWithoutIntent: false,
      status: Executing,
      constraint: NoGitConstraint,
      decision: ContinueAttempt,
      compatibleAdvanceObserved: false,
      resultRejected: false,
      resultRejection: NoResultRejection,
      claimPreserved: true,
      worktreePreserved: true,
      evidencePreserved: true,
      repairAuthorized: false,
      overwriteAuthorized: false,
      compareAndSetAuthorized: false,
      positionHeld: true,
      independentTaskEligible: true,
      independentTaskSelected: false,
      exactExpectedHeadObserved: false,
      candidateGitQualified: false,
      candidatePreserved: true,
      promotionProof: false,
      trackerBlocker: NoTrackerBlocker,
      priorSupersessionCount: 0,
      unrelatedSupersessionCount: 0,
      successorOrdinal: 0,
      sessionSuperseded: false,
      successorStarted: false,
      promotedCandidateAncestryProven: false,
      completionAuthorized: false,
      completionAccepted: false,
      focusedCompletionConfirmed: false,
      completionWarning: false,
      reintegrationAuthorized: false,
    }
  }

  action recordBaseSelectionIntent: bool = all {
    or { state.baseSelection == NoBaseSelection, state.baseSelection == BaseRetrySpecificationConfirmed },
    state' = { ...state, baseSelection: BaseSelectionIntentRecorded, baseIntentAccepted: true, successorBaseRead: state.baseSelection != NoBaseSelection },
  }
  // Only a named explicit request can leave a settled refusal; ordinary wake stutters.
  action requestExplicitBaseRetry: bool = all {
    match state.baseSelection { | BaseSelectionRefused(_) => true | _ => false },
    state' = { ...state, baseSelection: BaseRetryRequested, baseIntentAccepted: false, baseRetryRequestAccepted: true, baseRetryFactsConfirmed: false, successorBaseRead: false },
  }
  action confirmRetryGraph: bool = all {
    state.baseSelection == BaseRetryRequested,
    state' = { ...state, baseSelection: BaseRetryGraphConfirmed },
  }
  action confirmRetryExactClaim: bool = all {
    state.baseSelection == BaseRetryGraphConfirmed,
    state' = { ...state, baseSelection: BaseRetryClaimConfirmed },
  }
  action confirmRetryUnchangedSpecification: bool = all {
    state.baseSelection == BaseRetryClaimConfirmed,
    state' = { ...state, baseSelection: BaseRetrySpecificationConfirmed, baseRetryFactsConfirmed: true },
  }
  action automaticBaseRetryWake: bool = state' = state

  action callBaseSelectionRead(readCase: BaseReadCase): bool = all {
    state.baseSelection == BaseSelectionIntentRecorded,
    state' = { ...state, baseSelection: BaseSelectionReadCalled(baseEvidenceFor(readCase, state.currentBaseHead)),
      baseReadCalledWithoutIntent: not(state.baseIntentAccepted) },
  }
  action acceptQualifiedBaseSelection: bool = {
    nondet selectedHead = Set(Head1, Head2).oneOf()
    nondet readCase = BASE_READ_CASES.oneOf()
    val evidence = baseEvidenceFor(readCase, selectedHead)
    all {
      state.baseSelection == BaseSelectionReadCalled(evidence),
      baseEvidenceQualifies(evidence),
      state' = { ...state, baseSelection: QualifiedBaseObserved(evidence), baseQualifiedEver: true },
    }
  }
  action refuseBaseSelection: bool = {
    nondet selectedHead = Set(Head1, Head2).oneOf()
    nondet readCase = BASE_READ_CASES.oneOf()
    val evidence = baseEvidenceFor(readCase, selectedHead)
    all {
      state.baseSelection == BaseSelectionReadCalled(evidence),
      not(baseEvidenceQualifies(evidence)),
      state' = { ...state, baseSelection: BaseSelectionRefused(baseRefusalFor(evidence)) },
    }
  }
  action advanceBaseTargetHead: bool = all {
    state.currentBaseHead == Head1,
    state' = { ...state, currentBaseHead: Head2 },
  }
  action recordSelectedBasePlan: bool = {
    nondet selectedHead = Set(Head1, Head2).oneOf()
    val evidence = baseEvidenceFor(ExactBaseRead, selectedHead)
    all {
      state.baseSelection == QualifiedBaseObserved(evidence),
      state' = { ...state, baseSelection: BasePlanRecorded({ observation: evidence, plannedBase: selectedHead }) },
    }
  }
  val qualifiedSelectionIsNeverRetried: bool = not(state.baseQualifiedEver) or match state.baseSelection {
    | QualifiedBaseObserved(_) => true | BasePlanRecorded(_) => true | _ => false
  }
  val retryReadHasExplicitTrackerAuthority: bool = not(state.successorBaseRead) or
    (state.baseRetryRequestAccepted and state.baseRetryFactsConfirmed)
  val explicitRetryPlanReached: bool = state.successorBaseRead and match state.baseSelection {
    | BasePlanRecorded(_) => true | _ => false
  }
  action unsafeRetryQualifiedBase: bool = all {
    state.baseQualifiedEver,
    state' = { ...state, baseSelection: BaseSelectionIntentRecorded },
  }
  action unsafeRetryWithoutTrackerFacts: bool = all {
    state.baseSelection == BaseRetryRequested,
    state' = { ...state, baseSelection: BaseSelectionIntentRecorded, successorBaseRead: true },
  }
  val baseSelectionReadsRequireIntent: bool = not(state.baseReadCalledWithoutIntent)
  // Independent requirement: do not call baseEvidenceQualifies from this law.
  val qualifiedBaseRequiresExactAuthority: bool = match state.baseSelection {
    | QualifiedBaseObserved(evidence) => and {
        evidence.target == BaseTarget1, evidence.anchor == Anchor1,
        evidence.executionRepository == ExecutionRepository1, evidence.refObservation == TargetResolved,
        evidence.anchorIsAncestor, evidence.objectReadable, evidence.commitAvailable,
      }
    | BasePlanRecorded(plan) => and {
        plan.observation.target == BaseTarget1, plan.observation.anchor == Anchor1,
        plan.observation.executionRepository == ExecutionRepository1,
        plan.observation.refObservation == TargetResolved, plan.observation.anchorIsAncestor,
        plan.observation.objectReadable, plan.observation.commitAvailable,
      }
    | _ => true
  }
  val basePlanUsesObservedHead: bool = match state.baseSelection {
    | BasePlanRecorded(plan) => plan.plannedBase == plan.observation.targetHead
    | _ => true
  }
  val qualifiedBaseSelectionReached: bool = match state.baseSelection {
    | QualifiedBaseObserved(_) => true | _ => false
  }
  val baseSelectionRefusedReached: bool = match state.baseSelection {
    | BaseSelectionRefused(_) => true | _ => false
  }
  val basePlanPreservedAfterHeadAdvanceReached: bool = match state.baseSelection {
    | BasePlanRecorded(plan) => plan.plannedBase != state.currentBaseHead
    | _ => false
  }

  action observePrePromotionDependencyBlocker: bool = all {
    state.candidatePreserved,
    not(state.promotionProof),
    state.constraint == NoGitConstraint,
    state.positionHeld,
    state.trackerBlocker == NoTrackerBlocker,
    state' = {
      ...state,
      decision: GitConstraintWait,
      positionHeld: false,
      trackerBlocker: BeforePromotionBlocker,
    },
  }

  action clearPrePromotionDependencyBlocker: bool = all {
    state.trackerBlocker == BeforePromotionBlocker,
    state.constraint == NoGitConstraint,
    state' = {
      ...state,
      compareAndSetAuthorized: false,
      decision: RereadTargetBeforePromotion,
      exactExpectedHeadObserved: false,
      overwriteAuthorized: false,
      positionHeld: true,
      trackerBlocker: NoTrackerBlocker,
    },
  }

  // Restart recreates no process-local target ownership and preserves the
  // accepted candidate while the complete tracker read is still required.
  action reopenPrePromotionBlockerAfterRestart: bool = all {
    state.trackerBlocker == BeforePromotionBlocker,
    state.candidatePreserved,
    not(state.positionHeld),
    state' = { ...state, decision: GitConstraintWait, positionHeld: false },
  }

  action observeFreshTargetAfterPrePromotionBlocker: bool = all {
    state.decision == RereadTargetBeforePromotion,
    state.candidatePreserved,
    not(state.promotionProof),
    state' = { ...state, decision: ContinueAttempt, compatibleAdvanceObserved: true },
  }

  action recordIntegrationSessionSupersession: bool = all {
    state.candidatePreserved,
    state.compatibleAdvanceObserved,
    not(state.promotionProof),
    not(state.sessionSuperseded),
    state' = {
      ...state,
      decision: ContinueAttempt,
      priorSupersessionCount: state.priorSupersessionCount + 1,
      sessionSuperseded: true,
    },
  }

  // A different task may supersede its own session in the same Run.  It does
  // not belong to this accepted-result/session chain and therefore cannot
  // consume this responsibility's successor ordinal.
  action recordUnrelatedSessionSupersession: bool = all {
    state.unrelatedSupersessionCount == 0,
    state' = { ...state, unrelatedSupersessionCount: state.unrelatedSupersessionCount + 1 },
  }

  // Mutation-profile action: one prior session must never be superseded twice.
  action recordDuplicatePriorSessionSupersession: bool = all {
    state.priorSupersessionCount == 1,
    state' = { ...state, priorSupersessionCount: state.priorSupersessionCount + 1 },
  }

  action startOneSuccessorCandidate: bool = all {
    state.sessionSuperseded,
    not(state.successorStarted),
    state.candidatePreserved,
    state' = {
      ...state,
      decision: ContinueAttempt,
      successorOrdinal: state.priorSupersessionCount,
      successorStarted: true,
    },
  }

  // Mutation-profile action: deriving identity from all Run sessions would
  // make an unrelated task change this responsibility's successor ordinal.
  action startSuccessorUsingUnrelatedOrdinal: bool = all {
    state.sessionSuperseded,
    state.unrelatedSupersessionCount > 0,
    not(state.successorStarted),
    state' = {
      ...state,
      successorOrdinal: state.unrelatedSupersessionCount + 1,
      successorStarted: true,
    },
  }

  action observePostPromotionDependencyBlocker: bool = all {
    state.promotionProof,
    not(state.completionAuthorized),
    state.constraint == NoGitConstraint,
    state.trackerBlocker == NoTrackerBlocker,
    state' = {
      ...state,
      compareAndSetAuthorized: false,
      decision: GitConstraintWait,
      exactExpectedHeadObserved: false,
      overwriteAuthorized: false,
      positionHeld: false,
      trackerBlocker: AfterPromotionBlocker,
    },
  }

  action clearPostPromotionDependencyBlocker: bool = all {
    state.trackerBlocker == AfterPromotionBlocker,
    state.constraint == NoGitConstraint,
    state' = {
      ...state,
      compareAndSetAuthorized: false,
      decision: RereadTargetBeforePromotion,
      exactExpectedHeadObserved: false,
      overwriteAuthorized: false,
      positionHeld: true,
      trackerBlocker: NoTrackerBlocker,
    },
  }

  action observeFreshPromotedCandidateAncestry: bool = all {
    state.promotionProof,
    state.trackerBlocker == NoTrackerBlocker,
    state.decision == RereadTargetBeforePromotion,
    state' = { ...state, decision: ContinueAttempt, promotedCandidateAncestryProven: true },
  }

  action completeAfterPromotedCandidateAncestry: bool = all {
    state.promotionProof,
    state.trackerBlocker == NoTrackerBlocker,
    state.promotedCandidateAncestryProven,
    state.candidatePreserved,
    not(state.reintegrationAuthorized),
    state' = { ...state, completionAuthorized: true, decision: ContinueAttempt },
  }

  action observeIncompleteTrackerFacts: bool = all {
    state.positionHeld,
    state.trackerBlocker == NoTrackerBlocker,
    state' = { ...state, decision: GitConstraintWait, positionHeld: false, trackerBlocker: IncompleteTrackerFacts },
  }

  action acceptCompletionAcrossPrerequisiteRace: bool = all {
    state.completionAuthorized,
    not(state.completionAccepted),
    state' = { ...state, completionAccepted: true, focusedCompletionConfirmed: true, completionWarning: true },
  }

  action clearDerivedCompletionWarning: bool = all {
    state.completionWarning,
    state' = { ...state, completionWarning: false },
  }

  action observeCompatibleTargetAdvance: bool = all {
    state.constraint == NoGitConstraint,
    state.trackerBlocker == NoTrackerBlocker,
    state.decision == ContinueAttempt,
    not(state.compatibleAdvanceObserved),
    state' = { ...state, compatibleAdvanceObserved: true },
  }

  pure def constrainAttempt(s: State, constraint: GitConstraint): State = {
    ...s,
    compatibleAdvanceObserved: false,
    constraint: constraint,
    decision: RequestSafeSuspension,
  }

  action observeIncompatibleTargetRewrite: bool = all {
    state.status == Executing,
    state.decision == ContinueAttempt,
    state' = constrainAttempt(state, TargetRewriteConstraint),
  }

  action observeLostWorktree: bool = all {
    state.status == Executing,
    state.decision == ContinueAttempt,
    state' = constrainAttempt(state, WorktreeLostConstraint),
  }

  action observeRegistrationConflict: bool = all {
    state.status == Executing,
    state.decision == ContinueAttempt,
    state' = constrainAttempt(state, RegistrationConflictConstraint),
  }

  action reportSafelySuspended: bool = all {
    state.status == Executing,
    state.decision == RequestSafeSuspension,
    state' = {
      ...state,
      status: SafelySuspended,
      decision: GitConstraintWait,
      positionHeld: false,
    },
  }

  action selectIndependentTask: bool = all {
    state.independentTaskEligible,
    not(state.independentTaskSelected),
    state' = { ...state, independentTaskSelected: true },
  }

  action observeEligibleResultCommit: bool = all {
    state.decision == ContinueAttempt,
    state.constraint == NoGitConstraint,
    state' = {
      ...state,
      decision: ResultCommitEligible,
      resultRejected: false,
      resultRejection: NoResultRejection,
    },
  }

  action observeMissingResultCommit: bool = all {
    state.decision == ContinueAttempt,
    state.constraint == NoGitConstraint,
    state' = {
      ...state,
      decision: ResultCommitRejected,
      resultRejected: true,
      resultRejection: MissingResultCommit,
    },
  }

  action observeNonDescendantResultCommit: bool = all {
    state.decision == ContinueAttempt,
    state.constraint == NoGitConstraint,
    state' = {
      ...state,
      decision: ResultCommitRejected,
      resultRejected: true,
      resultRejection: NonDescendantResultCommit,
    },
  }

  action observeExactExpectedTargetWithGitQualifiedCandidate: bool = all {
    state.decision == ResultCommitEligible,
    state' = {
      ...state,
      decision: PromoteByExactCompareAndSet,
      exactExpectedHeadObserved: true,
      candidateGitQualified: true,
      compareAndSetAuthorized: true,
      promotionProof: true,
    },
  }

  action observeStaleTargetAfterGitQualification: bool = all {
    state.decision == ResultCommitEligible,
    state' = {
      ...state,
      decision: ReconcileCandidateFromCurrentTarget,
      exactExpectedHeadObserved: false,
      candidateGitQualified: true,
      compareAndSetAuthorized: false,
      overwriteAuthorized: false,
    },
  }

  action observeAmbiguousTargetAfterGitQualification: bool = all {
    state.decision == ResultCommitEligible,
    state' = {
      ...state,
      decision: RereadTargetBeforePromotion,
      exactExpectedHeadObserved: false,
      candidateGitQualified: true,
      compareAndSetAuthorized: false,
      overwriteAuthorized: false,
    },
  }

  action observeExactTargetWithUnqualifiedCandidate: bool = all {
    state.decision == ResultCommitEligible,
    state' = {
      ...state,
      decision: RejectUnqualifiedCandidate,
      exactExpectedHeadObserved: true,
      candidateGitQualified: false,
      compareAndSetAuthorized: false,
      overwriteAuthorized: false,
    },
  }

  // These decisions hand control to a later retry or to integration work owned
  // by #57/#59/#60. That external work does not change issue #139's state.
  action awaitOwnedFollowup: bool = all {
    or {
      state.decision == GitConstraintWait,
      state.decision == ResultCommitRejected,
      state.decision == PromoteByExactCompareAndSet,
      state.decision == ReconcileCandidateFromCurrentTarget,
      state.decision == RereadTargetBeforePromotion,
      state.decision == RejectUnqualifiedCandidate,
    },
    state' = state,
  }

  val compatibleTargetAdvanceDoesNotConstrainAttempt: bool =
    not(state.compatibleAdvanceObserved)
      or state.constraint == NoGitConstraint

  val compatibleAdvanceReached: bool = state.compatibleAdvanceObserved

  val incompatibleRewriteConstrainsOnlyAffectedAttempt: bool =
    state.constraint != TargetRewriteConstraint
      or and {
        state.independentTaskEligible,
        state.claimPreserved,
        state.worktreePreserved,
        state.evidencePreserved,
      }

  val gitConstraintPreservesIndependentEligibility: bool =
    state.constraint == NoGitConstraint or state.independentTaskEligible

  val lostWorktreeNeverAuthorizesRepair: bool =
    state.constraint != WorktreeLostConstraint or not(state.repairAuthorized)

  val registrationConflictNeverAuthorizesRepair: bool =
    state.constraint != RegistrationConflictConstraint or not(state.repairAuthorized)

  val positionHeldUntilSafeSuspension: bool =
    state.positionHeld or state.status == SafelySuspended or state.trackerBlocker != NoTrackerBlocker

  val targetRewriteWaitReached: bool =
    state.constraint == TargetRewriteConstraint and state.decision == GitConstraintWait

  val lostWorktreeWaitReached: bool =
    state.constraint == WorktreeLostConstraint and state.decision == GitConstraintWait

  val registrationConflictWaitReached: bool =
    state.constraint == RegistrationConflictConstraint and state.decision == GitConstraintWait

  val independentTaskSelectedReached: bool = state.independentTaskSelected

  val rejectedResultPreservesWorktree: bool =
    not(state.resultRejected)
      or and {
        state.worktreePreserved,
        state.claimPreserved,
        state.evidencePreserved,
      }

  val missingResultRejectedReached: bool =
    state.resultRejection == MissingResultCommit and state.decision == ResultCommitRejected

  val nonDescendantResultRejectedReached: bool =
    state.resultRejection == NonDescendantResultCommit and state.decision == ResultCommitRejected

  val eligibleResultReached: bool = state.decision == ResultCommitEligible

  val staleTargetNeverOverwrites: bool =
    state.decision != ReconcileCandidateFromCurrentTarget
      or and {
        not(state.overwriteAuthorized),
        not(state.compareAndSetAuthorized),
      }

  val ambiguousTargetNeverPromotes: bool =
    state.decision != RereadTargetBeforePromotion
      or and {
        not(state.overwriteAuthorized),
        not(state.compareAndSetAuthorized),
      }

  val promotionRequiresExactExpectedHead: bool =
    state.decision != PromoteByExactCompareAndSet
      or and {
        state.exactExpectedHeadObserved,
        state.candidateGitQualified,
        state.compareAndSetAuthorized,
        not(state.overwriteAuthorized),
      }

  val unqualifiedCandidateNeverPromotes: bool =
    state.candidateGitQualified
      or not(state.compareAndSetAuthorized)

  val exactCompareAndSetReached: bool = state.decision == PromoteByExactCompareAndSet
  val staleTargetReconciliationReached: bool = state.decision == ReconcileCandidateFromCurrentTarget
  val ambiguousTargetRereadReached: bool = state.decision == RereadTargetBeforePromotion
  val unqualifiedCandidateRejectionReached: bool = state.decision == RejectUnqualifiedCandidate
  val prePromotionBlockerReached: bool = state.trackerBlocker == BeforePromotionBlocker
  val prePromotionRereadReached: bool =
    state.decision == RereadTargetBeforePromotion and not(state.promotionProof)
  val unrelatedSupersessionReached: bool = state.unrelatedSupersessionCount > 0
  val sessionSupersessionReached: bool = state.sessionSuperseded
  val successorStartedReached: bool = state.successorStarted
  val postPromotionBlockerReached: bool = state.trackerBlocker == AfterPromotionBlocker
  val promotedAncestryProvenReached: bool = state.promotedCandidateAncestryProven
  val completionAuthorizedReached: bool = state.completionAuthorized
  val completionAcceptedReached: bool = state.completionAccepted
  val completionWarningReached: bool = state.completionWarning
  val incompleteFactsWaitReached: bool = state.trackerBlocker == IncompleteTrackerFacts

  val prePromotionBlockerPreservesCandidate: bool =
    state.trackerBlocker != BeforePromotionBlocker or state.candidatePreserved

  val prePromotionBlockerReleasesTarget: bool =
    state.trackerBlocker != BeforePromotionBlocker or not(state.positionHeld)

  val postPromotionBlockerPreservesProof: bool =
    state.trackerBlocker != AfterPromotionBlocker or state.promotionProof

  val postPromotionBlockerNeverRollsBack: bool =
    not(state.promotionProof) or not(state.reintegrationAuthorized)

  val clearedPromotionRequiresFreshAncestry: bool =
    not(state.completionAuthorized) or and { state.promotionProof, state.promotedCandidateAncestryProven }

  val clearedPromotionNeverReintegrates: bool =
    not(state.promotionProof) or not(state.reintegrationAuthorized)

  val incompleteFactsReleaseTarget: bool =
    state.trackerBlocker != IncompleteTrackerFacts or not(state.positionHeld)

  val oneSuccessorRequiresDurableSupersession: bool =
    not(state.successorStarted) or state.sessionSuperseded

  val onePriorSessionHasOneSupersession: bool = state.priorSupersessionCount <= 1

  val successorIdentityUsesOwnSessionChain: bool =
    not(state.successorStarted) or state.successorOrdinal == state.priorSupersessionCount

  val completionRacePreservesAcceptedCompletion: bool =
    not(state.completionWarning) or and { state.completionAccepted, state.focusedCompletionConfirmed }

  val completionWarningIsDerivedOnly: bool =
    not(state.completionWarning) or state.completionAccepted

  action step: bool = any {
    observeCompatibleTargetAdvance,
    observeIncompatibleTargetRewrite,
    observeLostWorktree,
    observeRegistrationConflict,
    reportSafelySuspended,
    selectIndependentTask,
    observeEligibleResultCommit,
    observeMissingResultCommit,
    observeNonDescendantResultCommit,
    observeExactExpectedTargetWithGitQualifiedCandidate,
    observeStaleTargetAfterGitQualification,
    observeAmbiguousTargetAfterGitQualification,
    observeExactTargetWithUnqualifiedCandidate,
    observePrePromotionDependencyBlocker,
    observeIncompleteTrackerFacts,
  }

  // The executable MBT step above stops at the current production-backed
  // Integrator/Git/frontier boundary. It deliberately does not claim that
  // this fixture records target-promotion/finality events, target-lineage
  // changes after a blocker, or outer-Integrator session succession. The
  // complete pure-Quint profile below retains those issue #138 projection
  // actions for their invariants, witnesses, and negative controls.
  // Executable pre-plan adapter slice: later promotion/session state stutters.
  action baseSelectionStep: bool = any {
    recordBaseSelectionIntent,
    { nondet readCase = BASE_READ_CASES.oneOf() callBaseSelectionRead(readCase) },
    acceptQualifiedBaseSelection, refuseBaseSelection, advanceBaseTargetHead, recordSelectedBasePlan,
  }

  action baseRetryStep: bool = any {
    recordBaseSelectionIntent,
    { nondet readCase = Set(ExactBaseRead, MissingBaseTarget, UnreadableBaseTarget, DivergentBaseHead, MissingExecutionObject, UnreadableExecutionObject).oneOf() callBaseSelectionRead(readCase) },
    acceptQualifiedBaseSelection, refuseBaseSelection, advanceBaseTargetHead, recordSelectedBasePlan,
    requestExplicitBaseRetry, confirmRetryGraph, confirmRetryExactClaim, confirmRetryUnchangedSpecification, automaticBaseRetryWake,
  }

  action gitReconciliationStep: bool = any {
    requestExplicitBaseRetry, confirmRetryGraph, confirmRetryExactClaim, confirmRetryUnchangedSpecification, automaticBaseRetryWake,
    recordBaseSelectionIntent,
    { nondet readCase = BASE_READ_CASES.oneOf() callBaseSelectionRead(readCase) },
    acceptQualifiedBaseSelection, refuseBaseSelection, advanceBaseTargetHead, recordSelectedBasePlan,
    step,
    observeFreshTargetAfterPrePromotionBlocker,
    clearPrePromotionDependencyBlocker,
    observePostPromotionDependencyBlocker,
    clearPostPromotionDependencyBlocker,
    observeFreshPromotedCandidateAncestry,
    completeAfterPromotedCandidateAncestry,
    acceptCompletionAcrossPrerequisiteRace,
    clearDerivedCompletionWarning,
    recordIntegrationSessionSupersession,
    recordUnrelatedSessionSupersession,
    startOneSuccessorCandidate,
    awaitOwnedFollowup,
  }
}
