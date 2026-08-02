import { Effect } from "effect"
import {
  TrackerGraphRelation,
  boundedParallelTickets,
  deliverySettlements,
  executorResponsibilities,
  frontierOf,
  mapCurrentSignal,
  reflectDeliverySettlements
} from "./relations.js"

/** Shows, at one abstraction level, how current tracker facts become delivery consequences. */
export const delivery = Effect.gen(function* () {
  const trackerGraph = yield* TrackerGraphRelation

  const graph = trackerGraph.signal
  const frontier = mapCurrentSignal(graph, frontierOf)
  const tickets = yield* boundedParallelTickets(frontier)
  const responsibilities = yield* executorResponsibilities(tickets)
  const settlements = yield* deliverySettlements(responsibilities)

  return yield* reflectDeliverySettlements(settlements)
})
