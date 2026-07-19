import { Context, Effect, Layer, Schema, Stdio, Stream } from "effect"

export class TraceOutputError extends Schema.TaggedErrorClass<TraceOutputError>()(
  "TraceOutput.TraceOutputError",
  { detail: Schema.String }
) {}

interface TraceOutputService {
  readonly writeLine: (
    line: string
  ) => Effect.Effect<void, TraceOutputError>
}

export class TraceOutput extends Context.Service<TraceOutput, TraceOutputService>()(
  "@dalph/TraceOutput"
) {}

export const traceOutputStdioLayer = Layer.effect(
  TraceOutput,
  Effect.gen(function*() {
    const stdio = yield* Stdio.Stdio
    return TraceOutput.of({
      writeLine: (line) =>
        Stream.make(`${line}\n`).pipe(
          Stream.run(stdio.stdout()),
          Effect.mapError(
            (cause) => new TraceOutputError({ detail: String(cause) })
          )
        )
    })
  })
)
