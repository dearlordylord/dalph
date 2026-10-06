import { Effect, Schema } from "effect"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import {
  decodeJournalEvent,
  encodeJournalEvent,
  type EncodedJournalEvent,
  JournalEventDecodeIssue
} from "../event-codec.js"
import { decodeJournalGzipPayload, encodeJournalGzipPayload } from "./gzip-payload.js"

const Payload = Schema.Record(Schema.String, Schema.Json)

/** Gzip is storage provenance: common event semantics, in-memory history and cassettes stay unchanged. */
export const encodeSqliteJournalEvent = (event: WorkflowJournalEvent): EncodedJournalEvent => {
  const encoded = encodeJournalEvent(event)
  return { ...encoded, payloadJson: encodeJournalGzipPayload(encoded.payloadJson) }
}

/** Complete event validation remains mandatory after bounded storage decoding. */
export const decodeSqliteJournalEvent = Effect.fn("JournalStore.Sqlite.decodeEvent")(function* (
  encoded: EncodedJournalEvent
) {
  const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Payload))(encoded.payloadJson).pipe(
    Effect.flatMap(decodeJournalGzipPayload),
    Effect.mapError(
      (cause) => new JournalEventDecodeIssue({ detail: String(cause), kind: encoded.kind, version: encoded.version })
    )
  )
  return yield* decodeJournalEvent({ ...encoded, payloadJson: JSON.stringify(payload) })
})
