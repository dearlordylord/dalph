import type { GitCommitSha, IntegrationTarget, PlannedTaskAttempt, RunId } from "@dalph/contracts"
import { intentRecordKey, outcomeRecordKey } from "../../../workflow-journal/record-key.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  isJournalRecordEvidence,
  journalRecordByKey,
  journalRecordByPosition,
  journalRecordsForOperationId,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"

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
  records: JournalHistorySource,
  request: ExactTargetLineageRequest,
  bounds: { readonly afterPosition?: JournalPosition; readonly beforePosition?: JournalPosition } = {}
): ExactTargetLineage | undefined => {
  const runId: RunId = request.plannedAttempt.runId
  const observationMatches = (record: JournalRecord | undefined): record is TargetLineageObservationRecord =>
    record !== undefined &&
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
  const observations = isJournalRecordEvidence(records)
    ? [journalRecordByPosition(records, request.targetLineageObservedAt)].filter(observationMatches)
    : records.filter(observationMatches)
  if (observations.length !== 1) return undefined
  const observation = observations[0]
  if (observation === undefined) return undefined
  const operationId = observation.event.operationId
  let sameOperationObservationCount = 0
  for (const record of journalRecordsForOperationId(records, operationId)) {
    if (record.event._tag === "TargetLineageObserved" && record.event.operationId === operationId) {
      sameOperationObservationCount += 1
      if (record !== observation) return undefined
    }
  }
  if (sameOperationObservationCount !== 1) return undefined
  const indexedIntent = isJournalRecordEvidence(records) ? journalRecordByKey(records, intentRecordKey(operationId)) : undefined
  const intents = isJournalRecordEvidence(records)
    ? (indexedIntent === undefined ? [] : [indexedIntent]).filter(
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
    : records.filter(
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
  let sameOperationIntentCount = 0
  for (const record of journalRecordsForOperationId(records, operationId)) {
    if (record.event._tag === "GitReadIntentRecorded" && record.event.operation.operationId === operationId) {
      sameOperationIntentCount += 1
      if (record !== intent) return undefined
    }
  }
  return sameOperationIntentCount === 1 ? { intent, observation } : undefined
}
