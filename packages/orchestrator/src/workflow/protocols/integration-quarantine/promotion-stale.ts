import { RunId } from "@dalph/contracts"
import type { GitCommitSha } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import {
  targetPromotionCandidateCommitOf,
  targetPromotionCorrelationEquals,
  targetPromotionRunIdOf,
  TargetPromotionCorrelation
} from "../target-promotion/events.js"
import type { TargetPromotionStaleEvent } from "../target-promotion/events.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { integrationQuarantinedRecordKey, targetPromotionStaleRecordKey } from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import {
  journalRecordByKey,
  journalRecordByPosition,
  journalRecordsForPromotionRequest,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { IntegrationQuarantineBasis, IntegrationQuarantinedEvent } from "./events.js"
import { integratorCorrelationsEqual } from "../integrator/state.js"
import { promotionStaleQuarantineEvidenceIssue } from "./promotion-stale-evidence.js"

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
type QuarantineRecord = JournalRecord & { readonly event: IntegrationQuarantinedEvent }

const isPromotionStaleRecordFor = (
  record: JournalRecord,
  correlation: TargetPromotionCorrelation
): record is PromotionStaleRecord =>
  record.event._tag === "TargetPromotionStale" &&
  targetPromotionCorrelationEquals(record.event.correlation, correlation)

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
  record: JournalRecord | undefined,
  input: PromotionStaleIntegrationQuarantineInput,
  basis: Extract<IntegrationQuarantineBasis, { readonly _tag: "PromotionStale" }>
): record is QuarantineRecord => {
  const session = input.correlation.qualifiedCandidate.run.session
  return (
    record !== undefined &&
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
  records: JournalHistorySource,
  correlation: TargetPromotionCorrelation
): PromotionStaleIntegrationQuarantineInput | undefined => {
  let stale: PromotionStaleRecord | undefined
  for (const record of journalRecordsForPromotionRequest(records, correlation.requestId)) {
    if (isPromotionStaleRecordFor(record, correlation)) stale = record
  }
  if (stale === undefined || promotionStaleQuarantineEvidenceIssue(records, stale) !== undefined) return undefined
  const input = PromotionStaleIntegrationQuarantineInput.make({ correlation, targetPromotionStaleAt: stale.position })
  const basis = basisFor(input, stale)
  return sameEvidence(
    journalRecordByKey(
      records,
      integrationQuarantinedRecordKey(correlation.qualifiedCandidate.run.session.sessionId, basis)
    ),
    input,
    basis
  )
    ? undefined
    : input
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
  const accepted = yield* AcceptedJournalReader
  const runId = runIdFor(request.correlation)
  const records = yield* accepted.readAccepted(runId)
  const stale = journalRecordByPosition(records, request.targetPromotionStaleAt)
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
  const existing = journalRecordByKey(records, key)
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
        const refreshed = yield* accepted.readAccepted(runId)
        const winner = journalRecordByPosition(refreshed, existingPosition)
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
