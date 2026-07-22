import { Effect, Schema } from "effect"
import { JournalEventKind, JournalEventVersion } from "./domain.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import { WorkflowJournalEvent } from "./journal-store.js"

const CurrentPayload = Schema.Record(Schema.String, Schema.Unknown)

/** One normalized journal envelope prepared for immutable persistence. */
export const EncodedJournalEvent = Schema.Struct({
  kind: JournalEventKind,
  payloadJson: Schema.String,
  version: JournalEventVersion
})
export type EncodedJournalEvent = Schema.Schema.Type<typeof EncodedJournalEvent>

/** A versioned payload cannot be decoded and upcast into Dalph's current event vocabulary. */
export class JournalEventDecodeIssue extends Schema.TaggedErrorClass<JournalEventDecodeIssue>()(
  "JournalEventDecodeIssue",
  {
    detail: Schema.String,
    kind: JournalEventKind,
    version: JournalEventVersion
  }
) {}

const decodePayload = (
  payloadJson: string,
  kind: JournalEventKind,
  version: JournalEventVersion
): Effect.Effect<Record<string, unknown>, JournalEventDecodeIssue> =>
  Effect.try({
    try: (): unknown => JSON.parse(payloadJson),
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
 * Converts an immutable historical payload to the current semantic event.
 * Version 1 stored the discriminator in its JSON object; version 2 stores only
 * variant fields because kind and version belong to the normalized envelope.
 */
export const decodeAndUpcastJournalEvent = Effect.fn("WorkflowJournal.decodeAndUpcastEvent")(
  function*(encoded: EncodedJournalEvent) {
    const payload = yield* decodePayload(encoded.payloadJson, encoded.kind, encoded.version)
    const candidate: unknown = encoded.version === 1
      ? { ...payload, _tag: encoded.kind, version: workflowJournalEventVersion }
      : encoded.version === workflowJournalEventVersion
      ? { ...payload, _tag: encoded.kind, version: workflowJournalEventVersion }
      : undefined
    if (candidate === undefined) {
      return yield* new JournalEventDecodeIssue({
        detail: `unsupported journal event version ${encoded.version}`,
        kind: encoded.kind,
        version: encoded.version
      })
    }
    return yield* Schema.decodeUnknownEffect(WorkflowJournalEvent)(candidate).pipe(
      Effect.mapError((cause) =>
        new JournalEventDecodeIssue({
          detail: String(cause),
          kind: encoded.kind,
          version: encoded.version
        })
      )
    )
  }
)

/** Encodes current semantics without making JSON bytes the equality contract. */
export const encodeJournalEvent = (event: WorkflowJournalEvent): EncodedJournalEvent => {
  const encoded = Schema.encodeUnknownSync(WorkflowJournalEvent)(event)
  const { _tag, version, ...payload } = encoded
  return EncodedJournalEvent.make({
    kind: JournalEventKind.make(_tag),
    payloadJson: JSON.stringify(payload),
    version: JournalEventVersion.make(version)
  })
}

/** Compares decoded/upcast meanings, never historical JSON representation. */
export const semanticallyEqualJournalEvents = (
  left: WorkflowJournalEvent,
  right: WorkflowJournalEvent
): boolean =>
  JSON.stringify(Schema.encodeUnknownSync(WorkflowJournalEvent)(left))
    === JSON.stringify(Schema.encodeUnknownSync(WorkflowJournalEvent)(right))
