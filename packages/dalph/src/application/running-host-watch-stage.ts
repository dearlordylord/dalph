import { Deferred, Effect, Fiber, Queue, Ref, Stream } from "effect"
import { type RunningHostError } from "./running-host-contract.js"

/** The pump owns the loss-free upstream scope. A writer never backpressures it.
 * Only initial, latest pending and the consumer's in-flight value are retained
 * here. Upstream scheduler/projection stalls can still retain an unbounded queue. */
export const makeRunningHostWatchStage = Effect.fn("RunningHostWatch.makeStage")(function* <A>(
  source: Stream.Stream<A, RunningHostError>,
  ends: (value: A) => boolean,
  failure: (error: RunningHostError) => A
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
    awaitReleased: Deferred.await(released),
    stop: Fiber.interrupt(pump).pipe(Effect.asVoid)
  }
})
