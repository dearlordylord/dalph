import { it } from "@effect/vitest"
import { ExecutorGuidanceSelection } from "@dalph/contracts"
import { Effect, Fiber, Ref } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { awaitQualificationGuidanceSelection } from "./codex-guidance-readiness.js"

const unknown = ExecutorGuidanceSelection.cases.Refused.make({ reason: "CustodyUnproved" })
const unreadable = Effect.succeed("Unreadable/thread=active")

it.effect("native qualification stops readiness reads at a definitive target refusal", () =>
  Effect.gen(function* () {
    const reads = yield* Ref.make(0)
    const inactive = ExecutorGuidanceSelection.cases.Refused.make({ reason: "AttemptInactive" })
    const pending = yield* awaitQualificationGuidanceSelection(
      Ref.updateAndGet(reads, (count) => count + 1).pipe(Effect.map((count) => (count === 1 ? unknown : inactive))),
      unreadable
    ).pipe(Effect.forkChild)
    yield* TestClock.adjust("100 millis")
    expect(yield* Fiber.join(pending)).toEqual(inactive)
    expect(yield* Ref.get(reads)).toBe(2)
  })
)

it.effect("native qualification retains unreadable custody after five readiness reads", () =>
  Effect.gen(function* () {
    const reads = yield* Ref.make(0)
    const pending = yield* awaitQualificationGuidanceSelection(
      Ref.update(reads, (count) => count + 1).pipe(Effect.as(unknown)),
      unreadable
    ).pipe(Effect.forkChild)
    yield* TestClock.adjust("1 second")
    expect(yield* Fiber.join(pending)).toEqual(unknown)
    expect(yield* Ref.get(reads)).toBe(5)
  })
)

it.effect("native qualification never waits away contradictory custody", () =>
  Effect.gen(function* () {
    const reads = yield* Ref.make(0)
    expect(
      yield* awaitQualificationGuidanceSelection(
        Ref.update(reads, (count) => count + 1).pipe(Effect.as(unknown)),
        Effect.succeed("Contradictory/thread=active")
      )
    ).toEqual(unknown)
    expect(yield* Ref.get(reads)).toBe(1)
  })
)

it.effect("native qualification bounds a stalled readiness read without granting custody", () =>
  Effect.gen(function* () {
    const pending = yield* awaitQualificationGuidanceSelection(Effect.never, unreadable).pipe(Effect.forkChild)
    yield* TestClock.adjust("1 second")
    expect(yield* Fiber.join(pending)).toEqual(unknown)
  })
)
