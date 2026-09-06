/* eslint-disable functional/immutable-data -- local projection scratch state never escapes the read. */
import {
  plannedAttemptExecutorCorrelationKey,
  type PlannedAttemptExecutorCorrelation,
  type RunId,
  type TaskId
} from "@dalph/contracts"
import { deliveryProposalOrderTaskId } from "./delivery-action-proposal.js"
import type { DeliveryRuntimeLiveOwnerSnapshot } from "./delivery-runtime-observation.js"
import type { DeliveryRuntimeEvaluation, TicketDelivery } from "./relations.js"
import {
  DeliveryStatusProjectionConflict,
  makeDeliveryStatusEntryIdentity,
  type DeliveryStatusEntry,
  type DeliveryStatusSubject
} from "./delivery-status-model.js"
import {
  addEntry,
  ownerIsSettled,
  runWideTaskOrder,
  compareOrderedEntries,
  deliveryTaskOrder,
  includeForSubject,
  taskStatusSubject,
  statusEntryIdentity,
  statusEntryJson,
  validateLiveOwnersForStatus,
  validateDeliveryEvidenceForStatus,
  taskOrderOrConflictFor,
  type OrderedStatusEntry
} from "./delivery-status-support.js"
import { deliveryTaskPositionAt, taskOrderAt, type StatusTaskOrder } from "./delivery-status-order.js"
import { dependencyEntriesFor, trackerAndEvidenceEntriesFor } from "./delivery-status-entry-builders.js"

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

const actionEntriesFor = (
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

const deliveryHolderOrder = (
  holders: ReadonlyArray<{ readonly taskId: TaskId; readonly correlation: PlannedAttemptExecutorCorrelation }>
): ReadonlyArray<{ readonly taskId: TaskId; readonly correlation: PlannedAttemptExecutorCorrelation }> =>
  holders.toSorted(
    (left, right) =>
      left.taskId.localeCompare(right.taskId) ||
      plannedAttemptExecutorCorrelationKey(left.correlation).localeCompare(
        plannedAttemptExecutorCorrelationKey(right.correlation)
      )
  )

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
        entryIdentity: makeDeliveryStatusEntryIdentity(first.id),
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
  entries: Array<OrderedStatusEntry>
): DeliveryStatusProjectionConflict | null => {
  for (const [index, delivery] of evaluation.current.ticketDeliveries.deliveries.entries()) {
    if (!includeForSubject(subject, delivery.taskId)) continue
    const evidenceConflict = validateDeliveryEvidenceForStatus(subject, delivery)
    if (evidenceConflict !== null) return evidenceConflict
    const capacityEntry = capacityWaitFor(subject, evaluation, runId, delivery)
    const taskOrder = taskOrderAt(deliveryTaskPositionAt(index))
    if (capacityEntry !== null) addEntry(entries, capacityEntry, taskOrder)
    const builderConflict = trackerAndEvidenceEntriesFor(subject, delivery, taskOrder, entries)
    if (builderConflict !== null) return builderConflict
  }
  return null
}

/** Graph-only prerequisite waits remain observable even when no workflow responsibility exists yet. */
const graphDependencyEntriesFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  entries: Array<OrderedStatusEntry>
): DeliveryStatusProjectionConflict | null => {
  const retainedTaskIds = new Set(evaluation.current.ticketDeliveries.deliveries.map(({ taskId }) => taskId))
  for (const [index, placement] of evaluation.current.ticketDeliveries.source.placements.entries()) {
    if (retainedTaskIds.has(placement.taskId)) continue
    const conflict = dependencyEntriesFor(
      subject,
      placement.taskId,
      placement.placement,
      taskOrderAt(deliveryTaskPositionAt(index)),
      entries
    )
    if (conflict !== null) return conflict
  }
  return null
}

const issueEntriesFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  taskOrders: ReadonlyMap<TaskId, StatusTaskOrder>,
  entries: Array<OrderedStatusEntry>
): DeliveryStatusProjectionConflict | null => {
  if (evaluation.proposedActions._tag !== "DeliveryProposalsAvailable") return null
  for (const issue of evaluation.proposedActions.isolatedIssues) {
    if (!includeForSubject(subject, issue.taskId)) continue
    const taskOrder = taskOrderOrConflictFor(subject, taskOrders, issue.taskId)
    if (taskOrder instanceof DeliveryStatusProjectionConflict) return taskOrder
    addEntry(
      entries,
      {
        _tag: "EvidenceUnavailable",
        classification: "Blocked",
        subject: taskStatusSubject(subject, issue.taskId),
        responsibility: null,
        evidence: { _tag: "ProposalDerivationIssue", issue }
      },
      taskOrder
    )
  }
  return null
}

const settlementEntriesFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  taskOrders: ReadonlyMap<TaskId, StatusTaskOrder>,
  entries: Array<OrderedStatusEntry>
): DeliveryStatusProjectionConflict | null => {
  for (const settlement of evaluation.current.settlements.settlements) {
    if (!includeForSubject(subject, settlement.taskId)) continue
    const taskOrder = taskOrderOrConflictFor(subject, taskOrders, settlement.taskId)
    if (taskOrder instanceof DeliveryStatusProjectionConflict) return taskOrder
    addEntry(
      entries,
      {
        _tag: "Settlement",
        classification: "Settled",
        subject: taskStatusSubject(subject, settlement.taskId),
        settlement
      },
      taskOrder
    )
  }
  return null
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
        entryIdentity: makeDeliveryStatusEntryIdentity(identity),
        detail: "one exact status identity produced incompatible current values"
      })
    }
  }
  return result
}

const retainedDependencyEntriesFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  entries: Array<OrderedStatusEntry>
): DeliveryStatusProjectionConflict | null => {
  for (const [index, delivery] of evaluation.current.ticketDeliveries.deliveries.entries()) {
    const conflict = dependencyEntriesFor(
      subject,
      delivery.taskId,
      delivery.placement,
      taskOrderAt(deliveryTaskPositionAt(index)),
      entries
    )
    if (conflict !== null) return conflict
  }
  return null
}

const statusInputConflictFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
): DeliveryStatusProjectionConflict | null => {
  const ownershipConflict = ownershipConflictFor(subject, evaluation)
  if (ownershipConflict !== null) return ownershipConflict
  return validateLiveOwnersForStatus(subject, evaluation, liveOwners)
}

export const statusEntriesFor = (
  subject: DeliveryStatusSubject,
  evaluation: DeliveryRuntimeEvaluation,
  runId: RunId,
  liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
): Array<DeliveryStatusEntry> | DeliveryStatusProjectionConflict => {
  const inputConflict = statusInputConflictFor(subject, evaluation, liveOwners)
  if (inputConflict !== null) return inputConflict
  const entries: Array<OrderedStatusEntry> = []
  const taskOrders = deliveryTaskOrder(evaluation)
  const graphConflict = graphDependencyEntriesFor(subject, evaluation, entries)
  if (graphConflict !== null) return graphConflict
  const retainedDependencyConflict = retainedDependencyEntriesFor(subject, evaluation, entries)
  if (retainedDependencyConflict !== null) return retainedDependencyConflict
  const deliveryConflict = deliveryEntriesFor(subject, evaluation, runId, entries)
  if (deliveryConflict !== null) return deliveryConflict
  const actionConflict = actionEntriesFor(subject, evaluation, liveOwners, entries, taskOrders)
  if (actionConflict !== null) return actionConflict
  const issueConflict = issueEntriesFor(subject, evaluation, taskOrders, entries)
  if (issueConflict !== null) return issueConflict
  const settlementConflict = settlementEntriesFor(subject, evaluation, taskOrders, entries)
  if (settlementConflict !== null) return settlementConflict
  return uniqueEntriesFor(subject, entries)
}
