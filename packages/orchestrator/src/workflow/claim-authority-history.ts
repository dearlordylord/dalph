/* eslint-disable functional/immutable-data -- Process-local memo indexes mutate only private maps; claim authority stays journal-derived. */
import { type AttemptId, type PlannedTaskAttempt } from "@dalph/contracts"
import { Schema } from "effect"
import type { JournalRecord } from "../workflow-journal/store.js"
import { causalPredecessorOperationIds } from "./causal-history.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  type WorkflowJournalEvent
} from "./registry/event.js"
import { PlannedAttemptReplacedEvent } from "./protocols/attempt-choice/replacement-events.js"
import { TaskClaimReacquisitionDirectedEvent } from "./protocols/task-claim-reacquisition/events.js"
import { taskClaimReacquisitionOperationId } from "./protocols/task-claim-reacquisition/plan.js"
import { recordedTaskAttemptPlans } from "./protocols/task-attempt-planning/journal-evidence.js"
import { journalPrefixPredecessorOf } from "../workflow-journal/prefix-lineage.js"

/** Finds the exact acquired claim in one planned attempt's causal history. */
export const causalClaimForAttempt = (
  records: ReadonlyArray<JournalRecord>,
  attemptId: AttemptId
): Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" }> | undefined => {
  const plan = recordedTaskAttemptPlans(records).find(({ plannedAttempt }) => plannedAttempt.attemptId === attemptId)
  if (plan === undefined) return undefined
  const causalOperationIds = causalPredecessorOperationIds(records, plan)
  const claim = records.find(
    ({ event }) => event._tag === "TaskClaimAcquired" && causalOperationIds.has(event.claim.operationId)
  )?.event
  return claim?._tag === "TaskClaimAcquired" ? claim : undefined
}

/** Finds the original planned claim or the latest claim authorized by an exact accepted reacquisition direction. */
type AcquiredClaimEvent = Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" }>
const authorizedClaimsByPrefix = new WeakMap<
  ReadonlyArray<JournalRecord>,
  Map<AttemptId, AcquiredClaimEvent | undefined>
>()

/** Journal facts that can change the exact claim authorized for a planned attempt. */
const ClaimAuthorityJournalEvent = Schema.Union([
  TaskAttemptPlannedEvent,
  PlannedAttemptReplacedEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimReacquisitionDirectedEvent
])

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
    predecessor !== undefined && !Schema.is(ClaimAuthorityJournalEvent)(predecessor.appended.event)
      ? authorizedClaimForAttempt(predecessor.prior, plannedAttempt)
      : deriveAuthorizedClaimForAttempt(records, plannedAttempt)
  const cache = cachedByAttempt ?? new Map<AttemptId, AcquiredClaimEvent | undefined>()
  cache.set(plannedAttempt.attemptId, authorized)
  authorizedClaimsByPrefix.set(records, cache)
  return authorized
}
