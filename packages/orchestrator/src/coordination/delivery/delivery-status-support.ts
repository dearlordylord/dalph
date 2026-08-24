/* eslint-disable functional/immutable-data -- local projection scratch state never escapes the read. */
import {
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedAttemptExecutorCorrelation,
  type TaskId
} from "@dalph/contracts"
import { Match } from "effect"
import type { OperationId } from "../../workflow/identity.js"
import type { DeliveryRuntimeLiveOwnerSnapshot } from "./delivery-runtime-observation.js"
import type {
  DeliveryRuntimeEvaluation,
  DeliveryRuntimeSnapshot,
  ExactWorkflowObligation,
  TicketDelivery,
  TicketDeliveryStanding
} from "./relations.js"
import type { ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import type { IntegrationDeliveryWait } from "../frontier/integration-frontier.js"
import {
  DeliveryStatusProjectionConflict,
  type DeliveryStatusEntry,
  type DeliveryStatusGraphSource,
  type DeliveryStatusSubject,
  type DeliveryStatusTrackerFact,
  type DeliveryStatusUnavailableEvidence,
  type DeliveryStatusWakeCondition
} from "./delivery-status-model.js"
import { workflowResponsibilityKey } from "../reconstruction/state.js"

export const taskStatusSubject = (subject: DeliveryStatusSubject, taskId: TaskId): DeliveryStatusSubject =>
  subject._tag === "Task" ? subject : { _tag: "Task", runId: subject.runId, taskId }

const subjectKey = (subject: DeliveryStatusSubject): string =>
  subject._tag === "Run" ? `Run:${subject.runId}` : `Task:${subject.runId}:${subject.taskId}`

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
    if (obligation._tag === "QueuedIntegration") {
      return sameAttempt(obligation.responsibility.plannedAttempt, plannedAttempt)
    }
    if (obligation._tag === "StartedIntegration") {
      return sameAttempt(obligation.responsibility.plannedAttempt, plannedAttempt)
    }
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
): TrackerFactProjection | null => {
  if (claimState === "Missing") return missingTrackerFact
  if (claimState === "Unreadable") return unreadableTrackerFact
  return claimState === "Unobserved" ? unobservedTrackerFact : null
}

export const trackerFactForDisposition = (facts: ResponsibilityFreshFacts): TrackerFactProjection | null => {
  const disposition = facts.disposition
  if (disposition._tag === "TaskClaimMissingConstraint") return missingTrackerFact
  if (disposition._tag === "TaskClaimUnreadableWait") return unreadableTrackerFact
  if (disposition._tag === "WorkflowOperationTaskClaimConstraint") {
    return trackerFactForClaimState(disposition.claimState)
  }
  return disposition._tag === "UnreadableFactWait" && disposition.boundary === "TaskTracker"
    ? taskTrackerRereadFact
    : null
}

export const unavailableFromFacts = (facts: ResponsibilityFreshFacts): DeliveryStatusUnavailableEvidence | null => {
  const disposition = facts.disposition
  if (disposition._tag === "UnreadableFactWait" && disposition.boundary !== "TaskTracker") {
    return { _tag: "ResponsibilityFacts", facts }
  }
  if (
    disposition._tag === "PlannedAttemptExecutorProjectionWait" ||
    disposition._tag === "AttemptRestartWait" ||
    disposition._tag === "AttemptStoppageWait"
  ) {
    return { _tag: "ResponsibilityFacts", facts }
  }
  return null
}

export const integrationTrackerFactForWait = (
  wait: Extract<
    IntegrationDeliveryWait,
    { readonly _tag: "IntegrationTaskClaimConstraint" | "IntegrationTrackerFactsWait" }
  >
): { readonly fact: DeliveryStatusTrackerFact; readonly wakeCondition: DeliveryStatusWakeCondition } | null => {
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
  if (wait.claimState === "Unobserved") {
    return { fact: { _tag: "Unobserved", boundary: "TaskTracker" }, wakeCondition: "TaskClaimFactsObserved" }
  }
  return null
}

const obligationIdentity = (obligation: ExactWorkflowObligation): string => {
  if (obligation._tag === "WorkflowResponsibility") return workflowResponsibilityKey(obligation.responsibility)
  if (obligation._tag === "AcceptedAwaitingIntegration") {
    return `attempt:${plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(obligation.accepted.plannedAttempt))}`
  }
  if (obligation._tag === "QueuedIntegration") {
    return `queued:${obligation.responsibility.queuedAt}:${plannedAttemptExecutorCorrelationKey(
      plannedAttemptExecutorCorrelation(obligation.responsibility.plannedAttempt)
    )}`
  }
  return `started:${obligation.responsibility.startedAt}:${plannedAttemptExecutorCorrelationKey(
    plannedAttemptExecutorCorrelation(obligation.responsibility.plannedAttempt)
  )}`
}

const statusEntryPrefix = (entry: DeliveryStatusEntry): string => `${entry._tag}:${subjectKey(entry.subject)}`

const statusEntryIdentityFor = Match.typeTags<DeliveryStatusEntry, string>()({
  DependencyWait: (entry) => `${statusEntryPrefix(entry)}:${entry.taskId}:${entry.prerequisiteTaskIds.join(",")}`,
  TrackerFactWait: (entry) =>
    `${statusEntryPrefix(entry)}:${entry.responsibility === null ? "subject" : obligationIdentity(entry.responsibility)}:${entry.fact._tag}`,
  TaskWorkCapacityWait: (entry) => `${statusEntryPrefix(entry)}:${entry.taskId}`,
  ProposedDeliveryAction: (entry) => `${statusEntryPrefix(entry)}:${entry.proposal.id}`,
  LiveDeliveryAction: (entry) => `${statusEntryPrefix(entry)}:${entry.proposal.id}`,
  AcceptedFactPublicationWait: (entry) => `${statusEntryPrefix(entry)}:${entry.proposal.id}`,
  IntegrationTargetWait: (entry) =>
    `${statusEntryPrefix(entry)}:${plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(entry.plannedAttempt))}:${entry.wait._tag}`,
  EvidenceUnavailable: (entry) =>
    `${statusEntryPrefix(entry)}:${entry.evidence._tag}:${entry.responsibility === null ? "subject" : obligationIdentity(entry.responsibility)}`,
  EvidenceConflict: (entry) => `${statusEntryPrefix(entry)}:${entry.evidenceIdentities.join(",")}`,
  Settlement: (entry) => `${statusEntryPrefix(entry)}:${entry.attemptId}`,
  Relinquishment: (entry) =>
    `${statusEntryPrefix(entry)}:${workflowResponsibilityKey(entry.responsibility.responsibility)}`
})

export const statusEntryIdentity = statusEntryIdentityFor

export const statusEntryJson = (entry: DeliveryStatusEntry): string => JSON.stringify(entry)

export interface OrderedStatusEntry {
  readonly entry: DeliveryStatusEntry
  readonly taskOrder: number
  readonly phenomenonOrder: number
  readonly structuralOrder: string
}

/** The accepted structural tie-breakers do not depend on provider-array order. */
const statusEntryStructuralOrder = (entry: DeliveryStatusEntry): string => {
  if (
    entry._tag === "ProposedDeliveryAction" ||
    entry._tag === "LiveDeliveryAction" ||
    entry._tag === "AcceptedFactPublicationWait"
  ) {
    return `${JSON.stringify(entry.proposal.order)}:${entry.proposal.id}`
  }
  return statusEntryIdentity(entry)
}

const phenomenonOrder: Readonly<Record<DeliveryStatusEntry["_tag"], number>> = {
  DependencyWait: 1,
  TrackerFactWait: 2,
  TaskWorkCapacityWait: 3,
  ProposedDeliveryAction: 4,
  LiveDeliveryAction: 5,
  AcceptedFactPublicationWait: 6,
  IntegrationTargetWait: 7,
  EvidenceUnavailable: 8,
  EvidenceConflict: 9,
  Settlement: 10,
  Relinquishment: 11
}

export const runWideTaskOrder = -1

export const compareOrderedEntries = (left: OrderedStatusEntry, right: OrderedStatusEntry): number => {
  const taskOrder = left.taskOrder - right.taskOrder
  if (taskOrder !== 0) return taskOrder
  const phenomenon = left.phenomenonOrder - right.phenomenonOrder
  return phenomenon !== 0 ? phenomenon : left.structuralOrder.localeCompare(right.structuralOrder)
}

export const deliveryTaskOrder = (evaluation: DeliveryRuntimeEvaluation): ReadonlyMap<TaskId, number> =>
  new Map(evaluation.current.ticketDeliveries.deliveries.map(({ taskId }, index) => [taskId, index] as const))

export const deliveryHolderOrder = (
  holders: ReadonlyArray<{ readonly taskId: TaskId; readonly correlation: PlannedAttemptExecutorCorrelation }>
): ReadonlyArray<{ readonly taskId: TaskId; readonly correlation: PlannedAttemptExecutorCorrelation }> =>
  holders.toSorted((left, right) => {
    const task = left.taskId.localeCompare(right.taskId)
    return task !== 0
      ? task
      : plannedAttemptExecutorCorrelationKey(left.correlation).localeCompare(
          plannedAttemptExecutorCorrelationKey(right.correlation)
        )
  })

export const includeForSubject = (subject: DeliveryStatusSubject, taskId: TaskId | null): boolean =>
  subject._tag === "Run" || (taskId !== null && subject.taskId === taskId)

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

export const addEntry = (
  entries: Array<OrderedStatusEntry>,
  entry: DeliveryStatusEntry,
  taskOrder: number,
  _sourceOrder: number
): void => {
  entries.push({
    entry,
    taskOrder,
    phenomenonOrder: phenomenonOrder[entry._tag],
    structuralOrder: statusEntryStructuralOrder(entry)
  })
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

const validateResponsibilityStandingForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>
): DeliveryStatusProjectionConflict | null => {
  const responsibility = obligationForResponsibility(delivery, standing.facts)
  const trackerFact = trackerFactForDisposition(standing.facts)
  const unavailable = unavailableFromFacts(standing.facts)
  return responsibility === null && (trackerFact !== null || unavailable?._tag === "ResponsibilityFacts")
    ? responsibilityProjectionConflict(subject, delivery)
    : null
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

const integrationClaimProjectionConflict = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery
): DeliveryStatusProjectionConflict =>
  new DeliveryStatusProjectionConflict({
    subject,
    entryIdentity: `integration-claim:${delivery.taskId}`,
    detail: "a foreign integration claim cannot be represented as a missing, unreadable, or unobserved fact"
  })

const validateIntegrationTrackerStandingForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>
): DeliveryStatusProjectionConflict | null => {
  if (standing.wait._tag !== "IntegrationTrackerFactsWait" && standing.wait._tag !== "IntegrationTaskClaimConstraint") {
    return null
  }
  if (standing.wait._tag === "IntegrationTaskClaimConstraint" && standing.wait.claimState === "Foreign") {
    return integrationClaimProjectionConflict(subject, delivery)
  }
  return obligationForPlannedAttempt(delivery, standing.wait.plannedAttempt) === null
    ? integrationTrackerProjectionConflict(subject, delivery)
    : null
}

const validateIntegrationStandingForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>
): DeliveryStatusProjectionConflict | null => {
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
