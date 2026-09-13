// Provisional local control allowances following #360's 18.238s observed input
// probe and 4.618s owned-server probe. #362 must qualify final production costs.
export const formalGatePolicy = Object.freeze({
  version: 1,
  outerMilliseconds: 1_020_000,
  preparationMilliseconds: 60_000,
  inputSetupMilliseconds: 60_000,
  inputQualificationMilliseconds: 60_000,
  // Provisional: 7.333s complete final snapshot observed; evidence reads and
  // observer drains share the remaining 22.667s. #362 confirms this allowance.
  finalValidationMilliseconds: 30_000,
  executionEnvelopeMilliseconds: 757_000
})
