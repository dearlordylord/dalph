import { Data, Option } from "effect"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { DeliveryActionResult } from "./delivery-action-executor.js"
import type { DeliveryActionProposal } from "./delivery-action-proposal.js"
import { liveActionKeyOf, type LiveDeliveryActionKey } from "./live-delivery-action-key.js"

/** Why an exact proposal or its stable live action is excluded within this runtime activation. */
export type DeliveryRuntimeLocalDeferral = Data.TaggedEnum<{
  /** One exact proposal could not proceed from the currently accepted Journal facts. */
  AwaitChangedAcceptedFacts: { readonly acceptedAt: JournalPosition | null }
  /** The stable live action has already installed its process-local passive owner. */
  PassiveOwnerAttached: { readonly liveActionKey: LiveDeliveryActionKey }
}>

export const DeliveryRuntimeLocalDeferral = Data.taggedEnum<DeliveryRuntimeLocalDeferral>()

const isExactExecutingObserveAttachment = (result: DeliveryActionResult, proposal: DeliveryActionProposal): boolean => {
  if (
    result._tag !== "ExecutorReportPublished" ||
    result.acceptedFacts !== "UnchangedPassiveObservation" ||
    result.report._tag !== "ExecutorWorkExecuting"
  ) {
    return false
  }
  const route = proposal.route
  return (
    (route._tag === "FreshExecutorWorkflowRoute" && route.step._tag === "ObservePlannedAttemptExecutorWork") ||
    (route._tag === "IdentityFreeWorkflowRoute" && route.transition._tag === "ObservePlannedAttemptExecutorWork")
  )
}

/** Classifies only outcomes that truthfully require activation-local exclusion. */
export const deliveryRuntimeLocalDeferralAfter = (
  result: DeliveryActionResult,
  proposal: DeliveryActionProposal,
  acceptedAt: JournalPosition | null
): Option.Option<DeliveryRuntimeLocalDeferral> =>
  result._tag === "ActionDeferred"
    ? Option.some(DeliveryRuntimeLocalDeferral.AwaitChangedAcceptedFacts({ acceptedAt }))
    : isExactExecutingObserveAttachment(result, proposal)
      ? Option.some(DeliveryRuntimeLocalDeferral.PassiveOwnerAttached({ liveActionKey: liveActionKeyOf(proposal) }))
      : result._tag === "ExecutorReportPublished" && result.acceptedFacts === "UnchangedPassiveObservation"
        ? Option.some(DeliveryRuntimeLocalDeferral.AwaitChangedAcceptedFacts({ acceptedAt }))
        : Option.none()

/** Whether this activation-local marker still excludes the proposal from admission. */
export const deliveryRuntimeLocalDeferralAppliesAt = (
  deferral: DeliveryRuntimeLocalDeferral,
  acceptedAt: JournalPosition | null
): boolean => deferral._tag === "PassiveOwnerAttached" || deferral.acceptedAt === acceptedAt
