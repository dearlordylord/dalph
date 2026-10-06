import { isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import {
  taskAttemptBaseRetryFactOperationId,
  taskAttemptBaseRetryRecordKey
} from "../../workflow/protocols/task-attempt-planning/retry.js"
import {
  journalRecordByKey,
  journalRecordsForTask,
  type JournalHistorySource
} from "../../workflow-journal/record-evidence.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"

/** A successor read requires the recorded Operator request and three newly accepted tracker facts. */
export const baseReadRetryAuthorityWasAccepted = (
  records: JournalHistorySource,
  operation: Extract<WorkflowOperation, { readonly _tag: "ReadTaskAttemptBase" }>
): boolean => {
  const competingReads = Array.from(journalRecordsForTask(records, operation.taskId)).filter(
    ({ event }) =>
      event._tag === "TaskAttemptBaseReadIntended" &&
      event.operation.operationId !== operation.operationId &&
      event.operation.claimOperationId === operation.claimOperationId &&
      event.operation.taskRevision === operation.taskRevision
  )
  if (operation.retryRequestId === undefined && competingReads.length !== 0) return false
  if (operation.retryRequestId !== undefined) {
    const previous = competingReads[competingReads.length - 1]
    if (previous?.event._tag !== "TaskAttemptBaseReadIntended") return false
    const priorRead = previous.event.operation
    const refusal = journalRecordByKey(records, outcomeRecordKey(priorRead.operationId))
    const requested = journalRecordByKey(records, taskAttemptBaseRetryRecordKey(priorRead.operationId))
    if (
      refusal?.event._tag !== "TaskAttemptBaseObserved" ||
      refusal.event.observation._tag !== "Refused" ||
      requested?.event._tag !== "TaskAttemptBaseRetryRequested" ||
      requested.position <= refusal.position ||
      requested.event.requestId !== operation.retryRequestId ||
      requested.event.subject.taskId !== operation.taskId
    )
      return false
    const graphId = taskAttemptBaseRetryFactOperationId(operation.retryRequestId, "Graph")
    const claimId = taskAttemptBaseRetryFactOperationId(operation.retryRequestId, "Claim")
    const specId = taskAttemptBaseRetryFactOperationId(operation.retryRequestId, "Specification")
    const graphIntent = journalRecordByKey(records, intentRecordKey(graphId))
    const graphOutcome = journalRecordByKey(records, outcomeRecordKey(graphId))
    const claimIntent = journalRecordByKey(records, intentRecordKey(claimId))
    const claimOutcome = journalRecordByKey(records, outcomeRecordKey(claimId))
    const specIntent = journalRecordByKey(records, intentRecordKey(specId))
    const specOutcome = journalRecordByKey(records, outcomeRecordKey(specId))
    const ownedClaim = journalRecordByKey(records, outcomeRecordKey(operation.claimOperationId))
    if (
      graphIntent === undefined ||
      graphIntent.position <= requested.position ||
      graphOutcome === undefined ||
      claimIntent?.event._tag !== "TaskTrackerReadIntentRecorded" ||
      claimIntent.event.operation._tag !== "ReadTaskClaim" ||
      claimIntent.position <= graphOutcome.position ||
      !claimIntent.event.operation.predecessorOperationIds.includes(graphId) ||
      claimOutcome?.event._tag !== "TaskTrackerFactsObserved" ||
      claimOutcome.event.observation._tag !== "FocusedTaskClaimFacts" ||
      claimOutcome.event.observation.observation._tag !== "ActiveTaskClaim" ||
      ownedClaim?.event._tag !== "TaskClaimAcquired" ||
      !isExactTaskClaim(claimOutcome.event.observation.observation, ownedClaim.event.claim) ||
      specIntent?.event._tag !== "TaskTrackerReadIntentRecorded" ||
      specIntent.event.operation._tag !== "ReadTaskWorkSpecification" ||
      specIntent.position <= claimOutcome.position ||
      !specIntent.event.operation.predecessorOperationIds.includes(claimId) ||
      specOutcome?.event._tag !== "TaskTrackerFactsObserved" ||
      specOutcome.event.observation._tag !== "FocusedTaskWorkSpecificationFacts" ||
      specOutcome.event.observation.factFamily.fingerprint !== priorRead.taskRevision ||
      !operation.predecessorOperationIds.includes(specId)
    )
      return false
  }
  return true
}
