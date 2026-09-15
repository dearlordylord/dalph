import { Effect, type Crypto, type Scope } from "effect"
import { makeSixTaskDeliveryRuntime, type SixTaskDeliveryRuntime } from "./six-task-delivery-runtime.js"
import { makeSixTaskDeliveryFacts } from "./six-task-delivery-facts.js"
import { makeSixTaskFinalityBoundaries } from "./six-task-finality-boundaries.js"

export type { SixTaskTerminalCut as PositionReleaseTerminalCut } from "./six-task-delivery-runtime.js"

export const makePositionRelease = Effect.fn("PositionRelease.makePositionRelease")(function* (): Effect.fn.Return<
  SixTaskDeliveryRuntime,
  never,
  Crypto.Crypto | Scope.Scope
> {
  return yield* makeSixTaskDeliveryRuntime(makeSixTaskDeliveryFacts("issue-276"), {
    beforeAppend: () => Effect.void,
    afterAppend: () => Effect.void,
    makeFinality: makeSixTaskFinalityBoundaries
  })
})
