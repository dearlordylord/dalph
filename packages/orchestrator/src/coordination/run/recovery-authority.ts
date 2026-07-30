import { type AttemptId, type PlannedTaskAttempt } from "@dalph/contracts"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { type WorkflowJournalEvent } from "../../workflow/registry/event.js"
import { type WorkflowOperation, workflowOperationId } from "../../workflow/registry/operation.js"
import { taskClaimReacquisitionOperationId } from "../../workflow/protocols/task-claim-reacquisition/plan.js"

const journaledOperation = (event: WorkflowJournalEvent): WorkflowOperation | undefined =>
  "operation" in event ? event.operation : undefined

/** Finds every operation that causally precedes an operation in durable history. */
const causalPredecessorClosure = (
  operation: WorkflowOperation,
  operations: ReadonlyMap<ReturnType<typeof workflowOperationId>, WorkflowOperation>
): ReadonlySet<ReturnType<typeof workflowOperationId>> => {
  const visit = (
    pending: ReadonlyArray<ReturnType<typeof workflowOperationId>>,
    reachable: ReadonlySet<ReturnType<typeof workflowOperationId>>
  ): ReadonlySet<ReturnType<typeof workflowOperationId>> => {
    const [operationId, ...remaining] = pending
    if (operationId === undefined) return reachable
    /* v8 ignore next -- @preserve A canonical predecessor graph normally visits each operation once; this closes defensive cycles. */
    if (reachable.has(operationId)) return visit(remaining, reachable)
    const predecessor = operations.get(operationId)
    return visit([...remaining, ...(predecessor?.predecessorOperationIds ?? [])], new Set([...reachable, operationId]))
  }
  return visit(operation.predecessorOperationIds, new Set())
}

/** Finds the exact acquired claim in one planned attempt's causal history. */
export const causalClaimForAttempt = (
  records: ReadonlyArray<JournalRecord>,
  attemptId: AttemptId
): Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" }> | undefined => {
  const plan = records.find(
    ({ event }) => event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.attemptId === attemptId
  )?.event
  if (plan?._tag !== "TaskAttemptPlanned") return undefined
  const operations = new Map(
    records.flatMap(({ event }) => {
      const operation = journaledOperation(event)
      return operation === undefined ? [] : [[workflowOperationId(operation), operation] as const]
    })
  )
  const causalOperationIds = causalPredecessorClosure(plan.operation, operations)
  const claim = records.find(
    ({ event }) => event._tag === "TaskClaimAcquired" && causalOperationIds.has(event.claim.operationId)
  )?.event
  return claim?._tag === "TaskClaimAcquired" ? claim : undefined
}

/**
 * Finds the original planned claim or the latest replacement authorized by an
 * authenticated reacquisition command and its exact durable intent.
 */
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
    const intentEvent = intent.event
    /* v8 ignore next -- @preserve The selecting predicate above already narrows this exact authority variant. */
    if (intentEvent.operation.authority._tag !== "ExplicitTaskClaimReacquisitionAuthority") return false
    const commandId = intentEvent.operation.authority.commandId
    const command = records.findLast(
      ({ event: candidate, position: commandPosition }) =>
        commandPosition < intent.position &&
        candidate._tag === "ControlCommandRecorded" &&
        candidate.command._tag === "RequestTaskClaimReacquisition" &&
        candidate.command.runId === plannedAttempt.runId &&
        candidate.command.taskId === plannedAttempt.taskId &&
        candidate.command.commandId === commandId &&
        taskClaimReacquisitionOperationId(candidate.command.commandId) === event.claim.operationId
    )
    return command?.event._tag === "ControlCommandRecorded"
  })?.event
  return replacement?._tag === "TaskClaimAcquired"
    ? replacement
    : causalClaimForAttempt(records, plannedAttempt.attemptId)
}
