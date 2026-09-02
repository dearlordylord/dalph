import type {
  DeliveryRuntimeEvaluation,
  DeliveryRuntimeLiveOwnerSnapshot,
  DeliveryRuntimeReadyObservation
} from "@dalph/orchestrator"
import { Effect, Ref } from "effect"

interface AuthoredRuntimeObservationCaptureOptions<Correlation> {
  readonly captureEvaluation: (evaluation: DeliveryRuntimeEvaluation, correlation: Correlation) => Effect.Effect<void>
  readonly captureOwners: (
    liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>,
    correlation: Correlation
  ) => Effect.Effect<void>
  readonly correlate: () => Effect.Effect<Correlation>
}

/** Internal cassette observer: every callback captures its evaluation; only owner changes capture owner state. */
export const makeAuthoredRuntimeObservationCaptureObserver = Effect.fn(
  "AuthoredCassette.makeRuntimeObservationCaptureObserver"
)(function* <Correlation>(options: AuthoredRuntimeObservationCaptureOptions<Correlation>) {
  const lastRuntimeOwners = yield* Ref.make<string | null>(null)
  return {
    observe: (observation) =>
      Effect.gen(function* () {
        const correlation = yield* options.correlate()
        yield* options.captureEvaluation(observation.evaluation, correlation)
        const identity = JSON.stringify(observation.liveOwners)
        const previous = yield* Ref.get(lastRuntimeOwners)
        if (previous === identity) return
        yield* Ref.set(lastRuntimeOwners, identity)
        if (previous === null && observation.liveOwners.length === 0) return
        yield* options.captureOwners(observation.liveOwners, correlation)
      })
  } satisfies { readonly observe: (observation: DeliveryRuntimeReadyObservation) => Effect.Effect<void> }
})
