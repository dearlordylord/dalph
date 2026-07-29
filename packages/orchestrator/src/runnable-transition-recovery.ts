import { Effect } from "effect"
import type { RunId } from "./domain.js"
import { JournalStore } from "./journal-store.js"
import type { RunnableFrontierTransition } from "./runnable-frontier.js"
import { WorkflowInterpreter } from "./workflow.js"

const recoverClaim = Effect.fn("WorkflowRecovery.recoverClaim")(function* (runId: RunId, operationId: string) {
  const journal = yield* JournalStore
  const interpreter = yield* WorkflowInterpreter
  const intent = (yield* journal.read(runId)).find(
    ({ event }) =>
      event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.operationId === operationId
  )?.event
  if (intent?._tag === "TaskClaimAcquisitionIntended") {
    yield* interpreter.acquireTaskClaim(intent.operation)
  }
})

const recoverWorktree = Effect.fn("WorkflowRecovery.recoverWorktree")(function* (runId: RunId, operationId: string) {
  const journal = yield* JournalStore
  const interpreter = yield* WorkflowInterpreter
  const intent = (yield* journal.read(runId)).find(
    ({ event }) => event._tag === "TaskWorktreeReconciliationIntended" && event.operation.operationId === operationId
  )?.event
  if (intent?._tag === "TaskWorktreeReconciliationIntended") {
    yield* interpreter.reconcileTaskWorktree(intent.operation)
  }
})

/** Executes the one generic already-intended operation selected after reconstruction. */
export const recoverRunnableTransition = Effect.fn("WorkflowRecovery.recoverRunnableTransition")(function* (
  runId: RunId,
  transition: RunnableFrontierTransition
) {
  switch (transition._tag) {
    case "CheckTaskClaim":
    case "ReconcileTaskClaim":
      yield* recoverClaim(runId, transition.operationId)
      return
    case "ReconcileTaskWorktree":
      yield* recoverWorktree(runId, transition.operationId)
      return
    case "CommitFreshTaskClaimIntent":
    case "ContinueFreshWorkflowOperation":
    case "ContinuePlannedAttemptExecutorWork":
    case "SuspendPlannedAttemptExecutorWork":
    case "StartPlannedAttemptExecutorWork":
      return
  }
})
