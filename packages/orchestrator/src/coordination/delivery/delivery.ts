import { Effect, Stream } from "effect"
import {
  DeliveryPublication,
  TrackerGraphRelation,
  boundedParallelTickets,
  deliverySettlements,
  executorResponsibilities,
  mapCurrentSignal,
  reflectDeliverySettlements
} from "./relations.js"
import { frontierOf } from "./ticket-delivery-projection.js"

/** Shows, at one abstraction level, how current tracker facts become delivery consequences. */
export const delivery = Effect.gen(function* () {
  const trackerGraph = yield* TrackerGraphRelation
  const publication = yield* DeliveryPublication

  const graph = trackerGraph.signal
  const frontier = mapCurrentSignal(
    { changes: Stream.zip(graph.changes, publication.signal.changes) },
    ([currentGraph, currentPublication]) => frontierOf(currentGraph, currentPublication)
  )
  const tickets = yield* boundedParallelTickets(frontier)
  const responsibilities = yield* executorResponsibilities(tickets)
  const settlements = yield* deliverySettlements(responsibilities)

  return yield* reflectDeliverySettlements(settlements)
})
