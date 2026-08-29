// Deliberately illegal transitions show that every projected issue #65 safety
// family can turn red. These are negative controls, not alternative behavior.
module taskFactChoiceProofNegativeTest {
  import taskFactChoiceProof.* from "./taskFactReconciliation_proof"

  action overwriteFirstWinner: bool = all {
    state.f2Choice == ContinueChoice,
    state' = { ...state, f2Choice: StopChoice },
  }

  action duplicateExactRedelivery: bool = all {
    state.lastEvent == ExactChoiceRedelivered,
    state' = { ...state, appliedChoiceCount: state.appliedChoiceCount + 1 },
  }

  action resumeWithoutExecutorRead: bool = all {
    state.continueStage == NeedExecutor,
    state' = {
      ...state,
      continueStage: Resumed,
      resumedAttempt: AttemptP,
      lastEvent: AttemptPResumed,
    },
  }

  action resumeF3WithoutNewChoice: bool = all {
    state.continueStage == NewChoiceRequired,
    state' = {
      ...state,
      continueStage: Resumed,
      resumedAttempt: AttemptP,
      lastEvent: AttemptPResumed,
    },
  }

  action confuseRunMismatchWithContentReuse: bool = all {
    state.lastEvent == Initialized,
    state' = {
      ...state,
      controlResult: PersistedRequestContentContradiction,
      lastEvent: RunMismatchRejected,
    },
  }

  action crossBoundaryAfterCutoffRejection: bool = all {
    state.lastEvent == PostCutoffChoiceRejected,
    state' = { ...state, executorRestartedByRejectedChoice: true },
  }

  run firstWinnerOverwriteIsDetectedTest = {
    init
      .then(observeF2)
      .then(applyContinueF2)
      .then(overwriteFirstWinner)
      .expect(not(firstChoiceAndExactRedeliveryAreIdempotent))
  }

  run duplicateRedeliveryIsDetectedTest = {
    init
      .then(observeF2)
      .then(applyContinueF2)
      .then(redeliverExactChoice)
      .then(duplicateExactRedelivery)
      .expect(not(firstChoiceAndExactRedeliveryAreIdempotent))
  }

  run missingSixthFreshReadIsDetectedTest = {
    init
      .then(observeF2)
      .then(applyContinueF2)
      .then(readFreshGraph)
      .then(readFreshSpecification)
      .then(readFreshClaim)
      .then(readFreshWorktree)
      .then(readFreshLineage)
      .then(resumeWithoutExecutorRead)
      .expect(not(continueUsesSixFreshReadsForImmutableP))
  }

  run f3ResumeWithoutNewChoiceIsDetectedTest = {
    init
      .then(observeF2)
      .then(applyContinueF2)
      .then(observeF3)
      .then(resumeF3WithoutNewChoice)
      .expect(not(laterF3RequiresItsOwnChoiceAndFreshReads))
  }

  run requestIdentityErrorConfusionIsDetectedTest = {
    init
      .then(confuseRunMismatchWithContentReuse)
      .expect(not(requestIdentityErrorsStayDistinct))
  }

  run postCutoffSideEffectIsDetectedTest = {
    init
      .then(beginIntegration)
      .then(observeF2)
      .then(rejectContinuePastCutoff)
      .then(crossBoundaryAfterCutoffRejection)
      .expect(not(postCutoffChoiceHasNoDownstreamEffect))
  }
}

module taskFactStopProofNegativeTest {
  import taskFactStopProof.* from "./taskFactReconciliation_proof"

  action abandonWhileRunning: bool = all {
    state.stopApplied,
    state.evidence == ExactRunning,
    state' = {
      ...state,
      stage: NeedClaimObservation,
      implementationRetained: false,
      positionHeld: false,
      lastEvent: ImplementationAbandoned,
    },
  }

  action releaseClaimWhileWriterUnproved: bool = all {
    state.stopApplied,
    state.evidence == ExactRunning,
    state' = { ...state, claimHeld: false },
  }

  action deleteWorktreeAfterStop: bool = all {
    state.stopApplied,
    state' = { ...state, worktreePreserved: false, cleanupSelected: true },
  }

  action recordFourthStopIntent: bool = all {
    state.callCount == STOP_COMMAND_LIMIT,
    state.settlementCount == STOP_COMMAND_LIMIT,
    state.activeOrdinal == 0,
    state' = {
      ...state,
      stage: IntentRecorded,
      activeOrdinal: state.nextOrdinal,
      nextOrdinal: state.nextOrdinal + 1,
      intentCount: state.intentCount + 1,
      lastEvent: StopIntentRecorded,
    },
  }

  run abandonmentWithoutQuiescenceIsDetectedTest = {
    init
      .then(applyStop)
      .then(breakRetainedSafeProof)
      .then(abandonWhileRunning)
      .expect(not(abandonmentRequiresExactUnbrokenQuiescence))
  }

  run claimReleaseWhileWriterUnprovedIsDetectedTest = {
    init
      .then(applyStop)
      .then(breakRetainedSafeProof)
      .then(releaseClaimWhileWriterUnproved)
      .expect(not(unprovedWriterRetainsPositionAndClaim))
  }

  run artifactDeletionIsDetectedTest = {
    init
      .then(applyStop)
      .then(deleteWorktreeAfterStop)
      .expect(not(stopPreservesArtifactsAndNeverIntegrates))
  }

  run fourthStopIntentIsDetectedTest = {
    init
      .then(applyStop)
      .then(breakRetainedSafeProof)
      .then(recordStopIntent)
      .then(callStop)
      .then(loseStopResponse)
      .then(activateRecovery)
      .then(projectRunning)
      .then(recordStopIntent)
      .then(callStop)
      .then(loseStopResponse)
      .then(activateRecovery)
      .then(projectRunning)
      .then(recordStopIntent)
      .then(callStop)
      .then(loseStopResponse)
      .then(activateRecovery)
      .then(projectRunning)
      .then(recordFourthStopIntent)
      .expect(not(stoppageAndRecoveryAreBounded))
  }
}

module taskFactClaimProofNegativeTest {
  import taskFactClaimProof.* from "./taskFactReconciliation_proof"

  action releaseWithoutExactReadOrIntent: bool = all {
    state.stage == NeedObservation,
    state' = { ...state, releaseCallCount: state.releaseCallCount + 1 },
  }

  action mutateAfterNonExactObservation: bool = all {
    state.observation == ClaimAbsent
      or state.observation == ClaimForeign
      or state.observation == ClaimUnreadable,
    state' = { ...state, releaseCallCount: state.releaseCallCount + 1 },
  }

  action discardUnreadableResponsibility: bool = all {
    state.observation == ClaimUnreadable,
    state' = { ...state, unresolvedClaimReleaseResponsibility: false },
  }

  action disableIndependentTask: bool = all {
    state.independentTaskEligible,
    state' = { ...state, independentTaskEligible: false },
  }

  action issueFourthReleaseCall: bool = all {
    state.releaseCallCount == RELEASE_LIMIT,
    state' = { ...state, releaseCallCount: state.releaseCallCount + 1 },
  }

  run releaseBeforeExactReadAndIntentIsDetectedTest = {
    init
      .then(releaseWithoutExactReadOrIntent)
      .expect(not(claimChangesOnlyAfterAbandonmentExactReadAndIntent))
  }

  run absentClaimMutationIsDetectedTest = {
    init
      .then(observeAbsentClaim)
      .then(mutateAfterNonExactObservation)
      .expect(not(absentForeignUnreadableClaimsAreNeverMutated))
  }

  run foreignClaimMutationIsDetectedTest = {
    init
      .then(observeForeignClaim)
      .then(mutateAfterNonExactObservation)
      .expect(not(absentForeignUnreadableClaimsAreNeverMutated))
  }

  run unreadableClaimMutationIsDetectedTest = {
    init
      .then(observeUnreadableClaim)
      .then(mutateAfterNonExactObservation)
      .expect(not(absentForeignUnreadableClaimsAreNeverMutated))
  }

  run unreadableResponsibilityLossIsDetectedTest = {
    init
      .then(observeUnreadableClaim)
      .then(discardUnreadableResponsibility)
      .expect(not(unreadableClaimRetainsSeparateResponsibility))
  }

  run fourthClaimReleaseCallIsDetectedTest = {
    init
      .then(observeExactClaim)
      .then(recordReleaseIntent)
      .then(loseReleaseResponse)
      .then(projectClaimStillExact)
      .then(recoverLaterActivation)
      .then(observeExactClaim)
      .then(loseReleaseResponse)
      .then(projectClaimStillExact)
      .then(recoverLaterActivation)
      .then(observeExactClaim)
      .then(loseReleaseResponse)
      .then(issueFourthReleaseCall)
      .expect(not(claimReleaseIsBoundedAndReconciled))
  }

  run unrelatedTaskEligibilityLossIsDetectedTest = {
    init
      .then(disableIndependentTask)
      .expect(not(unrelatedTaskRemainsEligible))
  }
}

module taskFactActiveRefreshProofNegativeTest {
  import taskFactActiveRefreshProof.* from "./taskFactReconciliation_proof"

  action conflateActiveUnreadableWithOrdinarySuspension: bool = all {
    state.lastEvent == ActiveRefreshUnreadableObserved,
    state' = {
      ...state,
      decision: RequestSafeSuspension,
      constraint: UnreadableClaimConstraint,
      executorAction: SuspendExecutor,
    },
  }

  action authorizeContinueAfterHealthyRefresh: bool = all {
    state.lastEvent == ActiveRefreshHealthyObserved,
    state' = { ...state, decision: ContinueWork },
  }

  action releasePositionWhileStillRunning: bool = all {
    state.evidence == ExactRunning,
    state' = { ...state, positionHeld: false },
  }

  action offerBeforeRunningEstablishment: bool = all {
    state.lastEvent == Initialized,
    state' = {
      ...state,
      purpose: ActiveRefreshRead,
      decision: ContinueWork,
      evidence: ExactRunning,
      refreshSource: TrackerNotification,
      positionHeld: true,
      lastEvent: ActiveRefreshOffered,
    },
  }

  action offerFromUnknownSource: bool = all {
    state.lastEvent == ActiveWorkRunningEstablished,
    state' = {
      ...state,
      purpose: ActiveRefreshRead,
      decision: ContinueWork,
      evidence: ExactRunning,
      refreshSource: NoRefreshSource,
      positionHeld: true,
      lastEvent: ActiveRefreshOffered,
    },
  }

  run activeUnreadableSuspensionConflationIsDetectedTest = {
    init
      .then(establishRunningAttempt)
      .then(offerTrackerRefresh)
      .then(observeUnreadableActiveRefresh)
      .then(conflateActiveUnreadableWithOrdinarySuspension)
      .expect(not(activeRefreshUnreadableAuthorizesNoExecutorAction))
  }

  run healthyRefreshContinuationAuthorizationIsDetectedTest = {
    init
      .then(establishRunningAttempt)
      .then(offerTrackerRefresh)
      .then(observeHealthyActiveRefresh)
      .then(authorizeContinueAfterHealthyRefresh)
      .expect(not(healthyActiveRefreshAuthorizesNoExecutorAction))
  }

  run runningPositionReleaseIsDetectedTest = {
    init
      .then(establishRunningAttempt)
      .then(offerTrackerRefresh)
      .then(releasePositionWhileStillRunning)
      .expect(not(positionReleasesOnlyOnExactSafeEvidence))
  }

  run activeOfferBeforeRunningEstablishmentIsDetectedTest = {
    init
      .then(offerBeforeRunningEstablishment)
      .expect(not(activeRefreshOfferRequiresRunningEstablished))
  }

  run activeOfferFromUnknownSourceIsDetectedTest = {
    init
      .then(establishRunningAttempt)
      .then(offerFromUnknownSource)
      .expect(not(activeRefreshSourceIsTrackerOrTimer))
  }
}
