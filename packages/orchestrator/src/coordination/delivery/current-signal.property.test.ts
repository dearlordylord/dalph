import { it } from "@effect/vitest"
import { Effect, Stream } from "effect"
import * as fc from "fast-check"
import { expect } from "vitest"
import {
  attachCurrentSignal,
  makeCurrentSignal,
  mapCurrentSignal,
  zipCurrentSignals,
  type CurrentSignal
} from "./relations.js"

const finiteSignal = <A>(values: readonly [A, ...ReadonlyArray<A>]): CurrentSignal<A> =>
  makeCurrentSignal({ changes: Stream.fromIterable(values), get: Effect.succeed(values[0]) })

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

it.effect("zip-latest preserves generated current values and reaches both latest publications", () =>
  Effect.promise(() =>
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        async (leftLength, rightLength) => {
          const left: readonly [number, ...ReadonlyArray<number>] = [
            0,
            ...Array.from({ length: leftLength - 1 }, (_, index) => index + 1)
          ]
          const right: readonly [number, ...ReadonlyArray<number>] = [
            1_000,
            ...Array.from({ length: rightLength - 1 }, (_, index) => 1_001 + index)
          ]
          const zipped = zipCurrentSignals(
            finiteSignal([left[0], ...left.slice(1)]),
            finiteSignal([right[0], ...right.slice(1)])
          )
          const observed = await Effect.runPromise(attachedValues(zipped))

          expect(observed[0]).toEqual([left[0], right[0]])
          expect(observed.at(-1)).toEqual([left.at(-1), right.at(-1)])
          expect(
            observed.every(([leftValue, rightValue]) => left.includes(leftValue) && right.includes(rightValue))
          ).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  )
)
