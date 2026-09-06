import { Effect } from "effect"
import type { TraceItem } from "@dalph/orchestrator"
import type { StoryCursor } from "./authored-cursor.js"

/**
 * Waits at authored trace seams that precede an operation's cassette decision.
 * These waits model the harness boundary without changing production ordering.
 */
export const awaitTraceSelectionBoundaries = (cursor: StoryCursor, item: TraceItem): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (item._tag !== "OperationSelected") return
    if (item.operation._tag === "ReconcileTaskWorktree") {
      yield* cursor.awaitTaskWorktreeSelectionHold(
        item.operation.plannedAttempt.taskId,
        item.operation.plannedAttempt.attemptId
      )
    }
    // Fresh task-selection claims are parked at the trace seam before the
    // operation-selected event returns to the delivery adapter. This keeps
    // the harness hold ahead of claim intent and tracker mutation while
    // leaving explicit Operator reacquisition and every other operation
    // untouched.
    if (item.operation._tag === "AcquireTaskClaim" && item.operation.authority._tag === "TaskSelectionAuthority") {
      yield* cursor.awaitFreshTaskClaimSelectionHold(item.operation.acquisition.taskId)
    }
    // Stabilization performs its final tracker read outside the delivery
    // action executor. Its operation-selection trace is the remaining
    // same-fiber action boundary for a lifecycle control.
    yield* cursor.pauseAtCoordinatorProcessDeath
  })
