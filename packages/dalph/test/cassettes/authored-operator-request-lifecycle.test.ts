import { it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Option } from "effect"
import { expect } from "vitest"
import { makeAuthoredOperatorRequestLifecycle } from "../../src/cassettes/authored-operator-request-lifecycle.js"

it.effect("waits only for an operator request already in flight at an activation boundary", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeAuthoredOperatorRequestLifecycle()
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const request = yield* lifecycle
      .run("restart-A", Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))
      .pipe(Effect.forkScoped)
    yield* Deferred.await(entered)

    const boundary = yield* lifecycle.awaitInFlightAtBoundary().pipe(Effect.forkScoped)
    expect(boundary.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(request)
    yield* Fiber.join(boundary)
    expect(Option.isNone(yield* lifecycle.pollInFlight())).toBe(true)
  })
)

it.effect("does not wait for a future operator request", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeAuthoredOperatorRequestLifecycle()
    yield* lifecycle.awaitInFlightAtBoundary()
    expect(Option.isNone(yield* lifecycle.pollInFlight())).toBe(true)
  })
)

it.effect("propagates an in-flight operator request failure across the activation boundary", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeAuthoredOperatorRequestLifecycle()
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const request = yield* lifecycle
      .run(
        "restart-A",
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(Effect.fail("choice failed"))
        )
      )
      .pipe(Effect.forkScoped)
    yield* Deferred.await(entered)
    const boundary = yield* lifecycle
      .awaitInFlightAtBoundary()
      .pipe(Effect.exit, Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.succeed(release, undefined)
    expect(Exit.isFailure(yield* Fiber.join(boundary))).toBe(true)
    expect(Exit.isFailure(yield* Fiber.await(request))).toBe(true)
  })
)

it.effect("clears a cancelled request without leaving a stale boundary token", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeAuthoredOperatorRequestLifecycle()
    const entered = yield* Deferred.make<void>()
    const request = yield* lifecycle
      .run("restart-A", Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)))
      .pipe(Effect.forkScoped)
    yield* Deferred.await(entered)
    yield* Fiber.interrupt(request)

    expect(Option.isNone(yield* lifecycle.pollInFlight())).toBe(true)
    const boundary = yield* lifecycle.awaitInFlightAtBoundary().pipe(Effect.exit)
    expect(Exit.isSuccess(boundary)).toBe(true)
  })
)
