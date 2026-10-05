module providerResultCorrectionNegativeTest {
  import providerResultCorrection.* from "./providerResultCorrection"

  action resendObservedRequest = state' = {
    ...state, calls: state.calls.append(state.responses),
  }
  action resetRecoveredBudget = state' = { ...state, responses: 0 }
  action extendRecoveredDeadline = state' = { ...state, deadline: state.deadline + 1 }
  action sendExpiredCorrection = state' = {
    ...state, calls: state.calls.append(state.responses),
    lastCallOrdinal: state.responses, lastCallAt: state.now,
    lastCallDeadline: state.deadline,
  }

  run duplicateProviderEffectIsDetectedTest = init
    .then(recordInitialIntent).then(sendOwnedRequest).then(crash)
    .then(recoverExactOwnedRequest).then(resendObservedRequest)
    .expect(not(eachOwnedRequestCrossesAtMostOnce))

  run recoveredBudgetResetIsDetectedTest = init
    .then(recordInitialIntent).then(crash).then(recoverExactOwnedRequest)
    .then(resetRecoveredBudget).expect(not(recoveryPreservesOriginalBudget))

  run recoveredDeadlineExtensionIsDetectedTest = init
    .then(recordInitialIntent).then(sendOwnedRequest).then(observeOwnedTurn)
    .then(rejectResponse).then(recordCorrectionIntent).then(crash)
    .then(recoverExactOwnedRequest).then(extendRecoveredDeadline)
    .expect(not(recoveryPreservesOriginalBudget) and not(correctionDeadlineIsOriginal))

  run expiredProviderEffectIsDetectedTest = init
    .then(recordInitialIntent).then(sendOwnedRequest).then(observeOwnedTurn)
    .then(rejectResponse).then(recordCorrectionIntent)
    .then(advanceCorrectionTime).then(advanceCorrectionTime)
    .then(sendExpiredCorrection).expect(not(noCorrectionCallAfterDeadline))
}
