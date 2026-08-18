// Models issue #56 admission, issue #222's one outer Integrator boundary, and
// the issue-60 exact-head promotion protocol. The Integrator owns merge
// construction, repository checks, review, and private retries. Dalph models
// only one fixed session, its durable result, an explicit candidate report,
// and Git's ordered-parent qualification.
module acceptedResultIntegration {
  type Phase =
    | NoAcceptedResult
    | AcceptedResult
    | LateAcceptedEvidence
    | Queued
    | Started
    | DependencyWait
    | IntegratorSessionFixed
    | IntegratorInFlight
    | IntegratorResponseLost
    | IntegratorNotPrepared
    | IntegratorResultRecorded
    | CandidateGitReadIntent
    | CandidateGitReadPending
    | CandidateReady
    | CandidateRejected
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

  // An outer Integrator result is either conclusive without a candidate or
  // names one explicit commit. Process success and resource HEAD are not
  // result variants.
  type IntegratorOutcome =
    | NoIntegratorOutcome
    | NotPrepared
    | PreparedCandidate

  // Git qualifies only the explicitly reported candidate object. Missing,
  // non-commit, and wrong-parent observations are distinct from success.
  type CandidateGitObservation =
    | NoCandidateGitObservation
    | CandidateMissing
    | CandidateNonCommit
    | CandidateWrongParents
    | CandidateExactParents

  // Promotion Git observations are exact identities, not equivalent trees or
  // patches. An unreadable observation cannot establish promotion or staleness.
  type PromotionGitObservation =
    | NoPromotionGitObservation
    | PromotionExactExpectedHead
    | PromotionCandidateCurrent
    | PromotionCandidateAncestor
    | PromotionOtherHead
    | PromotionUnreadableHead

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
    // locator explicit makes the queue guard target-scoped.
    integrationTarget: int,
    preIntegrationCancellation: bool,
    targetHeld: bool,
    integrationSession: int,
    // The isolated candidate resource is a distinct identity fixed with S and
    // bound to the exact target, H, and accepted-result commit C.
    candidateResource: int,
    resourceBoundTarget: int,
    resourceBoundHead: int,
    resourceBoundCommit: int,
    // The planned target head is known before an outer session is created.
    // expectedTargetHead is fixed once the responsibility starts and never
    // changes for that session.
    plannedTargetHead: int,
    expectedTargetHead: int,
    acceptedResultCommit: int,
    // The accepted executor result carries one immutable evidence reference.
    // The corrected outer Integrator result carries no additional evidence.
    acceptedResultEvidence: int,
    integratorReturnedEvidenceRefs: Set[int],
    lineageCompatible: bool,
    sessionFixed: bool,
    integratorInvocationCount: int,
    integratorResumeCount: int,
    integratorOutcome: IntegratorOutcome,
    integratorResultRecorded: bool,
    // A prepared outcome is not enough: this records the explicit report
    // boundary that supplied the candidate to Dalph.
    candidateReported: bool,
    integratorResponseAmbiguous: bool,
    submittedCandidate: int,
    candidateJournalPosition: int,
    candidateGitReadIntentRecorded: bool,
    candidateGitReadCount: int,
    candidateGitResponseAmbiguous: bool,
    candidateGitObservation: CandidateGitObservation,
    candidateQualificationProven: bool,
    observedFirstParent: int,
    observedSecondParent: int,
    // These are forbidden evidence-shaped values used by the negative model.
    // Normal protocol actions never write them.
    resourceHeadCandidate: int,
    processSuccessObserved: bool,
    legacyVerificationEvidence: bool,
    // Promotion intent and attempt intents are durable facts. The count
    // survives a restart and counts durable attempt ordinals, never Git reads.
    promotionAuthorized: bool,
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
  pure val PROMOTION_ATTEMPT_LIMIT = 3
  // Finite model bounds for exploration; neither is a production policy.
  // Enough finite recovery turns to exercise all three promotion ordinals;
  // this bounds the model only and is not a production retry policy.
  pure val RESTART_LIMIT = 4
  pure val RECONCILIATION_LIMIT = 2
  var state: State

  pure def sameIntegrationTarget(left: ResultState, right: ResultState): bool =
    left.integrationTarget == right.integrationTarget

  pure def promotionTerminalPhase(phase: Phase): bool =
    Set(PromotionSucceeded, PromotionStale, PromotionExhausted).contains(phase)

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

  pure def integratorActivePhase(phase: Phase): bool =
    Set(
      Started,
      IntegratorSessionFixed,
      IntegratorInFlight,
      IntegratorResponseLost,
      IntegratorResultRecorded,
      CandidateGitReadIntent,
      CandidateGitReadPending,
    ).contains(phase)

  // Once S is fixed, resuming the opaque call or qualifying its reported M
  // uses S's durable original H. A current target-head read belongs to later
  // promotion, not to replay of the outer boundary.
  pure def fixedIntegratorSessionPhase(phase: Phase): bool =
    Set(
      IntegratorSessionFixed,
      IntegratorInFlight,
      IntegratorResponseLost,
      IntegratorResultRecorded,
      CandidateGitReadIntent,
      CandidateGitReadPending,
    ).contains(phase)

  pure def candidateQualificationPhase(phase: Phase): bool =
    Set(
      CandidateReady,
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

  pure def candidateResultPhase(phase: Phase): bool =
    Set(
      IntegratorResultRecorded,
      CandidateGitReadIntent,
      CandidateGitReadPending,
      CandidateReady,
      CandidateRejected,
    ).contains(phase)

  // A started responsibility remains a logical same-target blocker until
  // later promotion and settlement, even after a local lease is released.
  pure def logicalIntegrationBlockerPhase(phase: Phase): bool =
    phase != NoAcceptedResult
      and phase != AcceptedResult
      and phase != LateAcceptedEvidence
      and phase != Queued

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
      result.lineageCompatible,
      // A known changed H cannot create a fresh S for the queued result.
      s.targetHeadProof == 0 or s.targetHeadProof == result.plannedTargetHead,
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

  pure def targetReacquisitionPhase(phase: Phase): bool =
    Set(
      Started,
      IntegratorSessionFixed,
      IntegratorInFlight,
      IntegratorResponseLost,
      IntegratorResultRecorded,
      CandidateGitReadIntent,
      CandidateGitReadPending,
      CandidateReady,
      PromotionPremise,
    ).contains(phase)

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
  val incompatibleTargetLineageReached: bool =
    RESULT_IDS.exists(id =>
      state.results.get(id).phase == Queued and not(state.results.get(id).lineageCompatible)
    )
  val integratorSessionFixedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == IntegratorSessionFixed)
  val integratorInFlightReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == IntegratorInFlight)
  val integratorResponseLostReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == IntegratorResponseLost)
  val integratorResumedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).integratorResumeCount > 0)
  val integratorNotPreparedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == IntegratorNotPrepared)
  val integratorResultRecordedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == IntegratorResultRecorded)
  val candidateGitReadIntentReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == CandidateGitReadIntent)
  val candidateGitReadPendingReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == CandidateGitReadPending)
  val candidateReadyReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == CandidateReady)
  val candidateRejectedReached: bool =
    RESULT_IDS.exists(id => state.results.get(id).phase == CandidateRejected)
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
        IntegratorNotPrepared,
        CandidateRejected,
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

  val cancellationExactlyQueued: bool =
    RESULT_IDS.forall(id =>
      state.results.get(id).preIntegrationCancellation
        == (state.results.get(id).phase == Queued)
    )

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

  // This repeats the late-admission requirement independently of the guard.
  val lateAcceptedAfterRestartNeverCreatesIntegrationResponsibility: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(result.restartChoiceCommittedBeforeTerminal and result.acceptedEvidencePreserved)
        or and {
          result.phase == LateAcceptedEvidence,
          result.integrationResponsibilityCount == 0,
          not(result.integrationResponsibilityRecorded),
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
          IntegratorSessionFixed,
          IntegratorInFlight,
          IntegratorResponseLost,
          IntegratorResultRecorded,
          CandidateGitReadIntent,
          CandidateGitReadPending,
          CandidateReady,
          PromotionPremise,
          PromotionIntent,
          PromotionAttemptIntended,
          PromotionInFlight,
          PromotionReconciliation,
          PromotionRetryReady,
        ).contains(state.results.get(id).phase)
    )

  val atMostOneTargetHolder: bool =
    RESULT_IDS.forall(left =>
      RESULT_IDS.forall(right =>
        left == right
          or state.results.get(left).integrationTarget != state.results.get(right).integrationTarget
          or not(state.results.get(left).targetHeld and state.results.get(right).targetHeld)
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

  val sessionIdentityFixedAfterStart: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      result.phase != NoAcceptedResult
        and result.phase != AcceptedResult
        and result.phase != LateAcceptedEvidence
        and result.phase != Queued
        implies result.integrationSession == id
    })

  val integratorSessionIsFixedBeforeResult: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      result.integratorOutcome != NoIntegratorOutcome implies and {
        result.sessionFixed,
        result.integratorResultRecorded,
        result.integrationSession == id,
      }
    })

  val integratorResourceIsExactlyBound: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(result.sessionFixed) or and {
        result.candidateResource == id + 100,
        result.resourceBoundTarget == result.integrationTarget,
        result.resourceBoundHead == result.expectedTargetHead,
        result.resourceBoundCommit == result.acceptedResultCommit,
      }
    })

  val integratorIntentPrecedesCall: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      and {
        result.integratorInvocationCount >= 0,
        result.integratorInvocationCount <= 1,
        result.integratorResumeCount >= 0,
        result.integratorResumeCount <= RECONCILIATION_LIMIT,
        result.integratorInvocationCount > 0 implies and {
          result.sessionFixed,
        },
      }
    })

  val integratorCallResultIsPersistent: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      result.integratorResultRecorded implies and {
        result.integratorInvocationCount == 1,
        result.integratorOutcome != NoIntegratorOutcome,
        result.phase == IntegratorNotPrepared
          or candidateResultPhase(result.phase)
          or candidateQualificationPhase(result.phase),
      }
    })

  val integratorRecoveryReusesSameSession: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      result.integratorResumeCount > 0 implies and {
        result.sessionFixed,
        result.integrationSession == id,
        result.integratorInvocationCount <= 1,
      }
    })

  // The corrected Integrator boundary returns only its durable result. The
  // accepted-result evidence remains the sole evidence reference in scope.
  val integratorResultCarriesOnlyAcceptedEvidence: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      and {
        result.integratorReturnedEvidenceRefs == Set(),
        not(result.integratorResultRecorded) or and {
          result.acceptedEvidencePreserved,
          result.acceptedResultEvidence != 0,
        },
      }
    })

  val conclusiveNotPreparedHasNoCandidate: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      result.phase != IntegratorNotPrepared or and {
        result.integratorOutcome == NotPrepared,
        result.integratorResultRecorded,
        result.submittedCandidate == 0,
        not(result.candidateGitReadIntentRecorded),
        result.candidateGitObservation == NoCandidateGitObservation,
        not(result.candidateQualificationProven),
        not(result.promotionAuthorized),
        not(result.targetHeld),
      }
    })

  val candidateReportIsExplicit: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(candidateResultPhase(result.phase) or candidateQualificationPhase(result.phase))
        or and {
          result.integratorOutcome == PreparedCandidate,
          result.integratorResultRecorded,
          result.candidateReported,
          result.submittedCandidate != 0,
        }
    })

  val candidateGitIntentPrecedesObservation: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      result.candidateGitObservation != NoCandidateGitObservation implies and {
        result.integratorOutcome == PreparedCandidate,
        result.submittedCandidate != 0,
        result.candidateGitReadIntentRecorded,
        result.candidateGitReadCount > 0,
      }
    })

  val candidateQualificationRequiresExactParents: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(candidateQualificationPhase(result.phase)) or and {
        result.submittedCandidate != 0,
        result.candidateGitObservation == CandidateExactParents,
        result.observedFirstParent == result.expectedTargetHead,
        result.observedSecondParent == result.acceptedResultCommit,
        result.integratorResultRecorded,
        result.candidateReported,
        result.candidateQualificationProven,
      }
    })

  val invalidCandidateNeverAuthorizesPromotion: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(Set(CandidateRejected, IntegratorNotPrepared).contains(result.phase)) or and {
        not(result.candidateQualificationProven),
        not(result.promotionAuthorized),
        not(promotionProtocolPhase(result.phase)),
      }
    })

  val noForbiddenEvidenceAuthorizesPromotion: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(result.promotionAuthorized) or and {
        result.candidateQualificationProven,
        result.integratorOutcome == PreparedCandidate,
        result.integratorResultRecorded,
        result.candidateReported,
        result.submittedCandidate != 0,
        result.acceptedEvidencePreserved,
        result.acceptedResultEvidence != 0,
        result.integratorReturnedEvidenceRefs == Set(),
        result.resourceHeadCandidate == 0,
        not(result.processSuccessObserved),
        not(result.legacyVerificationEvidence),
      }
    })

  val logicalIntegrationResponsibilityBlocksLaterQueue: bool =
    RESULT_IDS.forall(blocker =>
      RESULT_IDS.forall(later =>
        blocker == later
          or not(
            state.results.get(blocker).integrationTarget
              == state.results.get(later).integrationTarget
              and logicalIntegrationBlockerPhase(state.results.get(blocker).phase)
            and state.results.get(later).queuePosition > state.results.get(blocker).queuePosition
          )
          or state.results.get(later).phase == Queued
      )
    )

  val noAutomaticIntegratorSuccessor: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      and {
        result.integratorInvocationCount <= 1,
        result.integrationSession == 0 or result.integrationSession == id,
      }
    })

  val restartCountBounded: bool =
    state.restartCount >= 0 and state.restartCount <= RESTART_LIMIT

  val staleTargetProofIsNeverCurrent: bool =
    state.targetFactsCurrent or state.targetHeadProof == 0

  val mutableTargetWorkReacquisitionUsesFreshExpectedHead: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(
        state.targetReacquisitionRequired
          and result.targetHeld
          and targetReacquisitionPhase(result.phase)
          and not(fixedIntegratorSessionPhase(result.phase))
      ) or and {
        state.targetFactsCurrent,
        state.targetHeadProof == result.expectedTargetHead,
      }
    })

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

  val promotionUsesExactIntegratorCandidate: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(promotionProtocolPhase(result.phase)) or and {
        result.submittedCandidate != 0,
        result.candidateGitObservation == CandidateExactParents,
        result.observedFirstParent == result.expectedTargetHead,
        result.observedSecondParent == result.acceptedResultCommit,
        result.candidateQualificationProven,
        result.integratorOutcome == PreparedCandidate,
        result.integratorResultRecorded,
        result.candidateReported,
      }
    })

  val promotionCompareAndSetRequiresExactHead: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      not(result.promotionCompareAndSetRequested) or and {
        result.promotionAttemptCount <= PROMOTION_ATTEMPT_LIMIT,
        result.promotionExpectedHeadVerified,
        result.phase != PromotionInFlight or result.promotionTargetFactsCurrent,
        result.submittedCandidate != 0,
        result.integratorResultRecorded,
        result.candidateReported,
        result.observedFirstParent == result.expectedTargetHead,
        result.observedSecondParent == result.acceptedResultCommit,
        not(result.promotionForceRequested),
        not(result.promotionEquivalentContentAccepted),
      }
    })

  val promotionSuccessRequiresExactAncestry: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      result.phase != PromotionSucceeded or and {
        result.promotionResultRecorded,
        result.promotionCandidateAncestryProven,
        result.candidateQualificationProven,
        result.integratorResultRecorded,
        result.candidateReported,
        Set(PromotionCandidateCurrent, PromotionCandidateAncestor).contains(result.promotionGitObservation),
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
        not(result.promotionForceRequested),
        not(result.promotionEquivalentContentAccepted),
        not(result.targetHeld),
      }
    })

  val unreadablePromotionStaysPending: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      result.phase != PromotionReadPending or and {
        result.promotionIntentRecorded,
        result.promotionGitObservation == PromotionUnreadableHead,
        not(result.promotionResultRecorded),
        not(result.promotionCandidateAncestryProven),
        result.submittedCandidate != 0,
        not(result.targetHeld),
      }
    })

  val promotionExhaustionPreservesCandidate: bool =
    RESULT_IDS.forall(id => {
      val result = state.results.get(id)
      result.phase != PromotionExhausted or and {
        result.promotionAttemptCount == PROMOTION_ATTEMPT_LIMIT,
        result.promotionIntentRecorded,
        result.submittedCandidate != 0,
        result.candidateQualificationProven,
        Set(NoPromotionGitObservation, PromotionExactExpectedHead, PromotionUnreadableHead)
          .contains(result.promotionGitObservation),
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
      not(Set(PromotionSucceeded, PromotionStale, PromotionReadPending, PromotionExhausted)
        .contains(result.phase)) or not(result.targetHeld)
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
        candidateResource: 0,
        resourceBoundTarget: 0,
        resourceBoundHead: 0,
        resourceBoundCommit: 0,
        plannedTargetHead: id + 10,
        expectedTargetHead: 0,
        acceptedResultCommit: id + 20,
        acceptedResultEvidence: id + 30,
        integratorReturnedEvidenceRefs: Set(),
        lineageCompatible: true,
        sessionFixed: false,
        integratorInvocationCount: 0,
        integratorResumeCount: 0,
        integratorOutcome: NoIntegratorOutcome,
        integratorResultRecorded: false,
        candidateReported: false,
        integratorResponseAmbiguous: false,
        submittedCandidate: 0,
        candidateJournalPosition: 0,
        candidateGitReadIntentRecorded: false,
        candidateGitReadCount: 0,
        candidateGitResponseAmbiguous: false,
        candidateGitObservation: NoCandidateGitObservation,
        candidateQualificationProven: false,
        observedFirstParent: 0,
        observedSecondParent: 0,
        resourceHeadCandidate: 0,
        processSuccessObserved: false,
        legacyVerificationEvidence: false,
        promotionAuthorized: false,
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
  // carries only issue #56's late Accepted chronology.
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
          phase: if (result.restartChoiceCommittedBeforeTerminal) LateAcceptedEvidence else AcceptedResult,
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
          expectedTargetHead: result.plannedTargetHead,
        }),
        targetHeadProof: result.plannedTargetHead,
        targetReacquisitionRequired:
          RESULT_IDS.exists(other =>
            other != id
              and not(state.results.get(other).targetHeld)
              and targetReacquisitionPhase(state.results.get(other).phase)
          ),
      },
    }
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
        results: state.results.put(id, { ...result, phase: DependencyWait, targetHeld: false }),
      },
    }
  }

  // Session identity is fixed exactly once after the started responsibility
  // and compatible target lineage exist.
  action fixIntegratorSession(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      Set(Started, DependencyWait).contains(result.phase),
      result.targetHeld,
      result.lineageCompatible,
      result.expectedTargetHead != 0,
      not(result.sessionFixed),
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: IntegratorSessionFixed,
          sessionFixed: true,
          candidateResource: id + 100,
          resourceBoundTarget: result.integrationTarget,
          resourceBoundHead: result.expectedTargetHead,
          resourceBoundCommit: result.acceptedResultCommit,
        }),
      },
    }
  }

  action invokeIntegrator(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == IntegratorSessionFixed,
      result.targetHeld,
      result.sessionFixed,
      result.integratorInvocationCount == 0,
      not(state.targetReacquisitionRequired),
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: IntegratorInFlight,
          integratorInvocationCount: 1,
          integratorResponseAmbiguous: false,
        }),
      },
    }
  }

  // A lost response is unfinished work, not NotPrepared. Release is only
  // process-local; the same session is returned after current tracker facts.
  action loseIntegratorResponse(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == IntegratorInFlight,
      result.targetHeld,
      result.integratorInvocationCount == 1,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: IntegratorResponseLost,
          targetHeld: false,
          integratorResponseAmbiguous: true,
        }),
        trackerFactsCurrent: false,
        targetFactsCurrent: false,
        targetHeadProof: 0,
        targetReacquisitionRequired: true,
      },
    }
  }

  // Reconnects to S. It cannot allocate another session or count a provider
  // retry as a new Integrator run.
  action resumeIntegrator(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == IntegratorResponseLost,
      result.targetHeld,
      result.sessionFixed,
      result.integratorInvocationCount <= 1,
      result.integratorResumeCount < RECONCILIATION_LIMIT,
      not(state.targetReacquisitionRequired),
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: IntegratorInFlight,
          integratorInvocationCount:
            if (result.integratorInvocationCount == 0) 1 else result.integratorInvocationCount,
          integratorResumeCount:
            if (result.phase == IntegratorResponseLost)
              result.integratorResumeCount + 1
            else result.integratorResumeCount,
          integratorResponseAmbiguous: false,
        }),
        targetReacquisitionRequired: false,
      },
    }
  }

  action reportIntegratorNotPrepared(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == IntegratorInFlight,
      result.targetHeld,
      result.sessionFixed,
      result.integratorInvocationCount == 1,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: IntegratorNotPrepared,
          targetHeld: false,
          integratorOutcome: NotPrepared,
          integratorResultRecorded: true,
          candidateReported: false,
          integratorResponseAmbiguous: false,
          promotionAuthorized: false,
        }),
      },
    }
  }

  action reportIntegratorCandidate(id: int, candidate: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == IntegratorInFlight,
      result.targetHeld,
      result.sessionFixed,
      result.integratorInvocationCount == 1,
      candidate != 0,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: IntegratorResultRecorded,
          integratorOutcome: PreparedCandidate,
          integratorResultRecorded: true,
          candidateReported: true,
          integratorResponseAmbiguous: false,
          submittedCandidate: candidate,
          candidateGitObservation: NoCandidateGitObservation,
          candidateQualificationProven: false,
          candidateGitReadIntentRecorded: false,
          candidateGitReadCount: 0,
          candidateJournalPosition: 0,
          observedFirstParent: 0,
          observedSecondParent: 0,
          promotionAuthorized: false,
        }),
      },
    }
  }

  action recordCandidateGitReadIntent(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == IntegratorResultRecorded,
      result.targetHeld,
      result.integratorOutcome == PreparedCandidate,
      result.integratorResultRecorded,
      result.submittedCandidate != 0,
      not(result.candidateGitReadIntentRecorded),
      not(state.targetReacquisitionRequired),
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: CandidateGitReadIntent,
          candidateGitReadIntentRecorded: true,
          candidateGitResponseAmbiguous: false,
        }),
      },
    }
  }

  action readCandidateGit(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == CandidateGitReadIntent,
      result.targetHeld,
      result.candidateGitReadIntentRecorded,
      result.candidateGitReadCount >= 0,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: CandidateGitReadPending,
          candidateGitReadCount: result.candidateGitReadCount + 1,
          candidateGitResponseAmbiguous: false,
        }),
      },
    }
  }

  action loseCandidateGitResponse(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == CandidateGitReadPending,
      result.targetHeld,
      result.candidateGitReadCount > 0,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          targetHeld: false,
          candidateGitResponseAmbiguous: true,
        }),
        trackerFactsCurrent: false,
        targetFactsCurrent: false,
        targetHeadProof: 0,
        targetReacquisitionRequired: true,
      },
    }
  }

  action reconcileCandidateGit(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == CandidateGitReadPending,
      not(result.targetHeld),
      result.candidateGitReadIntentRecorded,
      result.candidateGitReadCount > 0,
      state.trackerFactsCurrent,
      state.targetReacquisitionRequired,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: CandidateGitReadIntent,
          targetHeld: true,
          candidateGitResponseAmbiguous: false,
        }),
        targetReacquisitionRequired: false,
      },
    }
  }

  pure def recordCandidateObservation(
    s: State,
    id: int,
    observation: CandidateGitObservation,
    firstParent: int,
    secondParent: int,
    qualifies: bool,
  ): State = {
    val result = s.results.get(id)
    {
      ...s,
      results: s.results.put(id, {
        ...result,
        phase: if (qualifies) CandidateReady else CandidateRejected,
        targetHeld: false,
        candidateGitObservation: observation,
        candidateJournalPosition: s.nextJournalPosition,
        observedFirstParent: firstParent,
        observedSecondParent: secondParent,
        candidateQualificationProven: qualifies,
        promotionAuthorized: qualifies,
      }),
      nextJournalPosition: s.nextJournalPosition + 1,
    }
  }

  action observeExactCandidate(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == CandidateGitReadPending,
      result.targetHeld,
      result.candidateGitReadIntentRecorded,
      result.submittedCandidate != 0,
      state' = recordCandidateObservation(
        state,
        id,
        CandidateExactParents,
        result.expectedTargetHead,
        result.acceptedResultCommit,
        true,
      ),
    }
  }

  action observeMissingCandidate(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == CandidateGitReadPending,
      result.targetHeld,
      result.candidateGitReadIntentRecorded,
      result.submittedCandidate != 0,
      state' = recordCandidateObservation(state, id, CandidateMissing, 0, 0, false),
    }
  }

  action observeNonCommitCandidate(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == CandidateGitReadPending,
      result.targetHeld,
      result.candidateGitReadIntentRecorded,
      result.submittedCandidate != 0,
      state' = recordCandidateObservation(state, id, CandidateNonCommit, 0, 0, false),
    }
  }

  action observeWrongParentCandidate(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == CandidateGitReadPending,
      result.targetHeld,
      result.candidateGitReadIntentRecorded,
      result.submittedCandidate != 0,
      // The tempting reversed [C,H] order is still invalid; the exact order
      // is [H,C], not merely the same two commit identities.
      state' = recordCandidateObservation(
        state,
        id,
        CandidateWrongParents,
        result.acceptedResultCommit,
        result.expectedTargetHead,
        false,
      ),
    }
  }

  // Git qualification is the direct premise for promotion. There is no
  // target-verification plan, manifest, wrapper, or separate Dalph phase.
  action offerPromotionPremise(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == 1,
      result.phase == CandidateReady,
      result.candidateQualificationProven,
      result.integratorOutcome == PreparedCandidate,
      result.submittedCandidate != 0,
      result.candidateGitObservation == CandidateExactParents,
      not(result.targetHeld),
      state.trackerFactsCurrent,
      state.targetFactsCurrent,
      state.targetHeadProof == result.expectedTargetHead,
      not(state.targetReacquisitionRequired),
      state' = {
        ...state,
        results: state.results.put(id, { ...result, phase: PromotionPremise }),
      },
    }
  }

  action recordPromotionIntent(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == 1,
      result.phase == PromotionPremise,
      not(result.targetHeld),
      result.promotionAuthorized,
      result.candidateQualificationProven,
      result.submittedCandidate != 0,
      result.observedFirstParent == result.expectedTargetHead,
      result.observedSecondParent == result.acceptedResultCommit,
      state.trackerFactsCurrent,
      state.targetFactsCurrent,
      state.targetHeadProof == result.expectedTargetHead,
      not(state.targetReacquisitionRequired),
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
      },
    }
  }

  pure def canRecordPromotionAttemptIntent(s: State, id: int): bool = {
    val result = s.results.get(id)
    all {
      id == 1,
      result.promotionIntentRecorded,
      result.promotionAuthorized,
      result.candidateQualificationProven,
      result.submittedCandidate != 0,
      result.observedFirstParent == result.expectedTargetHead,
      result.observedSecondParent == result.acceptedResultCommit,
      result.targetHeld,
      result.promotionAttemptCount < PROMOTION_ATTEMPT_LIMIT,
      result.phase == PromotionRetryReady,
      result.promotionFreshExactHeadObservation,
      result.promotionGitObservation == PromotionExactExpectedHead,
      result.promotionExpectedHeadVerified,
      result.promotionFreshExactHeadReads == result.promotionAttemptCount + 1,
    }
  }

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
      id == 1,
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

  action losePromotionResponse(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == 1,
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
        trackerFactsCurrent: false,
        targetFactsCurrent: false,
        targetHeadProof: 0,
        targetReacquisitionRequired: true,
      },
    }
  }

  action reconcilePromotion(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == 1,
      not(result.targetHeld),
      result.promotionIntentRecorded,
      result.promotionAuthorized,
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
        targetReacquisitionRequired: false,
      },
    }
  }

  action observePromotionCandidateCurrent(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == 1,
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
      id == 1,
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

  // A fresh exact H is the only observation that can authorize another
  // numbered request. At three consumed intents this settles non-convergence.
  action observePromotionExactExpectedHead(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == 1,
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

  action observePromotionOtherHead(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == 1,
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

  action observePromotionGitUnreadable(id: int): bool = {
    val result = state.results.get(id)
    all {
      id == 1,
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

  action assignResultTwoIndependentTarget: bool = {
    val result = state.results.get(2)
    all {
      result.phase == AcceptedResult,
      result.integrationTarget == 1,
      state' = {
        ...state,
        results: state.results.put(2, { ...result, integrationTarget: 2 }),
      },
    }
  }

  // Explicitly models a changed target head. It never creates a successor
  // session; an existing S remains bound to its original H.
  action observeChangedTargetHead(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      state.targetFactsCurrent,
      result.phase != NoAcceptedResult,
      result.phase != AcceptedResult,
      result.phase != LateAcceptedEvidence,
      state' = {
        ...state,
        targetHeadProof: result.plannedTargetHead + 1,
        targetFactsCurrent: true,
      },
    }
  }

  // A lineage rewrite before session creation preserves the queued result and
  // creates no session or Integrator call.
  action observeIncompatibleTargetLineage(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == Queued,
      state' = {
        ...state,
        results: state.results.put(id, { ...result, lineageCompatible: false }),
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
            if (result.phase == IntegratorInFlight)
              IntegratorResponseLost
            else if (
              Set(PromotionInFlight, PromotionAttemptIntended, PromotionReconciliation, PromotionRetryReady)
                .contains(result.phase)
            )
              PromotionResponseLost
            else if (result.phase == PromotionReadPending)
              if (result.promotionAttemptCount == 0) PromotionIntent else PromotionResponseLost
            else
              result.phase,
          integratorResponseAmbiguous:
            if (result.phase == IntegratorInFlight) true else result.integratorResponseAmbiguous,
          promotionTargetFactsCurrent:
            if (promotionProtocolPhase(result.phase)) false else result.promotionTargetFactsCurrent,
          promotionFreshExactHeadObservation:
            if (promotionProtocolPhase(result.phase)) false else result.promotionFreshExactHeadObservation,
          promotionGitObservation:
            if (promotionProtocolPhase(result.phase) and not(promotionTerminalPhase(result.phase)))
              NoPromotionGitObservation
            else result.promotionGitObservation,
          promotionObservedTargetHead:
            if (promotionProtocolPhase(result.phase) and not(promotionTerminalPhase(result.phase)))
              0
            else result.promotionObservedTargetHead,
          targetHeld: false,
        }
      }),
      recovered: true,
      restartCount: state.restartCount + 1,
      trackerFactsCurrent: if (restartRequiresFreshAuthorityFacts(state)) false else state.trackerFactsCurrent,
      targetFactsCurrent: if (restartRequiresFreshAuthorityFacts(state)) false else state.targetFactsCurrent,
      targetHeadProof: if (restartRequiresFreshAuthorityFacts(state)) 0 else state.targetHeadProof,
      targetReacquisitionRequired: restartRequiresFreshAuthorityFacts(state),
    },
  }

  action observeTrackerFacts: bool = all {
    not(state.trackerFactsCurrent),
    state' = { ...state, trackerFactsCurrent: true },
  }

  // Fresh target facts are independent of the process-local lease.
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
            if (promotionProtocolPhase(result.phase)) true else result.promotionTargetFactsCurrent,
        }),
        targetFactsCurrent: true,
        targetHeadProof:
          if (result.expectedTargetHead == 0) result.plannedTargetHead else result.expectedTargetHead,
      },
    }
  }

  pure def canReacquireTarget(s: State, id: int): bool = {
    val result = s.results.get(id)
    and {
      RESULT_IDS.contains(id),
      s.trackerFactsCurrent,
      s.targetReacquisitionRequired,
      targetReacquisitionPhase(result.phase),
      not(result.targetHeld),
      result.expectedTargetHead != 0,
      fixedIntegratorSessionPhase(result.phase)
        or and {
          s.targetFactsCurrent,
          s.targetHeadProof == result.expectedTargetHead,
        },
      not(RESULT_IDS.exists(other => s.results.get(other).targetHeld)),
    }
  }

  action reacquireIntegrationTarget(id: int): bool = {
    val result = state.results.get(id)
    all {
      canReacquireTarget(state, id),
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase:
            if (result.phase == CandidateGitReadPending and result.candidateGitResponseAmbiguous)
              CandidateGitReadIntent
            else result.phase,
          targetHeld: true,
          candidateGitResponseAmbiguous:
            if (result.phase == CandidateGitReadPending) false else result.candidateGitResponseAmbiguous,
        }),
        targetReacquisitionRequired:
          RESULT_IDS.exists(other =>
            other != id
              and not(state.results.get(other).targetHeld)
              and targetReacquisitionPhase(state.results.get(other).phase)
          ),
      },
    }
  }

  // Concrete wrappers keep parameterized helpers available to deterministic
  // scenarios and make every normal protocol action reachable to Quint runs.
  action acceptResultOne: bool = acceptResult(1)
  action acceptResultTwo: bool = acceptResult(2)
  action observeAppliedRestartBeforeAcceptedOne: bool = observeAppliedRestartBeforeAccepted(1)
  action queueAcceptedResultOne: bool = queueAcceptedResult(1)
  action queueAcceptedResultTwo: bool = queueAcceptedResult(2)
  action startIntegrationOne: bool = startIntegration(1)
  action startIntegrationTwo: bool = startIntegration(2)
  action waitOnDependencyOne: bool = waitOnDependency(1)
  action fixIntegratorSessionOne: bool = fixIntegratorSession(1)
  action fixIntegratorSessionTwo: bool = fixIntegratorSession(2)
  action invokeIntegratorOne: bool = invokeIntegrator(1)
  action loseIntegratorResponseOne: bool = loseIntegratorResponse(1)
  action reacquireIntegrationTargetOne: bool = reacquireIntegrationTarget(1)
  action resumeIntegratorOne: bool = resumeIntegrator(1)
  action reportIntegratorNotPreparedOne: bool = reportIntegratorNotPrepared(1)
  action reportIntegratorCandidateOne31: bool = reportIntegratorCandidate(1, 31)
  action reportIntegratorCandidateOne32: bool = reportIntegratorCandidate(1, 32)
  action recordCandidateGitReadIntentOne: bool = recordCandidateGitReadIntent(1)
  action readCandidateGitOne: bool = readCandidateGit(1)
  action loseCandidateGitResponseOne: bool = loseCandidateGitResponse(1)
  action reconcileCandidateGitOne: bool = reconcileCandidateGit(1)
  action observeExactCandidateOne: bool = observeExactCandidate(1)
  action observeMissingCandidateOne: bool = observeMissingCandidate(1)
  action observeNonCommitCandidateOne: bool = observeNonCommitCandidate(1)
  action observeWrongParentCandidateOne: bool = observeWrongParentCandidate(1)
  action offerPromotionPremiseOne: bool = offerPromotionPremise(1)
  action recordPromotionIntentOne: bool = recordPromotionIntent(1)
  action recordPromotionAttemptIntentOne: bool = recordPromotionAttemptIntent(1)
  action sendPromotionAttemptOne: bool = sendPromotionAttempt(1)
  action losePromotionAttemptResponseOne: bool = losePromotionResponse(1)
  action reconcilePromotionOne: bool = reconcilePromotion(1)
  action observePromotionCandidateCurrentOne: bool = observePromotionCandidateCurrent(1)
  action observePromotionCandidateAncestorOne: bool = observePromotionCandidateAncestor(1)
  action observePromotionExactExpectedHeadOne: bool = observePromotionExactExpectedHead(1)
  action observePromotionOtherHeadOne: bool = observePromotionOtherHead(1)
  action observePromotionGitUnreadableOne: bool = observePromotionGitUnreadable(1)
  action assignResultTwoIndependentTargetOne: bool = assignResultTwoIndependentTarget
  action loseCandidateGitResponseTwo: bool = loseCandidateGitResponse(2)
  action recoverCoordinatorStep: bool = recoverCoordinator
  action observeTrackerFactsStep: bool = observeTrackerFacts
  action observeTargetFactsOne: bool = observeTargetFacts(1)
  action observeTargetFactsTwo: bool = observeTargetFacts(2)
  action observeIncompatibleTargetLineageOne: bool = observeIncompatibleTargetLineage(1)

  // Changed-head observations are external Git controls exercised by the
  // exact scenario tests; they stay outside the unconstrained scheduler step
  // because one global finite target proof cannot represent an independent
  // target's fact safely. Incompatible lineage is safe in the scheduler: it
  // only leaves a queued result blocked before session creation.

  action step: bool = any {
    observeAppliedRestartBeforeAcceptedOne,
    acceptResultOne,
    acceptResultTwo,
    queueAcceptedResultOne,
    queueAcceptedResultTwo,
    startIntegrationOne,
    startIntegrationTwo,
    waitOnDependencyOne,
    fixIntegratorSessionOne,
    fixIntegratorSessionTwo,
    invokeIntegratorOne,
    loseIntegratorResponseOne,
    reacquireIntegrationTargetOne,
    resumeIntegratorOne,
    reportIntegratorNotPreparedOne,
    reportIntegratorCandidateOne31,
    reportIntegratorCandidateOne32,
    recordCandidateGitReadIntentOne,
    readCandidateGitOne,
    loseCandidateGitResponseOne,
    reconcileCandidateGitOne,
    observeExactCandidateOne,
    observeMissingCandidateOne,
    observeNonCommitCandidateOne,
    observeWrongParentCandidateOne,
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
    recoverCoordinatorStep,
    observeTrackerFactsStep,
    observeTargetFactsOne,
    observeIncompatibleTargetLineageOne,
  }
}
