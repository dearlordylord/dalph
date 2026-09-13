import type { DeliveryActionProposal } from "./delivery-action-proposal.js"
import type { DeliveryRuntimeEvaluation } from "./relations.js"
import { canonicalEncodingOf } from "./delivery-status-order.js"

/** A current evaluation position may advance without changing the original admitted action's causal evidence. */
export const currentEvaluationPositionMatches = (
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
  if (
    admitted.order._tag === "TrackerGraphOrder" &&
    (admitted.owner !== "TrackerGraph" ||
      current.owner !== "TrackerGraph" ||
      admitted.route._tag !== "TrackerGraphReadRoute" ||
      current.route._tag !== "TrackerGraphReadRoute")
  )
    return false
  const originalPrefix = admitted.order.acceptedAt
  const currentPrefix = current.order.acceptedAt
  if (currentPrefix !== evaluation.acceptedAt) return false
  if (originalPrefix !== null && (currentPrefix === null || currentPrefix < originalPrefix)) return false
  return (
    canonicalEncodingOf(admitted) ===
    canonicalEncodingOf({ ...current, order: { ...current.order, acceptedAt: originalPrefix } })
  )
}
