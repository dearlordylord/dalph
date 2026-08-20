// Deliberately weakened cancellation transitions. Each collected run turns a
// distinct accepted safety obligation red; a green negative suite that merely
// executes an unreachable action would be false evidence.
module runCancellationNegativeTest {
  import runCancellation.* from "./runCancellation"

  action appendDuplicateCancellation: bool = all {
    state.durable.cancellationApplied,
    state' = {
      ...state,
      durable: { ...state.durable, cancellationAppends: 2 },
    },
  }

  action reopenAdmissionAfterCancellation: bool = all {
    state.durable.cancellationApplied,
    state' = { ...state, process: { ...state.process, admissionOpen: true } },
  }

  action discardCancellationWork: bool = all {
    state.durable.cancellationApplied,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        worktreePreserved: false,
        logsPreserved: false,
        evidencePreserved: false,
      },
    },
  }

  action reportSafeWithoutStopIntent: bool = all {
    state.process.phase == Cancelling,
    state.durable.executor == Running,
    state' = {
      ...state,
      durable: { ...state.durable, executor: SafelySuspended, executorSafeReports: 1 },
      process: { ...state.process, executorPositionHeld: false },
    },
  }

  action releaseClaimBeforeExecutorSafe: bool = all {
    state.process.phase == Cancelling,
    state.durable.executor == Running,
    state.durable.claim == Held,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        claim: ReleaseIntentRecorded,
        claimReleaseIntents: 1,
      },
    },
  }

  action duplicateClaimRelease: bool = all {
    state.durable.claim == Released,
    state' = {
      ...state,
      durable: {
        ...state.durable,
        claimReleaseIntents: 2,
        claimReleaseObservations: 2,
        claimReleases: 2,
      },
    },
  }

  action rollbackPromotion: bool = all {
    state.durable.promotionAccepted,
    state' = { ...state, durable: { ...state.durable, integration: IntegrationOwned } },
  }

  action releaseUnreadableExecutor: bool = all {
    state.durable.executor == ExecutorUnreadable,
    state' = {
      ...state,
      process: { ...state.process, executorPositionHeld: false, responsibilitiesSettled: true },
    },
  }

  action releaseUnreadableIntegration: bool = all {
    state.durable.integration == IntegrationUnreadable,
    state' = { ...state, process: { ...state.process, responsibilitiesSettled: true } },
  }

  action handoffWithUnsettledResponsibility: bool = all {
    state.process.phase == Cancelling,
    state.durable.executor == StopIntentRecorded,
    state' = { ...state, process: { ...state.process, phase: ReadyForClassification } },
  }

  action handoffWithoutFreshGraph: bool = all {
    state.process.phase == Cancelling,
    state.process.responsibilitiesSettled,
    not(state.process.graphRead),
    state' = { ...state, process: { ...state.process, phase: ReadyForClassification } },
  }

  action classifyTemporaryWait: bool = all {
    state.process.graph == TemporaryWait,
    state.process.graphRead,
    state' = { ...state, process: { ...state.process, phase: ReadyForClassification } },
  }

  action applyCancellationAfterExit: bool = all {
    state.process.exitCutoff,
    state' = { ...state, durable: { ...state.durable, cancellationApplied: true } },
  }

  action reopenTerminalHistory: bool = all {
    state.durable.terminalHistory != NoTermination,
    state' = { ...state, process: { ...state.process, phase: Active } },
  }

  run duplicateCancellationIsDetectedTest = {
    init.then(selectIdleRun).then(applyCancellation).then(appendDuplicateCancellation)
      .expect(not(cancellationAppliedAtMostOnce))
  }

  run admissionReopenIsDetectedTest = {
    init.then(selectIdleRun).then(applyCancellation).then(reopenAdmissionAfterCancellation)
      .expect(not(cancellationClosesForwardAdmission))
  }

  run workDiscardIsDetectedTest = {
    init.then(selectIdleRun).then(applyCancellation).then(discardCancellationWork)
      .expect(not(cancellationPreservesWorkInProgress))
  }

  run safeReportWithoutIntentIsDetectedTest = {
    init.then(selectRunningExecutor).then(applyCancellation)
      .then(reportSafeWithoutStopIntent)
      .expect(not(executorStopIntentPrecedesSafeReport))
  }

  run claimReleaseBeforeSafeExecutorIsDetectedTest = {
    init.then(selectRunningExecutor).then(applyCancellation)
      .then(releaseClaimBeforeExecutorSafe)
      .expect(not(claimReleaseFollowsSafeExecutor))
  }

  run duplicateClaimReleaseIsDetectedTest = {
    init.then(selectRunningExecutor).then(applyCancellation)
      .then(recordExecutorStopIntent).then(reportExecutorSafe)
      .then(recordClaimReleaseIntent).then(observeAndReleaseClaim)
      .then(duplicateClaimRelease)
      .expect(not(claimReleaseIsExactAndBounded))
  }

  run promotionRollbackIsDetectedTest = {
    init.then(selectIntegrationOwned).then(applyCancellation)
      .then(recordIntegrationIntent).then(observePromotedIntegration)
      .then(rollbackPromotion)
      .expect(not(integrationSettlementNeverRollsBackPromotion))
  }

  run unreadableExecutorReleaseIsDetectedTest = {
    init.then(selectRunningExecutor).then(applyCancellation)
      .then(recordExecutorStopIntent).then(markExecutorUnreadable)
      .then(releaseUnreadableExecutor)
      .expect(not(ambiguousExecutorRetainsResponsibility))
  }

  run unreadableIntegrationReleaseIsDetectedTest = {
    init.then(selectIntegrationOwned).then(applyCancellation)
      .then(recordIntegrationIntent).then(markIntegrationUnreadable)
      .then(releaseUnreadableIntegration)
      .expect(not(ambiguousIntegrationRetainsResponsibility))
  }

  run handoffWithUnsettledResponsibilityIsDetectedTest = {
    init.then(selectRunningExecutor).then(applyCancellation)
      .then(recordExecutorStopIntent)
      .then(handoffWithUnsettledResponsibility)
      .expect(not(handoffRequiresSettledResponsibilities))
  }

  run handoffWithoutFreshGraphIsDetectedTest = {
    init.then(selectIdleRun).then(applyCancellation)
      .then(settleAfterIdleCancellation).then(handoffWithoutFreshGraph)
      .expect(not(handoffRequiresFreshGraph))
  }

  run temporaryWaitClassificationIsDetectedTest = {
    init.then(selectTemporaryWait).then(applyCancellation)
      .then(readTemporaryWaitGraph).then(classifyTemporaryWait)
      .expect(not(temporaryWaitDoesNotClassifyCancellation))
  }

  run exitCutoffCancellationIsDetectedTest = {
    init.then(selectApplicationExitCutoff).then(applyCancellationAfterExit)
      .expect(not(applicationExitCutoffRejectsCancellation))
  }

  run terminalHistoryReopenIsDetectedTest = {
    init.then(selectTerminalHistory).then(reopenTerminalHistory)
      .expect(not(terminalHistoryCannotReopen))
  }
}
