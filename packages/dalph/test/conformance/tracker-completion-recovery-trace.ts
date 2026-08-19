import type { JournalRecord } from "@dalph/orchestrator"
import { recoveryPrefixDualStoreExecutionCount, type RecoveryPrefixCutLabel } from "./recovery-prefix-contract.js"
import { prefixThrough, type RecoveryPrefix } from "./recovery-store-lanes.js"

const beforeFirstRecord = Number.NEGATIVE_INFINITY

const indexOf = (
  records: ReadonlyArray<JournalRecord>,
  predicate: (record: JournalRecord) => boolean,
  startAt = beforeFirstRecord
): number | undefined => {
  const index = records.findIndex((record, current) => current > startAt && predicate(record))
  return index < 0 ? undefined : index
}

const isCompletionIntent = (record: JournalRecord): boolean => record.event._tag === "CompletionTaskIntended"
const isAttemptIntent = (record: JournalRecord): boolean => record.event._tag === "CompletionTaskAttemptIntended"
const isRequestOutcome = (record: JournalRecord): boolean =>
  record.event._tag === "CompletionTaskAcknowledged" ||
  record.event._tag === "CompletionTaskRejected" ||
  record.event._tag === "CompletionTaskResponseLost"
const isConfirmationIntent = (record: JournalRecord): boolean =>
  record.event._tag === "TaskTrackerReadIntentRecorded" &&
  record.event.operation._tag === "ReadCompletionTaskFacts" &&
  record.event.operation.purpose._tag === "Confirmation"
const isConfirmationObservation = (record: JournalRecord): boolean =>
  record.event._tag === "TaskTrackerFactsObserved" &&
  record.event.observation._tag === "FocusedTaskCompletionFacts" &&
  record.event.observation.purpose._tag === "Confirmation"
const isFinalitySettlement = (record: JournalRecord): boolean => record.event._tag === "IntegrationFinalitySettled"

const endpoints: Record<RecoveryPrefixCutLabel, string> = {
  P0: "the record before CompletionTaskIntended",
  P1: "CompletionTaskIntended",
  P2: "CompletionTaskAttemptIntended",
  P3: "CompletionTaskAcknowledged, CompletionTaskRejected, or CompletionTaskResponseLost",
  P4: "TaskTrackerReadIntentRecorded:Confirmation",
  P5: "TaskTrackerFactsObserved:Confirmation",
  P6: "IntegrationFinalitySettled"
}

/** One executable trace definition shared by the manifest and both physical store lanes. */
export const trackerCompletionRecoveryTrace = {
  boundaryId: "tracker-completion-finality" as const,
  cassetteKey: "ambiguousCompletionResponse" as const,
  endpoints,
  executionCount: recoveryPrefixDualStoreExecutionCount
} as const

/** Selects the seven retained prefixes from the maintained tracker-completion chronology. */
export const trackerCompletionRecoveryPrefixes = (
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<RecoveryPrefix> => {
  const requestIntentAt = indexOf(records, isCompletionIntent)
  if (requestIntentAt === undefined || requestIntentAt === 0) return []
  const attemptIntentAt = indexOf(records, isAttemptIntent, requestIntentAt)
  if (attemptIntentAt === undefined) return []
  const requestOutcomeAt = indexOf(records, isRequestOutcome, attemptIntentAt)
  if (requestOutcomeAt === undefined) return []
  const confirmationIntentAt = indexOf(records, isConfirmationIntent, requestOutcomeAt)
  if (confirmationIntentAt === undefined) return []
  const confirmationObservationAt = indexOf(records, isConfirmationObservation, confirmationIntentAt)
  if (confirmationObservationAt === undefined) return []
  const settlementAt = indexOf(records, isFinalitySettlement, confirmationObservationAt)
  if (settlementAt === undefined) return []

  const p0 = prefixThrough(records, "P0", endpoints.P0, requestIntentAt - 1)
  const p1 = prefixThrough(records, "P1", endpoints.P1, requestIntentAt)
  const p2 = prefixThrough(records, "P2", endpoints.P2, attemptIntentAt)
  const p3 = prefixThrough(records, "P3", endpoints.P3, requestOutcomeAt)
  const p4 = prefixThrough(records, "P4", endpoints.P4, confirmationIntentAt)
  const p5 = prefixThrough(records, "P5", endpoints.P5, confirmationObservationAt)
  const p6 = prefixThrough(records, "P6", endpoints.P6, settlementAt)
  return p0 === undefined ||
    p1 === undefined ||
    p2 === undefined ||
    p3 === undefined ||
    p4 === undefined ||
    p5 === undefined ||
    p6 === undefined
    ? []
    : [p0, p1, p2, p3, p4, p5, p6]
}
