import { Effect } from "effect"
import {
  TrackerGraphRelation,
  boundedParallelTickets,
  deliverySettlements,
  executorResponsibilities,
  mapCurrentSignal,
  DeliveryReflectionProjection,
  DeliveryRuntimeAssembly
} from "./relations.js"
import { frontierOf } from "./ticket-delivery-projection.js"

/**
 * Adapts the descriptive delivery projections to the pre-existing runtime
 * controller. Runtime evaluation, action proposals, and process-local facts
 * remain outside the public `delivery` Effect.
 */
export const deliveryRuntime = Effect.gen(function* () {
  const trackerGraph = yield* TrackerGraphRelation

  const graph = trackerGraph.signal
  const frontier = mapCurrentSignal(graph, frontierOf)
  const tickets = yield* boundedParallelTickets(frontier)
  const responsibilities = yield* executorResponsibilities(tickets)
  const settlements = yield* deliverySettlements(responsibilities)

  const projection = yield* DeliveryReflectionProjection
  const assembly = yield* DeliveryRuntimeAssembly
  return assembly.of({ reflection: projection.of(settlements), trackerGraph })
})
