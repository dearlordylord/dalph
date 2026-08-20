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
  plannedAttemptReplacedRecordKey
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
  const replacement = records.findLast(({ event, position: outcomePosition }) => {
    if (event._tag !== "TaskClaimAcquired" || event.claim.taskId !== plannedAttempt.taskId) return false
    const intent = records.findLast(
      ({ event: candidate, position: intentPosition }) =>
        intentPosition < outcomePosition &&
        candidate._tag === "TaskClaimAcquisitionIntended" &&
        candidate.operation.authority._tag === "ExplicitTaskClaimReacquisitionAuthority" &&
        candidate.operation.acquisition.operationId === event.claim.operationId &&
        candidate.operation.acquisition.owner === event.claim.owner &&
        candidate.operation.acquisition.taskId === event.claim.taskId &&
        candidate.operation.acquisition.token === event.claim.token
    )
    if (intent?.event._tag !== "TaskClaimAcquisitionIntended") return false
    const authority = intent.event.operation.authority
    /* v8 ignore next -- @preserve The selecting predicate above narrows the exact authority variant. */
    if (authority._tag !== "ExplicitTaskClaimReacquisitionAuthority") return false
    return records.some(
      ({ event: candidate, position: directionPosition }) =>
        directionPosition < intent.position &&
        candidate._tag === "TaskClaimReacquisitionDirected" &&
        candidate.subject.runId === plannedAttempt.runId &&
        candidate.subject.taskId === plannedAttempt.taskId &&
        candidate.requestId === authority.requestId &&
        taskClaimReacquisitionOperationId(candidate.requestId) === event.claim.operationId
    )
  })?.event
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
