import { Data, Option, Schema } from "effect"
import {
  RemoteBaselineCorrelation,
  type RemoteBaselineCorrelation as RemoteBaselineCorrelationType
} from "../../workflow/protocols/direct-publication/baseline-events.js"
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
  /** One committed baseline catch-up continuation waits for a fresh Run activation. */
  RemoteBaselineReconciliationPending: { readonly correlation: RemoteBaselineCorrelationType }
}>

export const DeliveryRuntimeLocalDeferral = Data.taggedEnum<DeliveryRuntimeLocalDeferral>()

const remoteBaselineCorrelationEquals = Schema.toEquivalence(RemoteBaselineCorrelation)

const remoteBaselineCorrelationOf = (proposal: DeliveryActionProposal): RemoteBaselineCorrelationType | undefined => {
  const route = proposal.route
  return route._tag === "IdentityFreeWorkflowRoute" && route.transition._tag === "EstablishRemoteBaseline"
    ? route.transition.correlation
    : undefined
}

/** Matches one exact remote-baseline continuation across frontier refreshes. */
export const deliveryRuntimeLocalDeferralMatchesProposal = (
  deferral: DeliveryRuntimeLocalDeferral,
  proposal: DeliveryActionProposal
): boolean => {
  if (deferral._tag !== "RemoteBaselineReconciliationPending") return false
  const correlation = remoteBaselineCorrelationOf(proposal)
  return correlation !== undefined && remoteBaselineCorrelationEquals(deferral.correlation, correlation)
}

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
): Option.Option<DeliveryRuntimeLocalDeferral> => {
  if (result._tag === "ActionDeferred") {
    const correlation =
      result.reason === "RemoteBaselineReconciliationPending" ? remoteBaselineCorrelationOf(proposal) : undefined
    return correlation === undefined
      ? Option.some(DeliveryRuntimeLocalDeferral.AwaitChangedAcceptedFacts({ acceptedAt }))
      : Option.some(DeliveryRuntimeLocalDeferral.RemoteBaselineReconciliationPending({ correlation }))
  }
  return isExactExecutingObserveAttachment(result, proposal)
    ? Option.some(DeliveryRuntimeLocalDeferral.PassiveOwnerAttached({ liveActionKey: liveActionKeyOf(proposal) }))
    : result._tag === "ExecutorReportPublished" && result.acceptedFacts === "UnchangedPassiveObservation"
      ? Option.some(DeliveryRuntimeLocalDeferral.AwaitChangedAcceptedFacts({ acceptedAt }))
      : Option.none()
}

/** Whether this activation-local marker still excludes the proposal from admission. */
export const deliveryRuntimeLocalDeferralAppliesAt = (
  deferral: DeliveryRuntimeLocalDeferral,
  acceptedAt: JournalPosition | null
): boolean =>
  deferral._tag === "PassiveOwnerAttached" ||
  deferral._tag === "RemoteBaselineReconciliationPending" ||
  deferral.acceptedAt === acceptedAt
