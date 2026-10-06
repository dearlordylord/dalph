import { it } from "@effect/vitest"
import * as fc from "fast-check"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { OperationId } from "../../workflow/identity.js"
import { integrationFinalityFixture as fixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import {
  CompletionTaskClaim,
  CompletionClaimDeletedEvent,
  FocusedCompletedTaskObservation
} from "../../workflow/protocols/integration-finality/events.js"
import { encodeJournalEvent } from "../event-codec.js"
import { decodeSqliteJournalEvent, encodeSqliteJournalEvent } from "./sqlite-event-codec.js"

it("round-trips full semantic finality events through the production SQLite gzip and compact layers", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string({ minLength: 1, maxLength: 40 }), async (suffix) => {
      const claim = CompletionTaskClaim.make({
        ...fixture.claim,
        originalClaim: ActiveTaskClaim.make({ ...fixture.activeClaim, token: ClaimToken.make(suffix) })
      })
      const event = CompletionClaimDeletedEvent.make({
        claim,
        operationId: OperationId.make(`deletion:${suffix}`),
        successObservation: FocusedCompletedTaskObservation.make({ ...fixture.successObservation, claim }),
        version: workflowJournalEventVersion
      })
      const stored = encodeSqliteJournalEvent(event)
      expect(JSON.parse(stored.payloadJson)._tag).toBe("DalphJournalGzipPayloadV1")
      const decoded = await Effect.runPromise(decodeSqliteJournalEvent(stored))
      expect(decoded).toEqual(event)
      expect(encodeSqliteJournalEvent(decoded)).toEqual(stored)
      expect(await Effect.runPromise(decodeSqliteJournalEvent(encodeJournalEvent(event)))).toEqual(event)
    }),
    { numRuns: 60 }
  )
})

it.effect("attaches the row's kind and semantic version to gzip failures without falling back", () =>
  Effect.gen(function* () {
    const event = CompletionClaimDeletedEvent.make({
      claim: fixture.claim,
      operationId: OperationId.make("bad-gzip"),
      successObservation: fixture.successObservation,
      version: workflowJournalEventVersion
    })
    const encoded = encodeSqliteJournalEvent(event)
    const payload = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(JSON.parse(encoded.payloadJson))
    for (const changed of [
      { ...payload, _tag: "DalphJournalGzipPayloadV2" },
      { ...payload, sha256: "0".repeat(64) },
      { ...payload, data: "!!!!" }
    ]) {
      const failure = yield* decodeSqliteJournalEvent({ ...encoded, payloadJson: JSON.stringify(changed) }).pipe(
        Effect.flip
      )
      expect(failure).toMatchObject({ _tag: "JournalEventDecodeIssue", kind: encoded.kind, version: encoded.version })
    }
  })
)
