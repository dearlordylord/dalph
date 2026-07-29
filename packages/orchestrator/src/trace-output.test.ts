import { it } from "@effect/vitest"
import { Effect, Sink, Stdio } from "effect"
import { expect } from "vitest"
import { TraceOutput, TraceOutputError, traceOutputStdioLayer } from "./trace-output.js"

it.effect("maps a standard-output write failure to the typed trace boundary", () =>
  Effect.gen(function* () {
    const output = yield* TraceOutput
    const failure = yield* output.writeLine("controlled trace").pipe(Effect.flip)
    expect(failure).toBeInstanceOf(TraceOutputError)
    expect(failure.detail).toContain("controlled stdout failure")
  }).pipe(
    Effect.provide(traceOutputStdioLayer),
    Effect.provide(Stdio.layerTest({ stdout: () => Sink.fail("controlled stdout failure" as never) }))
  )
)
