import { Effect, Context, Layer, Ref, Schema } from "effect"
import { InRunJournal } from "../../../workflow-journal/in-run-journal.js"
import type { AppendableWorkflowJournalEvent, JournalRecord } from "../../../workflow-journal/store.js"
import {
  integratorCandidateCleanupAuthorizedRecordKey,
  integratorCandidateCleanupContradictedRecordKey,
  integratorCandidateCleanupMutationIntendedRecordKey,
  integratorCandidateCleanupMutationResultRecordedRecordKey,
  integratorCandidateCleanupObservationIntendedRecordKey,
  integratorCandidateCleanupObservedRecordKey,
  integratorCandidateCleanupSettledRecordKey
} from "../../../workflow-journal/record-key.js"
import {
  CleanupMutationOrdinal,
  CleanupObservationOrdinal,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupEvidenceRevision,
  cleanupMutationRequestLimit
} from "./disposition.js"
import { IntegratorCandidateResourceLocator, IntegratorSessionId } from "../integrator/events.js"
import { OperationId } from "../../identity.js"
import { WorkflowActor } from "../../registry/actor.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"

/** Fresh provider-neutral observation for one quarantined predecessor candidate. */
export const IntegratorCandidateCleanupObservation = Schema.TaggedUnion({
  Present: {
    locator: IntegratorCandidateResourceLocator,
    revision: IntegratorCandidateCleanupEvidenceRevision,
    sessionId: IntegratorSessionId,
    writerQuiescent: Schema.Literal(true)
  },
  Absent: { locator: IntegratorCandidateResourceLocator, revision: IntegratorCandidateCleanupEvidenceRevision },
  Foreign: {
    locator: IntegratorCandidateResourceLocator,
    observedSessionId: IntegratorSessionId,
    reason: Schema.Literals(["LiveWriter", "OtherSession", "Transferred"]),
    revision: IntegratorCandidateCleanupEvidenceRevision
  },
  Unreadable: { detail: Schema.String, locator: IntegratorCandidateResourceLocator }
})
export type IntegratorCandidateCleanupObservation = typeof IntegratorCandidateCleanupObservation.Type

/** Result of one exact predecessor-candidate disposal request. */
export const IntegratorCandidateCleanupMutationResult = Schema.TaggedUnion({
  Removed: { locator: IntegratorCandidateResourceLocator, revision: IntegratorCandidateCleanupEvidenceRevision },
  AlreadyAbsent: { locator: IntegratorCandidateResourceLocator, revision: IntegratorCandidateCleanupEvidenceRevision },
  DefinitelyNotApplied: { detail: Schema.String, locator: IntegratorCandidateResourceLocator },
  Unknown: { detail: Schema.String, locator: IntegratorCandidateResourceLocator }
})
export type IntegratorCandidateCleanupMutationResult = typeof IntegratorCandidateCleanupMutationResult.Type

export const IntegratorCandidateCleanupOutcome = Schema.TaggedUnion({
  Settled: {
    authorization: IntegratorCandidateCleanupAuthorization,
    result: Schema.Union([
      IntegratorCandidateCleanupMutationResult.cases.Removed,
      IntegratorCandidateCleanupMutationResult.cases.AlreadyAbsent
    ])
  },
  Pending: { authorization: IntegratorCandidateCleanupAuthorization, attempts: Schema.Int, reason: Schema.String },
  Preserved: { authorization: IntegratorCandidateCleanupAuthorization, reason: Schema.String }
})
export type IntegratorCandidateCleanupOutcome = typeof IntegratorCandidateCleanupOutcome.Type

/** Durable authorization for the predecessor resource transferred by FullRerun. */
export const IntegratorCandidateCleanupAuthorizedEvent = Schema.TaggedStruct("IntegratorCandidateCleanupAuthorized", {
  authorization: IntegratorCandidateCleanupAuthorization,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  version: Schema.Literal(workflowJournalEventVersion)
})
export type IntegratorCandidateCleanupAuthorizedEvent = typeof IntegratorCandidateCleanupAuthorizedEvent.Type

/** Intent preceding each fresh predecessor ownership read. */
export const IntegratorCandidateCleanupObservationIntendedEvent = Schema.TaggedStruct(
  "IntegratorCandidateCleanupObservationIntended",
  {
    authorization: IntegratorCandidateCleanupAuthorization,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    operationId: OperationId,
    ordinal: CleanupObservationOrdinal,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type IntegratorCandidateCleanupObservationIntendedEvent =
  typeof IntegratorCandidateCleanupObservationIntendedEvent.Type

/** Fresh candidate ownership observation bound to session, locator, and revision. */
export const IntegratorCandidateCleanupObservedEvent = Schema.TaggedStruct("IntegratorCandidateCleanupObserved", {
  authorization: IntegratorCandidateCleanupAuthorization,
  observation: IntegratorCandidateCleanupObservation,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type IntegratorCandidateCleanupObservedEvent = typeof IntegratorCandidateCleanupObservedEvent.Type

/** Intent preceding one exact bounded predecessor-candidate delete request. */
export const IntegratorCandidateCleanupMutationIntendedEvent = Schema.TaggedStruct(
  "IntegratorCandidateCleanupMutationIntended",
  {
    attempt: CleanupMutationOrdinal,
    authorization: IntegratorCandidateCleanupAuthorization,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    operationId: OperationId,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type IntegratorCandidateCleanupMutationIntendedEvent =
  typeof IntegratorCandidateCleanupMutationIntendedEvent.Type

/** Result after predecessor-candidate deletion, including a lost response. */
export const IntegratorCandidateCleanupMutationResultRecordedEvent = Schema.TaggedStruct(
  "IntegratorCandidateCleanupMutationResultRecorded",
  {
    attempt: CleanupMutationOrdinal,
    authorization: IntegratorCandidateCleanupAuthorization,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    operationId: OperationId,
    result: IntegratorCandidateCleanupMutationResult,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type IntegratorCandidateCleanupMutationResultRecordedEvent =
  typeof IntegratorCandidateCleanupMutationResultRecordedEvent.Type

/** Fresh candidate ownership contradicted the immutable predecessor authorization. */
export const IntegratorCandidateCleanupContradictedEvent = Schema.TaggedStruct(
  "IntegratorCandidateCleanupContradicted",
  {
    authorization: IntegratorCandidateCleanupAuthorization,
    detail: Schema.String,
    observation: IntegratorCandidateCleanupObservation,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    operationId: OperationId,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type IntegratorCandidateCleanupContradictedEvent = typeof IntegratorCandidateCleanupContradictedEvent.Type

/** Exact predecessor disposal settled; the successor remains outside this subject. */
export const IntegratorCandidateCleanupSettledEvent = Schema.TaggedStruct("IntegratorCandidateCleanupSettled", {
  authorization: IntegratorCandidateCleanupAuthorization,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  result: Schema.Union([
    IntegratorCandidateCleanupMutationResult.cases.Removed,
    IntegratorCandidateCleanupMutationResult.cases.AlreadyAbsent
  ]),
  version: Schema.Literal(workflowJournalEventVersion)
})
export type IntegratorCandidateCleanupSettledEvent = typeof IntegratorCandidateCleanupSettledEvent.Type

export const IntegratorCandidateCleanupJournalEvent = Schema.Union([
  IntegratorCandidateCleanupAuthorizedEvent,
  IntegratorCandidateCleanupObservationIntendedEvent,
  IntegratorCandidateCleanupObservedEvent,
  IntegratorCandidateCleanupMutationIntendedEvent,
  IntegratorCandidateCleanupMutationResultRecordedEvent,
  IntegratorCandidateCleanupContradictedEvent,
  IntegratorCandidateCleanupSettledEvent
])
export type IntegratorCandidateCleanupJournalEvent = typeof IntegratorCandidateCleanupJournalEvent.Type

/** Provider-neutral candidate disposal boundary. */
export interface IntegratorCandidateCleanupBoundaryService {
  readonly observe: (
    authorization: IntegratorCandidateCleanupAuthorization
  ) => Effect.Effect<IntegratorCandidateCleanupObservation>
  readonly remove: (
    authorization: IntegratorCandidateCleanupAuthorization,
    attempt: CleanupMutationOrdinal
  ) => Effect.Effect<IntegratorCandidateCleanupMutationResult>
}
export class IntegratorCandidateCleanupBoundary extends Context.Service<
  IntegratorCandidateCleanupBoundary,
  IntegratorCandidateCleanupBoundaryService
>()("@dalph/IntegratorCandidateCleanupBoundary") {}

export const IntegratorCandidateCleanupBoundaryCall = Schema.TaggedUnion({
  Observe: { ordinal: CleanupObservationOrdinal },
  Remove: { ordinal: CleanupMutationOrdinal }
})
export type IntegratorCandidateCleanupBoundaryCall = typeof IntegratorCandidateCleanupBoundaryCall.Type

export class TestIntegratorCandidateCleanupBoundary extends Context.Service<
  TestIntegratorCandidateCleanupBoundary,
  { readonly calls: () => Effect.Effect<ReadonlyArray<IntegratorCandidateCleanupBoundaryCall>> }
>()("@dalph/TestIntegratorCandidateCleanupBoundary") {}

/** Deterministic candidate boundary script for maintained cassettes. */
export const integratorCandidateCleanupTestLayer = (input: {
  readonly observations: ReadonlyArray<IntegratorCandidateCleanupObservation>
  readonly mutations?: ReadonlyArray<IntegratorCandidateCleanupMutationResult>
}) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const observations = yield* Ref.make(input.observations)
      const mutations = yield* Ref.make(input.mutations ?? [])
      const calls = yield* Ref.make<ReadonlyArray<IntegratorCandidateCleanupBoundaryCall>>([])
      const service = IntegratorCandidateCleanupBoundary.of({
        observe: (authorization) =>
          Effect.gen(function* () {
            const current = yield* Ref.getAndUpdate(observations, (values) =>
              values.length > 1 ? values.slice(1) : values
            )
            const ordinal = CleanupObservationOrdinal.make((yield* Ref.get(calls)).length + 1)
            yield* Ref.update(calls, (values) => [
              ...values,
              IntegratorCandidateCleanupBoundaryCall.cases.Observe.make({ ordinal })
            ])
            return (
              current[0] ??
              IntegratorCandidateCleanupObservation.cases.Unreadable.make({
                detail: "script exhausted",
                locator: authorization.locator
              })
            )
          }),
        remove: (authorization, attempt) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (values) => [
              ...values,
              IntegratorCandidateCleanupBoundaryCall.cases.Remove.make({ ordinal: attempt })
            ])
            const current = yield* Ref.getAndUpdate(mutations, (values) =>
              values.length > 1 ? values.slice(1) : values
            )
            return (
              current[0] ??
              IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
                detail: "script exhausted",
                locator: authorization.locator
              })
            )
          })
      })
      return Context.empty().pipe(
        Context.add(IntegratorCandidateCleanupBoundary, service),
        Context.add(TestIntegratorCandidateCleanupBoundary, { calls: () => Ref.get(calls) })
      )
    })
  )

const recordsWith = (records: ReadonlyArray<JournalRecord>, tag: IntegratorCandidateCleanupJournalEvent["_tag"]) =>
  records.filter((record) => record.event._tag === tag)

const appendEvent = Effect.fn("IntegratorCandidateCleanup.appendEvent")(function* (
  runId: Parameters<InRunJournal["Service"]["append"]>[0],
  key: Parameters<InRunJournal["Service"]["append"]>[1],
  event: AppendableWorkflowJournalEvent
) {
  const journal = yield* InRunJournal
  return yield* journal.append(runId, key, event)
})

const exactPresent = (
  observation: IntegratorCandidateCleanupObservation,
  authorization: IntegratorCandidateCleanupAuthorization
): boolean =>
  observation._tag === "Present" &&
  observation.locator === authorization.locator &&
  observation.sessionId === authorization.owner.sessionId &&
  observation.revision === authorization.evidenceRevision &&
  observation.writerQuiescent

/** Reconciles only the quarantined predecessor candidate. */
export const runIntegratorCandidateCleanup = Effect.fn("IntegratorCandidateCleanup.run")(function* (
  authorization: IntegratorCandidateCleanupAuthorization
) {
  const boundary = yield* IntegratorCandidateCleanupBoundary
  const journal = yield* InRunJournal
  const runId = authorization.disposition.predecessor.plannedAttempt.runId
  let records = yield* journal.read(runId)
  if (
    !records.some(
      (record) =>
        record.event._tag === "IntegratorCandidateCleanupAuthorized" &&
        record.event.authorization.operationId === authorization.operationId
    )
  ) {
    yield* appendEvent(
      runId,
      integratorCandidateCleanupAuthorizedRecordKey(authorization.operationId),
      IntegratorCandidateCleanupAuthorizedEvent.make({
        authorization,
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
    )
    records = yield* journal.read(runId)
  }
  const observationOrdinal = CleanupObservationOrdinal.make(
    recordsWith(records, "IntegratorCandidateCleanupObservationIntended").length + 1
  )
  const observationOperationId = OperationId.make(`${authorization.operationId}:observe:${observationOrdinal}`)
  const observationKey = integratorCandidateCleanupObservationIntendedRecordKey(
    authorization.operationId,
    observationOrdinal
  )
  if (!records.some((record) => record.key === observationKey)) {
    yield* appendEvent(
      runId,
      observationKey,
      IntegratorCandidateCleanupObservationIntendedEvent.make({
        authorization,
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operationId: observationOperationId,
        ordinal: observationOrdinal,
        version: workflowJournalEventVersion
      })
    )
    records = yield* journal.read(runId)
  }
  const observation = yield* boundary.observe(authorization)
  yield* appendEvent(
    runId,
    integratorCandidateCleanupObservedRecordKey(authorization.operationId, observationOrdinal),
    IntegratorCandidateCleanupObservedEvent.make({
      authorization,
      observation,
      occurrenceClassification: "NonActionOccurrence",
      operationId: observationOperationId,
      ordinal: observationOrdinal,
      version: workflowJournalEventVersion
    })
  )
  const settled = records.find(
    (record): record is JournalRecord & { readonly event: IntegratorCandidateCleanupSettledEvent } =>
      record.event._tag === "IntegratorCandidateCleanupSettled" &&
      record.event.authorization.operationId === authorization.operationId
  )?.event
  if (settled !== undefined && observation._tag === "Absent")
    return IntegratorCandidateCleanupOutcome.cases.Settled.make({ authorization, result: settled.result })
  if (observation._tag === "Absent") {
    const result = IntegratorCandidateCleanupMutationResult.cases.AlreadyAbsent.make({
      locator: authorization.locator,
      revision: observation.revision
    })
    const attempt = CleanupMutationOrdinal.make(1)
    yield* appendEvent(
      runId,
      integratorCandidateCleanupMutationResultRecordedRecordKey(authorization.operationId, attempt),
      IntegratorCandidateCleanupMutationResultRecordedEvent.make({
        attempt,
        authorization,
        occurrenceClassification: "NonActionOccurrence",
        operationId: OperationId.make(`${authorization.operationId}:mutation:1`),
        result,
        version: workflowJournalEventVersion
      })
    )
    yield* appendEvent(
      runId,
      integratorCandidateCleanupSettledRecordKey(authorization.operationId),
      IntegratorCandidateCleanupSettledEvent.make({
        authorization,
        occurrenceClassification: "NonActionOccurrence",
        result,
        version: workflowJournalEventVersion
      })
    )
    return IntegratorCandidateCleanupOutcome.cases.Settled.make({ authorization, result })
  }
  if (!exactPresent(observation, authorization)) {
    yield* appendEvent(
      runId,
      integratorCandidateCleanupContradictedRecordKey(authorization.operationId),
      IntegratorCandidateCleanupContradictedEvent.make({
        authorization,
        detail: observation._tag === "Unreadable" ? observation.detail : "candidate ownership or revision changed",
        observation,
        occurrenceClassification: "NonActionOccurrence",
        operationId: observationOperationId,
        version: workflowJournalEventVersion
      })
    )
    return IntegratorCandidateCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "fresh candidate facts contradicted authorization"
    })
  }
  const count = recordsWith(records, "IntegratorCandidateCleanupMutationIntended").length
  if (count >= cleanupMutationRequestLimit)
    return IntegratorCandidateCleanupOutcome.cases.Pending.make({
      authorization,
      attempts: count,
      reason: "bounded candidate deletion requests exhausted"
    })
  const attempt = CleanupMutationOrdinal.make(count + 1)
  const mutationOperationId = OperationId.make(`${authorization.operationId}:mutation:${attempt}`)
  yield* appendEvent(
    runId,
    integratorCandidateCleanupMutationIntendedRecordKey(authorization.operationId, attempt),
    IntegratorCandidateCleanupMutationIntendedEvent.make({
      attempt,
      authorization,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      operationId: mutationOperationId,
      version: workflowJournalEventVersion
    })
  )
  const result = yield* boundary.remove(authorization, attempt)
  yield* appendEvent(
    runId,
    integratorCandidateCleanupMutationResultRecordedRecordKey(authorization.operationId, attempt),
    IntegratorCandidateCleanupMutationResultRecordedEvent.make({
      attempt,
      authorization,
      occurrenceClassification: "NonActionOccurrence",
      operationId: mutationOperationId,
      result,
      version: workflowJournalEventVersion
    })
  )
  if (result._tag === "Removed" || result._tag === "AlreadyAbsent") {
    yield* appendEvent(
      runId,
      integratorCandidateCleanupSettledRecordKey(authorization.operationId),
      IntegratorCandidateCleanupSettledEvent.make({
        authorization,
        occurrenceClassification: "NonActionOccurrence",
        result,
        version: workflowJournalEventVersion
      })
    )
    return IntegratorCandidateCleanupOutcome.cases.Settled.make({ authorization, result })
  }
  return IntegratorCandidateCleanupOutcome.cases.Pending.make({
    authorization,
    attempts: attempt,
    reason: result.detail
  })
})
