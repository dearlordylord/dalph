import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { FixtureTarget, JournalEventKind, JournalEventVersion, OperationId } from "./domain.js"
import { decodeJournalEvent, encodeJournalEvent } from "./journal-event-codec.js"
import { taskTrackerReadIntent } from "./journal-store.js"
import { makeTrackerGraphObservationOperation } from "./workflow-operation.js"

it.effect("round-trips the current generic journal vocabulary", () =>
  Effect.gen(function* () {
    const event = taskTrackerReadIntent(
      makeTrackerGraphObservationOperation(OperationId.make("read-graph"), FixtureTarget.make("fixture"), [], [])
    )
    const decoded = yield* decodeJournalEvent(encodeJournalEvent(event))
    expect(decoded).toEqual(event)
    expect(decoded._tag).toBe("TaskTrackerReadIntentRecorded")
  })
)

it.effect("rejects malformed payloads, unsupported versions, and invalid event shapes", () =>
  Effect.gen(function* () {
    const kind = JournalEventKind.make("TaskTrackerReadIntentRecorded")
    const cases = [
      { kind, payloadJson: "{", version: JournalEventVersion.make(6) },
      { kind, payloadJson: "[]", version: JournalEventVersion.make(6) },
      { kind, payloadJson: "{}", version: JournalEventVersion.make(5) },
      { kind, payloadJson: "{}", version: JournalEventVersion.make(6) }
    ]
    for (const encoded of cases) {
      const issue = yield* decodeJournalEvent(encoded).pipe(Effect.flip)
      expect(issue._tag).toBe("JournalEventDecodeIssue")
    }
  })
)
