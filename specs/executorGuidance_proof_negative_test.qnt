module executorGuidanceProofNegativeTest {
  import executorGuidance.* from "./executorGuidance"
  action crossedOwner = state' = { ...state,
    receipts: state.receipts.set(1, { ...state.receipts.get(1), sentAttempt: 2 }) }
  run crossedOwnerDetectedTest = initWithFaults(true).then(admit(1, 1, 1)).then(selectTurn(1)).then(dispatch(1))
    .then(crossedOwner).expect(not(exactTurnOnly))
  action unsentAfterIntent = state' = { ...state,
    receipts: state.receipts.set(1, { ...state.receipts.get(1), disposition: PayloadLost }) }
  run uncertaintyDowngradeDetectedTest = initWithFaults(true).then(admit(1, 1, 1)).then(selectTurn(1))
    .then(crash).then(recover).then(unsentAfterIntent).expect(not(lostTextCannotProveNoTransmission))
}
