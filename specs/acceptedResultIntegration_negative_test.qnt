// Negative controls for issue #56 admission and issue #222's outer
// Integrator/Git boundary. Each mutation is deliberately reachable, then
// violates one invariant that must reject the shortcut.
module acceptedResultIntegrationNegativeTest {
  import acceptedResultIntegration.* from "./acceptedResultIntegration"

  action queueLateAcceptedAfterRestart: bool = {
    val result = state.results.get(1)
    all {
      result.phase == LateAcceptedEvidence,
      result.restartChoiceCommittedBeforeTerminal,
      state' = {
        ...state,
        results: state.results.put(1, {
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

  action discardOrdinaryAcceptedResponsibility: bool = {
    val result = state.results.get(1)
    all {
      result.phase == Queued,
      result.integrationResponsibilityRecorded,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          integrationResponsibilityRecorded: false,
          integrationResponsibilityCount: 0,
        }),
      },
    }
  }

  action discardLateAcceptedEvidence: bool = {
    val result = state.results.get(1)
    all {
      result.phase == LateAcceptedEvidence,
      state' = {
        ...state,
        results: state.results.put(1, { ...result, acceptedEvidencePreserved: false }),
      },
    }
  }

  // A resource locator cannot remain "the same resource" while its binding
  // silently substitutes another accepted-result commit.
  action substituteIntegratorResourceCommit: bool = {
    val result = state.results.get(1)
    all {
      result.phase == IntegratorSessionFixed,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          resourceBoundCommit: result.acceptedResultCommit + 1,
        }),
      },
    }
  }

  // A queue successor is forbidden while an earlier same-target responsibility
  // is still logically unfinished, including a rejected candidate.
  action startLaterQueueAfterRejectedCandidate: bool = {
    val result = state.results.get(2)
    all {
      state.results.get(1).phase == Quarantined,
      result.phase == Queued,
      state' = {
        ...state,
        results: state.results.put(2, {
          ...result,
          phase: Started,
          targetHeld: true,
          integrationSession: 2,
          expectedTargetHead: 12,
        }),
      },
    }
  }

  action startLaterQueueAfterPromotionPremise: bool = {
    val result = state.results.get(2)
    all {
      state.results.get(1).phase == PromotionPremise,
      result.phase == Queued,
      state' = {
        ...state,
        results: state.results.put(2, {
          ...result,
          phase: Started,
          targetHeld: true,
          integrationSession: 2,
          expectedTargetHead: 12,
        }),
      },
    }
  }

  // Forbidden shortcut: make a promotion-bound lease appear without the
  // fresh Git facts required after recovery.
  action reacquireWithoutFreshTargetHead: bool = {
    val result = state.results.get(1)
    all {
      result.phase == CandidateReady,
      state.targetReacquisitionRequired,
      not(state.targetFactsCurrent),
      not(result.targetHeld),
      state' = {
        ...state,
        results: state.results.put(1, { ...result, targetHeld: true }),
      },
    }
  }

  // Forbidden mutation: releasing one independent target must not erase the
  // fresh head proof still owned by another held target responsibility.
  action eraseIndependentHeldTargetProof: bool = {
    val released = state.results.get(1)
    val held = state.results.get(2)
    all {
      released.phase == IntegratorInFlight,
      released.targetHeld,
      held.phase == Started,
      held.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...released,
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

  // Forbidden mutation: run two reports NotPrepared but leaves the rejected
  // candidate projection from run one attached to the session's current
  // result.
  action reportRetryNotPreparedKeepingPriorCandidate: bool = {
    val result = state.results.get(1)
    all {
      result.phase == RetryInFlight,
      result.targetHeld,
      result.integratorRunOrdinal == 2,
      result.submittedCandidate != 0,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: IntegratorNotPrepared,
          integratorOutcome: NotPrepared,
          integratorResultRecorded: true,
          candidateReported: false,
          integratorResponseAmbiguous: false,
          promotionAuthorized: false,
          quarantineRecorded: false,
        }),
      },
    }
  }

  // Forbidden mutation: a conflict belongs to Q1 and cannot be carried into
  // the fresh direction history of Q2.
  action carryPriorConflictIntoFreshQuarantine: bool = {
    val result = state.results.get(1)
    all {
      result.phase == Quarantined,
      result.quarantineOccurrenceCount == 2,
      result.quarantineDirection == NoQuarantineDirection,
      result.quarantineConflictCount == 0,
      state' = {
        ...state,
        results: state.results.put(1, { ...result, quarantineConflictCount: 1 }),
      },
    }
  }

  // Each of these four actions makes the same invalid promotion claim from a
  // different non-authoritative source. Git qualification must reject all of
  // them: an explicit report plus exact [H,C] parents is still required.
  action promoteUnreportedCandidate: bool = {
    val result = state.results.get(1)
    all {
      result.phase == IntegratorInFlight,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: PreparedCandidate,
          integratorResultRecorded: true,
          candidateReported: false,
          submittedCandidate: 31,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateExactParents,
          candidateQualificationProven: true,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  // These source-only shortcuts begin directly at IntegratorInFlight. They
  // deliberately carry no durable Integrator result and no explicit M report;
  // process success, resource HEAD, legacy evidence, and equal content cannot
  // manufacture the promotion premise.
  action promoteFromProcessSuccessWithoutIntegratorResult: bool = {
    val result = state.results.get(1)
    all {
      result.phase == IntegratorInFlight,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: NoIntegratorOutcome,
          integratorResultRecorded: false,
          candidateReported: false,
          submittedCandidate: 31,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateExactParents,
          candidateQualificationProven: true,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          processSuccessObserved: true,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  action promoteFromResourceHeadWithoutIntegratorResult: bool = {
    val result = state.results.get(1)
    all {
      result.phase == IntegratorInFlight,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: NoIntegratorOutcome,
          integratorResultRecorded: false,
          candidateReported: false,
          submittedCandidate: 77,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateExactParents,
          candidateQualificationProven: true,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          resourceHeadCandidate: 77,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  action promoteFromLegacyVerificationWithoutIntegratorResult: bool = {
    val result = state.results.get(1)
    all {
      result.phase == IntegratorInFlight,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: NoIntegratorOutcome,
          integratorResultRecorded: false,
          candidateReported: false,
          submittedCandidate: 31,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateExactParents,
          candidateQualificationProven: true,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          legacyVerificationEvidence: true,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  action promoteEquivalentContentWithoutIntegratorResult: bool = {
    val result = state.results.get(1)
    all {
      result.phase == IntegratorInFlight,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: NoIntegratorOutcome,
          integratorResultRecorded: false,
          candidateReported: false,
          submittedCandidate: 88,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateExactParents,
          candidateQualificationProven: true,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          promotionEquivalentContentAccepted: true,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  action promoteFromResourceHead: bool = {
    val result = state.results.get(1)
    all {
      result.phase == CandidateGitReadPending,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: PreparedCandidate,
          integratorResultRecorded: true,
          candidateReported: true,
          submittedCandidate: 77,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateExactParents,
          candidateQualificationProven: true,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          resourceHeadCandidate: 77,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  action promoteFromProcessSuccess: bool = {
    val result = state.results.get(1)
    all {
      result.phase == CandidateGitReadPending,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: PreparedCandidate,
          integratorResultRecorded: true,
          candidateReported: true,
          submittedCandidate: 31,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateExactParents,
          candidateQualificationProven: true,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          processSuccessObserved: true,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  action promoteFromLegacyVerification: bool = {
    val result = state.results.get(1)
    all {
      result.phase == CandidateGitReadPending,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: PreparedCandidate,
          integratorResultRecorded: true,
          candidateReported: true,
          submittedCandidate: 31,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateExactParents,
          candidateQualificationProven: true,
          observedFirstParent: result.expectedTargetHead,
          observedSecondParent: result.acceptedResultCommit,
          legacyVerificationEvidence: true,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  action promoteWithWrongParents: bool = {
    val result = state.results.get(1)
    all {
      result.phase == CandidateGitReadPending,
      result.targetHeld,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: CandidateReady,
          integratorOutcome: PreparedCandidate,
          integratorResultRecorded: true,
          candidateReported: true,
          submittedCandidate: 31,
          candidateGitReadIntentRecorded: true,
          candidateGitReadCount: 1,
          candidateGitObservation: CandidateWrongParents,
          candidateQualificationProven: true,
          observedFirstParent: 99,
          observedSecondParent: 98,
          promotionAuthorized: true,
          targetHeld: false,
        }),
      },
    }
  }

  // A crashed session cannot allocate S2 or count a resume as an invocation.
  action allocateSuccessorAfterIntegratorCrash: bool = {
    val result = state.results.get(1)
    all {
      result.phase == IntegratorResponseLost,
      result.integrationSession == 1,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: IntegratorInFlight,
          integrationSession: 99,
          integratorInvocationCount: 2,
          targetHeld: true,
        }),
      },
    }
  }

  action mintFourthPromotionAttempt: bool = {
    val result = state.results.get(1)
    all {
      result.phase == PromotionRetryReady,
      result.promotionAttemptCount > 0,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: PromotionInFlight,
          targetHeld: true,
          promotionAttemptCount: PROMOTION_ATTEMPT_LIMIT + 1,
          promotionLastAttempt: PROMOTION_ATTEMPT_LIMIT + 1,
          promotionCompareAndSetRequested: true,
        }),
      },
    }
  }

  // Forbidden release shortcut: the live target is released before the
  // conclusive result has a durable quarantine occurrence.
  action releaseBeforeQuarantine: bool = {
    val result = state.results.get(1)
    all {
      result.phase == IntegratorNotPrepared,
      result.targetHeld,
      not(result.quarantineRecorded),
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: Quarantined,
          targetHeld: false,
        }),
      },
    }
  }

  // A quarantine has no automatic retry path; a Retry direction must be the
  // durable first choice before a new outer run can begin.
  action retryWithoutChoice: bool = {
    val result = state.results.get(1)
    all {
      result.phase == Quarantined,
      result.quarantineDirection == NoQuarantineDirection,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: RetryInFlight,
          targetHeld: true,
          retryRunCount: 1,
        }),
      },
    }
  }

  action conflictingDirectionWins: bool = {
    val result = state.results.get(1)
    all {
      result.phase == RetrySelected,
      result.quarantineDirection == RetryDirection,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          quarantineDirection: FullRerunDirection,
        }),
      },
    }
  }

  // A stale fixed H cannot be used to launch the Retry-selected outer run.
  action retryAgainstChangedHead: bool = {
    val result = state.results.get(1)
    all {
      result.phase == RetrySelected,
      result.quarantineDirection == RetryDirection,
      state.targetFactsCurrent,
      state.targetHeadProof != result.expectedTargetHead,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: RetryInFlight,
          targetHeld: true,
          retryRunCount: 1,
        }),
      },
    }
  }

  // Forbidden recovery mutation: Q1 is the durable authorization for the
  // already-started Retry run and cannot disappear when Dalph restarts.
  action eraseRetryQuarantineOnRecovery: bool = {
    val result = state.results.get(1)
    all {
      result.phase == RetrySelected,
      result.retryRunCount == 1,
      result.integratorRunOrdinal == 2,
      state' = {
        ...state,
        results: state.results.put(1, { ...result, quarantineRecorded: false }),
      },
    }
  }

  // Forbidden projection mutation: Q2's later FullRerun direction cannot
  // erase the exact Retry direction that authorized the already-run ordinal 2.
  action eraseRetryDirectionEvidenceAfterFullRerun: bool = {
    val result = state.results.get(1)
    all {
      result.phase == FullRerunSelected,
      result.retryRunCount == 1,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          retryDirectionSession: 0,
          retryDirectionPosition: 0,
        }),
      },
    }
  }

  // Forbidden control mutation: Q2 cannot authorize a second Retry for S.
  action chooseRetryAfterQ2: bool = {
    val result = state.results.get(1)
    all {
      result.phase == Quarantined,
      result.retryRunCount == 1,
      result.quarantineOccurrenceCount == 2,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          phase: RetrySelected,
          quarantineDirection: RetryDirection,
          quarantineDirectionSession: result.integrationSession,
          quarantineDirectionPosition: result.quarantinePosition,
          quarantineDirectionCount: result.quarantineDirectionCount + 1,
          lastDirection: RetryDirection,
          lastDirectionSession: result.integrationSession,
          lastDirectionPosition: result.quarantinePosition,
        }),
      },
    }
  }

  action allocateSecondSuccessor: bool = {
    val result = state.results.get(1)
    all {
      result.phase == SuccessorSessionFixed,
      result.successorFixed,
      result.successorRunCount == 1,
      state' = {
        ...state,
        results: state.results.put(1, {
          ...result,
          successorSession: result.successorSession + 1,
          successorResource: result.successorResource + 1,
          successorRunCount: 2,
        }),
      },
    }
  }

  run releaseBeforeQuarantineViolatesDurableBoundaryTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorNotPrepared(1))
      .then(releaseBeforeQuarantine)
      .expect(not(quarantinePhaseRequiresRecordedOccurrence))
  }

  run retryWithoutChoiceViolatesNoAutomaticRetryTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorNotPrepared(1))
      .then(recordQuarantine(1))
      .then(retryWithoutChoice)
      .expect(and {
        not(retryRequiresOneExplicitChoice),
        not(quarantineDirectionIsExactAndFirst),
      })
  }

  run fullRerunCannotErasePriorRetryAuthorizationTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorNotPrepared(1))
      .then(recordQuarantine(1))
      .then(chooseRetry(1, state.results.get(1).quarantinePosition))
      .then(startRetry(1))
      .then(reportIntegratorNotPrepared(1))
      .then(recordQuarantine(1))
      .then(chooseFullRerun(1, state.results.get(1).quarantinePosition))
      .then(eraseRetryDirectionEvidenceAfterFullRerun)
      .expect(not(retryRequiresOneExplicitChoice))
  }

  run q2CannotAuthorizeASecondRetryTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorNotPrepared(1))
      .then(recordQuarantine(1))
      .then(chooseRetry(1, state.results.get(1).quarantinePosition))
      .then(startRetry(1))
      .then(reportIntegratorNotPrepared(1))
      .then(recordQuarantine(1))
      .then(chooseRetryAfterQ2)
      .expect(not(retryDirectionIsBounded))
  }

  run conflictingDirectionCannotReplaceFirstChoiceTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorNotPrepared(1))
      .then(recordQuarantine(1))
      .then(chooseRetry(1, state.results.get(1).quarantinePosition))
      .then(conflictingDirectionWins)
      .expect(not(quarantineDirectionIsExactAndFirst))
  }

  run retryCannotUseChangedHeadTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorNotPrepared(1))
      .then(recordQuarantine(1))
      .then(chooseRetry(1, state.results.get(1).quarantinePosition))
      .then(observeChangedTargetHead(1))
      .then(retryAgainstChangedHead)
      .expect(not(retryUsesSameSessionAndCurrentHead))
  }

  run successorCannotBeAllocatedTwiceTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorNotPrepared(1))
      .then(recordQuarantine(1))
      .then(observeChangedTargetHead(1))
      .then(chooseFullRerun(1, state.results.get(1).quarantinePosition))
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(observeSuccessorTargetHead(1))
      .then(startFullRerun(1))
      .then(allocateSecondSuccessor)
      .expect(not(successorAllocationIsBounded))
  }

  run retryRecoveryCannotEraseAuthorizingQuarantineTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorNotPrepared(1))
      .then(recordQuarantine(1))
      .then(chooseRetry(1, state.results.get(1).quarantinePosition))
      .then(startRetry(1))
      .then(recoverCoordinator)
      .then(eraseRetryQuarantineOnRecovery)
      .expect(not(quarantinePhaseRequiresRecordedOccurrence))
  }

  run lateAcceptedAfterRestartCannotBeQueuedForIntegrationTest = {
    init
      .then(observeAppliedRestartBeforeAccepted(1))
      .then(acceptResult(1))
      .then(queueLateAcceptedAfterRestart)
      .expect(and {
        not(ordinaryAcceptedAdmissionRecordsOneResponsibility),
        not(lateAcceptedAfterRestartNeverCreatesIntegrationResponsibility),
      })
  }

  run ordinaryAcceptedCannotLoseItsOneResponsibilityTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(discardOrdinaryAcceptedResponsibility)
      .expect(not(ordinaryAcceptedAdmissionRecordsOneResponsibility))
  }

  run lateAcceptedEvidenceCannotBeDiscardedTest = {
    init
      .then(observeAppliedRestartBeforeAccepted(1))
      .then(acceptResult(1))
      .then(discardLateAcceptedEvidence)
      .expect(not(acceptedEvidenceIsNeverDiscarded))
  }

  run rejectedCandidateCannotAdvanceLaterSameTargetQueueTest = {
    init
      .then(acceptResult(1))
      .then(acceptResult(2))
      .then(queueAcceptedResult(1))
      .then(queueAcceptedResult(2))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(observeMissingCandidate(1))
      .then(recordQuarantine(1))
      .then(startLaterQueueAfterRejectedCandidate)
      .expect(not(logicalIntegrationResponsibilityBlocksLaterQueue))
  }

  run staleTargetCannotAuthorizePromotionReacquisitionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(observeExactCandidate(1))
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(reacquireWithoutFreshTargetHead)
      .expect(not(mutableTargetWorkReacquisitionUsesFreshExpectedHead))
  }


  run independentResponseLossCannotEraseHeldTargetProofTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(acceptResult(2))
      .then(assignResultTwoIndependentTarget)
      .then(queueAcceptedResult(2))
      .then(startIntegration(2))
      .then(eraseIndependentHeldTargetProof)
      .expect(not(mutableTargetWorkReacquisitionUsesFreshExpectedHead))
  }


  run retryNotPreparedCannotKeepRejectedRunOneCandidateTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(observeNonCommitCandidate(1))
      .then(recordQuarantine(1))
      .then(chooseRetryOne)
      .then(startRetryOne)
      .then(reportRetryNotPreparedKeepingPriorCandidate)
      .expect(and {
        not(conclusiveNotPreparedHasNoCandidate),
        not(candidateGitIntentPrecedesObservation),
      })
  }


  run freshQuarantineCannotCarryPriorDirectionConflictTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorNotPrepared(1))
      .then(recordQuarantine(1))
      .then(chooseRetryOne)
      .then(rejectConflictingFullRerun(1, state.results.get(1).quarantineDirectionPosition))
      .then(startRetryOne)
      .then(reportIntegratorNotPrepared(1))
      .then(recordQuarantine(1))
      .then(carryPriorConflictIntoFreshQuarantine)
      .expect(not(conflictingDirectionIsNoOp))
  }

  run unreportedCandidateCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(promoteUnreportedCandidate)
      .expect(not(candidateReportIsExplicit))
  }

  run processSuccessWithoutIntegratorResultCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(promoteFromProcessSuccessWithoutIntegratorResult)
      .expect(and {
        not(candidateReportIsExplicit),
        not(candidateQualificationRequiresExactParents),
        not(noForbiddenEvidenceAuthorizesPromotion),
      })
  }

  run resourceHeadWithoutIntegratorResultCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(promoteFromResourceHeadWithoutIntegratorResult)
      .expect(and {
        not(candidateReportIsExplicit),
        not(candidateQualificationRequiresExactParents),
        not(noForbiddenEvidenceAuthorizesPromotion),
      })
  }

  run legacyVerificationWithoutIntegratorResultCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(promoteFromLegacyVerificationWithoutIntegratorResult)
      .expect(and {
        not(candidateReportIsExplicit),
        not(candidateQualificationRequiresExactParents),
        not(noForbiddenEvidenceAuthorizesPromotion),
      })
  }

  run equivalentContentWithoutIntegratorResultCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(promoteEquivalentContentWithoutIntegratorResult)
      .expect(and {
        not(candidateReportIsExplicit),
        not(candidateQualificationRequiresExactParents),
        not(noForbiddenEvidenceAuthorizesPromotion),
        not(promotionNoForceOrEquivalentShortcut),
      })
  }

  run resourceHeadCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(promoteFromResourceHead)
      .expect(not(noForbiddenEvidenceAuthorizesPromotion))
  }

  run processSuccessCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(promoteFromProcessSuccess)
      .expect(not(noForbiddenEvidenceAuthorizesPromotion))
  }

  run legacyVerificationCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(promoteFromLegacyVerification)
      .expect(not(noForbiddenEvidenceAuthorizesPromotion))
  }

  run wrongParentCandidateCannotAuthorizePromotionTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(promoteWithWrongParents)
      .expect(not(candidateQualificationRequiresExactParents))
  }

  run crashedIntegratorCannotAllocateSuccessorTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(loseIntegratorResponse(1))
      .then(allocateSuccessorAfterIntegratorCrash)
      .expect(and {
        not(noAutomaticIntegratorSuccessor),
        not(sessionIdentityFixedAfterStart),
      })
  }

  run integratorResourceCannotSubstituteCommitTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(substituteIntegratorResourceCommit)
      .expect(not(integratorResourceIsExactlyBound))
  }

  run promotionPremiseCannotAdvanceLaterSameTargetQueueTest = {
    init
      .then(acceptResult(1))
      .then(acceptResult(2))
      .then(queueAcceptedResult(1))
      .then(queueAcceptedResult(2))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(observeExactCandidate(1))
      .then(offerPromotionPremise(1))
      .then(startLaterQueueAfterPromotionPremise)
      .expect(not(logicalIntegrationResponsibilityBlocksLaterQueue))
  }

  run fourthPromotionAttemptViolatesBoundTest = {
    init
      .then(acceptResult(1))
      .then(queueAcceptedResult(1))
      .then(startIntegration(1))
      .then(fixIntegratorSession(1))
      .then(invokeIntegrator(1))
      .then(reportIntegratorCandidate(1, 31))
      .then(recordCandidateGitReadIntent(1))
      .then(readCandidateGit(1))
      .then(observeExactCandidate(1))
      .then(offerPromotionPremise(1))
      .then(recordPromotionIntent(1))
      .then(observePromotionExactExpectedHead(1))
      .then(recordPromotionAttemptIntent(1))
      .then(sendPromotionAttempt(1))
      .then(losePromotionResponse(1))
      .then(recoverCoordinator)
      .then(observeTrackerFacts)
      .then(observeTargetFacts(1))
      .then(reconcilePromotion(1))
      .then(observePromotionExactExpectedHead(1))
      .then(mintFourthPromotionAttempt)
      .expect(not(promotionAttemptsAreBounded))
  }
}
