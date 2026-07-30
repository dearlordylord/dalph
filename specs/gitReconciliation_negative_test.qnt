// Mutation profile proving the safety properties reject the forbidden
// repair, evidence-discard, and stale-overwrite implementations they govern.
module gitReconciliationNegativeTest {
  import gitReconciliation.* from "./gitReconciliation"

  action authorizeForbiddenWorktreeRepair: bool = all {
    state.constraint == WorktreeLostConstraint,
    state' = { ...state, repairAuthorized: true },
  }

  action discardRejectedResultEvidence: bool = all {
    state.decision == ResultCommitRejected,
    state' = { ...state, worktreePreserved: false, evidencePreserved: false },
  }

  action overwriteStaleTarget: bool = all {
    state.decision == ReconcileCandidateFromCurrentTarget,
    state' = { ...state, overwriteAuthorized: true },
  }

  run unsafeRepairIsDetected = {
    init
      .then(observeLostWorktree)
      .then(authorizeForbiddenWorktreeRepair)
      .expect(not(lostWorktreeNeverAuthorizesRepair))
  }

  run rejectedResultDiscardIsDetected = {
    init
      .then(observeMissingResultCommit)
      .then(discardRejectedResultEvidence)
      .expect(not(rejectedResultPreservesWorktree))
  }

  run staleOverwriteIsDetected = {
    init
      .then(observeEligibleResultCommit)
      .then(observeStaleTargetAfterVerification)
      .then(overwriteStaleTarget)
      .expect(not(staleTargetNeverOverwrites))
  }
}
