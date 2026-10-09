import { Deferred, Effect, Fiber, Queue, Ref, Stream } from "effect"
import { type RunningHostError } from "./running-host-contract.js"

/** Drain before disposable preparation. Raw values borrow shared canonical state;
 * presentation callers must supply byte admission, not rely on item count. */
export const makeRunningHostWatchStage = Effect.fn("RunningHostWatch.makeStage")(function* <A>(
  source: Stream.Stream<A, RunningHostError>,
  ends: (value: A) => boolean,
  failure: (error: RunningHostError) => A,
  admit: (value: A) => Effect.Effect<unknown, RunningHostError> = () => Effect.void
) {
  const initial = yield* Deferred.make<void>()
  const pinned = yield* Ref.make<A | null>(null)
  const pending = yield* Ref.make<A | null>(null)
  const wake = yield* Queue.sliding<void>(1)
  const hints = yield* Queue.sliding<void>(1)
  const released = yield* Deferred.make<void>()
  let first = true
  let terminal: A | null = null
  const offer = (value: A) =>
    Ref.set(pending, value).pipe(
      Effect.andThen(Queue.offer(wake, undefined)),
      Effect.andThen(Queue.offer(hints, undefined))
    )
  const pump = yield* Effect.scoped(
    source.pipe(
      Stream.takeUntil(ends),
      Stream.runForEach((value) =>
        Effect.gen(function* () {
          yield* admit(value)
          if (ends(value)) {
            terminal = value
            return
          }
          if (first) {
            first = false
            yield* Ref.set(pinned, value)
            yield* Deferred.succeed(initial, undefined)
          } else yield* offer(value)
        })
      )
    )
  ).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        terminal = failure(error)
      })
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const final =
          terminal ?? failure({ _tag: "TransportFailed", phase: "Watch", reason: "SourceEndedBeforeClosed" })
        if (first) {
          yield* Ref.set(pinned, final)
          yield* Deferred.succeed(initial, undefined)
        } else yield* offer(final)
        yield* Deferred.succeed(released, undefined)
      })
    ),
    Effect.ensuring(Deferred.succeed(released, undefined)),
    Effect.forkScoped
  )
  yield* Deferred.await(initial)
  const takeInitial = Ref.getAndSet(pinned, null).pipe(
    Effect.flatMap((value) => (value === null ? Effect.die("Watch initial already consumed") : Effect.succeed(value)))
  )
  const take = Effect.fn("RunningHostWatch.take")(function* (): Effect.fn.Return<A> {
    for (;;) {
      const value = yield* Ref.getAndSet(pending, null)
      if (value !== null) return value
      yield* Queue.take(wake)
    }
  })
  return {
    takeInitial,
    take: take(),
    poll: Ref.getAndSet(pending, null),
    changed: Queue.take(hints),
    hasPending: Ref.get(pending).pipe(Effect.map((value) => value !== null)),
    /** Diagnostic inventory; borrowed canonical and owned presentation values
     * are charged separately by their callers. This does not copy the values. */
    retained: Effect.all({ initial: Ref.get(pinned), pending: Ref.get(pending) }),
    awaitReleased: Deferred.await(released),
    stop: Fiber.interrupt(pump).pipe(
      Effect.andThen(Ref.set(pinned, null)),
      Effect.andThen(Ref.set(pending, null)),
      Effect.andThen(
        Effect.sync(() => {
          terminal = null
        })
      ),
      Effect.asVoid
    )
  }
})
