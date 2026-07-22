import { Context, Deferred, Effect, FileSystem, Layer, Ref, Schema } from "effect"
import type * as Scope from "effect/Scope"
import { GitCommonDirectoryLocator, GitCommonDirectoryTarget } from "./domain.js"

const CoordinatorLockOperation = Schema.Literal("CoordinatorLock.acquire")

/** Another live coordinator already owns this Git common directory. */
export class CoordinatorLockHeld extends Schema.TaggedErrorClass<CoordinatorLockHeld>()(
  "CoordinatorLockHeld",
  { gitCommonDirectory: GitCommonDirectoryLocator }
) {}

/** The operating system could not acquire coordinator ownership. */
export class CoordinatorLockUnavailable extends Schema.TaggedErrorClass<CoordinatorLockUnavailable>()(
  "CoordinatorLockUnavailable",
  {
    operation: CoordinatorLockOperation,
    target: GitCommonDirectoryTarget,
    detail: Schema.String
  }
) {}

/** Scoped coordinator ownership ended before a mutation could remain valid. */
export class CoordinatorOwnershipLost extends Schema.TaggedErrorClass<CoordinatorOwnershipLost>()(
  "CoordinatorOwnershipLost",
  { gitCommonDirectory: GitCommonDirectoryLocator }
) {}

/** The canonical directory path no longer names this coordinator's locked inode. */
export class CoordinatorLockObservationContradiction
  extends Schema.TaggedErrorClass<CoordinatorLockObservationContradiction>()(
    "CoordinatorLockObservationContradiction",
    { gitCommonDirectory: GitCommonDirectoryLocator }
  )
{}

type CoordinatorLockAcquireError =
  | CoordinatorLockHeld
  | CoordinatorLockUnavailable

export type CoordinatorOwnershipError =
  | CoordinatorLockObservationContradiction
  | CoordinatorOwnershipLost

/**
 * Guards mutations performed by one live coordinator. The guard interrupts an
 * in-flight mutation when the scoped ownership signal fails.
 */
export interface CoordinatorOwnershipCapability {
  readonly runMutation: <A, E, R>(
    mutation: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | CoordinatorOwnershipError, R>
}

/** Scoped proof that one live coordinator may cross state-changing boundaries. */
export class CoordinatorOwnership extends Context.Service<
  CoordinatorOwnership,
  CoordinatorOwnershipCapability
>()("@dalph/CoordinatorOwnership") {}

interface CoordinatorLockService {
  readonly acquire: (
    target: GitCommonDirectoryTarget
  ) => Effect.Effect<
    CoordinatorOwnershipCapability,
    CoordinatorLockAcquireError,
    Scope.Scope
  >
}

export class CoordinatorLock extends Context.Service<CoordinatorLock, CoordinatorLockService>()(
  "@dalph/CoordinatorLock"
) {}

interface ControlledCoordinatorLockService {
  readonly contradict: (
    target: GitCommonDirectoryTarget
  ) => Effect.Effect<void, CoordinatorLockUnavailable>
}

export class ControlledCoordinatorLock extends Context.Service<
  ControlledCoordinatorLock,
  ControlledCoordinatorLockService
>()("@dalph/CoordinatorLock/Controlled") {}

interface ControlledOwnershipState {
  readonly signal: Deferred.Deferred<never, CoordinatorOwnershipError>
  readonly token: object
}

export const guardCoordinatorMutation = <A, E, R>(
  signal: Deferred.Deferred<never, CoordinatorOwnershipError>,
  mutation: Effect.Effect<A, E, R>
): Effect.Effect<A, E | CoordinatorOwnershipError, R> =>
  Effect.suspend(() =>
    Deferred.isDoneUnsafe(signal)
      ? Deferred.await(signal)
      : Effect.raceFirst(mutation, Deferred.await(signal))
  )

/** Resolves every raw path alias before an adapter observes ownership. */
export const resolveGitCommonDirectory = Effect.fn("CoordinatorLock.resolveGitCommonDirectory")(
  function*(
    fileSystem: FileSystem.FileSystem,
    target: GitCommonDirectoryTarget
  ) {
    const canonicalPath = yield* fileSystem.realPath(target).pipe(
      Effect.mapError((failure) =>
        new CoordinatorLockUnavailable({
          detail: String(failure),
          operation: "CoordinatorLock.acquire",
          target
        })
      )
    )
    return GitCommonDirectoryLocator.make(canonicalPath)
  }
)

/** Deterministic coordinator-lock implementation for controlled scenarios. */
export const controlledCoordinatorLockLayer = Layer.effectContext(
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const active = yield* Ref.make<
      ReadonlyMap<GitCommonDirectoryLocator, ControlledOwnershipState>
    >(new Map())

    const acquire = Effect.fn("CoordinatorLock.Controlled.acquire")(
      function*(target: GitCommonDirectoryTarget) {
        const gitCommonDirectory = yield* resolveGitCommonDirectory(fileSystem, target)
        const signal = yield* Deferred.make<never, CoordinatorOwnershipError>()
        const token = {}
        const acquired = yield* Ref.modify(active, (current) => {
          if (current.has(gitCommonDirectory)) return [false, current] as const
          return [
            true,
            new Map([
              ...current,
              [gitCommonDirectory, { signal, token }] as const
            ])
          ] as const
        })
        if (!acquired) {
          return yield* new CoordinatorLockHeld({ gitCommonDirectory })
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function*() {
            yield* Deferred.fail(
              signal,
              new CoordinatorOwnershipLost({ gitCommonDirectory })
            )
            yield* Ref.update(active, (current) => {
              if (current.get(gitCommonDirectory)?.token !== token) return current
              return new Map(
                [...current].filter(([key]) => key !== gitCommonDirectory)
              )
            })
          })
        )

        return {
          runMutation: <A, E, R>(mutation: Effect.Effect<A, E, R>) => guardCoordinatorMutation(signal, mutation)
        } satisfies CoordinatorOwnershipCapability
      }
    )

    const contradict = Effect.fn("CoordinatorLock.Controlled.contradict")(
      function*(target: GitCommonDirectoryTarget) {
        const gitCommonDirectory = yield* resolveGitCommonDirectory(fileSystem, target)
        const ownership = yield* Ref.modify(active, (current) => {
          const found = current.get(gitCommonDirectory)
          if (found === undefined) return [undefined, current] as const
          return [
            found,
            new Map(
              [...current].filter(([key]) => key !== gitCommonDirectory)
            )
          ] as const
        })
        if (ownership !== undefined) {
          yield* Deferred.fail(
            ownership.signal,
            new CoordinatorLockObservationContradiction({
              gitCommonDirectory
            })
          )
        }
      }
    )

    const lock = CoordinatorLock.of({ acquire })
    const control = ControlledCoordinatorLock.of({ contradict })
    return Context.empty().pipe(
      Context.add(CoordinatorLock, lock),
      Context.add(ControlledCoordinatorLock, control)
    )
  })
)
