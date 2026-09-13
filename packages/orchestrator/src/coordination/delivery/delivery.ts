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
 * Direct projection/relation tests and production-backed conformance adapters
 * are indexed in `docs/DELIVERY-INVARIANTS.md`, under "Current verification index".
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
