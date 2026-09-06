import { Context, Effect, Stream } from "effect"
import type { DeliveryProposalDerivationIssue } from "./delivery-action-proposal.js"
import type { FreshTaskCandidate, FreshTaskCandidateFrontier } from "./fresh-task-candidate.js"
import {
  deliveryProposalFrontierOf,
  currentSignalFromCurrentFirstStream,
  mapCurrentSignal,
  type CurrentSignal,
  type DeliveryActionProposal,
  type DeliveryConsequences,
  type DeliveryProposalFrontier,
  type DeliveryRelationSourceError,
  type TrackerGraphActionProposal,
  type TrackerGraphState
} from "./relations.js"

/** One coherent publication of exact requirements from every descriptive proposal owner. */
export interface DeliveryActionPlanningInput {
  readonly deliveryReflection: ReadonlyArray<DeliveryActionProposal>
  readonly deliverySettlement: ReadonlyArray<DeliveryActionProposal>
  readonly isolatedIssues: ReadonlyArray<DeliveryProposalDerivationIssue>
  readonly freshTaskCandidateFrontier?: FreshTaskCandidateFrontier
  readonly freshTaskCandidates: ReadonlyArray<FreshTaskCandidate>
  readonly ticketDelivery: ReadonlyArray<DeliveryActionProposal>
  readonly trackerGraph: ReadonlyArray<TrackerGraphActionProposal>
}

/** A coherent pair with an ungated read reserved for a caller already holding the publication gate. */
export interface CoherentDeliveryActionPlanningInputSignal<E> extends CurrentSignal<
  readonly [DeliveryConsequences, DeliveryActionPlanningInput],
  E
> {
  readonly getWithinStablePublication: Effect.Effect<readonly [DeliveryConsequences, DeliveryActionPlanningInput], E>
}

/** A planned frontier with an ungated read reserved for the existing gated runtime adapter. */
export interface DeliveryActionPlanningSignal<E> extends CurrentSignal<DeliveryProposalFrontier, E> {
  readonly getWithinStablePublication: Effect.Effect<DeliveryProposalFrontier, E>
}

/** Exact proposed-action requirements supplied together by each descriptive owner. */
export interface DeliveryActionPlanningInputsService {
  readonly withConsequences: <E>(
    consequences: CurrentSignal<DeliveryConsequences, E>
  ) => CoherentDeliveryActionPlanningInputSignal<E | DeliveryRelationSourceError>
}

/** Named descriptive inputs for delivery action planning; none performs or admits an action. */
export class DeliveryActionPlanningInputs extends Context.Service<
  DeliveryActionPlanningInputs,
  DeliveryActionPlanningInputsService
>()("@dalph/DeliveryActionPlanningInputs") {}

const frontierKey = (frontier: DeliveryProposalFrontier): string => JSON.stringify(frontier)

const trackerGraphRequirementsFor = (
  graph: TrackerGraphState,
  proposals: ReadonlyArray<TrackerGraphActionProposal>
): ReadonlyArray<TrackerGraphActionProposal> => (graph._tag === "GraphNotEstablished" ? proposals : [])

const frontierOf = (delivery: DeliveryConsequences, input: DeliveryActionPlanningInput): DeliveryProposalFrontier =>
  deliveryProposalFrontierOf(
    [
      trackerGraphRequirementsFor(delivery.graph, input.trackerGraph),
      input.ticketDelivery,
      input.deliverySettlement,
      input.deliveryReflection
    ],
    input.isolatedIssues,
    input.freshTaskCandidates,
    input.freshTaskCandidateFrontier
  )

/**
 * Turns current delivery consequences and every named action-requirement
 * owner into one ordered proposal frontier without performing an action,
 * admitting a resource, allocating an identity, or owning a fiber.
 */
export const deliveryActionPlanning = Effect.fn("Delivery.actionPlanning")(function* <E>(
  consequences: CurrentSignal<DeliveryConsequences, E>
) {
  const inputs = yield* DeliveryActionPlanningInputs
  const coherent = inputs.withConsequences(consequences)
  const frontier = mapCurrentSignal(coherent, ([delivery, input]) => frontierOf(delivery, input))
  return {
    ...currentSignalFromCurrentFirstStream(
      frontier.changes.pipe(Stream.changesWith((left, right) => frontierKey(left) === frontierKey(right)))
    ),
    getWithinStablePublication: coherent.getWithinStablePublication.pipe(
      Effect.map(([delivery, input]) => frontierOf(delivery, input))
    )
  } satisfies DeliveryActionPlanningSignal<E | DeliveryRelationSourceError>
})
