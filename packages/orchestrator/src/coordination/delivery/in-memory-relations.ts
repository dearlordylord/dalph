import { Effect, Layer, Option, Stream } from "effect"
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
  deliveryFinalityOf,
  DeliveryRelationRevision,
  type DeliveryRuntimeEvaluation,
  type DeliveryRuntimeFacts,
  type DeliveryReflectionRelation,
  type DeliveryRelationSourceError,
  type TrackerGraphActionProposal,
  type TicketDeliveryEvidence,
  type TrackerGraphState,
  type TrackerGraphRelationService,
  zipCurrentSignals
} from "./relations.js"
import { boundedParallelTicketsOf, ticketDeliveriesOf } from "./ticket-delivery-projection.js"
import type { DeliveryProposalContributions } from "./delivery-proposal.js"

export interface DeliveryRelationsLayerInput {
  readonly evaluationConsistency: {
    readonly currentRevision: Effect.Effect<DeliveryRelationRevision>
    readonly withStableRevision: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  }
  readonly exactEvidence: CurrentSignal<ReadonlyArray<TicketDeliveryEvidence>, DeliveryRelationSourceError>
  readonly graph: CurrentSignal<TrackerGraphState, DeliveryRelationSourceError>
  readonly invalidate: Parameters<typeof makeDeliveryRuntimeRelation>[0]["invalidate"]
  readonly runtimeFacts: CurrentSignal<DeliveryRuntimeFacts, DeliveryRelationSourceError>
  readonly policy: CurrentSignal<RunControlPolicy, DeliveryRelationSourceError>
  readonly proposalContributions?: CurrentSignal<DeliveryProposalContributions, DeliveryRelationSourceError>
  readonly reflectionProposals?: CurrentSignal<ReadonlyArray<DeliveryActionProposal>, DeliveryRelationSourceError>
  readonly trackerGraphProposals?: CurrentSignal<ReadonlyArray<TrackerGraphActionProposal>, DeliveryRelationSourceError>
}

/** Explicit non-reactive runtime facts for deterministic relation and shadow evaluation only. */
export const deterministicDeliveryRuntimeSupport = (policy: RunControlPolicy) => ({
  evaluationConsistency: {
    currentRevision: Effect.succeed(DeliveryRelationRevision.make(0)),
    withStableRevision: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect
  },
  invalidate: () => Effect.succeed(DeliveryRelationRevision.make(0)),
  runtimeFacts: currentSignalOf<DeliveryRuntimeFacts>({
    acceptedAt: null,
    quiescence: { _tag: "QuiescencePassive", reason: "ProbeNotRequired" },
    revision: DeliveryRelationRevision.make(0),
    taskWork: { capacity: policy.taskExecutionCapacity, held: [] }
  })
})

/** Deterministic, action-free Layers used to evaluate the complete relation spine. */
export const makeDeliveryRelationsLayer = (input: DeliveryRelationsLayerInput) => {
  const noActions = currentSignalOf<ReadonlyArray<DeliveryActionProposal>>([])
  const noTrackerActions = currentSignalOf<ReadonlyArray<TrackerGraphActionProposal>>([])
  const noProposalContributions = currentSignalOf<DeliveryProposalContributions>({
    deliverySettlement: [],
    issues: [],
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
    DeliveryRuntimeAssembly.of({
      of: <E>({
        reflection,
        trackerGraph
      }: {
        readonly reflection: DeliveryReflectionRelation<E>
        readonly trackerGraph: TrackerGraphRelationService
      }) => {
        const relation = makeDeliveryRuntimeRelation<E | DeliveryRelationSourceError>({
          facts: input.runtimeFacts,
          invalidate: input.invalidate,
          reflection,
          trackerGraph
        })
        const sampleEvaluation = (facts: DeliveryRuntimeFacts) =>
          Effect.all({
            current: relation.current.changes.pipe(Stream.runHead, Effect.map(Option.getOrThrow)),
            proposedActions: relation.proposedActions.changes.pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          }).pipe(
            Effect.map(
              ({ current, proposedActions }): DeliveryRuntimeEvaluation => ({
                _tag: "DeliveryRuntimeEvaluation",
                acceptedAt: facts.acceptedAt,
                current,
                finality: deliveryFinalityOf(current, proposedActions, facts.quiescence),
                proposedActions,
                quiescence: facts.quiescence,
                revision: facts.revision,
                taskWork: facts.taskWork
              })
            )
          )
        const evaluations = {
          changes: input.runtimeFacts.changes.pipe(
            Stream.mapEffect((facts) =>
              input.evaluationConsistency.withStableRevision(
                input.evaluationConsistency.currentRevision.pipe(
                  Effect.flatMap((revision) =>
                    revision === facts.revision
                      ? sampleEvaluation(facts).pipe(Effect.map((evaluation) => [evaluation]))
                      : Effect.succeed([])
                  )
                )
              )
            ),
            Stream.flatMap(Stream.fromIterable)
          )
        }
        return { ...relation, evaluations }
      }
    })
  )

  return Layer.mergeAll(trackerGraph, bounded, deliveries, settlements, reflection, runtime)
}
