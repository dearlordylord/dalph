import { GitRepositoryLocator, IntegrationTargetRef } from "@dalph/contracts"
import {
  AttemptBasePolicy,
  TaskAttemptBaseRetryRequestedEvent,
  TaskAttemptBaseRetryRequestId,
  JournalPosition,
  TaskAttemptBaseObservedEvent,
  TaskAttemptBaseReadIntendedEvent,
  WorkflowOperation,
  WorkflowRunBeganEvent,
  describeJournalEvent,
  taskAttemptBaseReadOperationIdFor,
  workflowJournalEventVersion,
  type JournalRecord
} from "@dalph/orchestrator"

/** Rebuilds a controlled, accepted claim/specification prefix with a qualified Git selection. */
export const qualifiedBasePrefix = (
  records: ReadonlyArray<JournalRecord>,
  selectedPolicy?: AttemptBasePolicy
): ReadonlyArray<JournalRecord> => {
  const plannedIndex = records.findIndex(({ event }) => event._tag === "TaskAttemptPlanned")
  const planned = records[plannedIndex]
  const claim = records.slice(0, plannedIndex).findLast(({ event }) => event._tag === "TaskClaimAcquired")?.event
  const specification = records
    .slice(0, plannedIndex)
    .findLast(
      ({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTaskWorkSpecification"
    )?.event
  if (
    planned?.event._tag !== "TaskAttemptPlanned" ||
    claim?._tag !== "TaskClaimAcquired" ||
    specification?._tag !== "TaskTrackerReadIntentRecorded" ||
    specification.operation._tag !== "ReadTaskWorkSpecification"
  )
    throw new Error("qualified cassette requires an accepted claim, specification, and plan")
  const attempt = planned.event.operation.plannedAttempt
  const policy =
    selectedPolicy ??
    AttemptBasePolicy.cases.QualifiedCurrentIntegrationHead.make({
      executionRepository: GitRepositoryLocator.make("/qualification/execution"),
      integrationTarget: {
        repository: GitRepositoryLocator.make("/qualification/target.git"),
        ref: IntegrationTargetRef.make("refs/heads/master")
      },
      lineageAnchor: attempt.baseSha
    })
  const operation = WorkflowOperation.cases.ReadTaskAttemptBase.make({
    claimOperationId: claim.claim.operationId,
    operationId: taskAttemptBaseReadOperationIdFor(claim.claim.operationId, specification.operation.operationId),
    policy,
    predecessorOperationIds: [specification.operation.operationId],
    taskId: attempt.taskId,
    taskRevision: attempt.taskRevision
  })
  const prefix = records
    .slice(0, plannedIndex)
    .map((record) =>
      record.event._tag === "WorkflowRunBegan"
        ? { ...record, event: WorkflowRunBeganEvent.make({ ...record.event, attemptBasePolicy: policy }) }
        : record
    )
  const events = [
    TaskAttemptBaseReadIntendedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation,
      version: workflowJournalEventVersion
    }),
    TaskAttemptBaseObservedEvent.make({
      occurrenceClassification: "NonActionOccurrence",
      operationId: operation.operationId,
      observation: { _tag: "Qualified", baseSha: attempt.baseSha },
      version: workflowJournalEventVersion
    }),
    { ...planned.event, operation: { ...planned.event.operation, predecessorOperationIds: [operation.operationId] } }
  ]
  return [
    ...prefix,
    ...events.map(
      (event, index): JournalRecord => ({
        event,
        key: describeJournalEvent(event).expectedKey,
        position: JournalPosition.make(prefix.length + index + 1),
        runId: planned.runId
      })
    )
  ]
}

/** Stops a valid selected-Base fixture at a settled refusal and one explicit operator authorization. */
export const refusedBaseRetryPrefix = (
  records: ReadonlyArray<JournalRecord>,
  policy?: AttemptBasePolicy
): ReadonlyArray<JournalRecord> => {
  const qualified = qualifiedBasePrefix(records, policy)
  const observedIndex = qualified.findIndex(({ event }) => event._tag === "TaskAttemptBaseObserved")
  const intent = qualified.slice(0, observedIndex).findLast(({ event }) => event._tag === "TaskAttemptBaseReadIntended")
  const observed = qualified[observedIndex]
  if (intent?.event._tag !== "TaskAttemptBaseReadIntended" || observed?.event._tag !== "TaskAttemptBaseObserved")
    throw new Error("retry cassette requires the exact first Base read and observation")
  const observedEvent = observed.event
  const prefix = qualified
    .slice(0, observedIndex + 1)
    .map((record) =>
      record === observed
        ? {
            ...record,
            event: TaskAttemptBaseObservedEvent.make({
              ...observedEvent,
              observation: { _tag: "Refused", boundary: "TargetHead", detail: "controlled missing target ref" }
            })
          }
        : record
    )
  const event = TaskAttemptBaseRetryRequestedEvent.make({
    requestId: TaskAttemptBaseRetryRequestId.make("cassette-base-retry"),
    subject: {
      runId: intent.runId,
      taskId: intent.event.operation.taskId,
      refusedReadOperationId: intent.event.operation.operationId
    },
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    version: workflowJournalEventVersion
  })
  return [
    ...prefix,
    {
      runId: intent.runId,
      position: JournalPosition.make(prefix.length + 1),
      key: describeJournalEvent(event).expectedKey,
      event
    }
  ]
}
