import type { Task } from "../../authorities/task-tracker/task.js"
import { isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import {
  journalRecordByKey,
  journalRecordsForTask,
  type JournalHistorySource
} from "../../workflow-journal/record-evidence.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { taskAttemptBaseRetryFactOperationId } from "../../workflow/protocols/task-attempt-planning/retry.js"
import { taskAttemptBaseReadOperationIdFor } from "../../workflow/protocols/task-attempt-planning/base-read-identity.js"
import {
  makeTrackerGraphObservationOperation,
  makeTaskClaimObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  type WorkflowOperation
} from "../../workflow/registry/operation.js"
import { FreshWorkflowStep } from "../delivery/fresh-workflow-step.js"
import { taskWasEligibleAt } from "../admission/fresh-attempt-lineage.js"

/** A request is retained even when refreshed tracker authority refuses its successor. */
export const baseRetryWorkflowStep = (
  records: JournalHistorySource,
  task: Task
): { readonly step: FreshWorkflowStep | undefined } | undefined => {
  const request = Array.from(journalRecordsForTask(records, task.id)).findLast(
    ({ event }) => event._tag === "TaskAttemptBaseRetryRequested"
  )
  if (request?.event._tag !== "TaskAttemptBaseRetryRequested") return undefined
  const { requestId, subject } = request.event
  const refused = journalRecordByKey(records, intentRecordKey(subject.refusedReadOperationId))
  if (refused?.event._tag !== "TaskAttemptBaseReadIntended") return { step: undefined }
  const baseRead = refused.event.operation
  const claim = journalRecordByKey(records, outcomeRecordKey(baseRead.claimOperationId))
  const originalSpecification = baseRead.predecessorOperationIds.flatMap((id) => {
    const intent = journalRecordByKey(records, intentRecordKey(id))
    return intent?.event._tag === "TaskTrackerReadIntentRecorded" &&
      intent.event.operation._tag === "ReadTaskWorkSpecification"
      ? [intent.event.operation]
      : []
  })[0]
  if (claim?.event._tag !== "TaskClaimAcquired" || originalSpecification === undefined) return { step: undefined }
  const target = originalSpecification.target
  const graphId = taskAttemptBaseRetryFactOperationId(requestId, "Graph")
  const claimId = taskAttemptBaseRetryFactOperationId(requestId, "Claim")
  const specId = taskAttemptBaseRetryFactOperationId(requestId, "Specification")
  const facts = (
    operation: Extract<
      WorkflowOperation,
      { readonly _tag: "ReadTrackerGraph" | "ReadTaskClaim" | "ReadTaskWorkSpecification" }
    >
  ) => ({
    step: FreshWorkflowStep.ReadTaskAttemptBaseRetryFacts({
      operation,
      operationId: operation.operationId,
      predecessorOperationId: operation.predecessorOperationIds[0] ?? baseRead.claimOperationId,
      claimOperationId: baseRead.claimOperationId,
      task
    })
  })
  const graph = journalRecordByKey(records, outcomeRecordKey(graphId))
  if (graph === undefined)
    return facts(
      makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        graphId,
        target,
        [baseRead.claimOperationId],
        [task.id]
      )
    )
  if (graph.position <= request.position || !taskWasEligibleAt(records, graph, task.id)) return { step: undefined }
  const claimRead = journalRecordByKey(records, outcomeRecordKey(claimId))
  if (claimRead === undefined) return facts(makeTaskClaimObservationOperation(claimId, target, task.id, [graphId]))
  if (
    claimRead.event._tag !== "TaskTrackerFactsObserved" ||
    claimRead.event.observation._tag !== "FocusedTaskClaimFacts" ||
    claimRead.event.observation.observation._tag !== "ActiveTaskClaim" ||
    !isExactTaskClaim(claimRead.event.observation.observation, claim.event.claim)
  )
    return { step: undefined }
  const specification = journalRecordByKey(records, outcomeRecordKey(specId))
  if (specification === undefined)
    return facts(makeTaskWorkSpecificationObservationOperation(specId, target, task.id, [claimId]))
  if (
    specification.event._tag !== "TaskTrackerFactsObserved" ||
    specification.event.observation._tag !== "FocusedTaskWorkSpecificationFacts" ||
    specification.event.observation.factFamily.fingerprint !== baseRead.taskRevision
  )
    return { step: undefined }
  const work = specification.event.observation.factFamily
  const successorId = taskAttemptBaseReadOperationIdFor(baseRead.claimOperationId, specId)
  const observed = journalRecordByKey(records, outcomeRecordKey(successorId))
  // The ordinary derivation owns acknowledged Qualified selections and immutable plans.
  if (observed?.event._tag === "TaskAttemptBaseObserved")
    return observed.event.observation._tag === "Refused" ? { step: undefined } : undefined
  return {
    step: FreshWorkflowStep.ReadTaskAttemptBase({
      retryRequestId: requestId,
      claimOperationId: baseRead.claimOperationId,
      operationId: successorId,
      policy: baseRead.policy,
      predecessorOperationId: specId,
      specification: { taskId: work.taskId, fingerprint: work.fingerprint, title: work.title, body: work.body },
      task
    })
  }
}
