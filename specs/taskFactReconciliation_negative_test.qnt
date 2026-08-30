// Negative controls for the changed-task Continue, Restart, or Stop protocol. Each
// action introduces one forbidden shortcut that a named invariant must reject.
module taskFactReconciliationNegativeTest {
  import taskFactReconciliation.* from "./taskFactReconciliation"

  action conflateActiveRefreshUnreadableWithOrdinarySuspension: bool = all {
    state.lastAction == ActiveRefreshUnreadableObservedAction,
    state' = {
      ...state,
      constraint: UnreadableClaimConstraint,
      factDecision: RequestSafeSuspension,
    },
  }

  // This mutation preserves active-refresh provenance while re-establishing
  // Running work after a lifecycle reopen. The canonical establishment action
  // must clear both fields before it can hold the position again.
  action reestablishWithStaleActiveRefreshProvenance: bool = all {
    state.lastAction == LifecycleReopenedAction,
    state.executorEvidence == ExactSafelySuspended,
    state.factDecision == ContinueWork,
    state.constraint == NoConstraint,
    state.authorityReadPurpose == ActiveWorkRefreshRead,
    state.refreshSource == Timer,
    state' = {
      ...state,
      executorEvidence: ExactExecuting,
      quiescenceUnbroken: false,
      positionHeld: true,
      lastAction: ActiveWorkRunningEstablishedAction,
    },
  }

  action conflateRunBindingWithPersistedContentError: bool = all {
    state.lastAction == RunMismatchRejectedAction,
    state' = { ...state, lastControlResult: PersistedRequestContentContradiction },
  }

  action overwriteFirstF2Choice: bool = all {
    state.f2WinningChoice == ContinueChoice,
    state' = { ...state, f2WinningChoice: StopChoice },
  }

  action overwriteRestartWinner: bool = all {
    state.f2WinningChoice == RestartChoice,
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

  action applyContinueAfterCutoff: bool = all {
    state.phase == IntegrationStarted,
    state' = {
      ...state,
      firstF2Choice: ContinueChoice,
      f2WinningChoice: ContinueChoice,
      appliedChoiceCount: 1,
      continueStage: NeedFreshGraph,
      lastControlResult: ChoiceApplied,
      lastAction: PostCutoffContinueRejectedAction,
    },
  }

  action applyRestartAfterCutoff: bool = all {
    state.phase == IntegrationStarted,
    state' = {
      ...state,
      firstF2Choice: RestartChoice,
      f2WinningChoice: RestartChoice,
      appliedChoiceCount: 1,
      replacementPhase: RestartApplied,
      replacementDisposition: NoReplacementDisposition,
      lastControlResult: ChoiceApplied,
      lastAction: PostCutoffRestartRejectedAction,
    },
  }

  action primeExactReplacementFactsWithoutRestart: bool = all {
    state.currentFingerprint == F2,
    state.f2WinningChoice == NoChoice,
    state' = {
      ...state,
      replacementPhase: ReplacementReadyToAppend,
      replacementTaskFacts: ExactF2OpenInClosureUnblocked,
      replacementClaimFacts: ExactK1Observed,
      oldWorktreeFacts: ExactW1Ready,
      replacementTargetHeadFacts: ExactH2Observed,
      observedOldWorktreeHead: CURRENT_W1_HEAD_H1,
      oldBaseB1IsAncestor: true,
      observedReplacementTargetHead: TARGET_HEAD_H2,
    },
  }

  // This mutant performs the complete atomic state update while deliberately
  // bypassing the action guard. Each guard-focused test changes one premise
  // first and proves the independently written invariant detects it.
  action forcePlannedAttemptReplacement: bool = all {
    not(state.replacementEventRecorded),
    state' = {
      ...state,
      p1Unsettled: false,
      p1Superseded: true,
      plannedSuccessor: PlannedP2,
      replacementEventRecorded: true,
      replacementEventCount: 1,
      successorAllocationCount: 1,
      successorBaseHead: TARGET_HEAD_H2,
      successorBranchIdentity: BRANCH_P2,
      successorWorktreeIdentity: WORKTREE_W2,
      successorCarriesP1Content: false,
      implementationResponsibilityRetained: false,
      positionHeld: false,
      replacementPhase: PlannedAttemptReplacementRecorded,
      replacementDisposition: NoReplacementDisposition,
      lastAction: PlannedAttemptReplacementRecordedAction,
    },
  }

  action replaceWithF3Facts: bool = all {
    state.replacementPhase == ReplacementReadyToAppend,
    state' = {
      ...state,
      currentFingerprint: F3,
      replacementTaskFacts: ReplacementF3Observed,
      replacementDisposition: NewFingerprintChoiceRequired,
    },
  }

  action replaceWithUnreadableTaskFacts: bool = all {
    state.replacementPhase == ReplacementReadyToAppend,
    state' = { ...state, replacementTaskFacts: ReplacementTaskFactsUnreadable },
  }

  action replaceWithNoneligibleTaskFacts: bool = all {
    state.replacementPhase == ReplacementReadyToAppend,
    state' = { ...state, replacementTaskFacts: ReplacementTaskNotEligible },
  }

  action replaceWithoutExactK1: bool = all {
    state.replacementPhase == ReplacementReadyToAppend,
    state' = { ...state, replacementClaimFacts: ReplacementClaimUnreadable },
  }

  action replaceWithAbsentK1: bool = all {
    state.replacementPhase == ReplacementReadyToAppend,
    state' = { ...state, replacementClaimFacts: ReplacementClaimAbsent },
  }

  action replaceWithForeignK1: bool = all {
    state.replacementPhase == ReplacementReadyToAppend,
    state' = { ...state, replacementClaimFacts: ReplacementClaimForeign },
  }

  action replaceWithoutExactW1: bool = all {
    state.replacementPhase == ReplacementReadyToAppend,
    state' = { ...state, oldWorktreeFacts: OldWorktreeNotReady },
  }

  action replaceWithUnreadableW1: bool = all {
    state.replacementPhase == ReplacementReadyToAppend,
    state' = { ...state, oldWorktreeFacts: OldWorktreeUnreadable },
  }

  action replaceWithoutCurrentH1: bool = all {
    state.replacementPhase == ReplacementReadyToAppend,
    state' = { ...state, observedOldWorktreeHead: OtherGitCommit },
  }

  action replaceWithoutB1Ancestry: bool = all {
    state.replacementPhase == ReplacementReadyToAppend,
    state' = { ...state, oldBaseB1IsAncestor: false },
  }

  action replaceWithoutReadableH2: bool = all {
    state.replacementPhase == ReplacementReadyToAppend,
    state' = {
      ...state,
      replacementTargetHeadFacts: ReplacementTargetHeadUnreadable,
      observedReplacementTargetHead: NoGitCommit,
    },
  }

  action replaceWithoutCurrentH2: bool = all {
    state.replacementPhase == ReplacementReadyToAppend,
    state' = { ...state, observedReplacementTargetHead: OtherGitCommit },
  }

  action replaceWhileP1Executing: bool = all {
    state.replacementPhase == ReplacementReadyToAppend,
    state' = { ...state, executorEvidence: ExactExecuting, quiescenceUnbroken: false },
  }

  action supersedeP1WithoutRecordingP2: bool = all {
    state.p1Unsettled,
    state' = {
      ...state,
      p1Unsettled: false,
      p1Superseded: true,
      replacementEventRecorded: true,
      replacementEventCount: 1,
    },
  }

  action recordP2WithoutSupersedingP1: bool = all {
    state.p1Unsettled,
    state' = {
      ...state,
      plannedSuccessor: PlannedP2,
      replacementEventRecorded: true,
      replacementEventCount: 1,
      successorAllocationCount: 1,
    },
  }

  action destroyP1ResourcesAfterReplacement: bool = all {
    state.replacementEventRecorded,
    state' = {
      ...state,
      worktreePreserved: false,
      wipPreserved: false,
      p1BranchPreserved: false,
      p1CommitsPreserved: false,
      p1JournalEvidencePreserved: false,
      cleanupSelected: true,
      replacementCleanupCallCount: 1,
    },
  }

  action mutateK1AfterReplacement: bool = all {
    state.replacementEventRecorded,
    state' = {
      ...state,
      exactClaimHeld: false,
      currentClaimIdentity: state.originalClaimIdentity + 1,
      replacementClaimMutationCallCount: 1,
    },
  }

  action carryP1IntoSuccessor: bool = all {
    state.replacementEventRecorded,
    state' = {
      ...state,
      successorBaseHead: BASE_B1,
      successorBranchIdentity: BRANCH_P1,
      successorWorktreeIdentity: WORKTREE_W1,
      successorCarriesP1Content: true,
    },
  }

  action claimW2ExistsInReplacementEvent: bool = all {
    state.lastAction == PlannedAttemptReplacementRecordedAction,
    state' = { ...state, successorWorktreeReady: true },
  }

  action startP2WithoutOrdinaryAdmission: bool = all {
    state.replacementPhase == SuccessorWaitingForAdmission,
    state' = {
      ...state,
      replacementPhase: SuccessorExecuting,
      successorExecutorStartCount: 1,
      successorExecutorResponsibilityRetained: true,
    },
  }

  action allocateP3AfterP2Recovery: bool = all {
    state.replacementEventRecorded,
    state.plannedSuccessor == PlannedP2,
    state' = {
      ...state,
      plannedSuccessor: PlannedP3,
      successorAllocationCount: 2,
    },
  }

  action makeFourthReplacementClaimRead: bool = all {
    state.replacementClaimReadsThisActivation == REPLACEMENT_CLAIM_READ_LIMIT,
    state' = {
      ...state,
      replacementClaimReadsThisActivation: REPLACEMENT_CLAIM_READ_LIMIT + 1,
    },
  }

  action overlapP1AndP2ExecutorResponsibilities: bool = all {
    state.replacementPhase == SuccessorExecuting,
    state.successorExecutorResponsibilityRetained,
    state' = { ...state, implementationResponsibilityRetained: true },
  }

  action inventP2AfterAbsentReplacementAppend: bool = all {
    state.lastAction == ReplacementAppendAbsentAfterCrashAction,
    not(state.replacementEventRecorded),
    state' = {
      ...state,
      plannedSuccessor: PlannedP2,
      successorAllocationCount: 1,
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

  action admitResumeAfterTerminalChoice: bool = all {
    state.f2WinningChoice == RestartChoice or state.f2WinningChoice == StopChoice,
    state' = { ...state, heldResumeAdmitted: true },
  }

  action issueResumeAfterTerminalChoice: bool = all {
    state.f2WinningChoice == RestartChoice or state.f2WinningChoice == StopChoice,
    state' = {
      ...state,
      resumeCommandIntentCount: state.resumeCommandIntentCount + 1,
      resumeBoundaryCallCount: state.resumeBoundaryCallCount + 1,
    },
  }

  action replaceAfterAcceptedTerminal: bool = all {
    state.executorEvidence == ExactTerminal,
    state' = {
      ...state,
      implementationResponsibilityRetained: false,
      replacementEventRecorded: true,
    },
  }

  action observeReplacementF3AfterAcceptedTerminal: bool = all {
    state.f2WinningChoice == RestartChoice,
    state.replacementPhase == NeedCurrentReplacementTaskFacts,
    state.executorEvidence == ExactTerminal,
    state' = {
      ...state,
      currentFingerprint: F3,
      replacementTaskFacts: ReplacementF3Observed,
      replacementPhase: ReplacementRejected,
      replacementDisposition: NewFingerprintChoiceRequired,
      continueStage: NewChoiceRequired,
      constraint: SpecificationConstraint,
      factDecision: SpecificationChoices,
      lastAction: ReplacementF3FactsObservedAction,
    },
  }

  action acceptTerminalAfterAbandonment: bool = all {
    not(state.implementationResponsibilityRetained),
    state.executorEvidence == ExactSafelySuspended,
    state' = {
      ...state,
      executorEvidence: ExactTerminal,
      appliedChoiceCountAtTerminalObservation: state.appliedChoiceCount,
      quiescenceUnbroken: true,
      positionHeld: false,
      lastAction: TerminalObservedAction,
    },
  }

  action makeFourthClaimReleaseCall: bool = all {
    state.claimReleaseCallCount == 3,
    state' = { ...state, claimReleaseCallCount: 4 },
  }

  action dropUnreadableClaimResponsibility: bool = all {
    state.claimObservation == ClaimUnreadable,
    state' = { ...state, unresolvedClaimReleaseResponsibility: false },
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

  run terminalPastCutoffCannotApplyContinueTest = {
    init
      .then(observeExactTerminal)
      .then(beginIntegration)
      .then(observeF2Change)
      .then(applyContinueAfterCutoff)
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

  run brokenSafeEvidenceCannotAuthorizeAbandonmentTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then({ state' = { ...state, quiescenceUnbroken: false } })
      .then(abandonFromBrokenSafeEvidence)
      .expect(not(abandonmentRequiresExactUnbrokenQuiescence))
  }

  run terminalChoiceCannotAdmitAnotherResumeTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(admitResumeAfterTerminalChoice)
      .expect(not(terminalChoiceBlocksResumeWhileLifecycleEvidenceRemains))
  }

  run terminalChoiceCannotIssueResumeAtExecutorBoundaryTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(issueResumeAfterTerminalChoice)
      .expect(not(terminalChoiceBlocksResumeWhileLifecycleEvidenceRemains))
  }

  run acceptedTerminalCannotBeReplacedTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(observeExactTerminal)
      .then(replaceAfterAcceptedTerminal)
      .expect(not(acceptedTerminalIsAbsorbing))
  }

  run acceptedTerminalCannotCreateReplacementChoiceDispositionTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeExactTerminal)
      .then(observeReplacementF3AfterAcceptedTerminal)
      .expect(not(specificationOffersEveryExactChoice))
  }

  run terminalCannotArriveAfterAbandonmentTest = {
    init
      .then(observeF2Change)
      .then(applyStopF2)
      .then(abandonImplementation)
      .then(acceptTerminalAfterAbandonment)
      .expect(not(acceptedTerminalIsAbsorbing) and not(abandonmentRequiresExactUnbrokenQuiescence))
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

  run activeRefreshUnreadableCannotRequestOrdinarySuspensionTest = {
    init
      .then(establishRunningAttemptForActiveRefresh)
      .then(offerActiveWorkAuthorityRefreshFromTrackerNotification)
      .then(observeUnreadableClaimDuringActiveRefresh)
      .then(conflateActiveRefreshUnreadableWithOrdinarySuspension)
      .expect(not(activeRefreshUnreadableAuthorizesNoExecutorAction))
  }

  run staleRefreshProvenanceOnReestablishmentIsDetectedTest = {
    init
      .then(establishRunningAttemptForActiveRefresh)
      .then(offerActiveWorkAuthorityRefreshFromTimer)
      .then(observeLifecycleClosure)
      .then(reportSafelySuspended)
      .then(observeFreshLifecycleReopen)
      .then(reestablishWithStaleActiveRefreshProvenance)
      .expect(not(activeWorkRunningEstablishmentRetainsAuthority))
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

  run restartWinnerCannotBeOverwrittenByContinueOrStopTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(overwriteRestartWinner)
      .expect(not(firstJournaledChoiceWins))
  }

  run restartCannotApplyPastIntegrationCutoffTest = {
    init
      .then(observeExactTerminal)
      .then(beginIntegration)
      .then(observeF2Change)
      .then(applyRestartAfterCutoff)
      .expect(not(postCutoffChoiceNeverApplies))
  }

  run replacementWithoutAppliedRestartViolatesExactAuthorizationTest = {
    init
      .then(observeF2Change)
      .then(primeExactReplacementFactsWithoutRestart)
      .then(forcePlannedAttemptReplacement)
      .expect(not(plannedAttemptReplacementRequiresExactCurrentEvidence))
  }

  run staleF2ChoiceCannotReplaceAfterF3Test = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(replaceWithF3Facts)
      .then(forcePlannedAttemptReplacement)
      .expect(not(plannedAttemptReplacementRequiresExactCurrentEvidence))
  }

  run unreadableTaskFactsCannotAuthorizeReplacementTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(replaceWithUnreadableTaskFacts)
      .then(forcePlannedAttemptReplacement)
      .expect(not(plannedAttemptReplacementRequiresExactCurrentEvidence))
  }

  run noneligibleTaskFactsCannotAuthorizeReplacementTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(replaceWithNoneligibleTaskFacts)
      .then(forcePlannedAttemptReplacement)
      .expect(not(plannedAttemptReplacementRequiresExactCurrentEvidence))
  }

  run unreadableK1CannotAuthorizeReplacementTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(replaceWithoutExactK1)
      .then(forcePlannedAttemptReplacement)
      .expect(not(plannedAttemptReplacementRequiresExactCurrentEvidence))
  }

  run fourthUnreadableK1ReadViolatesActivationBoundTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementClaimUnreadable)
      .then(observeReplacementClaimUnreadable)
      .then(observeReplacementClaimUnreadable)
      .then(makeFourthReplacementClaimRead)
      .expect(not(replacementClaimReadsAreBounded))
  }

  run absentK1CannotAuthorizeReplacementTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(replaceWithAbsentK1)
      .then(forcePlannedAttemptReplacement)
      .expect(not(plannedAttemptReplacementRequiresExactCurrentEvidence))
  }

  run foreignK1CannotAuthorizeReplacementTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(replaceWithForeignK1)
      .then(forcePlannedAttemptReplacement)
      .expect(not(plannedAttemptReplacementRequiresExactCurrentEvidence))
  }

  run nonreadyW1CannotAuthorizeReplacementTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(replaceWithoutExactW1)
      .then(forcePlannedAttemptReplacement)
      .expect(not(plannedAttemptReplacementRequiresExactCurrentEvidence))
  }

  run unreadableW1CannotAuthorizeReplacementTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(replaceWithUnreadableW1)
      .then(forcePlannedAttemptReplacement)
      .expect(not(plannedAttemptReplacementRequiresExactCurrentEvidence))
  }

  run wrongCurrentH1CannotAuthorizeReplacementTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(replaceWithoutCurrentH1)
      .then(forcePlannedAttemptReplacement)
      .expect(not(plannedAttemptReplacementRequiresExactCurrentEvidence))
  }

  run missingB1AncestryCannotAuthorizeReplacementTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(replaceWithoutB1Ancestry)
      .then(forcePlannedAttemptReplacement)
      .expect(not(plannedAttemptReplacementRequiresExactCurrentEvidence))
  }

  run unreadableH2CannotAuthorizeReplacementTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(replaceWithoutReadableH2)
      .then(forcePlannedAttemptReplacement)
      .expect(not(plannedAttemptReplacementRequiresExactCurrentEvidence))
  }

  run wrongCurrentH2CannotAuthorizeReplacementTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(replaceWithoutCurrentH2)
      .then(forcePlannedAttemptReplacement)
      .expect(not(plannedAttemptReplacementRequiresExactCurrentEvidence))
  }

  run runningP1CannotAuthorizeReplacementTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(replaceWhileP1Executing)
      .then(forcePlannedAttemptReplacement)
      .expect(not(plannedAttemptReplacementRequiresExactCurrentEvidence))
  }

  run P1CannotBeSupersededWithoutAtomicP2Test = {
    init
      .then(supersedeP1WithoutRecordingP2)
      .expect(not(plannedAttemptReplacementIsAtomic))
  }

  run P2CannotBeRecordedWhileP1RemainsUnsettledTest = {
    init
      .then(recordP2WithoutSupersedingP1)
      .expect(and {
        not(plannedAttemptReplacementIsAtomic),
        not(replacementLeavesAtMostOneUnsettledAttempt),
      })
  }

  run replacementCannotDestroyP1ResourcesTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(recordPlannedAttemptReplacement)
      .then(destroyP1ResourcesAfterReplacement)
      .expect(not(restartPreservesP1Resources))
  }

  run replacementCannotReleaseOrReacquireK1Test = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(recordPlannedAttemptReplacement)
      .then(mutateK1AfterReplacement)
      .expect(and {
        not(restartRetainsExactK1WithoutTrackerMutation),
        not(restartSendsNoClaimMutation),
      })
  }

  run successorCannotReuseW1OrCarryItsContentTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(recordPlannedAttemptReplacement)
      .then(carryP1IntoSuccessor)
      .expect(not(successorPlanIsCleanW2AtExactH2))
  }

  run replacementEventCannotClaimW2AlreadyExistsTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(recordPlannedAttemptReplacement)
      .then(claimW2ExistsInReplacementEvent)
      .expect(not(replacementEventDoesNotClaimW2OrExecutorWork))
  }

  run successorCannotStartWithoutOrdinaryAdmissionTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(recordPlannedAttemptReplacement)
      .then(prepareCleanSuccessorW2)
      .then(startP2WithoutOrdinaryAdmission)
      .expect(not(successorUsesOrdinaryBoundedAdmission))
  }

  run recoveryCannotAllocateP3AfterDurableP2Test = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(recordPlannedAttemptReplacement)
      .then(recoverReplacementAppendPresent)
      .then(allocateP3AfterP2Recovery)
      .expect(not(replacementNeverAllocatesP3))
  }

  run P1AndP2ExecutorResponsibilitiesCannotOverlapTest = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(recordPlannedAttemptReplacement)
      .then(prepareCleanSuccessorW2)
      .then(admitSuccessorThroughOrdinaryCapacity)
      .then(startSuccessorExecutor)
      .then(overlapP1AndP2ExecutorResponsibilities)
      .expect(not(p1AndP2ExecutorResponsibilitiesNeverOverlap))
  }

  run absentReplacementAppendCannotInventP2Test = {
    init
      .then(observeF2Change)
      .then(applyRestartF2)
      .then(beginReplacementFactsFromRetainedSafeSuspension)
      .then(observeReplacementExactF2TaskFacts)
      .then(observeReplacementExactK1)
      .then(observeReplacementExactW1Ready)
      .then(observeReplacementExactH2)
      .then(recoverReplacementAppendAbsent)
      .then(inventP2AfterAbsentReplacementAppend)
      .expect(not(crashKeepsEitherNoP2OrTheSameP2))
  }

}
