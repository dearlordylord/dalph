// Models issue #136's subject-local decisions after current tracker facts
// change while one exact planned attempt owns unfinished executor work.
module taskFactReconciliation {
  type Constraint =
    | NoConstraint
    | MembershipConstraint
    | LifecycleConstraint
    | SpecificationConstraint
    | ExternalSuccessConstraint

  type Decision =
    | ContinueWork
    | RequestSafeSuspension
    | MembershipWait
    | LifecycleWait
    | SpecificationChoices
    | ReleaseExactClaim
    | ExternalSuccessSettled

  type Status = Running | SafelySuspended

  type State = {
    status: Status,
    constraint: Constraint,
    decision: Decision,
    positionHeld: bool,
    exactClaimHeld: bool,
    wipPreserved: bool,
    dependantsReleasedByFreshGraph: bool,
    duplicateDeliveryPrevented: bool,
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

  val membershipWaitReached: bool = state.decision == MembershipWait
  val lifecycleWaitReached: bool = state.decision == LifecycleWait
  val specificationChoicesReached: bool = state.decision == SpecificationChoices
  val externalSuccessSettledReached: bool = state.decision == ExternalSuccessSettled

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
        else ReleaseExactClaim,
      positionHeld: false,
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

  action step: bool = any {
    observeMembershipLoss,
    observeLifecycleClosure,
    observeSpecificationChange,
    observeExternalSuccess,
    observeIncompleteMembershipRead,
    reportSafelySuspended,
    observeFreshLifecycleReopen,
    releaseExactClaim,
  }
}
