import { Deferred, Effect, Ref } from "effect"
import {
  authoredPlannedSuspensionBoundaryKeyOf,
  type AuthoredPlannedSuspensionBoundaryCorrelation
} from "./authored-domain.js"

/** One harness-only exact Suspend boundary waiting for its paired release. */
interface PlannedSuspensionBoundaryGate {
  readonly ready: Deferred.Deferred<void>
  readonly release: Deferred.Deferred<void>
}

/**
 * Correlation-keyed harness control for exact planned-attempt Suspend calls.
 * Readiness is acknowledged at the real boundary, so a scripted release can
 * neither race ahead nor open a sibling task's gate.
 */
interface PlannedSuspensionBoundaryGates {
  readonly arm: (correlation: AuthoredPlannedSuspensionBoundaryCorrelation) => Effect.Effect<void>
  readonly awaitBoundary: (correlation: AuthoredPlannedSuspensionBoundaryCorrelation) => Effect.Effect<void>
  readonly release: (correlation: AuthoredPlannedSuspensionBoundaryCorrelation) => Effect.Effect<void>
}

export const makePlannedSuspensionBoundaryGates: Effect.Effect<PlannedSuspensionBoundaryGates> = Effect.gen(
  function* () {
    const state = yield* Ref.make<ReadonlyMap<string, PlannedSuspensionBoundaryGate>>(new Map())

    const arm = Effect.fn("PlannedSuspensionBoundaryGates.arm")(function* (
      correlation: AuthoredPlannedSuspensionBoundaryCorrelation
    ) {
      const key = authoredPlannedSuspensionBoundaryKeyOf(correlation)
      const ready = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const inserted = yield* Ref.modify(state, (current) =>
        current.has(key) ? [false, current] : [true, new Map(current).set(key, { ready, release })]
      )
      if (!inserted) return yield* Effect.die(`planned suspension hold ${key} is already active`)
    })

    const awaitBoundary = Effect.fn("PlannedSuspensionBoundaryGates.awaitBoundary")(function* (
      correlation: AuthoredPlannedSuspensionBoundaryCorrelation
    ) {
      const key = authoredPlannedSuspensionBoundaryKeyOf(correlation)
      const gate = (yield* Ref.get(state)).get(key)
      if (gate === undefined) return
      const firstArrival = yield* Deferred.succeed(gate.ready, undefined)
      /* v8 ignore next -- @preserve One exact authored hold controls one exact executor boundary occurrence. */
      if (!firstArrival) return yield* Effect.die(`planned suspension boundary ${key} arrived more than once`)
      yield* Deferred.await(gate.release)
    })

    const release = Effect.fn("PlannedSuspensionBoundaryGates.release")(function* (
      correlation: AuthoredPlannedSuspensionBoundaryCorrelation
    ) {
      const key = authoredPlannedSuspensionBoundaryKeyOf(correlation)
      const current = yield* Ref.get(state)
      const gate = current.get(key)
      if (gate === undefined) return yield* Effect.die(`no held planned suspension matches ${key}`)
      yield* Deferred.await(gate.ready)
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const firstRelease = yield* Deferred.succeed(gate.release, undefined)
          if (!firstRelease) return yield* Effect.die(`planned suspension release ${key} was already completed`)
          const removed = yield* Ref.modify(state, (latest) => {
            if (latest.get(key) !== gate) return [false, latest]
            const remaining = new Map([...latest].filter(([candidate]) => candidate !== key))
            return [true, remaining]
          })
          if (!removed) return yield* Effect.die(`planned suspension release ${key} was replaced before deletion`)
        })
      )
    })

    return { arm, awaitBoundary, release }
  }
)
