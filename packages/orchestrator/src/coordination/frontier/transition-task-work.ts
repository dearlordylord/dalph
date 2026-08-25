import type { RunnableFrontierTransition } from "./frontier.js"

/** How one proposed transition relates to the process-local position for its ticket. */
export type TransitionTaskWorkPosition = "Existing" | "ReserveOrReuse" | null

const fixedTransitionTaskWorkPositions: Partial<
  Record<
    Exclude<RunnableFrontierTransition["_tag"], "AdvanceAttemptStoppage">,
    Exclude<TransitionTaskWorkPosition, null>
  >
> = {
  CommitFreshTaskClaimIntent: "ReserveOrReuse",
  ContinuePlannedAttemptExecutorWork: "ReserveOrReuse",
  ContinuePlannedAttemptExecutorWorkAfterCurrentFacts: "ReserveOrReuse",
  ObserveAttemptStoppageExecutor: "ReserveOrReuse",
  StartPlannedAttemptExecutorWork: "Existing",
  SuspendPlannedAttemptExecutorWork: "Existing"
}

/** Pure domain requirement shared by proposal construction and runtime admission. */
export const transitionTaskWorkPosition = (transition: RunnableFrontierTransition): TransitionTaskWorkPosition => {
  if (transition._tag === "AdvanceAttemptStoppage") {
    return transition.taskWorkPosition === "ReserveOrReuse" ? "ReserveOrReuse" : null
  }
  return fixedTransitionTaskWorkPositions[transition._tag] ?? null
}
