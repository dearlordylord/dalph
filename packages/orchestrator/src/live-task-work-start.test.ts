import { NodeFileSystem } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Ref } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  ClaimOwner,
  ClaimToken,
  GitCommitSha,
  GitCommonDirectoryTarget,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  ProviderRequestId,
  RunId,
  TaskBranchRef,
  TaskId,
  TaskLifecycle,
  TaskWorkSessionId,
  WorktreeLocator
} from "./domain.js"
import {
  controlledCoordinatorLockLayer,
  controlledTrackerMutationLayer,
  coordinatorOwnedTaskRunnerLayer,
  coordinatorOwnedTrackerMutationLayer,
  coordinatorOwnershipLayer,
  TaskClaimAcquisition,
  TrackerMutation
} from "./index.js"
import { MatchingTaskWorkSessionReported, TaskRunner, TaskWorkStartRequest } from "./task-work-start.js"

it.effect("shares one ownership capability across guarded starts and read-only lookups", () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-owner-" })
    const target = GitCommonDirectoryTarget.make(directory)
    const starts = yield* Ref.make(0)
    const lookups = yield* Ref.make(0)
    const runnerLayer = Layer.succeed(
      TaskRunner,
      TaskRunner.of({
        lookupTaskWorkSession: Effect.fn("TaskRunner.OwnershipTest.lookup")(function*(lookup) {
          yield* Ref.update(lookups, (count) => count + 1)
          return MatchingTaskWorkSessionReported.make({
            observationId: ProviderObservationId.make("ownership-lookup"),
            sessionId: TaskWorkSessionId.make(`session:${lookup.operationId}`),
            work: { _tag: "NoProviderWorkReported" }
          })
        }),
        requestTaskWorkStart: Effect.fn("TaskRunner.OwnershipTest.start")(function*() {
          yield* Ref.update(starts, (count) => count + 1)
          return {
            observationId: ProviderObservationId.make("ownership-request-observation"),
            providerRequestId: ProviderRequestId.make("ownership-request")
          }
        })
      })
    )
    const ownedRunnerLayer = coordinatorOwnedTaskRunnerLayer(runnerLayer).pipe(
      Layer.provide(coordinatorOwnershipLayer(target)),
      Layer.provide(controlledCoordinatorLockLayer)
    )
    const taskId = TaskId.make("task")
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("attempt"),
      baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
      branch: TaskBranchRef.make("refs/heads/task"),
      runId: RunId.make("run"),
      taskId,
      worktree: WorktreeLocator.make(`${directory}/task`)
    })
    const request = TaskWorkStartRequest.make({
      operationId: OperationId.make("operation"),
      plannedAttempt,
      task: {
        id: taskId,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
    })

    yield* Effect.gen(function*() {
      const runner = yield* TaskRunner
      yield* runner.requestTaskWorkStart(request)
      yield* runner.lookupTaskWorkSession({
        operationId: request.operationId,
        plannedAttempt
      })
    }).pipe(Effect.provide(ownedRunnerLayer))

    expect(yield* Ref.get(starts)).toBe(1)
    expect(yield* Ref.get(lookups)).toBe(1)
  }).pipe(Effect.provide(NodeFileSystem.layer)))

it.effect("guards claim acquisition and release while leaving observation read-only", () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "dalph-claim-owner-"
    })
    const target = GitCommonDirectoryTarget.make(directory)
    const ownedTrackerLayer = coordinatorOwnedTrackerMutationLayer(
      controlledTrackerMutationLayer
    ).pipe(
      Layer.provide(coordinatorOwnershipLayer(target)),
      Layer.provide(controlledCoordinatorLockLayer)
    )
    const acquisition = TaskClaimAcquisition.make({
      operationId: OperationId.make("owned-claim-operation"),
      owner: ClaimOwner.make("owned-claim-owner"),
      taskId: TaskId.make("owned-claim-task"),
      token: ClaimToken.make("owned-claim-token")
    })

    yield* Effect.gen(function*() {
      const tracker = yield* TrackerMutation
      expect((yield* tracker.readTaskClaim(acquisition.taskId))._tag).toBe(
        "UnclaimedTask"
      )
      const claim = yield* tracker.acquireTaskClaim(acquisition)
      expect(yield* tracker.readTaskClaim(acquisition.taskId)).toEqual(claim)
      yield* tracker.releaseTaskClaim(claim)
    }).pipe(Effect.provide(ownedTrackerLayer))
  }).pipe(Effect.provide(NodeFileSystem.layer)))
