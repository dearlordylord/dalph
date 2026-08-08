// Models issues #136 and #137's subject-local decisions after current tracker
// facts change while one exact planned attempt owns unfinished executor work.
module taskFactReconciliation {
  type Constraint =
    | NoConstraint
    | MembershipConstraint
    | LifecycleConstraint
    | SpecificationConstraint
    | ExternalSuccessConstraint
    | MissingClaimConstraint
    | ForeignClaimConstraint
    | UnreadableClaimConstraint

  type Decision =
    | ContinueWork
    | RequestSafeSuspension
    | MembershipWait
    | LifecycleWait
    | SpecificationChoices
    | ReleaseExactClaim
    | ExternalSuccessSettled
    | MissingClaimWait
    | ForeignClaimWait
    | UnreadableClaimWait
    | AllocateReplacementClaim
    | ObserveReplacementClaim

  type Status = Running | SafelySuspended
  type ClaimState = ExactClaim | MissingClaim | ForeignClaim | UnreadableClaim | ReplacementClaim
  type ClaimMutationTarget = NoClaimMutation | OwnedClaimMutation | ForeignClaimMutation

  type State = {
    status: Status,
    constraint: Constraint,
    decision: Decision,
    positionHeld: bool,
    exactClaimHeld: bool,
    wipPreserved: bool,
    dependantsReleasedByFreshGraph: bool,
    duplicateDeliveryPrevented: bool,
    claimState: ClaimState,
    reacquisitionDirectionApplied: bool,
    replacementIntentRecorded: bool,
    lastClaimMutationTarget: ClaimMutationTarget,
    independentTaskEligible: bool,
    independentTaskSelected: bool,
    originalClaimIdentity: int,
    currentClaimIdentity: int,
  }

  var state: State

  val positionHeldUntilSafeSuspension: bool =
    state.positionHeld == (state.status == Running)

  val changedFactsPreserveWip: bool = state.wipPreserved

  val specificationOffersEveryExactChoice: bool =
    (state.decision == SpecificationChoices)
      == and {
        state.constraint == SpecificationConstraint,
        state.status == SafelySuspended,
      }

  val externalSuccessPreventsDuplicateDelivery: bool =
    state.constraint != ExternalSuccessConstraint
      or state.duplicateDeliveryPrevented

  val externalSuccessReleasesOnlyAfterSafeSuspension: bool =
    state.decision != ReleaseExactClaim
      or and {
        state.status == SafelySuspended,
        state.exactClaimHeld,
      }

  val externalSuccessSettlesAfterExactClaimRelease: bool =
    state.decision != ExternalSuccessSettled
      or and {
        state.status == SafelySuspended,
        not(state.exactClaimHeld),
        state.dependantsReleasedByFreshGraph,
      }

  val replacementClaimRequiresDirectionAndIntent: bool =
    state.claimState != ReplacementClaim
      or and {
        state.reacquisitionDirectionApplied,
        state.replacementIntentRecorded,
      }

  val foreignClaimIsNeverChanged: bool =
    state.claimState != ForeignClaim or state.lastClaimMutationTarget != ForeignClaimMutation

  val unreadableClaimCannotAuthorizeReplacement: bool =
    state.claimState != UnreadableClaim
      or and {
        not(state.reacquisitionDirectionApplied),
        not(state.replacementIntentRecorded),
      }

  val claimConstraintPreservesIndependentEligibility: bool =
    not(
      state.constraint == MissingClaimConstraint
        or state.constraint == ForeignClaimConstraint
        or state.constraint == UnreadableClaimConstraint
    ) or state.independentTaskEligible

  val replacementClaimIdentityIsFresh: bool =
    state.claimState != ReplacementClaim
      or state.currentClaimIdentity != state.originalClaimIdentity

  val membershipWaitReached: bool = state.decision == MembershipWait
  val lifecycleWaitReached: bool = state.decision == LifecycleWait
  val specificationChoicesReached: bool = state.decision == SpecificationChoices
  val externalSuccessSettledReached: bool = state.decision == ExternalSuccessSettled
  val foreignClaimWaitReached: bool = state.decision == ForeignClaimWait
  val missingClaimWaitReached: bool = state.decision == MissingClaimWait
  val unreadableClaimWaitReached: bool = state.decision == UnreadableClaimWait
  val replacementClaimObserved: bool =
    state.claimState == ReplacementClaim and state.decision == ContinueWork

  action init: bool = all {
    state' = {
      status: Running,
      constraint: NoConstraint,
      decision: ContinueWork,
      positionHeld: true,
      exactClaimHeld: true,
      wipPreserved: true,
      dependantsReleasedByFreshGraph: false,
      duplicateDeliveryPrevented: false,
      claimState: ExactClaim,
      reacquisitionDirectionApplied: false,
      replacementIntentRecorded: false,
      lastClaimMutationTarget: NoClaimMutation,
      independentTaskEligible: true,
      independentTaskSelected: false,
      originalClaimIdentity: 1,
      currentClaimIdentity: 1,
    }
  }

  action observeMembershipLoss: bool = all {
    state.status == Running,
    state.decision == ContinueWork,
    state' = {
      ...state,
      constraint: MembershipConstraint,
      decision: RequestSafeSuspension,
    },
  }

  action observeLifecycleClosure: bool = all {
    state.status == Running,
    state.decision == ContinueWork,
    state' = {
      ...state,
      constraint: LifecycleConstraint,
      decision: RequestSafeSuspension,
    },
  }

  action observeSpecificationChange: bool = all {
    state.status == Running,
    state.decision == ContinueWork,
    state' = {
      ...state,
      constraint: SpecificationConstraint,
      decision: RequestSafeSuspension,
    },
  }

  action observeExternalSuccess: bool = all {
    state.status == Running,
    state.decision == ContinueWork,
    state' = {
      ...state,
      constraint: ExternalSuccessConstraint,
      decision: RequestSafeSuspension,
      dependantsReleasedByFreshGraph: true,
      duplicateDeliveryPrevented: true,
    },
  }

  action observeIncompleteMembershipRead: bool = all {
    state.status == Running,
    state.decision == ContinueWork,
    state' = state,
  }

  action observeMissingClaim: bool = all {
    state.status == Running,
    state.decision == ContinueWork,
    state' = {
      ...state,
      constraint: MissingClaimConstraint,
      decision: RequestSafeSuspension,
      claimState: MissingClaim,
      exactClaimHeld: false,
    },
  }

  action observeForeignClaim: bool = all {
    state.status == Running,
    state.decision == ContinueWork,
    state' = {
      ...state,
      constraint: ForeignClaimConstraint,
      decision: RequestSafeSuspension,
      claimState: ForeignClaim,
      exactClaimHeld: false,
      lastClaimMutationTarget: NoClaimMutation,
    },
  }

  action observeUnreadableClaim: bool = all {
    state.status == Running,
    state.decision == ContinueWork,
    state' = {
      ...state,
      constraint: UnreadableClaimConstraint,
      decision: RequestSafeSuspension,
      claimState: UnreadableClaim,
    },
  }

  action reportSafelySuspended: bool = all {
    state.status == Running,
    state.decision == RequestSafeSuspension,
    state' = {
      ...state,
      status: SafelySuspended,
      decision:
        if (state.constraint == MembershipConstraint) MembershipWait
        else if (state.constraint == LifecycleConstraint) LifecycleWait
        else if (state.constraint == SpecificationConstraint) SpecificationChoices
        else if (state.constraint == ExternalSuccessConstraint) ReleaseExactClaim
        else if (state.constraint == MissingClaimConstraint) MissingClaimWait
        else if (state.constraint == ForeignClaimConstraint) ForeignClaimWait
        else UnreadableClaimWait,
      positionHeld: false,
    },
  }

  action applyMissingClaimReacquisitionDirection: bool = all {
    state.status == SafelySuspended,
    state.decision == MissingClaimWait,
    state' = {
      ...state,
      decision: AllocateReplacementClaim,
      reacquisitionDirectionApplied: true,
    },
  }

  action applyForeignClaimReacquisitionDirection: bool = all {
    state.status == SafelySuspended,
    state.decision == ForeignClaimWait,
    state' = {
      ...state,
      reacquisitionDirectionApplied: true,
    },
  }

  action rejectForeignClaimReacquisition: bool = all {
    state.status == SafelySuspended,
    state.decision == ForeignClaimWait,
    state.reacquisitionDirectionApplied,
    state' = state,
  }

  // The replacement identity is allocated, not derived. A token from an
  // earlier claim cannot authorize a replacement claim, so the freshness
  // guard is what keeps a reused identity out.
  action planReplacementClaim: bool = {
    // The allocator may offer the identity the earlier claim already used.
    // Drawing here rather than in `step` keeps the branching to this action.
    nondet allocatedClaimIdentity =
      Set(state.originalClaimIdentity, state.originalClaimIdentity + 1).oneOf()
    all {
      state.status == SafelySuspended,
      state.decision == AllocateReplacementClaim,
      state.reacquisitionDirectionApplied,
      allocatedClaimIdentity != state.originalClaimIdentity,
      state' = {
        ...state,
        decision: ObserveReplacementClaim,
        claimState: ReplacementClaim,
        exactClaimHeld: true,
        replacementIntentRecorded: true,
        currentClaimIdentity: allocatedClaimIdentity,
      },
    }
  }

  action observeExactReplacementClaim: bool = all {
    state.status == SafelySuspended,
    state.decision == ObserveReplacementClaim,
    state.claimState == ReplacementClaim,
    state' = {
      ...state,
      constraint: NoConstraint,
      decision: ContinueWork,
    },
  }

  action observeFreshLifecycleReopen: bool = all {
    state.status == SafelySuspended,
    state.decision == LifecycleWait,
    state' = {
      ...state,
      constraint: NoConstraint,
      decision: ContinueWork,
    },
  }

  action releaseExactClaim: bool = all {
    state.status == SafelySuspended,
    state.decision == ReleaseExactClaim,
    state.exactClaimHeld,
    state' = {
      ...state,
      decision: ExternalSuccessSettled,
      exactClaimHeld: false,
    },
  }

  action selectIndependentTask: bool = all {
    state.independentTaskEligible,
    state.constraint == MissingClaimConstraint
      or state.constraint == ForeignClaimConstraint
      or state.constraint == UnreadableClaimConstraint,
    state' = { ...state, independentTaskSelected: true },
  }

  // The recorded target is the ownership the claim actually has when the
  // mutation lands, not the ownership Dalph intended. The ownership guard is
  // what keeps the foreign case out of reach.
  action requestOwnedClaimMutation: bool = all {
    state.claimState == ExactClaim or state.claimState == ReplacementClaim,
    state' = {
      ...state,
      lastClaimMutationTarget:
        if (state.claimState == ForeignClaim) ForeignClaimMutation else OwnedClaimMutation,
    },
  }

  action step: bool = any {
    observeMembershipLoss,
    observeLifecycleClosure,
    observeSpecificationChange,
    observeExternalSuccess,
    observeIncompleteMembershipRead,
    observeMissingClaim,
    observeForeignClaim,
    observeUnreadableClaim,
    reportSafelySuspended,
    applyMissingClaimReacquisitionDirection,
    applyForeignClaimReacquisitionDirection,
    rejectForeignClaimReacquisition,
    planReplacementClaim,
    observeExactReplacementClaim,
    observeFreshLifecycleReopen,
    releaseExactClaim,
    selectIndependentTask,
    requestOwnedClaimMutation,
  }
}
