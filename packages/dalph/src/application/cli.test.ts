import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { GitCommitSha, RunId, TaskExecutorLocator, TaskId, WorktreeLocator } from "@dalph/contracts"
import {
  ApplicationExitShell,
  ClaimOwner,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  defaultTaskWorkCapacity,
  GithubIssueNumber,
  GithubIssueTarget,
  GithubRepositoryName,
  GithubRepositoryOwner,
  InitialControlPolicy,
  JournaledRunBootstrap,
  PlannedTaskAttemptPlanner,
  projectTrackerSnapshot,
  RunFinalityDecision,
  RunReactivationOwner,
  TaskClaimAcquisitionPlanner,
  TraceOutput,
  TraceOutputError,
  TrackerGraphReader,
  trackerGraphReaderFileLayer
} from "@dalph/orchestrator"
import { Console, Deferred, Effect, Layer, Option, Ref, Stdio, Stream } from "effect"
import { expect } from "vitest"
import {
  CliUsageError,
  dryRunWorkflowInterpreterLayer,
  dryCliEnvironmentLayer,
  makeConfiguredProductionCliApplication,
  productionRunReactivationLayer,
  runCli,
  workflowTraceOutputLayer
} from "../index.js"

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

it.effect("routes the configured production CLI command into its host-owned application boundary", () =>
  Effect.gen(function* () {
    const activations = yield* Ref.make(0)
    const started = yield* Deferred.make<void>()
    const application = makeConfiguredProductionCliApplication((target) =>
      Effect.gen(function* () {
        const bootstrap = JournaledRunBootstrap.of({
          activate: () =>
            Ref.updateAndGet(activations, (count) => count + 1).pipe(
              Effect.tap((count) => (count === 1 ? Deferred.succeed(started, undefined) : Effect.void)),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
            ),
          readRunReactivationControl: () => Effect.succeed("RunUnpaused" as const),
          activateActiveWorkAuthorityRefresh: () => Effect.die("unused"),
          registerAcceptedRunReactivationObservers: () => Effect.void,
          operatorControl: {
            applyRunCancellation: () => Effect.die("unused"),
            applyIntegrationQuarantineDirection: () => Effect.die("unused"),
            applyAttemptChoice: () => Effect.die("unused"),
            applyControlDirection: () => Effect.die("unused"),
            applyTaskClaimReacquisition: () => Effect.die("unused"),
            readAttemptChoice: () => Effect.die("unused"),
            readIntegrationQuarantineDirection: () => Effect.die("unused"),
            readTaskWorkCapacity: () => Effect.die("unused"),
            observePause: () => Stream.empty,
            setTaskWorkCapacity: () => Effect.die("unused")
          }
        })
        const applicationExit = ApplicationExitShell.of({
          admission: {
            prepareForwardOwner: () => Effect.succeed({ cancel: Effect.void, register: Effect.die("unused") }),
            acquireForwardOwner: () => Effect.die("unused"),
            snapshot: Effect.succeed({ cutoffClosed: false, preparingOwnerCount: 0, registeredOwnerCount: 0 })
          },
          awaitExitRequested: Effect.never,
          awaitExecutorDrains: Effect.void,
          registerExecutorDrain: () => Effect.void,
          registerProcessLocalDrain: () => Effect.void,
          requestBoundary: { requestExit: Effect.never }
        })
        const productionLayer = productionRunReactivationLayer(
          target,
          Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity })),
          RunId.make("configured-cli-production-run"),
          { onFailure: () => Effect.void }
        ).pipe(
          Layer.provide(Layer.succeed(JournaledRunBootstrap, bootstrap)),
          Layer.provide(Layer.succeed(ApplicationExitShell, applicationExit)),
          Layer.provide(Layer.mock(PlannedTaskAttemptPlanner, {})),
          Layer.provide(Layer.mock(TaskClaimAcquisitionPlanner, {}))
        )
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* RunReactivationOwner
            yield* Deferred.await(started)
          }).pipe(Effect.provide(productionLayer))
        )
      })
    )
    yield* application.pipe(
      Effect.provide(Stdio.layerTest({ args: Effect.succeed(["run", fixture("empty")]) })),
      Effect.provide(dryCliEnvironmentLayer)
    )
    expect(yield* Ref.get(activations)).toBe(1)
  })
)
