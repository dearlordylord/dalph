import { TraceOutput, TraceOutputError } from "@dalph/orchestrator"
import { Effect, Layer, Stdio, Stream } from "effect"

export const traceOutputStdioLayer = Layer.effect(
  TraceOutput,
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio
    return TraceOutput.of({
      writeLine: (line) =>
        Stream.make(`${line}\n`).pipe(
          Stream.run(stdio.stdout()),
          Effect.mapError((cause) => new TraceOutputError({ detail: String(cause) }))
        )
    })
  })
)
