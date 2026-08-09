module plannedAttemptExecutorEvidenceProofTest {
  import plannedAttemptExecutorEvidenceProof.* from "./plannedAttemptExecutor_proof"

  run directResponseUsesExactIntentAndReleasesOnlyForSafeTest = {
    init
      .then(recordSuspendIntent)
      .then(callExecutor)
      .then(recordDirectResponse(SafelySuspendedReport))
      .then(settleDirectResponse)
      .expect(and {
        not(state.positionHeld),
        everyCallHasDurableIntent,
        directResponsesAndProjectionsStayDistinct,
        settlementUsesExactOrdinalAndCorrelation,
        positionReleasesOnlyForSafeOrTerminalEvidence,
      })
  }

  run lostResponseUsesExactCommandProjectionTest = {
    init
      .then(recordStartIntent)
      .then(callExecutor)
      .then(loseResponse)
      .then(recordExactCommandProjection(RunningReport))
      .then(settleCommandProjection)
      .expect(and {
        state.positionHeld,
        directResponsesAndProjectionsStayDistinct,
        settlementUsesExactOrdinalAndCorrelation,
      })
  }

  run unavailableProjectionConsumesOneReadAndRecoveryResetsAllowanceTest = {
    init
      .then(recordSuspendIntent)
      .then(callExecutor)
      .then(loseResponse)
      .then(recordUnavailableCommandProjection)
      .expect(and {
        state.positionHeld,
        state.settlementCount == 0,
        oneReconciliationReadPerActivation,
        ambiguousOrUnavailableEvidenceRetainsPosition,
      })
      .then(activateRecovery)
      .then(recordExactCommandProjection(TerminalReport))
      .then(settleCommandProjection)
      .expect(not(state.positionHeld) and positionReleasesOnlyForSafeOrTerminalEvidence)
  }

  run freshStateProjectionRequiresNoCommandAndDoesNotSettleOneTest = {
    init
      .then(recordFreshSafeStateProjection)
      .then(acceptFreshStateProjection)
      .expect(and {
        not(state.positionHeld),
        freshStateProjectionNeverSettlesCommand,
        positionReleasesOnlyForSafeOrTerminalEvidence,
      })
  }
}

module plannedAttemptExecutorStartBoundProofTest {
  import plannedAttemptExecutorStartBoundProof.* from "./plannedAttemptExecutor_proof"

  run threeLostStartResponsesConsumeTheWholeBudgetTest = {
    init
      .then(recordStartIntent).then(callStart).then(loseStartResponse).then(observeProjectedRunning).then(settleRunning)
      .then(recordStartIntent).then(callStart).then(loseStartResponse).then(observeProjectedRunning).then(settleRunning)
      .then(recordStartIntent).then(callStart).then(loseStartResponse).then(observeProjectedRunning).then(settleRunning)
      .expect(and {
        state.intentCount == START_LIMIT,
        state.callCount == START_LIMIT,
        state.settlementCount == START_LIMIT,
        everyStartCallHasItsIntent,
        lostResponsesStillConsumeStartBudget,
        startLimitBlocksFourthCommand,
      })
      .then(recordStartIntent.fail())
  }

  run terminalStartResponseReleasesPositionTest = {
    init
      .then(recordStartIntent)
      .then(callStart)
      .then(observeDirectTerminal)
      .then(settleTerminal)
      .expect(not(state.positionHeld) and terminalStartReleasesPosition)
  }
}

module plannedAttemptExecutorSuspendBoundProofTest {
  import plannedAttemptExecutorSuspendBoundProof.* from "./plannedAttemptExecutor_proof"

  run threeLostRunningSuspendResponsesAllowOnlyReadOnlySafeRecoveryTest = {
    init
      .then(recordSuspendIntent).then(callSuspend).then(loseSuspendResponse).then(observeProjectedRunning).then(settleRunning)
      .then(recordSuspendIntent).then(callSuspend).then(loseSuspendResponse).then(observeProjectedRunning).then(settleRunning)
      .then(recordSuspendIntent).then(callSuspend).then(loseSuspendResponse).then(observeProjectedRunning).then(settleRunning)
      .expect(and {
        state.intentCount == SUSPEND_LIMIT,
        state.callCount == SUSPEND_LIMIT,
        state.settlementCount == SUSPEND_LIMIT,
        everySuspendCallHasItsIntent,
        lostResponsesStillConsumeSuspendBudget,
        suspendLimitBlocksFourthCommand,
      })
      .then(activateReadOnlyRecovery)
      .then(recordFreshSafeStateProjection)
      .then(acceptFreshSafeStateProjection)
      .expect(and {
        not(state.positionHeld),
        state.callCount == SUSPEND_LIMIT,
        postLimitRecoveryIsReadOnly,
        positionReleasesOnlyForSafeOrTerminalEvidence,
      })
  }

  run fourthSuspendCommandIsBlockedTest = {
    init
      .then(recordSuspendIntent).then(callSuspend).then(observeDirectRunning).then(settleRunning)
      .then(recordSuspendIntent).then(callSuspend).then(observeDirectRunning).then(settleRunning)
      .then(recordSuspendIntent).then(callSuspend).then(observeDirectRunning).then(settleRunning)
      .then(recordSuspendIntent.fail())
  }

  run directSafeSuspendResponseReleasesPositionTest = {
    init
      .then(recordSuspendIntent)
      .then(callSuspend)
      .then(observeDirectSafe)
      .then(settleSafe)
      .expect(not(state.positionHeld) and positionReleasesOnlyForSafeOrTerminalEvidence)
  }
}
