module resultRecoveryDirectionNegativeTest {
  import resultRecoveryDirection.* from "./resultRecoveryDirection"

  action duplicateApplication: bool = all {
    state.directions.size() == 1,
    state' = { ...state, applications: state.applications + 1 },
  }
  action authorizeStaleDirection: bool = all {
    state.directions.contains(state.lastRequest),
    not(currentSelection(state, state.lastRequest)),
    state' = { ...state, outcome: Authorized },
  }
  action overwriteTerminalSeal: bool = all {
    state.terminalSeal == Accepted,
    state' = { ...state, report: Rejected },
  }
  action allowHistoricalContinue: bool = all {
    state.report == HistoricalFailed,
    state' = {
      ...state, directions: Set(request(1, ContinueRetained, 1, HistoricalFailureSubject)), applications: 1,
    },
  }
  action reuseIdentityWithOtherContents: bool = all {
    state.directions.size() == 1,
    state' = {
      ...state, directions: state.directions.union(Set(request(1, RestartFresh, 1, RejectionSubject))),
    },
  }
  action competingRequestWinsSameReport: bool = all {
    state.directions.size() == 1,
    state' = {
      ...state, directions: state.directions.union(Set(request(2, RestartFresh, 1, RejectionSubject))),
    },
  }
  action executeAtReceipt: bool = all {
    state.directions.size() == 1,
    state' = { ...state, executorCalls: 1, permissionCount: 1 },
  }

  run duplicateApplicationIsDetectedTest = init.then(observeInitial(Rejected, true))
    .then(apply(request(1, ContinueRetained, 1, RejectionSubject))).then(duplicateApplication)
    .expect(not(eachRecordedDirectionAppliedOnce))
  run staleAuthorizationIsDetectedTest = init.then(observeInitial(Rejected, true))
    .then(apply(request(1, RestartFresh, 1, RejectionSubject))).then(observeLater(Accepted, true))
    .then(authorizeStaleDirection).expect(not(staleDirectionCannotAuthorize))
  run overwrittenTerminalSealIsDetectedTest = init.then(observeInitial(Accepted, true))
    .then(overwriteTerminalSeal).expect(not(acceptedTerminalSealIsAbsorbing))
  run historicalContinueIsDetectedTest = init.then(observeInitial(HistoricalFailed, true))
    .then(allowHistoricalContinue).expect(not(historicalFailureIsRestartOnly))
  run conflictingIdentityIsDetectedTest = init.then(observeInitial(Rejected, true))
    .then(apply(request(1, ContinueRetained, 1, RejectionSubject))).then(reuseIdentityWithOtherContents)
    .expect(not(directionIdentityIsExact))
  run competingDirectionIsDetectedTest = init.then(observeInitial(Rejected, true))
    .then(apply(request(1, ContinueRetained, 1, RejectionSubject))).then(competingRequestWinsSameReport)
    .expect(not(firstDirectionWinsSelectedReport))
  run receiptWithExecutorEffectsIsDetectedTest = init.then(observeInitial(Rejected, true))
    .then(apply(request(1, ContinueRetained, 1, RejectionSubject))).then(executeAtReceipt)
    .expect(not(admissionClaimsNoExecution))
}
