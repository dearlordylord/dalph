import { Context, Deferred, Effect, Exit, FileSystem, Layer, Option, Schedule, Schema, Scope } from "effect"
import { flock } from "fs-ext-extra-prebuilt"
import {
  CoordinatorLock,
  CoordinatorLockHeld,
  CoordinatorLockObservationContradiction,
  CoordinatorLockUnavailable,
  type CoordinatorOwnership,
  type CoordinatorOwnershipError,
  CoordinatorOwnershipLost,
  guardCoordinatorMutation,
  resolveGitCommonDirectory
} from "./coordinator-lock.js"
import type { GitCommonDirectoryLocator, GitCommonDirectoryTarget } from "./domain.js"

const ownershipObservationSchedule = Schedule.spaced("25 millis")
const lockHeldCodes = new Set(["EACCES", "EAGAIN", "EWOULDBLOCK"])
const NativeLockCause = Schema.Struct({ code: Schema.String })

/** The host file-lock primitive rejected one descriptor lock request. */
export class NativeCoordinatorLockFailure extends Schema.TaggedErrorClass<NativeCoordinatorLockFailure>()(
  "NativeCoordinatorLockFailure",
  { cause: Schema.Defect() }
) {}

interface NativeCoordinatorFileLockService {
  readonly acquireExclusive: (
    descriptor: FileSystem.File.Descriptor
  ) => Effect.Effect<void, NativeCoordinatorLockFailure>
}

export class NativeCoordinatorFileLock extends Context.Service<
  NativeCoordinatorFileLock,
  NativeCoordinatorFileLockService
>()("@dalph/CoordinatorLock/NativeFileLock") {}

const nativeCoordinatorFileLockLayer = Layer.succeed(
  NativeCoordinatorFileLock,
  NativeCoordinatorFileLock.of({
    acquireExclusive: Effect.fn("CoordinatorLock.NativeFileLock.acquireExclusive")(
      function*(descriptor) {
        yield* Effect.tryPromise({
          try: () =>
            new Promise<void>((resolve, reject) => {
              flock(descriptor, "exnb", (failure) => {
                if (failure === null) resolve()
                else reject(failure)
              })
            }),
          catch: (cause) => new NativeCoordinatorLockFailure({ cause })
        })
      }
    )
  })
)

const failureDetail = String

const acquisitionUnavailable = (
  target: GitCommonDirectoryTarget
) =>
(failure: unknown): CoordinatorLockUnavailable =>
  new CoordinatorLockUnavailable({
    detail: failureDetail(failure),
    operation: "CoordinatorLock.acquire",
    target
  })

const errorCode = (failure: NativeCoordinatorLockFailure): string | undefined =>
  Schema.decodeUnknownOption(NativeLockCause)(failure.cause).pipe(
    Option.map(({ code }) => code),
    Option.getOrUndefined
  )

const sameFile = (
  left: FileSystem.File.Info,
  right: FileSystem.File.Info
): boolean => {
  const leftInode = Option.getOrNull(left.ino)
  const rightInode = Option.getOrNull(right.ino)
  return leftInode !== null
    && rightInode !== null
    && left.dev === right.dev
    && leftInode === rightInode
}

const observeOwnership = Effect.fn("CoordinatorLock.Node.observeOwnership")(
  function*(
    fileSystem: FileSystem.FileSystem,
    directory: FileSystem.File,
    gitCommonDirectory: GitCommonDirectoryLocator
  ) {
    const [heldDirectory, observedPath] = yield* Effect.all([
      directory.stat,
      fileSystem.stat(gitCommonDirectory)
    ]).pipe(
      Effect.mapError(() =>
        new CoordinatorLockObservationContradiction({
          gitCommonDirectory
        })
      )
    )
    if (!sameFile(heldDirectory, observedPath)) {
      return yield* new CoordinatorLockObservationContradiction({
        gitCommonDirectory
      })
    }
  }
)

export const nodeCoordinatorLockAdapterLayer = Layer.effect(
  CoordinatorLock,
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const nativeFileLock = yield* NativeCoordinatorFileLock

    const acquire = Effect.fn("CoordinatorLock.Node.acquire")(
      function*(target: GitCommonDirectoryTarget) {
        const gitCommonDirectory = yield* resolveGitCommonDirectory(fileSystem, target)
        const directoryScope = yield* Scope.make()
        yield* Effect.addFinalizer((exit) => Scope.close(directoryScope, exit))
        const directory = yield* Effect.gen(function*() {
          const openedDirectory = yield* fileSystem.open(gitCommonDirectory, {
            flag: "r"
          }).pipe(
            Scope.provide(directoryScope),
            Effect.mapError(acquisitionUnavailable(target))
          )
          const directoryInfo = yield* openedDirectory.stat.pipe(
            Effect.mapError(acquisitionUnavailable(target))
          )
          if (directoryInfo.type !== "Directory") {
            return yield* new CoordinatorLockUnavailable({
              detail: "the locator does not identify a directory",
              operation: "CoordinatorLock.acquire",
              target
            })
          }
          yield* nativeFileLock.acquireExclusive(openedDirectory.fd).pipe(
            Effect.mapError((failure) => {
              const code = errorCode(failure)
              return code !== undefined && lockHeldCodes.has(code)
                ? new CoordinatorLockHeld({ gitCommonDirectory })
                : new CoordinatorLockUnavailable({
                  detail: failureDetail(failure.cause),
                  operation: "CoordinatorLock.acquire",
                  target
                })
            })
          )
          return openedDirectory
        }).pipe(
          Effect.onError(() => Scope.close(directoryScope, Exit.void))
        )

        const signal = yield* Deferred.make<never, CoordinatorOwnershipError>()
        yield* Effect.addFinalizer(() =>
          Deferred.fail(
            signal,
            new CoordinatorOwnershipLost({ gitCommonDirectory })
          )
        )

        const observe = observeOwnership(
          fileSystem,
          directory,
          gitCommonDirectory
        )
        const failOwnership = (failure: CoordinatorOwnershipError) => Deferred.fail(signal, failure)
        yield* observe.pipe(
          Effect.repeat(ownershipObservationSchedule),
          Effect.tapError(failOwnership),
          Effect.ignore,
          Effect.forkScoped
        )

        const runMutation: CoordinatorOwnership["runMutation"] = (mutation) =>
          guardCoordinatorMutation(
            signal,
            observe.pipe(
              Effect.tapError(failOwnership),
              Effect.andThen(mutation)
            )
          )

        return { runMutation }
      }
    )

    return CoordinatorLock.of({ acquire })
  })
)

/** OS-backed coordinator ownership released by scope closure or process death. */
export const nodeCoordinatorLockLayer = nodeCoordinatorLockAdapterLayer.pipe(
  Layer.provide(nativeCoordinatorFileLockLayer)
)
