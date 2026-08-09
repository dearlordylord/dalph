// Negative control for the accepted evidence-settlement liveness property.
// This deliberately claims releasable evidence retains the position forever;
// TLC must exhibit the ordinary settlement step that releases it.
module plannedAttemptExecutorTemporalNegative {
  import plannedAttemptExecutor.* from "./plannedAttemptExecutor"

  temporal releasableEvidenceNeverReleasesPosition =
    always(releasableEvidenceAwaitingSettlement(state) implies always(state.positionHeld))
}
