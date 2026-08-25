/* eslint-disable functional/immutable-data -- local projection scratch state never escapes the read. */
import { plannedAttemptExecutorCorrelation, type TaskId } from "@dalph/contracts"
import { Option, Schema } from "effect"
import type { StatusTaskOrder } from "./delivery-status-order.js"
import type { TicketDelivery, TicketDeliveryPlacement, TicketDeliveryStanding } from "./relations.js"
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
  includeForSubject,
  integrationTrackerFactForWait,
  obligationForEvidenceConflict,
  obligationForPlannedAttempt,
  obligationForResponsibility,
  queuedIntegrationResponsibilityFor,
  taskStatusSubject,
  trackerFactForDisposition,
  unavailableFromFacts,
  type OrderedStatusEntry
} from "./delivery-status-support.js"
import { addAcceptedStandingSettlementEntryFor } from "./delivery-status-settlement.js"

const nonEmptyTaskIdsFor = (taskIds: ReadonlyArray<TaskId>): readonly [TaskId, ...ReadonlyArray<TaskId>] | null => {
  const [first, ...rest] = taskIds
  return first === undefined ? null : [first, ...rest]
}

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
      const prerequisiteTaskIds = nonEmptyTaskIdsFor(reason.prerequisiteTaskIds)
      if (prerequisiteTaskIds === null) {
        return emptyDependencyConflictFor(subject, taskId, "GraphExcluded")
      }
      addDependencyEntry(subject, taskId, prerequisiteTaskIds, placement, taskOrder, entries)
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
type IntegrationWaitStanding = Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>
type IntegrationStandingFor<Tag extends IntegrationWaitStanding["wait"]["_tag"]> = IntegrationWaitStanding & {
  readonly wait: Extract<IntegrationWaitStanding["wait"], { readonly _tag: Tag }>
}

const addIntegrationConfigurationEvidenceEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: IntegrationStandingFor<"IntegrationConfigurationWait">,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  const responsibility = obligationForPlannedAttempt(delivery, standing.wait.plannedAttempt)
  if (responsibility?._tag !== "AcceptedAwaitingIntegration") return
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
  standing: IntegrationStandingFor<"TargetPromotionConfigurationWait">,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  const responsibility = obligationForPlannedAttempt(delivery, standing.wait.plannedAttempt)
  if (responsibility?._tag !== "StartedIntegration") return
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
  standing: IntegrationStandingFor<"IntegrationDependencyWait">,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  const prerequisiteTaskIds = nonEmptyTaskIdsFor(standing.wait.prerequisiteTaskIds)
  if (prerequisiteTaskIds === null) return
  addDependencyEntry(subject, delivery.taskId, prerequisiteTaskIds, standing, taskOrder, entries)
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
    const prerequisiteTaskIds = nonEmptyTaskIdsFor(standing.facts.disposition.prerequisiteTaskIds)
    if (prerequisiteTaskIds === null) return
    addDependencyEntry(subject, delivery.taskId, prerequisiteTaskIds, standing, taskOrder, entries)
  }
  addTrackerFactEntryFor(subject, delivery, standing, taskOrder, entries)
  addUnavailableEvidenceEntryFor(subject, delivery, standing, taskOrder, entries)
  addRelinquishmentEntryFor(subject, delivery, standing, taskOrder, entries)
  addAcceptedStandingSettlementEntryFor(subject, delivery, standing, taskOrder, entries)
}

const addIntegrationTrackerEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: IntegrationStandingFor<"IntegrationTrackerFactsWait" | "IntegrationTaskClaimConstraint">,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  const responsibility = obligationForPlannedAttempt(delivery, standing.wait.plannedAttempt)
  if (responsibility === null) return
  const trackerFact = integrationTrackerFactForWait(standing.wait)
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
  standing: IntegrationStandingFor<"IntegrationTargetWait">,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  const responsibility = queuedIntegrationResponsibilityFor(delivery, standing.wait.plannedAttempt)
  if (responsibility?._tag !== "QueuedIntegration") return
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
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  if (standing.wait._tag === "IntegrationDependencyWait") {
    addIntegrationDependencyEntryFor(subject, delivery, { ...standing, wait: standing.wait }, taskOrder, entries)
  } else if (standing.wait._tag === "IntegrationConfigurationWait") {
    addIntegrationConfigurationEvidenceEntryFor(
      subject,
      delivery,
      { ...standing, wait: standing.wait },
      taskOrder,
      entries
    )
  } else if (standing.wait._tag === "TargetPromotionConfigurationWait") {
    addTargetPromotionConfigurationEvidenceEntryFor(
      subject,
      delivery,
      { ...standing, wait: standing.wait },
      taskOrder,
      entries
    )
  } else if (
    standing.wait._tag === "IntegrationTrackerFactsWait" ||
    standing.wait._tag === "IntegrationTaskClaimConstraint"
  ) {
    addIntegrationTrackerEntryFor(subject, delivery, { ...standing, wait: standing.wait }, taskOrder, entries)
  } else {
    addIntegrationTargetEntryFor(subject, delivery, { ...standing, wait: standing.wait }, taskOrder, entries)
  }
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
