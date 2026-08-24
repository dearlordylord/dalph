/* eslint-disable functional/immutable-data -- local projection scratch state never escapes the read. */
import {
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedAttemptExecutorCorrelation,
  type TaskId
} from "@dalph/contracts"
import { Match } from "effect"
import type { DeliveryProposalDerivationIssue, DeliveryProposalOrderEvidence } from "./delivery-action-proposal.js"
import type {
  DeliveryRuntimeEvaluation,
  ExactWorkflowObligation,
  TicketDelivery,
  TicketDeliveryStanding
} from "./relations.js"
import { type DeliveryStatusEntry, type DeliveryStatusSubject } from "./delivery-status-model.js"
import { workflowResponsibilityKey } from "../reconstruction/state.js"

const subjectKey = (subject: DeliveryStatusSubject): string =>
  subject._tag === "Run" ? `Run:${subject.runId}` : `Task:${subject.runId}:${subject.taskId}`

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

const evidenceIdentityForObligation = (obligation: ExactWorkflowObligation): string => {
  if (obligation._tag === "WorkflowResponsibility")
    return `workflow:${workflowResponsibilityKey(obligation.responsibility)}`
  const plannedAttempt =
    obligation._tag === "AcceptedAwaitingIntegration"
      ? obligation.accepted.plannedAttempt
      : obligation.responsibility.plannedAttempt
  return JSON.stringify([
    "integration",
    plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(plannedAttempt))
  ])
}

/** Finds an exact responsibility only when one of the conflicting source identities names it. */
export const obligationForEvidenceConflict = (
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ExactEvidenceConflict" }>
): ExactWorkflowObligation | null => {
  const identities = new Set(standing.evidenceIdentities)
  const matches = delivery.obligations.filter((obligation) => identities.has(evidenceIdentityForObligation(obligation)))
  const first = matches[0]
  if (first === undefined) return null
  const identity = obligationIdentity(first)
  return matches.every((candidate) => obligationIdentity(candidate) === identity) ? first : null
}

const proposalDerivationIssueIdentity = (issue: DeliveryProposalDerivationIssue): string =>
  issue._tag === "AcceptedOperationEvidenceMissing"
    ? `${issue._tag}:${issue.operationId}:${issue.taskId}:${issue.transition}`
    : `${issue._tag}:${issue.taskId}:${issue.transition}`

const statusEntryPrefix = (entry: DeliveryStatusEntry): string => `${entry._tag}:${subjectKey(entry.subject)}`

const dependencyStandingIdentity = (
  standing: Extract<DeliveryStatusEntry, { readonly _tag: "DependencyWait" }>["standing"]
): string => {
  if (standing._tag === "GraphExcluded") return `graph:${standing.reasons.map(({ _tag }) => _tag).join(",")}`
  if (standing._tag === "PromotedPrerequisiteReleasePending") {
    return `promoted:${standing.prerequisiteTaskIds.join(",")}`
  }
  if (standing._tag === "IntegrationWait") {
    return `integration:${standing.wait._tag}:${plannedAttemptExecutorCorrelationKey(
      plannedAttemptExecutorCorrelation(standing.wait.plannedAttempt)
    )}`
  }
  return `responsibility:${workflowResponsibilityKey(standing.facts.responsibility)}`
}

const statusEntryIdentityFor = Match.typeTags<DeliveryStatusEntry, string>()({
  DependencyWait: (entry) =>
    `${statusEntryPrefix(entry)}:${entry.taskId}:${entry.prerequisiteTaskIds.join(",")}:${dependencyStandingIdentity(
      entry.standing
    )}`,
  TrackerFactWait: (entry) =>
    `${statusEntryPrefix(entry)}:${entry.responsibility === null ? "subject" : obligationIdentity(entry.responsibility)}:${entry.fact._tag}`,
  TaskWorkCapacityWait: (entry) => `${statusEntryPrefix(entry)}:${entry.taskId}`,
  ProposedDeliveryAction: (entry) => `${statusEntryPrefix(entry)}:${entry.proposal.id}`,
  LiveDeliveryAction: (entry) => `${statusEntryPrefix(entry)}:${entry.proposal.id}`,
  AcceptedFactPublicationWait: (entry) => `${statusEntryPrefix(entry)}:${entry.proposal.id}`,
  IntegrationTargetWait: (entry) =>
    `${statusEntryPrefix(entry)}:${plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(entry.plannedAttempt))}:${entry.wait._tag}`,
  EvidenceUnavailable: (entry) =>
    `${statusEntryPrefix(entry)}:${entry.evidence._tag}:${
      entry.evidence._tag === "ProposalDerivationIssue"
        ? proposalDerivationIssueIdentity(entry.evidence.issue)
        : entry.evidence._tag === "ResponsibilityFacts"
          ? entry.responsibility === null
            ? "subject"
            : obligationIdentity(entry.responsibility)
          : `${entry.evidence.wait._tag}:${plannedAttemptExecutorCorrelationKey(
              plannedAttemptExecutorCorrelation(entry.evidence.wait.plannedAttempt)
            )}`
    }`,
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
  readonly structuralOrder: ReadonlyArray<number | string>
}

const freshOrderKind = 0
const recoveredOrderKind = 1
const integrationOrderKind = 2
const unqueuedAcceptedOrderKind = 3
const trackerGraphOrderKind = 4
const noJournalPosition = 0

/** The accepted structural tie-breakers do not depend on provider-array order. */
const proposalOrderStructuralOrder = (order: DeliveryProposalOrderEvidence): ReadonlyArray<number | string> => {
  return Match.valueTags(order, {
    FreshWorkflowOrder: ({ frontierOrdinal, step, taskId }) => [freshOrderKind, frontierOrdinal, step, taskId],
    RecoveredWorkflowOrder: ({ acceptedAt, frontierOrdinal, responsibilityBeganAt, taskId, transition }) => [
      recoveredOrderKind,
      acceptedAt ?? noJournalPosition,
      frontierOrdinal,
      responsibilityBeganAt ?? noJournalPosition,
      taskId,
      transition
    ],
    IntegrationOrder: ({ frontierOrdinal, queuedAt, startedAt, taskId }) => [
      integrationOrderKind,
      frontierOrdinal,
      queuedAt,
      startedAt ?? noJournalPosition,
      taskId
    ],
    UnqueuedAcceptedResultOrder: ({ frontierOrdinal, taskId, terminalAt }) => [
      unqueuedAcceptedOrderKind,
      frontierOrdinal,
      taskId,
      terminalAt
    ],
    TrackerGraphOrder: ({ acceptedAt }) => [trackerGraphOrderKind, acceptedAt ?? noJournalPosition]
  })
}

const statusEntryStructuralOrder = (entry: DeliveryStatusEntry): ReadonlyArray<number | string> => {
  if (
    entry._tag === "ProposedDeliveryAction" ||
    entry._tag === "LiveDeliveryAction" ||
    entry._tag === "AcceptedFactPublicationWait"
  ) {
    return [...proposalOrderStructuralOrder(entry.proposal.order), entry.proposal.id]
  }
  return [statusEntryIdentity(entry)]
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
const structuralOrderBefore = -1
const structuralOrderAfter = 1

const compareStructuralToken = (left: number | string, right: number | string): number => {
  if (typeof left === "number" && typeof right === "number") return left - right
  if (typeof left === "number") return structuralOrderBefore
  if (typeof right === "number") return structuralOrderAfter
  return left.localeCompare(right)
}

const compareStructuralOrder = (
  left: ReadonlyArray<number | string>,
  right: ReadonlyArray<number | string>
): number => {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftToken = left[index]
    const rightToken = right[index]
    if (leftToken === undefined) return structuralOrderBefore
    if (rightToken === undefined) return structuralOrderAfter
    const compared = compareStructuralToken(leftToken, rightToken)
    if (compared !== 0) return compared
  }
  return 0
}

export const compareOrderedEntries = (left: OrderedStatusEntry, right: OrderedStatusEntry): number => {
  const taskOrder = left.taskOrder - right.taskOrder
  if (taskOrder !== 0) return taskOrder
  const phenomenon = left.phenomenonOrder - right.phenomenonOrder
  return phenomenon !== 0 ? phenomenon : compareStructuralOrder(left.structuralOrder, right.structuralOrder)
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

export const addEntry = (entries: Array<OrderedStatusEntry>, entry: DeliveryStatusEntry, taskOrder: number): void => {
  entries.push({
    entry,
    taskOrder,
    phenomenonOrder: phenomenonOrder[entry._tag],
    structuralOrder: statusEntryStructuralOrder(entry)
  })
}
