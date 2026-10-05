import { it } from "@effect/vitest"
import { Duration, Effect, Fiber, Ref } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import type { CodexOwnedActivityCensusProjection } from "./codex-app-server.js"
import { observeRecoveryWriterCensus } from "./codex-recovery-census.js"

const unknown: CodexOwnedActivityCensusProjection = { _tag: "Unreadable", detail: "unassociated startup child" }

it.effect("recovery observes fresh absence after an unreadable startup census", () =>
  Effect.gen(function* () {
    const reads = yield* Ref.make(0)
    const observation = Ref.updateAndGet(reads, (n) => n + 1).pipe(
      Effect.map((n): CodexOwnedActivityCensusProjection => (n === 1 ? unknown : { _tag: "Absent" }))
    )
    const pending = yield* observeRecoveryWriterCensus(observation).pipe(Effect.forkChild)
    yield* TestClock.adjust(Duration.millis(100))
    expect(yield* Fiber.join(pending)).toEqual({ _tag: "Absent" })
    expect(yield* Ref.get(reads)).toBe(2)
  })
)

it.effect("recovery retains unreadable custody after its bounded read budget", () =>
  Effect.gen(function* () {
    const reads = yield* Ref.make(0)
    const pending = yield* observeRecoveryWriterCensus(Ref.update(reads, (n) => n + 1).pipe(Effect.as(unknown))).pipe(
      Effect.forkChild
    )
    yield* TestClock.adjust(Duration.seconds(1))
    expect(yield* Fiber.join(pending)).toEqual(unknown)
    expect(yield* Ref.get(reads)).toBe(5)
  })
)

it.effect("recovery never waits away a proven live writer or contradictory census", () =>
  Effect.forEach(
    [
      { _tag: "ExactLive", activities: [] },
      { _tag: "Contradictory", detail: "foreign correlation" }
    ] satisfies ReadonlyArray<CodexOwnedActivityCensusProjection>,
    (census) =>
      Effect.gen(function* () {
        const reads = yield* Ref.make(0)
        expect(yield* observeRecoveryWriterCensus(Ref.update(reads, (n) => n + 1).pipe(Effect.as(census)))).toEqual(
          census
        )
        expect(yield* Ref.get(reads)).toBe(1)
      })
  )
)

it.effect("recovery deadline retains custody when a census read never returns", () =>
  Effect.gen(function* () {
    const pending = yield* observeRecoveryWriterCensus(Effect.never).pipe(Effect.forkChild)
    yield* TestClock.adjust(Duration.seconds(1))
    expect(yield* Fiber.join(pending)).toEqual({
      _tag: "Unreadable",
      detail: "recovery census observation deadline exceeded"
    })
  })
)

it.effect("recovery retains its last unreadable observation when the next read stalls", () =>
  Effect.gen(function* () {
    const reads = yield* Ref.make(0)
    const observe = Ref.updateAndGet(reads, (n) => n + 1).pipe(
      Effect.flatMap((n) => (n === 1 ? Effect.succeed(unknown) : Effect.never))
    )
    const pending = yield* observeRecoveryWriterCensus(observe).pipe(Effect.forkChild)
    yield* TestClock.adjust(Duration.seconds(1))
    expect(yield* Fiber.join(pending)).toEqual(unknown)
    expect(yield* Ref.get(reads)).toBe(2)
  })
)
