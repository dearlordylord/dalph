// Negative control for the accepted suspension liveness property. This
// deliberately claims a requested position is held forever; TLC must exhibit
// the ordinary safe-suspension trace that releases it.
module plannedAttemptExecutorTemporalNegative {
  import plannedAttemptExecutor.* from "./plannedAttemptExecutor"

  temporal suspensionRequestNeverReleasesPosition =
    always(suspensionRequested(state.status) implies always(state.positionHeld))
}
