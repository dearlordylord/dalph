// Negative controls for the changed-task Continue-or-Stop protocol. Each
// action introduces one forbidden shortcut that a named invariant must reject.
module taskFactReconciliationNegativeTest {
  import taskFactReconciliation.* from "./taskFactReconciliation"

  action conflateRunBindingWithPersistedContentError: bool = all {
    state.lastAction == RunMismatchRejectedAction,
    state' = { ...state, lastControlResult: PersistedRequestContentContradiction },
  }

  action overwriteFirstF2Choice: bool = all {
    state.f2WinningChoice == ContinueChoice,
    state' = { ...state, f2WinningChoice: StopChoice },
  }

  action applyStopAfterCutoff: bool = all {
    state.phase == IntegrationStarted,
    state' = {
      ...state,
      firstF2Choice: StopChoice,
      f2WinningChoice: StopChoice,
      appliedChoiceCount: 1,
      stopStage: NeedQuiescence,
      lastControlResult: ChoiceApplied,
      lastAction: PostCutoffStopRejectedAction,
    },
  }

  action applyContinueAfterTerminalAlone: bool = all {
    state.executorEvidence == ExactTerminal,
    state.f2WinningChoice == NoChoice,
    state' = {
      ...state,
      f2WinningChoice: ContinueChoice,
      firstF2Choice: ContinueChoice,
      winningRequestId: CONTINUE_D1,
      winningSubject: SUBJECT_F2,
      appliedChoiceCount: 1,
      authorizedFingerprint: F2,
      continueStage: NeedFreshGraph,
    },
  }

  action applyStopAfterTerminalAlone: bool = all {
    state.executorEvidence == ExactTerminal,
    state.f2WinningChoice == NoChoice,
    state' = {
      ...state,
      f2WinningChoice: StopChoice,
      firstF2Choice: StopChoice,
      winningRequestId: STOP_D2,
      winningSubject: SUBJECT_F2,
      appliedChoiceCount: 1,
      stopStage: NeedQuiescence,
    },
  }

  action resumeWithoutEveryFreshAuthority: bool = all {
    state.continueStage == NeedFreshClaim,
    state' = { ...state, continueStage: ContinueResumed, resumedAttempt: AttemptP, positionHeld: true },
  }

  action resumeReplacementAttemptQ: bool = all {
    state.continueStage == ReadyToResume,
    state' = { ...state, continueStage: ContinueResumed, resumedAttempt: AttemptQ, positionHeld: true },
  }

  action resumeF2AfterF3WithoutNewChoice: bool = all {
    state.currentFingerprint == F3,
    state.f3WinningChoice == NoChoice,
    state' = { ...state, continueStage: ContinueResumed, resumedAttempt: AttemptP, positionHeld: true },
  }

  action abandonFromUnprovedExecutorState: bool = all {
    state.stopStage == NeedQuiescence,
    not(exactQuiescence(state)),
    state' = {
      ...state,
      implementationResponsibilityRetained: false,
      positionHeld: false,
      stopStage: NeedClaimObservation,
    },
  }

  action abandonFromBrokenSafeEvidence: bool = all {
    state.stopStage == NeedQuiescence,
    state.executorEvidence == ExactSafelySuspended,
    not(state.quiescenceUnbroken),
    state' = {
      ...state,
      implementationResponsibilityRetained: false,
      positionHeld: false,
      stopStage: NeedClaimObservation,
    },
  }

  action releaseClaimBeforeAbandonment: bool = all {
    state.implementationResponsibilityRetained,
    state' = { ...state, claimReleaseCallCount: state.claimReleaseCallCount + 1 },
  }

  action releaseUnreadableClaim: bool = all {
    state.claimObservation == ClaimUnreadable,
    state' = { ...state, claimReleaseCallCount: state.claimReleaseCallCount + 1 },
  }

  action releaseAbsentOrForeignClaim: bool = all {
    state.claimObservation == ClaimAbsent or state.claimObservation == ClaimForeign,
    state' = { ...state, claimReleaseCallCount: state.claimReleaseCallCount + 1 },
  }

  action destroyStoppedArtifacts: bool = all {
    not(state.implementationResponsibilityRetained),
    state' = { ...state, worktreePreserved: false, cleanupSelected: true },
  }

  action integrateStoppedAttempt: bool = all {
    stopChoiceApplied(state),
    state' = { ...state, integrationSelected: true },
  }

  action recordFourthStoppageIntent: bool = all {
    state.stopCommandIntentCount == STOP_COMMAND_LIMIT,
    not(stopCommandActive(state)),
    state' = {
      ...state,
      activeStopCommandOrdinal: state.nextStopCommandOrdinal,
      nextStopCommandOrdinal: state.nextStopCommandOrdinal + 1,
      stopCommandIntentCount: state.stopCommandIntentCount + 1,
    },
  }

  action takeSecondStopProjectionInActivation: bool = all {
    state.stopProjectionsThisActivation == 1,
    state' = { ...state, stopProjectionsThisActivation: 2 },
  }

  action makePostLimitReadOnlyStoppageRecoveryUnavailable: bool = all {
    state.stopCommandIntentCount == STOP_COMMAND_LIMIT,
    not(stopCommandActive(state)),
    state.stopProjectionsThisActivation == 1,
    state' = { ...state, stopRecoveryCount: RECOVERY_LIMIT + 1 },
  }

  action makeFourthClaimReleaseCall: bool = all {
    state.claimReleaseCallCount == 3,
    state' = { ...state, claimReleaseCallCount: 4 },
  }

  action dropUnreadableClaimResponsibility: bool = all {
    state.claimObservation == ClaimUnreadable,
    state' = { ...state, unresolvedClaimReleaseResponsibility: false },
  }

  action releasePositionWhileWriterIsUnproved: bool = all {
    state.stopStage == NeedQuiescence,
    not(exactQuiescence(state)),
    state' = { ...state, positionHeld: false },
  }

  run runBindingMismatchCannotBecomeContentContradictionTest = {
    init
      .then(rejectRunMismatchedRequest)
      .then(conflateRunBindingWithPersistedContentError)
      .expect(not(requestIdentityErrorsRemainDistinct))
  }

  run laterChoiceCannotOverwriteFirstJournaledWinnerTest = {
    init
      .then(observeF2Change)
      .then(applyContinueF2)
      .then(overwriteFirstF2Choice)
      .expect(not(firstJournaledChoiceWins))
  }

  run terminalPastCutoffCannotApplyStopTest = {
    init
      .then(observeExactTerminal)
      .then(beginIntegration)
      .then(observeF2Change)
      .then(applyStopAfterCutoff)
      .expect(not(postCutoffChoiceNeverApplies))
  }

  run terminalAloneCannotAuthorizeContinueTest = {
    init
      .then(observeF2Change)
      .then(observeExactTerminal)
      .then(applyContinueAfterTerminalAlone)
      .expect(not(terminalObservationAloneExposesNoChoice))
  }

  run terminalAloneCannotAuthorizeStopTest = {
    init
      .then(observeF2Change)
      .then(observeExactTerminal)
      .then(applyStopAfterTerminalAlone)
      .expect(not(terminalObservationAloneExposesNoChoice))
  }

  run missingFreshAuthoritiesCannotResumeTest = {
    init
      .then(observeF2Change)
      .then(applyContinueF2)
      .then(readFreshExactGraph)
      .then(readFreshExactSpecification)
      .then(resumeWithoutEveryFreshAuthority)
      .expect(not(continueRequiresEveryFreshExactAuthority))
  }

  run replacementAttemptCannotUseContinueAuthorityTest = {
    init
      .then(observeF2Change)
      .then(applyContinueF2)
      .then(readFreshExactGraph)
      .then(readFreshExactSpecification)
      .then(readFreshExactClaim)
      .then(readFreshExactWorktree)
      .then(readFreshExactLineage)
      .then(readFreshExactExecutor)
      .then(resumeReplacementAttemptQ)
      .expect(not(continueResumesOnlyImmutableAttemptP))
  }

  run F2AuthorityCannotResumeAfterF3Test = {
    init
      .then(observeF2Change)
      .then(applyContinueF2)
      .then(readFreshExactGraph)
      .then(observeF3BeforeContinuation)
      .then(resumeF2AfterF3WithoutNewChoice)
      .expect(not(changedAgainRequiresNewChoice))
  }

  run projectedRunningCannotAuthorizeAbandonmentTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(requireStoppageReconciliation)
      .then(recordStoppageIntent)
      .then(callStoppage)
      .then(loseStoppageResponse)
      .then(projectExactRunningForStoppage)
      .then(abandonFromUnprovedExecutorState)
      .expect(not(abandonmentRequiresExactUnbrokenQuiescence))
  }

  run brokenSafeEvidenceCannotAuthorizeAbandonmentTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(requireStoppageReconciliation)
      .then({ state' = { ...state, executorEvidence: ExactSafelySuspended } })
      .then(abandonFromBrokenSafeEvidence)
      .expect(not(abandonmentRequiresExactUnbrokenQuiescence))
  }

  run claimCannotReleaseBeforeImplementationAbandonmentTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(releaseClaimBeforeAbandonment)
      .expect(not(claimChangesOnlyAfterAbandonmentAndExactRead))
  }

  run unreadableClaimCannotBeReleasedTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(observeUnreadableClaim)
      .then(releaseUnreadableClaim)
      .expect(not(absentForeignUnreadableClaimsAreNeverMutated))
  }

  run absentClaimCannotBeReleasedTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(observeAbsentClaim)
      .then(releaseAbsentOrForeignClaim)
      .expect(not(absentForeignUnreadableClaimsAreNeverMutated))
  }

  run foreignClaimCannotBeReleasedTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(observeForeignClaim)
      .then(releaseAbsentOrForeignClaim)
      .expect(not(absentForeignUnreadableClaimsAreNeverMutated))
  }

  run stopCannotDestroyArtifactsTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(destroyStoppedArtifacts)
      .expect(not(stopPreservesEveryArtifact))
  }

  run stopCannotSelectIntegrationTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(integrateStoppedAttempt)
      .expect(not(stopNeverSelectsIntegration))
  }

  run fourthStoppageIntentViolatesBoundTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(requireStoppageReconciliation)
      .then(recordStoppageIntent)
      .then(callStoppage)
      .then(loseStoppageResponse)
      .then(projectExactRunningForStoppage)
      .then(recoverStopActivation)
      .then(recordStoppageIntent)
      .then(callStoppage)
      .then(loseStoppageResponse)
      .then(projectExactRunningForStoppage)
      .then(recoverStopActivation)
      .then(recordStoppageIntent)
      .then(callStoppage)
      .then(loseStoppageResponse)
      .then(projectExactRunningForStoppage)
      .then(recordFourthStoppageIntent)
      .expect(not(stoppageIsBounded))
  }

  run secondProjectionInOneActivationViolatesBoundTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(requireStoppageReconciliation)
      .then(recordStoppageIntent)
      .then(callStoppage)
      .then(loseStoppageResponse)
      .then(projectExactRunningForStoppage)
      .then(takeSecondStopProjectionInActivation)
      .expect(not(stoppageIsBounded))
  }

  run stoppageLimitCannotBecomePermanentReadOnlyDeadEndTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(requireStoppageReconciliation)
      .then(recordStoppageIntent)
      .then(callStoppage)
      .then(loseStoppageResponse)
      .then(projectExactRunningForStoppage)
      .then(recoverStopActivation)
      .then(recordStoppageIntent)
      .then(callStoppage)
      .then(loseStoppageResponse)
      .then(projectExactRunningForStoppage)
      .then(recoverStopActivation)
      .then(recordStoppageIntent)
      .then(callStoppage)
      .then(loseStoppageResponse)
      .then(projectExactRunningForStoppage)
      .then(makePostLimitReadOnlyStoppageRecoveryUnavailable)
      .expect(not(stoppageLimitPreservesReadOnlyRecovery))
  }

  run fourthClaimReleaseCallViolatesBoundTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(observeExactClaim)
      .then(recordClaimReleaseIntent)
      .then(loseClaimReleaseResponse)
      .then(projectClaimStillExact)
      .then(recoverClaimActivation)
      .then(observeExactClaim)
      .then(loseClaimReleaseResponse)
      .then(projectClaimStillExact)
      .then(recoverClaimActivation)
      .then(observeExactClaim)
      .then(loseClaimReleaseResponse)
      .then(projectClaimStillExact)
      .then(makeFourthClaimReleaseCall)
      .expect(not(claimReleaseIsBoundedAndReconciled))
  }

  run unreadableClaimCannotLoseSeparateResponsibilityTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(observeUnreadableClaim)
      .then(dropUnreadableClaimResponsibility)
      .expect(not(unreadableClaimRemainsSeparateResponsibility))
  }

  run unprovedWriterCannotReleaseTaskPositionTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(requireStoppageReconciliation)
      .then(releasePositionWhileWriterIsUnproved)
      .expect(not(unprovedWriterRetainsPositionAndClaim))
  }
}
