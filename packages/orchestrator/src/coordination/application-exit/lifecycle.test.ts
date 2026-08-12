import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber } from "effect"
import { expect } from "vitest"
import { ApplicationExitResult } from "./lifecycle-decision.js"
import { makeApplicationExitLifecycle } from "./lifecycle.js"

it.effect("rolls back a preparing reservation when Exit closes admission before owner registration", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeApplicationExitLifecycle()
    const preparation = yield* lifecycle.prepareForwardOwner("InterruptibleBoundary")
    const reservationPrepared = yield* Deferred.make<void>()
    const allowRegistration = yield* Deferred.make<void>()
    let reservationHeld = false

    const admission = yield* Effect.gen(function* () {
      reservationHeld = true
      yield* Deferred.succeed(reservationPrepared, undefined)
      yield* Deferred.await(allowRegistration)
      return yield* preparation.register.pipe(
        Effect.onError(() =>
          Effect.sync(() => {
            reservationHeld = false
          }).pipe(Effect.andThen(preparation.cancel))
        )
      )
    }).pipe(Effect.forkChild)

    yield* Deferred.await(reservationPrepared)
    yield* lifecycle.requestExit
    yield* Deferred.succeed(allowRegistration, undefined)
    expect((yield* Fiber.await(admission))._tag).toBe("Failure")
    expect(reservationHeld).toBe(false)
    expect(yield* lifecycle.snapshot).toEqual({ cutoffClosed: true, preparingOwnerCount: 0, registeredOwnerCount: 0 })
  })
)

it.effect("joins repeated Exit requests to one result and never registers a later owner", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeApplicationExitLifecycle()
    const firstResult = yield* lifecycle.requestExit
    const repeatedResult = yield* lifecycle.requestExit

    expect(repeatedResult).toBe(firstResult)
    expect((yield* lifecycle.prepareForwardOwner("AtomicBoundary").pipe(Effect.flip))._tag).toBe("ApplicationExiting")
    expect(yield* lifecycle.snapshot).toEqual({ cutoffClosed: true, preparingOwnerCount: 0, registeredOwnerCount: 0 })

    const succeeded = ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 })
    expect(yield* lifecycle.completeExit(succeeded)).toBe(true)
    expect(yield* Deferred.await(firstResult)).toEqual(succeeded)
    expect(yield* Deferred.await(repeatedResult)).toEqual(succeeded)
  })
)
