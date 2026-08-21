import { Effect, Layer, Option, Stream } from "effect"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import type { RunControlPolicy } from "../../control/policy.js"
import {
  DeliveryActionPlanningInputs,
  type DeliveryActionPlanningInput,
  type DeliveryActionPlanningSignal
} from "./delivery-action-planning.js"
import {
  BoundedParallelTicketsProjection,
  currentSignalFromCurrentFirstStream,
  currentSignalOf,
  DeliveryReflectionProjection,
  DeliveryRuntimeAssembly,
  DeliverySettlementProjection,
  makeDeliveryReflection,
  mapCurrentSignal,
  TicketDeliveryProjection,
  TrackerGraphRelation,
  type CurrentSignal,
  type DeliveryActionProposal,
  type DeliveryRuntimeEvaluation,
  type DeliveryRuntimeFacts,
  type DeliveryRuntimeSnapshot,
  type DeliveryRelationInputBundle,
  type DeliveryGraphPublication,
  type TicketDeliveryEvidence,
  type DeliveryConsequences,
  type DeliveryRelationSourceError,
  type TrackerGraphActionProposal,
  zipCurrentSignals
} from "./relations.js"
import {
  boundedParallelTicketsOf,
  deliverySettlementsOf,
  frontierOf,
  releaseEligibleProposalContributionsOf,
  ticketDeliveriesOf
} from "./ticket-delivery-projection.js"
import type { DeliveryProposalContributions } from "./delivery-proposal.js"

export interface DeliveryRelationsLayerInput {
  readonly publicationConsistency: {
    readonly withStablePublication: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  }
  /** Action-plan contributions are consumed only by the outer runtime adapter. */
  readonly proposalContributions?: CurrentSignal<DeliveryProposalContributions, DeliveryRelationSourceError>
  readonly reflectionProposals?: CurrentSignal<ReadonlyArray<DeliveryActionProposal>, DeliveryRelationSourceError>
  readonly trackerGraphProposals?: CurrentSignal<ReadonlyArray<TrackerGraphActionProposal>, DeliveryRelationSourceError>
  /** One current-first input bundle carrying the descriptive publication and action inputs together. */
  readonly coherent: CurrentSignal<DeliveryRelationInputBundle, DeliveryRelationSourceError>
}

/**
 * Identifies the descriptive values that make one graph-stage publication
 * observable. Accepted appends can rebuild policy and evidence objects even
 * when the graph itself did not change; those equivalent values must not
 * replay the previous graph publication, while a new graph observation,
 * policy, or exact evidence still publishes.
 */
const publicationEvidenceKeyByArray = new WeakMap<ReadonlyArray<TicketDeliveryEvidence>, string>()
const publicationEvidenceKeyByElement = new WeakMap<TicketDeliveryEvidence, string>()
const publicationSnapshotKeyByObject = new WeakMap<TaskDagSnapshot, string>()

/**
 * Keep the exact JSON equality law while avoiding repeated traversal of
 * immutable evidence values that are shared by adjacent publications. The
 * array itself is often rebuilt for each publication, so the element cache is
 * the useful layer here. A JSON array of the element JSON strings is
 * injective for the original serialized evidence array, including ordering
 * and duplicate entries.
 */
const publicationEvidenceKeyOf = (evidence: ReadonlyArray<TicketDeliveryEvidence>): string => {
  const cached = publicationEvidenceKeyByArray.get(evidence)
  if (cached !== undefined) return cached

  const key = JSON.stringify(
    evidence.map((entry) => {
      const cachedEntry = publicationEvidenceKeyByElement.get(entry)
      if (cachedEntry !== undefined) return cachedEntry
      const serializedEntry = JSON.stringify(entry)
      publicationEvidenceKeyByElement.set(entry, serializedEntry)
      return serializedEntry
    })
  )
  publicationEvidenceKeyByArray.set(evidence, key)
  return key
}

const publicationSnapshotKeyOf = (snapshot: TaskDagSnapshot): string => {
  const cached = publicationSnapshotKeyByObject.get(snapshot)
  if (cached !== undefined) return cached
  const key = snapshot.canonicalJson()
  publicationSnapshotKeyByObject.set(snapshot, key)
  return key
}

/** Encodes one publication-key component without allowing delimiter collisions. */
const publicationKeyPartOf = (value: string | number): string => {
  const text = String(value)
  return `${typeof value}:${text.length}:${text}`
}

const deliveryPublicationKeyOf = (publication: DeliveryGraphPublication): string => {
  const graph = publication.graph
  const graphKey =
    graph._tag === "GraphNotEstablished"
      ? [graph._tag]
      : [
          graph._tag,
          publicationSnapshotKeyOf(graph.observation.snapshot),
          graph.observation.operationId,
          graph.observation.contentIdentity,
          graph.observation.recordedAt,
          graph.observation.freshness.operationId
        ]
  return [
    publicationEvidenceKeyOf(publication.exactEvidence),
    ...graphKey,
    publication.policy.revision,
    publication.policy.taskExecutionCapacity
  ]
    .map(publicationKeyPartOf)
    .join("|")
}

const deduplicatedPublicationSignal = (
  signal: CurrentSignal<DeliveryGraphPublication, DeliveryRelationSourceError>
): CurrentSignal<DeliveryGraphPublication, DeliveryRelationSourceError> =>
  currentSignalFromCurrentFirstStream(
    signal.changes.pipe(
      Stream.mapAccum<string | undefined, DeliveryGraphPublication, DeliveryGraphPublication>(
        () => undefined,
        (previousKey, publication) => {
          const nextKey = deliveryPublicationKeyOf(publication)
          return previousKey === nextKey ? [nextKey, []] : [nextKey, [publication]]
        }
      )
    )
  )

/** Explicit non-reactive runtime facts for deterministic relation and shadow evaluation only. */
export const deterministicDeliveryRuntimeSupport = (_policy: RunControlPolicy) => ({
  publicationConsistency: { withStablePublication: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect }
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
  const rawProposalContributions = input.proposalContributions ?? noProposalContributions
  const releaseEligibleContributions = (
    bundle: DeliveryRelationInputBundle,
    contributions: DeliveryProposalContributions
  ): DeliveryProposalContributions =>
    releaseEligibleProposalContributionsOf(boundedParallelTicketsOf(frontierOf(bundle.publication)), contributions)
  const proposalContributions =
    input.proposalContributions === undefined
      ? mapCurrentSignal(input.coherent, (bundle) =>
          releaseEligibleContributions(bundle, bundle.actionInputs.proposalContributions)
        )
      : (() => {
          const changes = Stream.merge(
            input.coherent.changes.pipe(
              Stream.mapEffect((bundle) =>
                rawProposalContributions.get.pipe(
                  Effect.map((contributions) => releaseEligibleContributions(bundle, contributions))
                )
              )
            ),
            rawProposalContributions.changes.pipe(
              Stream.mapEffect((contributions) =>
                input.coherent.get.pipe(Effect.map((bundle) => releaseEligibleContributions(bundle, contributions)))
              )
            )
          ).pipe(Stream.changesWith((left, right) => JSON.stringify(left) === JSON.stringify(right)))
          return currentSignalFromCurrentFirstStream(changes)
        })()
  const reflectionProposals = input.reflectionProposals ?? noActions
  const planningInputOf = (
    trackerProposals: ReadonlyArray<TrackerGraphActionProposal>,
    lowerContributions: DeliveryProposalContributions,
    deliveryReflection: ReadonlyArray<DeliveryActionProposal>
  ): DeliveryActionPlanningInput => {
    return {
      deliveryReflection,
      deliverySettlement: lowerContributions.deliverySettlement,
      isolatedIssues: lowerContributions.issues,
      ticketDelivery: lowerContributions.ticketDelivery,
      trackerGraph: trackerProposals
    }
  }
  const hasPlanningOverrides =
    input.proposalContributions !== undefined ||
    input.reflectionProposals !== undefined ||
    input.trackerGraphProposals !== undefined
  /**
   * Production obtains all four owners from one coherent bundle. Focused
   * deterministic tests may override an owner signal explicitly without
   * changing the production publication law.
   */
  const planningInputs = hasPlanningOverrides
    ? mapCurrentSignal(
        zipCurrentSignals(
          input.coherent,
          zipCurrentSignals(
            input.trackerGraphProposals ?? noTrackerActions,
            zipCurrentSignals(proposalContributions, reflectionProposals)
          )
        ),
        ([, [trackerProposals, [lowerContributions, deliveryReflection]]]) =>
          planningInputOf(trackerProposals, lowerContributions, deliveryReflection)
      )
    : mapCurrentSignal(input.coherent, (bundle) =>
        planningInputOf(
          bundle.actionInputs.trackerGraphProposals,
          releaseEligibleContributions(bundle, bundle.actionInputs.proposalContributions),
          bundle.actionInputs.reflectionProposals
        )
      )
  const actionPlanTrackerGraphProposals = mapCurrentSignal(planningInputs, ({ trackerGraph }) => trackerGraph)
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
        current: mapCurrentSignal(relation.current, deliverySettlementsOf),
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
  const planning = Layer.succeed(
    DeliveryActionPlanningInputs,
    DeliveryActionPlanningInputs.of({
      withConsequences: <E>(consequences: CurrentSignal<DeliveryConsequences, E>) => {
        const getWithinStablePublication = Effect.all([consequences.get, planningInputs.get])
        const get = input.publicationConsistency.withStablePublication(getWithinStablePublication)
        const changes = Stream.merge(
          consequences.changes.pipe(Stream.map(() => undefined)),
          planningInputs.changes.pipe(Stream.map(() => undefined))
        ).pipe(Stream.mapEffect(() => get))
        const changesWithinStablePublication = zipCurrentSignals(consequences, planningInputs).changes
        return {
          ...currentSignalFromCurrentFirstStream(changes),
          changesWithinStablePublication,
          getWithinStablePublication
        }
      }
    })
  )
  const runtime = Layer.succeed(
    DeliveryRuntimeAssembly,
    DeliveryRuntimeAssembly.of({
      of: <E>({
        delivery,
        proposedActions
      }: {
        readonly delivery: CurrentSignal<DeliveryConsequences, E>
        readonly proposedActions: DeliveryActionPlanningSignal<E | DeliveryRelationSourceError>
      }) => {
        const facts = mapCurrentSignal(input.coherent, ({ actionInputs }) => actionInputs.runtimeFacts)
        const current = mapCurrentSignal(
          delivery,
          (delivery): DeliveryRuntimeSnapshot => ({
            _tag: "DeliveryRuntimeSnapshot",
            reflection: delivery.trackerConsequences,
            settlements: delivery.settlements,
            ticketDeliveries: delivery.ticketDeliveries,
            trackerGraph: delivery.graph
          })
        )
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
                pauseCoverage: facts.pauseCoverage,
                proposedActions,
                quiescence: facts.quiescence,
                taskWork: facts.taskWork
              })
            )
          )
        const sampleEvaluation = (facts: DeliveryRuntimeFacts) =>
          makeEvaluation(
            facts,
            current.changes.pipe(Stream.runHead, Effect.map(Option.getOrThrow)),
            proposedActions.changesWithinStablePublication.pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        const evaluations = currentSignalFromCurrentFirstStream(
          facts.changes.pipe(
            Stream.mapEffect((facts) => input.publicationConsistency.withStablePublication(sampleEvaluation(facts)))
          )
        )
        return evaluations
      }
    })
  )

  return Layer.mergeAll(trackerGraph, bounded, deliveries, settlements, reflection, planning, runtime)
}
