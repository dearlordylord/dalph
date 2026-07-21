import type { FileSystem } from "effect"
import { Effect, Layer } from "effect"
import { CoordinatorLock, type CoordinatorLockHeld, type CoordinatorLockUnavailable } from "./coordinator-lock.js"
import type { GitCommonDirectoryTarget } from "./domain.js"
import { nodeCoordinatorLockLayer } from "./node-coordinator-lock.js"
import { TaskRunner, TaskWorkStart } from "./task-work-start.js"

/**
 * Acquires coordinator ownership before exposing a task-work start capability
 * and guards every request sent through the underlying task runner.
 */
export const coordinatorOwnedTaskWorkStartLayer = <E, R>(
  target: GitCommonDirectoryTarget,
  taskRunnerLayer: Layer.Layer<TaskRunner, E, R>
): Layer.Layer<
  TaskWorkStart,
  CoordinatorLockHeld | CoordinatorLockUnavailable | E,
  CoordinatorLock | R
> =>
  Layer.effect(
    TaskWorkStart,
    Effect.gen(function*() {
      const coordinatorLock = yield* CoordinatorLock
      const ownership = yield* coordinatorLock.acquire(target)
      const taskRunner = yield* TaskRunner

      const request = Effect.fn("TaskWorkStart.CoordinatorOwned.request")(
        function*(taskId) {
          yield* ownership.runMutation(
            taskRunner.requestTaskWorkStart(taskId)
          )
        }
      )

      return TaskWorkStart.of({ request })
    })
  ).pipe(Layer.provide(taskRunnerLayer))

/** Production task-work start capability guarded by the OS-backed lock. */
export const productionTaskWorkStartLayer = <E, R>(
  target: GitCommonDirectoryTarget,
  taskRunnerLayer: Layer.Layer<TaskRunner, E, R>
): Layer.Layer<
  TaskWorkStart,
  CoordinatorLockHeld | CoordinatorLockUnavailable | E,
  FileSystem.FileSystem | R
> =>
  coordinatorOwnedTaskWorkStartLayer(target, taskRunnerLayer).pipe(
    Layer.provide(nodeCoordinatorLockLayer)
  )
