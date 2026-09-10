import { Effect } from "effect"
import { makeSixTaskDeliveryRuntime } from "./six-task-delivery-runtime.js"
import { makeSixTaskDeliveryFacts } from "./six-task-delivery-facts.js"
import { makeSixTaskFinalityBoundaries } from "./six-task-finality-boundaries.js"

export type { Issue276TerminalCut } from "./six-task-delivery-runtime.js"

export const makeIssue276PositionRelease = Effect.fn("Issue276.makePositionRelease")(function* () {
  return yield* makeSixTaskDeliveryRuntime(makeSixTaskDeliveryFacts("issue-276"), {
    beforeAppend: () => Effect.void,
    afterAppend: () => Effect.void,
    makeFinality: makeSixTaskFinalityBoundaries
  })
})
