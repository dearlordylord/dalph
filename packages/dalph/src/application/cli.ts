import { Effect, Schema } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { RunId } from "@dalph/contracts"
import {
  defaultTaskWorkCapacity,
  FixtureTarget,
  InitialControlPolicy,
  JournalPosition,
  runSyntheticWorkflow
} from "@dalph/orchestrator"
import type { OperationId, TaskDagSnapshot } from "@dalph/orchestrator"

export class CliUsageError extends Schema.TaggedErrorClass<CliUsageError>()("Cli.CliUsageError", {
  usage: Schema.String,
  detail: Schema.String
}) {}

const dryRunObservationOf = (operationId: OperationId, snapshot: TaskDagSnapshot) => ({
  _tag: "AcceptedTrackerGraphObservation" as const,
  snapshot,
  operationId,
  contentIdentity: snapshot.revision,
  acceptedAt: JournalPosition.make(1),
  freshness: { _tag: "ObservedDuringLogicalRead" as const, operationId }
})

const executeDryRun = Effect.fn("Cli.executeDryRun")(function* (target: FixtureTarget) {
  yield* runSyntheticWorkflow(
    target,
    InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity }),
    RunId.make("dry-run"),
    dryRunObservationOf
  )
})

const runCommand = Command.make(
  "run",
  { target: Argument.string("fixture-target").pipe(Argument.withSchema(FixtureTarget)), dry: Flag.boolean("dry") },
  ({ dry, target }) =>
    Effect.gen(function* () {
      if (!dry) {
        return yield* new CliUsageError({
          usage: "dalph run <fixture-target> --dry",
          detail: "the --dry flag is required"
        })
      }
      yield* executeDryRun(target)
    })
)

const dalphCommand = Command.make("dalph").pipe(Command.withSubcommands([runCommand]))

const commandConfiguration = { version: "0.0.0" }

export const runCli = Command.runWith(dalphCommand, commandConfiguration)

export const runCliFromStdio = Command.run(dalphCommand, commandConfiguration)
