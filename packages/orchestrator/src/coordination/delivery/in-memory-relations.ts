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
  type DeliveryReflectionRelation,
  type DeliverySettlementRelation,
  type TicketDeliveryRelation,
  type DeliveryRelationSourceError,
  type TrackerGraphActionProposal,
  type TicketDeliveryEvidence,
  type TrackerGraphState,
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
  readonly exactEvidence: CurrentSignal<ReadonlyArray<TicketDeliveryEvidence>, DeliveryRelationSourceError>
  readonly graph: CurrentSignal<TrackerGraphState, DeliveryRelationSourceError>
  readonly invalidate: Parameters<typeof makeDeliveryRuntimeRelation>[0]["invalidate"]
  readonly runtimeFacts: CurrentSignal<DeliveryRuntimeFacts, DeliveryRelationSourceError>
  readonly policy: CurrentSignal<RunControlPolicy, DeliveryRelationSourceError>
  readonly proposalContributions?: CurrentSignal<DeliveryProposalContributions, DeliveryRelationSourceError>
  readonly reflectionProposals?: CurrentSignal<ReadonlyArray<DeliveryActionProposal>, DeliveryRelationSourceError>
  readonly trackerGraphProposals?: CurrentSignal<ReadonlyArray<TrackerGraphActionProposal>, DeliveryRelationSourceError>
  /** One current-first publication carrying every descriptive input together. */
  readonly coherent?: CurrentSignal<DeliveryRelationInputBundle, DeliveryRelationSourceError>
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

/** Builds the lower runtime relation owners while preserving one delivery consequence source. */
export const makeDeliveryRuntimeReflection = <E>(input: {
  readonly delivery: CurrentSignal<DeliveryConsequences, E>
  readonly proposalContributions: CurrentSignal<DeliveryProposalContributions, DeliveryRelationSourceError>
  readonly reflectionProposals: CurrentSignal<ReadonlyArray<DeliveryActionProposal>, DeliveryRelationSourceError>
}): {
  readonly ticketRelation: TicketDeliveryRelation<E | DeliveryRelationSourceError>
  readonly settlementRelation: DeliverySettlementRelation<E | DeliveryRelationSourceError>
  readonly reflection: DeliveryReflectionRelation<E | DeliveryRelationSourceError>
} => {
  const ticketRelation: TicketDeliveryRelation<E | DeliveryRelationSourceError> = {
    current: mapCurrentSignal(input.delivery, ({ ticketDeliveries }) => ticketDeliveries),
    proposedActions: mapCurrentSignal(input.proposalContributions, ({ ticketDelivery }) => ticketDelivery),
    proposalContributions: input.proposalContributions,
    source: mapCurrentSignal(input.delivery, ({ tickets }) => tickets)
  }
  const settlementRelation: DeliverySettlementRelation<E | DeliveryRelationSourceError> = {
    current: mapCurrentSignal(input.delivery, ({ settlements }) => settlements),
    proposedActions: mapCurrentSignal(input.proposalContributions, ({ deliverySettlement }) => deliverySettlement),
    proposalContributions: input.proposalContributions,
    source: ticketRelation
  }
  const reflection: DeliveryReflectionRelation<E | DeliveryRelationSourceError> = {
    current: mapCurrentSignal(input.delivery, ({ trackerConsequences }) => trackerConsequences),
    proposedActions: input.reflectionProposals,
    source: settlementRelation
  }
  return { ticketRelation, settlementRelation, reflection }
}

/** Deterministic, action-free Layers used to evaluate the complete relation spine. */
export const makeDeliveryRelationsLayer = (input: DeliveryRelationsLayerInput) => {
  const noActions = currentSignalOf<ReadonlyArray<DeliveryActionProposal>>([])
  const noTrackerActions = currentSignalOf<ReadonlyArray<TrackerGraphActionProposal>>([])
  const noProposalContributions = currentSignalOf<DeliveryProposalContributions>({
    deliverySettlement: [],
    issues: [],
    ticketDelivery: []
  })
  const coherentConsequences: CurrentSignal<DeliveryConsequences, DeliveryRelationSourceError> | undefined =
    input.coherent === undefined
      ? undefined
      : mapCurrentSignal(input.coherent, ({ exactEvidence, graph, policy }) => {
          const frontier = frontierOf(graph)
          const tickets = boundedParallelTicketsOf(frontier, policy)
          const ticketDeliveries = ticketDeliveriesOf(tickets, exactEvidence)
          const settlements = makeDeliverySettlements(ticketDeliveries, [])
          return makeDeliveryConsequences(makeDeliveryReflection(settlements))
        })
  const trackerGraphService = TrackerGraphRelation.of({
    proposedActions: input.trackerGraphProposals ?? noTrackerActions,
    signal:
      coherentConsequences === undefined ? input.graph : mapCurrentSignal(coherentConsequences, ({ graph }) => graph)
  })
  const trackerGraph = Layer.succeed(TrackerGraphRelation, trackerGraphService)
  const bounded = Layer.succeed(
    BoundedParallelTicketsProjection,
    BoundedParallelTicketsProjection.of({
      of: (frontier) =>
        coherentConsequences === undefined
          ? mapCurrentSignal(zipCurrentSignals(frontier, input.policy), ([source, policy]) =>
              boundedParallelTicketsOf(source, policy)
            )
          : mapCurrentSignal(coherentConsequences, ({ tickets }) => tickets)
    })
  )
  const deliveries = Layer.succeed(
    TicketDeliveryProjection,
    TicketDeliveryProjection.of({
      of: (tickets) => ({
        current:
          coherentConsequences === undefined
            ? mapCurrentSignal(zipCurrentSignals(tickets, input.exactEvidence), ([source, evidence]) =>
                ticketDeliveriesOf(source, evidence)
              )
            : mapCurrentSignal(coherentConsequences, ({ ticketDeliveries }) => ticketDeliveries),
        proposalContributions:
          input.coherent === undefined
            ? (input.proposalContributions ?? noProposalContributions)
            : mapCurrentSignal(input.coherent, ({ proposalContributions }) => proposalContributions),
        proposedActions: mapCurrentSignal(
          input.coherent === undefined
            ? (input.proposalContributions ?? noProposalContributions)
            : mapCurrentSignal(input.coherent, ({ proposalContributions }) => proposalContributions),
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
        current:
          coherentConsequences === undefined
            ? mapCurrentSignal(relation.current, (source) => makeDeliverySettlements(source, []))
            : mapCurrentSignal(coherentConsequences, ({ settlements }) => settlements),
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
        current:
          coherentConsequences === undefined
            ? mapCurrentSignal(relation.current, makeDeliveryReflection)
            : mapCurrentSignal(coherentConsequences, ({ trackerConsequences }) => trackerConsequences),
        proposedActions:
          input.coherent === undefined
            ? (input.reflectionProposals ?? noActions)
            : mapCurrentSignal(input.coherent, ({ reflectionProposals }) => reflectionProposals),
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
        const proposalContributions = input.proposalContributions ?? noProposalContributions
        const reflectionProposals = input.reflectionProposals ?? noActions
        const { reflection } = makeDeliveryRuntimeReflection({ delivery, proposalContributions, reflectionProposals })
        const facts = input.runtimeFacts
        const relation = makeDeliveryRuntimeRelation<E | DeliveryRelationSourceError>({
          facts,
          invalidate: input.invalidate,
          reflection,
          trackerGraph,
          suppressQuiescenceProbeWithWork: input.coherent !== undefined
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
