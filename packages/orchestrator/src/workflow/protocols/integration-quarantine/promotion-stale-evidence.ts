import {
  targetPromotionCorrelationEquals,
  targetPromotionExpectedHeadOf,
  targetPromotionRunIdOf,
  type TargetPromotionAttemptIntendedEvent
} from "../target-promotion/events.js"
import {
  integrationQuarantinedRecordKey,
  targetPromotionAttemptIntentRecordKey,
  targetPromotionStaleRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { integratorSessionCorrelationsEqual } from "../integrator/events.js"
import type { IntegrationQuarantinedEvent } from "./events.js"

type PromotionAttemptRecord = JournalRecord & { readonly event: TargetPromotionAttemptIntendedEvent }
type PromotionStaleRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TargetPromotionStale" }>
}
type PromotionStaleQuarantineRecord = JournalRecord & {
  readonly event: IntegrationQuarantinedEvent & { readonly basis: { readonly _tag: "PromotionStale" } }
}

const isPromotionStaleRecord = (record: JournalRecord): record is PromotionStaleRecord =>
  record.event._tag === "TargetPromotionStale"
const isPromotionStaleQuarantineRecord = (record: JournalRecord): record is PromotionStaleQuarantineRecord =>
  record.event._tag === "IntegrationQuarantined" && record.event.basis._tag === "PromotionStale"

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
  if (stale.key !== targetPromotionStaleRecordKey(stale.event.correlation.requestId)) {
    return "promotion-stale evidence has a foreign Journal key"
  }
  if (stale.runId !== targetPromotionRunIdOf(stale.event.correlation)) {
    return "promotion-stale evidence has a foreign Journal Run"
  }
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

export type PromotionStaleQuarantineEvidenceValidation =
  | { readonly _tag: "Invalid"; readonly detail: string }
  | { readonly _tag: "Valid"; readonly stale: PromotionStaleRecord }

/**
 * Canonically validates the complete quarantine-to-stale relation used by
 * state reconstruction, FullRerun authorization, and cleanup provenance.
 */
export const validatePromotionStaleQuarantineEvidence = (
  records: ReadonlyArray<JournalRecord>,
  quarantine: JournalRecord
): PromotionStaleQuarantineEvidenceValidation => {
  if (!isPromotionStaleQuarantineRecord(quarantine)) {
    return { _tag: "Invalid", detail: "evidence is not a promotion-stale quarantine" }
  }
  const { basis, correlation } = quarantine.event
  if (quarantine.runId !== correlation.plannedAttempt.runId) {
    return { _tag: "Invalid", detail: "promotion-stale quarantine has a foreign Journal Run" }
  }
  if (quarantine.key !== integrationQuarantinedRecordKey(correlation.sessionId, basis)) {
    return { _tag: "Invalid", detail: "promotion-stale quarantine has a foreign Journal key" }
  }
  const staleMatches = records.filter(({ position }) => position === basis.targetPromotionStaleAt)
  const stale = staleMatches.length === 1 ? staleMatches[0] : undefined
  if (stale === undefined || !isPromotionStaleRecord(stale)) {
    return { _tag: "Invalid", detail: "promotion-stale quarantine lacks one exact stale record" }
  }
  const staleIssue = promotionStaleQuarantineEvidenceIssue(records, stale)
  if (staleIssue !== undefined) return { _tag: "Invalid", detail: staleIssue }
  if (stale.position >= quarantine.position) {
    return { _tag: "Invalid", detail: "promotion-stale evidence must precede its quarantine" }
  }
  if (!integratorSessionCorrelationsEqual(stale.event.correlation.qualifiedCandidate.run.session, correlation)) {
    return { _tag: "Invalid", detail: "promotion-stale quarantine names a foreign Integrator session" }
  }
  if (stale.event.correlation.qualifiedCandidate.candidateCommit !== basis.candidateCommit) {
    return { _tag: "Invalid", detail: "promotion-stale quarantine names a foreign candidate commit" }
  }
  if (stale.event.observation.observedHeadSha !== basis.observedTargetHead) {
    return { _tag: "Invalid", detail: "promotion-stale quarantine names a foreign observed target head" }
  }
  return { _tag: "Valid", stale }
}
