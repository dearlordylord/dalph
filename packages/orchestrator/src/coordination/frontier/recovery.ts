import { Effect } from "effect"
import { type RunId } from "@dalph/contracts"
import type { OperationId } from "../../workflow/identity.js"
import { InRunJournal } from "../../workflow-journal/store.js"
import { WorkflowInterpreter } from "../../workflow/interpretation/interpreter.js"

export const recoverTaskClaimOperation = Effect.fn("WorkflowRecovery.recoverTaskClaimOperation")(function* (
  runId: RunId,
  operationId: OperationId
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
  operationId: OperationId
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
  function* (runId: RunId, operationId: OperationId) {
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
