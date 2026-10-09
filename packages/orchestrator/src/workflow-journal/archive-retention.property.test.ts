import { RunCompletionTime } from "./completion-model.js"
import * as fc from "fast-check"
import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import { RunId } from "@dalph/contracts"
import { archiveAgeMillis, archiveByteBudget, archiveRetentionPass, SavedArchiveBytes } from "./archive-retention.js"

it("removes age-expired units before pressure units and preserves exact quota equality for generated storage facts", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          ageOffset: fc.integer({ min: -1, max: 1 }),
          bytes: fc.integer({ min: 1, max: archiveByteBudget + 1 })
        }),
        { minLength: 1, maxLength: 8 }
      ),
      async (inputs) => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const now = archiveAgeMillis + 10
            const candidates = inputs.map((input, index) => ({
              runId: RunId.make(`r${index}`),
              baseline: RunCompletionTime.make(10 + input.ageOffset),
              bytes: SavedArchiveBytes.make(input.bytes)
            }))
            const state = yield* Ref.make(candidates.toReversed())
            const observation = yield* archiveRetentionPass({
              now: Effect.succeed(now),
              snapshot: () =>
                Ref.get(state).pipe(
                  Effect.map((remaining) => ({
                    candidates: remaining,
                    expiredBacklog: remaining.filter((item) => item.baseline <= 10).length,
                    savedBytes: SavedArchiveBytes.make(remaining.reduce((sum, item) => sum + item.bytes, 0))
                  }))
                ),
              remove: (selected) =>
                Ref.update(state, (remaining) => remaining.filter((item) => item.runId !== selected.runId))
            })
            const expired = candidates.filter((item) => item.baseline <= 10)
            expect(expired.every((item) => observation.deletedRuns.includes(item.runId))).toBe(true)
            const remaining = yield* Ref.get(state)
            expect(remaining.every((item) => item.baseline > 10)).toBe(true)
            expect(observation.savedBytes).toBeLessThanOrEqual(archiveByteBudget)
            const selected = observation.deletedRuns.map((id) => candidates.find((item) => item.runId === id))
            expect(selected).toEqual(
              [...selected].sort(
                (a, b) => (a?.baseline ?? 0) - (b?.baseline ?? 0) || (a?.runId ?? "").localeCompare(b?.runId ?? "")
              )
            )
            expect(
              (yield* archiveRetentionPass({
                now: Effect.succeed(now),
                snapshot: () =>
                  Effect.succeed({ candidates: remaining, expiredBacklog: 0, savedBytes: observation.savedBytes }),
                remove: () => Effect.die("a settled repeat cannot remove another history")
              })).deletedRuns
            ).toEqual([])
          })
        )
      }
    ),
    { numRuns: 50 }
  )
})
