import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { observerJsonBytes, observerRetentionLimits, observerStructuralBytes } from "./running-host-observer-budget.js"

it.effect("JSON admission counts escaping and UTF-8 exactly before allocating encoded output", () =>
  Effect.gen(function* () {
    for (const value of [
      null,
      true,
      9,
      [],
      {},
      { text: '"\\\n\u0000é中😀\ud800\udc00\ud800', values: [null, false, 1] }
    ]) {
      const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
      expect(yield* observerJsonBytes(value, bytes)).toBe(bytes)
      expect(yield* observerJsonBytes(value, bytes - 1).pipe(Effect.flip)).toMatchObject({ _tag: "FrameTooLarge" })
    }
    const oversized = "x".repeat(32 * 1024 * 1024)
    expect(yield* observerJsonBytes(oversized, 2097152).pipe(Effect.flip)).toMatchObject({
      _tag: "FrameTooLarge",
      maximumBytes: 2097152
    })
    expect(
      yield* observerStructuralBytes(oversized, observerRetentionLimits.preparationBytes, "Preparation").pipe(
        Effect.flip
      )
    ).toEqual({ _tag: "ObserverRetentionExceeded", boundary: "Preparation", maximumBytes: 16777216 })
  })
)

it.effect("Preparation admission charges shared occurrences and native collections without copying them", () =>
  Effect.gen(function* () {
    const shared = { text: "abc" }
    const bytes = yield* observerStructuralBytes(shared, 1024, "Preparation")
    expect(yield* observerStructuralBytes(new Set([shared]), 1024, "Preparation")).toBe(64 + bytes)
    expect(yield* observerStructuralBytes(new Map([[shared, shared]]), 1024, "Preparation")).toBe(64 + 2 * bytes)
    expect(yield* observerStructuralBytes(shared, bytes, "Preparation")).toBe(bytes)
    expect(yield* observerStructuralBytes(shared, bytes - 1, "Preparation").pipe(Effect.flip)).toMatchObject({
      _tag: "ObserverRetentionExceeded"
    })
    const cycle = new Map<unknown, unknown>()
    cycle.set("self", cycle)
    expect(yield* observerStructuralBytes(cycle, 1024, "Preparation").pipe(Effect.flip)).toMatchObject({
      _tag: "ObserverRetentionExceeded"
    })
  })
)
