import { Effect, Layer, Option, Stream } from "effect"
import type { RunControlPolicy } from "../../control/policy.js"
import {
  BoundedParallelTicketsProjection,
  currentSignalOf,
  DeliveryReflectionProjection,
  DeliveryRuntimeAssembly,
  DeliverySettlementProjection,
  makeDeliveryConsequences,
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
  type DeliveryRelationInputBundle,
  type DeliveryConsequences,
  type DeliveryRelationSourceError,
  type TrackerGraphActionProposal,
  type TrackerGraphRelationService,
  zipCurrentSignals
} from "./relations.js"
import { boundedParallelTicketsOf, frontierOf, ticketDeliveriesOf } from "./ticket-delivery-projection.js"
import type { DeliveryProposalContributions } from "./delivery-proposal.js"

export interface DeliveryRelationsLayerInput {
  readonly evaluationConsistency: {
    readonly currentRevision: Effect.Effect<DeliveryRelationRevision>
    readonly withStableRevision: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  }
  readonly invalidate: Parameters<typeof makeDeliveryRuntimeRelation>[0]["invalidate"]
  readonly runtimeFacts: CurrentSignal<DeliveryRuntimeFacts, DeliveryRelationSourceError>
  /** Legacy action-plan contributions are consumed only by the outer runtime adapter. */
  readonly proposalContributions?: CurrentSignal<DeliveryProposalContributions, DeliveryRelationSourceError>
  readonly reflectionProposals?: CurrentSignal<ReadonlyArray<DeliveryActionProposal>, DeliveryRelationSourceError>
  readonly trackerGraphProposals?: CurrentSignal<ReadonlyArray<TrackerGraphActionProposal>, DeliveryRelationSourceError>
  /** One current-first publication carrying every descriptive input together. */
  readonly coherent: CurrentSignal<DeliveryRelationInputBundle, DeliveryRelationSourceError>
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
  const proposalContributions = input.proposalContributions ?? noProposalContributions
  const reflectionProposals = input.reflectionProposals ?? noActions
  /**
   * The old action planner did not expose an idle probe while a lower owner
   * already had real work. Keep that timing at this compatibility seam only;
   * the canonical delivery relation below remains a complete descriptive
   * snapshot and never consults this scheduling choice.
   */
  const actionPlanTrackerGraphProposals = mapCurrentSignal(
    zipCurrentSignals(
      input.trackerGraphProposals ?? noTrackerActions,
      zipCurrentSignals(proposalContributions, reflectionProposals)
    ),
    ([trackerProposals, [lowerContributions, reflection]]) => {
      const hasNonProbeWork = [
        lowerContributions.ticketDelivery,
        lowerContributions.deliverySettlement,
        reflection
      ].some((proposals) =>
        proposals.some(({ route }) => route._tag !== "TrackerGraphReadRoute" || route.purpose !== "QuiescenceProbe")
      )
      return hasNonProbeWork
        ? trackerProposals.filter(({ route }) => route.purpose !== "QuiescenceProbe")
        : trackerProposals
    }
  )
  const coherentConsequences: CurrentSignal<DeliveryConsequences, DeliveryRelationSourceError> = mapCurrentSignal(
    input.coherent,
    ({ exactEvidence, graph, policy }) => {
      const frontier = frontierOf(graph)
      const tickets = boundedParallelTicketsOf(frontier, policy)
      const ticketDeliveries = ticketDeliveriesOf(tickets, exactEvidence)
      const settlements = makeDeliverySettlements(ticketDeliveries, [])
      return makeDeliveryConsequences(makeDeliveryReflection(settlements))
    }
  )
  const trackerGraphService = TrackerGraphRelation.of({
    proposedActions: actionPlanTrackerGraphProposals,
    signal: mapCurrentSignal(coherentConsequences, ({ graph }) => graph)
  })
  const trackerGraph = Layer.succeed(TrackerGraphRelation, trackerGraphService)
  const bounded = Layer.succeed(
    BoundedParallelTicketsProjection,
    BoundedParallelTicketsProjection.of({ of: () => mapCurrentSignal(coherentConsequences, ({ tickets }) => tickets) })
  )
  const deliveries = Layer.succeed(
    TicketDeliveryProjection,
    TicketDeliveryProjection.of({
      of: () => ({
        current: mapCurrentSignal(coherentConsequences, ({ ticketDeliveries }) => ticketDeliveries),
        proposalContributions,
        proposedActions: mapCurrentSignal(proposalContributions, ({ ticketDelivery }) => ticketDelivery),
        source: mapCurrentSignal(coherentConsequences, ({ tickets: canonicalTickets }) => canonicalTickets)
      })
    })
  )
  const settlements = Layer.succeed(
    DeliverySettlementProjection,
    DeliverySettlementProjection.of({
      of: (relation) => ({
        current: mapCurrentSignal(coherentConsequences, ({ settlements }) => settlements),
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
        current: mapCurrentSignal(coherentConsequences, ({ trackerConsequences }) => trackerConsequences),
        proposedActions: reflectionProposals,
        source: relation
      })
    })
  )
  const runtime = Layer.succeed(
    DeliveryRuntimeAssembly,
    DeliveryRuntimeAssembly.of({
      of: <E>({
        delivery,
        trackerGraph
      }: {
        readonly delivery: CurrentSignal<DeliveryConsequences, E>
        readonly trackerGraph: TrackerGraphRelationService
      }) => {
        const facts = input.runtimeFacts
        const relation = makeDeliveryRuntimeRelation<E | DeliveryRelationSourceError>({
          delivery,
          facts,
          invalidate: input.invalidate,
          trackerGraph,
          proposalContributions,
          reflectionProposals
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
          changes: facts.changes.pipe(
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
