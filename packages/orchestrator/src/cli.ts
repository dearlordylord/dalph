import { Effect, Schema } from "effect"
import { FixtureTarget } from "./domain.js"
import { TraceOutput } from "./trace-output.js"
import { encodeTraceItem, runDryWorkflow } from "./workflow.js"

const DryRunArguments = Schema.Tuple([
  Schema.Literal("run"),
  FixtureTarget,
  Schema.Literal("--dry")
])

export class CliUsageError extends Schema.TaggedErrorClass<CliUsageError>()(
  "Cli.CliUsageError",
  { usage: Schema.String, detail: Schema.String }
) {}

const decodeArguments = (args: ReadonlyArray<string>) =>
  Schema.decodeUnknownEffect(DryRunArguments)(args).pipe(
    Effect.mapError(
      (cause) =>
        new CliUsageError({
          usage: "dalph run <fixture-target> --dry",
          detail: String(cause)
        })
    )
  )

export const runCli = Effect.fn("Cli.run")(function*(
  args: ReadonlyArray<string>
) {
  const [, target] = yield* decodeArguments(args)
  const output = yield* TraceOutput
  const trace = yield* runDryWorkflow(target)

  for (const item of trace) {
    yield* output.writeLine(encodeTraceItem(item))
  }
})
