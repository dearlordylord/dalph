/* eslint-disable import/no-nodejs-modules -- The source-boundary test reads its neighboring module. */
import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { PlannedAttemptExecutor, RunId, TaskId } from "@dalph/contracts"
import { Effect, Layer, Ref, Stream } from "effect"
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
import { JournaledRunBootstrap, runWorkflow } from "./run.js"
import { runControlledWorkflow } from "./controlled-workflow.js"

const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
const programDependencies = Layer.mergeAll(
  Layer.mock(OperationIdAllocator, {}),
  Layer.mock(PlannedTaskAttemptPlanner, {}),
  Layer.mock(TaskClaimAcquisitionPlanner, {})
)

it.effect("hands every Run activation to one journal establishment boundary", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("ordinary-delivery-fresh")
    const runId = yield* freshWorkflowRunId(target)
    const seen: Array<unknown> = []
    const finality = RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
    const bootstrap = JournaledRunBootstrap.of({
      activate: (receivedTarget, receivedPolicy, receivedRunId, program) => {
        seen.push(receivedTarget, receivedPolicy, receivedRunId, program)
        return Effect.succeed(finality)
      },
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
      },
      readRunReactivationControl: () => Effect.succeed("RunUnpaused" as const),
      registerAcceptedRunReactivationObservers: () => Effect.void
    })

    expect(
      yield* runWorkflow(target, Effect.succeed(policy), runId).pipe(
        Effect.provideService(JournaledRunBootstrap, bootstrap),
        Effect.provide(programDependencies)
      )
    ).toBe(finality)
    expect(seen.slice(0, 3)).toEqual([target, expect.anything(), runId])
    expect(Effect.isEffect(seen[1])).toBe(true)
    expect(seen[3]).toBeDefined()
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("lets the public controlled workflow terminate from its settled current graph", () =>
  Effect.gen(function* () {
    const projected = projectTrackerSnapshot({
      revision: "controlled-settled",
      rootTaskId: TaskId.make("controlled-settled-root"),
      tasks: [
        {
          id: TaskId.make("controlled-settled-root"),
          lifecycle: { _tag: "CompletedSuccessfully" },
          parentTaskId: null,
          prerequisiteIds: []
        }
      ]
    })
    if (projected._tag === "Invalid") return yield* Effect.die("the controlled root graph must be valid")
    const target = FixtureTarget.make("controlled-settled-target")
    const operationOrdinal = yield* Ref.make(0)
    const finality = yield* runControlledWorkflow(target, policy, RunId.make("controlled-settled-run")).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(
            OperationIdAllocator,
            OperationIdAllocator.of({
              allocate: () =>
                Ref.updateAndGet(operationOrdinal, (ordinal) => ordinal + 1).pipe(
                  Effect.map((ordinal) => OperationId.make(`controlled-graph-read:${ordinal}`))
                )
            })
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

it("contains one ordinary delivery runtime connection and no former scheduler", () => {
  const source = readFileSync(fileURLToPath(new URL("./run.ts", import.meta.url)), "utf8")

  expect(source.match(/\byield\* delivery\b/g)).toHaveLength(1)
  expect(source.match(/\brunStabilizedDelivery\(/g)).toHaveLength(1)
  expect(source).not.toMatch(/runRecoveredWorkflow|bootstrap\.(?:fresh|recovered)/)
  expect(source).not.toMatch(
    /runDeliveryActivation|readDeliveryActivationTurn|checkedTurn|makeActivationCoordinator|runFreshWorkflowStep|deriveFreshWorkflowDecisions/
  )
})

it("uses one exact-history projection for newly begun and reconstructed finality", () => {
  const source = readFileSync(fileURLToPath(new URL("./recovery-activation.ts", import.meta.url)), "utf8")

  expect(source).toContain('_tag: "AuthoritativeRunRecoveryProjection"')
  expect(source).not.toMatch(/JournaledFreshRunProjection|journaledFreshFrontier|makeJournaledFresh/)
})

it("ordinary Run activation reconstructs bounded cleanup responsibilities from its journal", () => {
  const source = readFileSync(fileURLToPath(new URL("./startup-recovery.ts", import.meta.url)), "utf8")

  expect(source).toContain("makeDispositionCleanupActivation(runId)")
  expect(source).toContain("DispositionCleanupActivation")
  expect(source).not.toContain("proposals")
})
