// Models issues #56, #57, and #59: ordinary accepted-result admission plus one
// fixed integration session that accepts only an explicit submitted commit
// whose ordered direct parents are [current target head, accepted result]. Its
// only issue-66 responsibility is the admission exception: Accepted arriving
// after an already committed Restart remains evidence and creates no
// integration responsibility. Replacement facts and P2 remain owned by
// taskFactReconciliation.
module acceptedResultIntegration {
  type Phase =
    | NoAcceptedResult
    | AcceptedResult
    | LateAcceptedEvidence
    | Queued
    | Started
    | DependencyWait
    | CandidatePending
    | CorrectionRequired
    | CandidateReady
    | CorrectionLimitReached
    | ContinuationLimitReached
    | CorrelationContradiction
    | CorrelationContradictionReleased
    | VerificationIntent
    | VerificationInvoked
    | VerificationResponseLost
    | VerificationReconciling
    | VerificationPassedPendingSeal
    | VerificationPassed
    | VerificationFailed
    | VerificationKilled
    | VerificationTimedOut
    | VerificationPartial
    | VerificationCorrelationContradiction
    | VerificationEvidenceFailure
    | PromotionPremise
    | PromotionIntent
    | PromotionAttemptIntended
    | PromotionInFlight
    | PromotionResponseLost
    | PromotionReconciliation
    | PromotionRetryReady
    | PromotionReadPending
    | PromotionSucceeded
    | PromotionStale
    | PromotionExhausted

  // The wrapper's terminal report is exhaustive. A passing report is kept
  // separate from its sealed evidence because the report alone cannot permit
  // promotion.
  type VerificationOutcome =
    | NoVerificationOutcome
    | Passed
    | Failed
    | Killed
    | TimedOut
    | Partial

  // Git observations are exact identities, not equivalent trees or patches.
  // An unreadable observation cannot establish either promotion or staleness.
  type PromotionGitObservation =
    | NoPromotionGitObservation
    | PromotionExactExpectedHead
    | PromotionCandidateCurrent
    | PromotionCandidateAncestor
    | PromotionOtherHead
    | PromotionUnreadableHead

  // This is the exact request Dalph derives from one constructed candidate.
  // `plan` is opaque to the model: it is fixed and carried through the public
  // wrapper, not selected by inspecting the target repository.
  type VerificationRequest = {
    requestId: int,
    acceptedResult: int,
    candidate: int,
    candidatePosition: int,
    integrationSession: int,
    target: int,
    plan: int,
  }

  type ResultState = {
    phase: Phase,
    // The applied Restart direction and the late Accepted report are separate
    // durable phenomena. The former must predate the latter to select the
    // evidence-only admission exception.
    restartChoiceCommittedBeforeTerminal: bool,
    acceptedEvidencePreserved: bool,
    integrationResponsibilityRecorded: bool,
    integrationResponsibilityCount: int,
    queuePosition: int,
    // The finite model gives both accepted results one target. Keeping the
    // locator explicit makes the queue guard target-scoped if another target
    // is added later.
    integrationTarget: int,
    preIntegrationCancellation: bool,
    targetHeld: bool,
    integrationSession: int,
    submittedCandidate: int,
    candidateJournalPosition: int,
    expectedTargetHead: int,
    acceptedResultCommit: int,
    observedFirstParent: int,
    observedSecondParent: int,
    correctionCount: int,
    continuationCount: int,
    verificationRequest: VerificationRequest,
    verificationOutcome: VerificationOutcome,
    verificationIntentRecorded: bool,
    // Counts underlying wrapper executions for V. A run-or-resume boundary
    // call made during reconciliation changes `reconciliationCount`, not this
    // execution count.
    wrapperInvocationCount: int,
    reconciliationCount: int,
    verificationEvidenceReread: bool,
    verificationManifestSealed: bool,
    promotionAuthorized: bool,
    verificationReplacementCount: int,
    // Promotion intent and attempt intents are journal facts. The count
    // survives a restart and counts durable attempt ordinals, never Git reads.
    promotionIntentRecorded: bool,
    promotionAttemptCount: int,
    promotionLastAttempt: int,
    promotionFreshExactHeadReads: int,
    promotionFreshExactHeadObservation: bool,
    promotionTargetFactsCurrent: bool,
    promotionExpectedHeadVerified: bool,
    promotionGitObservation: PromotionGitObservation,
    promotionObservedTargetHead: int,
    promotionCandidateAncestryProven: bool,
    promotionResultRecorded: bool,
    promotionResponseAmbiguous: bool,
    promotionCompareAndSetRequested: bool,
    promotionForceRequested: bool,
    promotionEquivalentContentAccepted: bool,
  }

  type State = {
    results: int -> ResultState,
    nextJournalPosition: int,
    recovered: bool,
    restartCount: int,
    trackerFactsCurrent: bool,
    targetFactsCurrent: bool,
    targetHeadProof: int,
    targetReacquisitionRequired: bool,
  }

  pure val RESULT_IDS = Set(1, 2)
  pure val CORRECTION_LIMIT = 1
  pure val CONTINUATION_LIMIT = 2
  pure val VERIFICATION_RESULT_ID = 1
  pure val VERIFICATION_PLAN = 7000
  pure val PROMOTION_ATTEMPT_LIMIT = 3
  // Finite model bounds for exploration; neither is a production policy.
  pure val RESTART_LIMIT = 2
  pure val RECONCILIATION_LIMIT = 2
  var state: State

  pure def sameIntegrationTarget(left: ResultState, right: ResultState): bool =
    left.integrationTarget == right.integrationTarget

  // A StartedIntegrationResponsibility remains a logical same-target blocker
  // until its later promotion/settlement protocol, even after its local lease
  // is released. The process-local `targetHeld` bit is intentionally absent
  // from this predicate.
  pure def logicalIntegrationBlockerPhase(phase: Phase): bool =
    Set(
      Started,
      DependencyWait,
      CandidatePending,
      CorrectionRequired,
      CandidateReady,
      CorrectionLimitReached,
      ContinuationLimitReached,
      CorrelationContradiction,
      CorrelationContradictionReleased,
      VerificationIntent,
      VerificationInvoked,
      VerificationResponseLost,
      VerificationReconciling,
      VerificationPassedPendingSeal,
      VerificationPassed,
      VerificationFailed,
      VerificationKilled,
      VerificationTimedOut,
      VerificationPartial,
      VerificationCorrelationContradiction,
      VerificationEvidenceFailure,
      PromotionPremise,
      PromotionIntent,
      PromotionAttemptIntended,
      PromotionInFlight,
      PromotionResponseLost,
      PromotionReconciliation,
      PromotionRetryReady,
      PromotionReadPending,
      PromotionSucceeded,
      PromotionStale,
      PromotionExhausted,
    ).contains(phase)

  pure def promotionProtocolPhase(phase: Phase): bool =
    Set(
      PromotionPremise,
      PromotionIntent,
      PromotionAttemptIntended,
      PromotionInFlight,
      PromotionResponseLost,
      PromotionReconciliation,
      PromotionRetryReady,
      PromotionReadPending,
      PromotionSucceeded,
      PromotionStale,
      PromotionExhausted,
    ).contains(phase)

  pure def promotionTerminalPhase(phase: Phase): bool =
    Set(
      PromotionSucceeded,
      PromotionStale,
      PromotionExhausted,
    ).contains(phase)

  // A fully settled promotion has no work that could consume fresh tracker or
  // target facts after restart. Keeping those global facts stable avoids
  // manufacturing a recovery obligation with no possible consumer.
  pure def restartRequiresFreshAuthorityFacts(s: State): bool =
    RESULT_IDS.exists(id => {
      val phase = s.results.get(id).phase
      phase != NoAcceptedResult
        and phase != LateAcceptedEvidence
        and not(promotionTerminalPhase(phase))
    })

  pure def canStart(s: State, id: int): bool = {
    val result = s.results.get(id)
    and {
      result.phase == Queued,
      s.trackerFactsCurrent,
      s.targetFactsCurrent,
      not(RESULT_IDS.exists(other =>
        other != id
          and sameIntegrationTarget(s.results.get(other), result)
          and s.results.get(other).targetHeld
      )),
      not(RESULT_IDS.exists(other =>
        other != id
          and sameIntegrationTarget(s.results.get(other), result)
          and s.results.get(other).queuePosition < result.queuePosition
          and logicalIntegrationBlockerPhase(s.results.get(other).phase)
      )),
      not(RESULT_IDS.exists(other =>
        other != id
          and sameIntegrationTarget(s.results.get(other), result)
          and s.results.get(other).phase == Queued
          and s.results.get(other).queuePosition < result.queuePosition
      )),
    }
  }

  val acceptedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == AcceptedResult)

  val restartCommittedBeforeAcceptedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).restartChoiceCommittedBeforeTerminal)

  val lateAcceptedEvidenceReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == LateAcceptedEvidence)

  val queuedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == Queued)

  val startedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == Started)

  val dependencyWaitReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == DependencyWait)

  val restartReached: bool = state.recovered

  val targetHeadProofReached: bool =
    state.targetFactsCurrent and state.targetHeadProof != 0

  val candidateReadyReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == CandidateReady)

  val correctionRequiredReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == CorrectionRequired)

  val correctionLimitReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == CorrectionLimitReached)

  val continuationLimitReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == ContinuationLimitReached)

  val correlationContradictionReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == CorrelationContradiction)

  val correlationContradictionReleasedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == CorrelationContradictionReleased)

  val verificationIntentReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == VerificationIntent)

  val verificationInvokedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == VerificationInvoked)

  val verificationResponseLostReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == VerificationResponseLost)

  val verificationReconcilingReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == VerificationReconciling)

  val verificationPassedPendingSealReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == VerificationPassedPendingSeal)

  val verificationPassedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == VerificationPassed)

  val verificationFailedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == VerificationFailed)

  val verificationKilledReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == VerificationKilled)

  val verificationTimedOutReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == VerificationTimedOut)

  val verificationPartialReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == VerificationPartial)

  val verificationCorrelationContradictionReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == VerificationCorrelationContradiction)

  val verificationEvidenceFailureReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == VerificationEvidenceFailure)

  val promotionPremiseReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == PromotionPremise)

  val promotionIntentReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == PromotionIntent)

  val promotionAttemptIntendedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == PromotionAttemptIntended)

  val promotionInFlightReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == PromotionInFlight)

  val promotionResponseLostReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == PromotionResponseLost)

  val promotionReconciliationReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == PromotionReconciliation)

  val promotionRetryReadyReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == PromotionRetryReady)

  val promotionReadPendingReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == PromotionReadPending)

  val promotionSucceededReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == PromotionSucceeded)

  val promotionStaleReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == PromotionStale)

  val promotionExhaustedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == PromotionExhausted)

  val releasedLogicalBlockerReached: bool =
    RESULT_IDS.exists(id =>
      Set(
        CorrectionLimitReached,
        ContinuationLimitReached,
        CorrelationContradictionReleased,
        VerificationPassed,
        PromotionPremise,
        PromotionIntent,
        PromotionAttemptIntended,
        PromotionInFlight,
        PromotionResponseLost,
        PromotionReconciliation,
        PromotionRetryReady,
        PromotionReadPending,
        PromotionSucceeded,
        PromotionStale,
        PromotionExhausted,
      ).contains(state.results.get(id).phase)
        and not(state.results.get(id).targetHeld)
    )

  val dependencyWaitReleasedTarget: bool =
    state.results.get(1).phase == DependencyWait
      and not(state.results.get(1).targetHeld)

  val cancellationExactlyQueued: bool =
    RESULT_IDS.forall(id =>
      state.results.get(id).preIntegrationCancellation
        == (state.results.get(id).phase == Queued)
    )

  // Every ordinary phase after AcceptedResult is backed by one and only one
  // integration responsibility. The late-Restart evidence phase is excluded
  // explicitly instead of being smuggled into the ordinary queue predicate.
  val ordinaryAcceptedAdmissionRecordsOneResponsibility: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      if (Set(NoAcceptedResult, AcceptedResult, LateAcceptedEvidence).contains(result.phase))
        and {
          not(result.integrationResponsibilityRecorded),
          result.integrationResponsibilityCount == 0,
        }
      else
        and {
          result.acceptedEvidencePreserved,
          not(result.restartChoiceCommittedBeforeTerminal),
          result.integrationResponsibilityRecorded,
          result.integrationResponsibilityCount == 1,
          result.queuePosition > 0,
        }
    })

  val acceptedEvidenceIsNeverDiscarded: bool =
    RESULT_IDS.forall(id =>
      state.results.get(id).phase == NoAcceptedResult
        or state.results.get(id).acceptedEvidencePreserved
    )

  // This invariant deliberately restates the late-admission exclusion rather
  // than sharing queueAcceptedResult's guard. Removing the guard makes it red.
  val lateAcceptedAfterRestartNeverCreatesIntegrationResponsibility: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(
        result.restartChoiceCommittedBeforeTerminal
          and result.acceptedEvidencePreserved
      ) or and {
        result.phase == LateAcceptedEvidence,
        result.restartChoiceCommittedBeforeTerminal,
        result.acceptedEvidencePreserved,
        not(result.integrationResponsibilityRecorded),
        result.integrationResponsibilityCount == 0,
        result.queuePosition == 0,
        not(result.preIntegrationCancellation),
        not(result.targetHeld),
        result.integrationSession == 0,
      }
    })

  val queuePositionsAreUnique: bool =
    RESULT_IDS.forall(left =>
      RESULT_IDS.forall(right =>
        left == right
          or state.results.get(left).queuePosition == 0
          or state.results.get(right).queuePosition == 0
          or state.results.get(left).queuePosition != state.results.get(right).queuePosition
      )
    )

  val targetHeldOnlyForActiveIntegration: bool =
    RESULT_IDS.forall(id =>
      state.results.get(id).targetHeld implies
        Set(
          Started,
          CandidatePending,
          CorrectionRequired,
          CandidateReady,
          CorrelationContradiction,
          VerificationIntent,
          VerificationInvoked,
          VerificationResponseLost,
          VerificationReconciling,
          VerificationPassedPendingSeal,
          PromotionIntent,
          PromotionAttemptIntended,
          PromotionInFlight,
          PromotionReconciliation,
          PromotionRetryReady,
        ).contains(state.results.get(id).phase)
    )

  val candidateReadyHasExactOrderedParents: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(Set(
        CandidateReady,
        VerificationIntent,
        VerificationInvoked,
        VerificationResponseLost,
        VerificationReconciling,
        VerificationPassedPendingSeal,
        VerificationPassed,
        VerificationFailed,
        VerificationKilled,
        VerificationTimedOut,
        VerificationPartial,
        VerificationCorrelationContradiction,
        VerificationEvidenceFailure,
        PromotionPremise,
        PromotionIntent,
        PromotionAttemptIntended,
        PromotionInFlight,
        PromotionResponseLost,
        PromotionReconciliation,
        PromotionRetryReady,
        PromotionReadPending,
        PromotionSucceeded,
        PromotionStale,
        PromotionExhausted,
      ).contains(result.phase))
        or and {
          result.submittedCandidate != 0,
          result.observedFirstParent == result.expectedTargetHead,
          result.observedSecondParent == result.acceptedResultCommit,
        }
    })

  val sessionIdentityFixedAfterStart: bool =
    RESULT_IDS.forall(id =>
      Set(
        Started,
        CandidatePending,
        CorrectionRequired,
        CandidateReady,
        CorrectionLimitReached,
        ContinuationLimitReached,
        CorrelationContradiction,
        CorrelationContradictionReleased,
        VerificationIntent,
        VerificationInvoked,
        VerificationResponseLost,
        VerificationReconciling,
        VerificationPassedPendingSeal,
        VerificationPassed,
        VerificationFailed,
        VerificationKilled,
        VerificationTimedOut,
        VerificationPartial,
        VerificationCorrelationContradiction,
        VerificationEvidenceFailure,
        PromotionPremise,
        PromotionIntent,
        PromotionAttemptIntended,
        PromotionInFlight,
        PromotionResponseLost,
        PromotionReconciliation,
        PromotionRetryReady,
        PromotionReadPending,
        PromotionSucceeded,
        PromotionStale,
        PromotionExhausted,
      ).contains(state.results.get(id).phase)
        implies state.results.get(id).integrationSession == id
    )

  val atMostOneTargetHolder: bool =
    RESULT_IDS.forall(left =>
      RESULT_IDS.forall(right =>
        left == right
          or state.results.get(left).integrationTarget != state.results.get(right).integrationTarget
          or not(
            state.results.get(left).targetHeld
              and state.results.get(right).targetHeld
          )
      )
    )

  val startedPrecedesRemainingQueue: bool =
    RESULT_IDS.forall(started =>
      RESULT_IDS.forall(queued =>
        state.results.get(started).phase != Started
          or state.results.get(queued).phase != Queued
          or state.results.get(started).integrationTarget
            != state.results.get(queued).integrationTarget
          or state.results.get(started).queuePosition < state.results.get(queued).queuePosition
      )
    )

  val dependencyWaitPreservesQueueOrder: bool =
    RESULT_IDS.forall(waiting =>
      RESULT_IDS.forall(queued =>
        state.results.get(waiting).phase != DependencyWait
          or state.results.get(queued).phase != Queued
          or state.results.get(waiting).integrationTarget
            != state.results.get(queued).integrationTarget
          or state.results.get(waiting).queuePosition < state.results.get(queued).queuePosition
      )
    )

  // The request keeps every identity fixed from the candidate occurrence
  // through wrapper invocation, reconciliation, and terminal evidence.
  val verificationRequestIdentityIsStable: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      Set(
        VerificationIntent,
        VerificationInvoked,
        VerificationResponseLost,
        VerificationReconciling,
        VerificationPassedPendingSeal,
          VerificationPassed,
          VerificationFailed,
          VerificationKilled,
          VerificationTimedOut,
          VerificationPartial,
          VerificationCorrelationContradiction,
          VerificationEvidenceFailure,
          PromotionPremise,
          PromotionIntent,
          PromotionAttemptIntended,
          PromotionInFlight,
          PromotionResponseLost,
          PromotionReconciliation,
          PromotionRetryReady,
          PromotionReadPending,
          PromotionSucceeded,
          PromotionStale,
          PromotionExhausted,
      ).contains(result.phase) implies and {
        result.verificationIntentRecorded,
        result.verificationRequest.requestId == id * 1000 + result.submittedCandidate,
        result.verificationRequest.acceptedResult == result.acceptedResultCommit,
        result.verificationRequest.candidate == result.submittedCandidate,
        result.verificationRequest.candidatePosition == result.candidateJournalPosition,
        result.verificationRequest.integrationSession == result.integrationSession,
        result.verificationRequest.target == result.integrationTarget,
        result.verificationRequest.plan == VERIFICATION_PLAN + id,
      }
    })

  // A wrapper call is possible only after the durable intent, and one lost
  // response is reconciled against that same request rather than invoked as a
  // replacement.
  val verificationIntentPrecedesWrapper: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      Set(
        VerificationInvoked,
        VerificationResponseLost,
        VerificationReconciling,
        VerificationPassedPendingSeal,
        VerificationPassed,
        VerificationFailed,
        VerificationKilled,
        VerificationTimedOut,
        VerificationPartial,
        VerificationCorrelationContradiction,
        VerificationEvidenceFailure,
        PromotionPremise,
        PromotionIntent,
        PromotionAttemptIntended,
        PromotionInFlight,
        PromotionResponseLost,
        PromotionReconciliation,
        PromotionRetryReady,
        PromotionReadPending,
        PromotionSucceeded,
        PromotionStale,
        PromotionExhausted,
      ).contains(result.phase) implies and {
        result.verificationIntentRecorded,
        result.wrapperInvocationCount == 1,
      }
    })

  val verificationInvocationAndReconciliationAreBounded: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      and {
        result.wrapperInvocationCount >= 0,
        result.wrapperInvocationCount <= 1,
        result.reconciliationCount >= 0,
        result.reconciliationCount <= RECONCILIATION_LIMIT,
      }
    })

  // Restart clears the process-local position, so an active logical phase may
  // be temporarily unheld only after recovery. Before recovery, every active
  // verification phase retains the position it needs for the wrapper call.
  val activeVerificationRetainsTargetUnlessRestarted: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      state.targetReacquisitionRequired
        or not(Set(
          VerificationIntent,
          VerificationInvoked,
          VerificationResponseLost,
          VerificationReconciling,
          VerificationPassedPendingSeal,
        ).contains(result.phase))
        or result.targetHeld
    })

  val terminalVerificationReleasesTarget: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(Set(
        VerificationPassed,
        VerificationFailed,
        VerificationKilled,
        VerificationTimedOut,
        VerificationPartial,
        VerificationCorrelationContradiction,
        VerificationEvidenceFailure,
        PromotionPremise,
      ).contains(result.phase)) or not(result.targetHeld)
    })

  val verificationOutcomeMatchesPhase: bool =
    RESULT_IDS.forall(id => match state.results.get(id).phase {
      | VerificationPassedPendingSeal => state.results.get(id).verificationOutcome == Passed
      | VerificationPassed => state.results.get(id).verificationOutcome == Passed
      | VerificationFailed => state.results.get(id).verificationOutcome == Failed
      | VerificationKilled => state.results.get(id).verificationOutcome == Killed
      | VerificationTimedOut => state.results.get(id).verificationOutcome == TimedOut
      | VerificationPartial => state.results.get(id).verificationOutcome == Partial
      | _ => true
    })

  // A passing wrapper response becomes promotion evidence only after all
  // referenced objects and manifest bytes have been reread and sealed.
  val onlySealedPassedAuthorizesPromotion: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(result.promotionAuthorized) or and {
        result.verificationOutcome == Passed,
        result.verificationEvidenceReread,
        result.verificationManifestSealed,
        Set(
          VerificationPassed,
          PromotionPremise,
          PromotionIntent,
          PromotionAttemptIntended,
          PromotionInFlight,
          PromotionResponseLost,
          PromotionReconciliation,
          PromotionRetryReady,
          PromotionReadPending,
          PromotionSucceeded,
          PromotionStale,
          PromotionExhausted,
        ).contains(result.phase),
      }
    })

  val promotionPremiseRequiresSealedPassedEvidence: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      result.phase != PromotionPremise or and {
        result.verificationOutcome == Passed,
        result.verificationEvidenceReread,
        result.verificationManifestSealed,
        result.promotionAuthorized,
      }
    })

  val diagnosticOutcomesNeverAuthorizePromotion: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(Set(
        VerificationFailed,
        VerificationKilled,
        VerificationTimedOut,
        VerificationPartial,
      ).contains(result.phase)) or and {
        result.verificationOutcome != Passed,
        not(result.promotionAuthorized),
        not(result.phase == PromotionPremise),
      }
    })

  val contradictoryVerificationNeverAuthorizesPromotion: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(Set(
        VerificationCorrelationContradiction,
        VerificationEvidenceFailure,
      ).contains(result.phase)) or and {
        result.verificationOutcome == NoVerificationOutcome,
        not(result.verificationEvidenceReread),
        not(result.verificationManifestSealed),
        not(result.promotionAuthorized),
        not(result.phase == PromotionPremise),
        not(result.targetHeld),
      }
    })

  // Every earlier same-target started responsibility, including one whose
  // process-local lease was released, leaves a later queue position Queued.
  // This restates the full blocker set independently of `canStart`.
  val logicalIntegrationResponsibilityBlocksLaterQueue: bool =
    RESULT_IDS.forall(blocker =>
      RESULT_IDS.forall(later =>
        blocker == later
          or not(
            state.results.get(blocker).integrationTarget
              == state.results.get(later).integrationTarget
              and Set(
                Started,
                DependencyWait,
                CandidatePending,
                CorrectionRequired,
                CandidateReady,
                CorrectionLimitReached,
                ContinuationLimitReached,
                CorrelationContradiction,
                CorrelationContradictionReleased,
                VerificationIntent,
                VerificationInvoked,
                VerificationResponseLost,
                VerificationReconciling,
                VerificationPassedPendingSeal,
                VerificationPassed,
                VerificationFailed,
                VerificationKilled,
                VerificationTimedOut,
                VerificationPartial,
                VerificationCorrelationContradiction,
                VerificationEvidenceFailure,
                PromotionPremise,
                PromotionIntent,
                PromotionAttemptIntended,
                PromotionInFlight,
                PromotionResponseLost,
                PromotionReconciliation,
                PromotionRetryReady,
                PromotionReadPending,
                PromotionSucceeded,
                PromotionStale,
                PromotionExhausted,
              ).contains(state.results.get(blocker).phase)
            and state.results.get(later).queuePosition > state.results.get(blocker).queuePosition)
          or state.results.get(later).phase == Queued
      )
    )

  val noAutomaticVerificationReplacement: bool =
    RESULT_IDS.forall(id => state.results.get(id).verificationReplacementCount == 0)

  val restartCountBounded: bool =
    state.restartCount >= 0 and state.restartCount <= RESTART_LIMIT

  val staleTargetProofIsNeverCurrent: bool =
    state.targetFactsCurrent or state.targetHeadProof == 0

  val reacquiredVerificationUsesFreshExpectedHead: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(
        state.targetReacquisitionRequired
          and result.targetHeld
          and Set(
            CandidateReady,
            VerificationIntent,
            VerificationInvoked,
            VerificationResponseLost,
            VerificationReconciling,
            VerificationPassedPendingSeal,
          ).contains(result.phase)
      ) or and {
        state.targetFactsCurrent,
        state.targetHeadProof == result.expectedTargetHead,
      }
    })

  // Promotion attempt intents are durable before possibly ambiguous Git
  // requests; one verified candidate can consume at most three ordinals.
  val promotionAttemptsAreBounded: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      and {
        result.promotionAttemptCount >= 0,
        result.promotionAttemptCount <= PROMOTION_ATTEMPT_LIMIT,
        result.promotionLastAttempt >= 0,
        result.promotionLastAttempt <= PROMOTION_ATTEMPT_LIMIT,
        result.promotionLastAttempt == result.promotionAttemptCount,
      }
    })

  // After an ambiguous response, a later request is permitted only after a
  // complete fresh observation proves the exact expected H. A current M,
  // M-containing head, stale head, or unreadable result never authorizes a
  // retry.
  val ambiguousPromotionRequiresFreshObservation: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(result.promotionResponseAmbiguous)
        or result.promotionAttemptCount <= result.promotionFreshExactHeadReads
    })

  val promotionIntentPrecedesCompareAndSet: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(result.promotionCompareAndSetRequested) or and {
        result.promotionIntentRecorded,
        result.promotionAttemptCount > 0,
        result.promotionAttemptCount == result.promotionLastAttempt,
      }
    })

  // The exact candidate occurrence, ordered parents, and sealed passing
  // manifest remain bound to every promotion boundary and result.
  val promotionUsesExactSealedCandidate: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(promotionProtocolPhase(result.phase)) or and {
        result.submittedCandidate != 0,
        result.observedFirstParent == result.expectedTargetHead,
        result.observedSecondParent == result.acceptedResultCommit,
        result.verificationOutcome == Passed,
        result.verificationEvidenceReread,
        result.verificationManifestSealed,
        result.promotionAuthorized,
      }
    })

  val promotionCompareAndSetRequiresExactHead: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(result.promotionCompareAndSetRequested) or and {
        result.promotionAttemptCount <= PROMOTION_ATTEMPT_LIMIT,
        result.promotionExpectedHeadVerified,
        result.phase != PromotionInFlight
          or result.promotionTargetFactsCurrent,
        result.submittedCandidate != 0,
        result.observedFirstParent == result.expectedTargetHead,
        result.observedSecondParent == result.acceptedResultCommit,
        result.verificationEvidenceReread,
        result.verificationManifestSealed,
        not(result.promotionForceRequested),
        not(result.promotionEquivalentContentAccepted),
      }
    })

  val promotionSuccessRequiresExactAncestryAndEvidence: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      result.phase != PromotionSucceeded or and {
        result.promotionResultRecorded,
        result.promotionCandidateAncestryProven,
        result.verificationOutcome == Passed,
        result.verificationEvidenceReread,
        result.verificationManifestSealed,
        result.promotionAuthorized,
        Set(
          PromotionCandidateCurrent,
          PromotionCandidateAncestor,
        ).contains(result.promotionGitObservation),
        result.promotionObservedTargetHead == result.submittedCandidate
          or result.promotionGitObservation == PromotionCandidateAncestor,
        not(result.promotionForceRequested),
        not(result.promotionEquivalentContentAccepted),
        not(result.targetHeld),
      }
    })

  val stalePromotionPreservesCandidateAndNeverOverwrites: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      result.phase != PromotionStale or and {
        result.promotionResultRecorded,
        result.promotionGitObservation == PromotionOtherHead,
        result.promotionObservedTargetHead != result.submittedCandidate,
        not(result.promotionCandidateAncestryProven),
        result.submittedCandidate != 0,
        result.verificationEvidenceReread,
        result.verificationManifestSealed,
        not(result.promotionForceRequested),
        not(result.promotionEquivalentContentAccepted),
        not(result.targetHeld),
      }
    })

  // A missing or unreadable Git response leaves the durable intent pending;
  // it cannot be interpreted as either absence of M or a stale target.
  val unreadablePromotionStaysPending: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      result.phase != PromotionReadPending or and {
        result.promotionIntentRecorded,
        result.promotionGitObservation == PromotionUnreadableHead,
        not(result.promotionResultRecorded),
        not(result.promotionCandidateAncestryProven),
        result.submittedCandidate != 0,
        result.verificationEvidenceReread,
        result.verificationManifestSealed,
        not(result.promotionForceRequested),
        not(result.promotionEquivalentContentAccepted),
        not(result.targetHeld),
      }
    })

  val promotionExhaustionPreservesVerifiedCandidate: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      result.phase != PromotionExhausted or and {
        result.promotionAttemptCount == PROMOTION_ATTEMPT_LIMIT,
        result.promotionIntentRecorded,
        result.submittedCandidate != 0,
        result.observedFirstParent == result.expectedTargetHead,
        result.observedSecondParent == result.acceptedResultCommit,
        result.verificationOutcome == Passed,
        result.verificationEvidenceReread,
        result.verificationManifestSealed,
        result.promotionAuthorized,
        Set(
          NoPromotionGitObservation,
          PromotionExactExpectedHead,
          PromotionUnreadableHead,
        ).contains(result.promotionGitObservation),
        not(result.promotionResultRecorded),
        not(result.promotionCandidateAncestryProven),
        not(result.promotionForceRequested),
        not(result.promotionEquivalentContentAccepted),
        not(result.targetHeld),
      }
    })

  val promotionTerminalReleasesTarget: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(Set(
        PromotionSucceeded,
        PromotionStale,
        PromotionReadPending,
        PromotionExhausted,
      ).contains(result.phase)) or not(result.targetHeld)
    })

  val promotionFreshObservationIsExactExpectedHead: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(result.promotionFreshExactHeadObservation) or and {
        result.promotionGitObservation == PromotionExactExpectedHead,
        result.promotionObservedTargetHead == result.expectedTargetHead,
      }
    })

  val promotionNoForceOrEquivalentShortcut: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      and {
        not(result.promotionForceRequested),
        not(result.promotionEquivalentContentAccepted),
      }
    })

  // Attempts one, two, and three need one, two, and three fresh H reads. The
  // relation is historical through durable counters, so it survives restart
  // even when the current phase is no longer the read that authorized it.
  val promotionRetryOrdinalsHaveFreshHeadReads: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      result.promotionFreshExactHeadReads >= result.promotionAttemptCount
    })

  action init: bool = all {
    state' = {
      results: RESULT_IDS.mapBy(id => {
        phase: NoAcceptedResult,
        restartChoiceCommittedBeforeTerminal: false,
        acceptedEvidencePreserved: false,
        integrationResponsibilityRecorded: false,
        integrationResponsibilityCount: 0,
        queuePosition: 0,
        integrationTarget: 1,
        preIntegrationCancellation: false,
        targetHeld: false,
        integrationSession: 0,
        submittedCandidate: 0,
        candidateJournalPosition: 0,
        expectedTargetHead: 0,
        acceptedResultCommit: id + 20,
        observedFirstParent: 0,
        observedSecondParent: 0,
        correctionCount: 0,
        continuationCount: 0,
        verificationRequest: {
          requestId: 0,
          acceptedResult: 0,
          candidate: 0,
          candidatePosition: 0,
          integrationSession: 0,
          target: 0,
          plan: 0,
        },
        verificationOutcome: NoVerificationOutcome,
        verificationIntentRecorded: false,
        wrapperInvocationCount: 0,
        reconciliationCount: 0,
        verificationEvidenceReread: false,
        verificationManifestSealed: false,
        promotionAuthorized: false,
        verificationReplacementCount: 0,
        promotionIntentRecorded: false,
        promotionAttemptCount: 0,
        promotionLastAttempt: 0,
        promotionFreshExactHeadReads: 0,
        promotionFreshExactHeadObservation: false,
        promotionTargetFactsCurrent: false,
        promotionExpectedHeadVerified: false,
        promotionGitObservation: NoPromotionGitObservation,
        promotionObservedTargetHead: 0,
        promotionCandidateAncestryProven: false,
        promotionResultRecorded: false,
        promotionResponseAmbiguous: false,
        promotionCompareAndSetRequested: false,
        promotionForceRequested: false,
        promotionEquivalentContentAccepted: false,
      }),
      nextJournalPosition: 1,
      recovered: false,
      restartCount: 0,
      trackerFactsCurrent: true,
      targetFactsCurrent: true,
      targetHeadProof: 0,
      targetReacquisitionRequired: false,
    }
  }

  // taskFactReconciliation owns choice identity and replacement. This action
  // carries only the exact chronological fact needed by issue #56 admission:
  // result one has an applied Restart before its terminal report arrives.
  action observeAppliedRestartBeforeAccepted(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == 1,
      result.phase == NoAcceptedResult,
      not(result.restartChoiceCommittedBeforeTerminal),
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          restartChoiceCommittedBeforeTerminal: true,
        }),
      },
    }
  }

  action acceptResult(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == NoAcceptedResult,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase:
            if (result.restartChoiceCommittedBeforeTerminal)
              LateAcceptedEvidence
            else
              AcceptedResult,
          acceptedEvidencePreserved: true,
        }),
      },
    }
  }

  action queueAcceptedResult(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == AcceptedResult,
      not(result.restartChoiceCommittedBeforeTerminal),
      result.acceptedEvidencePreserved,
      not(result.integrationResponsibilityRecorded),
      result.integrationResponsibilityCount == 0,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: Queued,
          integrationResponsibilityRecorded: true,
          integrationResponsibilityCount: 1,
          queuePosition: state.nextJournalPosition,
          preIntegrationCancellation: true,
        }),
        nextJournalPosition: state.nextJournalPosition + 1,
      },
    }
  }

  action startIntegration(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      canStart(state, id),
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: Started,
          preIntegrationCancellation: false,
          targetHeld: true,
          integrationSession: id,
          expectedTargetHead: id + 10,
        }),
        targetHeadProof: id + 10,
        targetReacquisitionRequired:
          RESULT_IDS.exists(other =>
            other != id
              and not(state.results.get(other).targetHeld)
              and Set(
                Started,
                CandidatePending,
                CorrectionRequired,
                CandidateReady,
                VerificationIntent,
                VerificationInvoked,
                VerificationResponseLost,
                VerificationReconciling,
                VerificationPassedPendingSeal,
                PromotionIntent,
              ).contains(state.results.get(other).phase)
          ),
      },
    }
  }

  action submitCandidate(id: int, candidate: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      Set(Started, CorrectionRequired).contains(result.phase),
      result.targetHeld,
      candidate != 0,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: CandidatePending,
          submittedCandidate: candidate,
          candidateJournalPosition: 0,
          observedFirstParent: 0,
          observedSecondParent: 0,
        }),
      },
    }
  }

  // Conflict, working, and exited-without-candidate reports may continue the
  // same session only up to its durable automatic-continuation limit.
  action reportWithoutCandidate(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      Set(Started, CorrectionRequired).contains(result.phase),
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(id,
          if (result.continuationCount + 1 >= CONTINUATION_LIMIT) {
            ...result,
            phase: ContinuationLimitReached,
            targetHeld: false,
            continuationCount: result.continuationCount + 1,
          } else {
            ...result,
            continuationCount: result.continuationCount + 1,
          }
        ),
      },
    }
  }

  // A report for another session stops this operation before any Git read. The
  // exact external correlation is exercised by the TypeScript protocol and
  // cassette adapter; this model retains the fixed session and existing work.
  action reportForeignCorrelation(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      Set(Started, CorrectionRequired).contains(result.phase),
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: CorrelationContradiction,
          targetHeld: true,
        }),
      },
    }
  }

  action releaseForeignCorrelationTarget(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == CorrelationContradiction,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: CorrelationContradictionReleased,
          targetHeld: false,
        }),
      },
    }
  }

  action observeExactCandidate(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == CandidatePending,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: CandidateReady,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          candidateJournalPosition: state.nextJournalPosition,
        }),
        nextJournalPosition: state.nextJournalPosition + 1,
      },
    }
  }

  // The request identity is derived once from the exact candidate occurrence.
  // Its request number and opaque plan are deterministic, so a retry can only
  // reuse this request rather than silently selecting a new verification.
  action recordVerificationIntent(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      result.phase == CandidateReady,
      result.targetHeld,
      result.submittedCandidate != 0,
      result.candidateJournalPosition != 0,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: VerificationIntent,
          verificationRequest: {
            requestId: id * 1000 + result.submittedCandidate,
            acceptedResult: result.acceptedResultCommit,
            candidate: result.submittedCandidate,
            candidatePosition: result.candidateJournalPosition,
            integrationSession: result.integrationSession,
            target: result.integrationTarget,
            plan: VERIFICATION_PLAN + id,
          },
          verificationOutcome: NoVerificationOutcome,
          verificationIntentRecorded: true,
          wrapperInvocationCount: 0,
          reconciliationCount: 0,
          verificationEvidenceReread: false,
          verificationManifestSealed: false,
          promotionAuthorized: false,
        }),
      },
    }
  }

  // One public wrapper invocation owns waiting for and releasing its heavy
  // verification lock. Dalph models only this boundary call, never that lock.
  action invokeVerification(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      result.phase == VerificationIntent,
      result.targetHeld,
      result.verificationIntentRecorded,
      result.wrapperInvocationCount == 0,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: VerificationInvoked,
          wrapperInvocationCount: 1,
        }),
      },
    }
  }

  // The wrapper may complete while Dalph loses its response. This records an
  // unresolved invocation; it does not allocate or invoke a replacement.
  action loseVerificationResponse(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      result.phase == VerificationInvoked,
      result.targetHeld,
      result.wrapperInvocationCount == 1,
      state' = {
        ...state,
        results: state.results.put(id, { ...result, phase: VerificationResponseLost }),
      },
    }
  }

  // Reconciliation asks the wrapper about the same request. Repeated bounded
  // run-or-resume boundary calls remain reconciliation calls and do not create
  // another underlying wrapper execution.
  action reconcileVerification(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      Set(VerificationResponseLost, VerificationReconciling).contains(result.phase),
      result.targetHeld,
      result.verificationIntentRecorded,
      result.wrapperInvocationCount == 1,
      result.reconciliationCount < RECONCILIATION_LIMIT,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: VerificationReconciling,
          reconciliationCount: result.reconciliationCount + 1,
        }),
      },
    }
  }

  action reportVerificationPassed(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      Set(VerificationInvoked, VerificationReconciling).contains(result.phase),
      result.targetHeld,
      result.verificationIntentRecorded,
      result.wrapperInvocationCount == 1,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: VerificationPassedPendingSeal,
          verificationOutcome: Passed,
          verificationEvidenceReread: false,
          verificationManifestSealed: false,
          promotionAuthorized: false,
        }),
      },
    }
  }

  // A passing wrapper report is not promotion evidence until Dalph rereads
  // every referenced object and the manifest bytes and seals those identities.
  action rereadAndSealPassedVerification(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      result.phase == VerificationPassedPendingSeal,
      result.targetHeld,
      result.verificationOutcome == Passed,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: VerificationPassed,
          verificationEvidenceReread: true,
          verificationManifestSealed: true,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  pure def recordDiagnosticOutcome(
    s: State,
    id: int,
    phase: Phase,
    outcome: VerificationOutcome,
  ): State = {
    val result = s.results.get(id)
    {
      ...s,
      results: s.results.put(id, {
        ...result,
        phase: phase,
        verificationOutcome: outcome,
        verificationEvidenceReread: true,
        verificationManifestSealed: true,
        promotionAuthorized: false,
        targetHeld: false,
      }),
    }
  }

  action reportVerificationFailed(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      Set(VerificationInvoked, VerificationReconciling).contains(result.phase),
      result.targetHeld,
      state' = recordDiagnosticOutcome(state, id, VerificationFailed, Failed),
    }
  }

  action reportVerificationKilled(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      Set(VerificationInvoked, VerificationReconciling).contains(result.phase),
      result.targetHeld,
      state' = recordDiagnosticOutcome(state, id, VerificationKilled, Killed),
    }
  }

  action reportVerificationTimedOut(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      Set(VerificationInvoked, VerificationReconciling).contains(result.phase),
      result.targetHeld,
      state' = recordDiagnosticOutcome(state, id, VerificationTimedOut, TimedOut),
    }
  }

  action reportVerificationPartial(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      Set(VerificationInvoked, VerificationReconciling).contains(result.phase),
      result.targetHeld,
      state' = recordDiagnosticOutcome(state, id, VerificationPartial, Partial),
    }
  }

  pure def recordVerificationBoundaryFailure(
    s: State,
    id: int,
    phase: Phase,
  ): State = {
    val result = s.results.get(id)
    {
      ...s,
      results: s.results.put(id, {
        ...result,
        phase: phase,
        verificationOutcome: NoVerificationOutcome,
        verificationEvidenceReread: false,
        verificationManifestSealed: false,
        promotionAuthorized: false,
        targetHeld: false,
      }),
    }
  }

  // A foreign request/candidate correlation is rejected before any evidence
  // can authorize promotion; the exact request and candidate history remain.
  action reportVerificationCorrelationContradiction(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      Set(VerificationInvoked, VerificationReconciling).contains(result.phase),
      result.targetHeld,
      state' = recordVerificationBoundaryFailure(
        state,
        id,
        VerificationCorrelationContradiction,
      ),
    }
  }

  // Missing, corrupt, or foreign manifest/object bytes are a typed evidence
  // failure, not a success-shaped result and not a replacement request.
  action reportVerificationEvidenceFailure(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      Set(VerificationInvoked, VerificationReconciling).contains(result.phase),
      result.targetHeld,
      state' = recordVerificationBoundaryFailure(
        state,
        id,
        VerificationEvidenceFailure,
      ),
    }
  }

  // #59 stops after the exact verification result. This action is only the
  // later premise consumed by #60; it does not mutate a target ref.
  action offerPromotionPremise(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      result.phase == VerificationPassed,
      result.verificationOutcome == Passed,
      result.verificationEvidenceReread,
      result.verificationManifestSealed,
      result.promotionAuthorized,
      not(result.targetHeld),
      state' = {
        ...state,
        results: state.results.put(id, { ...result, phase: PromotionPremise }),
      },
    }
  }

  // The exact candidate, expected H, target, and sealed manifest are recorded
  // before any compare-and-set boundary call. Reusing this intent is the only
  // way to issue a later numbered request.
  action recordPromotionIntent(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      result.phase == PromotionPremise,
      not(result.targetHeld),
      result.promotionAuthorized,
      result.verificationOutcome == Passed,
      result.verificationEvidenceReread,
      result.verificationManifestSealed,
      result.submittedCandidate != 0,
      result.observedFirstParent == result.expectedTargetHead,
      result.observedSecondParent == result.acceptedResultCommit,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: PromotionIntent,
          targetHeld: true,
          promotionIntentRecorded: true,
          promotionAttemptCount: 0,
          promotionLastAttempt: 0,
          promotionFreshExactHeadReads: 0,
          promotionFreshExactHeadObservation: false,
          promotionTargetFactsCurrent: false,
          promotionExpectedHeadVerified: true,
          promotionGitObservation: NoPromotionGitObservation,
          promotionObservedTargetHead: 0,
          promotionCandidateAncestryProven: false,
          promotionResultRecorded: false,
          promotionResponseAmbiguous: false,
          promotionCompareAndSetRequested: false,
          promotionForceRequested: false,
          promotionEquivalentContentAccepted: false,
        }),
      },
    }
  }

  pure def canRecordPromotionAttemptIntent(s: State, id: int): bool = {
    val result = s.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      result.promotionIntentRecorded,
      result.promotionAuthorized,
      result.verificationOutcome == Passed,
      result.verificationEvidenceReread,
      result.verificationManifestSealed,
      result.submittedCandidate != 0,
      result.observedFirstParent == result.expectedTargetHead,
      result.observedSecondParent == result.acceptedResultCommit,
      result.targetHeld,
      result.promotionAttemptCount < PROMOTION_ATTEMPT_LIMIT,
      and {
        result.phase == PromotionRetryReady,
        result.promotionFreshExactHeadObservation,
        result.promotionGitObservation == PromotionExactExpectedHead,
        result.promotionExpectedHeadVerified,
        result.promotionFreshExactHeadReads == result.promotionAttemptCount + 1,
      },
    }
  }

  // The next attempt ordinal is durable before the Git boundary can be
  // crossed. A crash after this action must reconcile instead of assuming the
  // compare-and-set was never sent.
  action recordPromotionAttemptIntent(id: int): bool = {
    val result = state.results.get(id)
    all {
      canRecordPromotionAttemptIntent(state, id),
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: PromotionAttemptIntended,
          promotionAttemptCount: result.promotionAttemptCount + 1,
          promotionLastAttempt: result.promotionLastAttempt + 1,
          promotionFreshExactHeadObservation: false,
          promotionGitObservation: NoPromotionGitObservation,
          promotionObservedTargetHead: 0,
          promotionResponseAmbiguous: false,
          promotionCompareAndSetRequested: false,
          promotionForceRequested: false,
          promotionEquivalentContentAccepted: false,
        }),
      },
    }
  }

  pure def canSendPromotionAttempt(s: State, id: int): bool = {
    val result = s.results.get(id)
    and {
      id == VERIFICATION_RESULT_ID,
      result.phase == PromotionAttemptIntended,
      result.targetHeld,
      result.promotionIntentRecorded,
      result.promotionAttemptCount > 0,
      result.promotionAttemptCount == result.promotionLastAttempt,
      result.promotionAttemptCount <= PROMOTION_ATTEMPT_LIMIT,
      result.promotionExpectedHeadVerified,
      result.promotionTargetFactsCurrent,
    }
  }

  // This boundary call is intentionally one exact H -> M compare-and-set. Its
  // durable ordinal was already written by recordPromotionAttemptIntent.
  action sendPromotionAttempt(id: int): bool = {
    val result = state.results.get(id)
    all {
      canSendPromotionAttempt(state, id),
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: PromotionInFlight,
          promotionCompareAndSetRequested: true,
        }),
      },
    }
  }

  // A lost compare-and-set response is ambiguous. The local target position is
  // released, but the durable intent, candidate, evidence, and attempt count
  // remain for a fresh Git read.
  action losePromotionResponse(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      result.phase == PromotionInFlight,
      result.targetHeld,
      result.promotionIntentRecorded,
      result.promotionAttemptCount > 0,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: PromotionResponseLost,
          targetHeld: false,
          promotionFreshExactHeadObservation: false,
          promotionTargetFactsCurrent: false,
          promotionGitObservation: NoPromotionGitObservation,
          promotionObservedTargetHead: 0,
          promotionResponseAmbiguous: true,
        }),
      },
    }
  }

  // Reconciliation owns a fresh Git read. It can reacquire the target for the
  // read after an ambiguous or unreadable result, and after restart of an
  // intent that has not sent its first attempt.
  action reconcilePromotion(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      not(result.targetHeld),
      result.promotionIntentRecorded,
      result.promotionAuthorized,
      result.verificationEvidenceReread,
      result.verificationManifestSealed,
      state.trackerFactsCurrent,
      state.targetFactsCurrent,
      state.targetHeadProof == result.expectedTargetHead,
      or {
        Set(PromotionResponseLost, PromotionReadPending).contains(result.phase),
        and {
          result.phase == PromotionIntent,
          state.targetReacquisitionRequired,
        },
      },
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: PromotionReconciliation,
          targetHeld: true,
          promotionFreshExactHeadObservation: false,
          promotionTargetFactsCurrent: false,
          promotionGitObservation: NoPromotionGitObservation,
          promotionObservedTargetHead: 0,
        }),
        targetReacquisitionRequired:
          RESULT_IDS.exists(other =>
            other != id
              and not(state.results.get(other).targetHeld)
              and Set(
                Started,
                CandidatePending,
                CorrectionRequired,
                CandidateReady,
                VerificationIntent,
                VerificationInvoked,
                VerificationResponseLost,
                VerificationReconciling,
                VerificationPassedPendingSeal,
                PromotionIntent,
              ).contains(state.results.get(other).phase)
          ),
      },
    }
  }

  // Git proving M is current or an exact ancestor discovers the original
  // promotion. No second compare-and-set is sent, even after a lost response.
  action observePromotionCandidateCurrent(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      Set(PromotionIntent, PromotionInFlight, PromotionReconciliation).contains(result.phase),
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: PromotionSucceeded,
          targetHeld: false,
          promotionGitObservation: PromotionCandidateCurrent,
          promotionObservedTargetHead: result.submittedCandidate,
          promotionCandidateAncestryProven: true,
          promotionResultRecorded: true,
          promotionResponseAmbiguous: false,
        }),
      },
    }
  }

  action observePromotionCandidateAncestor(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      Set(PromotionIntent, PromotionReconciliation).contains(result.phase),
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: PromotionSucceeded,
          targetHeld: false,
          promotionGitObservation: PromotionCandidateAncestor,
          promotionObservedTargetHead: result.submittedCandidate + 100,
          promotionCandidateAncestryProven: true,
          promotionResultRecorded: true,
          promotionResponseAmbiguous: false,
        }),
      },
    }
  }

  // A fresh exact H proves that M is not currently promoted and is the only
  // observation that can make a later numbered attempt eligible. At attempt
  // three it settles as typed non-convergence instead of sending attempt four.
  action observePromotionExactExpectedHead(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      Set(PromotionIntent, PromotionReconciliation).contains(result.phase),
      result.targetHeld,
      state' = {
        ...state,
        targetFactsCurrent: true,
        targetHeadProof: result.expectedTargetHead,
        results: state.results.put(id,
          if (result.promotionAttemptCount >= PROMOTION_ATTEMPT_LIMIT) {
            {
              ...result,
              phase: PromotionExhausted,
              targetHeld: false,
              promotionFreshExactHeadReads: result.promotionFreshExactHeadReads + 1,
              promotionFreshExactHeadObservation: true,
              promotionTargetFactsCurrent: true,
              promotionExpectedHeadVerified: true,
              promotionGitObservation: PromotionExactExpectedHead,
              promotionObservedTargetHead: result.expectedTargetHead,
              promotionResultRecorded: false,
              promotionResponseAmbiguous: false,
            }
          } else {
            {
              ...result,
              phase: PromotionRetryReady,
              targetHeld: true,
              promotionFreshExactHeadReads: result.promotionFreshExactHeadReads + 1,
              promotionFreshExactHeadObservation: true,
              promotionTargetFactsCurrent: true,
              promotionExpectedHeadVerified: true,
              promotionGitObservation: PromotionExactExpectedHead,
              promotionObservedTargetHead: result.expectedTargetHead,
              promotionResultRecorded: false,
              promotionResponseAmbiguous: false,
            }
          }
        ),
      },
    }
  }

  // Any other complete exact head is stale, including a head with equivalent
  // file content. The candidate and sealed evidence remain untouched.
  action observePromotionOtherHead(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      Set(PromotionIntent, PromotionInFlight, PromotionReconciliation).contains(result.phase),
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: PromotionStale,
          targetHeld: false,
          promotionGitObservation: PromotionOtherHead,
          promotionObservedTargetHead: result.expectedTargetHead + 1,
          promotionCandidateAncestryProven: false,
          promotionResultRecorded: true,
          promotionResponseAmbiguous: false,
        }),
      },
    }
  }

  // An incomplete Git head/ancestry read remains pending and sends no update.
  action observePromotionGitUnreadable(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == VERIFICATION_RESULT_ID,
      Set(PromotionIntent, PromotionReconciliation).contains(result.phase),
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase:
            if (result.promotionAttemptCount >= PROMOTION_ATTEMPT_LIMIT)
              PromotionExhausted
            else
              PromotionReadPending,
          targetHeld: false,
          promotionTargetFactsCurrent: false,
          promotionGitObservation: PromotionUnreadableHead,
          promotionObservedTargetHead: 0,
          promotionCandidateAncestryProven: false,
          promotionResultRecorded: false,
        }),
      },
    }
  }

  // Choose the second responsibility's independent target before its durable
  // queue record is written. A journaled responsibility never changes target.
  action assignResultTwoIndependentTarget: bool = {
    val result = state.results.get(2)
    all {
      result.phase == AcceptedResult,
      result.integrationTarget == 1,
      state' = {
        ...state,
        results: state.results.put(2, {
          ...result,
          integrationTarget: 2,
        }),
      },
    }
  }

  action observeInvalidCandidate(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == CandidatePending,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(id,
          if (result.correctionCount >= CORRECTION_LIMIT) {
            ...result,
            phase: CorrectionLimitReached,
            targetHeld: false,
            observedFirstParent: 99,
            observedSecondParent: 98,
          } else {
            ...result,
            phase: CorrectionRequired,
            correctionCount: result.correctionCount + 1,
            observedFirstParent: 99,
            observedSecondParent: 98,
          }
        ),
      },
    }
  }

  // A failed Git read records no candidate fact, so restart rereads the same submission.
  action gitReadFails(id: int): bool = all {
    RESULT_IDS.contains(id),
    state.results.get(id).phase == CandidatePending,
    state.results.get(id).targetHeld,
    state' = state,
  }

  action waitOnDependency(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == Started,
      result.targetHeld,
      state.trackerFactsCurrent,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: DependencyWait,
          targetHeld: false,
        }),
      },
    }
  }

  action recoverCoordinator: bool = all {
    state.restartCount < RESTART_LIMIT,
    state' = {
      ...state,
      results: RESULT_IDS.mapBy(id => {
        val result = state.results.get(id)
        {
          ...result,
          phase:
          if (result.phase == CorrelationContradictionReleased)
            CorrelationContradiction
          else if (
            Set(
              PromotionInFlight,
              PromotionAttemptIntended,
              PromotionReconciliation,
              PromotionRetryReady,
            ).contains(result.phase)
          )
            PromotionResponseLost
          else if (result.phase == PromotionReadPending)
            if (result.promotionAttemptCount == 0)
              PromotionIntent
            else
              PromotionResponseLost
          else
            result.phase,
          promotionTargetFactsCurrent:
            if (promotionProtocolPhase(result.phase)) false
            else result.promotionTargetFactsCurrent,
          promotionFreshExactHeadObservation:
            if (promotionProtocolPhase(result.phase)) false
            else result.promotionFreshExactHeadObservation,
          promotionGitObservation:
            if (
              promotionProtocolPhase(result.phase)
                and not(promotionTerminalPhase(result.phase))
            ) NoPromotionGitObservation
            else result.promotionGitObservation,
          promotionObservedTargetHead:
            if (
              promotionProtocolPhase(result.phase)
                and not(promotionTerminalPhase(result.phase))
            ) 0
            else result.promotionObservedTargetHead,
          targetHeld: false,
        }
      }),
      recovered: true,
      restartCount: state.restartCount + 1,
      trackerFactsCurrent:
        if (restartRequiresFreshAuthorityFacts(state)) false
        else state.trackerFactsCurrent,
      targetFactsCurrent:
        if (restartRequiresFreshAuthorityFacts(state)) false
        else state.targetFactsCurrent,
      targetHeadProof:
        if (restartRequiresFreshAuthorityFacts(state)) 0
        else state.targetHeadProof,
      targetReacquisitionRequired: restartRequiresFreshAuthorityFacts(state),
    },
  }

  action observeTrackerFacts: bool = all {
    not(state.trackerFactsCurrent),
    state' = { ...state, trackerFactsCurrent: true },
  }

  // A restart also requires a fresh Git target-head proof. The proof is
  // selected for the exact queued/active target and is not inferred from the
  // old process-local lease or from tracker freshness.
  action observeTargetFacts(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      not(state.targetFactsCurrent),
      result.phase != NoAcceptedResult,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          promotionTargetFactsCurrent:
            if (promotionProtocolPhase(result.phase)) true
            else result.promotionTargetFactsCurrent,
        }),
        targetFactsCurrent: true,
        targetHeadProof:
          if (result.expectedTargetHead == 0) id + 10 else result.expectedTargetHead,
      },
    }
  }

  pure def canReacquireTarget(s: State, id: int): bool = {
    val result = s.results.get(id)
    and {
      RESULT_IDS.contains(id),
      s.trackerFactsCurrent,
      s.targetFactsCurrent,
      s.targetReacquisitionRequired,
      Set(
        Started,
        CandidatePending,
        CorrectionRequired,
        CandidateReady,
        VerificationIntent,
        VerificationInvoked,
        VerificationResponseLost,
        VerificationReconciling,
        VerificationPassedPendingSeal,
        PromotionIntent,
      ).contains(result.phase),
      not(result.targetHeld),
      result.expectedTargetHead != 0,
      s.targetHeadProof == result.expectedTargetHead,
      not(RESULT_IDS.exists(other => s.results.get(other).targetHeld)),
    }
  }

  action reacquireIntegrationTarget(id: int): bool = {
    val result = state.results.get(id)
    all {
      canReacquireTarget(state, id),
      state' = {
        ...state,
        results: state.results.put(id, { ...result, targetHeld: true }),
        targetReacquisitionRequired:
          RESULT_IDS.exists(other =>
            other != id
              and not(state.results.get(other).targetHeld)
              and Set(
                Started,
                CandidatePending,
                CorrectionRequired,
                CandidateReady,
                VerificationIntent,
                VerificationInvoked,
                VerificationResponseLost,
                VerificationReconciling,
                VerificationPassedPendingSeal,
                PromotionIntent,
              ).contains(state.results.get(other).phase)
          ),
      },
    }
  }

  // Quint traces retain action names but not the arguments passed to action
  // definitions. These concrete executable actions preserve the parameterized
  // helpers above for exact tests while giving the TypeScript conformance
  // adapter an unambiguous production operation for every trace step.
  action acceptResultOne: bool = acceptResult(1)
  action acceptResultTwo: bool = acceptResult(2)
  action observeAppliedRestartBeforeAcceptedOne: bool = observeAppliedRestartBeforeAccepted(1)
  action queueAcceptedResultOne: bool = queueAcceptedResult(1)
  action queueAcceptedResultTwo: bool = queueAcceptedResult(2)
  action startIntegrationOne: bool = startIntegration(1)
  action startIntegrationTwo: bool = startIntegration(2)
  action waitOnDependencyOne: bool = waitOnDependency(1)
  action waitOnDependencyTwo: bool = waitOnDependency(2)
  action submitCandidateOne31: bool = submitCandidate(1, 31)
  action submitCandidateOne32: bool = submitCandidate(1, 32)
  action submitCandidateTwo31: bool = submitCandidate(2, 31)
  action submitCandidateTwo32: bool = submitCandidate(2, 32)
  action observeExactCandidateOne: bool = observeExactCandidate(1)
  action observeExactCandidateTwo: bool = observeExactCandidate(2)
  action recordVerificationIntentOne: bool = recordVerificationIntent(1)
  action invokeVerificationOne: bool = invokeVerification(1)
  action loseVerificationResponseOne: bool = loseVerificationResponse(1)
  action reconcileVerificationOne: bool = reconcileVerification(1)
  action reportVerificationPassedOne: bool = reportVerificationPassed(1)
  action rereadAndSealPassedVerificationOne: bool = rereadAndSealPassedVerification(1)
  action reportVerificationFailedOne: bool = reportVerificationFailed(1)
  action reportVerificationKilledOne: bool = reportVerificationKilled(1)
  action reportVerificationTimedOutOne: bool = reportVerificationTimedOut(1)
  action reportVerificationPartialOne: bool = reportVerificationPartial(1)
  action reportVerificationCorrelationContradictionOne: bool = reportVerificationCorrelationContradiction(1)
  action reportVerificationEvidenceFailureOne: bool = reportVerificationEvidenceFailure(1)
  // The exhaustive step explores promotion with the second result absent;
  // the collected two-target scenario below exercises the independent-target
  // composition directly. This bound avoids a redundant Cartesian product of
  // the complete second-result lifecycle with every promotion retry state.
  action offerPromotionPremiseOne: bool = all {
    state.results.get(2).phase == NoAcceptedResult,
    offerPromotionPremise(1),
  }
  action recordPromotionIntentOne: bool = recordPromotionIntent(1)
  action recordPromotionAttemptIntentOne: bool = recordPromotionAttemptIntent(1)
  action sendPromotionAttemptOne: bool = sendPromotionAttempt(1)
  action losePromotionAttemptResponseOne: bool = losePromotionResponse(1)
  action reconcilePromotionOne: bool = reconcilePromotion(1)
  action observePromotionCandidateCurrentOne: bool = observePromotionCandidateCurrent(1)
  action observePromotionCandidateAncestorOne: bool = all {
    state.results.get(1).promotionAttemptCount <= 1,
    observePromotionCandidateAncestor(1),
  }
  action observePromotionExactExpectedHeadOne: bool = observePromotionExactExpectedHead(1)
  action observePromotionOtherHeadOne: bool = all {
    or {
      state.results.get(1).promotionAttemptCount == 0,
      state.results.get(1).phase == PromotionInFlight,
    },
    observePromotionOtherHead(1),
  }
  action observePromotionGitUnreadableOne: bool = all {
    or {
      state.results.get(1).promotionAttemptCount == 0,
      state.results.get(1).promotionAttemptCount >= PROMOTION_ATTEMPT_LIMIT,
    },
    observePromotionGitUnreadable(1),
  }
  action assignResultTwoIndependentTargetOne: bool = assignResultTwoIndependentTarget
  action observeInvalidCandidateOne: bool = observeInvalidCandidate(1)
  action observeInvalidCandidateTwo: bool = observeInvalidCandidate(2)
  action gitReadFailsOne: bool = gitReadFails(1)
  action gitReadFailsTwo: bool = gitReadFails(2)
  action reportWithoutCandidateOne: bool = reportWithoutCandidate(1)
  action reportWithoutCandidateTwo: bool = reportWithoutCandidate(2)
  action reportForeignCorrelationOne: bool = reportForeignCorrelation(1)
  action reportForeignCorrelationTwo: bool = reportForeignCorrelation(2)
  action releaseForeignCorrelationTargetOne: bool = releaseForeignCorrelationTarget(1)
  action releaseForeignCorrelationTargetTwo: bool = releaseForeignCorrelationTarget(2)
  action reacquireIntegrationTargetOne: bool = reacquireIntegrationTarget(1)
  action reacquireIntegrationTargetTwo: bool = reacquireIntegrationTarget(2)
  action observeTargetFactsOne: bool = observeTargetFacts(1)
  action observeTargetFactsTwo: bool = observeTargetFacts(2)

  // Exhaustive promotion recovery covers the three ambiguity boundaries;
  // collected scenarios exercise the remaining restart points directly.
  action recoverCoordinatorStep: bool = all {
    or {
      not(promotionProtocolPhase(state.results.get(1).phase)),
      Set(
        PromotionAttemptIntended,
        PromotionInFlight,
        PromotionReadPending,
      ).contains(state.results.get(1).phase),
    },
    recoverCoordinator,
  }

  action step: bool = any {
    // Exhaustive exploration keeps result two at the queue/order boundary.
    // Collected two-result scenarios exercise its full independent-target
    // lifecycle without multiplying every result-one protocol state by it.
    observeAppliedRestartBeforeAcceptedOne,
    acceptResultOne,
    acceptResultTwo,
    queueAcceptedResultOne,
    queueAcceptedResultTwo,
    startIntegrationOne,
    waitOnDependencyOne,
    submitCandidateOne31,
    submitCandidateOne32,
    observeExactCandidateOne,
    recordVerificationIntentOne,
    invokeVerificationOne,
    loseVerificationResponseOne,
    reconcileVerificationOne,
    reportVerificationPassedOne,
    rereadAndSealPassedVerificationOne,
    reportVerificationFailedOne,
    reportVerificationKilledOne,
    reportVerificationTimedOutOne,
    reportVerificationPartialOne,
    reportVerificationCorrelationContradictionOne,
    reportVerificationEvidenceFailureOne,
    offerPromotionPremiseOne,
    recordPromotionIntentOne,
    recordPromotionAttemptIntentOne,
    sendPromotionAttemptOne,
    losePromotionAttemptResponseOne,
    reconcilePromotionOne,
    observePromotionCandidateCurrentOne,
    observePromotionCandidateAncestorOne,
    observePromotionExactExpectedHeadOne,
    observePromotionOtherHeadOne,
    observePromotionGitUnreadableOne,
    assignResultTwoIndependentTargetOne,
    observeInvalidCandidateOne,
    gitReadFailsOne,
    reportWithoutCandidateOne,
    reportForeignCorrelationOne,
    releaseForeignCorrelationTargetOne,
    reacquireIntegrationTargetOne,
    recoverCoordinatorStep,
    observeTrackerFacts,
    observeTargetFactsOne,
  }
}
