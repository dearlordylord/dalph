import { describe, expect, it } from "vitest"
import { AttemptId, RunId } from "@dalph/contracts"
import { JournalPosition } from "../workflow-journal/identity.js"
import { TraceItemIdentity, TraceObservationGap } from "./trace-reader.js"
import { prepareFacetVisibility, type FacetVisibility } from "./trace-reader-facet-visibility.js"

const runId = RunId.make("prepared-facet-visibility")
const gap = (position: number, key: number) =>
  TraceObservationGap.cases.ExecutorReport.make({
    action: TraceItemIdentity.make({ position: JournalPosition.make(position), runId }),
    attemptId: AttemptId.make(`visibility-attempt:${key}`)
  })
const prepare = (gaps: ReadonlyArray<FacetVisibility<TraceObservationGap>>) =>
  prepareFacetVisibility({ gaps, responsibilities: [], dispositions: [], preservation: [] })

describe("sealed historical facet visibility", () => {
  it("keeps an earlier selected array independent of later queries and preparations", () => {
    const original = gap(1, 1)
    const prepared = prepare([
      { start: JournalPosition.make(1), end: JournalPosition.make(3), order: JournalPosition.make(1), value: original }
    ])
    const selected = prepared.gapsAt(JournalPosition.make(1))
    expect(prepared.gapsAt(JournalPosition.make(3))).toEqual([])
    const other = prepare([
      { start: JournalPosition.make(1), end: undefined, order: JournalPosition.make(1), value: gap(1, 2) }
    ])
    expect(other.gapsAt(JournalPosition.make(3))).toHaveLength(1)
    expect(selected).toEqual([original])
  })

  it.each([64, 128])("retains two interval references per version and avoids scanning %i closed gaps", (size) => {
    const intervals = Array.from({ length: size }, (_, key) => ({
      start: JournalPosition.make(key * 2 + 1),
      end: JournalPosition.make(key * 2 + 2),
      order: JournalPosition.make(key + 1),
      value: gap(key * 2 + 1, key)
    }))
    const prepared = prepare(intervals)
    expect(prepared.gapsAt(JournalPosition.make(size * 2 + 1))).toEqual([])
    const counts = prepared.counts().gaps
    expect(counts.versions).toBe(size)
    expect(counts.retainedIntervalReferences).toBe(size * 2)
    expect(counts.nodes).toBe(size)
    expect(counts.queryComparisons).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(size + 1)))
    expect(counts.buildComparisons).toBeLessThan(size * Math.ceil(Math.log2(size + 1)) * 4)
  })
})
