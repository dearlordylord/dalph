// Models issue #139's provider-neutral Git decisions. Concrete candidate
// construction, verification, and ref mutation remain owned by #57/#59/#60.
module gitReconciliation {
  type AttemptStatus = Running | SafelySuspended
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
    | RejectUnverifiedCandidate

  type ResultRejection = NoResultRejection | MissingResultCommit | NonDescendantResultCommit

  type State = {
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
    candidateVerified: bool,
  }

  var state: State

  action init: bool = all {
    state' = {
      status: Running,
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
      candidateVerified: false,
    }
  }

  action observeCompatibleTargetAdvance: bool = all {
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
    state.status == Running,
    state.decision == ContinueAttempt,
    state' = constrainAttempt(state, TargetRewriteConstraint),
  }

  action observeLostWorktree: bool = all {
    state.status == Running,
    state.decision == ContinueAttempt,
    state' = constrainAttempt(state, WorktreeLostConstraint),
  }

  action observeRegistrationConflict: bool = all {
    state.status == Running,
    state.decision == ContinueAttempt,
    state' = constrainAttempt(state, RegistrationConflictConstraint),
  }

  action reportSafelySuspended: bool = all {
    state.status == Running,
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
    state' = { ...state, decision: ResultCommitEligible },
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

  action observeExactExpectedTargetWithVerifiedCandidate: bool = all {
    state.decision == ResultCommitEligible,
    state' = {
      ...state,
      decision: PromoteByExactCompareAndSet,
      exactExpectedHeadObserved: true,
      candidateVerified: true,
      compareAndSetAuthorized: true,
    },
  }

  action observeStaleTargetAfterVerification: bool = all {
    state.decision == ResultCommitEligible,
    state' = {
      ...state,
      decision: ReconcileCandidateFromCurrentTarget,
      exactExpectedHeadObserved: false,
      candidateVerified: true,
      compareAndSetAuthorized: false,
      overwriteAuthorized: false,
    },
  }

  action observeAmbiguousTargetAfterVerification: bool = all {
    state.decision == ResultCommitEligible,
    state' = {
      ...state,
      decision: RereadTargetBeforePromotion,
      exactExpectedHeadObserved: false,
      candidateVerified: true,
      compareAndSetAuthorized: false,
      overwriteAuthorized: false,
    },
  }

  action observeExactTargetWithUnverifiedCandidate: bool = all {
    state.decision == ResultCommitEligible,
    state' = {
      ...state,
      decision: RejectUnverifiedCandidate,
      exactExpectedHeadObserved: true,
      candidateVerified: false,
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
      state.decision == RejectUnverifiedCandidate,
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
    state.positionHeld == (state.status == Running)

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
        state.candidateVerified,
        state.compareAndSetAuthorized,
        not(state.overwriteAuthorized),
      }

  val unverifiedCandidateNeverPromotes: bool =
    state.candidateVerified
      or not(state.compareAndSetAuthorized)

  val exactCompareAndSetReached: bool = state.decision == PromoteByExactCompareAndSet
  val staleTargetReconciliationReached: bool = state.decision == ReconcileCandidateFromCurrentTarget
  val ambiguousTargetRereadReached: bool = state.decision == RereadTargetBeforePromotion
  val unverifiedCandidateRejectionReached: bool = state.decision == RejectUnverifiedCandidate

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
    observeExactExpectedTargetWithVerifiedCandidate,
    observeStaleTargetAfterVerification,
    observeAmbiguousTargetAfterVerification,
    observeExactTargetWithUnverifiedCandidate,
  }

  // Exhaustive safety checking must extend settled traces to its fixed bound;
  // executable model traces retain only real issue #139 actions.
  action verificationStep: bool = any {
    step,
    awaitOwnedFollowup,
  }
}
