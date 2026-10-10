import { TraceOutput, TraceOutputError } from "@dalph/orchestrator"
import { Context, Effect, Layer, Option, Stdio, Stream } from "effect"

/** Node's accepted-write completion is distinct from the sink's backpressure wait. */
export class TraceOutputDelivery extends Context.Service<
  TraceOutputDelivery,
  { readonly settle: Effect.Effect<void, TraceOutputError> }
>()("dalph/TraceOutputDelivery") {}

export const traceOutputStdioLayer = Layer.effect(
  TraceOutput,
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio
    return TraceOutput.of({
      writeLine: (line) =>
        Stream.make(`${line}\n`).pipe(
          Stream.run(stdio.stdout()),
          Effect.mapError((cause) => new TraceOutputError({ detail: String(cause) })),
          Effect.andThen(
            Effect.serviceOption(TraceOutputDelivery).pipe(
              Effect.flatMap((delivery) => (Option.isSome(delivery) ? delivery.value.settle : Effect.void))
            )
          )
        )
    })
  })
)
