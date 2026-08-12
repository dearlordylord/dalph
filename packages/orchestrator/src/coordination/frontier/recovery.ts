import { Effect } from "effect"
import { type RunId } from "@dalph/contracts"
import type { OperationId } from "../../workflow/identity.js"
import { InRunJournal } from "../../workflow-journal/store.js"
import { WorkflowInterpreter } from "../../workflow/interpretation/interpreter.js"
import { type DeliveryActionExecutionLease, interruptibleBoundaryOf } from "../delivery/delivery-action-executor.js"

type BoundaryExecutionLease = Pick<DeliveryActionExecutionLease, "forwardBoundary" | "recordIntent">

export const recoverTaskClaimOperation = Effect.fn("WorkflowRecovery.recoverTaskClaimOperation")(function* (
  runId: RunId,
  operationId: OperationId,
  lease?: BoundaryExecutionLease
) {
  const journal = yield* InRunJournal
  const interpreter = yield* WorkflowInterpreter
  const intent = (yield* journal.read(runId)).find(
    ({ event }) =>
      event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.operationId === operationId
  )?.event
  if (intent?._tag === "TaskClaimAcquisitionIntended") {
    yield* interpreter.acquireTaskClaim(
      intent.operation,
      lease?.recordIntent(operationId),
      lease === undefined ? undefined : interruptibleBoundaryOf(lease)
    )
  }
})

export const recoverTaskWorktreeOperation = Effect.fn("WorkflowRecovery.recoverTaskWorktreeOperation")(function* (
  runId: RunId,
  operationId: OperationId,
  lease?: BoundaryExecutionLease
) {
  const journal = yield* InRunJournal
  const interpreter = yield* WorkflowInterpreter
  const intent = (yield* journal.read(runId)).find(
    ({ event }) => event._tag === "TaskWorktreeReconciliationIntended" && event.operation.operationId === operationId
  )?.event
  if (intent?._tag === "TaskWorktreeReconciliationIntended") {
    yield* interpreter.reconcileTaskWorktree(
      intent.operation,
      lease?.recordIntent(operationId),
      lease === undefined ? undefined : interruptibleBoundaryOf(lease)
    )
  }
})

export const recoverTaskClaimReleaseOperation = Effect.fn("WorkflowRecovery.recoverTaskClaimReleaseOperation")(
  function* (runId: RunId, operationId: OperationId, lease?: BoundaryExecutionLease) {
    const journal = yield* InRunJournal
    const interpreter = yield* WorkflowInterpreter
    const intent = (yield* journal.read(runId)).find(
      ({ event }) => event._tag === "TaskClaimReleaseIntended" && event.operation.release.operationId === operationId
    )?.event
    if (intent?._tag === "TaskClaimReleaseIntended") {
      yield* interpreter.releaseTaskClaim(
        intent.operation,
        lease?.recordIntent(operationId),
        lease === undefined ? undefined : interruptibleBoundaryOf(lease)
      )
    }
  }
)
