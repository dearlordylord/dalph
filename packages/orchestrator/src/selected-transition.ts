import { type RunId, SelectedTransitionFingerprint, SelectedTransitionIdentity } from "./domain.js"
import { type RunnableFrontierTransition, runnableTransitionTaskId } from "./runnable-frontier.js"

/** Builds the exact structural identity of one immutable selector result. */
export const makeSelectedTransitionIdentity = (
  runId: RunId,
  transition: RunnableFrontierTransition
): SelectedTransitionIdentity =>
  SelectedTransitionIdentity.make({
    decisionFingerprint: SelectedTransitionFingerprint.make(
      JSON.stringify({
        runId,
        transition
      })
    ),
    runId,
    subjectTaskId: runnableTransitionTaskId(transition),
    transitionTag: transition._tag
  })

export const selectedTransitionKey = (
  selected: SelectedTransitionIdentity
): string => JSON.stringify(selected)
