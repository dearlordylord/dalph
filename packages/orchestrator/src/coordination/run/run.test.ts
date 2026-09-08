/* eslint-disable import/no-nodejs-modules -- The source-boundary test reads its neighboring module. */
import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { PlannedAttemptExecutor, PlannedAttemptExecutorLifecycleObservation, RunId, TaskId } from "@dalph/contracts"
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
import {
  JournaledRunBootstrap,
  runDeliveryAfterDispositionCleanup,
  runWorkflow,
  runWorkflowWithControlledDeliveryActionExecutorForActiveWorkAuthorityRefresh
} from "./run.js"
import { RunActivationOpportunity } from "./run-activation-opportunity.js"
import { runControlledWorkflow } from "./controlled-workflow.js"
import type { DispositionCleanupActivationService } from "../../workflow/protocols/disposition-cleanup/loop.js"
import { WorktreeCleanupOutcome } from "../../workflow/protocols/disposition-cleanup/worktree.js"
import { authorization as cleanupAuthorization } from "../../workflow/protocols/disposition-cleanup/fixtures.js"

const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
const programDependencies = Layer.mergeAll(
  Layer.mock(OperationIdAllocator, {}),
  Layer.mock(PlannedTaskAttemptPlanner, {}),
  Layer.mock(TaskClaimAcquisitionPlanner, {})
)

it.effect("keeps the Run active and skips delivery until pending cleanup settles on a later activation", () =>
  Effect.gen(function* () {
    const deliveryCalls = yield* Ref.make(0)
    const pending = WorktreeCleanupOutcome.cases.Pending.make({
      attempts: 1,
      authorization: cleanupAuthorization,
      reason: "the removal response was unreadable"
    })
    const pendingCleanup = {
      responsibilities: { branch: [], candidate: [], worktree: [cleanupAuthorization] },
      run: Effect.succeed({
        branch: undefined,
        branchOutcomes: [],
        candidate: undefined,
        candidateOutcomes: [],
        remaining: { branch: [], candidate: [], worktree: [cleanupAuthorization] },
        selected: { branch: undefined, candidate: undefined, worktree: cleanupAuthorization },
        worktree: pending,
        worktreeOutcomes: [pending]
      })
    } satisfies DispositionCleanupActivationService
    const deliveryProof = {
      acceptedAt: null,
      decision: RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
    } as const
    const deliveryProgram = Ref.update(deliveryCalls, (calls) => calls + 1).pipe(Effect.as(deliveryProof))

    const blocked = yield* runDeliveryAfterDispositionCleanup(pendingCleanup, deliveryProgram)

    expect(blocked).toEqual({
      acceptedAt: null,
      decision: RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
    })
    expect(yield* Ref.get(deliveryCalls)).toBe(0)

    const settled = WorktreeCleanupOutcome.cases.Settled.make({
      authorization: cleanupAuthorization,
      result: {
        _tag: "Removed",
        branch: cleanupAuthorization.owner.branch,
        locator: cleanupAuthorization.locator,
        revision: cleanupAuthorization.evidenceRevision
      }
    })
    const settledCleanup = {
      responsibilities: { branch: [], candidate: [], worktree: [cleanupAuthorization] },
      run: Effect.succeed({
        branch: undefined,
        branchOutcomes: [],
        candidate: undefined,
        candidateOutcomes: [],
        remaining: { branch: [], candidate: [], worktree: [] },
        selected: { branch: undefined, candidate: undefined, worktree: cleanupAuthorization },
        worktree: settled,
        worktreeOutcomes: [settled]
      })
    } satisfies DispositionCleanupActivationService

    expect(yield* runDeliveryAfterDispositionCleanup(settledCleanup, deliveryProgram)).toBe(deliveryProof)
    expect(yield* Ref.get(deliveryCalls)).toBe(1)
  })
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
      activateActiveWorkAuthorityRefresh: () => Effect.die("unused"),
      registerAcceptedRunReactivationObservers: () => Effect.void
    })

    const dependencies = Layer.merge(programDependencies, Layer.succeed(JournaledRunBootstrap, bootstrap))
    expect(yield* runWorkflow(target, Effect.succeed(policy), runId).pipe(Effect.provide(dependencies))).toBe(finality)
    expect(seen.slice(0, 3)).toEqual([target, expect.anything(), runId])
    expect(Effect.isEffect(seen[1])).toBe(true)
    expect(seen[3]).toBeDefined()
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("hands controlled active refresh to one bootstrap activation without nesting another Run entry", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("controlled-active-refresh")
    const runId = yield* freshWorkflowRunId(target)
    const finality = RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
    let activeCalls = 0
    let capturedProgram:
      | ((opportunity: RunActivationOpportunity) => Effect.Effect<unknown, unknown, unknown>)
      | undefined
    const bootstrap = JournaledRunBootstrap.of({
      activate: () => Effect.die("controlled active refresh must not enter ordinary bootstrap activation"),
      activateActiveWorkAuthorityRefresh: (_target, _policy, _runId, program, source) => {
        activeCalls += 1
        capturedProgram = program
        expect(source).toBe("Timer")
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
      yield* runWorkflowWithControlledDeliveryActionExecutorForActiveWorkAuthorityRefresh(
        target,
        Effect.succeed(policy),
        runId,
        () => Effect.die("captured program is not executed by this bootstrap seam test"),
        "Timer",
        false
      ).pipe(Effect.provide(Layer.merge(programDependencies, Layer.succeed(JournaledRunBootstrap, bootstrap))))
    ).toBe(finality)
    expect(activeCalls).toBe(1)
    expect(capturedProgram).toBeDefined()
    if (capturedProgram !== undefined) {
      expect(Effect.isEffect(capturedProgram(RunActivationOpportunity.OrdinaryRunEntry()))).toBe(true)
    }
    expect(activeCalls).toBe(1)
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
          Layer.mock(PlannedAttemptExecutorLifecycleObservation, {}),
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
