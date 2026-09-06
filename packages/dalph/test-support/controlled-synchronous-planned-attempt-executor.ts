import {
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  passiveLifecycleObservationPurpose
} from "@dalph/contracts"
import { Effect, Layer, Stream } from "effect"

/**
 * Installs the complete executor algebra for a controlled executor whose state
 * changes only while one of its command effects is running. Such a fixture has
 * no outside process capable of publishing a later lifecycle notification.
 */
export const controlledSynchronousPlannedAttemptExecutorLayer = <E, R>(
  executorLayer: Layer.Layer<PlannedAttemptExecutor, E, R>
): Layer.Layer<PlannedAttemptExecutor | PlannedAttemptExecutorLifecycleObservation, E, R> =>
  Layer.effect(
    PlannedAttemptExecutorLifecycleObservation,
    Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      return PlannedAttemptExecutorLifecycleObservation.of({
        attach: (correlation) =>
          executor
            .observe(correlation, passiveLifecycleObservationPurpose)
            .pipe(Effect.map((current) => ({ changes: Stream.empty, close: Effect.void, current })))
      })
    })
  ).pipe(Layer.provideMerge(executorLayer))
