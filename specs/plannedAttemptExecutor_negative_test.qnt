// Negative controls for the durable executor-command protocol. Each action
// performs one forbidden shortcut that a named invariant must reject.
module plannedAttemptExecutorNegativeTest {
  import plannedAttemptExecutor.* from "./plannedAttemptExecutor"

  action callWithoutIntent: bool = all {
    state.status == ResponsibilityBegan,
    state' = {
      ...state,
      commandCallCount: state.commandCallCount + 1,
      lastAction: StartCalledAction,
    },
  }

  action callSameIntentTwice: bool = all {
    isCalled(state.commandState),
    state' = {
      ...state,
      commandCallCount: state.commandCallCount + 1,
      lastAction: StartCalledAction,
    },
  }

  action replaceUnmatchedIntentBeforeReconciliation: bool = all {
    isCalled(state.commandState),
    state' = {
      ...state,
      commandState: CommandIntended({
        correlation: PLANNED_CORRELATION,
        commandOrdinal: state.nextCommandOrdinal,
        kind: StartOrContinueCommand,
      }),
      nextCommandOrdinal: state.nextCommandOrdinal + 1,
      commandIntentCount: state.commandIntentCount + 1,
    },
  }

  action countProjectionAsCommandResponse: bool = all {
    isCommandProjectionEvidence(state.evidence),
    state' = {
      ...state,
      commandResponseEvidenceCount: state.commandResponseEvidenceCount + 1,
    },
  }

  action settleWrongOrdinal: bool = {
    val projection = commandProjectionOf(state.evidence)
    val intended = activeCommand(state.commandState)
    val wrong = {
      ...projection.command,
      commandOrdinal: projection.command.commandOrdinal + 1,
    }
    all {
      isCommandProjectionEvidence(state.evidence),
      commandProjectionIsExact(projection.outcome),
      state' = {
        ...state,
        commandState: NoCommand,
        evidence: NoEvidence,
        commandSettlementCount: state.commandSettlementCount + 1,
        responseAmbiguous: false,
        lastSettlement: Settled({
          intendedCommand: intended,
          evidenceCommand: wrong,
          source: SettledFromExactCommandProjection,
        }),
      },
    }
  }

  action settleWrongCorrelation: bool = {
    val projection = commandProjectionOf(state.evidence)
    val intended = activeCommand(state.commandState)
    val wrong = {
      ...projection.command,
      correlation: {
        runId: OTHER_RUN_ID,
        attemptId: ATTEMPT_ID,
      },
    }
    all {
      isCommandProjectionEvidence(state.evidence),
      commandProjectionIsExact(projection.outcome),
      state' = {
        ...state,
        commandState: NoCommand,
        evidence: NoEvidence,
        commandSettlementCount: state.commandSettlementCount + 1,
        responseAmbiguous: false,
        lastSettlement: Settled({
          intendedCommand: intended,
          evidenceCommand: wrong,
          source: SettledFromExactCommandProjection,
        }),
      },
    }
  }

  action misclassifyUnmatchedReadAsFreshStateProjection(
    observation: ExecutorStateObservation,
  ): bool = all {
    isCalled(state.commandState),
    state.responseAmbiguous,
    state.evidence == NoEvidence,
    state.reconciliationProjectionsThisActivation == 0,
    state' = {
      ...state,
      evidence: FreshStateProjection({
        correlation: PLANNED_CORRELATION,
        observation: observation,
      }),
      reconciliationProjectionsThisActivation: 1,
      lastAction: FreshStateProjectedAction,
    },
  }

  action settleFromStateProjection: bool = {
    val intended = activeCommand(state.commandState)
    all {
      isFreshStateProjectionEvidence(state.evidence),
      state' = {
        ...state,
        commandState: NoCommand,
        evidence: NoEvidence,
        commandSettlementCount: state.commandSettlementCount + 1,
        responseAmbiguous: false,
        lastSettlement: Settled({
          intendedCommand: intended,
          evidenceCommand: intended,
          source: SettledFromFreshStateProjection,
        }),
      },
    }
  }

  action releaseFromUnsafeCommandProjection: bool = {
    val projection = commandProjectionOf(state.evidence)
    all {
      isCommandProjectionEvidence(state.evidence),
      projection.outcome == CommandProjectionExactRunning
        or projection.outcome == CommandProjectionNoCurrentReport
        or projection.outcome == CommandProjectionTemporarilyUnavailable
        or projection.outcome == CommandProjectionUnreadable
        or projection.outcome == CommandProjectionContradiction,
      state' = { ...state, positionHeld: false },
    }
  }

  action releaseFromTemporaryFreshStateProjection: bool = all {
    state.evidence == FreshStateProjection({
      correlation: PLANNED_CORRELATION,
      observation: ExecutorStateTemporarilyUnavailable,
    }),
    state' = { ...state, positionHeld: false },
  }

  action releaseFromNoCurrentFreshStateProjection: bool = all {
    state.evidence == FreshStateProjection({
      correlation: PLANNED_CORRELATION,
      observation: ExecutorStateNoCurrentReport,
    }),
    state' = { ...state, positionHeld: false },
  }

  action releaseFromUnreadableFreshStateProjection: bool = all {
    state.evidence == FreshStateProjection({
      correlation: PLANNED_CORRELATION,
      observation: ExecutorStateUnreadable,
    }),
    state' = { ...state, positionHeld: false },
  }

  action releaseFromContradictoryFreshStateProjection: bool = all {
    state.evidence == FreshStateProjection({
      correlation: PLANNED_CORRELATION,
      observation: ExecutorStateContradiction,
    }),
    state' = { ...state, positionHeld: false },
  }

  action recordFourthSuspendCommand: bool = all {
    state.suspendIntentsSinceRunning == SUSPEND_COMMAND_LIMIT,
    isNoCommand(state.commandState),
    state' = {
      ...state,
      commandState: CommandIntended({
        correlation: PLANNED_CORRELATION,
        commandOrdinal: state.nextCommandOrdinal,
        kind: SuspendCommand,
      }),
      nextCommandOrdinal: state.nextCommandOrdinal + 1,
      suspendIntentsSinceRunning: state.suspendIntentsSinceRunning + 1,
      commandIntentCount: state.commandIntentCount + 1,
    },
  }

  action makeReadOnlyRecoveryPermanentlyUnavailable: bool = all {
    state.suspendIntentsSinceRunning == SUSPEND_COMMAND_LIMIT,
    isNoCommand(state.commandState),
    state.reconciliationProjectionsThisActivation == 1,
    state' = { ...state, recoveryCount: RECOVERY_LIMIT + 1 },
  }

  run callWithoutIntentViolatesDurabilityTest = {
    init
      .then(beginResponsibility)
      .then(callWithoutIntent)
      .expect(not(everyCallHasOneDurableIntent))
  }

  run duplicateCallViolatesOneCallPerIntentTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(callSameIntentTwice)
      .expect(not(everyCallHasOneDurableIntent))
  }

  run unmatchedIntentMustReconcileBeforeAnotherCommandTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(loseCommandResponse)
      .then(replaceUnmatchedIntentBeforeReconciliation)
      .expect(not(unmatchedIntentBlocksAnotherCommand))
  }

  run projectionCountedAsResponseViolatesEvidenceSeparationTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionNoCurrentReport))
      .then(countProjectionAsCommandResponse)
      .expect(not(projectionsAreNotCommandResponses))
  }

  run wrongOrdinalCannotSettleIntentTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionExactRunning))
      .then(settleWrongOrdinal)
      .expect(not(settlementsUseExactCommandOrdinal))
  }

  run wrongCorrelationCannotSettleIntentTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionExactRunning))
      .then(settleWrongCorrelation)
      .expect(and {
        not(settlementsUseExactCommandOrdinal),
        not(everyBoundaryValueCarriesPlannedAttempt),
      })
  }

  run stateProjectionCannotSettleUnmatchedIntentTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(loseCommandResponse)
      .then(misclassifyUnmatchedReadAsFreshStateProjection(ExecutorStateSafelySuspended))
      .then(settleFromStateProjection)
      .expect(not(stateProjectionNeverSettlesCommand))
  }

  run unmatchedReadCannotBeClassifiedAsFreshStateProjectionTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(loseCommandResponse)
      .then(misclassifyUnmatchedReadAsFreshStateProjection(ExecutorStateRunning))
      .expect(not(freshStateProjectionHasNoUnmatchedCommand))
  }

  run runningProjectionCannotProveSafetyTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionExactRunning))
      .then(releaseFromUnsafeCommandProjection)
      .expect(not(unsafeOrUnavailableNeverReleasesPosition))
  }

  run unavailableProjectionCannotProveSafetyTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionNoCurrentReport))
      .then(releaseFromUnsafeCommandProjection)
      .expect(not(unsafeOrUnavailableNeverReleasesPosition))
  }

  run temporaryFreshStateProjectionCannotReleasePositionTest = {
    init
      .then(beginResponsibility)
      .then(recordFreshStateProjection(ExecutorStateTemporarilyUnavailable))
      .then(releaseFromTemporaryFreshStateProjection)
      .expect(not(unsafeOrUnavailableNeverReleasesPosition))
  }

  run noCurrentFreshStateProjectionCannotReleasePositionTest = {
    init
      .then(beginResponsibility)
      .then(recordFreshStateProjection(ExecutorStateNoCurrentReport))
      .then(releaseFromNoCurrentFreshStateProjection)
      .expect(not(unsafeOrUnavailableNeverReleasesPosition))
  }

  run unreadableFreshStateProjectionCannotReleasePositionTest = {
    init
      .then(beginResponsibility)
      .then(recordFreshStateProjection(ExecutorStateUnreadable))
      .then(releaseFromUnreadableFreshStateProjection)
      .expect(not(unsafeOrUnavailableNeverReleasesPosition))
  }

  run contradictoryFreshStateProjectionCannotReleasePositionTest = {
    init
      .then(beginResponsibility)
      .then(recordFreshStateProjection(ExecutorStateContradiction))
      .then(releaseFromContradictoryFreshStateProjection)
      .expect(not(unsafeOrUnavailableNeverReleasesPosition))
  }

  run fourthSuspendCommandViolatesBoundTest = {
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
      .then(recordFourthSuspendCommand)
      .expect(not(commandBudgetsAreBounded))
  }

  run suspendLimitCannotBecomePermanentReadOnlyDeadEndTest = {
    init
      .then(beginResponsibility)
      .then(recordStartOrContinueIntent)
      .then(callStartOrContinue)
      .then(receiveCommandResponse(ReportRunning))
      .then(settleCommandResponse)
      .then(recordSuspendIntent)
      .then(callSuspend)
      .then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionExactRunning))
      .then(settleCommandProjection)
      .then(recoverActivation)
      .then(recordSuspendIntent)
      .then(callSuspend)
      .then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionExactRunning))
      .then(settleCommandProjection)
      .then(recoverActivation)
      .then(recordSuspendIntent)
      .then(callSuspend)
      .then(loseCommandResponse)
      .then(recordCommandProjection(CommandProjectionExactRunning))
      .then(settleCommandProjection)
      .then(makeReadOnlyRecoveryPermanentlyUnavailable)
      .expect(not(suspendLimitPreservesReadOnlyRecovery))
  }

  run thirdLostSuspendCannotUseGenericStateProjectionTest = {
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
      .then(loseCommandResponse)
      .then(recoverActivation)
      .then(misclassifyUnmatchedReadAsFreshStateProjection(ExecutorStateSafelySuspended))
      .expect(not(freshStateProjectionHasNoUnmatchedCommand))
  }
}
