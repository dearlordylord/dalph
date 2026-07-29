import { type RunId, SelectedTransitionFingerprint, SelectedTransitionIdentity } from "./domain.js"
import { type RunnableFrontierTransition, runnableTransitionTaskId } from "./runnable-frontier.js"

const fingerprintInput = (
  runId: RunId,
  transition: RunnableFrontierTransition
) =>
  transition._tag === "ContinuePlannedAttemptExecutorWork"
    || transition._tag === "StartPlannedAttemptExecutorWork"
    || transition._tag === "SuspendPlannedAttemptExecutorWork"
    ? {
      attemptId: transition.plannedAttempt.attemptId,
      runId: transition.plannedAttempt.runId
    }
    : { runId, transition }

/** Builds the exact structural identity of one immutable selector result. */
export const makeSelectedTransitionIdentity = (
  runId: RunId,
  transition: RunnableFrontierTransition
): SelectedTransitionIdentity =>
  SelectedTransitionIdentity.make({
    decisionFingerprint: SelectedTransitionFingerprint.make(
      JSON.stringify(fingerprintInput(runId, transition))
    ),
    runId,
    subjectTaskId: runnableTransitionTaskId(transition),
    transitionTag: transition._tag === "StartPlannedAttemptExecutorWork"
        || transition._tag === "SuspendPlannedAttemptExecutorWork"
      ? "ContinuePlannedAttemptExecutorWork"
      : transition._tag
  })

export const selectedTransitionKey = (
  selected: SelectedTransitionIdentity
): string => JSON.stringify(selected)
