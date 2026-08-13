import { it } from "@effect/vitest"
import { Effect, Fiber, SubscriptionRef, Stream } from "effect"
import * as fc from "fast-check"
import { expect } from "vitest"
import {
  attachCurrentSignal,
  currentSignalFromCurrentFirstStream,
  mapCurrentSignal,
  zipCurrentSignals,
  type CurrentSignal
} from "./relations.js"

const finiteSignal = <A>(values: readonly [A, ...ReadonlyArray<A>]): CurrentSignal<A> =>
  currentSignalFromCurrentFirstStream(Stream.fromIterable(values))

const attachedValues = <A>(signal: CurrentSignal<A>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const attachment = yield* attachCurrentSignal(signal)
      return [attachment.current, ...Array.from(yield* Stream.runCollect(attachment.changes))] as const
    })
  )

it.effect("mapping preserves every generated current-first publication and composes", () =>
  Effect.promise(() =>
    fc.assert(
      fc.asyncProperty(fc.tuple(fc.integer(), fc.array(fc.integer(), { maxLength: 29 })), async ([first, rest]) => {
        const source = finiteSignal([first, ...rest])
        const direct = mapCurrentSignal(source, (value) => value * 2 + 1)
        const composed = mapCurrentSignal(
          mapCurrentSignal(source, (value) => value * 2),
          (value) => value + 1
        )

        const [directValues, composedValues] = await Effect.runPromise(
          Effect.all([attachedValues(direct), attachedValues(composed)])
        )

        expect(directValues).toEqual([first, ...rest].map((value) => value * 2 + 1))
        expect(composedValues).toEqual(directValues)
      }),
      { numRuns: 100 }
    )
  )
)

it.effect("zip-latest preserves every publication across generated left-right schedules", () =>
  Effect.promise(() =>
    fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom("L" as const, "R" as const), { minLength: 1, maxLength: 30 }),
        async (schedule) => {
          const observed = await Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const left = yield* SubscriptionRef.make("L:0")
                const right = yield* SubscriptionRef.make("R:0")
                const attachment = yield* attachCurrentSignal(
                  zipCurrentSignals(
                    currentSignalFromCurrentFirstStream(SubscriptionRef.changes(left)),
                    currentSignalFromCurrentFirstStream(SubscriptionRef.changes(right))
                  )
                )
                const changes = yield* attachment.changes.pipe(
                  Stream.take(schedule.length),
                  Stream.runCollect,
                  Effect.forkChild
                )
                let leftOrdinal = 0
                let rightOrdinal = 0
                for (const side of schedule) {
                  if (side === "L") yield* SubscriptionRef.set(left, `L:${++leftOrdinal}`)
                  else yield* SubscriptionRef.set(right, `R:${++rightOrdinal}`)
                  yield* Effect.yieldNow
                }
                return [attachment.current, ...Array.from(yield* Fiber.join(changes))] as const
              })
            )
          )
          const expectedLeft = ["L:0", ...schedule.filter((side) => side === "L").map((_, index) => `L:${index + 1}`)]
          const expectedRight = ["R:0", ...schedule.filter((side) => side === "R").map((_, index) => `R:${index + 1}`)]

          expect(observed[0]).toEqual(["L:0", "R:0"])
          expect(new Set(observed.map(([leftValue]) => leftValue))).toEqual(new Set(expectedLeft))
          expect(new Set(observed.map(([, rightValue]) => rightValue))).toEqual(new Set(expectedRight))
        }
      ),
      { numRuns: 100 }
    )
  )
)
