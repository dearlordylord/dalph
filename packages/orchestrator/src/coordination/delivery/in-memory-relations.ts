import { Layer } from "effect"
import type { RunControlPolicy } from "../../control/policy.js"
import {
  BoundedParallelTicketsProjection,
  currentSignalOf,
  DeliveryReflectionProjection,
  DeliverySettlementProjection,
  makeDeliveryReflection,
  makeDeliverySettlements,
  mapCurrentSignal,
  TicketDeliveryProjection,
  TrackerGraphRelation,
  type CurrentSignal,
  type DeliveryActionProposal,
  type TicketDeliveryEvidence,
  type TrackerGraphState,
  zipCurrentSignals
} from "./relations.js"
import { boundedParallelTicketsOf, ticketDeliveriesOf } from "./ticket-delivery-projection.js"

export interface InMemoryDeliveryRelationsInput {
  readonly exactEvidence: CurrentSignal<ReadonlyArray<TicketDeliveryEvidence>>
  readonly graph: CurrentSignal<TrackerGraphState>
  readonly policy: CurrentSignal<RunControlPolicy>
}

/** Deterministic, action-free Layers used to evaluate the complete relation spine. */
export const makeInMemoryDeliveryRelationsLayer = (input: InMemoryDeliveryRelationsInput) => {
  const noActions = currentSignalOf<ReadonlyArray<DeliveryActionProposal>>([])
  const trackerGraph = Layer.succeed(
    TrackerGraphRelation,
    TrackerGraphRelation.of({ proposedActions: noActions, signal: input.graph })
  )
  const bounded = Layer.succeed(
    BoundedParallelTicketsProjection,
    BoundedParallelTicketsProjection.of({
      of: (frontier) =>
        mapCurrentSignal(zipCurrentSignals(frontier, input.policy), ([source, policy]) =>
          boundedParallelTicketsOf(source, policy)
        )
    })
  )
  const deliveries = Layer.succeed(
    TicketDeliveryProjection,
    TicketDeliveryProjection.of({
      of: (tickets) => ({
        current: mapCurrentSignal(zipCurrentSignals(tickets, input.exactEvidence), ([source, evidence]) =>
          ticketDeliveriesOf(source, evidence)
        ),
        proposedActions: noActions
      })
    })
  )
  const settlements = Layer.succeed(
    DeliverySettlementProjection,
    DeliverySettlementProjection.of({
      of: (relation) => ({
        current: mapCurrentSignal(relation.current, (source) => makeDeliverySettlements(source, [])),
        proposedActions: noActions
      })
    })
  )
  const reflection = Layer.succeed(
    DeliveryReflectionProjection,
    DeliveryReflectionProjection.of({
      of: (relation) => ({
        current: mapCurrentSignal(relation.current, makeDeliveryReflection),
        proposedActions: noActions
      })
    })
  )

  return Layer.mergeAll(trackerGraph, bounded, deliveries, settlements, reflection)
}
