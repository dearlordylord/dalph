import type { DeliveryActionProposal } from "./delivery-action-proposal.js"
import type { DeliveryRuntimeEvaluation } from "./relations.js"
import type { DeliveryRuntimeLiveOwnerSnapshot } from "./delivery-runtime-observation.js"
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
  owner: DeliveryRuntimeLiveOwnerSnapshot,
  current: DeliveryActionProposal,
  evaluation: DeliveryRuntimeEvaluation
): boolean => {
  const admitted = owner.proposal
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
    currentProposalEncodingForOwner(owner, current, { ...current.order, acceptedAt: originalPrefix })
  )
}

const isReadProposal = (proposal: DeliveryActionProposal): boolean => {
  if (proposal.route._tag !== "RecoveredNewActionRoute") return false
  const action = proposal.route.action
  return (
    action._tag === "ReadTrackerGraph" ||
    action._tag === "ReadTaskWorkSpecification" ||
    action._tag === "ReadTaskClaim" ||
    action._tag === "ReadTaskWorktree" ||
    action._tag === "ReadTargetLineage"
  )
}

const recordedOperationId = (owner: DeliveryRuntimeLiveOwnerSnapshot) =>
  (owner._tag === "MaterializedDeliveryAction" || owner._tag === "SettledMaterializedDeliveryAction") &&
  owner.intent === "IntentRecorded"
    ? owner.operationId
    : undefined

const preservesMaterializedReadIdentity = (
  owner: DeliveryRuntimeLiveOwnerSnapshot,
  current: DeliveryActionProposal
): boolean => {
  const operationId = recordedOperationId(owner)
  if (operationId === undefined || !isReadProposal(owner.proposal)) return false
  const admittedIdentity = owner.proposal.actionIdentity
  if (admittedIdentity._tag !== "FreshOperationIdRequired" || admittedIdentity.source._tag !== "Allocate") return false
  return (
    canonicalEncodingOf(current.actionIdentity) ===
    canonicalEncodingOf({ _tag: "FreshOperationIdRequired", source: { _tag: "Preserve", operationId } })
  )
}

const currentProposalEncodingForOwner = (
  owner: DeliveryRuntimeLiveOwnerSnapshot,
  current: DeliveryActionProposal,
  order: DeliveryActionProposal["order"]
): string =>
  canonicalEncodingOf({
    ...current,
    order,
    ...(preservesMaterializedReadIdentity(owner, current) ? { actionIdentity: owner.proposal.actionIdentity } : {})
  })

/** Current evaluation and integration-list positions may move without changing an already admitted action. */
export const currentProposalPresentationMatches = (
  owner: DeliveryRuntimeLiveOwnerSnapshot,
  current: DeliveryActionProposal,
  evaluation: DeliveryRuntimeEvaluation
): boolean => {
  const admitted = owner.proposal
  if (admitted.order._tag === "IntegrationOrder" && current.order._tag === "IntegrationOrder") {
    return (
      canonicalEncodingOf(admitted) ===
      currentProposalEncodingForOwner(owner, current, {
        ...current.order,
        frontierOrdinal: admitted.order.frontierOrdinal
      })
    )
  }
  return currentEvaluationPositionMatches(owner, current, evaluation)
}
