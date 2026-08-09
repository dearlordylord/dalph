import type { PlannedTaskAttempt } from "@dalph/contracts"
import { Schema } from "effect"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { OperationId } from "../../workflow/identity.js"
import type { DeliveryActionProposal, DeliveryProposalId } from "./delivery-action-proposal.js"
import type { DeliveryProposalFrontier } from "./relations.js"

/**
 * Process-local identity of an action that must not overlap itself. A recovered
 * observation keeps this identity when a newer causal predecessor changes its
 * proposal identity while the earlier boundary call is still owned.
 */
export const LiveDeliveryActionKey = Schema.NonEmptyString.pipe(Schema.brand("LiveDeliveryActionKey"))
export type LiveDeliveryActionKey = typeof LiveDeliveryActionKey.Type

const liveActionKey = (parts: ReadonlyArray<string>): LiveDeliveryActionKey =>
  LiveDeliveryActionKey.make(JSON.stringify(parts))

const recoveredObservationAttempt = (
  action: Extract<DeliveryActionProposal["route"], { readonly _tag: "RecoveredNewActionRoute" }>["action"]
): PlannedTaskAttempt | undefined => {
  if (!("operation" in action) || action.operation._tag === "ReleaseTaskClaim") return undefined
  return action.plannedAttempt ?? undefined
}

export const liveActionKeyOf = (proposal: DeliveryActionProposal): LiveDeliveryActionKey => {
  const route = proposal.route
  if (route._tag !== "RecoveredNewActionRoute") return liveActionKey(["DeliveryProposal", proposal.id])
  const plannedAttempt = recoveredObservationAttempt(route.action)
  return plannedAttempt === undefined
    ? liveActionKey(["DeliveryProposal", proposal.id])
    : liveActionKey(["RecoveredAttemptObservation", route.action._tag, plannedAttempt.runId, plannedAttempt.attemptId])
}

export const proposalIsAvailable = (
  proposal: DeliveryActionProposal,
  live: ReadonlyMap<DeliveryProposalId, unknown>,
  liveActionKeys: ReadonlySet<LiveDeliveryActionKey>,
  liveOperationIds: ReadonlySet<OperationId>,
  deferred: ReadonlyMap<DeliveryProposalId, JournalPosition | null>,
  acceptedAt: JournalPosition | null
): boolean =>
  !live.has(proposal.id) &&
  !liveActionKeys.has(liveActionKeyOf(proposal)) &&
  deferred.get(proposal.id) !== acceptedAt &&
  (proposal.waitsForLiveOperationId === null || !liveOperationIds.has(proposal.waitsForLiveOperationId))

/** A settled semantic owner remains until the ordinary relation no longer proposes the same live action. */
export const liveActionIsPresent = (frontier: DeliveryProposalFrontier, proposal: DeliveryActionProposal): boolean => {
  if (frontier._tag === "DeliveryProposalOwnershipConflict") {
    return frontier.conflicts.some(({ id }) => id === proposal.id)
  }
  const key = liveActionKeyOf(proposal)
  return frontier.proposals.some((candidate) => liveActionKeyOf(candidate) === key)
}
