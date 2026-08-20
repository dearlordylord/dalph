import type { GitCommitSha, IntegrationTarget, PlannedTaskAttempt, RunId } from "@dalph/contracts"
import { intentRecordKey, outcomeRecordKey } from "../../../workflow-journal/record-key.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"

type TargetLineageIntentRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "GitReadIntentRecorded" }>
}
type TargetLineageObservationRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TargetLineageObserved" }>
}

type ExactTargetLineage = {
  readonly intent: TargetLineageIntentRecord
  readonly observation: TargetLineageObservationRecord
}

type ExactTargetLineageRequest = {
  readonly expectedTargetHead: GitCommitSha
  readonly integrationTarget: IntegrationTarget
  readonly plannedAttempt: PlannedTaskAttempt
  readonly targetLineageObservedAt: JournalPosition
}

/**
 * Reconstructs one exact Git target-lineage read pair. Both records must use
 * the owning Run, deterministic intent/outcome keys, one operation identity,
 * and the exact target/attempt facts. Duplicate or foreign rows are never
 * treated as harmless noise.
 */
export const exactTargetLineageRecord = (
  records: ReadonlyArray<JournalRecord>,
  request: ExactTargetLineageRequest,
  bounds: { readonly afterPosition?: JournalPosition; readonly beforePosition?: JournalPosition } = {}
): ExactTargetLineage | undefined => {
  const runId: RunId = request.plannedAttempt.runId
  const observations = records.filter(
    (record): record is TargetLineageObservationRecord =>
      record.event._tag === "TargetLineageObserved" &&
      record.position === request.targetLineageObservedAt &&
      record.runId === runId &&
      record.key === outcomeRecordKey(record.event.operationId) &&
      (bounds.afterPosition === undefined || record.position > bounds.afterPosition) &&
      (bounds.beforePosition === undefined || record.position < bounds.beforePosition) &&
      record.event.plannedAttempt.runId === runId &&
      record.event.plannedAttempt.attemptId === request.plannedAttempt.attemptId &&
      record.event.observation.plannedBaseSha === request.plannedAttempt.baseSha &&
      record.event.observation.targetHeadSha === request.expectedTargetHead &&
      record.event.observation.plannedBaseIsAncestorOfTargetHead
  )
  if (observations.length !== 1) return undefined
  const observation = observations[0]
  if (observation === undefined) return undefined
  const operationId = observation.event.operationId
  const sameOperationObservations = records.filter(
    (record) => record.event._tag === "TargetLineageObserved" && record.event.operationId === operationId
  )
  if (sameOperationObservations.length !== 1 || sameOperationObservations[0] !== observation) return undefined
  const intents = records.filter(
    (record): record is TargetLineageIntentRecord =>
      record.event._tag === "GitReadIntentRecorded" &&
      record.runId === runId &&
      record.key === intentRecordKey(operationId) &&
      record.position < observation.position &&
      (bounds.afterPosition === undefined || record.position > bounds.afterPosition) &&
      record.event.operation._tag === "ReadTargetLineage" &&
      record.event.operation.operationId === operationId &&
      record.event.operation.plannedAttempt.runId === runId &&
      record.event.operation.plannedAttempt.attemptId === request.plannedAttempt.attemptId &&
      record.event.operation.integrationTarget.repository === request.integrationTarget.repository &&
      record.event.operation.integrationTarget.ref === request.integrationTarget.ref
  )
  if (intents.length !== 1) return undefined
  const intent = intents[0]
  if (intent === undefined) return undefined
  const sameOperationIntents = records.filter(
    (record) => record.event._tag === "GitReadIntentRecorded" && record.event.operation.operationId === operationId
  )
  return sameOperationIntents.length === 1 && sameOperationIntents[0] === intent ? { intent, observation } : undefined
}
