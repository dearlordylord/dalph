import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { OperationId } from "../../workflow/identity.js"
import type { DeliveryActionProposal, DeliveryProposalId } from "./delivery-action-proposal.js"
import type { DeliveryProposalFrontier } from "./relations.js"
import {
  deliveryRuntimeLocalDeferralAppliesAt,
  type DeliveryRuntimeLocalDeferral
} from "./delivery-runtime-local-deferral.js"
import { liveActionKeyOf as stableLiveActionKeyOf, type LiveDeliveryActionKey } from "./live-delivery-action-key.js"

export { LiveDeliveryActionKey, liveActionKeyOf } from "./live-delivery-action-key.js"

export const proposalIsAvailable = (
  proposal: DeliveryActionProposal,
  live: ReadonlyMap<DeliveryProposalId, unknown>,
  liveActionKeys: ReadonlySet<LiveDeliveryActionKey>,
  liveOperationIds: ReadonlySet<OperationId>,
  deferred: ReadonlyMap<DeliveryProposalId, DeliveryRuntimeLocalDeferral>,
  acceptedAt: JournalPosition | null
): boolean => {
  const localDeferral = deferred.get(proposal.id)
  return (
    !live.has(proposal.id) &&
    !liveActionKeys.has(stableLiveActionKeyOf(proposal)) &&
    (localDeferral === undefined || !deliveryRuntimeLocalDeferralAppliesAt(localDeferral, acceptedAt)) &&
    (proposal.waitsForLiveOperationId === null || !liveOperationIds.has(proposal.waitsForLiveOperationId))
  )
}

/** A proposal remains current only while its exact identity is present in the relation frontier. */
export const proposalIsPresent = (frontier: DeliveryProposalFrontier, proposalId: DeliveryProposalId): boolean =>
  frontier._tag === "DeliveryProposalsAvailable"
    ? frontier.proposals.some(({ id }) => id === proposalId)
    : frontier.conflicts.some(({ id }) => id === proposalId)

/** Current exact proposals covered by one already-installed process-local action owner. */
export const proposalsForLiveAction = (
  frontier: DeliveryProposalFrontier,
  proposal: DeliveryActionProposal
): ReadonlyArray<DeliveryActionProposal> =>
  frontier._tag === "DeliveryProposalsAvailable"
    ? frontier.proposals.filter((candidate) => stableLiveActionKeyOf(candidate) === stableLiveActionKeyOf(proposal))
    : []

/** A causally refreshed proposal still names the same process-local boundary action. */
export const liveActionIsPresent = (frontier: DeliveryProposalFrontier, proposal: DeliveryActionProposal): boolean =>
  frontier._tag === "DeliveryProposalsAvailable"
    ? proposalsForLiveAction(frontier, proposal).length > 0
    : frontier.conflicts.some(({ id }) => id === proposal.id)
