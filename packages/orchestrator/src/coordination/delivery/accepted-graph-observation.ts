import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import type { TrackerRevision } from "../../authorities/task-tracker/task.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { OperationId } from "../../workflow/identity.js"

const AcceptedTrackerGraphObservationTypeId: unique symbol = Symbol("AcceptedTrackerGraphObservation")

/**
 * One accepted complete or unchanged graph observation. The private brand means
 * only the accepted journal boundary can place graph authority into delivery.
 */
export interface AcceptedTrackerGraphObservation {
  readonly [AcceptedTrackerGraphObservationTypeId]: typeof AcceptedTrackerGraphObservationTypeId
  readonly _tag: "AcceptedTrackerGraphObservation"
  readonly snapshot: TaskDagSnapshot
  readonly operationId: OperationId
  readonly contentIdentity: TrackerRevision
  readonly acceptedAt: JournalPosition
  readonly freshness: { readonly _tag: "ObservedDuringLogicalRead"; readonly operationId: OperationId }
}

type AcceptedGraphJournalRecord = Pick<JournalRecord, "position"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>
}

/**
 * Mints graph authority only from a journal record already accepted by the
 * gateway. Operation identity, content identity, freshness, and journal
 * position all come from that accepted record or its validated graph.
 */
export const acceptedTrackerGraphObservationFromRecord = (
  record: AcceptedGraphJournalRecord,
  snapshot: TaskDagSnapshot
): AcceptedTrackerGraphObservation => ({
  [AcceptedTrackerGraphObservationTypeId]: AcceptedTrackerGraphObservationTypeId,
  _tag: "AcceptedTrackerGraphObservation",
  snapshot,
  operationId: record.event.operationId,
  contentIdentity: snapshot.revision,
  acceptedAt: record.position,
  freshness: { _tag: "ObservedDuringLogicalRead", operationId: record.event.operationId }
})
