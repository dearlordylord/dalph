import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Ref } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { encodeCoverageLifecycle, type CoverageLifecycleObservation } from "../../../scripts/coverage-lifecycle.js"
import { AcceptanceWaitTimedOut, observeAcceptanceScope, waitForAcceptanceBoundary } from "./coverage-wait.js"

it.effect("names the original wait boundary when its unchanged budget expires", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const fiber = yield* Deferred.succeed(entered, undefined).pipe(
      Effect.andThen(Effect.never),
      waitForAcceptanceBoundary("MCPAdvisory", "AuthoredTaskEObserved", "20 seconds"),
      Effect.flip,
      Effect.forkScoped
    )
    yield* Deferred.await(entered)
    yield* TestClock.adjust("20 seconds")
    expect(yield* Fiber.join(fiber)).toEqual(
      new AcceptanceWaitTimedOut({
        testCase: "MCPAdvisory",
        boundary: "AuthoredTaskEObserved",
        timeoutMilliseconds: 20_000
      })
    )
  })
)

it.effect("identifies scope finalization before a blocked finalizer and preserves its release", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const observations = yield* Ref.make<ReadonlyArray<CoverageLifecycleObservation>>([])
    const emit = (event: CoverageLifecycleObservation) =>
      Ref.update(observations, (events) => [...events, event]).pipe(Effect.runSync)
    const fiber = yield* Effect.addFinalizer(() =>
      Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
    ).pipe(observeAcceptanceScope("controlled-stalled-scope", emit), Effect.forkScoped)
    yield* Deferred.await(entered)
    expect(yield* Ref.get(observations)).toEqual([
      { phase: "ScopeFinalizationStarted", owner: "controlled-stalled-scope", outcome: "Success" }
    ])
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(fiber)
    expect((yield* Ref.get(observations)).map(({ phase }) => phase)).toEqual([
      "ScopeFinalizationStarted",
      "ScopeFinalizationFinished"
    ])
  })
)

it.effect("keeps successful waits and their values unchanged", () =>
  Effect.gen(function* () {
    expect(yield* Effect.succeed(42).pipe(waitForAcceptanceBoundary("control", "AlreadyReady", "20 seconds"))).toBe(42)
  })
)

it("bounds each lifecycle record and marks omitted characters", () => {
  const text = encodeCoverageLifecycle({
    phase: "TestStarted",
    owner: "😀".repeat(10_000),
    file: "f".repeat(10_000),
    testId: "case-1"
  })
  expect(new TextEncoder().encode(text + "\n\n").length).toBeLessThanOrEqual(4096)
  expect(JSON.parse(text)).toMatchObject({ _tag: "CoverageLifecycle", testId: "case-1", omittedCharacters: 29_584 })
})

it("bounds escaped control characters in every allowed field", () => {
  const value = "\u0001".repeat(10_000)
  const text = encodeCoverageLifecycle({
    phase: "WaitTimedOut",
    owner: value,
    file: value,
    testId: value,
    boundary: value,
    outcome: value
  })
  expect(new TextEncoder().encode(text + "\n\n").length).toBeLessThanOrEqual(4096)
})
