import { it } from "@effect/vitest"
import { Clock, Duration, Effect, Schema } from "effect"
import { describe, expect } from "vitest"
import { operationDeadline, RemoteOperationDeadline } from "./direct-publication-command.js"

describe("remote Git operation deadline", () => {
  it.effect("constructs an absolute deadline from the monotonic clock", () =>
    Effect.gen(function* () {
      const startedAt = yield* Clock.monotonicTimeNanos
      const deadline = yield* operationDeadline(Duration.seconds(30))

      expect(deadline - startedAt).toBe(30_000_000_000n)
    })
  )

  it("accepts only nonnegative monotonic nanosecond positions at the type boundary", () => {
    expect(Schema.decodeUnknownSync(RemoteOperationDeadline)(0n)).toBe(0n)
    expect(() => Schema.decodeUnknownSync(RemoteOperationDeadline)(-1n)).toThrow()
    expect(() => Schema.decodeUnknownSync(RemoteOperationDeadline)(0)).toThrow()
  })
})
