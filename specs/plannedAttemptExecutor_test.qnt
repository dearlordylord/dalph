module plannedAttemptExecutorTest {
  import plannedAttemptExecutor.* from "./plannedAttemptExecutor"

  run runningThenTerminalTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(receiveCommandResponse(ReportRunning))
      .then(settleCommandResponse)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(receiveCommandResponse(ReportTerminal))
      .then(settleCommandResponse)
      .expect(and {
        terminalReached,
        terminalReleasesPosition,
        settlementsUseExactCommandOrdinal,
        commandOrdinalsAreAllocatedExactly,
      })
  }

  run safelySuspendAndResumeSameAttemptTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(receiveCommandResponse(ReportRunning))
      .then(settleCommandResponse)
      .then(recordSuspendIntent)
      .then(callSuspend)
      .then(receiveCommandResponse(ReportSafelySuspended))
      .then(settleCommandResponse)
      .expect(safelySuspendedReached and safeSuspensionReleasesPosition)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(receiveCommandResponse(ReportRunning))
      .then(settleCommandResponse)
      .expect(runningReached and everyBoundaryValueCarriesPlannedAttempt)
  }

  run commandIntentPrecedesEveryExecutorCallTest = {
    init
      .then(beginResponsibility)
      .expect(not(isIntendedKind(state.commandState, StartOrContinueCommand)))
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .expect(not(isIntendedKind(state.commandState, StartOrContinueCommand)))
      .expect(everyCallHasOneDurableIntent)
  }

  run lostResponseSettlesOnlyFromExactCommandProjectionTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionExactRunning))
      .then(settleCommandProjection)
      .expect(and {
        runningReached,
        settlementsUseExactCommandOrdinal,
        commandOrdinalsAreAllocatedExactly,
        stateProjectionNeverSettlesCommand,
        projectionsAreNotCommandResponses,
        unmatchedIntentBlocksAnotherCommand,
      })
  }

  run freshStateProjectionRequiresNoUnmatchedCommandTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(loseCommandResponse)
      .expect(not(canRecordFreshStateProjection(state)))
      .then(recordCommandProjection(CommandProjectionExactRunning))
      .then(settleCommandProjection)
      .expect(and {
        runningReached,
        isNoCommand(state.commandState),
        state.commandSettlementCount == 1,
        freshStateProjectionHasNoUnmatchedCommand,
        settlementsUseExactCommandOrdinal,
      })
  }

  run freshSafeStateProjectionWithNoCommandProvesQuiescenceTest = {
    init
      .then(beginResponsibility)
      .then(recordFreshStateProjection(ExecutorStateSafelySuspended))
      .then(acceptFreshStateProjectionProof)
      .expect(and {
        safelySuspendedReached,
        not(state.positionHeld),
        isNoCommand(state.commandState),
        state.commandSettlementCount == 0,
        freshStateProjectionHasNoUnmatchedCommand,
        stateProjectionNeverSettlesCommand,
      })
  }

  run unavailableAndContradictoryCommandProjectionsRemainUnmatchedTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionUnavailable))
      .expect(not(canSettleCommandProjection(state)))
      .expect(state.positionHeld and isCalled(state.commandState))
      .then(recoverActivation)
      .then(recordCommandProjection(CommandProjectionContradiction))
      .expect(and {
        not(canSettleCommandProjection(state)),
        state.positionHeld,
        isCalled(state.commandState),
        state.commandSettlementCount == 0,
        unsafeOrUnavailableNeverReleasesPosition,
      })
  }

  run recoveryResetsOneReconciliationProjectionAllowanceTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionUnavailable))
      .expect(state.reconciliationProjectionsThisActivation == 1)
      .then(recoverActivation)
      .then(recordCommandProjection(CommandProjectionExactRunning))
      .then(settleCommandProjection)
      .expect(oneReconciliationProjectionPerActivation and runningReached)
  }

  run lostStartResponsesConsumeContinuationBudgetTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionExactRunning))
      .then(settleCommandProjection)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(loseCommandResponse)
      .then(recoverActivation)
      .then(recordCommandProjection(CommandProjectionExactRunning))
      .then(settleCommandProjection)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(loseCommandResponse)
      .then(recoverActivation)
      .then(recordCommandProjection(CommandProjectionExactRunning))
      .then(settleCommandProjection)
      .expect(not(canRecordStartIntent(state)))
      .expect(continuationLimitReached and commandBudgetsAreBounded)
  }

  run fourthSuspendCommandIsBlockedTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(receiveCommandResponse(ReportRunning))
      .then(settleCommandResponse)
      .then(recordSuspendIntent)
      .then(callSuspend)
      .then(receiveCommandResponse(ReportRunning))
      .then(settleCommandResponse)
      .then(recordSuspendIntent)
      .then(callSuspend)
      .then(receiveCommandResponse(ReportRunning))
      .then(settleCommandResponse)
      .then(recordSuspendIntent)
      .then(callSuspend)
      .then(receiveCommandResponse(ReportRunning))
      .then(settleCommandResponse)
      .expect(not(canRecordSuspendIntent(state)))
      .expect(suspendCommandLimitReached and commandBudgetsAreBounded)
  }

  run responsibilityPrecedesFirstExecutorCommandTest = {
    init
      .expect(not(canRecordStartIntent(state)))
      .then(beginResponsibility)
      .expect(responsibilityBeganReached and state.positionHeld)
  }
}
