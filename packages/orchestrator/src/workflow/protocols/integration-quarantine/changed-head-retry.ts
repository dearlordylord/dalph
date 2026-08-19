import { RunId } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { integrationQuarantinedRecordKey } from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { IntegrationQuarantineBasis, IntegrationQuarantinedEvent } from "./events.js"
import {
  IntegratorSessionCorrelation,
  IntegratorRunCorrelation,
  integratorRetryRunOrdinal
} from "../integrator/events.js"
import {
  evaluateIntegratorRetryAuthorization,
  type IntegratorRetryAuthorization
} from "../integrator/retry-authorization.js"
import { integratorCorrelationsEqual } from "../integrator/state.js"

/** The exact facts needed when Retry discovers that S's fixed head is stale. */
export const ChangedHeadRetryQuarantineInput = Schema.Struct({
  directionAppliedAt: JournalPosition,
  priorQuarantineAt: JournalPosition,
  session: IntegratorSessionCorrelation,
  targetLineage: TargetLineageObservation,
  targetLineageObservedAt: JournalPosition
})
export type ChangedHeadRetryQuarantineInput = typeof ChangedHeadRetryQuarantineInput.Type

/** A malformed Retry relation cannot authorize the changed-head Q2 occurrence. */
export class IntegrationChangedHeadRetryQuarantineRejected extends Schema.TaggedError<IntegrationChangedHeadRetryQuarantineRejected>()(
  "IntegrationChangedHeadRetryQuarantineRejected",
  { detail: Schema.String, runId: RunId }
) {}

type ChangedHeadQuarantineRecord = JournalRecord & { readonly event: IntegrationQuarantinedEvent }

const targetLineageObservationEquivalence = Schema.toEquivalence(TargetLineageObservation)

const runIdFor = (session: IntegratorSessionCorrelation) => session.plannedAttempt.runId

const reject = (
  session: IntegratorSessionCorrelation,
  detail: string
): Effect.Effect<never, IntegrationChangedHeadRetryQuarantineRejected> =>
  Effect.fail(new IntegrationChangedHeadRetryQuarantineRejected({ detail, runId: runIdFor(session) }))

const changedHeadBasisEquals = (
  left: Extract<IntegrationQuarantineBasis, { readonly _tag: "RetryTargetHeadChanged" }>,
  right: Extract<IntegrationQuarantineBasis, { readonly _tag: "RetryTargetHeadChanged" }>
): boolean =>
  left.priorQuarantineAt === right.priorQuarantineAt &&
  left.directionAppliedAt === right.directionAppliedAt &&
  left.targetLineageObservedAt === right.targetLineageObservedAt &&
  left.observedTargetHead === right.observedTargetHead

const sameChangedHeadEvidence = (
  record: JournalRecord,
  session: IntegratorSessionCorrelation,
  basis: Extract<IntegrationQuarantineBasis, { readonly _tag: "RetryTargetHeadChanged" }>
): record is ChangedHeadQuarantineRecord =>
  record.event._tag === "IntegrationQuarantined" &&
  record.runId === runIdFor(session) &&
  integratorCorrelationsEqual(record.event.correlation, session) &&
  record.event.basis._tag === "RetryTargetHeadChanged" &&
  changedHeadBasisEquals(record.event.basis, basis) &&
  record.key === integrationQuarantinedRecordKey(session.sessionId, basis)

const retryRelationFor = (
  records: ReadonlyArray<JournalRecord>,
  input: ChangedHeadRetryQuarantineInput
): IntegratorRetryAuthorization | string => {
  const run = IntegratorRunCorrelation.make({ ordinal: integratorRetryRunOrdinal, session: input.session })
  const result = evaluateIntegratorRetryAuthorization(records, run, {
    requiredTargetLineageObservedAt: input.targetLineageObservedAt
  })
  if (result._tag === "Rejected") return result.detail
  const { authorization } = result
  if (
    authorization.direction.position !== input.directionAppliedAt ||
    authorization.quarantine.position !== input.priorQuarantineAt
  ) {
    return "Retry changed-head input does not name the exact Q and unique Retry D"
  }
  if (!targetLineageObservationEquivalence(authorization.lineage.observation.event.observation, input.targetLineage)) {
    return "Retry changed-head input does not name the exact fresh lineage observation L"
  }
  return authorization
}

const validateHistory = (
  records: ReadonlyArray<JournalRecord>,
  input: ChangedHeadRetryQuarantineInput
): string | undefined => {
  const relation = retryRelationFor(records, input)
  if (typeof relation === "string") return relation
  return relation.lineage.observation.event.observation.targetHeadSha === relation.session.expectedTargetHead
    ? "Retry changed-head quarantine requires a target head different from S's fixed head"
    : undefined
}

type ExistingChangedHeadResolution =
  | { readonly _tag: "Record"; readonly record: ChangedHeadQuarantineRecord }
  | { readonly _tag: "Issue"; readonly detail: string }

const historyWithoutKeyWinner = (
  records: ReadonlyArray<JournalRecord>,
  existing: JournalRecord | undefined
): ReadonlyArray<JournalRecord> => (existing === undefined ? records : records.filter((record) => record !== existing))

const existingChangedHeadResolution = (
  records: ReadonlyArray<JournalRecord>,
  existing: JournalRecord | undefined,
  session: IntegratorSessionCorrelation,
  basis: Extract<IntegrationQuarantineBasis, { readonly _tag: "RetryTargetHeadChanged" }>
): ExistingChangedHeadResolution | undefined => {
  if (existing !== undefined) {
    return sameChangedHeadEvidence(existing, session, basis)
      ? { _tag: "Record", record: existing }
      : { _tag: "Issue", detail: "Changed-head quarantine key contains a foreign or contradictory event" }
  }
  const duplicates = records.filter((record) => sameChangedHeadEvidence(record, session, basis))
  /* v8 ignore next -- @preserve retryRelationFor rejects any same-session changed-head quarantine before this duplicate-history guard can be reached. */
  if (duplicates.length > 1) {
    return { _tag: "Issue", detail: "Journal history contains duplicate changed-head quarantine evidence" }
  }
  const duplicate = duplicates[0]
  /* v8 ignore next -- @preserve retryRelationFor rejects an equivalent same-session quarantine before this malformed-key fallback can be reached. */
  return duplicate === undefined ? undefined : { _tag: "Record", record: duplicate }
}

/**
 * Records the non-action Q2 quarantine after Retry's fresh target-lineage read
 * proves that the preserved session S can no longer use its fixed head.
 */
export const appendChangedHeadRetryQuarantine = Effect.fn("IntegrationQuarantine.appendChangedHeadRetryQuarantine")(
  function* (input: unknown) {
    const request = yield* Schema.decodeUnknownEffect(ChangedHeadRetryQuarantineInput, { onExcessProperty: "error" })(
      input
    )
    const journal = yield* InRunJournal
    const runId = runIdFor(request.session)
    const records = yield* journal.read(runId)
    const basis = IntegrationQuarantineBasis.cases.RetryTargetHeadChanged.make({
      direction: "Retry",
      directionAppliedAt: request.directionAppliedAt,
      observedTargetHead: request.targetLineage.targetHeadSha,
      priorQuarantineAt: request.priorQuarantineAt,
      targetLineageObservedAt: request.targetLineageObservedAt
    })
    const key = integrationQuarantinedRecordKey(request.session.sessionId, basis)
    const existing = records.find((record) => record.key === key)
    const issue = validateHistory(historyWithoutKeyWinner(records, existing), request)
    if (issue !== undefined) return yield* reject(request.session, issue)
    const resolution = existingChangedHeadResolution(records, existing, request.session, basis)
    if (resolution?._tag === "Issue") return yield* reject(request.session, resolution.detail)
    if (resolution?._tag === "Record") {
      return resolution.record
    }

    const event = IntegrationQuarantinedEvent.make({
      basis,
      correlation: request.session,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })

    const appended = yield* journal.append(runId, key, event).pipe(
      Effect.catchTag("JournalStoreContradiction", ({ existingPosition }) =>
        Effect.gen(function* () {
          const refreshed = yield* journal.read(runId)
          const winner = refreshed.find((record) => record.position === existingPosition)
          if (winner !== undefined && sameChangedHeadEvidence(winner, request.session, basis)) return winner
          return yield* reject(request.session, "Changed-head quarantine append contradicted existing Journal history")
        })
      )
    )
    if (!sameChangedHeadEvidence(appended, request.session, basis)) {
      return yield* reject(request.session, "Changed-head quarantine append returned a foreign Journal record")
    }
    return appended
  }
)
