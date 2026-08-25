/* eslint-disable functional/immutable-data -- local projection scratch state never escapes the read. */
import { plannedAttemptExecutorCorrelation, type TaskId } from "@dalph/contracts"
import { Option, Schema } from "effect"
import { deliveryProposalOrderTaskId } from "./delivery-action-proposal.js"
import type { DeliveryRuntimeLiveOwnerSnapshot } from "./delivery-runtime-observation.js"
import type { StatusTaskOrder } from "./delivery-status-order.js"
import type {
  DeliveryRuntimeEvaluation,
  TicketDelivery,
  TicketDeliveryPlacement,
  TicketDeliveryStanding
} from "./relations.js"
import { workflowResponsibilityOperationId, type WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import {
  DeliveryStatusEvidenceIdentity,
  DeliveryStatusProjectionConflict,
  makeDeliveryStatusEntryIdentity,
  type DeliveryStatusEntry,
  type DeliveryStatusSubject
} from "./delivery-status-model.js"
import {
  addEntry,
  addDependencyEntry,
  canonicalIdentity,
  emptyDependencyConflictFor,
  integrationConfigurationStandingFor,
  integrationDependencyStandingFor,
  integrationTargetStandingFor,
  integrationTrackerStandingFor,
  includeForSubject,
  integrationTrackerFactForWait,
  obligationForEvidenceConflict,
  obligationForPlannedAttempt,
  obligationForResponsibility,
  ownerIsSettled,
  queuedIntegrationResponsibilityFor,
  runWideTaskOrder,
  targetPromotionConfigurationStandingFor,
  taskStatusSubject,
  taskOrderOrConflictFor,
  trackerFactForDisposition,
  unavailableFromFacts,
  type OrderedStatusEntry
} from "./delivery-status-support.js"
import { addAcceptedStandingSettlementEntryFor } from "./delivery-status-settlement.js"
export const dependencyEntriesFor = (
  subject: DeliveryStatusSubject,
  taskId: TaskId,
  placement: TicketDeliveryPlacement,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): DeliveryStatusProjectionConflict | null => {
  if (!includeForSubject(subject, taskId) || placement._tag !== "GraphExcluded") return null
  for (const reason of placement.reasons) {
    if (reason._tag === "PrerequisitesIncomplete") {
      if (reason.prerequisiteTaskIds.length === 0) {
        return emptyDependencyConflictFor(subject, taskId, "GraphExcluded")
      }
      addDependencyEntry(subject, taskId, reason.prerequisiteTaskIds, placement, taskOrder, entries)
    }
  }
  return null
}
const addTrackerFactEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  const responsibility = obligationForResponsibility(delivery, standing.facts)
  const trackerFact = trackerFactForDisposition(standing.facts)
  if (responsibility === null || trackerFact === null) return
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
    taskOrder
  )
}
const addUnavailableEvidenceEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  const responsibility = obligationForResponsibility(delivery, standing.facts)
  const unavailable = unavailableFromFacts(standing.facts)
  if (responsibility === null || unavailable?._tag !== "ResponsibilityFacts") return
  addEntry(
    entries,
    {
      _tag: "EvidenceUnavailable",
      classification: "Blocked",
      subject: taskStatusSubject(subject, delivery.taskId),
      responsibility,
      evidence: unavailable
    },
    taskOrder
  )
}
const addIntegrationConfigurationEvidenceEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  const typedStanding = integrationConfigurationStandingFor(standing)
  if (typedStanding === null) return
  const responsibility = obligationForPlannedAttempt(delivery, typedStanding.wait.plannedAttempt)
  if (responsibility?._tag !== "AcceptedAwaitingIntegration") return
  addEntry(
    entries,
    {
      _tag: "EvidenceUnavailable",
      classification: "Blocked",
      subject: taskStatusSubject(subject, delivery.taskId),
      responsibility,
      evidence: { _tag: "IntegrationConfigurationWait", wait: typedStanding.wait, standing: typedStanding }
    },
    taskOrder
  )
}
const addTargetPromotionConfigurationEvidenceEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  const typedStanding = targetPromotionConfigurationStandingFor(standing)
  if (typedStanding === null) return
  const responsibility = obligationForPlannedAttempt(delivery, typedStanding.wait.plannedAttempt)
  if (responsibility?._tag !== "StartedIntegration") return
  addEntry(
    entries,
    {
      _tag: "EvidenceUnavailable",
      classification: "Blocked",
      subject: taskStatusSubject(subject, delivery.taskId),
      responsibility,
      evidence: { _tag: "TargetPromotionConfigurationWait", wait: typedStanding.wait, standing: typedStanding }
    },
    taskOrder
  )
}
const addIntegrationDependencyEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  const typedStanding = integrationDependencyStandingFor(standing)
  if (typedStanding === null) return
  addDependencyEntry(
    subject,
    delivery.taskId,
    typedStanding.wait.prerequisiteTaskIds,
    typedStanding,
    taskOrder,
    entries
  )
}
const relinquishmentSupportingFor = (
  responsibility: WorkflowResponsibilityEntry
): Extract<DeliveryStatusEntry, { readonly _tag: "Relinquishment" }>["supporting"] =>
  responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
    ? { _tag: "PlannedAttempt", correlation: plannedAttemptExecutorCorrelation(responsibility.plannedAttempt) }
    : { _tag: "WorkflowOperation", operationId: workflowResponsibilityOperationId(responsibility) }

const addRelinquishmentEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  if (standing.facts.disposition._tag !== "Relinquished") return
  const raw = standing.facts.responsibility
  const responsibility = { _tag: "WorkflowResponsibility", responsibility: raw } as const
  addEntry(
    entries,
    {
      _tag: "Relinquishment",
      classification: "Relinquished",
      subject: taskStatusSubject(subject, delivery.taskId),
      responsibility,
      supporting: relinquishmentSupportingFor(raw),
      reason: standing.facts.disposition.reason
    },
    taskOrder
  )
}

const addResponsibilityEntriesFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  if (standing.facts.disposition._tag === "DependencyWait") {
    addDependencyEntry(
      subject,
      delivery.taskId,
      standing.facts.disposition.prerequisiteTaskIds,
      standing,
      taskOrder,
      entries
    )
  }
  addTrackerFactEntryFor(subject, delivery, standing, taskOrder, entries)
  addUnavailableEvidenceEntryFor(subject, delivery, standing, taskOrder, entries)
  addRelinquishmentEntryFor(subject, delivery, standing, taskOrder, entries)
  addAcceptedStandingSettlementEntryFor(subject, delivery, standing, taskOrder, entries)
}

const addIntegrationTrackerEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  const typedStanding = integrationTrackerStandingFor(standing)
  if (typedStanding === null) return
  const responsibility = obligationForPlannedAttempt(delivery, typedStanding.wait.plannedAttempt)
  const trackerFact = integrationTrackerFactForWait(typedStanding.wait)
  if (responsibility === null) return
  addEntry(
    entries,
    {
      _tag: "TrackerFactWait",
      classification: "Waiting",
      subject: taskStatusSubject(subject, delivery.taskId),
      responsibility,
      fact: trackerFact.fact,
      wakeCondition: trackerFact.wakeCondition,
      standing: typedStanding
    },
    taskOrder
  )
}

const addIntegrationTargetEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  const typedStanding = integrationTargetStandingFor(standing)
  if (typedStanding === null) return
  const responsibility = queuedIntegrationResponsibilityFor(delivery, typedStanding.wait.plannedAttempt)
  if (responsibility?._tag !== "QueuedIntegration") return
  addEntry(
    entries,
    {
      _tag: "IntegrationTargetWait",
      classification: "Waiting",
      subject: taskStatusSubject(subject, delivery.taskId),
      plannedAttempt: typedStanding.wait.plannedAttempt,
      integrationTarget: responsibility.responsibility.integrationTarget,
      responsibility,
      wait: typedStanding.wait,
      standing: typedStanding
    },
    taskOrder
  )
}

const addIntegrationEntriesFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  addIntegrationDependencyEntryFor(subject, delivery, standing, taskOrder, entries)
  addIntegrationConfigurationEvidenceEntryFor(subject, delivery, standing, taskOrder, entries)
  addTargetPromotionConfigurationEvidenceEntryFor(subject, delivery, standing, taskOrder, entries)
  addIntegrationTrackerEntryFor(subject, delivery, standing, taskOrder, entries)
  addIntegrationTargetEntryFor(subject, delivery, standing, taskOrder, entries)
}

const addEvidenceConflictEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ExactEvidenceConflict" }>,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): DeliveryStatusProjectionConflict | null => {
  const decoded = Schema.decodeUnknownOption(Schema.NonEmptyArray(DeliveryStatusEvidenceIdentity))(
    standing.evidenceIdentities
  )
  if (Option.isNone(decoded)) {
    return new DeliveryStatusProjectionConflict({
      subject,
      entryIdentity: makeDeliveryStatusEntryIdentity(canonicalIdentity(["evidence-conflict", delivery.taskId])),
      detail: "an evidence conflict has an empty or malformed exact identity"
    })
  }
  addEntry(
    entries,
    {
      _tag: "EvidenceConflict",
      classification: "Blocked",
      subject: taskStatusSubject(subject, delivery.taskId),
      responsibility: obligationForEvidenceConflict(delivery, standing),
      evidenceIdentities: decoded.value,
      standing
    },
    taskOrder
  )
  return null
}

const entriesForStanding = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: TicketDeliveryStanding,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): DeliveryStatusProjectionConflict | null => {
  if (standing._tag === "ResponsibilitySituation")
    addResponsibilityEntriesFor(subject, delivery, standing, taskOrder, entries)
  else if (standing._tag === "IntegrationWait")
    addIntegrationEntriesFor(subject, delivery, standing, taskOrder, entries)
  else if (standing._tag === "ExactEvidenceConflict")
    return addEvidenceConflictEntryFor(subject, delivery, standing, taskOrder, entries)
  else if (standing._tag === "PromotedPrerequisiteReleasePending")
    addDependencyEntry(subject, delivery.taskId, standing.prerequisiteTaskIds, standing, taskOrder, entries)
  return null
}

export const trackerAndEvidenceEntriesFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): DeliveryStatusProjectionConflict | null => {
  for (const standing of delivery.standings) {
    const conflict = entriesForStanding(subject, delivery, standing, taskOrder, entries)
    if (conflict !== null) return conflict
  }
  return null
}

const addProposedDeliveryEntriesFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  liveProposalIds: ReadonlySet<string>,
  entries: Array<OrderedStatusEntry>,
  taskOrders: ReadonlyMap<TaskId, StatusTaskOrder>
): DeliveryStatusProjectionConflict | null => {
  if (evaluation.proposedActions._tag !== "DeliveryProposalsAvailable") return null
  for (const proposal of evaluation.proposedActions.proposals) {
    if (liveProposalIds.has(proposal.id)) continue
    const taskId = deliveryProposalOrderTaskId(proposal.order)
    if (!includeForSubject(subject, taskId)) continue
    const taskOrder = taskId === null ? runWideTaskOrder : taskOrderOrConflictFor(subject, taskOrders, taskId)
    if (taskOrder instanceof DeliveryStatusProjectionConflict) return taskOrder
    addEntry(
      entries,
      {
        _tag: "ProposedDeliveryAction",
        classification: "Waiting",
        subject: taskId === null ? subject : taskStatusSubject(subject, taskId),
        proposal
      },
      taskOrder
    )
  }
  return null
}

const addLiveOwnerEntryFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  owner: DeliveryRuntimeLiveOwnerSnapshot,
  entries: Array<OrderedStatusEntry>,
  taskOrders: ReadonlyMap<TaskId, StatusTaskOrder>
): DeliveryStatusProjectionConflict | null => {
  const taskId = deliveryProposalOrderTaskId(owner.proposal.order)
  if (!includeForSubject(subject, taskId)) return null
  const ownerTaskOrder = taskId === null ? runWideTaskOrder : taskOrderOrConflictFor(subject, taskOrders, taskId)
  if (ownerTaskOrder instanceof DeliveryStatusProjectionConflict) return ownerTaskOrder
  const entrySubject = taskId === null ? subject : taskStatusSubject(subject, taskId)
  const entry: DeliveryStatusEntry = ownerIsSettled(owner)
    ? {
        _tag: "AcceptedFactPublicationWait",
        classification: "Waiting",
        subject: entrySubject,
        owner,
        acceptedAt: evaluation.acceptedAt
      }
    : { _tag: "LiveDeliveryAction", classification: "Progressing", subject: entrySubject, owner }
  addEntry(entries, entry, ownerTaskOrder)
  return null
}

export const actionEntriesFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>,
  entries: Array<OrderedStatusEntry>,
  taskOrders: ReadonlyMap<TaskId, StatusTaskOrder>
): DeliveryStatusProjectionConflict | null => {
  const proposedConflict = addProposedDeliveryEntriesFor(
    subject,
    evaluation,
    new Set(liveOwners.map(({ proposal }) => proposal.id)),
    entries,
    taskOrders
  )
  if (proposedConflict !== null) return proposedConflict
  for (const owner of liveOwners) {
    const ownerConflict = addLiveOwnerEntryFor(subject, evaluation, owner, entries, taskOrders)
    if (ownerConflict !== null) return ownerConflict
  }
  return null
}
