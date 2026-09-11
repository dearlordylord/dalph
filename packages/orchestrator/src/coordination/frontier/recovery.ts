import { Effect } from "effect"
import { type RunId } from "@dalph/contracts"
import type { OperationId } from "../../workflow/identity.js"
import { AcceptedJournalReader } from "../../workflow-journal/accepted-reader.js"
import { journalRecordByKey } from "../../workflow-journal/record-evidence.js"
import { intentRecordKey } from "../../workflow-journal/record-key.js"
import { WorkflowInterpreter } from "../../workflow/interpretation/interpreter.js"
import { type DeliveryActionExecutionLease, interruptibleBoundaryOf } from "../delivery/delivery-action-executor.js"

type BoundaryExecutionLease = Pick<DeliveryActionExecutionLease, "forwardBoundary" | "recordIntent">

export const recoverTaskClaimOperation = Effect.fn("WorkflowRecovery.recoverTaskClaimOperation")(function* (
  runId: RunId,
  operationId: OperationId,
  lease: BoundaryExecutionLease
) {
  const journal = yield* AcceptedJournalReader
  const interpreter = yield* WorkflowInterpreter
  const intent = journalRecordByKey(yield* journal.readAccepted(runId), intentRecordKey(operationId))?.event
  if (intent?._tag === "TaskClaimAcquisitionIntended") {
    yield* interpreter.acquireTaskClaim(
      intent.operation,
      lease.recordIntent(operationId),
      interruptibleBoundaryOf(lease)
    )
  }
})

export const recoverTaskWorktreeOperation = Effect.fn("WorkflowRecovery.recoverTaskWorktreeOperation")(function* (
  runId: RunId,
  operationId: OperationId,
  lease: BoundaryExecutionLease
) {
  const journal = yield* AcceptedJournalReader
  const interpreter = yield* WorkflowInterpreter
  const intent = journalRecordByKey(yield* journal.readAccepted(runId), intentRecordKey(operationId))?.event
  if (intent?._tag === "TaskWorktreeReconciliationIntended") {
    yield* interpreter.reconcileTaskWorktree(
      intent.operation,
      lease.recordIntent(operationId),
      interruptibleBoundaryOf(lease)
    )
  }
})

export const recoverTaskClaimReleaseOperation = Effect.fn("WorkflowRecovery.recoverTaskClaimReleaseOperation")(
  function* (runId: RunId, operationId: OperationId, lease: BoundaryExecutionLease) {
    const journal = yield* AcceptedJournalReader
    const interpreter = yield* WorkflowInterpreter
    const intent = journalRecordByKey(yield* journal.readAccepted(runId), intentRecordKey(operationId))?.event
    if (intent?._tag === "TaskClaimReleaseIntended") {
      yield* interpreter.releaseTaskClaim(
        intent.operation,
        lease.recordIntent(operationId),
        interruptibleBoundaryOf(lease)
      )
    }
  }
)
