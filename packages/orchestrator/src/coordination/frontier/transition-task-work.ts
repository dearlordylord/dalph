import type { RunnableFrontierTransition } from "./frontier.js"

/** How one proposed transition relates to the process-local position for its ticket. */
export type TransitionTaskWorkPosition = "Existing" | "ReserveOrReuse" | null

/** Pure domain requirement shared by proposal construction and runtime admission. */
export const transitionTaskWorkPosition = (transition: RunnableFrontierTransition): TransitionTaskWorkPosition => {
  if (transition._tag === "AdvanceAttemptStoppage") {
    return transition.taskWorkPosition === "ReserveOrReuse" ? "ReserveOrReuse" : null
  }
  if (transition._tag === "SuspendPlannedAttemptExecutorWork") return "Existing"
  const reserveOrReuse = new Set<RunnableFrontierTransition["_tag"]>([
    "BeginPlannedAttemptExecutorWork",
    "CommitFreshTaskClaimIntent",
    "ObserveAttemptStoppageExecutor",
    "ObservePlannedAttemptExecutorWork",
    "ResumePlannedAttemptExecutorWorkAfterCurrentFacts"
  ])
  return reserveOrReuse.has(transition._tag) ? "ReserveOrReuse" : null
}
