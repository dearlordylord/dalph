/* eslint-disable functional/immutable-data -- local projection scratch state never escapes the read. */
import { plannedAttemptExecutorCorrelation, type TaskId } from "@dalph/contracts"
import { deliveryProposalOrderTaskId } from "./delivery-action-proposal.js"
import type { DeliveryRuntimeLiveOwnerSnapshot } from "./delivery-runtime-observation.js"
import type {
  DeliveryRuntimeEvaluation,
  TicketDelivery,
  TicketDeliveryPlacement,
  TicketDeliveryStanding
} from "./relations.js"
import { workflowResponsibilityOperationId } from "../reconstruction/state.js"
import { type DeliveryStatusEntry, type DeliveryStatusSubject } from "./delivery-status-model.js"
import {
  addEntry,
  includeForSubject,
  integrationTrackerFactForWait,
  obligationForPlannedAttempt,
  obligationForResponsibility,
  ownerIsSettled,
  ownerOperationId,
  queuedIntegrationResponsibilityFor,
  runWideTaskOrder,
  taskStatusSubject,
  trackerFactForDisposition,
  unavailableFromFacts,
  type OrderedStatusEntry
} from "./delivery-status-support.js"

export const dependencyEntriesFor = (
  subject: DeliveryStatusSubject,
  taskId: TaskId,
  placement: TicketDeliveryPlacement,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>,
  sourceOrder: number
): number => {
  if (!includeForSubject(subject, taskId)) return sourceOrder
  if (placement._tag !== "GraphExcluded") return sourceOrder
  for (const reason of placement.reasons) {
    if (reason._tag !== "PrerequisitesIncomplete" || reason.prerequisiteTaskIds.length === 0) continue
    const [first, ...rest] = reason.prerequisiteTaskIds
    if (first === undefined) continue
    addEntry(
      entries,
      {
        _tag: "DependencyWait",
        classification: "Waiting",
        subject: taskStatusSubject(subject, taskId),
        taskId,
        prerequisiteTaskIds: [first, ...rest],
        standing: placement
      },
      taskOrder,
      sourceOrder++
    )
  }
  return sourceOrder
}

const addTrackerFactEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>,
  sourceOrder: number
): number => {
  const responsibility = obligationForResponsibility(delivery, standing.facts)
  const trackerFact = trackerFactForDisposition(standing.facts)
  if (responsibility === null || trackerFact === null) return sourceOrder
  addEntry(
    entries,
    {
      _tag: "TrackerFactWait",
      classification: "Waiting",
      subject: taskStatusSubject(subject, delivery.taskId),
      responsibility,
      fact: trackerFact.fact,
      wakeCondition: trackerFact.wakeCondition,
      standing
    },
    taskOrder,
    sourceOrder
  )
  return sourceOrder + 1
}

const addUnavailableEvidenceEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>,
  sourceOrder: number
): number => {
  const responsibility = obligationForResponsibility(delivery, standing.facts)
  const unavailable = unavailableFromFacts(standing.facts)
  if (responsibility === null || unavailable?._tag !== "ResponsibilityFacts") return sourceOrder
  addEntry(
    entries,
    {
      _tag: "EvidenceUnavailable",
      classification: "Blocked",
      subject: taskStatusSubject(subject, delivery.taskId),
      responsibility,
      evidence: unavailable
    },
    taskOrder,
    sourceOrder
  )
  return sourceOrder + 1
}

const addRelinquishmentEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>,
  sourceOrder: number
): number => {
  if (standing.facts.disposition._tag !== "Relinquished") return sourceOrder
  const raw = standing.facts.responsibility
  const responsibility = { _tag: "WorkflowResponsibility", responsibility: raw } as const
  addEntry(
    entries,
    {
      _tag: "Relinquishment",
      classification: "Relinquished",
      subject: taskStatusSubject(subject, delivery.taskId),
      responsibility,
      correlation:
        raw._tag === "PlannedAttemptExecutorWorkResponsibility"
          ? plannedAttemptExecutorCorrelation(raw.plannedAttempt)
          : null,
      operationId:
        raw._tag === "PlannedAttemptExecutorWorkResponsibility" ? null : workflowResponsibilityOperationId(raw),
      reason: standing.facts.disposition.reason
    },
    taskOrder,
    sourceOrder
  )
  return sourceOrder + 1
}

const addResponsibilityEntriesFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>,
  sourceOrder: number
): number => {
  let next = addTrackerFactEntryFor(subject, delivery, standing, taskOrder, entries, sourceOrder)
  next = addUnavailableEvidenceEntryFor(subject, delivery, standing, taskOrder, entries, next)
  return addRelinquishmentEntryFor(subject, delivery, standing, taskOrder, entries, next)
}

const addIntegrationTrackerEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>,
  sourceOrder: number
): number => {
  if (standing.wait._tag !== "IntegrationTrackerFactsWait" && standing.wait._tag !== "IntegrationTaskClaimConstraint") {
    return sourceOrder
  }
  const responsibility = obligationForPlannedAttempt(delivery, standing.wait.plannedAttempt)
  const trackerFact = integrationTrackerFactForWait(standing.wait)
  if (responsibility === null || trackerFact === null) return sourceOrder
  addEntry(
    entries,
    {
      _tag: "TrackerFactWait",
      classification: "Waiting",
      subject: taskStatusSubject(subject, delivery.taskId),
      responsibility,
      fact: trackerFact.fact,
      wakeCondition: trackerFact.wakeCondition,
      standing
    },
    taskOrder,
    sourceOrder
  )
  return sourceOrder + 1
}

const addIntegrationTargetEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>,
  sourceOrder: number
): number => {
  if (standing.wait._tag !== "IntegrationTargetWait") return sourceOrder
  const responsibility = queuedIntegrationResponsibilityFor(delivery, standing.wait.plannedAttempt)
  if (responsibility?._tag !== "QueuedIntegration") return sourceOrder
  addEntry(
    entries,
    {
      _tag: "IntegrationTargetWait",
      classification: "Waiting",
      subject: taskStatusSubject(subject, delivery.taskId),
      plannedAttempt: standing.wait.plannedAttempt,
      integrationTarget: responsibility.responsibility.integrationTarget,
      responsibility,
      wait: standing.wait,
      standing
    },
    taskOrder,
    sourceOrder
  )
  return sourceOrder + 1
}

const addIntegrationEntriesFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>,
  sourceOrder: number
): number => {
  const next = addIntegrationTrackerEntryFor(subject, delivery, standing, taskOrder, entries, sourceOrder)
  return addIntegrationTargetEntryFor(subject, delivery, standing, taskOrder, entries, next)
}

const addEvidenceConflictEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ExactEvidenceConflict" }>,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>,
  sourceOrder: number
): number => {
  addEntry(
    entries,
    {
      _tag: "EvidenceConflict",
      classification: "Blocked",
      subject: taskStatusSubject(subject, delivery.taskId),
      responsibility: null,
      evidenceIdentities: standing.evidenceIdentities,
      standing
    },
    taskOrder,
    sourceOrder
  )
  return sourceOrder + 1
}

const entriesForStanding = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: TicketDeliveryStanding,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>,
  sourceOrder: number
): number => {
  if (standing._tag === "ResponsibilitySituation") {
    return addResponsibilityEntriesFor(subject, delivery, standing, taskOrder, entries, sourceOrder)
  }
  if (standing._tag === "IntegrationWait") {
    return addIntegrationEntriesFor(subject, delivery, standing, taskOrder, entries, sourceOrder)
  }
  return standing._tag === "ExactEvidenceConflict"
    ? addEvidenceConflictEntryFor(subject, delivery, standing, taskOrder, entries, sourceOrder)
    : sourceOrder
}

export const trackerAndEvidenceEntriesFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>,
  sourceOrder: number
): number => {
  let next = sourceOrder
  for (const standing of delivery.standings) {
    next = entriesForStanding(subject, delivery, standing, taskOrder, entries, next)
  }
  return next
}

const addProposedDeliveryEntriesFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  liveProposalIds: ReadonlySet<string>,
  entries: Array<OrderedStatusEntry>,
  taskOrders: ReadonlyMap<TaskId, number>,
  sourceOrder: number
): number => {
  if (evaluation.proposedActions._tag !== "DeliveryProposalsAvailable") return sourceOrder
  let next = sourceOrder
  for (const proposal of evaluation.proposedActions.proposals) {
    if (liveProposalIds.has(proposal.id)) continue
    const taskId = deliveryProposalOrderTaskId(proposal.order)
    if (!includeForSubject(subject, taskId)) continue
    addEntry(
      entries,
      {
        _tag: "ProposedDeliveryAction",
        classification: "Waiting",
        subject: taskId === null ? subject : taskStatusSubject(subject, taskId),
        proposal
      },
      taskId === null ? runWideTaskOrder : (taskOrders.get(taskId) ?? Number.MAX_SAFE_INTEGER),
      next
    )
    next += 1
  }
  return next
}

const addLiveOwnerEntryFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  owner: DeliveryRuntimeLiveOwnerSnapshot,
  entries: Array<OrderedStatusEntry>,
  taskOrders: ReadonlyMap<TaskId, number>,
  sourceOrder: number
): number => {
  const taskId = deliveryProposalOrderTaskId(owner.proposal.order)
  if (!includeForSubject(subject, taskId)) return sourceOrder
  const ownerTaskOrder = taskId === null ? runWideTaskOrder : (taskOrders.get(taskId) ?? Number.MAX_SAFE_INTEGER)
  const entrySubject = taskId === null ? subject : taskStatusSubject(subject, taskId)
  const entry: DeliveryStatusEntry = ownerIsSettled(owner)
    ? {
        _tag: "AcceptedFactPublicationWait",
        classification: "Waiting",
        subject: entrySubject,
        owner,
        proposal: owner.proposal,
        operationId: ownerOperationId(owner),
        acceptedAt: evaluation.acceptedAt
      }
    : {
        _tag: "LiveDeliveryAction",
        classification: "Progressing",
        subject: entrySubject,
        owner,
        proposal: owner.proposal,
        operationId: ownerOperationId(owner)
      }
  addEntry(entries, entry, ownerTaskOrder, sourceOrder)
  return sourceOrder + 1
}

export const actionEntriesFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>,
  entries: Array<OrderedStatusEntry>,
  taskOrders: ReadonlyMap<TaskId, number>,
  sourceOrder: number
): number => {
  const liveProposalIds = new Set(liveOwners.map(({ proposal }) => proposal.id))
  let next = addProposedDeliveryEntriesFor(subject, evaluation, liveProposalIds, entries, taskOrders, sourceOrder)
  for (const owner of liveOwners) {
    next = addLiveOwnerEntryFor(subject, evaluation, owner, entries, taskOrders, next)
  }
  return next
}
