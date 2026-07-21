import { NodeFileSystem } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Ref } from "effect"
import { expect } from "vitest"
import { CoordinatorLock, CoordinatorLockHeld } from "./coordinator-lock.js"
import { GitCommonDirectoryTarget, TaskId } from "./domain.js"
import { coordinatorOwnedTaskWorkStartLayer, productionTaskWorkStartLayer } from "./live-task-work-start.js"
import { TaskRunner, TaskWorkStart } from "./task-work-start.js"

it.effect("acquires ownership before exposing and guards every task-work start request", () =>
  Effect.scoped(
    Effect.gen(function*() {
      const observations = yield* Ref.make<ReadonlyArray<string>>([])
      const target = GitCommonDirectoryTarget.make("/repository/.git")
      const taskId = TaskId.make("task-1")
      const coordinatorLockLayer = Layer.succeed(
        CoordinatorLock,
        CoordinatorLock.of({
          acquire: Effect.fn("CoordinatorLock.Test.acquire")(function*(observedTarget) {
            yield* Ref.update(observations, (current) => [
              ...current,
              `acquire:${observedTarget}`
            ])
            return {
              runMutation: <A, E, R>(request: Effect.Effect<A, E, R>) =>
                Ref.update(observations, (current) => [...current, "guard"]).pipe(
                  Effect.andThen(request)
                )
            }
          })
        })
      )
      const taskRunnerLayer = Layer.succeed(
        TaskRunner,
        TaskRunner.of({
          requestTaskWorkStart: Effect.fn("TaskRunner.Test.requestTaskWorkStart")(function*(observedTaskId) {
            yield* Ref.update(observations, (current) => [
              ...current,
              `request:${observedTaskId}`
            ])
          })
        })
      )
      yield* Effect.gen(function*() {
        const taskWorkStart = yield* TaskWorkStart
        expect(yield* Ref.get(observations)).toEqual([
          "acquire:/repository/.git"
        ])

        yield* taskWorkStart.request(taskId)
        yield* taskWorkStart.request(taskId)

        expect(yield* Ref.get(observations)).toEqual([
          "acquire:/repository/.git",
          "guard",
          "request:task-1",
          "guard",
          "request:task-1"
        ])
      }).pipe(
        Effect.provide(
          coordinatorOwnedTaskWorkStartLayer(target, taskRunnerLayer)
        ),
        Effect.provide(coordinatorLockLayer)
      )
    })
  ))

it.effect("production composition rejects a second coordinator before task-work start", () =>
  Effect.scoped(
    Effect.gen(function*() {
      const fileSystem = yield* FileSystem.FileSystem
      const gitCommonDirectory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "dalph-live-task-work-start-test-"
      })
      const target = GitCommonDirectoryTarget.make(gitCommonDirectory)
      const requests = yield* Ref.make(0)
      const taskRunnerLayer = Layer.succeed(
        TaskRunner,
        TaskRunner.of({
          requestTaskWorkStart: Effect.fn("TaskRunner.Test.production")(function*() {
            yield* Ref.update(requests, (count) => count + 1)
          })
        })
      )
      const makeLayer = () =>
        productionTaskWorkStartLayer(target, taskRunnerLayer).pipe(
          Layer.provide(NodeFileSystem.layer)
        )

      yield* Layer.build(makeLayer())
      const failure = yield* Layer.build(makeLayer()).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(CoordinatorLockHeld)
      expect(yield* Ref.get(requests)).toBe(0)
    }).pipe(Effect.provide(NodeFileSystem.layer))
  ))
