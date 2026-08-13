import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { GitCommitSha, RunId, TaskExecutorLocator, TaskId, WorktreeLocator } from "@dalph/contracts"
import {
  ClaimOwner,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  GithubIssueNumber,
  GithubIssueTarget,
  GithubRepositoryName,
  GithubRepositoryOwner,
  projectTrackerSnapshot,
  TraceOutput,
  TraceOutputError,
  TrackerGraphReader,
  trackerGraphReaderFileLayer
} from "@dalph/orchestrator"
import { Console, Effect, Layer, Option, Ref } from "effect"
import { expect } from "vitest"
import { CliUsageError, dryRunWorkflowInterpreterLayer, runCli, workflowTraceOutputLayer } from "../index.js"

const fixture = (name: "empty" | "singleton") =>
  new URL(`../../../orchestrator/fixtures/${name}.json`, import.meta.url).pathname

const plannerLayer = deterministicPlannedTaskAttemptLayer({
  baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
  executor: TaskExecutorLocator.make("executor:cli-test"),
  runId: RunId.make("dry-run"),
  worktreeRoot: WorktreeLocator.make("/tmp/dalph-cli-test")
})
const claimPlannerLayer = deterministicTaskClaimAcquisitionPlannerLayer({
  owner: ClaimOwner.make("cli-test"),
  tokenPrefix: "cli-test-claim"
})

const runArguments = (args: ReadonlyArray<string>, outputLayer: Layer.Layer<TraceOutput>) =>
  runCli(args).pipe(
    Effect.provide(dryRunWorkflowInterpreterLayer),
    Effect.provide(workflowTraceOutputLayer),
    Effect.provide(outputLayer),
    Effect.provide(trackerGraphReaderFileLayer),
    Effect.provide(deterministicOperationIdAllocatorLayer("cli-test")),
    Effect.provide(plannerLayer),
    Effect.provide(claimPlannerLayer),
    Effect.provide(NodeServices.layer)
  )

const runWithOutput = (target: string, outputLayer: Layer.Layer<TraceOutput>) =>
  runArguments(["run", target, "--dry"], outputLayer)

const githubTarget = GithubIssueTarget.make({
  issueNumber: GithubIssueNumber.make(42),
  owner: GithubRepositoryOwner.make("octo"),
  repository: GithubRepositoryName.make("dalph")
})

const githubSnapshot = Option.getOrThrow(
  Option.fromUndefinedOr(
    (() => {
      const projection = projectTrackerSnapshot({
        revision: "github-cli-revision",
        tasks: [
          { id: TaskId.make("github-cli-root"), lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
        ]
      })
      return projection._tag === "Valid" ? projection.snapshot : undefined
    })()
  )
)

it.effect("runs the dry CLI through the planned-attempt workflow", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    yield* runWithOutput(
      fixture("singleton"),
      Layer.succeed(
        TraceOutput,
        TraceOutput.of({ writeLine: (line) => Ref.update(lines, (current) => [...current, line]) })
      )
    )

    expect((yield* Ref.get(lines)).map((line) => JSON.parse(line)._tag)).toEqual([
      "OperationSelected",
      "TaskTrackerFactsObserved",
      "OperationSelected",
      "TaskTrackerFactsObserved",
      "OperationSelected",
      "TaskClaimAcquisitionIntended",
      "TaskClaimAcquired",
      "OperationSelected",
      "TaskTrackerFactsObserved",
      "TrackerExecutionAdmitted",
      "OperationSelected",
      "OperationSelected",
      "TaskAttemptPlanAcknowledged",
      "OperationSelected",
      "TaskWorktreeReady",
      "OperationSelected",
      "TaskTrackerFactsObserved"
    ])
  })
)

it.effect("requires the dry flag before running any workflow", () =>
  Effect.gen(function* () {
    const failure = yield* runArguments(
      ["run", fixture("empty")],
      Layer.succeed(TraceOutput, TraceOutput.of({ writeLine: () => Effect.void }))
    ).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(CliUsageError)
  })
)

it.effect("advertises the GitHub token requirement in run help", () =>
  Effect.gen(function* () {
    const output: Array<string> = []
    const testConsole: Console.Console = Object.assign(Object.create(console), {
      error: (...args: ReadonlyArray<unknown>) => output.push(args.map(String).join(" ")),
      log: (...args: ReadonlyArray<unknown>) => output.push(args.map(String).join(" "))
    })
    yield* runArguments(
      ["run", "--help"],
      Layer.succeed(TraceOutput, TraceOutput.of({ writeLine: () => Effect.void }))
    ).pipe(Effect.provide(Layer.succeed(Console.Console, testConsole)))

    expect(output.join("\n")).toContain("GITHUB_TOKEN")
  })
)

it.effect("decodes a GitHub issue target once and reads it without tracker writes", () =>
  Effect.gen(function* () {
    const requestedTargets = yield* Ref.make<ReadonlyArray<unknown>>([])
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const readerLayer = Layer.succeed(
      TrackerGraphReader,
      TrackerGraphReader.of({
        read: Effect.fn("TrackerGraphReader.CliTest.read")(function* (target) {
          yield* Ref.update(requestedTargets, (current) => [...current, target])
          return githubSnapshot
        }),
        readTaskWorkSpecification: () => Effect.die("the GitHub dry run must not request focused task content")
      })
    )
    yield* runCli(["run", "github:octo/dalph#42", "--dry"]).pipe(
      Effect.provide(workflowTraceOutputLayer),
      Effect.provide(
        Layer.succeed(
          TraceOutput,
          TraceOutput.of({ writeLine: (line) => Ref.update(lines, (current) => [...current, line]) })
        )
      ),
      Effect.provide(readerLayer),
      Effect.provide(deterministicOperationIdAllocatorLayer("github-cli-test")),
      Effect.provide(NodeServices.layer)
    )

    expect(yield* Ref.get(requestedTargets)).toEqual([githubTarget])
    expect((yield* Ref.get(lines)).map((line) => JSON.parse(line)._tag)).toEqual([
      "OperationSelected",
      "TaskTrackerFactsObserved"
    ])
  })
)

it.effect("does not guess a fixture for a malformed GitHub target", () =>
  Effect.gen(function* () {
    const failure = yield* runArguments(
      ["run", "github:octo/dalph/not-an-issue", "--dry"],
      Layer.succeed(TraceOutput, TraceOutput.of({ writeLine: () => Effect.void }))
    ).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(CliUsageError)
  })
)

it.effect("propagates typed trace output failures", () =>
  Effect.gen(function* () {
    const failure = new TraceOutputError({ detail: "write failed" })
    const observed = yield* runWithOutput(
      fixture("empty"),
      Layer.succeed(TraceOutput, TraceOutput.of({ writeLine: () => Effect.fail(failure) }))
    ).pipe(Effect.flip)
    expect(observed).toBe(failure)
  })
)
