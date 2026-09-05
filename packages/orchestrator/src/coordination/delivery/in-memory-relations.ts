import { Effect, Equal, Layer, Stream } from "effect"
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
import type { FreshTaskCandidate } from "./fresh-task-candidate.js"

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

/** Keeps a source change lossless while making its payload unavailable as sampling truth. */
const changeNotificationsOf = <A, E>(changes: Stream.Stream<A, E>): Stream.Stream<void, E> =>
  changes.pipe(Stream.map(() => undefined))

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
    deliveryReflection: ReadonlyArray<DeliveryActionProposal>,
    freshTaskCandidates: ReadonlyArray<FreshTaskCandidate>,
    freshTaskCandidateFrontier?: DeliveryRelationInputBundle["actionInputs"]["freshTaskCandidateFrontier"]
  ): DeliveryActionPlanningInput => {
    return {
      deliveryReflection,
      deliverySettlement: lowerContributions.deliverySettlement,
      ...(freshTaskCandidateFrontier === undefined ? {} : { freshTaskCandidateFrontier }),
      freshTaskCandidates,
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
        ([bundle, [trackerProposals, [lowerContributions, deliveryReflection]]]) =>
          planningInputOf(
            trackerProposals,
            lowerContributions,
            deliveryReflection,
            bundle.actionInputs.freshTaskCandidates,
            bundle.actionInputs.freshTaskCandidateFrontier
          )
      )
    : mapCurrentSignal(input.coherent, (bundle) =>
        planningInputOf(
          bundle.actionInputs.trackerGraphProposals,
          releaseEligibleContributions(bundle, bundle.actionInputs.proposalContributions),
          bundle.actionInputs.reflectionProposals,
          bundle.actionInputs.freshTaskCandidates,
          bundle.actionInputs.freshTaskCandidateFrontier
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
        return { ...currentSignalFromCurrentFirstStream(changes), getWithinStablePublication }
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
        const facts: CurrentSignal<DeliveryRuntimeFacts, DeliveryRelationSourceError> = mapCurrentSignal(
          input.coherent,
          ({ actionInputs }) => actionInputs.runtimeFacts
        )
        const current = mapCurrentSignal(delivery, (delivery) => ({
          _tag: "DeliveryRuntimeSnapshot" as const,
          reflection: delivery.trackerConsequences,
          settlements: delivery.settlements,
          ticketDeliveries: delivery.ticketDeliveries,
          trackerGraph: delivery.graph
        }))
        const sampleEvaluation = input.publicationConsistency.withStablePublication(
          Effect.all({
            current: current.get,
            facts: facts.get,
            proposedActions: proposedActions.getWithinStablePublication
          }).pipe(
            Effect.map(({ current, facts, proposedActions }): DeliveryRuntimeEvaluation => {
              const runId = facts.runId ?? facts.taskWork.runId
              return {
                _tag: "DeliveryRuntimeEvaluation",
                acceptedAt: facts.acceptedAt,
                current: { ...current, cancellationApplied: facts.cancellationApplied, runId },
                cancellationApplied: facts.cancellationApplied,
                pauseCoverage: facts.pauseCoverage,
                proposedActions,
                quiescence: facts.quiescence,
                runId,
                taskWork: facts.taskWork,
                ...(facts.activeRefreshBoundary === undefined
                  ? {}
                  : { activeRefreshBoundary: facts.activeRefreshBoundary })
              }
            })
          )
        )
        const invalidations: Stream.Stream<void, E | DeliveryRelationSourceError> = Stream.scoped(
          Stream.unwrap(
            Effect.all({
              delivery: delivery.attach,
              facts: facts.attach,
              proposedActions: proposedActions.attach
            }).pipe(
              Effect.map(({ delivery, facts, proposedActions }) =>
                Stream.concat(
                  Stream.make(undefined),
                  Stream.mergeAll<void, E | DeliveryRelationSourceError, never>(
                    [
                      changeNotificationsOf(delivery.changes),
                      changeNotificationsOf(proposedActions.changes),
                      changeNotificationsOf(facts.changes)
                    ],
                    { bufferSize: 1, concurrency: 3 }
                  )
                )
              )
            )
          )
        )
        const evaluations = currentSignalFromCurrentFirstStream(
          invalidations.pipe(
            Stream.mapEffect(() => sampleEvaluation),
            Stream.changesWith<DeliveryRuntimeEvaluation>(Equal.equals)
          )
        )
        return evaluations
      }
    })
  )

  return Layer.mergeAll(trackerGraph, bounded, deliveries, settlements, reflection, planning, runtime)
}
