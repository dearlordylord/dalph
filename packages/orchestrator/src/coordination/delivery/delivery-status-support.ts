import { plannedAttemptExecutorCorrelation, plannedAttemptExecutorCorrelationKey, type TaskId } from "@dalph/contracts"
import type { DeliveryRuntimeLiveOwnerSnapshot } from "./delivery-runtime-observation.js"
import type { DeliveryActionProposal } from "./delivery-action-proposal.js"
import type {
  DeliveryRuntimeSnapshot,
  DeliveryRuntimeEvaluation,
  ExactWorkflowObligation,
  TicketDelivery,
  TicketDeliveryStanding
} from "./relations.js"
import type { ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import type { IntegrationDeliveryWait } from "../frontier/integration-frontier.js"
import {
  acceptedStandingSettlementTagFor,
  dependencyWaitIsEmpty,
  responsibilityHasStatusProjection,
  trackerFactForClaimState
} from "./delivery-status-responsibility-semantics.js"
import {
  DeliveryStatusProjectionConflict,
  makeDeliveryStatusEntryIdentity,
  type DeliveryStatusGraphSource,
  type DeliveryStatusIntegrationStanding,
  type DeliveryStatusEntry,
  type DeliveryStatusSubject,
  type DeliveryStatusTrackerFact,
  type DeliveryStatusWakeCondition
} from "./delivery-status-model.js"
import { workflowResponsibilityKey } from "../reconstruction/state.js"
import { addEntry, canonicalEncodingOf, canonicalIdentity, taskOrderFor } from "./delivery-status-order.js"
import type { OrderedStatusEntry, StatusTaskOrder, StatusTaskOrderLookup } from "./delivery-status-order.js"
import * as deliveryStatusSettlement from "./delivery-status-settlement.js"
import { taskStatusSubject } from "./delivery-status-subject.js"
import { validateResponsibilityIdentityForStatus } from "./delivery-status-responsibility-identity.js"

export {
  addEntry,
  compareOrderedEntries,
  deliveryTaskOrder,
  obligationForEvidenceConflict,
  runWideTaskOrder,
  statusEntryIdentity,
  statusEntryJson,
  canonicalIdentity
} from "./delivery-status-order.js"
export type { OrderedStatusEntry } from "./delivery-status-order.js"
export { trackerFactForDisposition, unavailableFromFacts } from "./delivery-status-responsibility-semantics.js"
export { taskStatusSubject } from "./delivery-status-subject.js"

export const includeForSubject = (subject: DeliveryStatusSubject, taskId: TaskId | null): boolean =>
  subject._tag === "Run" || (taskId !== null && subject.taskId === taskId)

const missingTaskOrderConflictFor = (
  subject: DeliveryStatusSubject,
  taskId: TaskId
): DeliveryStatusProjectionConflict =>
  new DeliveryStatusProjectionConflict({
    subject,
    entryIdentity: makeDeliveryStatusEntryIdentity(canonicalIdentity(["missing-task-order", taskId])),
    detail: "a task-scoped status entry has no accepted task order"
  })

export const taskOrderOrConflictFor = (
  subject: DeliveryStatusSubject,
  taskOrders: ReadonlyMap<TaskId, StatusTaskOrder>,
  taskId: TaskId
): StatusTaskOrder | DeliveryStatusProjectionConflict => {
  const order: StatusTaskOrderLookup = taskOrderFor(taskOrders, taskId)
  return order._tag === "MissingTaskOrder" ? missingTaskOrderConflictFor(subject, taskId) : order
}

export const emptyDependencyConflictFor = (
  subject: DeliveryStatusSubject,
  taskId: TaskId,
  standingTag: "GraphExcluded" | "PromotedPrerequisiteReleasePending" | "ResponsibilitySituation" | "IntegrationWait"
): DeliveryStatusProjectionConflict =>
  new DeliveryStatusProjectionConflict({
    subject,
    entryIdentity: makeDeliveryStatusEntryIdentity(canonicalIdentity(["empty-dependency", taskId, standingTag])),
    detail: "a dependency wait has no prerequisite task identity"
  })

export const addDependencyEntry = (
  subject: DeliveryStatusSubject,
  taskId: TaskId,
  prerequisiteTaskIds: ReadonlyArray<TaskId>,
  standing: Extract<DeliveryStatusEntry, { readonly _tag: "DependencyWait" }>["standing"],
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  const [first, ...rest] = prerequisiteTaskIds
  if (first === undefined) return
  addEntry(
    entries,
    {
      _tag: "DependencyWait",
      classification: "Waiting",
      subject: taskStatusSubject(subject, taskId),
      taskId,
      prerequisiteTaskIds: [first, ...rest],
      standing
    },
    taskOrder
  )
}

type IntegrationWaitStanding = Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>
export const integrationConfigurationStandingFor = (
  standing: IntegrationWaitStanding
): DeliveryStatusIntegrationStanding<"IntegrationConfigurationWait"> | null =>
  standing.wait._tag === "IntegrationConfigurationWait" ? { ...standing, wait: standing.wait } : null

export const targetPromotionConfigurationStandingFor = (
  standing: IntegrationWaitStanding
): DeliveryStatusIntegrationStanding<"TargetPromotionConfigurationWait"> | null =>
  standing.wait._tag === "TargetPromotionConfigurationWait" ? { ...standing, wait: standing.wait } : null

export const integrationDependencyStandingFor = (
  standing: IntegrationWaitStanding
): DeliveryStatusIntegrationStanding<"IntegrationDependencyWait"> | null =>
  standing.wait._tag === "IntegrationDependencyWait" ? { ...standing, wait: standing.wait } : null

export const integrationTrackerStandingFor = (
  standing: IntegrationWaitStanding
): DeliveryStatusIntegrationStanding<"IntegrationTrackerFactsWait" | "IntegrationTaskClaimConstraint"> | null => {
  if (standing.wait._tag === "IntegrationTrackerFactsWait") return { ...standing, wait: standing.wait }
  if (standing.wait._tag === "IntegrationTaskClaimConstraint") return { ...standing, wait: standing.wait }
  return null
}

export const integrationTargetStandingFor = (
  standing: IntegrationWaitStanding
): DeliveryStatusIntegrationStanding<"IntegrationTargetWait"> | null =>
  standing.wait._tag === "IntegrationTargetWait" ? { ...standing, wait: standing.wait } : null

export const obligationForResponsibility = (
  delivery: TicketDelivery,
  facts: ResponsibilityFreshFacts
): ExactWorkflowObligation | null => {
  const identity = workflowResponsibilityKey(facts.responsibility)
  return (
    delivery.obligations.find(
      (candidate) =>
        candidate._tag === "WorkflowResponsibility" && workflowResponsibilityKey(candidate.responsibility) === identity
    ) ?? null
  )
}

const sameAttempt = (
  left: IntegrationDeliveryWait["plannedAttempt"],
  right: IntegrationDeliveryWait["plannedAttempt"]
): boolean =>
  plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(left)) ===
  plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(right))

export const queuedIntegrationResponsibilityFor = (
  delivery: TicketDelivery,
  plannedAttempt: IntegrationDeliveryWait["plannedAttempt"]
): ExactWorkflowObligation | null =>
  delivery.obligations.find(
    (obligation) =>
      obligation._tag === "QueuedIntegration" && sameAttempt(obligation.responsibility.plannedAttempt, plannedAttempt)
  ) ?? null

export const obligationForPlannedAttempt = (
  delivery: TicketDelivery,
  plannedAttempt: IntegrationDeliveryWait["plannedAttempt"]
): ExactWorkflowObligation | null =>
  delivery.obligations.find((obligation) => {
    if (obligation._tag === "AcceptedAwaitingIntegration")
      return sameAttempt(obligation.accepted.plannedAttempt, plannedAttempt)
    if (obligation._tag === "QueuedIntegration")
      return sameAttempt(obligation.responsibility.plannedAttempt, plannedAttempt)
    if (obligation._tag === "StartedIntegration")
      return sameAttempt(obligation.responsibility.plannedAttempt, plannedAttempt)
    return (
      obligation.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
      sameAttempt(obligation.responsibility.plannedAttempt, plannedAttempt)
    )
  }) ?? null

export const ownerIsSettled = (
  owner: DeliveryRuntimeLiveOwnerSnapshot
): owner is Extract<
  DeliveryRuntimeLiveOwnerSnapshot,
  { readonly _tag: "SettledBeforeMaterialization" | "SettledMaterializedDeliveryAction" }
> => owner._tag === "SettledBeforeMaterialization" || owner._tag === "SettledMaterializedDeliveryAction"

const proposalEquals = (left: DeliveryActionProposal, right: DeliveryActionProposal): boolean =>
  canonicalEncodingOf(left) === canonicalEncodingOf(right)

const liveOwnerConflict = (
  subject: DeliveryStatusSubject,
  proposalId: string,
  detail: string
): DeliveryStatusProjectionConflict =>
  new DeliveryStatusProjectionConflict({
    subject,
    entryIdentity: makeDeliveryStatusEntryIdentity(canonicalIdentity(["live-owner", proposalId])),
    detail
  })

/** Live owners are valid only as one exact lifecycle snapshot of one current proposal. */
export const validateLiveOwnersForStatus = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
): DeliveryStatusProjectionConflict | null => {
  if (evaluation.proposedActions._tag !== "DeliveryProposalsAvailable") return null
  const duplicateProposal = evaluation.proposedActions.proposals.find(
    (proposal, index, proposals) => proposals.findIndex(({ id }) => id === proposal.id) !== index
  )
  if (duplicateProposal !== undefined) {
    return liveOwnerConflict(subject, duplicateProposal.id, "the current proposal frontier repeats one action identity")
  }
  const duplicateOwner = liveOwners.find(
    (owner, index, owners) => owners.findIndex(({ proposal }) => proposal.id === owner.proposal.id) !== index
  )
  if (duplicateOwner !== undefined) {
    return liveOwnerConflict(
      subject,
      duplicateOwner.proposal.id,
      "multiple live lifecycle snapshots claim one exact proposal"
    )
  }
  for (const owner of liveOwners) {
    const proposalId = owner.proposal.id
    const current = evaluation.proposedActions.proposals.find(({ id }) => id === proposalId)
    if (current === undefined) {
      return liveOwnerConflict(subject, proposalId, "a live owner proposal is absent from the current frontier")
    }
    if (!proposalEquals(owner.proposal, current)) {
      return liveOwnerConflict(subject, proposalId, "a live owner proposal differs from the current frontier proposal")
    }
  }
  return null
}

export const integrationTrackerFactForWait = (
  wait: Extract<
    IntegrationDeliveryWait,
    { readonly _tag: "IntegrationTaskClaimConstraint" | "IntegrationTrackerFactsWait" }
  >
): { readonly fact: DeliveryStatusTrackerFact; readonly wakeCondition: DeliveryStatusWakeCondition } => {
  if (wait._tag === "IntegrationTrackerFactsWait") {
    return { fact: trackerFactForClaimState("Unobserved").fact, wakeCondition: "TaskTrackerFactsObserved" }
  }
  return trackerFactForClaimState(wait.claimState)
}

export const graphSourceOf = (snapshot: DeliveryRuntimeSnapshot): DeliveryStatusGraphSource | null => {
  if (snapshot.trackerGraph._tag !== "GraphEstablished") return null
  const observation = snapshot.trackerGraph.observation
  return {
    _tag: "EstablishedGraph",
    revision: observation.snapshot.revision,
    operationId: observation.operationId,
    freshnessOperationId: observation.freshness.operationId,
    contentIdentity: observation.contentIdentity,
    recordedAt: observation.recordedAt
  }
}

const responsibilityProjectionConflict = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery
): DeliveryStatusProjectionConflict =>
  new DeliveryStatusProjectionConflict({
    subject,
    entryIdentity: makeDeliveryStatusEntryIdentity(canonicalIdentity(["responsibility", delivery.taskId])),
    detail: "a tracker or unavailable-fact standing has no matching exact responsibility obligation"
  })

const validateResponsibilityStandingForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>
): DeliveryStatusProjectionConflict | null => {
  const acceptedConflict = deliveryStatusSettlement.validateAcceptedStandingForStatus(subject, delivery, standing)
  if (acceptedConflict !== null) return acceptedConflict
  const identityConflict = validateResponsibilityIdentityForStatus(subject, delivery, standing.facts.responsibility)
  if (identityConflict !== null) return identityConflict
  const responsibility = obligationForResponsibility(delivery, standing.facts)
  if (standing.facts.disposition._tag === "Relinquished") return null
  const acceptedStanding = acceptedStandingSettlementTagFor(standing.facts) !== null
  const hasStatusProjection = responsibilityHasStatusProjection(standing.facts, acceptedStanding)
  if (responsibility === null && hasStatusProjection && !acceptedStanding) {
    return responsibilityProjectionConflict(subject, delivery)
  }
  if (dependencyWaitIsEmpty(standing.facts)) {
    return new DeliveryStatusProjectionConflict({
      subject,
      entryIdentity: makeDeliveryStatusEntryIdentity(
        canonicalIdentity(["responsibility", delivery.taskId, "DependencyWait"])
      ),
      detail: "a dependency wait must retain at least one prerequisite task"
    })
  }
  return null
}

const integrationTargetProjectionConflict = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery
): DeliveryStatusProjectionConflict =>
  new DeliveryStatusProjectionConflict({
    subject,
    entryIdentity: makeDeliveryStatusEntryIdentity(canonicalIdentity(["integration-target", delivery.taskId])),
    detail: "an integration target wait has no matching queued integration responsibility"
  })

const integrationTrackerProjectionConflict = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery
): DeliveryStatusProjectionConflict =>
  new DeliveryStatusProjectionConflict({
    subject,
    entryIdentity: makeDeliveryStatusEntryIdentity(canonicalIdentity(["integration-tracker", delivery.taskId])),
    detail: "an integration tracker wait has no matching exact planned-attempt obligation"
  })

const validateIntegrationTrackerStandingForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>
): DeliveryStatusProjectionConflict | null => {
  if (standing.wait._tag !== "IntegrationTrackerFactsWait" && standing.wait._tag !== "IntegrationTaskClaimConstraint") {
    return null
  }
  return obligationForPlannedAttempt(delivery, standing.wait.plannedAttempt) === null
    ? integrationTrackerProjectionConflict(subject, delivery)
    : null
}

const integrationWaitProjectionConflict = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  wait: IntegrationDeliveryWait
): DeliveryStatusProjectionConflict =>
  new DeliveryStatusProjectionConflict({
    subject,
    entryIdentity: makeDeliveryStatusEntryIdentity(canonicalIdentity(["integration-wait", delivery.taskId, wait._tag])),
    detail: `the ${wait._tag} has no matching exact obligation or non-empty supporting facts`
  })

const validateIntegrationDependencyWait = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>
): DeliveryStatusProjectionConflict | null => {
  if (standing.wait._tag !== "IntegrationDependencyWait") return null
  const responsibility = obligationForPlannedAttempt(delivery, standing.wait.plannedAttempt)
  return standing.wait.prerequisiteTaskIds.length === 0 || responsibility?._tag !== "StartedIntegration"
    ? integrationWaitProjectionConflict(subject, delivery, standing.wait)
    : null
}

const validateIntegrationConfigurationWait = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>
): DeliveryStatusProjectionConflict | null => {
  if (standing.wait._tag !== "IntegrationConfigurationWait") return null
  const responsibility = obligationForPlannedAttempt(delivery, standing.wait.plannedAttempt)
  return responsibility?._tag !== "AcceptedAwaitingIntegration"
    ? integrationWaitProjectionConflict(subject, delivery, standing.wait)
    : null
}

const validateTargetPromotionConfigurationWait = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>
): DeliveryStatusProjectionConflict | null => {
  if (standing.wait._tag !== "TargetPromotionConfigurationWait") return null
  const responsibility = obligationForPlannedAttempt(delivery, standing.wait.plannedAttempt)
  return responsibility?._tag !== "StartedIntegration"
    ? integrationWaitProjectionConflict(subject, delivery, standing.wait)
    : null
}

const validateIntegrationStandingForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>
): DeliveryStatusProjectionConflict | null => {
  if (standing.wait.plannedAttempt.taskId !== delivery.taskId) {
    return integrationWaitProjectionConflict(subject, delivery, standing.wait)
  }
  const dependencyConflict = validateIntegrationDependencyWait(subject, delivery, standing)
  if (dependencyConflict !== null) return dependencyConflict
  const configurationConflict = validateIntegrationConfigurationWait(subject, delivery, standing)
  if (configurationConflict !== null) return configurationConflict
  const promotionConflict = validateTargetPromotionConfigurationWait(subject, delivery, standing)
  if (promotionConflict !== null) return promotionConflict
  if (standing.wait._tag === "IntegrationTargetWait") {
    return queuedIntegrationResponsibilityFor(delivery, standing.wait.plannedAttempt) === null
      ? integrationTargetProjectionConflict(subject, delivery)
      : null
  }
  return validateIntegrationTrackerStandingForStatus(subject, delivery, standing)
}

const validateEvidenceConflictForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ExactEvidenceConflict" }>
): DeliveryStatusProjectionConflict | null => {
  const duplicate = standing.evidenceIdentities.find(
    (identity, index, identities) => identities.indexOf(identity) !== index
  )
  return duplicate === undefined
    ? null
    : new DeliveryStatusProjectionConflict({
        subject,
        entryIdentity: makeDeliveryStatusEntryIdentity(canonicalIdentity(["evidence-conflict", delivery.taskId])),
        detail: "an exact evidence conflict repeats one evidence identity"
      })
}

const validateStandingForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: TicketDeliveryStanding
): DeliveryStatusProjectionConflict | null => {
  if (standing._tag === "ResponsibilitySituation") {
    return validateResponsibilityStandingForStatus(subject, delivery, standing)
  }
  if (standing._tag === "ExactEvidenceConflict") {
    return validateEvidenceConflictForStatus(subject, delivery, standing)
  }
  if (standing._tag === "PromotedPrerequisiteReleasePending" && standing.prerequisiteTaskIds.length === 0) {
    return emptyDependencyConflictFor(subject, delivery.taskId, standing._tag)
  }
  return standing._tag === "IntegrationWait" ? validateIntegrationStandingForStatus(subject, delivery, standing) : null
}

export const validateDeliveryEvidenceForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery
): DeliveryStatusProjectionConflict | null => {
  const compositionConflict = deliveryStatusSettlement.validateAcceptedStandingCompositionForStatus(subject, delivery)
  if (compositionConflict !== null) return compositionConflict
  for (const standing of delivery.standings) {
    const conflict = validateStandingForStatus(subject, delivery, standing)
    if (conflict !== null) return conflict
  }
  return null
}
