/* eslint-disable functional/immutable-data -- Process-local memo indexes mutate only private maps; claim authority stays journal-derived. */
import { type AttemptId, type PlannedTaskAttempt } from "@dalph/contracts"
import type { JournalRecord } from "../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "./registry/event.js"
import { causalPredecessorOperationIds } from "./causal-history.js"
import { taskClaimReacquisitionOperationId } from "./protocols/task-claim-reacquisition/plan.js"
import { journalPrefixPredecessorOf } from "../workflow-journal/prefix-lineage.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptReplacedRecordKey,
  taskClaimReacquisitionDirectedRecordKey
} from "../workflow-journal/record-key.js"

/** Finds the exact acquired claim in one planned attempt's causal history. */
export const causalClaimForAttempt = (
  records: ReadonlyArray<JournalRecord>,
  attemptId: AttemptId
): Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" }> | undefined => {
  const plans = records.flatMap((record) => {
    if (
      record.event._tag === "TaskAttemptPlanned" &&
      record.event.operation.plannedAttempt.attemptId === attemptId &&
      record.runId === record.event.operation.plannedAttempt.runId &&
      record.key === attemptPlanRecordKey(attemptId)
    ) {
      return [{ record, operation: record.event.operation }]
    }
    if (
      record.event._tag === "PlannedAttemptReplaced" &&
      record.event.successorPlan.plannedAttempt.attemptId === attemptId &&
      record.runId === record.event.successorPlan.plannedAttempt.runId &&
      record.key === plannedAttemptReplacedRecordKey(record.event.subject.plannedAttempt.attemptId)
    ) {
      return [{ record, operation: record.event.successorPlan }]
    }
    return []
  })
  const plan = plans.length === 1 ? plans[0] : undefined
  if (plan === undefined) return undefined

  const claimOutcomes = records.filter(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" }>
    } =>
      record.event._tag === "TaskClaimAcquired" &&
      record.runId === plan.record.runId &&
      causalPredecessorOperationIds(records, plan.operation).has(record.event.claim.operationId) &&
      record.key === outcomeRecordKey(record.event.claim.operationId)
  )
  if (claimOutcomes.length !== 1) return undefined
  const claimOutcome = claimOutcomes[0]
  if (claimOutcome === undefined || claimOutcome.position >= plan.record.position) return undefined
  const claim = claimOutcome.event.claim
  const claimIntents = records.filter(
    (record) =>
      record.event._tag === "TaskClaimAcquisitionIntended" &&
      record.runId === plan.record.runId &&
      record.key === intentRecordKey(claim.operationId) &&
      record.event.operation.acquisition.operationId === claim.operationId &&
      record.event.operation.acquisition.owner === claim.owner &&
      record.event.operation.acquisition.taskId === claim.taskId &&
      record.event.operation.acquisition.token === claim.token
  )
  const claimIntent = claimIntents[0]
  return claimIntents.length === 1 && claimIntent !== undefined && claimIntent.position < claimOutcome.position
    ? claimOutcome.event
    : undefined
}

/** Finds the original planned claim or the latest claim authorized by an exact accepted reacquisition direction. */
type AcquiredClaimEvent = Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" }>
const authorizedClaimsByPrefix = new WeakMap<
  ReadonlyArray<JournalRecord>,
  Map<AttemptId, AcquiredClaimEvent | undefined>
>()

/** Journal facts that can change the exact claim authorized for a planned attempt. */
const isClaimAuthorityJournalEvent = (event: WorkflowJournalEvent): boolean =>
  event._tag === "TaskAttemptPlanned" ||
  event._tag === "PlannedAttemptReplaced" ||
  event._tag === "TaskClaimAcquisitionIntended" ||
  event._tag === "TaskClaimAcquired" ||
  event._tag === "TaskClaimReacquisitionDirected"

const deriveAuthorizedClaimForAttempt = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): AcquiredClaimEvent | undefined => {
  const plannedRecords = records.filter((record) => {
    if (record.event._tag === "TaskAttemptPlanned") {
      return (
        record.event.operation.plannedAttempt.attemptId === plannedAttempt.attemptId &&
        record.event.operation.plannedAttempt.runId === plannedAttempt.runId &&
        record.runId === plannedAttempt.runId &&
        record.key === attemptPlanRecordKey(plannedAttempt.attemptId)
      )
    }
    return (
      record.event._tag === "PlannedAttemptReplaced" &&
      record.event.successorPlan.plannedAttempt.attemptId === plannedAttempt.attemptId &&
      record.event.successorPlan.plannedAttempt.runId === plannedAttempt.runId &&
      record.runId === plannedAttempt.runId &&
      record.key === plannedAttemptReplacedRecordKey(record.event.subject.plannedAttempt.attemptId)
    )
  })
  if (plannedRecords.length !== 1) return undefined
  const plannedRecord = plannedRecords[0]
  if (plannedRecord === undefined) return undefined
  const replacement = records.toReversed().flatMap((claimRecord) => {
    const event = claimRecord.event
    if (
      event._tag !== "TaskClaimAcquired" ||
      claimRecord.runId !== plannedAttempt.runId ||
      claimRecord.key !== outcomeRecordKey(event.claim.operationId) ||
      event.claim.taskId !== plannedAttempt.taskId
    ) {
      return []
    }
    const intents = records.filter(
      (intentRecord) =>
        intentRecord.position < claimRecord.position &&
        intentRecord.runId === plannedAttempt.runId &&
        intentRecord.event._tag === "TaskClaimAcquisitionIntended" &&
        intentRecord.key === intentRecordKey(event.claim.operationId) &&
        intentRecord.event.operation.authority._tag === "ExplicitTaskClaimReacquisitionAuthority" &&
        intentRecord.event.operation.acquisition.operationId === event.claim.operationId &&
        intentRecord.event.operation.acquisition.owner === event.claim.owner &&
        intentRecord.event.operation.acquisition.taskId === event.claim.taskId &&
        intentRecord.event.operation.acquisition.token === event.claim.token
    )
    if (intents.length !== 1) return []
    const intent = intents[0]
    if (intent === undefined || intent.event._tag !== "TaskClaimAcquisitionIntended") return []
    const authority = intent.event.operation.authority
    if (authority._tag !== "ExplicitTaskClaimReacquisitionAuthority") return []
    const directions = records.filter(
      (directionRecord) =>
        directionRecord.position < intent.position &&
        directionRecord.position > plannedRecord.position &&
        directionRecord.runId === plannedAttempt.runId &&
        directionRecord.key === taskClaimReacquisitionDirectedRecordKey(authority.requestId) &&
        directionRecord.event._tag === "TaskClaimReacquisitionDirected" &&
        directionRecord.event.subject.runId === plannedAttempt.runId &&
        directionRecord.event.subject.taskId === plannedAttempt.taskId &&
        directionRecord.event.requestId === authority.requestId &&
        taskClaimReacquisitionOperationId(directionRecord.event.requestId) === event.claim.operationId
    )
    return directions.length === 1 ? [event] : []
  })[0]
  const authorized =
    replacement?._tag === "TaskClaimAcquired" ? replacement : causalClaimForAttempt(records, plannedAttempt.attemptId)
  return authorized
}

export const authorizedClaimForAttempt = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): AcquiredClaimEvent | undefined => {
  const cachedByAttempt = authorizedClaimsByPrefix.get(records)
  if (cachedByAttempt?.has(plannedAttempt.attemptId) === true) return cachedByAttempt.get(plannedAttempt.attemptId)
  const predecessor = journalPrefixPredecessorOf(records)
  const authorized =
    predecessor !== undefined && !isClaimAuthorityJournalEvent(predecessor.appended.event)
      ? authorizedClaimForAttempt(predecessor.prior, plannedAttempt)
      : deriveAuthorizedClaimForAttempt(records, plannedAttempt)
  const cache = cachedByAttempt ?? new Map<AttemptId, AcquiredClaimEvent | undefined>()
  cache.set(plannedAttempt.attemptId, authorized)
  authorizedClaimsByPrefix.set(records, cache)
  return authorized
}
