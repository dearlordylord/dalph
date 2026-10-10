import { type ApplicationExitResult, applicationExitDrainDuration } from "@dalph/orchestrator"
import { Cause, Clock, Context, Deferred, Duration, Effect, Option, Ref, Schema } from "effect"

/** The bounded chance for CLI output to settle after the lifecycle result exists. */
const CliExitOutputGraceDuration = Schema.DurationFromString.check(
  Schema.makeFilter((duration) =>
    Duration.isFinite(duration) && Duration.isPositive(duration)
      ? undefined
      : "output grace must be finite and positive"
  )
).pipe(Schema.brand("CliExitOutputGraceDuration"))

const outputGraceMilliseconds = 500
const outputGraceDuration = CliExitOutputGraceDuration.make(Duration.millis(outputGraceMilliseconds))

/**
 * The lifecycle result exists, but CLI output did not settle within its allowance.
 * This process-local outcome permits incomplete stdout; it proves no workflow
 * settlement or successful flush. Node ends the process only after host finalization.
 */
export class CliExitOutputAbandoned extends Schema.TaggedError<CliExitOutputAbandoned>()("CliExitOutputAbandoned", {
  requestedStatus: Schema.Literals([0, 1])
}) {}

/** Output abandonment cannot hide a failure or interruption during host finalization. */
export const abandonedCliOutputProcessStatus = (cause: Cause.Cause<unknown>): Option.Option<0 | 1> => {
  const abandonment = cause.reasons.find(
    (reason) => Cause.isFailReason(reason) && reason.error instanceof CliExitOutputAbandoned
  )
  if (
    abandonment === undefined ||
    !Cause.isFailReason(abandonment) ||
    !(abandonment.error instanceof CliExitOutputAbandoned)
  ) {
    return Option.none()
  }
  const requestedStatus = abandonment.error.requestedStatus
  return Option.some(
    cause.reasons.every(
      (reason) =>
        Cause.isFailReason(reason) &&
        reason.error instanceof CliExitOutputAbandoned &&
        reason.error.requestedStatus === requestedStatus
    )
      ? requestedStatus
      : 1
  )
}

/** Remembers output abandonment across host finalizers that replace the original cause. */
class CliExitOutputCompletion extends Context.Service<
  CliExitOutputCompletion,
  { readonly record: (status: 0 | 1) => Effect.Effect<void> }
>()("dalph/CliExitOutputCompletion") {}

/** The Node invocation owns this process-local record until all host scopes close. */
export const retainCliExitOutputCompletion = <A, E, R>(application: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const abandoned = yield* Ref.make<Option.Option<0 | 1>>(Option.none())
    return yield* application.pipe(
      Effect.provideService(CliExitOutputCompletion, { record: (status) => Ref.set(abandoned, Option.some(status)) }),
      Effect.catchCause((cause) =>
        Ref.get(abandoned).pipe(
          Effect.flatMap((status) =>
            Option.isSome(status) && Option.isNone(abandonedCliOutputProcessStatus(cause))
              ? Effect.failCause(
                  Cause.combine(cause, Cause.fail(new CliExitOutputAbandoned({ requestedStatus: status.value })))
                )
              : Effect.failCause(cause)
          )
        )
      )
    )
  })

interface ExitObservation {
  readonly awaitRequest: Effect.Effect<void>
  /** Production transports retain the first receipt even if this observer runs late. */
  readonly awaitRequestTime?: Effect.Effect<bigint>
  readonly awaitResult: Effect.Effect<ApplicationExitResult>
}

/** One first-request clock and one shared allowance for admitted and final output. */
export const withCliExitOutputGrace = <A, E, R>(
  observation: ExitObservation,
  present: (observation: ExitObservation) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | CliExitOutputAbandoned, R> =>
  Effect.scoped(
    Effect.gen(function* () {
      const request = yield* Deferred.make<void>()
      const result = yield* Deferred.make<ApplicationExitResult>()
      const stopOutput = Effect.gen(function* () {
        yield* observation.awaitRequest
        // Production uses the transport's retained receipt, before shell cutoff.
        // Controlled callers without a transport observe their request directly.
        const requestedAt = yield* observation.awaitRequestTime ?? Clock.monotonicTimeNanos
        yield* Deferred.succeed(request, undefined)
        const completed = yield* observation.awaitResult
        yield* Deferred.succeed(result, completed)
        const elapsed = (yield* Clock.monotonicTimeNanos) - requestedAt
        const remaining = Duration.toNanosUnsafe(applicationExitDrainDuration) - elapsed
        const allowance =
          completed._tag === "TimedOut" || remaining <= 0n
            ? 0n
            : remaining < Duration.toNanosUnsafe(outputGraceDuration)
              ? remaining
              : Duration.toNanosUnsafe(outputGraceDuration)
        yield* Effect.sleep(Duration.nanos(allowance))
        const completion = yield* Effect.serviceOption(CliExitOutputCompletion)
        if (Option.isSome(completion)) yield* completion.value.record(completed.requestedStatus)
        return yield* new CliExitOutputAbandoned({ requestedStatus: completed.requestedStatus })
      })
      return yield* Effect.raceFirst(
        present({ awaitRequest: Deferred.await(request), awaitResult: Deferred.await(result) }),
        stopOutput
      )
    })
  )
