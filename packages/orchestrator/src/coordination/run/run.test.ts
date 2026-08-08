/* eslint-disable import/no-nodejs-modules -- The source-boundary test reads its neighboring module. */
import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  plannedAttemptExecutorCorrelation,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect, Layer, Option, Ref } from "effect"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { TaskClaimAcquisition } from "../../authorities/task-tracker/claim-mutation.js"
import { makeTaskWorkSpecification } from "../../authorities/task-tracker/task-work-specification.js"
import { InitialControlPolicy } from "../../control/policy.js"
import {
  TaskClaimAcquisitionSimulated,
  WorkflowInterpreter,
  WorkflowTrace
} from "../../workflow/interpretation/interpreter.js"
import { OperationId } from "../../workflow/identity.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { RunFinalityDecision } from "../frontier/frontier.js"
import { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { TaskAttemptPlanRecordingSimulated } from "../../workflow/protocols/task-attempt-planning/record.js"
import { TaskWorktreeReconciliationSimulated } from "../../workflow/protocols/worktree-reconciliation/protocol.js"
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
    const operationOrdinal = yield* Ref.make(0)
    const finality = yield* runSyntheticWorkflow(target, policy, RunId.make("synthetic-settled-run")).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(
            OperationIdAllocator,
            OperationIdAllocator.of({
              allocate: () =>
                Ref.updateAndGet(operationOrdinal, (ordinal) => ordinal + 1).pipe(
                  Effect.map((ordinal) => OperationId.make(`synthetic-graph-read:${ordinal}`))
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

it.effect("stops an always-Running synthetic workflow at the shared continuation limit", () =>
  Effect.gen(function* () {
    const runId = RunId.make("synthetic-running-limit-run")
    const target = FixtureTarget.make("synthetic-running-limit-target")
    const specification = makeTaskWorkSpecification({
      body: "Keep reporting Running.",
      taskId: TaskId.make("synthetic-running-task"),
      title: "Bound synthetic continuation"
    })
    const projected = projectTrackerSnapshot({
      revision: "synthetic-running-limit",
      tasks: [{ id: specification.taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
    })
    const snapshot = Option.getOrThrow(
      Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
    )
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("synthetic-running-attempt"),
      baseSha: GitCommitSha.make("1".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/synthetic-running-attempt"),
      executor: TaskExecutorLocator.make("executor:synthetic-running"),
      runId,
      taskId: specification.taskId,
      taskRevision: specification.fingerprint,
      worktree: WorktreeLocator.make("/worktrees/synthetic-running-attempt")
    })
    const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
    const executorCalls = yield* Ref.make(0)
    const operationIds = yield* Ref.make(0)
    const failure = yield* runSyntheticWorkflow(target, policy, runId).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(
            OperationIdAllocator,
            OperationIdAllocator.of({
              allocate: () =>
                Ref.getAndUpdate(operationIds, (ordinal) => ordinal + 1).pipe(
                  Effect.map((ordinal) => OperationId.make(`synthetic-running-operation-${ordinal}`))
                )
            })
          ),
          Layer.succeed(
            TaskClaimAcquisitionPlanner,
            TaskClaimAcquisitionPlanner.of({
              plan: (operationId, taskId) =>
                Effect.succeed(
                  TaskClaimAcquisition.make({
                    operationId,
                    owner: ClaimOwner.make("dalph"),
                    taskId,
                    token: ClaimToken.make("synthetic-running-token")
                  })
                )
            })
          ),
          Layer.succeed(
            PlannedTaskAttemptPlanner,
            PlannedTaskAttemptPlanner.of({ plan: () => Effect.succeed(plannedAttempt) })
          ),
          Layer.mock(WorkflowInterpreter, {
            acquireTaskClaim: (operation) => Effect.succeed(TaskClaimAcquisitionSimulated.make({ operation })),
            readTaskWorkSpecification: () => Effect.succeed(specification),
            readTrackerGraph: () => Effect.succeed(snapshot),
            reconcileTaskWorktree: (operation) =>
              Effect.succeed(TaskWorktreeReconciliationSimulated.make({ operation })),
            recordTaskAttemptPlan: (operation) => Effect.succeed(TaskAttemptPlanRecordingSimulated.make({ operation }))
          }),
          Layer.succeed(
            PlannedAttemptExecutor,
            PlannedAttemptExecutor.of({
              project: () => Effect.succeed(Option.none()),
              requestSuspension: () => Effect.die("synthetic workflow is not paused"),
              startOrContinue: () =>
                Ref.update(executorCalls, (calls) => calls + 1).pipe(
                  Effect.as(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
                )
            })
          ),
          Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
        )
      ),
      Effect.flip
    )

    expect(failure).toMatchObject({ _tag: "PlannedAttemptExecutorContinuationLimitReached", correlation, limit: 3 })
    expect(yield* Ref.get(executorCalls)).toBe(3)
  })
)

it("contains one literal flat-delivery runtime connection and no former scheduler", () => {
  const source = readFileSync(fileURLToPath(new URL("./run.ts", import.meta.url)), "utf8")

  expect(source.match(/\byield\* delivery\b/g)).toHaveLength(1)
  expect(source.match(/\brunStabilizedDelivery\(/g)).toHaveLength(1)
  expect(source).not.toMatch(
    /runDeliveryActivation|readDeliveryActivationTurn|checkedTurn|makeActivationCoordinator|runFreshWorkflowStep|deriveFreshWorkflowDecisions/
  )
})
