/* eslint-disable max-lines -- The candidate authority, recovery chronology, and controlled boundary stay co-located for auditability. */

import { Effect, Context, Layer, Ref, Schema } from "effect"
import { InRunJournal } from "../../../workflow-journal/in-run-journal.js"
import type { AppendableWorkflowJournalEvent, JournalRecord } from "../../../workflow-journal/store.js"
import {
  integratorCandidateCleanupAuthorizedRecordKey,
  integratorCandidateCleanupAbsenceConfirmedRecordKey,
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
  type IntegratorCandidateCleanupEvidenceSubject,
  IntegratorCandidateCleanupEvidenceRevision,
  cleanupMutationRequestLimit,
  integratorCandidateCleanupAuthorizationEquals
} from "./disposition.js"
import {
  validateIntegratorCandidateCleanupHistory,
  validateIntegratorCandidateCleanupProvenance
} from "./provenance.js"
import { IntegratorCandidateResourceLocator, IntegratorSessionId } from "../integrator/events.js"
import { OperationId } from "../../identity.js"
import { WorkflowActor } from "../../registry/actor.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import type { CoordinatorOwnershipError } from "../../../authorities/coordinator-ownership/ownership.js"
import { IntegratorCandidateCleanupObservation } from "./observations.js"

export { IntegratorCandidateCleanupObservation }

/** Result of one exact predecessor-candidate disposal request. */
export const IntegratorCandidateCleanupMutationResult = Schema.TaggedUnion({
  Removed: {
    locator: IntegratorCandidateResourceLocator,
    revision: IntegratorCandidateCleanupEvidenceRevision,
    sessionId: IntegratorSessionId
  },
  AlreadyAbsent: {
    locator: IntegratorCandidateResourceLocator,
    revision: IntegratorCandidateCleanupEvidenceRevision,
    sessionId: IntegratorSessionId
  },
  DefinitelyNotApplied: {
    detail: Schema.String,
    locator: IntegratorCandidateResourceLocator,
    sessionId: IntegratorSessionId
  },
  Unknown: { detail: Schema.String, locator: IntegratorCandidateResourceLocator, sessionId: IntegratorSessionId }
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

/** A fresh candidate absence proof reconciles an initial or ambiguous disposal without fabricating a result. */
export const IntegratorCandidateCleanupAbsenceConfirmedEvent = Schema.TaggedStruct(
  "IntegratorCandidateCleanupAbsenceConfirmed",
  {
    authorization: IntegratorCandidateCleanupAuthorization,
    cause: Schema.Literals(["InitialAbsence", "MutationResponseReconciliation"]),
    observation: IntegratorCandidateCleanupObservation.cases.Absent,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    operationId: OperationId,
    ordinal: CleanupObservationOrdinal,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type IntegratorCandidateCleanupAbsenceConfirmedEvent =
  typeof IntegratorCandidateCleanupAbsenceConfirmedEvent.Type

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
  IntegratorCandidateCleanupAbsenceConfirmedEvent,
  IntegratorCandidateCleanupMutationIntendedEvent,
  IntegratorCandidateCleanupMutationResultRecordedEvent,
  IntegratorCandidateCleanupContradictedEvent,
  IntegratorCandidateCleanupSettledEvent
])
export type IntegratorCandidateCleanupJournalEvent = typeof IntegratorCandidateCleanupJournalEvent.Type

/** Provider-neutral candidate disposal boundary. */
export interface IntegratorCandidateCleanupBoundaryService {
  /** Reads the provider-private revision before the authorization crosses into the journal. */
  readonly readEvidenceRevision?: (
    subject: IntegratorCandidateCleanupEvidenceSubject
  ) => Effect.Effect<IntegratorCandidateCleanupEvidenceRevision, unknown>
  readonly observe: (
    authorization: IntegratorCandidateCleanupAuthorization
  ) => Effect.Effect<IntegratorCandidateCleanupObservation>
  readonly remove: (
    authorization: IntegratorCandidateCleanupAuthorization,
    attempt: CleanupMutationOrdinal
  ) => Effect.Effect<IntegratorCandidateCleanupMutationResult, CoordinatorOwnershipError>
}

/** The provider-private revision could not be reread before authorization. */
export class IntegratorCandidateCleanupEvidenceReadFailure extends Schema.TaggedError<IntegratorCandidateCleanupEvidenceReadFailure>()(
  "IntegratorCandidateCleanupEvidenceReadFailure",
  { detail: Schema.String }
) {}

export class IntegratorCandidateCleanupBoundary extends Context.Service<
  IntegratorCandidateCleanupBoundary,
  IntegratorCandidateCleanupBoundaryService
>()("@dalph/IntegratorCandidateCleanupBoundary") {}

/**
 * Provider-owned candidate facts are a separate authority from Git object
 * existence.  An adapter may return an exact owner/quiescence observation,
 * but it must not infer those facts from a locator lookup.
 */
export interface IntegratorCandidateProviderAuthorityService {
  /** Reads the provider-private revision for the exact predecessor before authorization. */
  readonly readEvidenceRevision?: (
    subject: IntegratorCandidateCleanupEvidenceSubject
  ) => Effect.Effect<IntegratorCandidateCleanupEvidenceRevision, unknown>
  readonly observe: (
    authorization: IntegratorCandidateCleanupAuthorization
  ) => Effect.Effect<IntegratorCandidateCleanupObservation>
  /**
   * Removes only the provider resource named by the already-authorized
   * predecessor. The cleanup boundary wraps this call in CoordinatorOwnership
   * before allowing it to cross the provider mutation seam.
   */
  readonly remove: (
    authorization: IntegratorCandidateCleanupAuthorization,
    attempt: CleanupMutationOrdinal
  ) => Effect.Effect<IntegratorCandidateCleanupMutationResult>
}
export class IntegratorCandidateProviderAuthority extends Context.Service<
  IntegratorCandidateProviderAuthority,
  IntegratorCandidateProviderAuthorityService
>()("@dalph/IntegratorCandidateProviderAuthority") {}

/** No provider authority is available in a provider-neutral composition. */
export const unavailableIntegratorCandidateProviderAuthority = IntegratorCandidateProviderAuthority.of({
  readEvidenceRevision: () => Effect.fail("provider authority is unavailable; candidate evidence cannot be observed"),
  observe: (authorization) =>
    Effect.succeed(
      IntegratorCandidateCleanupObservation.cases.Unreadable.make({
        detail: "provider authority is unavailable; Git object existence is not ownership evidence",
        locator: authorization.locator
      })
    ),
  remove: (authorization) =>
    Effect.succeed(
      IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
        detail: "provider authority is unavailable; candidate mutation is disabled",
        locator: authorization.locator,
        sessionId: authorization.owner.sessionId
      })
    )
})

export const IntegratorCandidateCleanupBoundaryCall = Schema.TaggedUnion({
  Observe: {
    locator: IntegratorCandidateResourceLocator,
    operationId: OperationId,
    ordinal: CleanupObservationOrdinal,
    sessionId: IntegratorSessionId
  },
  Remove: {
    locator: IntegratorCandidateResourceLocator,
    operationId: OperationId,
    ordinal: CleanupMutationOrdinal,
    sessionId: IntegratorSessionId
  }
})
export type IntegratorCandidateCleanupBoundaryCall = typeof IntegratorCandidateCleanupBoundaryCall.Type

export class TestIntegratorCandidateCleanupBoundary extends Context.Service<
  TestIntegratorCandidateCleanupBoundary,
  { readonly calls: () => Effect.Effect<ReadonlyArray<IntegratorCandidateCleanupBoundaryCall>> }
>()("@dalph/TestIntegratorCandidateCleanupBoundary") {}

/** Deterministic candidate boundary script for maintained cassettes. */
export const integratorCandidateCleanupTestLayer = (input: {
  readonly observations: ReadonlyArray<IntegratorCandidateCleanupObservation>
  readonly evidenceRevision?: IntegratorCandidateCleanupEvidenceRevision
  readonly mutations?: ReadonlyArray<IntegratorCandidateCleanupMutationResult>
}) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const observations = yield* Ref.make(input.observations)
      const mutations = yield* Ref.make(input.mutations ?? [])
      const calls = yield* Ref.make<ReadonlyArray<IntegratorCandidateCleanupBoundaryCall>>([])
      const observe = (authorization: IntegratorCandidateCleanupAuthorization) =>
        Effect.gen(function* () {
          const current = yield* Ref.getAndUpdate(observations, (values) =>
            values.length > 1 ? values.slice(1) : values
          )
          const ordinal = CleanupObservationOrdinal.make(
            (yield* Ref.get(calls)).filter((call) => call._tag === "Observe").length + 1
          )
          yield* Ref.update(calls, (values) => [
            ...values,
            IntegratorCandidateCleanupBoundaryCall.cases.Observe.make({
              locator: authorization.locator,
              operationId: authorization.operationId,
              ordinal,
              sessionId: authorization.owner.sessionId
            })
          ])
          return (
            current[0] ??
            IntegratorCandidateCleanupObservation.cases.Unreadable.make({
              detail: "script exhausted",
              locator: authorization.locator
            })
          )
        })
      const remove = (authorization: IntegratorCandidateCleanupAuthorization, attempt: CleanupMutationOrdinal) =>
        Effect.gen(function* () {
          yield* Ref.update(calls, (values) => [
            ...values,
            IntegratorCandidateCleanupBoundaryCall.cases.Remove.make({
              locator: authorization.locator,
              operationId: authorization.operationId,
              ordinal: attempt,
              sessionId: authorization.owner.sessionId
            })
          ])
          const current = yield* Ref.getAndUpdate(mutations, (values) => (values.length > 1 ? values.slice(1) : values))
          return (
            current[0] ??
            IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
              detail: "script exhausted",
              locator: authorization.locator,
              sessionId: authorization.owner.sessionId
            })
          )
        })
      const readEvidenceRevision = () =>
        input.evidenceRevision === undefined
          ? Effect.fail("candidate evidence revision was not supplied by the controlled provider")
          : Effect.succeed(input.evidenceRevision)
      const service = IntegratorCandidateCleanupBoundary.of({ readEvidenceRevision, observe, remove })
      return Context.empty().pipe(
        Context.add(IntegratorCandidateCleanupBoundary, service),
        Context.add(IntegratorCandidateProviderAuthority, { readEvidenceRevision, observe, remove }),
        Context.add(TestIntegratorCandidateCleanupBoundary, { calls: () => Ref.get(calls) })
      )
    })
  )

const recordsWith = (
  records: ReadonlyArray<JournalRecord>,
  tag: IntegratorCandidateCleanupJournalEvent["_tag"],
  operationId: OperationId
) =>
  records.filter(
    (record) =>
      Schema.is(IntegratorCandidateCleanupJournalEvent)(record.event) &&
      record.event._tag === tag &&
      record.event.authorization.operationId === operationId
  )

const appendEvent = Effect.fn("IntegratorCandidateCleanup.appendEvent")(function* (
  runId: Parameters<InRunJournal["Service"]["append"]>[0],
  key: Parameters<InRunJournal["Service"]["append"]>[1],
  event: AppendableWorkflowJournalEvent
) {
  const journal = yield* InRunJournal
  return yield* journal.append(runId, key, event)
})

const observationHasAuthorizedLocator = (
  observation: IntegratorCandidateCleanupObservation,
  authorization: IntegratorCandidateCleanupAuthorization
): boolean => observation.locator === authorization.locator

/**
 * A cleanup observation is terminally contradictory only when it proves a
 * different owner/resource or a stale private revision. Provider read
 * failures and an exact resource that is still present remain retryable.
 */
const observationProvesContradiction = (
  observation: IntegratorCandidateCleanupObservation,
  authorization: IntegratorCandidateCleanupAuthorization
): boolean =>
  !observationHasAuthorizedLocator(observation, authorization) ||
  observation._tag === "Foreign" ||
  (observation._tag === "Present" && observation.revision !== authorization.evidenceRevision)

/** Every candidate result must identify the exact predecessor resource and session. */
export const integratorCandidateCleanupMutationResultMatchesAuthorization = (
  result: IntegratorCandidateCleanupMutationResult,
  authorization: IntegratorCandidateCleanupAuthorization
): boolean => result.locator === authorization.locator && result.sessionId === authorization.owner.sessionId

const nextObservationOrdinal = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId
): CleanupObservationOrdinal =>
  CleanupObservationOrdinal.make(
    recordsWith(records, "IntegratorCandidateCleanupObservationIntended", operationId).length + 1
  )

const unmatchedObservationIntent = (
  records: ReadonlyArray<JournalRecord>,
  authorization: IntegratorCandidateCleanupAuthorization
) =>
  records.find((record) => {
    if (
      record.event._tag !== "IntegratorCandidateCleanupObservationIntended" ||
      !integratorCandidateCleanupAuthorizationEquals(record.event.authorization, authorization)
    ) {
      return false
    }
    const intended = record.event
    return !records.some((observed) => {
      if (observed.event._tag !== "IntegratorCandidateCleanupObserved") return false
      return (
        observed.event.authorization.operationId === authorization.operationId &&
        observed.event.operationId === intended.operationId &&
        observed.event.ordinal === intended.ordinal
      )
    })
  })

const existingAuthorization = (records: ReadonlyArray<JournalRecord>, operationId: OperationId) =>
  records.find(
    (record): record is JournalRecord & { readonly event: IntegratorCandidateCleanupAuthorizedEvent } =>
      record.event._tag === "IntegratorCandidateCleanupAuthorized" &&
      record.event.authorization.operationId === operationId
  )?.event

const existingSettled = (
  records: ReadonlyArray<JournalRecord>,
  authorization: IntegratorCandidateCleanupAuthorization
) =>
  records.find(
    (record): record is JournalRecord & { readonly event: IntegratorCandidateCleanupSettledEvent } =>
      record.event._tag === "IntegratorCandidateCleanupSettled" &&
      record.event.authorization.operationId === authorization.operationId &&
      integratorCandidateCleanupAuthorizationEquals(record.event.authorization, authorization)
  )?.event

const existingContradiction = (
  records: ReadonlyArray<JournalRecord>,
  authorization: IntegratorCandidateCleanupAuthorization
) =>
  records.find(
    (record): record is JournalRecord & { readonly event: IntegratorCandidateCleanupContradictedEvent } =>
      record.event._tag === "IntegratorCandidateCleanupContradicted" &&
      record.event.authorization.operationId === authorization.operationId &&
      integratorCandidateCleanupAuthorizationEquals(record.event.authorization, authorization)
  )?.event

const observeFresh = Effect.fn("IntegratorCandidateCleanup.observeFresh")(function* (
  authorization: IntegratorCandidateCleanupAuthorization,
  records: ReadonlyArray<JournalRecord>
) {
  const boundary = yield* IntegratorCandidateCleanupBoundary
  const runId = authorization.disposition.predecessor.plannedAttempt.runId
  const unmatched = unmatchedObservationIntent(records, authorization)
  const ordinal =
    unmatched?.event._tag === "IntegratorCandidateCleanupObservationIntended"
      ? unmatched.event.ordinal
      : nextObservationOrdinal(records, authorization.operationId)
  const operationId =
    unmatched?.event._tag === "IntegratorCandidateCleanupObservationIntended"
      ? unmatched.event.operationId
      : OperationId.make(`${authorization.operationId}:observe:${ordinal}`)
  const key = integratorCandidateCleanupObservationIntendedRecordKey(authorization.operationId, ordinal)
  if (!records.some((record) => record.key === key)) {
    yield* appendEvent(
      runId,
      key,
      IntegratorCandidateCleanupObservationIntendedEvent.make({
        authorization,
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operationId,
        ordinal,
        version: workflowJournalEventVersion
      })
    )
  }
  const observed = yield* boundary.observe(authorization)
  yield* appendEvent(
    runId,
    integratorCandidateCleanupObservedRecordKey(authorization.operationId, ordinal),
    IntegratorCandidateCleanupObservedEvent.make({
      authorization,
      observation: observed,
      occurrenceClassification: "NonActionOccurrence",
      operationId,
      ordinal,
      version: workflowJournalEventVersion
    })
  )
  return { observed, operationId, ordinal, records: yield* (yield* InRunJournal).read(runId) }
})

const appendContradiction = Effect.fn("IntegratorCandidateCleanup.appendContradiction")(function* (
  authorization: IntegratorCandidateCleanupAuthorization,
  observation: IntegratorCandidateCleanupObservation,
  operationId: OperationId,
  detail: string
) {
  const runId = authorization.disposition.predecessor.plannedAttempt.runId
  const key = integratorCandidateCleanupContradictedRecordKey(authorization.operationId)
  // The caller has already rejected an exact contradiction replay, and the
  // history validator rejects a conflicting same-key authorization.  A
  // contradiction therefore has one append point for this invocation.
  yield* appendEvent(
    runId,
    key,
    IntegratorCandidateCleanupContradictedEvent.make({
      authorization,
      detail,
      observation,
      occurrenceClassification: "NonActionOccurrence",
      operationId,
      version: workflowJournalEventVersion
    })
  )
})

const settleFromAbsence = Effect.fn("IntegratorCandidateCleanup.settleFromAbsence")(function* (
  authorization: IntegratorCandidateCleanupAuthorization,
  observation: Extract<IntegratorCandidateCleanupObservation, { readonly _tag: "Absent" }>,
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal,
  result: Extract<IntegratorCandidateCleanupMutationResult, { readonly _tag: "AlreadyAbsent" | "Removed" }>,
  records: ReadonlyArray<JournalRecord>
) {
  if (result.revision !== observation.revision) {
    yield* appendContradiction(
      authorization,
      observation,
      operationId,
      "candidate mutation result revision did not match the latest absence observation"
    )
    return IntegratorCandidateCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "candidate mutation result was stale relative to the latest absence proof"
    })
  }
  const runId = authorization.disposition.predecessor.plannedAttempt.runId
  const mutationExists = records.some(
    (record) =>
      record.event._tag === "IntegratorCandidateCleanupMutationIntended" &&
      integratorCandidateCleanupAuthorizationEquals(record.event.authorization, authorization)
  )
  const derivedCause = mutationExists ? "MutationResponseReconciliation" : "InitialAbsence"
  const absenceKey = integratorCandidateCleanupAbsenceConfirmedRecordKey(authorization.operationId, ordinal)
  if (!records.some((record) => record.key === absenceKey)) {
    yield* appendEvent(
      runId,
      absenceKey,
      IntegratorCandidateCleanupAbsenceConfirmedEvent.make({
        authorization,
        cause: derivedCause,
        observation,
        occurrenceClassification: "NonActionOccurrence",
        operationId,
        ordinal,
        version: workflowJournalEventVersion
      })
    )
  }
  // `runIntegratorCandidateCleanup` returns an existing exact settlement before
  // entering this helper, so a settlement cannot already exist in this
  // invocation.  Keeping this append unconditional also makes the terminal
  // transition explicit instead of carrying a redundant defensive branch.
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
})

/** Reconciles only the quarantined predecessor candidate. */
export const runIntegratorCandidateCleanup = Effect.fn("IntegratorCandidateCleanup.run")(function* (
  authorization: IntegratorCandidateCleanupAuthorization
) {
  const boundary = yield* IntegratorCandidateCleanupBoundary
  const journal = yield* InRunJournal
  const runId = authorization.disposition.predecessor.plannedAttempt.runId
  let records = yield* journal.read(runId)
  const provenance = validateIntegratorCandidateCleanupProvenance(records, authorization)
  if (provenance._tag === "Invalid") {
    return IntegratorCandidateCleanupOutcome.cases.Preserved.make({ authorization, reason: provenance.detail })
  }
  const history = validateIntegratorCandidateCleanupHistory(records, authorization)
  if (history._tag === "Invalid") {
    return IntegratorCandidateCleanupOutcome.cases.Preserved.make({ authorization, reason: history.detail })
  }
  const contradictedBeforeReplay = existingContradiction(records, authorization)
  if (contradictedBeforeReplay !== undefined) {
    return IntegratorCandidateCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: contradictedBeforeReplay.detail
    })
  }
  // A valid terminal prefix is the recovery answer. Do not reread or append
  // anything on a second or later invocation of the same settled operation.
  const settledBeforeReplay = existingSettled(records, authorization)
  if (settledBeforeReplay !== undefined) {
    return IntegratorCandidateCleanupOutcome.cases.Settled.make({ authorization, result: settledBeforeReplay.result })
  }
  const journalAuthorization = existingAuthorization(records, authorization.operationId)
  if (journalAuthorization === undefined) {
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
  const firstObservation = yield* observeFresh(authorization, records)
  records = firstObservation.records
  const observation = firstObservation.observed
  const count = recordsWith(records, "IntegratorCandidateCleanupMutationIntended", authorization.operationId).length
  if (observation._tag === "Absent" && observationHasAuthorizedLocator(observation, authorization)) {
    const result = IntegratorCandidateCleanupMutationResult.cases.AlreadyAbsent.make({
      locator: authorization.locator,
      revision: observation.revision,
      sessionId: authorization.owner.sessionId
    })
    return yield* settleFromAbsence(
      authorization,
      observation,
      firstObservation.operationId,
      firstObservation.ordinal,
      result,
      records
    )
  }
  if (observation._tag === "Unreadable") {
    return IntegratorCandidateCleanupOutcome.cases.Pending.make({
      authorization,
      attempts: count,
      reason: observation.detail
    })
  }
  if (observationProvesContradiction(observation, authorization)) {
    yield* appendContradiction(
      authorization,
      observation,
      firstObservation.operationId,
      "candidate ownership or revision changed"
    )
    return IntegratorCandidateCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "fresh candidate facts contradicted authorization"
    })
  }
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
  records = yield* journal.read(runId)
  if (!integratorCandidateCleanupMutationResultMatchesAuthorization(result, authorization)) {
    yield* appendContradiction(
      authorization,
      observation,
      mutationOperationId,
      "candidate mutation response identified a different resource or session"
    )
    return IntegratorCandidateCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "candidate mutation response contradicted authorization"
    })
  }
  if (result._tag === "Removed" || result._tag === "AlreadyAbsent") {
    const postMutationObservation = yield* observeFresh(authorization, records)
    records = postMutationObservation.records
    if (
      postMutationObservation.observed._tag === "Absent" &&
      observationHasAuthorizedLocator(postMutationObservation.observed, authorization)
    ) {
      return yield* settleFromAbsence(
        authorization,
        postMutationObservation.observed,
        postMutationObservation.operationId,
        postMutationObservation.ordinal,
        result,
        records
      )
    }
    if (postMutationObservation.observed._tag === "Unreadable") {
      return IntegratorCandidateCleanupOutcome.cases.Pending.make({
        authorization,
        attempts: attempt,
        reason: postMutationObservation.observed.detail
      })
    }
    if (observationProvesContradiction(postMutationObservation.observed, authorization)) {
      yield* appendContradiction(
        authorization,
        postMutationObservation.observed,
        postMutationObservation.operationId,
        "candidate mutation did not receive a fresh authorized absence proof"
      )
      return IntegratorCandidateCleanupOutcome.cases.Preserved.make({
        authorization,
        reason: "candidate mutation was contradicted by fresh foreign or stale evidence"
      })
    }
    return IntegratorCandidateCleanupOutcome.cases.Pending.make({
      authorization,
      attempts: attempt,
      reason: "candidate mutation remains unresolved while the exact resource is still present"
    })
  }
  return IntegratorCandidateCleanupOutcome.cases.Pending.make({
    authorization,
    attempts: attempt,
    reason: result.detail
  })
})
