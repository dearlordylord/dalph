import { Schema } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import { AuthoredCassetteStoryItem } from "../../src/cassettes/index.js"

const authoredTrackerGraphReadResultArbitrary = fc.oneof(
  fc.constant({ _tag: "TrackerGraphReadFailed" as const, reason: "IncompleteSnapshot" as const }),
  fc
    .tuple(fc.string({ minLength: 1, maxLength: 24 }), fc.integer({ min: 0, max: 8 }))
    .map(([revision, taskCount]) => ({
      _tag: "TrackerGraphReadReturned" as const,
      graph: {
        revision,
        tasks: Array.from({ length: taskCount }, (_, index) => ({
          id: `task-${index}`,
          lifecycle: { _tag: "Open" as const },
          parentTaskId: null,
          prerequisiteIds: []
        }))
      }
    }))
)

it("roundtrips arbitrary authored tracker graph outcomes through the story-item boundary", () => {
  fc.assert(
    fc.property(authoredTrackerGraphReadResultArbitrary, (encoded) => {
      expect(
        Schema.encodeUnknownSync(AuthoredCassetteStoryItem)(
          Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(encoded)
        )
      ).toEqual(encoded)
    }),
    { numRuns: 100 }
  )
})
