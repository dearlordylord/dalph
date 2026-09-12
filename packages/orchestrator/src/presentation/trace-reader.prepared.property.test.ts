import * as fc from "fast-check"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { JournalPosition } from "../workflow-journal/identity.js"
import { TraceCursor } from "./trace-reader.js"
import { capacitiesThrough, coldReaderFor, readerFor, runId } from "./trace-reader.prepared-fixtures.js"

it.effect("lets the maintainer select every prepared cursor with the exact independent cold payload", () =>
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      fc.assert(
        fc.property(fc.array(fc.integer({ min: 1, max: 8 }), { maxLength: 8 }), (capacities) => {
          const records = capacitiesThrough(capacities)
          const prepared = Effect.runSync(readerFor(records).prepare(runId))
          const cold = coldReaderFor(records)
          expect(prepared.cursors.map(({ position }) => position)).toEqual(records.map(({ position }) => position))
          const unvisitedTail = TraceCursor.make({ position: JournalPosition.make(records.length + 2), runId })
          expect(Effect.runSync(Effect.result(cold.readAt(unvisitedTail)))).toMatchObject({
            _tag: "Failure",
            failure: { _tag: "TraceJournalPrefixInvalid" }
          })
          for (const cursor of prepared.cursors) {
            expect(prepared.select(cursor)).toEqual(Effect.runSync(Effect.result(cold.readAt(cursor))))
          }
        })
      )
    })
  })
)
