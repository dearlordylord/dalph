import { it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Option } from "effect"
import { expect } from "vitest"
import { AttemptId, TaskId, TaskRevision } from "@dalph/contracts"
import { AuthoredCassetteStoryItem } from "../../src/cassettes/authored-domain.js"
import { makeStoryCursor } from "../../src/cassettes/authored-cursor.js"
import { makeAuthoredOperatorRequestLifecycle } from "../../src/cassettes/authored-operator-request-lifecycle.js"

const restart = AuthoredCassetteStoryItem.cases.OperatorRestartsAttempt.make({
  attemptId: AttemptId.make("attempt:A:0"),
  expected: { _tag: "Applied" },
  observedTaskRevision: TaskRevision.make("revision-7"),
  requestNonce: "restart-A",
  taskId: TaskId.make("A")
})

it.effect("waits only for an operator request already in flight at an activation boundary", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeAuthoredOperatorRequestLifecycle()
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const claim = yield* lifecycle.claim("restart-A")
    const request = yield* lifecycle
      .runClaimed(claim, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))
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
    const claim = yield* lifecycle.claim("restart-A")
    const request = yield* lifecycle
      .runClaimed(
        claim,
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
    const claim = yield* lifecycle.claim("restart-A")
    const request = yield* lifecycle
      .runClaimed(claim, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)))
      .pipe(Effect.forkScoped)
    yield* Deferred.await(entered)
    yield* Fiber.interrupt(request)

    expect(Option.isNone(yield* lifecycle.pollInFlight())).toBe(true)
    const boundary = yield* lifecycle.awaitInFlightAtBoundary().pipe(Effect.exit)
    expect(Exit.isSuccess(boundary)).toBe(true)
  })
)

it.effect("installs the exact Restart owner before its cursor claim advances", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeAuthoredOperatorRequestLifecycle()
    const cursor = yield* makeStoryCursor([restart])
    const claimed = yield* cursor.consumeAttemptChoiceClaimed((item) => lifecycle.claim(item.requestNonce))
    if (Option.isNone(claimed)) return yield* Effect.die("Restart was not claimed")

    expect(yield* cursor.storyPosition).toBe(1)
    expect(yield* lifecycle.pollInFlight()).toEqual(Option.some("restart-A"))
    const boundary = yield* lifecycle.awaitInFlightAtBoundary().pipe(Effect.forkScoped({ startImmediately: true }))
    expect(boundary.pollUnsafe()).toBeUndefined()

    yield* lifecycle.runClaimed(claimed.value.claim, Effect.void)
    yield* Fiber.join(boundary)
    expect(Option.isNone(yield* lifecycle.pollInFlight())).toBe(true)
  })
)

it.effect("does not install a request owner when no attempt choice is claimable", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeAuthoredOperatorRequestLifecycle()
    const cursor = yield* makeStoryCursor([])
    expect(Option.isNone(yield* cursor.consumeAttemptChoiceClaimed((item) => lifecycle.claim(item.requestNonce)))).toBe(
      true
    )
    expect(Option.isNone(yield* lifecycle.pollInFlight())).toBe(true)
  })
)
