// Per-request finite proof projection of executorGuidance. Nonce 2 remains
// empty; both possible owner identities, changed input, exact turn, acknowledgement,
// cutoff and every crash/observation boundary remain. The canonical two-request
// model and production tests separately cover independence and identity indexing.
module executorGuidanceProof {
  import executorGuidance.* from "./executorGuidance"
  action projectedStep = {
    nondet attempt = Set(1, 2).oneOf()
    nondet digest = Set(1, 2, 3).oneOf()
    nondet exact = Set(true, false).oneOf()
    nondet readable = Set(true, false).oneOf()
    any { admit(1, attempt, digest), selectTurn(1), dispatch(1), acknowledge(1, exact, readable),
      finishTurn(attempt), loseCustody(attempt), loseCapability(attempt), closeAdmission, crash, recover, reconcile(1) }
  }
}
