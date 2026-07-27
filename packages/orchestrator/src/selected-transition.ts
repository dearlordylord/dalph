import { type RunId, SelectedTransitionFingerprint, SelectedTransitionIdentity } from "./domain.js"
import type { RunnableFrontierTransition } from "./runnable-frontier.js"

/** Builds the exact structural identity of one immutable selector result. */
export const makeSelectedTransitionIdentity = (
  runId: RunId,
  transition: RunnableFrontierTransition
): SelectedTransitionIdentity =>
  SelectedTransitionIdentity.make({
    decisionFingerprint: SelectedTransitionFingerprint.make(
      JSON.stringify({
        operationId: "operationId" in transition ? transition.operationId : null,
        runId,
        taskId: transition.taskId,
        tag: transition._tag
      })
    ),
    runId,
    subjectTaskId: transition.taskId,
    transitionTag: transition._tag
  })

export const selectedTransitionKey = (
  selected: SelectedTransitionIdentity
): string => JSON.stringify(selected)
