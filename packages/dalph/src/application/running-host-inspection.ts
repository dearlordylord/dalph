import { type TaskDagSnapshot, TaskDagWire, TrackerGraphReader, type TrackerTarget } from "@dalph/orchestrator"
import {
  Clock,
  Context,
  Effect,
  Exit,
  Fiber,
  Option,
  Schedule,
  Schema,
  Scope,
  type Stream,
  SubscriptionRef
} from "effect"

/** Wall-clock observation time; it never orders tracker revisions or journal facts. */
export const InspectionObservedAt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("InspectionObservedAt")
)

const InspectionGraph = Schema.Struct({ graph: TaskDagWire, observedAt: InspectionObservedAt })

export const RunningHostInspection = Schema.TaggedUnion({
  Loading: {},
  Unavailable: { failedAt: InspectionObservedAt, reason: Schema.NonEmptyString },
  Ready: { value: InspectionGraph },
  Stale: { value: InspectionGraph, failedAt: InspectionObservedAt, reason: Schema.NonEmptyString }
})
export type RunningHostInspection = typeof RunningHostInspection.Type

export interface RunningHostInspectionService {
  readonly current: Effect.Effect<RunningHostInspection>
  readonly changes: Stream.Stream<RunningHostInspection>
  readonly refresh: Effect.Effect<void>
  readonly stop: Effect.Effect<void>
}

/** One process-local observation owner over the already composed tracker reader.
 * Its observations never feed workflow authority or persist in the journal. */
export const makeRunningHostInspection: (
  reader: TrackerGraphReader["Service"],
  target: TrackerTarget
) => Effect.Effect<RunningHostInspectionService, never, Scope.Scope> = Effect.fn("RunningHostInspection.make")(
  function* (
    reader: TrackerGraphReader["Service"],
    target: TrackerTarget
  ): Effect.fn.Return<RunningHostInspectionService, never, Scope.Scope> {
    const scope = yield* Scope.fork(yield* Scope.Scope)
    const state = yield* SubscriptionRef.make<RunningHostInspection>({ _tag: "Loading" })
    const observe = Effect.fn("RunningHostInspection.observe")(function* (snapshot: TaskDagSnapshot) {
      const observedAt = InspectionObservedAt.make(yield* Clock.currentTimeMillis)
      yield* SubscriptionRef.set(state, { _tag: "Ready", value: { graph: snapshot.toWire(), observedAt } })
    })
    const refresh = yield* Effect.cachedWithTTL(
      reader.read(target).pipe(
        Effect.tap(observe),
        Effect.asVoid,
        Effect.timeoutOrElse({
          duration: "30 seconds",
          orElse: () => Effect.fail({ _tag: "InspectionReadTimedOut" } as const)
        }),
        Effect.catch((error) =>
          Effect.gen(function* () {
            const failedAt = InspectionObservedAt.make(yield* Clock.currentTimeMillis)
            yield* SubscriptionRef.update(
              state,
              (current): RunningHostInspection =>
                current._tag === "Ready" || current._tag === "Stale"
                  ? { _tag: "Stale", value: current.value, failedAt, reason: error._tag }
                  : { _tag: "Unavailable", failedAt, reason: error._tag }
            )
          })
        )
      ),
      "0 millis"
    )
    // Scope-owned fibers survive an individual observer's disconnect. The Effect
    // memoizer shares only the pending read; completed reads are never TTL-cached.
    const refreshOwned = refresh.pipe(Effect.forkIn(scope), Effect.flatMap(Fiber.join))
    const refreshLoop = yield* refreshOwned.pipe(Effect.repeat(Schedule.fixed("30 seconds")), Effect.forkIn(scope))
    const stop = Fiber.interrupt(refreshLoop).pipe(Effect.andThen(Scope.close(scope, Exit.succeed(undefined))))
    // Stop the loop before its nested read fibers; closing a sequential scope
    // while the loop joins its read can otherwise leave that join suspended.
    yield* Effect.addFinalizer(() => stop)
    return { current: SubscriptionRef.get(state), changes: SubscriptionRef.changes(state), refresh: refreshOwned, stop }
  }
)

/** Select the reader already retained in the production Run context. Missing
 * capability means no inspection; it never constructs a replacement reader. */
export const runningHostInspectionFromServices = <R>(services: Context.Context<R>, target: TrackerTarget) =>
  Context.getOption(services, TrackerGraphReader).pipe(
    Option.map((reader) => makeRunningHostInspection(reader, target))
  )
