import { type AttemptId, type PlannedTaskAttempt } from "@dalph/contracts"
import type { JournalRecord } from "../workflow-journal/store.js"
import { causalPredecessorOperationIds } from "./causal-history.js"
import { type WorkflowJournalEvent } from "./registry/event.js"
import { taskClaimReacquisitionOperationId } from "./protocols/task-claim-reacquisition/plan.js"

/** Finds the exact acquired claim in one planned attempt's causal history. */
export const causalClaimForAttempt = (
  records: ReadonlyArray<JournalRecord>,
  attemptId: AttemptId
): Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" }> | undefined => {
  const plan = records.flatMap(({ event }) =>
    event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.attemptId === attemptId
      ? [event.operation]
      : event._tag === "PlannedAttemptReplaced" && event.successorPlan.plannedAttempt.attemptId === attemptId
        ? [event.successorPlan]
        : []
  )[0]
  if (plan === undefined) return undefined
  const causalOperationIds = causalPredecessorOperationIds(records, plan)
  const claim = records.find(
    ({ event }) => event._tag === "TaskClaimAcquired" && causalOperationIds.has(event.claim.operationId)
  )?.event
  return claim?._tag === "TaskClaimAcquired" ? claim : undefined
}

/** Finds the original planned claim or the latest claim authorized by an exact accepted reacquisition direction. */
export const authorizedClaimForAttempt = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" }> | undefined => {
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
  return replacement?._tag === "TaskClaimAcquired"
    ? replacement
    : causalClaimForAttempt(records, plannedAttempt.attemptId)
}
