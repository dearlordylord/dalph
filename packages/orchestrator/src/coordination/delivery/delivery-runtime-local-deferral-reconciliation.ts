import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { DeliveryProposalId } from "./delivery-action-proposal.js"
import {
  deliveryRuntimeLocalDeferralAppliesAt,
  type DeliveryRuntimeLocalDeferral
} from "./delivery-runtime-local-deferral.js"
import { liveActionKeyOf, proposalIsPresent } from "./live-delivery-action.js"
import type { DeliveryProposalFrontier } from "./relations.js"

/**
 * Reconciles activation-local exclusion with one newly accepted frontier.
 * Changed-facts deferrals remain exact. Only a passive attachment follows the
 * available proposal for its stable live action; absence or conflict drops it.
 */
export const reconcileDeliveryRuntimeLocalDeferrals = (
  current: ReadonlyMap<DeliveryProposalId, DeliveryRuntimeLocalDeferral>,
  frontier: DeliveryProposalFrontier,
  acceptedAt: JournalPosition | null
): ReadonlyMap<DeliveryProposalId, DeliveryRuntimeLocalDeferral> => {
  type DeferralEntry = readonly [DeliveryProposalId, DeliveryRuntimeLocalDeferral]
  const entries = [...current].flatMap<DeferralEntry>(
    ([proposalId, deferral]): ReadonlyArray<DeferralEntry> =>
      deferral._tag === "AwaitChangedAcceptedFacts"
        ? deliveryRuntimeLocalDeferralAppliesAt(deferral, acceptedAt) && proposalIsPresent(frontier, proposalId)
          ? [[proposalId, deferral]]
          : []
        : frontier._tag === "DeliveryProposalsAvailable"
          ? frontier.proposals
              .filter((proposal) => liveActionKeyOf(proposal) === deferral.liveActionKey)
              .map((proposal) => [proposal.id, deferral])
          : []
  )
  return new Map(entries)
}
