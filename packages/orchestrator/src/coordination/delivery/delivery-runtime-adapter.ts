import { Effect } from "effect"
import {
  TrackerGraphRelation,
  DeliveryRuntimeAssembly,
  type CurrentSignal,
  type DeliveryConsequences
} from "./relations.js"
import { delivery } from "./delivery.js"

/**
 * Adapts the descriptive delivery projections to the pre-existing runtime
 * controller. Runtime evaluation, action proposals, and process-local facts
 * remain outside the public `delivery` Effect.
 */
export const deliveryRuntimeFrom = <E>(consequences: CurrentSignal<DeliveryConsequences, E>) =>
  Effect.gen(function* () {
    const trackerGraph = yield* TrackerGraphRelation
    const assembly = yield* DeliveryRuntimeAssembly
    return assembly.of({ delivery: consequences, trackerGraph })
  })

export const deliveryRuntime = Effect.gen(function* () {
  const consequences = yield* delivery
  return yield* deliveryRuntimeFrom(consequences)
})
