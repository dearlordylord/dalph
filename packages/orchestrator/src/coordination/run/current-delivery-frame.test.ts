import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import type { JournalState } from "../delivery/journal.js"
import { TrackerGraphState } from "../delivery/relations.js"
import { journaledCurrentDeliveryFrameOf } from "./current-delivery-frame.js"

it.effect("rejects an accepted prefix before its current tracker graph exists", () =>
  Effect.gen(function* () {
    const accepted = { graph: TrackerGraphState.cases.GraphNotEstablished.make({}) } as JournalState
    const failure = yield* journaledCurrentDeliveryFrameOf(accepted).pipe(Effect.flip)

    expect(failure._tag).toBe("CurrentDeliveryGraphUnavailable")
  })
)
