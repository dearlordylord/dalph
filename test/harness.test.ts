import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"

it.effect("executes tests through the Effect runtime", () =>
  Effect.sync(() => {
    expect(Effect.isEffect(Effect.succeed(undefined))).toBe(true)
  }))
