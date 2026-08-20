import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  dispositionCleanupAuthoredCassetteCatalog,
  dispositionCleanupRecordedCassetteCatalog,
  projectRecordedCassette,
  renderRecordedCassetteLyrics,
  runDispositionCleanupCassette
} from "../../src/cassettes/index.js"

it.effect("runs each authored cleanup chronology and records its exact event family", () =>
  Effect.gen(function* () {
    for (const [key, cassette] of Object.entries(dispositionCleanupAuthoredCassetteCatalog)) {
      const run = yield* runDispositionCleanupCassette(cassette)
      const recorded = yield* projectRecordedCassette(run.records)
      const expected =
        dispositionCleanupRecordedCassetteCatalog[key as keyof typeof dispositionCleanupRecordedCassetteCatalog]
      const recordedTags = recorded.entries.map(({ _tag }) => _tag)
      const filteredCleanupTags = recordedTags.filter((tag) => tag.includes("Cleanup"))
      expect(filteredCleanupTags).toEqual(expected.events)
      if (expected.events.length > 0) expect(renderRecordedCassetteLyrics(recorded)).toContain("cleanup")
      else expect(filteredCleanupTags).toEqual([])
      expect(run.boundaryCalls).toEqual(cassette.expectedBoundaryCalls)
    }
  })
)
