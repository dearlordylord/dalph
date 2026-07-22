import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import {
  ClaimOwner,
  CliUsageError,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  dryRunWorkflowInterpreterLayer,
  GitCommitSha,
  runCli,
  RunId,
  TaskExecutorLocator,
  TaskWorkSessionLocator,
  TraceOutput,
  TraceOutputError,
  trackerGraphReaderFileLayer,
  workflowTraceOutputLayer,
  WorktreeLocator
} from "./index.js"

const fixture = (name: "empty" | "singleton") => new URL(`../fixtures/${name}.json`, import.meta.url).pathname

const plannerLayer = deterministicPlannedTaskAttemptLayer({
  baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
  executor: TaskExecutorLocator.make("executor:cli-test"),
  runId: RunId.make("cli-test"),
  sessionRoot: TaskWorkSessionLocator.make("session:cli-test"),
  worktreeRoot: WorktreeLocator.make("/tmp/dalph-cli-test")
})
const claimPlannerLayer = deterministicTaskClaimAcquisitionPlannerLayer({
  owner: ClaimOwner.make("cli-test"),
  tokenPrefix: "cli-test-claim"
})

const runArguments = (
  args: ReadonlyArray<string>,
  outputLayer: Layer.Layer<TraceOutput>
) =>
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

it.effect("runs the dry CLI through the task-work session workflow", () =>
  Effect.gen(function*() {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    yield* runWithOutput(
      fixture("singleton"),
      Layer.succeed(
        TraceOutput,
        TraceOutput.of({
          writeLine: (line) => Ref.update(lines, (current) => [...current, line])
        })
      )
    )

    expect((yield* Ref.get(lines)).map((line) => JSON.parse(line)._tag)).toEqual([
      "OperationSelected",
      "TrackerGraphOutcomeObserved",
      "OperationSelected",
      "TrackerGraphOutcomeObserved",
      "OperationSelected",
      "TaskClaimAcquisitionIntended",
      "OperationSelected",
      "TaskAttemptPlanRecordingSimulated",
      "OperationSelected",
      "TaskWorktreeReconciliationSimulated",
      "OperationSelected",
      "TaskWorkSessionEstablishmentSimulated",
      "OperationSelected",
      "TaskExecutionAdmitted",
      "TaskExecutionSimulated",
      "OperationSelected",
      "ImplementationEvidenceSealingSimulated",
      "OperationSelected",
      "ImplementationReviewSimulated",
      "OperationSelected",
      "ImplementationConvergenceSimulated"
    ])
  }))

it.effect("requires the dry flag before running any workflow", () =>
  Effect.gen(function*() {
    const failure = yield* runArguments(
      ["run", fixture("empty")],
      Layer.succeed(
        TraceOutput,
        TraceOutput.of({ writeLine: () => Effect.void })
      )
    ).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(CliUsageError)
  }))

it.effect("propagates typed trace output failures", () =>
  Effect.gen(function*() {
    const failure = new TraceOutputError({ detail: "write failed" })
    const observed = yield* runWithOutput(
      fixture("empty"),
      Layer.succeed(
        TraceOutput,
        TraceOutput.of({ writeLine: () => Effect.fail(failure) })
      )
    ).pipe(Effect.flip)
    expect(observed).toBe(failure)
  }))
