import { plannedAttemptExecutorCorrelation, plannedAttemptExecutorCorrelationKey, type TaskId } from "@dalph/contracts"
import type { OperationId } from "../../workflow/identity.js"
import type { DeliveryRuntimeLiveOwnerSnapshot } from "./delivery-runtime-observation.js"
import type {
  DeliveryRuntimeSnapshot,
  ExactWorkflowObligation,
  TicketDelivery,
  TicketDeliveryStanding
} from "./relations.js"
import type { ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import type { IntegrationDeliveryWait } from "../frontier/integration-frontier.js"
import {
  DeliveryStatusProjectionConflict,
  type DeliveryStatusGraphSource,
  type DeliveryStatusSubject,
  type DeliveryStatusTrackerFact,
  type DeliveryStatusUnavailableEvidence,
  type DeliveryStatusWakeCondition,
  type DeliveryStatusIntegrationStanding
} from "./delivery-status-model.js"
import { workflowResponsibilityKey } from "../reconstruction/state.js"

export {
  addEntry,
  compareOrderedEntries,
  deliveryHolderOrder,
  deliveryTaskOrder,
  obligationForEvidenceConflict,
  runWideTaskOrder,
  statusEntryIdentity,
  statusEntryJson
} from "./delivery-status-order.js"
export type { OrderedStatusEntry } from "./delivery-status-order.js"

export const includeForSubject = (subject: DeliveryStatusSubject, taskId: TaskId | null): boolean =>
  subject._tag === "Run" || (taskId !== null && subject.taskId === taskId)

export const taskStatusSubject = (subject: DeliveryStatusSubject, taskId: TaskId): DeliveryStatusSubject =>
  subject._tag === "Task" ? subject : { _tag: "Task", runId: subject.runId, taskId }

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

export const ownerOperationId = (owner: DeliveryRuntimeLiveOwnerSnapshot): OperationId | null =>
  owner._tag === "MaterializedDeliveryAction" || owner._tag === "SettledMaterializedDeliveryAction"
    ? owner.operationId
    : null

type TrackerFactProjection = {
  readonly fact: DeliveryStatusTrackerFact
  readonly wakeCondition: DeliveryStatusWakeCondition
}

const missingTrackerFact: TrackerFactProjection = {
  fact: { _tag: "Missing", boundary: "TaskTracker" },
  wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection"
}
const unreadableTrackerFact: TrackerFactProjection = {
  fact: { _tag: "Unreadable", boundary: "TaskTracker" },
  wakeCondition: "TaskClaimFactsObserved"
}
const foreignTrackerFact: TrackerFactProjection = {
  fact: { _tag: "Foreign", boundary: "TaskTracker" },
  wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection"
}
const unobservedTrackerFact: TrackerFactProjection = {
  fact: { _tag: "Unobserved", boundary: "TaskTracker" },
  wakeCondition: "TaskClaimFactsObserved"
}
const taskTrackerRereadFact: TrackerFactProjection = {
  fact: { _tag: "Unreadable", boundary: "TaskTracker" },
  wakeCondition: "BoundaryRereadSucceeded"
}

const trackerFactForClaimState = (
  claimState: "Foreign" | "Missing" | "Unreadable" | "Unobserved"
): TrackerFactProjection => {
  if (claimState === "Missing") return missingTrackerFact
  if (claimState === "Unreadable") return unreadableTrackerFact
  if (claimState === "Foreign") return foreignTrackerFact
  return unobservedTrackerFact
}

const directTrackerFactForDisposition = (facts: ResponsibilityFreshFacts): TrackerFactProjection | null => {
  const disposition = facts.disposition
  if (disposition._tag === "TaskClaimMissingConstraint" || disposition._tag === "MissingClaim") {
    return missingTrackerFact
  }
  if (disposition._tag === "TaskClaimUnreadableWait") return unreadableTrackerFact
  if (disposition._tag === "TaskForeignClaimIsolation" || disposition._tag === "ForeignClaimIsolation") {
    return foreignTrackerFact
  }
  return null
}

export const trackerFactForDisposition = (facts: ResponsibilityFreshFacts): TrackerFactProjection | null => {
  const disposition = facts.disposition
  if (disposition._tag === "WorkflowOperationTaskClaimConstraint") {
    return trackerFactForClaimState(disposition.claimState)
  }
  if (disposition._tag === "UnreadableFactWait" && disposition.boundary === "TaskTracker") {
    return taskTrackerRereadFact
  }
  return directTrackerFactForDisposition(facts)
}

export const unavailableFromFacts = (facts: ResponsibilityFreshFacts): DeliveryStatusUnavailableEvidence | null => {
  const disposition = facts.disposition
  if (disposition._tag === "Ready" || disposition._tag === "Relinquished" || disposition._tag === "DependencyWait") {
    return null
  }
  if (trackerFactForDisposition(facts) !== null) return null
  return { _tag: "ResponsibilityFacts", facts }
}

export const integrationTrackerFactForWait = (
  wait: Extract<
    IntegrationDeliveryWait,
    { readonly _tag: "IntegrationTaskClaimConstraint" | "IntegrationTrackerFactsWait" }
  >
): { readonly fact: DeliveryStatusTrackerFact; readonly wakeCondition: DeliveryStatusWakeCondition } => {
  if (wait._tag === "IntegrationTrackerFactsWait") {
    return { fact: { _tag: "Unobserved", boundary: "TaskTracker" }, wakeCondition: "TaskTrackerFactsObserved" }
  }
  if (wait.claimState === "Missing") {
    return {
      fact: { _tag: "Missing", boundary: "TaskTracker" },
      wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection"
    }
  }
  if (wait.claimState === "Unreadable") {
    return { fact: { _tag: "Unreadable", boundary: "TaskTracker" }, wakeCondition: "TaskClaimFactsObserved" }
  }
  if (wait.claimState === "Foreign") {
    return {
      fact: { _tag: "Foreign", boundary: "TaskTracker" },
      wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection"
    }
  }
  return { fact: { _tag: "Unobserved", boundary: "TaskTracker" }, wakeCondition: "TaskClaimFactsObserved" }
}

export const isIntegrationStandingFor = <WaitTag extends IntegrationDeliveryWait["_tag"]>(
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>,
  waitTag: WaitTag
): standing is DeliveryStatusIntegrationStanding<WaitTag> => standing.wait._tag === waitTag

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
    entryIdentity: `responsibility:${delivery.taskId}`,
    detail: "a tracker or unavailable-fact standing has no matching exact responsibility obligation"
  })

const responsibilityHasStatusProjection = (facts: ResponsibilityFreshFacts): boolean => {
  const dependency = facts.disposition._tag === "DependencyWait" && facts.disposition.prerequisiteTaskIds.length > 0
  return (
    trackerFactForDisposition(facts) !== null ||
    unavailableFromFacts(facts)?._tag === "ResponsibilityFacts" ||
    dependency
  )
}

const unsupportedResponsibilityConflict = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  facts: ResponsibilityFreshFacts
): DeliveryStatusProjectionConflict =>
  new DeliveryStatusProjectionConflict({
    subject,
    entryIdentity: `responsibility:${delivery.taskId}:${facts.disposition._tag}`,
    detail: `the ${facts.disposition._tag} has no exact public status entry variant`
  })

const validateResponsibilityStandingForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>
): DeliveryStatusProjectionConflict | null => {
  const responsibility = obligationForResponsibility(delivery, standing.facts)
  if (standing.facts.disposition._tag === "Relinquished") return null
  const hasStatusProjection = responsibilityHasStatusProjection(standing.facts)
  if (responsibility === null && hasStatusProjection) return responsibilityProjectionConflict(subject, delivery)
  if (!hasStatusProjection && standing.facts.disposition._tag !== "Ready") {
    return unsupportedResponsibilityConflict(subject, delivery, standing.facts)
  }
  if (
    standing.facts.disposition._tag === "DependencyWait" &&
    standing.facts.disposition.prerequisiteTaskIds.length === 0
  ) {
    return new DeliveryStatusProjectionConflict({
      subject,
      entryIdentity: `responsibility:${delivery.taskId}:DependencyWait`,
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
    entryIdentity: `integration-target:${delivery.taskId}`,
    detail: "an integration target wait has no matching queued integration responsibility"
  })

const integrationTrackerProjectionConflict = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery
): DeliveryStatusProjectionConflict =>
  new DeliveryStatusProjectionConflict({
    subject,
    entryIdentity: `integration-tracker:${delivery.taskId}`,
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
    entryIdentity: `integration-wait:${delivery.taskId}:${wait._tag}`,
    detail: `the ${wait._tag} has no matching exact obligation or non-empty supporting facts`
  })

const validateIntegrationDependencyWait = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>
): DeliveryStatusProjectionConflict | null => {
  if (standing.wait._tag !== "IntegrationDependencyWait") return null
  const responsibility = obligationForPlannedAttempt(delivery, standing.wait.plannedAttempt)
  return standing.wait.prerequisiteTaskIds.length === 0 ||
    standing.wait.plannedAttempt.taskId !== delivery.taskId ||
    responsibility?._tag !== "StartedIntegration"
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

export const validateDeliveryEvidenceForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery
): DeliveryStatusProjectionConflict | null => {
  for (const standing of delivery.standings) {
    const responsibilityConflict =
      standing._tag === "ResponsibilitySituation"
        ? validateResponsibilityStandingForStatus(subject, delivery, standing)
        : null
    if (responsibilityConflict !== null) return responsibilityConflict
    const integrationConflict =
      standing._tag === "IntegrationWait" ? validateIntegrationStandingForStatus(subject, delivery, standing) : null
    if (integrationConflict !== null) return integrationConflict
  }
  return null
}
