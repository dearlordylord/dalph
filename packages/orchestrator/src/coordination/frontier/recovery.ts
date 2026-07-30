import { Effect } from "effect"
import { type RunId } from "@dalph/contracts"
import { JournalStore } from "../../workflow-journal/store.js"
import type { RunnableFrontierTransition } from "./frontier.js"
import { WorkflowInterpreter } from "../../workflow/interpretation/interpreter.js"
import { startQueuedIntegration } from "../../workflow/protocols/integration-admission/protocol.js"

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

const recoverClaimRelease = Effect.fn("WorkflowRecovery.recoverClaimRelease")(function* (
  runId: RunId,
  operationId: string
) {
  const journal = yield* JournalStore
  const interpreter = yield* WorkflowInterpreter
  const intent = (yield* journal.read(runId)).find(
    ({ event }) => event._tag === "TaskClaimReleaseIntended" && event.operation.release.operationId === operationId
  )?.event
  if (intent?._tag === "TaskClaimReleaseIntended") {
    yield* interpreter.releaseTaskClaim(intent.operation)
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
    case "ReconcileTaskClaimRelease":
      yield* recoverClaimRelease(runId, transition.operationId)
      return
    case "ReconcileTaskWorktree":
      yield* recoverWorktree(runId, transition.operationId)
      return
    case "StartQueuedIntegration":
      yield* startQueuedIntegration(transition.responsibility)
      return
    case "CommitFreshTaskClaimIntent":
    case "AcquireStartedIntegrationTarget":
    case "ContinueFreshWorkflowOperation":
    case "ContinuePlannedAttemptExecutorWork":
    case "QueueAcceptedResultIntegrationResponsibility":
    case "ReleaseStartedIntegrationTarget":
    case "ReleaseExternallyCompletedTaskClaim":
    case "ObservePlannedAttemptContinuationGraph":
    case "ObservePlannedAttemptContinuationSpecification":
    case "SuspendPlannedAttemptExecutorWork":
    case "StartPlannedAttemptExecutorWork":
      return
  }
})
