module executorGuidanceProofTest {
  import executorGuidance.* from "./executorGuidance"
  run exactOwnerAndInputTest = initWithFaults(true).then(admit(1, 2, 1)).then(selectTurn(1)).then(dispatch(1))
    .then(acknowledge(1, true, true)).then(admit(1, 2, 2))
    .expect(acceptedReached and contradictionReached and exactTurnOnly and sendsAreBounded)
  run intentCrashNeverProvesUnsentTest = initWithFaults(true).then(admit(1, 1, 1)).then(selectTurn(1))
    .then(crash).then(recover).then(reconcile(1)).expect(unknownReached and lostTextCannotProveNoTransmission)
}
