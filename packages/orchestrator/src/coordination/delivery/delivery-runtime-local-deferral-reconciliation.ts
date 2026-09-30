import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { DeliveryProposalId } from "./delivery-action-proposal.js"
import {
  deliveryRuntimeLocalDeferralAppliesAt,
  deliveryRuntimeLocalDeferralMatchesProposal,
  type DeliveryRuntimeLocalDeferral
} from "./delivery-runtime-local-deferral.js"
import { proposalIsPresent } from "./live-delivery-action.js"
import { liveActionKeyOf } from "./live-delivery-action-key.js"
import type { DeliveryProposalFrontier } from "./relations.js"

/**
 * Reconciles activation-local exclusion with one newly accepted frontier.
 * Changed-facts deferrals remain exact, passive attachments follow their stable
 * live action, and pending baseline catch-up follows only its exact correlation.
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
        : deferral._tag === "PassiveOwnerAttached"
          ? frontier._tag === "DeliveryProposalsAvailable"
            ? frontier.proposals
                .filter((proposal) => liveActionKeyOf(proposal) === deferral.liveActionKey)
                .map((proposal) => [proposal.id, deferral])
            : []
          : frontier._tag === "DeliveryProposalsAvailable"
            ? (() => {
                const matching = frontier.proposals.filter((proposal) =>
                  deliveryRuntimeLocalDeferralMatchesProposal(deferral, proposal)
                )
                return matching.length === 0
                  ? [[proposalId, deferral]]
                  : matching.map((proposal) => [proposal.id, deferral] as const)
              })()
            : [[proposalId, deferral]]
  )
  return new Map(entries)
}
