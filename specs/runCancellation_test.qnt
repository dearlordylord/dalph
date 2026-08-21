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

  run alreadyPausedCancellationUsesFreshClassificationTest = {
    init
      .then(selectAlreadyPausedRun)
      .then(applyCancellation)
      .then(readFreshClassificationGraph)
      .then(handoffToFreshClassification)
      .expect(and {
        state.process.paused,
        state.process.forwardAdmissions == 0,
        cancellationClosesForwardAdmission,
        freshClassificationGraphReached,
        cancellationHandoffReached,
        handoffRequiresFreshGraph,
      })
  }

  run admittedForwardWorkSurvivesCancellationAndCrashTest = {
    init
      .then(admitForwardWork)
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
        state.process.forwardAdmissions == 1,
        processLossBeforeSettlementReached,
        restartedCancellationReached,
        executorSafeReportReached,
        claimReleasedReached,
        ambiguousExecutorRetainsResponsibility,
        cancellationHandoffReached,
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

  run foreignClaimIsObservedWithoutReleaseTest = {
    init
      .then(selectRunningExecutor)
      .then(applyCancellation)
      .then(recordExecutorStopIntent)
      .then(reportExecutorSafe)
      .then(recordClaimReleaseIntent)
      .then(observeForeignClaim)
      .then(settleAfterIdleCancellation)
      .then(readFreshClassificationGraph)
      .then(handoffToFreshClassification)
      .expect(and {
        state.durable.claim == ForeignClaim,
        state.durable.claimReleaseIntents == 1,
        state.durable.claimReleaseObservations == 1,
        state.durable.claimReleases == 0,
        claimReleaseIsExactAndBounded,
        cancellationHandoffReached,
      })
  }

  run unreadableClaimKeepsCancellationPendingTest = {
    init
      .then(selectRunningExecutor)
      .then(applyCancellation)
      .then(recordExecutorStopIntent)
      .then(reportExecutorSafe)
      .then(recordClaimReleaseIntent)
      .then(markClaimUnreadable)
      .expect(and {
        state.durable.claim == ClaimUnreadable,
        state.durable.claimReleases == 0,
        not(cancellationHandoffReached),
      })
  }

  run quarantinedIntegrationKeepsCancellationPendingTest = {
    init
      .then(selectIntegrationOwned)
      .then(applyCancellation)
      .then(recordIntegrationIntent)
      .then(markIntegrationQuarantined)
      .expect(and {
        state.durable.integration == IntegrationQuarantined,
        state.durable.integrationSettlements == 0,
        ambiguousIntegrationRetainsResponsibility,
        not(cancellationHandoffReached),
      })
  }

  run unreadableGraphKeepsCancellationPendingTest = {
    init
      .then(selectIdleRun)
      .then(applyCancellation)
      .then(markGraphUnreadable)
      .expect(and {
        state.process.graph == GraphUnreadable,
        not(state.process.graphRead),
        temporaryWaitDoesNotClassifyCancellation,
        not(cancellationHandoffReached),
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
