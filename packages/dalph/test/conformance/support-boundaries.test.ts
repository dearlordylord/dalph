// @effect-diagnostics multipleEffectProvide:off
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import * as Contracts from "@dalph/contracts"
import { dryRunWorkflowInterpreterLayer, semanticTrace } from "@dalph/dalph"
import * as DalphPublicApi from "@dalph/dalph"
import { Effect, FileSystem, Layer, Option } from "effect"
import { expect } from "vitest"
import { GitCommitSha, makeTaskWorkSpecification, RunId, TaskExecutorLocator, WorktreeLocator } from "@dalph/contracts"
import {
  ClaimOwner,
  ClaimToken,
  ActiveTaskClaim,
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
  makeTaskWorktreeObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  nodeGitCommandLayer,
  OperationIdAllocator,
  PlannedTaskAttemptPlanRequest,
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
  expect(PublicApi.deriveJournalResponsibilityFacts).toBeDefined()
  expect("RunRecoveryFrontier" in PublicApi).toBe(false)
  expect("legacyUnpublishedInRunJournalLayer" in PublicApi).toBe(false)
  expect("legacyMemoryJournalStoreLayer" in PublicApi).toBe(false)
  expect("legacySqliteJournalStoreLayer" in PublicApi).toBe(false)
  expect(dryRunWorkflowInterpreterLayer).toBeDefined()
  expect(new JournalBoundaryDecodeIssue({ detail: "bad row", partition: "Hot", rowOrdinal: 1, runId: null })._tag).toBe(
    "JournalBoundaryDecodeIssue"
  )
})

it("keeps the Codex replacement seam callable from the package root", () => {
  const plannedAttempt = Contracts.PlannedTaskAttempt.make({
    attemptId: Contracts.AttemptId.make("attempt:support-replacement"),
    baseSha: GitCommitSha.make("2".repeat(40)),
    branch: Contracts.TaskBranchRef.make("refs/heads/support-replacement"),
    executor: TaskExecutorLocator.make("executor:support"),
    runId: RunId.make("support-replacement-run"),
    taskId: supportSpecification.taskId,
    taskRevision: supportSpecification.fingerprint,
    worktree: WorktreeLocator.make("/worktrees/support-replacement")
  })
  const claim = ActiveTaskClaim.make({
    operationId: PublicApi.OperationId.make("support-replacement-claim"),
    owner: ClaimOwner.make("dalph"),
    taskId: plannedAttempt.taskId,
    token: ClaimToken.make("support-replacement-token")
  })
  const requestId = DalphPublicApi.CodexReplacementRequestId.make("support-replacement-request")
  const request = DalphPublicApi.CodexProviderWorkUnitReplacementRequest.make({
    claim,
    plannedAttempt,
    requestId,
    specification: supportSpecification
  })
  const result = DalphPublicApi.CodexProviderWorkUnitReplacementResult.cases.ProviderTemporarilyUnreadable.make({
    detail: "controlled authority unavailable"
  })
  const replacement = DalphPublicApi.CodexProviderWorkUnitReplacement.of({
    replacePurgedProviderWorkUnit: (_request) => Effect.succeed(result)
  })
  const failure = new DalphPublicApi.CodexReplacementAuthorityFailure({
    detail: "controlled authority unavailable",
    kind: "ProviderTemporarilyUnreadable"
  })
  const authority = DalphPublicApi.CodexReplacementAuthority.of({ observe: (_request) => Effect.fail(failure) })

  expect(request.requestId).toBe(requestId)
  expect(result._tag).toBe("ProviderTemporarilyUnreadable")
  expect(replacement).toBeDefined()
  expect(authority).toBeDefined()
  expect(DalphPublicApi.CodexReplacementRequestId).toBeDefined()
  expect(DalphPublicApi.CodexProviderWorkUnitReplacementRequest).toBeDefined()
  expect(DalphPublicApi.CodexProviderWorkUnitReplacementResult).toBeDefined()
  expect(DalphPublicApi.CodexProviderWorkUnitReplacement).toBeDefined()
  expect(DalphPublicApi.CodexReplacementAuthority).toBeDefined()
  expect(DalphPublicApi.CodexReplacementAuthorityFailure).toBeDefined()
  expect(DalphPublicApi.CodexReplacementAuthorityProof).toBeDefined()
  expect(DalphPublicApi.nodeCodexPlannedAttemptExecutorLayer).toBeDefined()
})

it.effect("allocates deterministic operation and planned-attempt identities", () =>
  Effect.gen(function* () {
    const allocator = yield* OperationIdAllocator
    expect(yield* allocator.allocate()).toBe("support:0")
    expect(yield* allocator.allocate()).toBe("support:1")

    const task = firstSnapshot.eligibleTasks()[0]
    if (task === undefined) return yield* Effect.die("missing eligible task")
    const planner = yield* PlannedTaskAttemptPlanner
    const first = yield* planner.plan(PlannedTaskAttemptPlanRequest.Fresh({ specification: supportSpecification }))
    const second = yield* planner.plan(PlannedTaskAttemptPlanRequest.Fresh({ specification: supportSpecification }))
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
    const plannedAttempt = yield* planner.plan(
      PlannedTaskAttemptPlanRequest.Fresh({ specification: supportSpecification })
    )
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
    const plannedAttempt = yield* planner.plan(
      PlannedTaskAttemptPlanRequest.Fresh({ specification: supportSpecification })
    )
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
          Layer.succeed(
            CoordinatorOwnership,
            CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
          )
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
