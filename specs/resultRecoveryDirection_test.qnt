module resultRecoveryDirectionTest {
  import resultRecoveryDirection.* from "./resultRecoveryDirection"

  run exactDirectionRedeliveryAfterCrashDoesNotApplyAgainTest = init
    .then(observeInitial(Rejected, true))
    .then(apply(request(1, ContinueRetained, 1, RejectionSubject)))
    .then(crash).then(recover)
    .then(apply(request(1, ContinueRetained, 1, RejectionSubject)))
    .expect(state.outcome == ExactRedelivery and state.applications == 1
      and eachRecordedDirectionAppliedOnce and admissionClaimsNoExecution)

  run firstDirectionWinsBothRequestAndReportRaceTest = init
    .then(observeInitial(Rejected, true))
    .then(apply(request(1, ContinueRetained, 1, RejectionSubject)))
    .then(apply(request(1, RestartFresh, 1, RejectionSubject)))
    .expect(state.outcome == IdentityContradiction)
    .then(apply(request(2, RestartFresh, 1, RejectionSubject)))
    .expect(state.outcome == Unavailable and state.applications == 1)

  run historicalUnknownFailureRequiresFreshExplicitRestartTest = init
    .then(observeInitial(HistoricalFailed, true))
    .then(apply(request(1, ContinueRetained, 1, HistoricalFailureSubject)))
    .expect(state.outcome == Unavailable and state.applications == 0)
    .then(apply(request(1, RestartFresh, 1, HistoricalFailureSubject)))
    .then(recheck(request(1, RestartFresh, 1, HistoricalFailureSubject)))
    .expect(state.outcome == Authorized and state.applications == 1
      and state.terminalSeal == HistoricalFailed)

  run laterTerminalInvalidatesEarlierRecoveryWithoutChangingItsRecordedReceiptTest = init
    .then(observeInitial(Rejected, true))
    .then(apply(request(1, RestartFresh, 1, RejectionSubject)))
    .then(observeLater(Accepted, true))
    .then(recheck(request(1, RestartFresh, 1, RejectionSubject)))
    .expect(state.outcome == Unavailable and state.report == Accepted)
    .then(apply(request(1, RestartFresh, 1, RejectionSubject)))
    .expect(state.outcome == ExactRedelivery and state.applications == 1
      and acceptedTerminalSealIsAbsorbing)

  run newRejectedCycleRequiresNewReportAndNewRequestIdentityTest = init
    .then(observeInitial(Rejected, true))
    .then(apply(request(1, ContinueRetained, 1, RejectionSubject)))
    .then(observeLater(Rejected, true))
    .then(apply(request(1, ContinueRetained, 2, RejectionSubject)))
    .expect(state.outcome == IdentityContradiction and state.applications == 1)
    .then(apply(request(2, ContinueRetained, 1, RejectionSubject)))
    .expect(state.outcome == Unavailable and state.applications == 1)
    .then(apply(request(2, ContinueRetained, 2, RejectionSubject)))
    .expect(state.outcome == Recorded and state.applications == 2)

  run unresolvedCustodyAndForeignPlanCannotAdmitDirectionTest = init
    .then(observeInitial(Rejected, false))
    .then(apply(request(1, ContinueRetained, 1, RejectionSubject)))
    .expect(state.outcome == Unavailable)
    .then(apply({ ...request(1, RestartFresh, 1, RejectionSubject), plan: ForeignPlan }))
    .expect(state.outcome == Unavailable and state.applications == 0)

  run knownFailureNeverBecomesPreSealRejectionTest = init
    .then(observeInitial(KnownFailed, true))
    .then(apply(request(1, RestartFresh, 1, HistoricalFailureSubject)))
    .expect(state.outcome == Unavailable and state.applications == 0
      and state.report == KnownFailed and acceptedTerminalSealIsAbsorbing)

  run integrationCutoffRemainsClosedTest = init
    .then(observeInitial(Accepted, true)).then(beginIntegration)
    .then(apply(request(1, RestartFresh, 1, RejectionSubject)))
    .expect(state.outcome == Unavailable and state.applications == 0)

  run replacementCutoffRemainsClosedTest = init
    .then(observeInitial(HistoricalFailed, true))
    .then(apply(request(1, RestartFresh, 1, HistoricalFailureSubject)))
    .then(recheck(request(1, RestartFresh, 1, HistoricalFailureSubject))).then(replaceAttempt)
    .then(recheck(request(1, RestartFresh, 1, HistoricalFailureSubject)))
    .expect(state.outcome == Unavailable and state.applications == 1
      and acceptedTerminalSealIsAbsorbing)
}
