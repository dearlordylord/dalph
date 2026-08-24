/* eslint-disable functional/immutable-data -- local projection scratch state never escapes the read. */
import type { RunId, TaskId } from "@dalph/contracts"
import { deliveryProposalOrderTaskId } from "./delivery-action-proposal.js"
import type { DeliveryRuntimeLiveOwnerSnapshot } from "./delivery-runtime-observation.js"
import type { DeliveryRuntimeEvaluation, TicketDelivery } from "./relations.js"
import {
  DeliveryStatusProjectionConflict,
  type DeliveryStatusEntry,
  type DeliveryStatusSubject
} from "./delivery-status-model.js"
import {
  addEntry,
  compareOrderedEntries,
  deliveryHolderOrder,
  deliveryTaskOrder,
  includeForSubject,
  taskStatusSubject,
  statusEntryIdentity,
  statusEntryJson,
  validateDeliveryEvidenceForStatus,
  type OrderedStatusEntry
} from "./delivery-status-support.js"
import {
  actionEntriesFor,
  dependencyEntriesFor,
  trackerAndEvidenceEntriesFor
} from "./delivery-status-entry-builders.js"

const ownershipConflictFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation
): DeliveryStatusProjectionConflict | null => {
  if (evaluation.proposedActions._tag !== "DeliveryProposalOwnershipConflict") return null
  const first = evaluation.proposedActions.conflicts.find(({ order }) =>
    includeForSubject(subject, deliveryProposalOrderTaskId(order))
  )
  return first === undefined
    ? null
    : new DeliveryStatusProjectionConflict({
        subject,
        entryIdentity: first.id,
        detail: "the current proposal frontier contains incompatible owners for one exact action"
      })
}

const capacityWaitFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  runId: RunId,
  delivery: TicketDelivery
): DeliveryStatusEntry | null => {
  const selected = delivery.placement._tag === "Selected"
  const held = evaluation.taskWork.held.some(({ taskId }) => taskId === delivery.taskId)
  if (!selected || held || evaluation.taskWork.held.length < Number(evaluation.taskWork.capacity)) return null
  return {
    _tag: "TaskWorkCapacityWait",
    classification: "Waiting",
    subject: taskStatusSubject(subject, delivery.taskId),
    taskId: delivery.taskId,
    scope: { _tag: "RunTaskWorkCapacityScope", runId, capacity: evaluation.taskWork.capacity },
    holders: deliveryHolderOrder(evaluation.taskWork.held),
    placement: delivery.placement
  }
}

const deliveryEntriesFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  runId: RunId,
  entries: Array<OrderedStatusEntry>,
  sourceOrder: number
): number | DeliveryStatusProjectionConflict => {
  let next = sourceOrder
  for (const [index, delivery] of evaluation.current.ticketDeliveries.deliveries.entries()) {
    if (!includeForSubject(subject, delivery.taskId)) continue
    const evidenceConflict = validateDeliveryEvidenceForStatus(subject, delivery)
    if (evidenceConflict !== null) return evidenceConflict
    const capacityEntry = capacityWaitFor(subject, evaluation, runId, delivery)
    if (capacityEntry !== null) {
      addEntry(entries, capacityEntry, index, next)
      next += 1
    }
    next = trackerAndEvidenceEntriesFor(subject, delivery, index, entries, next)
  }
  return next
}

const issueEntriesFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  taskOrders: ReadonlyMap<TaskId, number>,
  entries: Array<OrderedStatusEntry>,
  sourceOrder: number
): number => {
  if (evaluation.proposedActions._tag !== "DeliveryProposalsAvailable") return sourceOrder
  let next = sourceOrder
  for (const issue of evaluation.proposedActions.isolatedIssues) {
    if (!includeForSubject(subject, issue.taskId)) continue
    addEntry(
      entries,
      {
        _tag: "EvidenceUnavailable",
        classification: "Blocked",
        subject: taskStatusSubject(subject, issue.taskId),
        responsibility: null,
        evidence: { _tag: "ProposalDerivationIssue", issue }
      },
      taskOrders.get(issue.taskId) ?? Number.MAX_SAFE_INTEGER,
      next
    )
    next += 1
  }
  return next
}

const settlementEntriesFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  taskOrders: ReadonlyMap<TaskId, number>,
  entries: Array<OrderedStatusEntry>,
  sourceOrder: number
): number => {
  let next = sourceOrder
  for (const settlement of evaluation.current.settlements.settlements) {
    if (!includeForSubject(subject, settlement.taskId)) continue
    addEntry(
      entries,
      {
        _tag: "Settlement",
        classification: "Settled",
        subject: taskStatusSubject(subject, settlement.taskId),
        taskId: settlement.taskId,
        attemptId: settlement.attemptId,
        settlement
      },
      taskOrders.get(settlement.taskId) ?? Number.MAX_SAFE_INTEGER,
      next
    )
    next += 1
  }
  return next
}

const uniqueEntriesFor = (
  subject: DeliveryStatusSubject,
  entries: Array<OrderedStatusEntry>
): Array<DeliveryStatusEntry> | DeliveryStatusProjectionConflict => {
  entries.sort(compareOrderedEntries)
  const identities = new Map<string, string>()
  const result: Array<DeliveryStatusEntry> = []
  for (const { entry } of entries) {
    const identity = statusEntryIdentity(entry)
    const encoded = statusEntryJson(entry)
    const previous = identities.get(identity)
    if (previous === undefined) {
      identities.set(identity, encoded)
      result.push(entry)
      continue
    }
    if (previous !== encoded) {
      return new DeliveryStatusProjectionConflict({
        subject,
        entryIdentity: identity,
        detail: "one exact status identity produced incompatible current values"
      })
    }
  }
  return result
}

export const statusEntriesFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  runId: RunId,
  liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
): Array<DeliveryStatusEntry> | DeliveryStatusProjectionConflict => {
  const ownershipConflict = ownershipConflictFor(subject, evaluation)
  if (ownershipConflict !== null) return ownershipConflict
  const entries: Array<OrderedStatusEntry> = []
  const taskOrders = deliveryTaskOrder(evaluation)
  let sourceOrder = 0
  for (const [index, placement] of evaluation.current.ticketDeliveries.source.placements.entries()) {
    sourceOrder = dependencyEntriesFor(subject, placement.taskId, placement.placement, index, entries, sourceOrder)
  }
  const deliveryResult = deliveryEntriesFor(subject, evaluation, runId, entries, sourceOrder)
  if (deliveryResult instanceof DeliveryStatusProjectionConflict) return deliveryResult
  sourceOrder = deliveryResult
  sourceOrder = actionEntriesFor(subject, evaluation, liveOwners, entries, taskOrders, sourceOrder)
  sourceOrder = issueEntriesFor(subject, evaluation, taskOrders, entries, sourceOrder)
  sourceOrder = settlementEntriesFor(subject, evaluation, taskOrders, entries, sourceOrder)
  return uniqueEntriesFor(subject, entries)
}
