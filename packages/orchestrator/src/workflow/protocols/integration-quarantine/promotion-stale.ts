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
import type { TargetPromotionStaleEvent } from "../target-promotion/events.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { integrationQuarantinedRecordKey, targetPromotionStaleRecordKey } from "../../../workflow-journal/record-key.js"
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
 * Appends the non-action quarantine that follows a rejected promotion CAS.
 * The stale promotion record is the authority for M/H2; no process-local
 * promotion state or inferred target-head history is accepted.
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
  if (staleObservationHeadOf(stale) === targetPromotionExpectedHeadOf(request.correlation)) {
    return yield* reject(request.correlation, "promotion-stale quarantine cannot follow an unchanged expected head")
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
