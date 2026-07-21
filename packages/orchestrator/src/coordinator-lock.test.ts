import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer, Path, Scope } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect } from "vitest"
import {
  ControlledCoordinatorLock,
  controlledCoordinatorLockLayer,
  CoordinatorLock,
  CoordinatorLockHeld,
  CoordinatorLockUnavailable,
  CoordinatorOwnershipLost,
  GitCommonDirectoryTarget,
  nodeCoordinatorLockLayer
} from "./index.js"
import {
  NativeCoordinatorFileLock,
  NativeCoordinatorLockFailure,
  nodeCoordinatorLockAdapterLayer
} from "./node-coordinator-lock.js"

const nodePathAndFileSystemLayer = Layer.merge(
  NodeFileSystem.layer,
  NodePath.layer
)

const withTemporaryGitCommonDirectory = <A, E, R>(
  use: (target: GitCommonDirectoryTarget) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "dalph-coordinator-lock-test-"
    })
    const gitCommonDirectory = path.join(directory, "git-common-directory")
    yield* fileSystem.makeDirectory(gitCommonDirectory)
    return yield* use(GitCommonDirectoryTarget.make(gitCommonDirectory))
  }).pipe(Effect.provide(nodePathAndFileSystemLayer))

const coordinatorLockContract = <Services, E>(
  name: string,
  layer: Layer.Layer<CoordinatorLock | Services>,
  contradict: (
    target: GitCommonDirectoryTarget
  ) => Effect.Effect<void, E, Services | FileSystem.FileSystem | Path.Path>
) => {
  describe(`${name} CoordinatorLock contract`, () => {
    it.effect("rejects a second live coordinator before mutation", () =>
      Effect.scoped(
        withTemporaryGitCommonDirectory((target) =>
          Effect.gen(function*() {
            const lock = yield* CoordinatorLock
            yield* lock.acquire(target)
            const failure = yield* Effect.flip(lock.acquire(target))

            expect(failure).toBeInstanceOf(CoordinatorLockHeld)
          }).pipe(Effect.provide(layer))
        )
      ))

    it.effect("rejects a second live coordinator acquired through a path alias", () =>
      Effect.scoped(
        withTemporaryGitCommonDirectory((target) =>
          Effect.gen(function*() {
            const fileSystem = yield* FileSystem.FileSystem
            const lock = yield* CoordinatorLock
            const alias = GitCommonDirectoryTarget.make(`${target}-alias`)
            yield* fileSystem.symlink(target, alias)

            yield* lock.acquire(alias)
            const failure = yield* Effect.flip(lock.acquire(target))

            expect(failure).toBeInstanceOf(CoordinatorLockHeld)
          }).pipe(Effect.provide(layer))
        )
      ))

    it.effect("rejects mutation after scoped ownership is released", () =>
      Effect.scoped(
        withTemporaryGitCommonDirectory((target) =>
          Effect.gen(function*() {
            const lock = yield* CoordinatorLock
            const ownershipScope = yield* Scope.make()
            const ownership = yield* lock.acquire(target).pipe(
              Scope.provide(ownershipScope)
            )
            yield* Scope.close(ownershipScope, Exit.void)

            const failure = yield* Effect.flip(
              ownership.runMutation(Effect.void)
            )
            expect(failure).toBeInstanceOf(CoordinatorOwnershipLost)
          }).pipe(Effect.provide(layer))
        )
      ))

    it.effect("interrupts every affected mutation after a contradictory observation", () =>
      Effect.scoped(
        withTemporaryGitCommonDirectory((target) =>
          Effect.gen(function*() {
            const lock = yield* CoordinatorLock
            const ownership = yield* lock.acquire(target)
            const firstStarted = yield* Deferred.make<void>()
            const secondStarted = yield* Deferred.make<void>()
            const firstInterrupted = yield* Deferred.make<void>()
            const secondInterrupted = yield* Deferred.make<void>()
            const guardedMutation = (
              started: Deferred.Deferred<void>,
              interrupted: Deferred.Deferred<void>
            ) =>
              ownership.runMutation(
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
                )
              )
            const firstFiber = yield* Effect.forkScoped(
              guardedMutation(firstStarted, firstInterrupted)
            )
            const secondFiber = yield* Effect.forkScoped(
              guardedMutation(secondStarted, secondInterrupted)
            )
            yield* Effect.all([
              Deferred.await(firstStarted),
              Deferred.await(secondStarted)
            ], { discard: true })

            yield* contradict(target)
            yield* TestClock.adjust("100 millis")
            const failures = yield* Effect.all([
              Effect.flip(Fiber.join(firstFiber)),
              Effect.flip(Fiber.join(secondFiber))
            ])

            for (const failure of failures) {
              expect(failure).toMatchObject({
                _tag: "CoordinatorLockObservationContradiction",
                gitCommonDirectory: target
              })
            }
            yield* Effect.all([
              Deferred.await(firstInterrupted),
              Deferred.await(secondInterrupted)
            ], { discard: true })
          }).pipe(Effect.provide(layer))
        )
      ))
  })
}

coordinatorLockContract(
  "controlled",
  controlledCoordinatorLockLayer.pipe(Layer.provide(nodePathAndFileSystemLayer)),
  (target) =>
    Effect.gen(function*() {
      const control = yield* ControlledCoordinatorLock
      yield* control.contradict(target)
    })
)

describe("controlled CoordinatorLock lifecycle", () => {
  it.effect("does not let a contradicted owner revoke its successor", () =>
    Effect.scoped(
      withTemporaryGitCommonDirectory((target) =>
        Effect.gen(function*() {
          const lock = yield* CoordinatorLock
          const control = yield* ControlledCoordinatorLock
          const firstScope = yield* Scope.make()
          yield* lock.acquire(target).pipe(Scope.provide(firstScope))
          yield* control.contradict(target)
          yield* control.contradict(target)

          const successor = yield* lock.acquire(target)
          yield* Scope.close(firstScope, Exit.void)
          yield* successor.runMutation(Effect.void)
        }).pipe(Effect.provide(controlledCoordinatorLockLayer))
      )
    ))
})

describe("node CoordinatorLock adapter failures", () => {
  const provideNodeLock = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    layer = nodeCoordinatorLockLayer
  ) =>
    effect.pipe(
      Effect.provide(layer.pipe(Layer.provide(nodePathAndFileSystemLayer)))
    )

  it.effect("rejects unavailable Git common directories with typed failures", () =>
    Effect.scoped(
      withTemporaryGitCommonDirectory((target) =>
        Effect.gen(function*() {
          const fileSystem = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const lock = yield* CoordinatorLock
          const missing = GitCommonDirectoryTarget.make(
            path.join(target, "missing")
          )
          const missingFailure = yield* Effect.flip(lock.acquire(missing))
          expect(missingFailure).toBeInstanceOf(CoordinatorLockUnavailable)

          const file = yield* fileSystem.makeTempFileScoped({
            directory: target,
            prefix: "not-a-directory-"
          })
          const fileFailure = yield* Effect.flip(
            lock.acquire(GitCommonDirectoryTarget.make(file))
          )
          expect(fileFailure).toBeInstanceOf(CoordinatorLockUnavailable)
        }).pipe(provideNodeLock)
      )
    ))

  it.effect("classifies an unexpected native lock failure as unavailable", () =>
    Effect.scoped(
      withTemporaryGitCommonDirectory((target) =>
        Effect.gen(function*() {
          const lock = yield* CoordinatorLock
          const failure = yield* Effect.flip(lock.acquire(target))
          expect(failure).toBeInstanceOf(CoordinatorLockUnavailable)
        }).pipe(
          (effect) =>
            provideNodeLock(
              effect,
              nodeCoordinatorLockAdapterLayer.pipe(
                Layer.provide(
                  Layer.succeed(
                    NativeCoordinatorFileLock,
                    NativeCoordinatorFileLock.of({
                      acquireExclusive: () =>
                        Effect.fail(
                          new NativeCoordinatorLockFailure({
                            cause: "opaque"
                          })
                        )
                    })
                  )
                )
              )
            )
        )
      )
    ))

  it.effect("rejects mutation immediately when the lock path disappears", () =>
    Effect.scoped(
      withTemporaryGitCommonDirectory((target) =>
        Effect.gen(function*() {
          const fileSystem = yield* FileSystem.FileSystem
          const lock = yield* CoordinatorLock
          const ownership = yield* lock.acquire(target)
          yield* fileSystem.rename(target, `${target}-missing`)

          const failure = yield* Effect.flip(
            ownership.runMutation(Effect.void)
          )
          expect(failure).toMatchObject({
            _tag: "CoordinatorLockObservationContradiction"
          })
        }).pipe(provideNodeLock)
      )
    ))
})

coordinatorLockContract(
  "node",
  nodeCoordinatorLockLayer.pipe(Layer.provide(nodePathAndFileSystemLayer)),
  (target) =>
    Effect.gen(function*() {
      const fileSystem = yield* FileSystem.FileSystem
      yield* fileSystem.rename(target, `${target}-replacement`)
      yield* fileSystem.makeDirectory(target)
    })
)
