import { RunId } from "@dalph/contracts"
import type { GitCommitSha } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import {
  targetPromotionCandidateCommitOf,
  targetPromotionCorrelationEquals,
  targetPromotionExpectedHeadOf,
  targetPromotionRunIdOf,
  TargetPromotionCorrelation
} from "../target-promotion/events.js"
import type { TargetPromotionAttemptIntendedEvent, TargetPromotionStaleEvent } from "../target-promotion/events.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  integrationQuarantinedRecordKey,
  targetPromotionAttemptIntentRecordKey,
  targetPromotionStaleRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { IntegrationQuarantineBasis, IntegrationQuarantinedEvent } from "./events.js"
import { integratorCorrelationsEqual } from "../integrator/state.js"

/** The exact promotion correlation and durable stale event needed to stop the old integration session. */
export const PromotionStaleIntegrationQuarantineInput = Schema.Struct({
  correlation: TargetPromotionCorrelation,
  targetPromotionStaleAt: JournalPosition
})
export type PromotionStaleIntegrationQuarantineInput = typeof PromotionStaleIntegrationQuarantineInput.Type

/** A promotion-stale quarantine cannot be authored without the exact earlier stale promotion fact. */
export class IntegrationPromotionStaleQuarantineRejected extends Schema.TaggedError<IntegrationPromotionStaleQuarantineRejected>()(
  "IntegrationPromotionStaleQuarantineRejected",
  { detail: Schema.String, runId: RunId }
) {}

type PromotionStaleRecord = JournalRecord & { readonly event: TargetPromotionStaleEvent }
type PromotionAttemptRecord = JournalRecord & { readonly event: TargetPromotionAttemptIntendedEvent }
type QuarantineRecord = JournalRecord & { readonly event: IntegrationQuarantinedEvent }

const runIdFor = targetPromotionRunIdOf

const reject = (
  correlation: TargetPromotionCorrelation,
  detail: string
): Effect.Effect<never, IntegrationPromotionStaleQuarantineRejected> =>
  Effect.fail(new IntegrationPromotionStaleQuarantineRejected({ detail, runId: runIdFor(correlation) }))

const staleObservationHeadOf = (record: PromotionStaleRecord): GitCommitSha => record.event.observation.observedHeadSha

const staleRecordMatches = (
  record: JournalRecord | undefined,
  input: PromotionStaleIntegrationQuarantineInput
): record is PromotionStaleRecord =>
  record !== undefined &&
  record.position === input.targetPromotionStaleAt &&
  record.runId === runIdFor(input.correlation) &&
  record.key === targetPromotionStaleRecordKey(input.correlation.requestId) &&
  record.event._tag === "TargetPromotionStale" &&
  targetPromotionCorrelationEquals(record.event.correlation, input.correlation)

/**
 * A promotion-stale quarantine requires one exact compare-and-set attempt.
 * Git may report the changed head directly or through the mandatory read after
 * a lost response; a stale read before any request authorizes no quarantine.
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
      record.key === targetPromotionAttemptIntentRecordKey(staleCorrelation.requestId, attemptOrdinal) &&
      record.event._tag === "TargetPromotionAttemptIntended" &&
      record.event.attemptOrdinal === attemptOrdinal &&
      targetPromotionCorrelationEquals(record.event.correlation, staleCorrelation)
  )
  return attempts.length === 1
    ? undefined
    : "promotion-stale quarantine requires one exact earlier correlated compare-and-set attempt intent"
}

const basisFor = (
  input: PromotionStaleIntegrationQuarantineInput,
  stale: PromotionStaleRecord
): Extract<IntegrationQuarantineBasis, { readonly _tag: "PromotionStale" }> =>
  IntegrationQuarantineBasis.cases.PromotionStale.make({
    candidateCommit: targetPromotionCandidateCommitOf(input.correlation),
    observedTargetHead: staleObservationHeadOf(stale),
    targetPromotionStaleAt: input.targetPromotionStaleAt
  })

const sameEvidence = (
  record: JournalRecord,
  input: PromotionStaleIntegrationQuarantineInput,
  basis: Extract<IntegrationQuarantineBasis, { readonly _tag: "PromotionStale" }>
): record is QuarantineRecord => {
  const session = input.correlation.qualifiedCandidate.run.session
  return (
    record.runId === runIdFor(input.correlation) &&
    record.key === integrationQuarantinedRecordKey(session.sessionId, basis) &&
    record.event._tag === "IntegrationQuarantined" &&
    integratorCorrelationsEqual(record.event.correlation, session) &&
    record.event.basis._tag === "PromotionStale" &&
    record.event.basis.candidateCommit === basis.candidateCommit &&
    record.event.basis.observedTargetHead === basis.observedTargetHead &&
    record.event.basis.targetPromotionStaleAt === basis.targetPromotionStaleAt
  )
}

/**
 * Returns the exact quarantine work that remains after an attempt-backed stale
 * result. An existing equivalent quarantine makes the work complete.
 */
export const pendingPromotionStaleIntegrationQuarantineFor = (
  records: ReadonlyArray<JournalRecord>,
  correlation: TargetPromotionCorrelation
): PromotionStaleIntegrationQuarantineInput | undefined => {
  const stale = records.findLast(
    (record): record is PromotionStaleRecord =>
      record.event._tag === "TargetPromotionStale" &&
      targetPromotionCorrelationEquals(record.event.correlation, correlation)
  )
  if (stale === undefined || promotionStaleQuarantineEvidenceIssue(records, stale) !== undefined) return undefined
  const input = PromotionStaleIntegrationQuarantineInput.make({ correlation, targetPromotionStaleAt: stale.position })
  const basis = basisFor(input, stale)
  return records.some((record) => sameEvidence(record, input, basis)) ? undefined : input
}

/**
 * Appends the non-action quarantine after Git directly rejects a promotion or
 * a mandatory reconciliation read proves the lost candidate absent. The stale
 * promotion record is the authority for M/H2; no process-local promotion state
 * or inferred target-head history is accepted.
 */
export const appendPromotionStaleIntegrationQuarantine = Effect.fn(
  "IntegrationQuarantine.appendPromotionStaleIntegrationQuarantine"
)(function* (input: unknown) {
  const request = yield* Schema.decodeUnknownEffect(PromotionStaleIntegrationQuarantineInput, {
    onExcessProperty: "error"
  })(input)
  const journal = yield* InRunJournal
  const runId = runIdFor(request.correlation)
  const records = yield* journal.read(runId)
  const stale = records.find((record) => record.position === request.targetPromotionStaleAt)
  if (!staleRecordMatches(stale, request)) {
    return yield* reject(
      request.correlation,
      "promotion-stale quarantine requires the exact earlier stale promotion event"
    )
  }
  const evidenceIssue = promotionStaleQuarantineEvidenceIssue(records, stale)
  if (evidenceIssue !== undefined) {
    return yield* reject(request.correlation, evidenceIssue)
  }
  const basis = basisFor(request, stale)
  const key = integrationQuarantinedRecordKey(request.correlation.qualifiedCandidate.run.session.sessionId, basis)
  const existing = records.find((record) => record.key === key)
  if (existing !== undefined) {
    return sameEvidence(existing, request, basis)
      ? existing
      : yield* reject(request.correlation, "promotion-stale quarantine key contains foreign or contradictory evidence")
  }
  const event = IntegrationQuarantinedEvent.make({
    basis,
    correlation: request.correlation.qualifiedCandidate.run.session,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const appended = yield* journal.append(runId, key, event).pipe(
    Effect.catchTag("JournalStoreContradiction", ({ existingPosition }) =>
      Effect.gen(function* () {
        const refreshed = yield* journal.read(runId)
        const winner = refreshed.find((record) => record.position === existingPosition)
        if (winner !== undefined && sameEvidence(winner, request, basis)) return winner
        return yield* reject(
          request.correlation,
          "promotion-stale quarantine append contradicted existing Journal history"
        )
      })
    )
  )
  if (!sameEvidence(appended, request, basis)) {
    return yield* reject(request.correlation, "promotion-stale quarantine append returned foreign evidence")
  }
  return appended
})
