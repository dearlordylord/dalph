import type { DeliveryActionProposal } from "./delivery-action-proposal.js"
import type { DeliveryRuntimeEvaluation } from "./relations.js"
import { canonicalEncodingOf } from "./delivery-status-order.js"

const trackerGraphBoundaryMatches = (admitted: DeliveryActionProposal, current: DeliveryActionProposal): boolean =>
  admitted.order._tag !== "TrackerGraphOrder" ||
  (admitted.owner === "TrackerGraph" &&
    current.owner === "TrackerGraph" &&
    admitted.route._tag === "TrackerGraphReadRoute" &&
    current.route._tag === "TrackerGraphReadRoute")

const evaluationPrefixMatches = (
  originalPrefix: DeliveryRuntimeEvaluation["acceptedAt"],
  currentPrefix: DeliveryRuntimeEvaluation["acceptedAt"],
  evaluation: DeliveryRuntimeEvaluation
): boolean => {
  if (currentPrefix !== evaluation.acceptedAt) return false
  if (originalPrefix !== null && (currentPrefix === null || currentPrefix < originalPrefix)) return false
  return true
}

const currentEvaluationPositionMatches = (
  admitted: DeliveryActionProposal,
  current: DeliveryActionProposal,
  evaluation: DeliveryRuntimeEvaluation
): boolean => {
  if (
    (admitted.order._tag !== "TrackerGraphOrder" && admitted.order._tag !== "RecoveredWorkflowOrder") ||
    (current.order._tag !== "TrackerGraphOrder" && current.order._tag !== "RecoveredWorkflowOrder") ||
    admitted.order._tag !== current.order._tag
  )
    return false
  if (!trackerGraphBoundaryMatches(admitted, current)) return false
  const originalPrefix = admitted.order.acceptedAt
  const currentPrefix = current.order.acceptedAt
  if (!evaluationPrefixMatches(originalPrefix, currentPrefix, evaluation)) return false
  return (
    canonicalEncodingOf(admitted) ===
    canonicalEncodingOf({ ...current, order: { ...current.order, acceptedAt: originalPrefix } })
  )
}

/** Current evaluation and integration-list positions may move without changing an already admitted action. */
export const currentProposalPresentationMatches = (
  admitted: DeliveryActionProposal,
  current: DeliveryActionProposal,
  evaluation: DeliveryRuntimeEvaluation
): boolean => {
  if (admitted.order._tag === "IntegrationOrder" && current.order._tag === "IntegrationOrder") {
    return (
      canonicalEncodingOf(admitted) ===
      canonicalEncodingOf({ ...current, order: { ...current.order, frontierOrdinal: admitted.order.frontierOrdinal } })
    )
  }
  return currentEvaluationPositionMatches(admitted, current, evaluation)
}
