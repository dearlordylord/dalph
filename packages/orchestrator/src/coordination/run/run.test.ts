/* eslint-disable import/no-nodejs-modules -- The source-boundary test reads its neighboring module. */
import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { PlannedAttemptExecutor, RunId } from "@dalph/contracts"
import { Effect, Layer } from "effect"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { OperationId } from "../../workflow/identity.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { RunFinalityDecision } from "../frontier/frontier.js"
import { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { freshWorkflowRunId } from "./fresh-run-identity.js"
import { JournaledRunBootstrap, runRecoveredWorkflow, runSyntheticWorkflowWithBootstrap, runWorkflow } from "./run.js"
import { runSyntheticWorkflow } from "./synthetic-workflow.js"

const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
const programDependencies = Layer.mergeAll(
  Layer.mock(OperationIdAllocator, {}),
  Layer.mock(PlannedTaskAttemptPlanner, {}),
  Layer.mock(TaskClaimAcquisitionPlanner, {})
)

it.effect("hands a fresh Run to the journal bootstrap with the exact identity and flat-delivery program", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("flat-delivery-fresh")
    const runId = yield* freshWorkflowRunId(target)
    const seen: Array<unknown> = []
    const finality = RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
    const bootstrap = JournaledRunBootstrap.of({
      fresh: (receivedTarget, receivedPolicy, receivedRunId, program) => {
        seen.push(receivedTarget, receivedPolicy, receivedRunId, program)
        return Effect.succeed(finality)
      },
      operatorControl: {
        applyControlDirection: () => Effect.die("unused"),
        applyTaskClaimReacquisition: () => Effect.die("unused"),
        readTaskWorkCapacity: () => Effect.die("unused"),
        setTaskWorkCapacity: () => Effect.die("unused")
      },
      recovered: () => Effect.die("unused"),
      synthetic: () => Effect.die("unused")
    })

    expect(
      yield* runWorkflow(target, policy, runId).pipe(
        Effect.provideService(JournaledRunBootstrap, bootstrap),
        Effect.provide(programDependencies)
      )
    ).toBe(finality)
    expect(seen.slice(0, 3)).toEqual([target, policy, runId])
    expect(seen[3]).toBeDefined()
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("hands recovered execution to the same journal bootstrap boundary", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("flat-delivery-recovered")
    const finality = RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
    let calls = 0
    const bootstrap = JournaledRunBootstrap.of({
      fresh: () => Effect.die("unused"),
      operatorControl: {
        applyControlDirection: () => Effect.die("unused"),
        applyTaskClaimReacquisition: () => Effect.die("unused"),
        readTaskWorkCapacity: () => Effect.die("unused"),
        setTaskWorkCapacity: () => Effect.die("unused")
      },
      recovered: (receivedTarget, program) => {
        calls += 1
        expect(receivedTarget).toBe(target)
        expect(program).toBeDefined()
        return Effect.succeed(finality)
      },
      synthetic: () => Effect.die("unused")
    })

    expect(
      yield* runRecoveredWorkflow(target).pipe(
        Effect.provideService(JournaledRunBootstrap, bootstrap),
        Effect.provide(programDependencies)
      )
    ).toBe(finality)
    expect(calls).toBe(1)
  })
)

it.effect("hands synthetic execution to the flat runtime through the explicit non-durable bootstrap route", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("flat-delivery-synthetic")
    const runId = RunId.make("flat-delivery-synthetic-run")
    const finality = RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
    let calls = 0
    const bootstrap = JournaledRunBootstrap.of({
      fresh: () => Effect.die("unused"),
      operatorControl: {
        applyControlDirection: () => Effect.die("unused"),
        applyTaskClaimReacquisition: () => Effect.die("unused"),
        readTaskWorkCapacity: () => Effect.die("unused"),
        setTaskWorkCapacity: () => Effect.die("unused")
      },
      recovered: () => Effect.die("unused"),
      synthetic: (receivedTarget, receivedPolicy, receivedRunId, program) => {
        calls += 1
        expect([receivedTarget, receivedPolicy, receivedRunId]).toEqual([target, policy, runId])
        expect(program).toBeDefined()
        return Effect.succeed(finality)
      }
    })

    expect(
      yield* runSyntheticWorkflowWithBootstrap(target, policy, runId).pipe(
        Effect.provideService(JournaledRunBootstrap, bootstrap),
        Effect.provide(programDependencies)
      )
    ).toBe(finality)
    expect(calls).toBe(1)
  })
)

it.effect("lets the public synthetic workflow terminate from its settled current graph", () =>
  Effect.gen(function* () {
    const projected = projectTrackerSnapshot({ revision: "synthetic-settled", tasks: [] })
    if (projected._tag === "Invalid") return yield* Effect.die("the empty synthetic graph must be valid")
    const target = FixtureTarget.make("synthetic-settled-target")
    const finality = yield* runSyntheticWorkflow(target, policy, RunId.make("synthetic-settled-run")).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(
            OperationIdAllocator,
            OperationIdAllocator.of({ allocate: () => Effect.succeed(OperationId.make("synthetic-graph-read")) })
          ),
          Layer.mock(PlannedTaskAttemptPlanner, {}),
          Layer.mock(TaskClaimAcquisitionPlanner, {}),
          Layer.mock(WorkflowInterpreter, { readTrackerGraph: () => Effect.succeed(projected.snapshot) }),
          Layer.mock(PlannedAttemptExecutor, {}),
          Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
        )
      )
    )

    expect(finality).toEqual({ _tag: "RunMayTerminate" })
  })
)

it("contains one literal flat-delivery runtime connection and no former scheduler", () => {
  const source = readFileSync(fileURLToPath(new URL("./run.ts", import.meta.url)), "utf8")

  expect(source.match(/\bdelivery\.pipe\(/g)).toHaveLength(1)
  expect(source.match(/\brunDeliveryRuntime\(/g)).toHaveLength(1)
  expect(source).not.toMatch(
    /runDeliveryActivation|readDeliveryActivationTurn|checkedTurn|makeActivationCoordinator|runFreshWorkflowStep|deriveFreshWorkflowDecisions/
  )
})
