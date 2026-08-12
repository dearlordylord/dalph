import type { JournalRecord } from "../workflow-journal/store.js"
import type { WorkflowOperation } from "./registry/operation.js"
import { workflowOperationId } from "./registry/operation.js"

const journaledOperation = (record: JournalRecord): WorkflowOperation | undefined =>
  record.event._tag === "PlannedAttemptReplaced"
    ? record.event.successorPlan
    : "operation" in record.event
      ? record.event.operation
      : undefined

/** Returns every durable operation that causally precedes the supplied operation. */
export const causalPredecessorOperationIds = (
  records: ReadonlyArray<JournalRecord>,
  operation: WorkflowOperation
): ReadonlySet<ReturnType<typeof workflowOperationId>> => {
  const operations = new Map(
    records.flatMap((record) => {
      const candidate = journaledOperation(record)
      return candidate === undefined ? [] : [[workflowOperationId(candidate), candidate] as const]
    })
  )
  const visit = (
    pending: ReadonlyArray<ReturnType<typeof workflowOperationId>>,
    reachable: ReadonlySet<ReturnType<typeof workflowOperationId>>
  ): ReadonlySet<ReturnType<typeof workflowOperationId>> => {
    const [operationId, ...remaining] = pending
    if (operationId === undefined) return reachable
    /* v8 ignore next -- @preserve Defensive cycle closure for externally persisted predecessor graphs. */
    if (reachable.has(operationId)) return visit(remaining, reachable)
    const predecessor = operations.get(operationId)
    return visit([...remaining, ...(predecessor?.predecessorOperationIds ?? [])], new Set([...reachable, operationId]))
  }
  return visit(operation.predecessorOperationIds, new Set())
}
