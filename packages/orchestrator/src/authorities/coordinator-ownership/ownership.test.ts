import { NodeFileSystem, NodePath, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Exit, FileSystem, Layer, Option, Path, Scope, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { describe, expect } from "vitest"
import {
  ControlledCoordinatorLock,
  controlledCoordinatorLockLayer,
  CoordinatorLock,
  CoordinatorLockHeld,
  CoordinatorLockUnavailable,
  GitCommonDirectoryTarget,
  nodeCoordinatorLockLayer
} from "../../index.js"
import {
  NativeCoordinatorFileLock,
  NativeCoordinatorLockFailure,
  nodeCoordinatorLockAdapterLayer
} from "./node-lock.js"
import { coordinatorLockContract } from "../../../test/contracts/coordinator-lock-contract.js"

const nodePathAndFileSystemLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer)

const nodeServicesAndCoordinatorLockLayer = nodeCoordinatorLockLayer.pipe(Layer.provideMerge(NodeServices.layer))

const childLockHolderScript = `
const fileSystem = require("node:fs")
const { flock } = require("fs-ext-extra-prebuilt")
const descriptor = fileSystem.openSync(process.argv[1], "r")
flock(descriptor, "exnb", (failure) => {
  if (failure !== null) process.exit(2)
  process.stdout.write("locked\\n")
  setInterval(() => undefined, 1_000)
})
`

const startChildLockHolder = Effect.fn("CoordinatorLock.Test.startChildLockHolder")(function* (
  target: GitCommonDirectoryTarget
) {
  const childProcesses = yield* ChildProcessSpawner.ChildProcessSpawner
  const packageDirectory = new URL("../", import.meta.url).pathname
  const holder = yield* childProcesses.spawn(
    ChildProcess.make("node", ["-e", childLockHolderScript, target], { cwd: packageDirectory })
  )
  const ready = yield* holder.stdout.pipe(Stream.decodeText(), Stream.splitLines, Stream.runHead)
  expect(Option.getOrUndefined(ready)).toBe("locked")
  return holder
})

const withTemporaryGitCommonDirectory = <A, E, R>(use: (target: GitCommonDirectoryTarget) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-coordinator-lock-test-" })
    const gitCommonDirectory = path.join(directory, "git-common-directory")
    yield* fileSystem.makeDirectory(gitCommonDirectory)
    return yield* use(GitCommonDirectoryTarget.make(gitCommonDirectory))
  }).pipe(Effect.provide(nodePathAndFileSystemLayer))

coordinatorLockContract(
  "controlled",
  controlledCoordinatorLockLayer.pipe(Layer.provide(nodePathAndFileSystemLayer)),
  (target) =>
    Effect.gen(function* () {
      const control = yield* ControlledCoordinatorLock
      yield* control.contradict(target)
    })
)

describe("controlled CoordinatorLock lifecycle", () => {
  it.effect("does not let a contradicted owner revoke its successor", () =>
    Effect.scoped(
      withTemporaryGitCommonDirectory((target) =>
        Effect.gen(function* () {
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
    )
  )
})

describe("node CoordinatorLock adapter failures", () => {
  const provideNodeLock = <A, E, R>(effect: Effect.Effect<A, E, R>, layer = nodeCoordinatorLockLayer) =>
    effect.pipe(Effect.provide(layer.pipe(Layer.provide(nodePathAndFileSystemLayer))))

  it.effect("rejects unavailable Git common directories with typed failures", () =>
    Effect.scoped(
      withTemporaryGitCommonDirectory((target) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const lock = yield* CoordinatorLock
          const missing = GitCommonDirectoryTarget.make(path.join(target, "missing"))
          const missingFailure = yield* Effect.flip(lock.acquire(missing))
          expect(missingFailure).toBeInstanceOf(CoordinatorLockUnavailable)

          const file = yield* fileSystem.makeTempFileScoped({ directory: target, prefix: "not-a-directory-" })
          const fileFailure = yield* Effect.flip(lock.acquire(GitCommonDirectoryTarget.make(file)))
          expect(fileFailure).toBeInstanceOf(CoordinatorLockUnavailable)
        }).pipe(provideNodeLock)
      )
    )
  )

  it.effect("classifies an unexpected native lock failure as unavailable", () =>
    Effect.scoped(
      withTemporaryGitCommonDirectory((target) =>
        Effect.gen(function* () {
          const lock = yield* CoordinatorLock
          const failure = yield* Effect.flip(lock.acquire(target))
          expect(failure).toBeInstanceOf(CoordinatorLockUnavailable)
        }).pipe((effect) =>
          provideNodeLock(
            effect,
            nodeCoordinatorLockAdapterLayer.pipe(
              Layer.provide(
                Layer.succeed(
                  NativeCoordinatorFileLock,
                  NativeCoordinatorFileLock.of({
                    acquireExclusive: () => Effect.fail(new NativeCoordinatorLockFailure({ cause: "opaque" }))
                  })
                )
              )
            )
          )
        )
      )
    )
  )

  it.effect("rejects mutation immediately when the lock path disappears", () =>
    Effect.scoped(
      withTemporaryGitCommonDirectory((target) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const lock = yield* CoordinatorLock
          const ownership = yield* lock.acquire(target)
          yield* fileSystem.rename(target, `${target}-missing`)

          const failure = yield* Effect.flip(ownership.runMutation(Effect.void))
          expect(failure).toMatchObject({ _tag: "CoordinatorLockObservationContradiction" })
        }).pipe(provideNodeLock)
      )
    )
  )

  it.live("releases native ownership when the holder process dies", () =>
    Effect.scoped(
      withTemporaryGitCommonDirectory((target) =>
        Effect.gen(function* () {
          const lock = yield* CoordinatorLock
          const holder = yield* startChildLockHolder(target)

          const heldFailure = yield* Effect.flip(lock.acquire(target))
          expect(heldFailure).toBeInstanceOf(CoordinatorLockHeld)

          yield* holder.kill({ killSignal: "SIGKILL" })
          const killedExit = yield* Effect.exit(holder.exitCode)
          expect(Exit.isFailure(killedExit)).toBe(true)

          const ownership = yield* lock.acquire(target)
          yield* ownership.runMutation(Effect.void)
        }).pipe(Effect.provide(nodeServicesAndCoordinatorLockLayer))
      )
    )
  )
})

coordinatorLockContract("node", nodeCoordinatorLockLayer.pipe(Layer.provide(nodePathAndFileSystemLayer)), (target) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    yield* fileSystem.rename(target, `${target}-replacement`)
    yield* fileSystem.makeDirectory(target)
  })
)
