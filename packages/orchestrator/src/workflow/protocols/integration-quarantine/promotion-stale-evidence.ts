import {
  targetPromotionCorrelationEquals,
  targetPromotionExpectedHeadOf,
  type TargetPromotionAttemptIntendedEvent
} from "../target-promotion/events.js"
import { targetPromotionAttemptIntentRecordKey } from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"

type PromotionAttemptRecord = JournalRecord & { readonly event: TargetPromotionAttemptIntendedEvent }

/**
 * A stored stale-promotion fact authorizes quarantine only when one exact,
 * earlier compare-and-set intent proves that Git was actually asked to cross
 * the expected-head boundary for the same promotion.
 */
export const promotionStaleQuarantineEvidenceIssue = (
  records: ReadonlyArray<JournalRecord>,
  stale: JournalRecord
): string | undefined => {
  if (stale.event._tag !== "TargetPromotionStale") return "evidence is not a target-promotion stale event"
  if (stale.event.basis._tag !== "AfterAttempt") {
    return "promotion-stale quarantine requires a stale result after a numbered compare-and-set attempt"
  }
  if (stale.event.observation.observedHeadSha === targetPromotionExpectedHeadOf(stale.event.correlation)) {
    return "promotion-stale quarantine cannot follow an unchanged expected head"
  }
  const { attemptOrdinal } = stale.event.basis
  const staleCorrelation = stale.event.correlation
  const attempts = records.filter(
    (record): record is PromotionAttemptRecord =>
      record.position < stale.position &&
      record.runId === stale.runId &&
      record.event._tag === "TargetPromotionAttemptIntended" &&
      record.event.attemptOrdinal === attemptOrdinal &&
      targetPromotionCorrelationEquals(record.event.correlation, staleCorrelation)
  )
  const attempt = attempts.length === 1 ? attempts[0] : undefined
  return attempt !== undefined &&
    attempt.key === targetPromotionAttemptIntentRecordKey(staleCorrelation.requestId, attemptOrdinal)
    ? undefined
    : "promotion-stale quarantine requires one exact earlier correlated compare-and-set attempt intent"
}
