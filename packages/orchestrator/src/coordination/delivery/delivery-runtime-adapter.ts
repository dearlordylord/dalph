import { Effect } from "effect"
import { deliveryActionPlanning } from "./delivery-action-planning.js"
import { DeliveryRuntimeAssembly, type CurrentSignal, type DeliveryConsequences } from "./relations.js"
import { delivery } from "./delivery.js"

/**
 * Adapts the descriptive delivery projections to the pre-existing runtime
 * controller. Runtime evaluation, action proposals, and process-local facts
 * remain outside the public `delivery` Effect.
 */
export const deliveryRuntimeFrom = <E>(consequences: CurrentSignal<DeliveryConsequences, E>) =>
  Effect.gen(function* () {
    const proposedActions = yield* deliveryActionPlanning(consequences)
    const assembly = yield* DeliveryRuntimeAssembly
    return assembly.of({ delivery: consequences, proposedActions })
  })

export const deliveryRuntime = Effect.gen(function* () {
  const consequences = yield* delivery
  return yield* deliveryRuntimeFrom(consequences)
})
