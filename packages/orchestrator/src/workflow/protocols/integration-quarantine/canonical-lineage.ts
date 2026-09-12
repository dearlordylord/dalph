import type { GitCommitSha, IntegrationTarget, PlannedTaskAttempt, RunId } from "@dalph/contracts"
import { intentRecordKey, outcomeRecordKey } from "../../../workflow-journal/record-key.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import type { OperationId } from "../../identity.js"
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

const uniqueLineageObservation = (
  records: JournalHistorySource,
  observation: TargetLineageObservationRecord
): boolean => {
  let count = 0
  for (const record of journalRecordsForOperationId(records, observation.event.operationId)) {
    if (record.event._tag === "TargetLineageObserved" && record.event.operationId === observation.event.operationId) {
      count += 1
      if (record !== observation) return false
    }
  }
  return count === 1
}

const uniqueLineageIntent = (
  records: JournalHistorySource,
  intent: TargetLineageIntentRecord,
  operationId: OperationId
): boolean => {
  let count = 0
  for (const record of journalRecordsForOperationId(records, operationId)) {
    if (record.event._tag === "GitReadIntentRecorded" && record.event.operation.operationId === operationId) {
      count += 1
      if (record !== intent) return false
    }
  }
  return count === 1
}

type LineageBounds = { readonly afterPosition?: JournalPosition; readonly beforePosition?: JournalPosition }

const matchingLineageObservation = (
  records: JournalHistorySource,
  request: ExactTargetLineageRequest,
  bounds: LineageBounds
): TargetLineageObservationRecord | undefined => {
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
  return observations.length === 1 ? observations[0] : undefined
}

const matchingLineageIntent = (
  records: JournalHistorySource,
  request: ExactTargetLineageRequest,
  observation: TargetLineageObservationRecord,
  bounds: LineageBounds
): TargetLineageIntentRecord | undefined => {
  const runId = request.plannedAttempt.runId
  const operationId = observation.event.operationId
  const indexedIntent = isJournalRecordEvidence(records)
    ? journalRecordByKey(records, intentRecordKey(operationId))
    : undefined
  const intentMatches = (record: JournalRecord): record is TargetLineageIntentRecord =>
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
  const intents = isJournalRecordEvidence(records)
    ? (indexedIntent === undefined ? [] : [indexedIntent]).filter(intentMatches)
    : records.filter(intentMatches)
  return intents.length === 1 ? intents[0] : undefined
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
  bounds: LineageBounds = {}
): ExactTargetLineage | undefined => {
  const observation = matchingLineageObservation(records, request, bounds)
  if (observation === undefined || !uniqueLineageObservation(records, observation)) return undefined
  const intent = matchingLineageIntent(records, request, observation, bounds)
  if (intent === undefined) return undefined
  const operationId = observation.event.operationId
  return uniqueLineageIntent(records, intent, operationId) ? { intent, observation } : undefined
}
