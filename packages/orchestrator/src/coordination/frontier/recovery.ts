import { Effect } from "effect"
import { type RunId } from "@dalph/contracts"
import { InRunJournal } from "../../workflow-journal/store.js"
import type { RunnableFrontierTransition } from "./frontier.js"
import { WorkflowInterpreter } from "../../workflow/interpretation/interpreter.js"
import { startQueuedIntegration } from "../../workflow/protocols/integration-admission/protocol.js"

export const recoverTaskClaimOperation = Effect.fn("WorkflowRecovery.recoverTaskClaimOperation")(function* (
  runId: RunId,
  operationId: string
) {
  const journal = yield* InRunJournal
  const interpreter = yield* WorkflowInterpreter
  const intent = (yield* journal.read(runId)).find(
    ({ event }) =>
      event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.operationId === operationId
  )?.event
  if (intent?._tag === "TaskClaimAcquisitionIntended") {
    yield* interpreter.acquireTaskClaim(intent.operation)
  }
})

export const recoverTaskWorktreeOperation = Effect.fn("WorkflowRecovery.recoverTaskWorktreeOperation")(function* (
  runId: RunId,
  operationId: string
) {
  const journal = yield* InRunJournal
  const interpreter = yield* WorkflowInterpreter
  const intent = (yield* journal.read(runId)).find(
    ({ event }) => event._tag === "TaskWorktreeReconciliationIntended" && event.operation.operationId === operationId
  )?.event
  if (intent?._tag === "TaskWorktreeReconciliationIntended") {
    yield* interpreter.reconcileTaskWorktree(intent.operation)
  }
})

export const recoverTaskClaimReleaseOperation = Effect.fn("WorkflowRecovery.recoverTaskClaimReleaseOperation")(
  function* (runId: RunId, operationId: string) {
    const journal = yield* InRunJournal
    const interpreter = yield* WorkflowInterpreter
    const intent = (yield* journal.read(runId)).find(
      ({ event }) => event._tag === "TaskClaimReleaseIntended" && event.operation.release.operationId === operationId
    )?.event
    if (intent?._tag === "TaskClaimReleaseIntended") {
      yield* interpreter.releaseTaskClaim(intent.operation)
    }
  }
)

/** Executes the one generic already-intended operation selected after reconstruction. */
export const recoverRunnableTransition = Effect.fn("WorkflowRecovery.recoverRunnableTransition")(function* (
  runId: RunId,
  transition: RunnableFrontierTransition
) {
  switch (transition._tag) {
    case "CheckTaskClaim":
    case "ReconcileTaskClaim":
      yield* recoverTaskClaimOperation(runId, transition.operationId)
      return
    case "ReconcileTaskClaimRelease":
      yield* recoverTaskClaimReleaseOperation(runId, transition.operationId)
      return
    case "ReconcileTaskWorktree":
      yield* recoverTaskWorktreeOperation(runId, transition.operationId)
      return
    case "StartQueuedIntegration":
      yield* startQueuedIntegration(transition.responsibility)
      return
    case "CommitFreshTaskClaimIntent":
    case "CommitTaskClaimReacquisitionIntent":
    case "AcquireStartedIntegrationTarget":
    case "ContinueStartedIntegrationCandidate":
    case "ContinueFreshWorkflowOperation":
    case "ContinuePlannedAttemptExecutorWork":
    case "QueueAcceptedResultIntegrationResponsibility":
    case "ReleaseStartedIntegrationTarget":
    case "ReleaseExternallyCompletedTaskClaim":
    case "ObservePlannedAttemptContinuationGraph":
    case "ObservePlannedAttemptContinuationClaim":
    case "ObservePlannedAttemptContinuationSpecification":
    case "ObservePlannedAttemptContinuationTargetLineage":
    case "ObservePlannedAttemptContinuationWorktree":
    case "ObserveResponsibleTaskClaim":
    case "SuspendPlannedAttemptExecutorWork":
    case "StartPlannedAttemptExecutorWork":
      return
  }
})
