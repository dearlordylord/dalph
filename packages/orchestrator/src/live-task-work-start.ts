import type { FileSystem } from "effect"
import { Effect, Layer } from "effect"
import {
  CoordinatorLock,
  type CoordinatorLockHeld,
  type CoordinatorLockUnavailable,
  CoordinatorOwnership
} from "./coordinator-lock.js"
import type { GitCommonDirectoryTarget } from "./domain.js"
import { GitWorktree } from "./git-worktree.js"
import { nodeCoordinatorLockLayer } from "./node-coordinator-lock.js"
import { TaskRunner } from "./task-work-start.js"
import { TrackerMutation } from "./tracker-mutation.js"

/** Acquires one scoped ownership capability for all live state-changing adapters. */
export const coordinatorOwnershipLayer = (
  target: GitCommonDirectoryTarget
): Layer.Layer<
  CoordinatorOwnership,
  CoordinatorLockHeld | CoordinatorLockUnavailable,
  CoordinatorLock
> =>
  Layer.effect(
    CoordinatorOwnership,
    Effect.gen(function*() {
      const coordinatorLock = yield* CoordinatorLock
      return CoordinatorOwnership.of(yield* coordinatorLock.acquire(target))
    })
  )

/** Guards only the state-changing start request; provider lookup stays read-only. */
export const coordinatorOwnedTaskRunnerLayer = <E, R>(
  taskRunnerLayer: Layer.Layer<TaskRunner, E, R>
) =>
  Layer.effect(
    TaskRunner,
    Effect.gen(function*() {
      const ownership = yield* CoordinatorOwnership
      const taskRunner = yield* TaskRunner
      const requestTaskWorkStart = Effect.fn(
        "TaskRunner.CoordinatorOwned.requestTaskWorkStart"
      )(function*(request) {
        return yield* ownership.runMutation(
          taskRunner.requestTaskWorkStart(request)
        )
      })

      return TaskRunner.of({
        lookupTaskWorkSession: taskRunner.lookupTaskWorkSession,
        requestTaskWorkStart
      })
    })
  ).pipe(Layer.provide(taskRunnerLayer))

/** Guards claim acquisition and release while leaving claim observation read-only. */
export const coordinatorOwnedTrackerMutationLayer = <E, R>(
  trackerMutationLayer: Layer.Layer<TrackerMutation, E, R>
) =>
  Layer.effect(
    TrackerMutation,
    Effect.gen(function*() {
      const ownership = yield* CoordinatorOwnership
      const tracker = yield* TrackerMutation
      return TrackerMutation.of({
        acquireTaskClaim: Effect.fn(
          "TrackerMutation.CoordinatorOwned.acquireTaskClaim"
        )(function*(acquisition) {
          return yield* ownership.runMutation(
            tracker.acquireTaskClaim(acquisition)
          )
        }),
        readTaskClaim: tracker.readTaskClaim,
        releaseTaskClaim: Effect.fn(
          "TrackerMutation.CoordinatorOwned.releaseTaskClaim"
        )(function*(claim) {
          return yield* ownership.runMutation(
            tracker.releaseTaskClaim(claim)
          )
        })
      })
    })
  ).pipe(Layer.provide(trackerMutationLayer))

/** Guards only Git worktree creation; Git observations remain read-only. */
export const coordinatorOwnedGitWorktreeLayer = <E, R>(
  gitWorktreeLayer: Layer.Layer<GitWorktree, E, R>
) =>
  Layer.effect(
    GitWorktree,
    Effect.gen(function*() {
      const ownership = yield* CoordinatorOwnership
      const gitWorktree = yield* GitWorktree
      return GitWorktree.of({
        createPlannedWorktree: Effect.fn(
          "GitWorktree.CoordinatorOwned.createPlannedWorktree"
        )(function*(plannedAttempt) {
          return yield* ownership.runMutation(
            gitWorktree.createPlannedWorktree(plannedAttempt)
          )
        }),
        readPlannedWorktree: gitWorktree.readPlannedWorktree
      })
    })
  ).pipe(Layer.provide(gitWorktreeLayer))

/** Production ownership acquisition using the OS-backed coordinator lock. */
export const productionCoordinatorOwnershipLayer = (
  target: GitCommonDirectoryTarget
): Layer.Layer<
  CoordinatorOwnership,
  CoordinatorLockHeld | CoordinatorLockUnavailable,
  FileSystem.FileSystem
> => coordinatorOwnershipLayer(target).pipe(Layer.provide(nodeCoordinatorLockLayer))
