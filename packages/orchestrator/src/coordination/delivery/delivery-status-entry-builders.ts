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
  isIntegrationStandingFor,
  obligationForEvidenceConflict,
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

const addDependencyEntry = (
  subject: DeliveryStatusSubject,
  taskId: TaskId,
  prerequisiteTaskIds: ReadonlyArray<TaskId>,
  standing: Extract<DeliveryStatusEntry, { readonly _tag: "DependencyWait" }>["standing"],
  taskOrder: number,
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

export const dependencyEntriesFor = (
  subject: DeliveryStatusSubject,
  taskId: TaskId,
  placement: TicketDeliveryPlacement,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>
): void => {
  if (!includeForSubject(subject, taskId) || placement._tag !== "GraphExcluded") return
  for (const reason of placement.reasons) {
    if (reason._tag === "PrerequisitesIncomplete") {
      addDependencyEntry(subject, taskId, reason.prerequisiteTaskIds, placement, taskOrder, entries)
    }
  }
}

const addTrackerFactEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>,
  taskOrder: number,
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
  taskOrder: number,
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
  taskOrder: number,
  entries: Array<OrderedStatusEntry>
): void => {
  if (standing.wait._tag !== "IntegrationConfigurationWait") return
  const responsibility = obligationForPlannedAttempt(delivery, standing.wait.plannedAttempt)
  if (responsibility?._tag !== "AcceptedAwaitingIntegration") return
  if (!isIntegrationStandingFor(standing, "IntegrationConfigurationWait")) return
  addEntry(
    entries,
    {
      _tag: "EvidenceUnavailable",
      classification: "Blocked",
      subject: taskStatusSubject(subject, delivery.taskId),
      responsibility,
      evidence: { _tag: "IntegrationConfigurationWait", wait: standing.wait, standing }
    },
    taskOrder
  )
}

const addTargetPromotionConfigurationEvidenceEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>
): void => {
  if (standing.wait._tag !== "TargetPromotionConfigurationWait") return
  const responsibility = obligationForPlannedAttempt(delivery, standing.wait.plannedAttempt)
  if (responsibility?._tag !== "StartedIntegration") return
  if (!isIntegrationStandingFor(standing, "TargetPromotionConfigurationWait")) return
  addEntry(
    entries,
    {
      _tag: "EvidenceUnavailable",
      classification: "Blocked",
      subject: taskStatusSubject(subject, delivery.taskId),
      responsibility,
      evidence: { _tag: "TargetPromotionConfigurationWait", wait: standing.wait, standing }
    },
    taskOrder
  )
}

const addIntegrationDependencyEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>
): void => {
  if (standing.wait._tag !== "IntegrationDependencyWait") return
  if (!isIntegrationStandingFor(standing, "IntegrationDependencyWait")) return
  addDependencyEntry(subject, delivery.taskId, standing.wait.prerequisiteTaskIds, standing, taskOrder, entries)
}

const addRelinquishmentEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>,
  taskOrder: number,
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
      correlation:
        raw._tag === "PlannedAttemptExecutorWorkResponsibility"
          ? plannedAttemptExecutorCorrelation(raw.plannedAttempt)
          : null,
      operationId:
        raw._tag === "PlannedAttemptExecutorWorkResponsibility" ? null : workflowResponsibilityOperationId(raw),
      reason: standing.facts.disposition.reason
    },
    taskOrder
  )
}

const addResponsibilityDependencyEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>
): void => {
  if (standing.facts.disposition._tag !== "DependencyWait") return
  addDependencyEntry(
    subject,
    delivery.taskId,
    standing.facts.disposition.prerequisiteTaskIds,
    standing,
    taskOrder,
    entries
  )
}

const addResponsibilityEntriesFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>
): void => {
  addResponsibilityDependencyEntryFor(subject, delivery, standing, taskOrder, entries)
  addTrackerFactEntryFor(subject, delivery, standing, taskOrder, entries)
  addUnavailableEvidenceEntryFor(subject, delivery, standing, taskOrder, entries)
  addRelinquishmentEntryFor(subject, delivery, standing, taskOrder, entries)
}

const addIntegrationTrackerEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>
): void => {
  if (standing.wait._tag !== "IntegrationTrackerFactsWait" && standing.wait._tag !== "IntegrationTaskClaimConstraint") {
    return
  }
  const responsibility = obligationForPlannedAttempt(delivery, standing.wait.plannedAttempt)
  const trackerFact = integrationTrackerFactForWait(standing.wait)
  if (responsibility === null) return
  if (
    !isIntegrationStandingFor(standing, "IntegrationTrackerFactsWait") &&
    !isIntegrationStandingFor(standing, "IntegrationTaskClaimConstraint")
  ) {
    return
  }
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

const addIntegrationTargetEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>
): void => {
  if (standing.wait._tag !== "IntegrationTargetWait") return
  const responsibility = queuedIntegrationResponsibilityFor(delivery, standing.wait.plannedAttempt)
  if (responsibility?._tag !== "QueuedIntegration") return
  if (!isIntegrationStandingFor(standing, "IntegrationTargetWait")) return
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
    taskOrder
  )
}

const addIntegrationEntriesFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>,
  taskOrder: number,
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
  taskOrder: number,
  entries: Array<OrderedStatusEntry>
): void => {
  addEntry(
    entries,
    {
      _tag: "EvidenceConflict",
      classification: "Blocked",
      subject: taskStatusSubject(subject, delivery.taskId),
      responsibility: obligationForEvidenceConflict(delivery, standing),
      evidenceIdentities: standing.evidenceIdentities,
      standing
    },
    taskOrder
  )
}

const entriesForStanding = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: TicketDeliveryStanding,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>
): void => {
  if (standing._tag === "ResponsibilitySituation") {
    addResponsibilityEntriesFor(subject, delivery, standing, taskOrder, entries)
    return
  }
  if (standing._tag === "IntegrationWait") {
    addIntegrationEntriesFor(subject, delivery, standing, taskOrder, entries)
    return
  }
  if (standing._tag === "ExactEvidenceConflict")
    addEvidenceConflictEntryFor(subject, delivery, standing, taskOrder, entries)
}

export const trackerAndEvidenceEntriesFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  taskOrder: number,
  entries: Array<OrderedStatusEntry>
): void => {
  for (const standing of delivery.standings) entriesForStanding(subject, delivery, standing, taskOrder, entries)
}

const addProposedDeliveryEntriesFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  liveProposalIds: ReadonlySet<string>,
  entries: Array<OrderedStatusEntry>,
  taskOrders: ReadonlyMap<TaskId, number>
): void => {
  if (evaluation.proposedActions._tag !== "DeliveryProposalsAvailable") return
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
      taskId === null ? runWideTaskOrder : (taskOrders.get(taskId) ?? Number.MAX_SAFE_INTEGER)
    )
  }
}

const addLiveOwnerEntryFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  owner: DeliveryRuntimeLiveOwnerSnapshot,
  entries: Array<OrderedStatusEntry>,
  taskOrders: ReadonlyMap<TaskId, number>
): void => {
  const taskId = deliveryProposalOrderTaskId(owner.proposal.order)
  if (!includeForSubject(subject, taskId)) return
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
  addEntry(entries, entry, ownerTaskOrder)
}

export const actionEntriesFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>,
  entries: Array<OrderedStatusEntry>,
  taskOrders: ReadonlyMap<TaskId, number>
): void => {
  const liveProposalIds = new Set(liveOwners.map(({ proposal }) => proposal.id))
  addProposedDeliveryEntriesFor(subject, evaluation, liveProposalIds, entries, taskOrders)
  for (const owner of liveOwners) addLiveOwnerEntryFor(subject, evaluation, owner, entries, taskOrders)
}
