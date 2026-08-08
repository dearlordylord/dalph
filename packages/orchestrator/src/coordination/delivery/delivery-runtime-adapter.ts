import { Effect } from "effect"
import { deliveryActionPlanning } from "./delivery-action-planning.js"
import { DeliveryRuntimeAssembly, type CurrentSignal, type DeliveryConsequences } from "./relations.js"
import { delivery } from "./delivery.js"

/**
 * Adapts descriptive delivery and planned actions to one coherent runtime
 * evaluation signal. Process-local admission facts remain outside `delivery`.
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
