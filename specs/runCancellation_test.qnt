// Collected deterministic chronologies for the accepted Run-cancellation
// scenarios. Every name ends in Test because Quint otherwise silently ignores
// the run definition.
module runCancellationTest {
  import runCancellation.* from "./runCancellation"

  run idleCancellationClosesAdmissionAndHandsOffTest = {
    init
      .then(selectIdleRun)
      .then(applyCancellation)
      .then(redeliverCancellation)
      .then(readFreshClassificationGraph)
      .then(handoffToFreshClassification)
      .expect(and {
        idleCancellationAppliedReached,
        cancellationRedeliveryReached,
        cancellationClosesForwardAdmission,
        cancellationAppliedAtMostOnce,
        freshClassificationGraphReached,
        cancellationHandoffReached,
        handoffRequiresSettledResponsibilities,
        handoffRequiresFreshGraph,
      })
  }

  run runningExecutorCancellationStopsAndReleasesClaimTest = {
    init
      .then(selectRunningExecutor)
      .then(applyCancellation)
      .then(recordExecutorStopIntent)
      .then(reportExecutorSafe)
      .then(recordClaimReleaseIntent)
      .then(observeAndReleaseClaim)
      .then(settleAfterIdleCancellation)
      .then(readFreshClassificationGraph)
      .then(handoffToFreshClassification)
      .expect(and {
        runningExecutorCancellationReached,
        executorStopIntentReached,
        executorSafeReportReached,
        claimReleaseIntentReached,
        claimReleasedReached,
        cancellationPreservesWorkInProgress,
        executorStopIntentPrecedesSafeReport,
        executorPositionRetainedUntilSafeReport,
        claimReleaseFollowsSafeExecutor,
        claimReleaseIsExactAndBounded,
        cancellationHandoffReached,
      })
  }

  run integrationCancellationSettlesPromotedBoundaryTest = {
    init
      .then(selectIntegrationOwned)
      .then(applyCancellation)
      .then(recordIntegrationIntent)
      .then(observePromotedIntegration)
      .then(settlePromotedIntegration)
      .then(settleAfterIdleCancellation)
      .then(readFreshClassificationGraph)
      .then(handoffToFreshClassification)
      .expect(and {
        integrationOwnedCancellationReached,
        promotionAcceptedReached,
        integrationSettledReached,
        integrationSettlementNeverRollsBackPromotion,
        integrationResourceSettlesOnce,
        cancellationHandoffReached,
      })
  }

  run executorCrashReconcilesExactIntentBeforeHandoffTest = {
    init
      .then(selectRunningExecutor)
      .then(applyCancellation)
      .then(recordExecutorStopIntent)
      .then(crashBeforeSettlement)
      .then(restartCancellation)
      .then(reconcileExecutorAfterRestart)
      .then(recordClaimReleaseIntent)
      .then(observeAndReleaseClaim)
      .then(settleAfterIdleCancellation)
      .then(readFreshClassificationGraph)
      .then(handoffToFreshClassification)
      .expect(and {
        processLossBeforeSettlementReached,
        restartedCancellationReached,
        executorSafeReportReached,
        claimReleasedReached,
        state.durable.executorStopIntents == 1,
        state.durable.executorSafeReports == 1,
        restartReusesAppliedCancellation,
        restartRequiresFreshClassificationGraph,
        cancellationHandoffReached,
      })
  }

  run integrationCrashReconcilesPromotionWithoutRollbackTest = {
    init
      .then(selectIntegrationOwned)
      .then(applyCancellation)
      .then(recordIntegrationIntent)
      .then(crashBeforeSettlement)
      .then(restartCancellation)
      .then(reconcileIntegrationAfterRestart)
      .then(settlePromotedIntegration)
      .then(settleAfterIdleCancellation)
      .then(readFreshClassificationGraph)
      .then(handoffToFreshClassification)
      .expect(and {
        processLossBeforeSettlementReached,
        restartedCancellationReached,
        promotionAcceptedReached,
        integrationSettledReached,
        integrationSettlementNeverRollsBackPromotion,
        state.durable.integrationIntents == 1,
        state.durable.integrationSettlements == 1,
        cancellationHandoffReached,
      })
  }

  run temporaryWaitRemainsPendingAfterCancellationTest = {
    init
      .then(selectTemporaryWait)
      .then(applyCancellation)
      .then(readTemporaryWaitGraph)
      .expect(and {
        temporaryWaitReached,
        freshClassificationGraphReached,
        not(cancellationHandoffReached),
        temporaryWaitDoesNotClassifyCancellation,
      })
  }

  run applicationExitWinsCancellationOrderingTest = {
    init
      .then(selectApplicationExitCutoff)
      .then(rejectCancellationAtExit)
      .expect(and {
        applicationExitWinsReached,
        not(state.durable.cancellationApplied),
        applicationExitCutoffRejectsCancellation,
      })
  }

  run foreignCancellationCannotCrossRunBoundaryTest = {
    init
      .then(selectForeignRunRequest)
      .then(rejectForeignCancellation)
      .expect(and {
        foreignCancellationRejectedReached,
        not(state.durable.cancellationApplied),
        exactRunAndOperatorDirection,
      })
  }

  run terminalHistoryRejectsCancellationReopenTest = {
    init
      .then(selectTerminalHistory)
      .then(rejectTerminalHistory)
      .expect(and {
        terminalHistoryRejectedReached,
        state.process.cancellationRejected,
        state.process.phase == TerminalHistory,
        terminalHistoryCannotReopen,
        state.durable.cancellationAppends == 0,
        not(state.durable.cancellationAppends > 0),
      })
  }

}
