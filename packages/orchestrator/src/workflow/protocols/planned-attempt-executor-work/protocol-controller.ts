import type { PlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Context, Deferred, Effect, Layer, Option, Ref, Schema } from "effect"

/** Process-local structural identity of one exact Run and planned attempt protocol guard. */
const PlannedAttemptProtocolGuardKey = Schema.NonEmptyString.pipe(Schema.brand("PlannedAttemptProtocolGuardKey"))
type PlannedAttemptProtocolGuardKey = typeof PlannedAttemptProtocolGuardKey.Type

const plannedAttemptProtocolGuardKey = (
  correlation: PlannedAttemptExecutorCorrelation
): PlannedAttemptProtocolGuardKey =>
  PlannedAttemptProtocolGuardKey.make(JSON.stringify({ attemptId: correlation.attemptId, runId: correlation.runId }))

const sameCorrelation = (left: PlannedAttemptExecutorCorrelation, right: PlannedAttemptExecutorCorrelation): boolean =>
  left.attemptId === right.attemptId && left.runId === right.runId

const PlannedAttemptProtocolPermitTypeId: unique symbol = Symbol.for("@dalph/PlannedAttemptProtocolPermit")

/** Opaque process-local capability proving exclusive ownership of one exact planned-attempt protocol. */
export interface PlannedAttemptProtocolPermit {
  readonly [PlannedAttemptProtocolPermitTypeId]: typeof PlannedAttemptProtocolPermitTypeId
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly release: Effect.Effect<void>
}

export interface PlannedAttemptProtocolControllerService {
  readonly reserve: (
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<Option.Option<PlannedAttemptProtocolPermit>>
  readonly withPermit: <A, E, R>(
    correlation: PlannedAttemptExecutorCorrelation,
    use: (permit: PlannedAttemptProtocolPermit) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>
}

/** Owns all process-local exclusion between executor protocol changes and exact-attempt abandonment. */
export class PlannedAttemptProtocolController extends Context.Service<
  PlannedAttemptProtocolController,
  PlannedAttemptProtocolControllerService
>()("@dalph/PlannedAttemptProtocolController") {}

type GuardOwners = ReadonlyMap<PlannedAttemptProtocolGuardKey, Deferred.Deferred<void>>

/** Constructs one empty controller; process restart constructs another and reconstructs truth only from the journal. */
export const makePlannedAttemptProtocolController = Effect.fn("PlannedAttemptProtocolController.make")(function* () {
  const owners = yield* Ref.make<GuardOwners>(new Map())

  const permitOf = (
    correlation: PlannedAttemptExecutorCorrelation,
    key: PlannedAttemptProtocolGuardKey,
    released: Deferred.Deferred<void>
  ): PlannedAttemptProtocolPermit => ({
    [PlannedAttemptProtocolPermitTypeId]: PlannedAttemptProtocolPermitTypeId,
    correlation,
    release: Ref.modify(owners, (current) => {
      if (current.get(key) !== released) return [false, current] as const
      const next = new Map(current)
      next.delete(key)
      return [true, next] as const
    }).pipe(Effect.flatMap((didRelease) => (didRelease ? Deferred.succeed(released, undefined) : Effect.void)))
  })

  const tryAcquire = Effect.fn("PlannedAttemptProtocolController.tryAcquire")(function* (
    correlation: PlannedAttemptExecutorCorrelation
  ) {
    const key = plannedAttemptProtocolGuardKey(correlation)
    const released = yield* Deferred.make<void>()
    const acquired = yield* Ref.modify(owners, (current) => {
      if (current.has(key)) return [false, current] as const
      return [true, new Map(current).set(key, released)] as const
    })
    return acquired ? Option.some(permitOf(correlation, key, released)) : Option.none()
  })

  const acquire = Effect.fn("PlannedAttemptProtocolController.acquire")(function* (
    correlation: PlannedAttemptExecutorCorrelation
  ): Effect.fn.Return<PlannedAttemptProtocolPermit> {
    const reserved = yield* tryAcquire(correlation)
    if (Option.isSome(reserved)) return reserved.value
    const occupied = yield* Ref.get(owners).pipe(
      Effect.map((current) => current.get(plannedAttemptProtocolGuardKey(correlation)))
    )
    if (occupied !== undefined) yield* Deferred.await(occupied)
    return yield* acquire(correlation)
  })

  return PlannedAttemptProtocolController.of({
    reserve: tryAcquire,
    withPermit: (correlation, use) => Effect.acquireUseRelease(acquire(correlation), use, ({ release }) => release)
  })
})

export const plannedAttemptProtocolControllerLayer = Layer.effect(
  PlannedAttemptProtocolController,
  makePlannedAttemptProtocolController()
)

/** Runs trusted internal protocol work only when the capability belongs to the same exact attempt. */
export const withPlannedAttemptProtocolPermit = <A, E, R>(
  permit: PlannedAttemptProtocolPermit,
  correlation: PlannedAttemptExecutorCorrelation,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  sameCorrelation(permit.correlation, correlation)
    ? effect
    : Effect.die(
        new Error(
          `planned-attempt protocol permit ${permit.correlation.runId}/${permit.correlation.attemptId} cannot guard ${correlation.runId}/${correlation.attemptId}`
        )
      )
