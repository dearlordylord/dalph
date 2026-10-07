import { Duration, Effect, Schema } from "effect"
import { writeCoverageLifecycle, type CoverageLifecycleObservation } from "../../../scripts/coverage-lifecycle.js"

/** A failed acceptance wait names its original budget and exact observed boundary. */
export class AcceptanceWaitTimedOut extends Schema.TaggedError<AcceptanceWaitTimedOut>()("AcceptanceWaitTimedOut", {
  testCase: Schema.String,
  boundary: Schema.String,
  timeoutMilliseconds: Schema.Number
}) {}

export const waitForAcceptanceBoundary =
  (
    testCase: string,
    boundary: string,
    duration: Duration.Input,
    emit: (observation: CoverageLifecycleObservation) => void = writeCoverageLifecycle
  ) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.sync(() => emit({ phase: "WaitStarted", owner: testCase, boundary })).pipe(
      Effect.andThen(
        effect.pipe(
          Effect.timeoutOrElse({
            duration,
            orElse: () =>
              Effect.sync(() => emit({ phase: "WaitTimedOut", owner: testCase, boundary, outcome: "TimedOut" })).pipe(
                Effect.andThen(
                  Effect.fail(
                    new AcceptanceWaitTimedOut({
                      testCase,
                      boundary,
                      timeoutMilliseconds: Duration.toMillis(Duration.fromInputUnsafe(duration))
                    })
                  )
                )
              )
          }),
          Effect.onExit((exit) =>
            Effect.sync(() => emit({ phase: "WaitFinished", owner: testCase, boundary, outcome: exit._tag }))
          )
        )
      )
    )

/** Observe the existing scoped lifetime; finalizers and their order remain unchanged. */
export const observeAcceptanceScope =
  (owner: string, emit: (observation: CoverageLifecycleObservation) => void = writeCoverageLifecycle) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.scoped(
      effect.pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => emit({ phase: "ScopeFinalizationStarted", owner, outcome: exit._tag }))
        )
      )
    ).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => emit({ phase: "ScopeFinalizationFinished", owner, outcome: exit._tag }))
      )
    )
