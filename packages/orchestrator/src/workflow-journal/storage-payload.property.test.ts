import { it } from "@effect/vitest"
import * as fc from "fast-check"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../authorities/task-tracker/claim-mutation.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { OperationId } from "../workflow/identity.js"
import { WorkflowJournalEvent } from "../workflow/registry/event.js"
import { integrationFinalityFixture as fixture } from "../workflow/protocols/integration-finality/fixtures.js"
import {
  CompletionClaimDeletionAttemptIntendedEvent,
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimDeletionReadObservedEvent,
  CompletionClaimDeletedEvent,
  CompletionClaimDeletionRequest,
  CompletionClaimRequestOrdinal,
  CompletionClaimCleanupReadOrdinal,
  CompletionTaskClaim,
  FocusedCompletedTaskObservation,
  IntegrationFinalitySettledEvent
} from "../workflow/protocols/integration-finality/events.js"
import { JournalPosition } from "./identity.js"
import { decodeJournalEvent, encodeJournalEvent } from "./event-codec.js"

const ObjectPayload = Schema.Record(Schema.String, Schema.Json)
const storageEnvelope = Schema.Struct({ _tag: Schema.String, payload: ObjectPayload })
const jsonObject = (value: unknown) => Schema.decodeUnknownSync(ObjectPayload)(value)

const eventsFor = (suffix: string, position: number): ReadonlyArray<WorkflowJournalEvent> => {
  const claim = CompletionTaskClaim.make({
    ...fixture.claim,
    originalClaim: ActiveTaskClaim.make({
      ...fixture.activeClaim,
      owner: ClaimOwner.make(`dalph:${suffix}`),
      token: ClaimToken.make(suffix)
    })
  })
  const successObservation = FocusedCompletedTaskObservation.make({
    ...fixture.successObservation,
    claim,
    operationId: OperationId.make(`success:${suffix}`),
    observedAt: JournalPosition.make(position)
  })
  const operationId = OperationId.make(`deletion:${suffix}`)
  const replacementOperationId = OperationId.make(`replacement:${suffix}`)
  const version = workflowJournalEventVersion
  return [
    CompletionClaimDeletionIntendedEvent.make({ claim, operationId, successObservation, version }),
    CompletionClaimDeletionAttemptIntendedEvent.make({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
      claim,
      operationId,
      successObservation,
      version
    }),
    CompletionClaimDeletedEvent.make({ claim, operationId, successObservation, version }),
    IntegrationFinalitySettledEvent.make({
      claim,
      deletionOperationId: operationId,
      replacementOperationId,
      successObservation,
      version
    }),
    CompletionClaimDeletionReadObservedEvent.make({
      observation: claim,
      purpose: { _tag: "BeforeOriginalClaimRelease", readOrdinal: CompletionClaimCleanupReadOrdinal.make(1) },
      replacementOperationId,
      request: CompletionClaimDeletionRequest.make({ claim, operationId, successObservation }),
      version
    })
  ]
}

it("round-trips generated finality events without storing duplicate claims or plans", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 32 }),
      fc.integer({ min: 1, max: 1000 }),
      async (suffix, position) => {
        for (const event of eventsFor(suffix, position)) {
          const encoded = encodeJournalEvent(event)
          const storage = Schema.decodeUnknownSync(storageEnvelope)(JSON.parse(encoded.payloadJson))
          expect(storage._tag).toBe("DalphJournalCompactPayloadV1")
          const container =
            event._tag === "CompletionClaimDeletionReadObserved"
              ? jsonObject(storage.payload["request"])
              : storage.payload
          expect(container).not.toHaveProperty("claim")
          const observation = jsonObject(container["successObservation"])
          const claim = jsonObject(observation["claim"])
          expect(claim).not.toHaveProperty("plannedAttempt")
          const decoded = await Effect.runPromise(decodeJournalEvent(encoded))
          expect(decoded).toEqual(event)
          expect(encodeJournalEvent(decoded)).toEqual(encoded)
        }
      }
    ),
    { numRuns: 60 }
  )
})

it.effect("reads existing untagged full rows without allowing missing-field defaults", () =>
  Effect.gen(function* () {
    for (const event of eventsFor("existing", 3)) {
      const { _tag: _kind, version: _version, ...payload } = Schema.encodeUnknownSync(WorkflowJournalEvent)(event)
      const encoded = { ...encodeJournalEvent(event), payloadJson: JSON.stringify(payload) }
      expect(yield* decodeJournalEvent(encoded)).toEqual(event)
      if (event._tag !== "CompletionClaimDeletionReadObserved") {
        const { claim: _missing, ...missing } = jsonObject(payload)
        const failure = yield* decodeJournalEvent({ ...encoded, payloadJson: JSON.stringify(missing) }).pipe(
          Effect.flip
        )
        expect(failure._tag).toBe("JournalEventDecodeIssue")
      }
    }
  })
)

it.effect("rejects unsupported compact formats and compact rows without their source claim", () =>
  Effect.gen(function* () {
    const event = eventsFor("missing-source", 3)[0]
    if (event === undefined) return yield* Effect.die("fixture missing")
    const encoded = encodeJournalEvent(event)
    const storage = Schema.decodeUnknownSync(storageEnvelope)(JSON.parse(encoded.payloadJson))
    const observation = jsonObject(storage.payload["successObservation"])
    const { claim: _missing, ...withoutClaim } = observation
    for (const payload of [
      { ...storage, _tag: "DalphJournalCompactPayloadV2" },
      { ...storage, payload: { ...storage.payload, successObservation: withoutClaim } },
      { ...storage, injected: "foreign storage field" }
    ]) {
      const failure = yield* decodeJournalEvent({ ...encoded, payloadJson: JSON.stringify(payload) }).pipe(Effect.flip)
      expect(failure._tag).toBe("JournalEventDecodeIssue")
    }
  })
)

it.effect("preserves unequal claim copies as contradictory history evidence", () =>
  Effect.gen(function* () {
    const claim = fixture.claim
    const foreignClaim = CompletionTaskClaim.make({
      ...claim,
      originalClaim: ActiveTaskClaim.make({ ...claim.originalClaim, token: ClaimToken.make("foreign-token") })
    })
    const event = CompletionClaimDeletedEvent.make({
      claim,
      operationId: OperationId.make("unequal-deletion"),
      successObservation: FocusedCompletedTaskObservation.make({ ...fixture.successObservation, claim: foreignClaim }),
      version: workflowJournalEventVersion
    })
    const encoded = encodeJournalEvent(event)
    const storage = Schema.decodeUnknownSync(storageEnvelope)(JSON.parse(encoded.payloadJson))
    expect(storage.payload).toHaveProperty("claim")
    const decoded = yield* decodeJournalEvent(encoded)
    expect(decoded).toEqual(event)
    if (decoded._tag !== "CompletionClaimDeleted") return yield* Effect.die("wrong event")
    expect(decoded.claim).not.toEqual(decoded.successObservation.claim)
  })
)

it.effect("rejects a compact claim whose remaining plan is malformed", () =>
  Effect.gen(function* () {
    const event = eventsFor("malformed-plan", 3)[0]
    if (event === undefined) return yield* Effect.die("fixture missing")
    const encoded = encodeJournalEvent(event)
    const storage = Schema.decodeUnknownSync(storageEnvelope)(JSON.parse(encoded.payloadJson))
    const observation = jsonObject(storage.payload["successObservation"])
    const claim = jsonObject(observation["claim"])
    const payload = {
      ...storage,
      payload: {
        ...storage.payload,
        successObservation: { ...observation, claim: { ...claim, promotionCorrelation: {} } }
      }
    }
    const failure = yield* decodeJournalEvent({ ...encoded, payloadJson: JSON.stringify(payload) }).pipe(Effect.flip)
    expect(failure._tag).toBe("JournalEventDecodeIssue")
  })
)
