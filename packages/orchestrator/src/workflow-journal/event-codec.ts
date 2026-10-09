import { Effect, Schema } from "effect"
import { JournalEventKind, JournalEventVersion, workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { WorkflowJournalEvent } from "../workflow/registry/event.js"
import { decodeJournalStoragePayload, encodeJournalStoragePayload } from "./storage-payload.js"
import type { JournalPayloadStringPool } from "./payload-string-pool.js"

const CurrentPayload = Schema.Record(Schema.String, Schema.Json)

const legacyCancelledAttemptImplementationEventKind =
  "CancelledAttemptImplementationResponsibilityRelinquished" as const
const cancelledAttemptImplementationAbandonedEventKind = "CancelledAttemptImplementationAbandoned" as const

/** One normalized journal envelope prepared for immutable persistence. */
export const EncodedJournalEvent = Schema.Struct({
  kind: JournalEventKind,
  payloadJson: Schema.String,
  version: JournalEventVersion
})
export type EncodedJournalEvent = Schema.Schema.Type<typeof EncodedJournalEvent>

/** A current-version payload cannot be decoded into Dalph's event vocabulary. */
export class JournalEventDecodeIssue extends Schema.TaggedError<JournalEventDecodeIssue>()("JournalEventDecodeIssue", {
  detail: Schema.String,
  kind: JournalEventKind,
  version: JournalEventVersion
}) {}

const decodePayload = (
  payloadJson: string,
  kind: JournalEventKind,
  version: JournalEventVersion,
  strings?: JournalPayloadStringPool
): Effect.Effect<Schema.JsonObject, JournalEventDecodeIssue> =>
  Effect.try({
    try: (): unknown => (strings === undefined ? JSON.parse(payloadJson) : strings.parse(payloadJson)),
    catch: (cause) => new JournalEventDecodeIssue({ detail: String(cause), kind, version })
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(CurrentPayload)),
    Effect.mapError((cause) =>
      cause instanceof JournalEventDecodeIssue
        ? cause
        : new JournalEventDecodeIssue({ detail: String(cause), kind, version })
    )
  )

/**
 * Decodes one current immutable payload into the current semantic event.
 */
export const decodeJournalEvent = Effect.fn("WorkflowJournal.decodeEvent")(function* (
  encoded: EncodedJournalEvent,
  strings?: JournalPayloadStringPool
) {
  if (encoded.version !== workflowJournalEventVersion) {
    return yield* new JournalEventDecodeIssue({
      detail: `unsupported journal event version ${encoded.version}; supported event format is ${workflowJournalEventVersion}. Retire obsolete development data separately only after resolving external custody; no automatic deletion or migration is performed`,
      kind: encoded.kind,
      version: encoded.version
    })
  }
  const storedPayload = yield* decodePayload(encoded.payloadJson, encoded.kind, encoded.version, strings)
  const payload = yield* decodeJournalStoragePayload(encoded.kind, storedPayload).pipe(
    Effect.mapError(
      (cause) => new JournalEventDecodeIssue({ detail: String(cause), kind: encoded.kind, version: encoded.version })
    )
  )
  const normalizedKind =
    encoded.kind === legacyCancelledAttemptImplementationEventKind
      ? cancelledAttemptImplementationAbandonedEventKind
      : encoded.kind
  const candidate: unknown = { ...payload, _tag: normalizedKind, version: workflowJournalEventVersion }
  return yield* Schema.decodeUnknownEffect(WorkflowJournalEvent)(candidate).pipe(
    Effect.mapError(
      (cause) => new JournalEventDecodeIssue({ detail: String(cause), kind: encoded.kind, version: encoded.version })
    )
  )
})

/** Encodes current semantics without making JSON bytes the equality contract. */
export const encodeJournalEvent = (event: WorkflowJournalEvent): EncodedJournalEvent => {
  const encoded = Schema.encodeUnknownSync(WorkflowJournalEvent)(event)
  const { _tag, version, ...payload } = encoded
  return EncodedJournalEvent.make({
    kind: JournalEventKind.make(_tag),
    payloadJson: encodeJournalStoragePayload(
      JournalEventKind.make(_tag),
      Schema.decodeUnknownSync(Schema.fromJsonString(CurrentPayload))(JSON.stringify(payload))
    ),
    version: JournalEventVersion.make(version)
  })
}

/** Compares decoded event meanings, never JSON representation. */
export const equalJournalEvents = (left: WorkflowJournalEvent, right: WorkflowJournalEvent): boolean =>
  JSON.stringify(Schema.encodeUnknownSync(WorkflowJournalEvent)(left)) ===
  JSON.stringify(Schema.encodeUnknownSync(WorkflowJournalEvent)(right))
