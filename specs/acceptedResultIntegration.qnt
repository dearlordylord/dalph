// Models issues #56, #57, and #59: accepted-result admission plus one fixed
// integration session that accepts only an explicit submitted commit whose
// ordered direct parents are [current target head, accepted result]. The
// verification boundary is one public wrapper request with a fixed opaque
// plan. Promotion itself, executor internals, and post-milestone retry policy
// remain absent.
module acceptedResultIntegration {
  type Phase =
    | NoAcceptedResult
    | AcceptedResult
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
    ).contains(phase)

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

  val releasedLogicalBlockerReached: bool =
    RESULT_IDS.exists(id =>
      Set(
        CorrectionLimitReached,
        ContinuationLimitReached,
        CorrelationContradictionReleased,
        VerificationPassed,
        PromotionPremise,
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
        Set(VerificationPassed, PromotionPremise).contains(result.phase),
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

  action init: bool = all {
    state' = {
      results: RESULT_IDS.mapBy(id => {
        phase: NoAcceptedResult,
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

  action acceptResult(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == NoAcceptedResult,
      state' = {
        ...state,
        results: state.results.put(id, { ...result, phase: AcceptedResult }),
      },
    }
  }

  action queueAcceptedResult(id: int): bool = {
    val result = state.results.get(id)
    all {
      RESULT_IDS.contains(id),
      result.phase == AcceptedResult,
      state' = {
        ...state,
        results: state.results.put(id, {
          ...result,
          phase: Queued,
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
        targetReacquisitionRequired: false,
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
            else
              result.phase,
          targetHeld: false,
        }
      }),
      recovered: true,
      restartCount: state.restartCount + 1,
      trackerFactsCurrent: false,
      targetFactsCurrent: false,
      targetHeadProof: 0,
      targetReacquisitionRequired: true,
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
        targetReacquisitionRequired: false,
      },
    }
  }

  // Quint traces retain action names but not the arguments passed to action
  // definitions. These concrete executable actions preserve the parameterized
  // helpers above for exact tests while giving the TypeScript conformance
  // adapter an unambiguous production operation for every trace step.
  action acceptResultOne: bool = acceptResult(1)
  action acceptResultTwo: bool = acceptResult(2)
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
  action offerPromotionPremiseOne: bool = offerPromotionPremise(1)
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

  action step: bool = any {
    acceptResultOne,
    acceptResultTwo,
    queueAcceptedResultOne,
    queueAcceptedResultTwo,
    startIntegrationOne,
    startIntegrationTwo,
    waitOnDependencyOne,
    waitOnDependencyTwo,
    submitCandidateOne31,
    submitCandidateOne32,
    submitCandidateTwo31,
    submitCandidateTwo32,
    observeExactCandidateOne,
    observeExactCandidateTwo,
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
    observeInvalidCandidateOne,
    observeInvalidCandidateTwo,
    gitReadFailsOne,
    gitReadFailsTwo,
    reportWithoutCandidateOne,
    reportWithoutCandidateTwo,
    reportForeignCorrelationOne,
    reportForeignCorrelationTwo,
    releaseForeignCorrelationTargetOne,
    releaseForeignCorrelationTargetTwo,
    reacquireIntegrationTargetOne,
    reacquireIntegrationTargetTwo,
    recoverCoordinator,
    observeTrackerFacts,
    observeTargetFactsOne,
    observeTargetFactsTwo,
  }
}
