module executorGuidanceNegativeTest {
  import executorGuidance.* from "./executorGuidance"
  action duplicateCallMutant = state' = { ...state,
    receipts: state.receipts.set(1, { ...state.receipts.get(1), calls: 2 }) }
  run detectsDuplicateTransmissionTest = initWithFaults(true).then(admit(1, 1, 1)).then(selectTurn(1)).then(dispatch(1))
    .then(duplicateCallMutant).expect(not(sendsAreBounded))
  action foreignTargetMutant = state' = { ...state,
    receipts: state.receipts.set(1, { ...state.receipts.get(1), sentAttempt: 2 }) }
  run detectsCrossedAttemptTest = initWithFaults(true).then(admit(1, 1, 1)).then(selectTurn(1)).then(dispatch(1))
    .then(foreignTargetMutant).expect(not(exactTurnOnly))
  action durableTextMutant = state' = { ...state, durableText: true }
  run detectsDurablePayloadTest = initWithFaults(true).then(durableTextMutant).expect(not(metadataDoesNotPersistText))
  action authorityMutant = state' = { ...state, authorityChanges: 1 }
  run detectsContentAsAuthorityTest = initWithFaults(true).then(authorityMutant).expect(not(guidanceGrantsNoAuthority))
  action unsentProofMutant = state' = { ...state,
    receipts: state.receipts.set(1, { ...state.receipts.get(1), disposition: PayloadLost }) }
  run detectsUncertaintyDowngradeTest = initWithFaults(true).then(admit(1, 1, 1)).then(selectTurn(1)).then(crash).then(recover)
    .then(unsentProofMutant).expect(not(lostTextCannotProveNoTransmission))
}
