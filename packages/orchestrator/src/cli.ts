import { Effect, Schema } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { FixtureTarget, TaskExecutionCapacity } from "./domain.js"
import { TraceOutput } from "./trace-output.js"
import { encodeTraceItem, runWorkflow } from "./workflow.js"

export class CliUsageError extends Schema.TaggedErrorClass<CliUsageError>()(
  "Cli.CliUsageError",
  { usage: Schema.String, detail: Schema.String }
) {}

const defaultTaskExecutionCapacityValue = 2
const defaultTaskExecutionCapacity = TaskExecutionCapacity.make(
  defaultTaskExecutionCapacityValue
)

const executeDryRun = Effect.fn("Cli.executeDryRun")(function*(
  target: FixtureTarget
) {
  const output = yield* TraceOutput
  const trace = yield* runWorkflow(target, defaultTaskExecutionCapacity)

  for (const item of trace) {
    yield* output.writeLine(encodeTraceItem(item))
  }
})

const runCommand = Command.make(
  "run",
  {
    target: Argument.string("fixture-target").pipe(
      Argument.withSchema(FixtureTarget)
    ),
    dry: Flag.boolean("dry")
  },
  ({ dry, target }) =>
    Effect.gen(function*() {
      if (!dry) {
        return yield* new CliUsageError({
          usage: "dalph run <fixture-target> --dry",
          detail: "the --dry flag is required"
        })
      }
      yield* executeDryRun(target)
    })
)

const dalphCommand = Command.make("dalph").pipe(
  Command.withSubcommands([runCommand])
)

const commandConfiguration = { version: "0.0.0" }

export const runCli = Command.runWith(dalphCommand, commandConfiguration)

export const runCliFromStdio = Command.run(
  dalphCommand,
  commandConfiguration
)
