import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Option, SubscriptionRef, Stream } from "effect"
import { expect } from "vitest"
import {
  attachCurrentSignal,
  currentSignalOf,
  currentSignalFromCurrentFirstStream,
  mapCurrentSignal,
  zipCurrentSignals
} from "./relations.js"

it.effect("currentSignalOf.get equals the current-first value observed from changes", () =>
  Effect.gen(function* () {
    const signal = currentSignalOf({ revision: 1 })
    const observed = yield* signal.changes.pipe(Stream.runHead)

    expect(yield* signal.get).toEqual(Option.getOrThrow(observed))
  })
)

it.effect("attaches after publication from the latest value and follows later changes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make("A")
      const signal = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(state))
      yield* SubscriptionRef.set(state, "B")

      const attachment = yield* attachCurrentSignal(signal)
      expect(attachment.current).toBe("B")

      const next = yield* attachment.changes.pipe(Stream.runHead, Effect.forkChild)
      yield* SubscriptionRef.set(state, "C")
      expect(Option.getOrThrow(yield* Fiber.join(next))).toBe("C")
    })
  )
)

it.effect("reconnects from current state without replaying a process-local cursor", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make("A")
      const signal = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(state))
      const first = yield* attachCurrentSignal(signal)
      expect(first.current).toBe("A")

      yield* SubscriptionRef.set(state, "B")
      yield* SubscriptionRef.set(state, "C")

      const reconnected = yield* attachCurrentSignal(signal)
      expect(reconnected.current).toBe("C")
    })
  )
)

it.effect("does not miss a publication racing with attachment", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make("A")
      const signal = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(state))
      const attaching = yield* attachCurrentSignal(signal).pipe(Effect.forkChild)

      yield* SubscriptionRef.set(state, "B")
      const attachment = yield* Fiber.join(attaching)
      const observed =
        attachment.current === "B"
          ? attachment.current
          : Option.getOrThrow(yield* attachment.changes.pipe(Stream.runHead))

      expect(observed).toBe("B")
    })
  )
)

it.effect("uses a publication after attachment starts but before the current-first source subscribes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make("A")
      const attachmentStarted = yield* Deferred.make<void>()
      const subscribe = yield* Deferred.make<void>()
      const changes = Stream.fromEffect(
        Deferred.succeed(attachmentStarted, undefined).pipe(Effect.andThen(Deferred.await(subscribe)))
      ).pipe(Stream.drain, Stream.concat(SubscriptionRef.changes(state)))
      const attaching = yield* attachCurrentSignal(currentSignalFromCurrentFirstStream(changes)).pipe(Effect.forkChild)

      yield* Deferred.await(attachmentStarted)
      yield* SubscriptionRef.set(state, "B")
      yield* Deferred.succeed(subscribe, undefined)

      expect((yield* Fiber.join(attaching)).current).toBe("B")
    })
  )
)

it.effect("retains a publication after the source subscribes but before attachment returns", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make("A")
      const currentPulled = yield* Deferred.make<void>()
      const returnCurrent = yield* Deferred.make<void>()
      const changes = SubscriptionRef.changes(state).pipe(
        Stream.mapEffect((value) =>
          Deferred.succeed(currentPulled, undefined).pipe(
            Effect.andThen(Deferred.await(returnCurrent)),
            Effect.as(value)
          )
        )
      )
      const attaching = yield* attachCurrentSignal(currentSignalFromCurrentFirstStream(changes)).pipe(Effect.forkChild)

      yield* Deferred.await(currentPulled)
      yield* SubscriptionRef.set(state, "B")
      yield* Deferred.succeed(returnCurrent, undefined)
      const attachment = yield* Fiber.join(attaching)

      expect(attachment.current).toBe("A")
      expect(Option.getOrThrow(yield* attachment.changes.pipe(Stream.runHead))).toBe("B")
    })
  )
)

it.effect("retains a publication after attachment returns and before the changes stream is consumed", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make("A")
      const signal = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(state))
      const attachment = yield* attachCurrentSignal(signal)

      yield* SubscriptionRef.set(state, "B")

      expect(attachment.current).toBe("A")
      expect(Option.getOrThrow(yield* attachment.changes.pipe(Stream.runHead))).toBe("B")
    })
  )
)

it.effect("mapped and zipped signals expose coherent get values and reactive updates", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const leftState = yield* SubscriptionRef.make(1)
      const rightState = yield* SubscriptionRef.make("A")
      const left = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(leftState))
      const right = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(rightState))
      const mapped = mapCurrentSignal(left, (value) => value * 2)
      const zipped = zipCurrentSignals(mapped, right)
      const attachment = yield* attachCurrentSignal(zipped)
      expect(attachment.current).toEqual([2, "A"])
      const observed = yield* attachment.changes.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)

      expect(yield* mapped.get).toBe(2)
      expect(yield* zipped.get).toEqual([2, "A"])
      yield* SubscriptionRef.set(leftState, 2)

      const values = Array.from(yield* Fiber.join(observed))
      expect(values).toEqual([[4, "A"]])
      yield* SubscriptionRef.set(rightState, "B")
      const reattached = yield* attachCurrentSignal(zipped)
      expect(reattached.current).toEqual([4, "B"])
      expect(yield* mapped.get).toBe(4)
      expect(yield* zipped.get).toEqual([4, "B"])
    })
  )
)
