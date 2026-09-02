import type {
  DeliveryRuntimeEvaluation,
  DeliveryRuntimeLiveOwnerSnapshot,
  DeliveryRuntimeReadyObservation
} from "@dalph/orchestrator"
import { Effect, Ref } from "effect"

interface AuthoredRuntimeOwnerCaptureOptions<Correlation> {
  readonly captureOwners: (
    liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>,
    correlation: Correlation
  ) => Effect.Effect<void>
  readonly correlateOwners: () => Effect.Effect<Correlation>
}

interface AuthoredRuntimeEvaluationCaptureOptions<Correlation> {
  readonly captureEvaluation: (evaluation: DeliveryRuntimeEvaluation, correlation: Correlation) => Effect.Effect<void>
  readonly correlateEvaluation: () => Effect.Effect<Correlation>
}

/** Internal cassette observer: every callback captures its evaluation; only owner changes capture owner state. */
export const makeAuthoredRuntimeObservationCaptureObserver = Effect.fn(
  "AuthoredCassette.makeRuntimeObservationCaptureObserver"
)(function* <OwnerCorrelation, EvaluationCorrelation>(
  ownerOptions: AuthoredRuntimeOwnerCaptureOptions<OwnerCorrelation>,
  evaluationOptions?: AuthoredRuntimeEvaluationCaptureOptions<EvaluationCorrelation>
) {
  const lastRuntimeOwners = yield* Ref.make<string | null>(null)
  return {
    observe: (observation) =>
      Effect.gen(function* () {
        if (evaluationOptions !== undefined) {
          const correlation = yield* evaluationOptions.correlateEvaluation()
          yield* evaluationOptions.captureEvaluation(observation.evaluation, correlation)
        }
        const identity = JSON.stringify(observation.liveOwners)
        const previous = yield* Ref.get(lastRuntimeOwners)
        if (previous === identity) return
        yield* Ref.set(lastRuntimeOwners, identity)
        if (previous === null && observation.liveOwners.length === 0) return
        const correlation = yield* ownerOptions.correlateOwners()
        yield* ownerOptions.captureOwners(observation.liveOwners, correlation)
      })
  } satisfies { readonly observe: (observation: DeliveryRuntimeReadyObservation) => Effect.Effect<void> }
})
