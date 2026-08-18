import { Effect } from "effect"
import {
  TrackerGraphRelation,
  boundedParallelTickets,
  deliverySettlements,
  executorResponsibilities,
  mapCurrentSignal,
  reflectDeliverySettlements
} from "./relations.js"
import { frontierOf } from "./ticket-delivery-projection.js"

/**
 * Shows, at one abstraction level, how current tracker facts become delivery
 * consequences.
 *
 * Architecture catalogue: [Protected Compositions](../../../../../docs/ARCHITECTURE.md#protected-compositions).
 *
 * Every arrow below is a pure projection, so none of them is a model-based
 * testing target; what covers each one is recorded per surface in
 * `research/verification-bakeoff/INVARIANTS.md`, under "Coverage per production
 * surface".
 */
export const delivery = Effect.gen(function* () {
  const trackerGraph = yield* TrackerGraphRelation

  const graph = trackerGraph.signal
  const frontier = mapCurrentSignal(graph, frontierOf)
  const tickets = yield* boundedParallelTickets(frontier)
  const responsibilities = yield* executorResponsibilities(tickets)
  const settlements = yield* deliverySettlements(responsibilities)

  return yield* reflectDeliverySettlements(settlements)
})
