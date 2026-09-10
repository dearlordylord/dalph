import type { JournalRecord } from "../workflow-journal/store.js"
import type { WorkflowOperation } from "./registry/operation.js"
import type { workflowOperationId } from "./registry/operation.js"
import {
  journalEvidenceFrom,
  journalOperationById,
  type JournalRecordEvidence
} from "../workflow-journal/record-evidence.js"

/** Traverses indexed decoded evidence without rebuilding an operation map. */
export const causalPredecessorOperationIdsFromEvidence = (
  evidence: JournalRecordEvidence,
  operation: WorkflowOperation
): ReadonlySet<ReturnType<typeof workflowOperationId>> => {
  const visit = (
    pending: ReadonlyArray<ReturnType<typeof workflowOperationId>>,
    reachable: ReadonlySet<ReturnType<typeof workflowOperationId>>
  ): ReadonlySet<ReturnType<typeof workflowOperationId>> => {
    const [operationId, ...remaining] = pending
    if (operationId === undefined) return reachable
    /* v8 ignore next -- @preserve Defensive cycle closure for externally persisted predecessor graphs. */
    if (reachable.has(operationId)) return visit(remaining, reachable)
    const predecessor = journalOperationById(evidence, operationId)
    return visit([...remaining, ...(predecessor?.predecessorOperationIds ?? [])], new Set([...reachable, operationId]))
  }
  return visit(operation.predecessorOperationIds, new Set())
}

/** Cold decoded-array entry point; live callers use indexed evidence. */
export const causalPredecessorOperationIds = (
  records: ReadonlyArray<JournalRecord>,
  operation: WorkflowOperation
): ReadonlySet<ReturnType<typeof workflowOperationId>> =>
  causalPredecessorOperationIdsFromEvidence(journalEvidenceFrom(records), operation)
