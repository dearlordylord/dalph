module providerResultCorrectionTest {
  import providerResultCorrection.* from "./providerResultCorrection"

  run lostAcknowledgementReconcilesWithoutResendTest = init
    .then(recordInitialIntent).then(sendOwnedRequest).then(crash)
    .then(recoverExactOwnedRequest)
    .expect(state.phase == TurnObserved and state.responses == 1
      and state.calls == List(1) and recoveryPreservesOriginalBudget)

  run correctionExpiresWhileControllerIsStoppedTest = init
    .then(recordInitialIntent).then(sendOwnedRequest).then(observeOwnedTurn)
    .then(rejectResponse).then(recordCorrectionIntent).then(crash)
    .then(advanceCorrectionTime).then(advanceCorrectionTime)
    .then(recoverExactOwnedRequest)
    .expect(state.phase == OperatorRequired and state.responses == 2
      and state.deadline == 2 and state.calls == List(1)
      and recoveryPreservesOriginalBudget)

  run thirdRejectedResponseExhaustsOriginalCycleTest = init
    .then(recordInitialIntent).then(sendOwnedRequest).then(observeOwnedTurn)
    .then(rejectResponse).then(recordCorrectionIntent)
    .then(sendOwnedRequest).then(observeOwnedTurn).then(rejectResponse)
    .then(recordCorrectionIntent).then(sendOwnedRequest).then(observeOwnedTurn)
    .then(rejectResponse).then(returnExhausted)
    .expect(state.phase == OperatorRequired and state.responses == 3
      and state.calls == List(1, 2, 3) and responseBudgetBounded)

  run unresolvedRequestPreservesEffectsAndBudgetTest = init
    .then(recordInitialIntent).then(sendOwnedRequest).then(crash)
    .then(recoverUnresolvedRequest)
    .expect(state.phase == OperatorRequired and state.calls == List(1)
      and state.responses == 1 and recoveryPreservesOriginalBudget)
}
