// THROWAWAY: qualify one adapter-stage policy; not a production graph contract.
import { it } from "@effect/vitest"
import { attachCurrentSignal, currentSignalFromCurrentFirstStream } from "@dalph/orchestrator"
import { Deferred, Effect, Fiber, Stream, SubscriptionRef } from "effect"
import { expect } from "vitest"

type Value = { readonly _tag: "Ready"; readonly n: number } | { readonly _tag: "Closed"; readonly final: number }
const ready = (n: number): Value => ({ _tag: "Ready", n })
const closed: Value = { _tag: "Closed", final: 8 }

for (const closeWhileHeld of [false, true]) {
 it.effect(`sliding adapter retains latest state and Closed; close while held=${closeWhileHeld}`, () =>
  Effect.scoped(Effect.gen(function* () {
   const source = yield* SubscriptionRef.make<Value>(ready(0))
   const attachment = yield* attachCurrentSignal(currentSignalFromCurrentFirstStream(
    SubscriptionRef.changes(source).pipe(Stream.takeUntil(v=>v._tag==="Closed"))
   ))
   const entered = yield* Deferred.make<void>()
   const release = yield* Deferred.make<void>()
   const latestDrained = yield* Deferred.make<void>()
   const closedDrained = yield* Deferred.make<void>()
   const sawLatest = yield* Deferred.make<void>()
   const writer = yield* attachment.changes.pipe(
    Stream.mapEffect(value=> Effect.gen(function*(){
      if(value._tag==="Ready" && value.n===8) yield* Deferred.succeed(latestDrained,undefined)
      if(value._tag==="Closed") yield* Deferred.succeed(closedDrained,undefined)
      return value
    })),
    Stream.buffer({capacity:1,strategy:"sliding"}),
    Stream.mapEffect(value=>Effect.gen(function*(){
      if(value._tag==="Ready" && value.n===1){yield* Deferred.succeed(entered,undefined);yield* Deferred.await(release)}
      if(value._tag==="Ready" && value.n===8) yield* Deferred.succeed(sawLatest,undefined)
      return value
    })),Stream.runCollect,Effect.forkChild
   )
   yield* SubscriptionRef.set(source,ready(1))
   yield* Deferred.await(entered)
   for(let n=2;n<=8;n++) yield* SubscriptionRef.set(source,ready(n))
   yield* Deferred.await(latestDrained)
   if(closeWhileHeld){yield* SubscriptionRef.set(source,closed);yield* Deferred.await(closedDrained)}
   // Let the buffer finish offering the last mapped value before releasing writer.
   yield* Effect.yieldNow
   yield* Deferred.succeed(release,undefined)
   if(!closeWhileHeld){yield* Deferred.await(sawLatest);yield* SubscriptionRef.set(source,closed)}
   const observed=Array.from(yield* Fiber.join(writer))
   expect(attachment.current).toEqual(ready(0))
   expect(observed).toEqual(closeWhileHeld ? [ready(1),closed] : [ready(1),ready(8),closed])
   console.log(JSON.stringify({closeWhileHeld,current:attachment.current,observed}))
  }))
 )
}
