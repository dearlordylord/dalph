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

const recoveredReadSubject = (proposal: DeliveryActionProposal): ReadonlyArray<string> | undefined => {
  const route = proposal.route
  if (route._tag !== "RecoveredNewActionRoute" || proposal.order._tag !== "RecoveredWorkflowOrder") return undefined
  const action = route.action
  if (!("operation" in action) || action.operation._tag === "ReleaseTaskClaim") return undefined
  if (action.plannedAttempt !== null) {
    return [proposal.order.transition, "Attempt", action.plannedAttempt.runId, action.plannedAttempt.attemptId]
  }
  return action._tag === "ReadTaskClaim" && proposal.order.transition === "ObserveResponsibleTaskClaim"
    ? [proposal.order.transition, "Task", action.taskId]
    : undefined
}

export const liveActionKeyOf = (proposal: DeliveryActionProposal): LiveDeliveryActionKey => {
  const subject = recoveredReadSubject(proposal)
  return subject === undefined
    ? liveActionKey(["DeliveryProposal", proposal.id])
    : liveActionKey(["RecoveredRead", ...subject])
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
