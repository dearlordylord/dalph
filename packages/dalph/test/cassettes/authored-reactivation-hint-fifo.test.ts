import { it } from "@effect/vitest"
import { Chunk, Effect } from "effect"
import { describe, expect } from "vitest"
import {
  makeAuthoredRunReactivationHintFifo,
  type AuthoredRunReactivationHint
} from "../../src/cassettes/authored-reactivation-hint-fifo.js"

describe("authored Run reactivation hint FIFO", () => {
  it.effect("takes hints in offer order and releases every consumed persistent node", () =>
    Effect.gen(function* () {
      const hints = yield* makeAuthoredRunReactivationHintFifo()

      yield* hints.offer("TrackerNotification")
      yield* hints.offer("Timer")
      yield* hints.offer("TrackerNotification")

      expect(yield* hints.retainedHintCount).toBe(3)
      expect(yield* hints.take).toBe("TrackerNotification")
      expect(yield* hints.retainedHintCount).toBe(2)
      expect(yield* hints.take).toBe("Timer")
      expect(yield* hints.retainedHintCount).toBe(1)
      expect(yield* hints.take).toBe("TrackerNotification")
      expect(yield* hints.retainedHintCount).toBe(0)
      expect(yield* hints.take).toBeUndefined()
      expect(yield* hints.retainedHintCount).toBe(0)
    })
  )

  it.effect("keeps every hint offered by concurrent cassette fibers", () =>
    Effect.gen(function* () {
      const hints = yield* makeAuthoredRunReactivationHintFifo()
      const trackerNotification: AuthoredRunReactivationHint = "TrackerNotification"
      const timer: AuthoredRunReactivationHint = "Timer"
      const offered = Chunk.empty<AuthoredRunReactivationHint>().pipe(
        Chunk.append(trackerNotification),
        Chunk.append(timer),
        Chunk.append(timer),
        Chunk.append(trackerNotification),
        Chunk.append(timer),
        Chunk.append(trackerNotification)
      )

      yield* Effect.forEach(offered, hints.offer, { concurrency: "unbounded", discard: true })

      expect(yield* hints.retainedHintCount).toBe(offered.length)
      const taken = yield* Effect.forEach(offered, () => hints.take)
      expect(taken.filter((hint) => hint === "TrackerNotification")).toHaveLength(3)
      expect(taken.filter((hint) => hint === "Timer")).toHaveLength(3)
      expect(yield* hints.retainedHintCount).toBe(0)
    })
  )
})
