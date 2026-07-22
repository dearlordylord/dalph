import type { FileSystem } from "effect"
import { Effect, Layer } from "effect"
import {
  CoordinatorLock,
  type CoordinatorLockHeld,
  type CoordinatorLockUnavailable,
  CoordinatorOwnership
} from "./coordinator-lock.js"
import type { GitCommonDirectoryTarget } from "./domain.js"
import { nodeCoordinatorLockLayer } from "./node-coordinator-lock.js"
import { TaskRunner } from "./task-work-start.js"

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

/** Production ownership acquisition using the OS-backed coordinator lock. */
export const productionCoordinatorOwnershipLayer = (
  target: GitCommonDirectoryTarget
): Layer.Layer<
  CoordinatorOwnership,
  CoordinatorLockHeld | CoordinatorLockUnavailable,
  FileSystem.FileSystem
> => coordinatorOwnershipLayer(target).pipe(Layer.provide(nodeCoordinatorLockLayer))
