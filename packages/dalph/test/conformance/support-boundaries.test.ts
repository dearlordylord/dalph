// @effect-diagnostics multipleEffectProvide:off
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import * as Contracts from "@dalph/contracts"
import { dryRunWorkflowInterpreterLayer, semanticTrace } from "@dalph/dalph"
import { Effect, FileSystem, Layer, Option } from "effect"
import { expect } from "vitest"
import { GitCommitSha, RunId, TaskExecutorLocator, WorktreeLocator } from "@dalph/contracts"
import {
  ClaimOwner,
  ClaimToken,
  controlledTrackerMutationLayer,
  CoordinatorOwnership,
  coordinatorOwnedGitWorktreeLayer,
  coordinatorOwnedTrackerMutationLayer,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTestWorkflowInterpreterLayer,
  FixtureTarget,
  freshOperationIdAllocatorLayer,
  GitCommand,
  GitWorktree,
  gitWorktreeTestLayer,
  JournalBoundaryDecodeIssue,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTargetLineageObservationOperation,
  makeTaskWorkSpecification,
  makeTaskWorktreeObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  nodeGitCommandLayer,
  OperationIdAllocator,
  PlannedTaskAttemptPlanner,
  PlannedWorktreeAbsent,
  projectTrackerSnapshot,
  TestTrackerGraphReader,
  TrackerGraphReader,
  trackerGraphReaderTestLayer,
  TrackerMutation,
  WorkflowInterpreter
} from "@dalph/orchestrator"
import * as PublicApi from "@dalph/orchestrator"

const snapshotOf = (result: ReturnType<typeof projectTrackerSnapshot>) =>
  Option.getOrThrow(Option.fromUndefinedOr(result._tag === "Valid" ? result.snapshot : undefined))

const firstSnapshot = snapshotOf(
  projectTrackerSnapshot({
    revision: "support-v1",
    tasks: [{ id: "support-task", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
  })
)
const emptySnapshot = snapshotOf(projectTrackerSnapshot({ revision: "support-v2", tasks: [] }))
const supportSpecification = makeTaskWorkSpecification({
  body: "Support boundary task body",
  taskId: Contracts.TaskId.make("support-task"),
  title: "Support boundary task"
})

it("loads the current public surface without compatibility exports", () => {
  expect(Contracts.PlannedAttemptExecutor).toBeDefined()
  expect(PublicApi.RunRecoveryFrontier).toBeDefined()
  expect(dryRunWorkflowInterpreterLayer).toBeDefined()
  expect(new JournalBoundaryDecodeIssue({ detail: "bad row", rowOrdinal: 1, runId: null })._tag).toBe(
    "JournalBoundaryDecodeIssue"
  )
})

it.effect("allocates deterministic operation and planned-attempt identities", () =>
  Effect.gen(function* () {
    const allocator = yield* OperationIdAllocator
    expect(yield* allocator.allocate()).toBe("support:0")
    expect(yield* allocator.allocate()).toBe("support:1")

    const task = firstSnapshot.eligibleTasks()[0]
    if (task === undefined) return yield* Effect.die("missing eligible task")
    const planner = yield* PlannedTaskAttemptPlanner
    const first = yield* planner.plan(supportSpecification)
    const second = yield* planner.plan(supportSpecification)
    expect(first.attemptId).toBe("attempt:support-task:0")
    expect(second.attemptId).toBe("attempt:support-task:1")
    expect(first.worktree).toContain("attempt-support-task-0")
  }).pipe(
    Effect.provide(deterministicOperationIdAllocatorLayer("support")),
    Effect.provide(
      deterministicPlannedTaskAttemptLayer({
        baseSha: GitCommitSha.make("2".repeat(40)),
        executor: TaskExecutorLocator.make("executor:support"),
        runId: RunId.make("support-run"),
        worktreeRoot: WorktreeLocator.make("/worktrees/support")
      })
    )
  )
)

it.effect("records tracker test reads and replaces the authoritative snapshot", () =>
  Effect.gen(function* () {
    const reader = yield* TrackerGraphReader
    const controller = yield* TestTrackerGraphReader
    const target = FixtureTarget.make("support-fixture")
    expect((yield* reader.read(target)).eligibleTasks()).toHaveLength(1)
    expect(yield* controller.requestedTargets()).toEqual([target])
    yield* controller.setSnapshot(emptySnapshot)
    expect((yield* controller.read(target)).eligibleTasks()).toEqual([])
    expect(yield* controller.requestedTargets()).toEqual([target, target])
  }).pipe(Effect.provide(trackerGraphReaderTestLayer(firstSnapshot)))
)

it.effect("substitutes controlled Layers without changing public delivery values", () =>
  Effect.gen(function* () {
    const task = firstSnapshot.eligibleTasks()[0]
    if (task === undefined) return yield* Effect.die("missing eligible task")
    const planner = yield* PlannedTaskAttemptPlanner
    const plannedAttempt = yield* planner.plan(supportSpecification)
    const graph = makeTrackerGraphObservationOperation(
      PublicApi.OperationId.make("support-read"),
      FixtureTarget.make("support-fixture")
    )
    const claim = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: PublicApi.OperationId.make("support-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId: task.id,
        token: ClaimToken.make("support-token")
      },
      predecessorOperationIds: [graph.operationId]
    })
    const plan = makeTaskAttemptPlanOperation({
      operationId: PublicApi.OperationId.make("support-plan"),
      plannedAttempt,
      predecessorOperationIds: [claim.acquisition.operationId]
    })
    const worktree = makeTaskWorktreeReconciliationOperation({
      operationId: PublicApi.OperationId.make("support-worktree"),
      plannedAttempt,
      predecessorOperationIds: [plan.operationId]
    })
    const worktreeRead = makeTaskWorktreeObservationOperation({
      operationId: PublicApi.OperationId.make("support-worktree-read"),
      plannedAttempt,
      predecessorOperationIds: [worktree.operationId]
    })
    const targetLineageRead = makeTargetLineageObservationOperation({
      integrationTarget: Contracts.IntegrationTarget.make({
        repository: Contracts.GitRepositoryLocator.make("/repositories/support.git"),
        ref: Contracts.IntegrationTargetRef.make("refs/heads/master")
      }),
      operationId: PublicApi.OperationId.make("support-target-lineage-read"),
      plannedAttempt,
      predecessorOperationIds: [worktreeRead.operationId]
    })

    const live = yield* WorkflowInterpreter
    expect((yield* live.readTrackerGraph(graph)).eligibleTasks()).toHaveLength(1)
    expect((yield* live.acquireTaskClaim(claim))._tag).toBe("AuthoritativeTaskClaimAcquired")
    expect((yield* live.recordTaskAttemptPlan(plan))._tag).toBe("TaskAttemptPlanRecordAcknowledged")
    expect((yield* live.reconcileTaskWorktree(worktree))._tag).toBe("AuthoritativeTaskWorktreeReady")
    expect((yield* live.readTaskWorktree(worktreeRead))._tag).toBe("AuthoritativePlannedAttemptWorktreeObserved")
    expect((yield* live.readTargetLineage(targetLineageRead))._tag).toBe("AuthoritativeTargetLineageObserved")

    const dry = yield* WorkflowInterpreter.pipe(
      Effect.provide(dryRunWorkflowInterpreterLayer.pipe(Layer.provide(trackerGraphReaderTestLayer(firstSnapshot))))
    )
    expect((yield* dry.acquireTaskClaim(claim))._tag).toBe("AuthoritativeTaskClaimAcquired")
    expect((yield* dry.readTaskWorktree(worktreeRead))._tag).toBe("AuthoritativePlannedAttemptWorktreeObserved")
    expect((yield* dry.readTargetLineage(targetLineageRead))._tag).toBe("AuthoritativeTargetLineageObserved")
    expect((yield* dry.recordTaskAttemptPlan(plan))._tag).toBe("TaskAttemptPlanRecordAcknowledged")
  }).pipe(
    Effect.provide(
      deterministicPlannedTaskAttemptLayer({
        baseSha: GitCommitSha.make("2".repeat(40)),
        executor: TaskExecutorLocator.make("executor:support"),
        runId: RunId.make("support-run"),
        worktreeRoot: WorktreeLocator.make("/worktrees/support")
      })
    ),
    Effect.provide(
      deterministicTestWorkflowInterpreterLayer.pipe(Layer.provide(trackerGraphReaderTestLayer(firstSnapshot)))
    )
  )
)

it.effect("guards generic tracker and Git mutations with coordinator ownership", () =>
  Effect.gen(function* () {
    const planner = yield* PlannedTaskAttemptPlanner
    const task = firstSnapshot.eligibleTasks()[0]
    if (task === undefined) return yield* Effect.die("missing eligible task")
    const plannedAttempt = yield* planner.plan(supportSpecification)
    const tracker = yield* TrackerMutation
    const acquisition = {
      operationId: PublicApi.OperationId.make("owned-claim"),
      owner: ClaimOwner.make("dalph"),
      taskId: task.id,
      token: ClaimToken.make("owned-token")
    }
    const claim = yield* tracker.acquireTaskClaim(acquisition)
    expect((yield* tracker.readTaskClaim(task.id))._tag).toBe("ActiveTaskClaim")
    yield* tracker.releaseTaskClaim({ claim, operationId: PublicApi.OperationId.make("release-owned-claim") })
    expect((yield* tracker.readTaskClaim(task.id))._tag).toBe("UnclaimedTask")

    const git = yield* GitWorktree
    expect((yield* git.readPlannedWorktree(plannedAttempt))._tag).toBe("PlannedWorktreeAbsent")
    yield* git.createPlannedWorktree(plannedAttempt)
    expect((yield* git.readPlannedWorktree(plannedAttempt))._tag).toBe("PlannedWorktreeReady")
  }).pipe(
    Effect.provide(
      deterministicPlannedTaskAttemptLayer({
        baseSha: GitCommitSha.make("2".repeat(40)),
        executor: TaskExecutorLocator.make("executor:support"),
        runId: RunId.make("support-run"),
        worktreeRoot: WorktreeLocator.make("/worktrees/support")
      })
    ),
    Effect.provide(
      Layer.merge(
        coordinatorOwnedTrackerMutationLayer(controlledTrackerMutationLayer),
        coordinatorOwnedGitWorktreeLayer(gitWorktreeTestLayer(PlannedWorktreeAbsent.make({})))
      ).pipe(
        Layer.provide(
          Layer.succeed(CoordinatorOwnership, CoordinatorOwnership.of({ runMutation: (mutation) => mutation }))
        )
      )
    )
  )
)

it.effect("allocates a fresh operation identity and normalizes an empty trace", () =>
  Effect.gen(function* () {
    const id = yield* (yield* OperationIdAllocator).allocate()
    expect(id.length).toBeGreaterThan(0)
    expect(semanticTrace([])).toEqual([])
  }).pipe(Effect.provide(freshOperationIdAllocatorLayer), Effect.provide(NodeCrypto.layer))
)

it.effect("runs text and byte Git commands inside an exact worktree", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: "dalph-git-command-" })
      const git = yield* GitCommand
      expect((yield* git.runInWorktree(directory, ["--version"])).exitCode).toBe(0)
      expect((yield* git.runBytesInWorktree(directory, ["--version"], { DALPH_TEST_ENVIRONMENT: "1" })).exitCode).toBe(
        0
      )
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)
