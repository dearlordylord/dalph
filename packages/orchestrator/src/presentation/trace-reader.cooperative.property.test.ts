import * as fc from "fast-check"
import { Effect } from "effect"
import { expect, it } from "vitest"
import { JournalPosition, JournalRecordKey } from "../workflow-journal/identity.js"
import { TraceCursor } from "./trace-reader.js"
import { capacitiesThrough, readerFor, runId } from "./trace-reader.prepared-fixtures.js"

it("matches the synchronous cursor oracle for canonical, gapped, duplicated and malformed-key histories", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 1, maxLength: 16 }),
      fc.integer({ min: 0, max: 16 }),
      async (capacities, selected) => {
        const source = capacitiesThrough(capacities)
        const selectedIndex = selected % source.length
        const variants = [
          source,
          source.map((record, index) =>
            index === selectedIndex ? { ...record, key: JournalRecordKey.make("malformed-key") } : record
          ),
          source.map((record, index) =>
            index === selectedIndex ? { ...record, position: JournalPosition.make(record.position + 1) } : record
          ),
          [...source, ...source.slice(selectedIndex, selectedIndex + 1)]
        ]
        for (const records of variants) {
          const last = records.at(-1)
          if (last === undefined) return expect.fail("nonempty history required")
          const cursor = TraceCursor.make({ runId, position: last.position })
          const actual = await Effect.runPromise(Effect.result(readerFor(records).readOccurrencesAt(cursor)))
          const expected = Effect.runSync(Effect.result(readerFor(records).readAt(cursor)))
          if (expected._tag === "Success") {
            expect(actual).toMatchObject({
              _tag: "Success",
              success: { committedThrough: cursor.position, runId, items: expected.success.items, version: 4 }
            })
          } else expect(actual).toEqual(expected)
        }
      }
    ),
    { numRuns: 40 }
  )
})
