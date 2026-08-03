import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Option, SubscriptionRef, Stream } from "effect"
import { expect } from "vitest"
import { currentSignalOf, mapCurrentSignal, zipCurrentSignals } from "./relations.js"

it.effect("currentSignalOf.get equals the current-first value observed from changes", () =>
  Effect.gen(function* () {
    const signal = currentSignalOf({ revision: 1 })
    const observed = yield* signal.changes.pipe(Stream.runHead)

    expect(yield* signal.get).toEqual(Option.getOrThrow(observed))
  })
)

it.effect("mapped and zipped signals expose coherent get values and reactive updates", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const leftState = yield* SubscriptionRef.make(1)
      const rightState = yield* SubscriptionRef.make("A")
      const left = { get: SubscriptionRef.get(leftState), changes: SubscriptionRef.changes(leftState) }
      const right = { get: SubscriptionRef.get(rightState), changes: SubscriptionRef.changes(rightState) }
      const mapped = mapCurrentSignal(left, (value) => value * 2)
      const zipped = zipCurrentSignals(mapped, right)
      const firstObserved = yield* Deferred.make<void>()
      const observed = yield* zipped.changes.pipe(
        Stream.tap(() => Deferred.succeed(firstObserved, undefined)),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild
      )

      yield* Deferred.await(firstObserved)
      expect(yield* mapped.get).toBe(2)
      expect(yield* zipped.get).toEqual([2, "A"])
      yield* SubscriptionRef.set(leftState, 2)
      yield* SubscriptionRef.set(rightState, "B")

      const values = Array.from(yield* Fiber.join(observed))
      expect(values).toEqual([
        [2, "A"],
        [4, "A"],
        [4, "B"]
      ])
      expect(yield* mapped.get).toBe(4)
      expect(yield* zipped.get).toEqual([4, "B"])
    })
  )
)
