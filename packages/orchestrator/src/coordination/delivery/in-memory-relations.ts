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
  type DeliveryRelationInputBundle,
  type DeliveryGraphPublication,
  type DeliveryConsequences,
  type DeliveryRelationSourceError,
  type TrackerGraphActionProposal,
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
  readonly invalidate: Parameters<typeof makeDeliveryRuntimeRelation>[0]["invalidate"]
  readonly runtimeFacts: CurrentSignal<DeliveryRuntimeFacts, DeliveryRelationSourceError>
  /** Legacy action-plan contributions are consumed only by the outer runtime adapter. */
  readonly proposalContributions?: CurrentSignal<DeliveryProposalContributions, DeliveryRelationSourceError>
  readonly reflectionProposals?: CurrentSignal<ReadonlyArray<DeliveryActionProposal>, DeliveryRelationSourceError>
  readonly trackerGraphProposals?: CurrentSignal<ReadonlyArray<TrackerGraphActionProposal>, DeliveryRelationSourceError>
  /** One current-first input bundle carrying the descriptive publication and compatibility inputs together. */
  readonly coherent: CurrentSignal<DeliveryRelationInputBundle, DeliveryRelationSourceError>
}

/**
 * Identifies the descriptive values that make one graph-stage publication
 * observable. Accepted appends can rebuild policy and evidence objects even
 * when the graph itself did not change; those equivalent values must not
 * replay the previous graph publication, while a new graph observation,
 * policy, or exact evidence still publishes.
 */
const deliveryPublicationKeyOf = (publication: DeliveryGraphPublication): string => {
  const graph = publication.graph
  const graphKey =
    graph._tag === "GraphNotEstablished"
      ? [graph._tag]
      : [
          graph._tag,
          graph.observation.snapshot.canonicalJson(),
          graph.observation.operationId,
          graph.observation.contentIdentity,
          graph.observation.acceptedAt,
          graph.observation.freshness.operationId
        ]
  return JSON.stringify({
    exactEvidence: publication.exactEvidence,
    graph: graphKey,
    policy: [publication.policy.revision, publication.policy.taskExecutionCapacity]
  })
}

const deduplicatedPublicationSignal = (
  signal: CurrentSignal<DeliveryGraphPublication, DeliveryRelationSourceError>
): CurrentSignal<DeliveryGraphPublication, DeliveryRelationSourceError> => ({
  get: signal.get,
  changes: signal.changes.pipe(
    Stream.mapAccum<string | undefined, DeliveryGraphPublication, DeliveryGraphPublication>(
      () => undefined,
      (previousKey, publication) => {
        const nextKey = deliveryPublicationKeyOf(publication)
        return previousKey === nextKey ? [nextKey, []] : [nextKey, [publication]]
      }
    )
  )
})

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
  const publication = deduplicatedPublicationSignal(mapCurrentSignal(input.coherent, ({ publication }) => publication))
  const trackerGraphService = TrackerGraphRelation.of({
    proposedActions: actionPlanTrackerGraphProposals,
    signal: publication
  })
  const trackerGraph = Layer.succeed(TrackerGraphRelation, trackerGraphService)
  const bounded = Layer.succeed(
    BoundedParallelTicketsProjection,
    BoundedParallelTicketsProjection.of({ of: (frontier) => mapCurrentSignal(frontier, boundedParallelTicketsOf) })
  )
  const deliveries = Layer.succeed(
    TicketDeliveryProjection,
    TicketDeliveryProjection.of({
      of: (tickets) => ({
        current: mapCurrentSignal(tickets, (current) => ticketDeliveriesOf(current, current.publication.exactEvidence)),
        proposalContributions,
        proposedActions: mapCurrentSignal(proposalContributions, ({ ticketDelivery }) => ticketDelivery),
        source: tickets
      })
    })
  )
  const settlements = Layer.succeed(
    DeliverySettlementProjection,
    DeliverySettlementProjection.of({
      of: (relation) => ({
        current: mapCurrentSignal(relation.current, (deliveries) => makeDeliverySettlements(deliveries, [])),
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
        const makeEvaluation = (
          facts: DeliveryRuntimeFacts,
          current: Effect.Effect<DeliveryRuntimeEvaluation["current"], E | DeliveryRelationSourceError>,
          proposedActions: Effect.Effect<DeliveryRuntimeEvaluation["proposedActions"], E | DeliveryRelationSourceError>
        ) =>
          Effect.all({ current, proposedActions }).pipe(
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
        const sampleEvaluation = (facts: DeliveryRuntimeFacts) =>
          makeEvaluation(
            facts,
            relation.current.changes.pipe(Stream.runHead, Effect.map(Option.getOrThrow)),
            relation.proposedActions.changes.pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        const readStableEvaluation = Effect.fn("DeliveryRelations.readStableEvaluation")(function* () {
          for (;;) {
            const evaluation = yield* input.evaluationConsistency.withStableRevision(
              Effect.gen(function* () {
                const currentFacts = yield* facts.get
                const revision = yield* input.evaluationConsistency.currentRevision
                if (revision !== currentFacts.revision) return Option.none<DeliveryRuntimeEvaluation>()
                const sampled = yield* makeEvaluation(currentFacts, relation.current.get, relation.proposedActions.get)
                return Option.some(sampled)
              })
            )
            if (Option.isSome(evaluation)) return evaluation.value
            yield* Effect.yieldNow
          }
        })
        const evaluations = {
          get: readStableEvaluation(),
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
