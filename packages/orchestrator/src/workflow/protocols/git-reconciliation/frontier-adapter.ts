import {
  type AcceptedPlannedAttemptExecutorProgress,
  type PlannedAttemptExecutorDisposition,
  ResponsibilityDisposition
} from "../../../coordination/frontier/fresh-facts.js"
import type { TargetLineageDecision } from "./decision.js"

/** Maps a proven target-lineage decision into the ordinary executor-responsibility frontier. */
export const responsibilityDispositionForTargetLineage = (
  acceptedProgress: AcceptedPlannedAttemptExecutorProgress,
  decision: TargetLineageDecision,
  safelySuspended: boolean
): PlannedAttemptExecutorDisposition =>
  decision._tag === "CompatibleTargetAdvance"
    ? { _tag: "Ready", acceptedProgress }
    : safelySuspended
      ? ResponsibilityDisposition.PlannedAttemptGitConstraint({ gitState: "TargetRewrite" })
      : ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
