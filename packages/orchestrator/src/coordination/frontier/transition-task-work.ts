import type { RunnableFrontierTransition } from "./frontier.js"

/** How one proposed transition relates to the process-local position for its ticket. */
export type TransitionTaskWorkPosition = "Existing" | "ReserveOrReuse" | null

/** Pure domain requirement shared by proposal construction and runtime admission. */
export const transitionTaskWorkPosition = (transition: RunnableFrontierTransition): TransitionTaskWorkPosition =>
  transition._tag === "AdvanceAttemptStoppage"
    ? transition.taskWorkPosition === "ReserveOrReuse"
      ? "ReserveOrReuse"
      : null
    : transition._tag === "ObserveAttemptStoppageExecutor"
      ? "ReserveOrReuse"
      : transition._tag === "SuspendPlannedAttemptExecutorWork"
        ? "Existing"
        : transition._tag === "CommitFreshTaskClaimIntent" ||
            transition._tag === "ContinuePlannedAttemptExecutorWork" ||
            transition._tag === "StartPlannedAttemptExecutorWork"
          ? "ReserveOrReuse"
          : null
