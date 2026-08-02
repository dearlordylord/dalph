import { Layer } from "effect"
import type { RunControlPolicy } from "../../control/policy.js"
import {
  BoundedParallelTicketsProjection,
  currentSignalOf,
  DeliveryReflectionProjection,
  DeliveryRuntimeAssembly,
  DeliverySettlementProjection,
  makeDeliveryReflection,
  makeDeliveryRuntimeRelation,
  makeDeliverySettlements,
  mapCurrentSignal,
  TicketDeliveryProjection,
  TrackerGraphRelation,
  type CurrentSignal,
  type DeliveryActionProposal,
  type TrackerGraphActionProposal,
  type TicketDeliveryEvidence,
  type TrackerGraphState,
  zipCurrentSignals
} from "./relations.js"
import { boundedParallelTicketsOf, ticketDeliveriesOf } from "./ticket-delivery-projection.js"
import type { DeliveryProposalContributions } from "./delivery-proposal.js"

export interface DeliveryRelationsLayerInput {
  readonly exactEvidence: CurrentSignal<ReadonlyArray<TicketDeliveryEvidence>>
  readonly graph: CurrentSignal<TrackerGraphState>
  readonly policy: CurrentSignal<RunControlPolicy>
  readonly proposalContributions?: CurrentSignal<DeliveryProposalContributions>
  readonly reflectionProposals?: CurrentSignal<ReadonlyArray<DeliveryActionProposal>>
  readonly trackerGraphProposals?: CurrentSignal<ReadonlyArray<TrackerGraphActionProposal>>
}

/** Deterministic, action-free Layers used to evaluate the complete relation spine. */
export const makeDeliveryRelationsLayer = (input: DeliveryRelationsLayerInput) => {
  const noActions = currentSignalOf<ReadonlyArray<DeliveryActionProposal>>([])
  const noTrackerActions = currentSignalOf<ReadonlyArray<TrackerGraphActionProposal>>([])
  const noProposalContributions = currentSignalOf<DeliveryProposalContributions>({
    deliverySettlement: [],
    issues: [],
    selectedTransitionKeys: [],
    ticketDelivery: []
  })
  const trackerGraphService = TrackerGraphRelation.of({
    proposedActions: input.trackerGraphProposals ?? noTrackerActions,
    signal: input.graph
  })
  const trackerGraph = Layer.succeed(TrackerGraphRelation, trackerGraphService)
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
        proposalContributions: input.proposalContributions ?? noProposalContributions,
        proposedActions: mapCurrentSignal(
          input.proposalContributions ?? noProposalContributions,
          ({ ticketDelivery }) => ticketDelivery
        ),
        source: tickets
      })
    })
  )
  const settlements = Layer.succeed(
    DeliverySettlementProjection,
    DeliverySettlementProjection.of({
      of: (relation) => ({
        current: mapCurrentSignal(relation.current, (source) => makeDeliverySettlements(source, [])),
        proposalContributions: relation.proposalContributions,
        proposedActions: mapCurrentSignal(
          relation.proposalContributions,
          ({ deliverySettlement }) => deliverySettlement
        ),
        source: relation
      })
    })
  )
  const reflection = Layer.succeed(
    DeliveryReflectionProjection,
    DeliveryReflectionProjection.of({
      of: (relation) => ({
        current: mapCurrentSignal(relation.current, makeDeliveryReflection),
        proposedActions: input.reflectionProposals ?? noActions,
        source: relation
      })
    })
  )
  const runtime = Layer.succeed(
    DeliveryRuntimeAssembly,
    DeliveryRuntimeAssembly.of({ of: makeDeliveryRuntimeRelation })
  )

  return Layer.mergeAll(trackerGraph, bounded, deliveries, settlements, reflection, runtime)
}
