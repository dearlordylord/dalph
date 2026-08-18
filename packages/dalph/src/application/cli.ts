import { Effect, Layer, Schema } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { RunId } from "@dalph/contracts"
import {
  defaultTaskWorkCapacity,
  FixtureTarget,
  GithubIssueTarget,
  InitialControlPolicy,
  type IntegratorBoundaryUnavailable,
  makeCompleteTaskTrackerFactsObserved,
  makeTrackerGraphObservationOperation,
  OperationSelected,
  OperationIdAllocator,
  TaskTrackerFactsObservedTrace,
  TrackerGraphReader,
  type TrackerTarget,
  WorkflowTrace,
  runControlledWorkflow
} from "@dalph/orchestrator"
import {
  dryRunOperationIdAllocatorLayer,
  dryRunPlannedTaskAttemptLayer,
  dryRunTaskClaimPlannerLayer,
  dryRunWorkflowInterpreterLayer
} from "./composition.js"

export class CliUsageError extends Schema.TaggedError<CliUsageError>()("Cli.CliUsageError", {
  usage: Schema.String,
  detail: Schema.String
}) {}

/** Explains the required credential when a live GitHub target cannot start. */
export class GithubTokenRequiredError extends Schema.TaggedError<GithubTokenRequiredError>()(
  "Cli.GithubTokenRequired",
  { detail: Schema.String, variable: Schema.Literal("GITHUB_TOKEN") }
) {}

export const githubTokenRequirementDetail = "GitHub issue targets require the GITHUB_TOKEN environment variable"

const cliUsage = "dalph run <target> --dry"

const githubTargetSyntax =
  /^(?:github|github-issue):(?<owner>[^/\s#]+)\/(?<repository>[^/\s#]+)(?:#|\/issues\/)(?<issueNumber>[1-9][0-9]*)$/
const githubTargetUrlSyntax =
  /^https:\/\/github\.com\/(?<owner>[^/\s#]+)\/(?<repository>[^/\s#]+)\/issues\/(?<issueNumber>[1-9][0-9]*)$/
const githubTargetUriSyntax =
  /^github:\/\/(?<owner>[^/\s#]+)\/(?<repository>[^/\s#]+)\/issues\/(?<issueNumber>[1-9][0-9]*)$/

const issueTargetFromMatch = (match: RegExpMatchArray) =>
  Schema.decodeUnknownEffect(GithubIssueTarget)({
    _tag: "GithubIssue",
    issueNumber: Number(match.groups?.["issueNumber"]),
    owner: match.groups?.["owner"],
    repository: match.groups?.["repository"]
  }).pipe(
    Effect.mapError(
      (cause) => new CliUsageError({ detail: `invalid GitHub issue target: ${String(cause)}`, usage: cliUsage })
    )
  )

/** Decodes one CLI target; unmarked strings remain fixture locators. */
export const decodeCliTarget = Effect.fn("Cli.decodeTarget")(function* (input: string) {
  const githubMatch =
    input.match(githubTargetSyntax) ?? input.match(githubTargetUrlSyntax) ?? input.match(githubTargetUriSyntax)
  if (githubMatch !== null) return yield* issueTargetFromMatch(githubMatch)
  if (input.startsWith("github:") || input.startsWith("github-issue:") || input.startsWith("https://github.com/")) {
    return yield* new CliUsageError({
      detail: "expected github:OWNER/REPOSITORY#ISSUE (or the equivalent GitHub issue URL)",
      usage: cliUsage
    })
  }
  return yield* Schema.decodeUnknownEffect(FixtureTarget)(input).pipe(
    Effect.mapError(
      (cause) => new CliUsageError({ detail: `invalid fixture target: ${String(cause)}`, usage: cliUsage })
    )
  )
})

const executeGithubDryRun = Effect.fn("Cli.executeGithubDryRun")(function* (target: GithubIssueTarget) {
  const reader = yield* TrackerGraphReader
  const allocator = yield* OperationIdAllocator
  const trace = yield* WorkflowTrace
  const operation = makeTrackerGraphObservationOperation(yield* allocator.allocate(), target)
  yield* trace.emit(OperationSelected.make({ operation }))
  const snapshot = yield* reader
    .read(target)
    .pipe(
      Effect.mapError((failure) =>
        failure._tag === "TrackerGraphReader.AdapterReadError" && failure.detail === githubTokenRequirementDetail
          ? new GithubTokenRequiredError({ detail: failure.detail, variable: "GITHUB_TOKEN" })
          : failure
      )
    )
  yield* trace.emit(
    TaskTrackerFactsObservedTrace.make({
      observation: makeCompleteTaskTrackerFactsObserved(operation, snapshot),
      operation
    })
  )
})

const executeFixtureDryRun = Effect.fn("Cli.executeFixtureDryRun")(function* (target: FixtureTarget) {
  yield* runControlledWorkflow(
    target,
    InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity }),
    RunId.make("dry-run")
  ).pipe(
    // Fixture simulation owns its controlled mutation capability locally. The
    // CLI composition therefore never installs TrackerMutation for GitHub reads.
    Effect.provide(
      Layer.mergeAll(
        dryRunWorkflowInterpreterLayer,
        dryRunOperationIdAllocatorLayer,
        dryRunTaskClaimPlannerLayer,
        dryRunPlannedTaskAttemptLayer
      )
    )
  )
})

const executeDryRun = Effect.fn("Cli.executeDryRun")(function* (target: TrackerTarget) {
  if (typeof target !== "string") return yield* executeGithubDryRun(target)
  yield* executeFixtureDryRun(target)
})

const runCommand = Command.make(
  "run",
  {
    target: Argument.string("target").pipe(
      Argument.withDescription("Fixture locator or github:OWNER/REPOSITORY#ISSUE; GitHub targets require GITHUB_TOKEN.")
    ),
    dry: Flag.boolean("dry")
  },
  ({ dry, target: rawTarget }) =>
    Effect.gen(function* () {
      if (!dry) {
        return yield* new CliUsageError({ usage: cliUsage, detail: "the --dry flag is required" })
      }
      const target = yield* decodeCliTarget(rawTarget)
      yield* executeDryRun(target)
    })
)

const dalphCommand = Command.make("dalph").pipe(Command.withSubcommands([runCommand]))

const commandConfiguration = { version: "0.0.0" }

const runCliCommand = Command.runWith(dalphCommand, commandConfiguration)

export const runCli = (input: ReadonlyArray<string>) =>
  runCliCommand(input).pipe(
    Effect.catchTag("IntegratorBoundaryUnavailable", (failure: IntegratorBoundaryUnavailable) => Effect.fail(failure))
  )

export const runCliFromStdio = Command.run(dalphCommand, commandConfiguration).pipe(
  Effect.catchTag("IntegratorBoundaryUnavailable", (failure: IntegratorBoundaryUnavailable) => Effect.fail(failure))
)
