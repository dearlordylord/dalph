import { Effect, PubSub, Ref, Semaphore, Stream } from "effect"
import { makeCurrentSignal } from "../delivery/relations.js"

/** One shared canonical value plus bounded void hints. Slow subscriptions cannot
 * pin a backlog of superseded values. The publication lock fixes the initial
 * value and hint subscription at the same cut; ordinary signals stay loss-free. */
export const makeCoalescingCurrentSignal = Effect.fn("CurrentSignal.makeCoalescing")(function* <A>(initial: A) {
  const current = yield* Ref.make(initial)
  const hints = yield* PubSub.sliding<void>(1)
  const lock = yield* Semaphore.make(1)
  const signal = makeCurrentSignal(
    lock.withPermit(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(hints)
        return {
          current: yield* Ref.get(current),
          changes: Stream.fromEffectRepeat(PubSub.take(subscription)).pipe(Stream.mapEffect(() => Ref.get(current)))
        }
      })
    )
  )
  return {
    signal: { ...signal, get: Ref.get(current) },
    publish: (value: A) =>
      lock.withPermit(
        Effect.uninterruptible(
          Ref.set(current, value).pipe(Effect.andThen(PubSub.publish(hints, undefined)), Effect.asVoid)
        )
      )
  }
})
