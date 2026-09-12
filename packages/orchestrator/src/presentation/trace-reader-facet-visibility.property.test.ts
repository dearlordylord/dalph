import { expect, it } from "vitest"
import fc from "fast-check"
import { AttemptId, RunId } from "@dalph/contracts"
import { JournalPosition } from "../workflow-journal/identity.js"
import { TraceItemIdentity, TraceObservationGap } from "./trace-reader.js"
import { prepareFacetVisibility } from "./trace-reader-facet-visibility.js"

const runId = RunId.make("prepared-facet-visibility")
const gap = (position: number, key: number) =>
  TraceObservationGap.cases.ExecutorReport.make({
    action: TraceItemIdentity.make({ position: JournalPosition.make(position), runId }),
    attemptId: AttemptId.make(`visibility-attempt:${key}`)
  })

it("equals the independent half-open cold interval oracle at every cursor", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          start: fc.integer({ min: 1, max: 24 }),
          width: fc.integer({ min: 0, max: 12 }),
          open: fc.boolean()
        }),
        { maxLength: 32 }
      ),
      (input) => {
        const intervals = input.map(({ open, start, width }, key) => ({
          start: JournalPosition.make(start),
          end: open ? undefined : JournalPosition.make(start + width),
          order: JournalPosition.make(key + 1),
          value: gap(start, key)
        }))
        const prepared = prepareFacetVisibility({
          gaps: intervals,
          responsibilities: [],
          dispositions: [],
          preservation: []
        })
        for (let position = 1; position <= 36; position += 1) {
          const expected = intervals
            .filter(({ end, start }) => start <= position && (end === undefined || position < end))
            .map(({ value }) => value)
          expect(prepared.gapsAt(JournalPosition.make(position))).toEqual(expected)
        }
      }
    ),
    { numRuns: 100 }
  )
})
