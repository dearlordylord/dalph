import type { JournalRecordKey, OperationId, PlannedTaskAttempt, TaskWorkSessionId } from "./domain.js"
import { TechnicalRetryOrdinal } from "./domain.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  providerObservationRequestRecordKey,
  taskExecutionObservationFailedRecordKey,
  taskExecutionReportedRecordKey,
  taskExecutionRequestAttemptRecordKey,
  taskExecutionRequestFailedRecordKey,
  taskExecutionRequestReturnedRecordKey,
  taskWorkSessionReportedRecordKey,
  taskWorkSessionResultRecordKey,
  taskWorkStartAcknowledgedRecordKey,
  taskWorkStartFailedRecordKey
} from "./journal-record-key.js"
import type { WorkflowJournalEvent } from "./journal-store.js"
import {
  technicalRetryDeferralSupersededRecordKey,
  technicalRetryPolicyRecordKey,
  technicalRetryScheduledRecordKey
} from "./technical-retry.js"

/** Canonical physical identity and predecessor facts derived from one typed event. */
interface OperationEventDescriptor {
  readonly _tag: "OperationEventDescriptor"
  readonly expectedKey: JournalRecordKey
  readonly operationId: OperationId
  readonly plannedAttempt: PlannedAttemptFact
  readonly relatedOperationIds: ReadonlyArray<OperationId>
  readonly requiredOperationIds: ReadonlyArray<OperationId>
  readonly requiredPredecessorKinds: ReadonlyArray<WorkflowJournalEvent["_tag"]>
  readonly recordPredecessor: RecordPredecessorFact
  readonly session: SessionFact
}

interface SessionResultEventDescriptor {
  readonly _tag: "SessionResultEventDescriptor"
  readonly expectedKey: JournalRecordKey
  readonly requiredSessionId: TaskWorkSessionId
}

type JournalEventDescriptor = OperationEventDescriptor | SessionResultEventDescriptor

type PlannedAttemptFact =
  | { readonly _tag: "NoPlannedAttempt" }
  | { readonly _tag: "PlannedAttempt"; readonly plannedAttempt: PlannedTaskAttempt }

type RecordPredecessorFact =
  | { readonly _tag: "NoRecordPredecessor" }
  | { readonly _tag: "RequiredRecordPredecessor"; readonly key: JournalRecordKey }

type SessionFact =
  | { readonly _tag: "NoSessionFact" }
  | { readonly _tag: "ProducedSession"; readonly sessionId: TaskWorkSessionId }
  | { readonly _tag: "RequiredSession"; readonly sessionId: TaskWorkSessionId }

interface OperationEventInput {
  readonly expectedKey: JournalRecordKey
  readonly operationId: OperationId
  readonly plannedAttempt?: PlannedTaskAttempt
  readonly producedSessionId?: TaskWorkSessionId
  readonly relatedOperationIds?: ReadonlyArray<OperationId>
  readonly requiredOperationIds?: ReadonlyArray<OperationId>
  readonly requiredPredecessorKey?: JournalRecordKey
  readonly requiredPredecessorKinds?: ReadonlyArray<WorkflowJournalEvent["_tag"]>
}

const operationEvent = (input: OperationEventInput): OperationEventDescriptor => ({
  _tag: "OperationEventDescriptor",
  expectedKey: input.expectedKey,
  operationId: input.operationId,
  plannedAttempt: input.plannedAttempt === undefined
    ? { _tag: "NoPlannedAttempt" }
    : { _tag: "PlannedAttempt", plannedAttempt: input.plannedAttempt },
  recordPredecessor: input.requiredPredecessorKey === undefined
    ? { _tag: "NoRecordPredecessor" }
    : { _tag: "RequiredRecordPredecessor", key: input.requiredPredecessorKey },
  relatedOperationIds: input.relatedOperationIds ?? [],
  requiredOperationIds: input.requiredOperationIds ?? [],
  requiredPredecessorKinds: input.requiredPredecessorKinds ?? [],
  session: input.producedSessionId === undefined
    ? { _tag: "NoSessionFact" }
    : { _tag: "ProducedSession", sessionId: input.producedSessionId }
})

const sessionResultEvent = (
  expectedKey: JournalRecordKey,
  requiredSessionId: TaskWorkSessionId
): SessionResultEventDescriptor => ({
  _tag: "SessionResultEventDescriptor",
  expectedKey,
  requiredSessionId
})

const intentEvent = (
  expectedKey: JournalRecordKey,
  operationId: OperationId,
  plannedAttempt: PlannedTaskAttempt | undefined,
  requiredOperationIds: ReadonlyArray<OperationId>,
  requiredPredecessorKinds: ReadonlyArray<WorkflowJournalEvent["_tag"]> = []
): OperationEventDescriptor =>
  operationEvent({
    expectedKey,
    operationId,
    ...(plannedAttempt === undefined ? {} : { plannedAttempt }),
    requiredOperationIds,
    requiredPredecessorKinds
  })

export const describeJournalEvent = (event: WorkflowJournalEvent): JournalEventDescriptor => {
  switch (event._tag) {
    case "TrackerGraphObservationIntentRecorded":
      return intentEvent(
        intentRecordKey(event.operation.operationId),
        event.operation.operationId,
        undefined,
        event.operation.predecessorOperationIds
      )
    case "TaskWorktreeReconciliationIntended":
      return intentEvent(
        intentRecordKey(event.operation.operationId),
        event.operation.operationId,
        event.operation.plannedAttempt,
        event.operation.predecessorOperationIds,
        ["TaskAttemptPlanned"]
      )
    case "ImplementationEvidenceSealingIntended":
      return intentEvent(
        intentRecordKey(event.operation.operationId),
        event.operation.operationId,
        event.operation.plannedAttempt,
        event.operation.predecessorOperationIds,
        ["TaskExecutionOutcomeObserved"]
      )
    case "ImplementationReviewIntended": {
      const plannedAttempt = "plannedAttempt" in event.operation.request
        ? event.operation.request.plannedAttempt
        : undefined
      return intentEvent(
        intentRecordKey(event.operation.request.operationId),
        event.operation.request.operationId,
        plannedAttempt,
        event.operation.predecessorOperationIds,
        ["ImplementationEvidenceSealed"]
      )
    }
    case "ReviewFindingsHandbackIntended":
      return intentEvent(
        intentRecordKey(event.operation.request.operationId),
        event.operation.request.operationId,
        event.operation.request.plannedAttempt,
        event.operation.predecessorOperationIds,
        ["ImplementationReviewCompleted"]
      )
    case "TaskClaimAcquisitionIntended":
      return intentEvent(
        intentRecordKey(event.operation.acquisition.operationId),
        event.operation.acquisition.operationId,
        undefined,
        event.operation.predecessorOperationIds
      )
    case "TaskWorkSessionEstablishmentIntentRecorded":
    case "TaskExecutionIntentRecorded":
      return intentEvent(
        intentRecordKey(event.operation.request.operationId),
        event.operation.request.operationId,
        event.operation.request.plannedAttempt,
        event.operation.predecessorOperationIds,
        event._tag === "TaskWorkSessionEstablishmentIntentRecorded"
          ? ["TaskAttemptPlanned", "TaskWorktreeReady"]
          : ["TaskWorkSessionEstablished"]
      )
    case "TrackerGraphOutcomeObserved":
    case "TaskWorktreeReady":
    case "ImplementationEvidenceSealed":
      return operationEvent({ expectedKey: outcomeRecordKey(event.operationId), operationId: event.operationId })
    case "TaskClaimAcquired":
      return operationEvent({
        expectedKey: outcomeRecordKey(event.claim.operationId),
        operationId: event.claim.operationId
      })
    case "TaskWorkSessionEstablished":
      return operationEvent({
        expectedKey: outcomeRecordKey(event.outcome.operationId),
        operationId: event.outcome.operationId,
        producedSessionId: event.outcome.sessionId
      })
    case "TaskExecutionOutcomeObserved":
      return operationEvent({
        expectedKey: outcomeRecordKey(event.outcome.outcome.operationId),
        operationId: event.outcome.outcome.operationId
      })
    case "ImplementationReviewCompleted":
      return operationEvent({
        expectedKey: outcomeRecordKey(event.review.manifest.operationId),
        operationId: event.review.manifest.operationId,
        plannedAttempt: event.review.manifest.plannedAttempt
      })
    case "ReviewFindingsHandbackCompleted":
      return operationEvent({
        expectedKey: outcomeRecordKey(event.acknowledgement.operationId),
        operationId: event.acknowledgement.operationId
      })
    case "TaskAttemptPlanned":
      return operationEvent({
        expectedKey: attemptPlanRecordKey(event.operation.plannedAttempt.attemptId),
        operationId: event.operation.operationId,
        plannedAttempt: event.operation.plannedAttempt,
        requiredOperationIds: event.operation.predecessorOperationIds
      })
    case "TaskWorkStartRequested":
      return operationEvent({
        expectedKey: providerObservationRequestRecordKey(event.observationId),
        operationId: event.request.operationId,
        plannedAttempt: event.request.plannedAttempt
      })
    case "TaskWorkSessionLookupRequested":
      return operationEvent({
        expectedKey: providerObservationRequestRecordKey(event.observationId),
        operationId: event.lookup.operationId,
        plannedAttempt: event.lookup.plannedAttempt
      })
    case "TaskWorkStartRequestAcknowledged":
      return operationEvent({
        expectedKey: taskWorkStartAcknowledgedRecordKey(event.operationId, event.acknowledgement.observationId),
        operationId: event.operationId,
        requiredPredecessorKey: providerObservationRequestRecordKey(event.acknowledgement.observationId)
      })
    case "TaskWorkStartRequestFailed":
      return operationEvent({
        expectedKey: taskWorkStartFailedRecordKey(event.request.operationId, event.failure.observationId),
        operationId: event.request.operationId,
        plannedAttempt: event.request.plannedAttempt,
        requiredPredecessorKey: providerObservationRequestRecordKey(event.failure.observationId)
      })
    case "TaskWorkSessionLookupFailed":
      return operationEvent({
        expectedKey: taskWorkSessionReportedRecordKey(event.operationId, event.failure.observationId),
        operationId: event.operationId,
        requiredPredecessorKey: providerObservationRequestRecordKey(event.failure.observationId)
      })
    case "TaskWorkSessionReported":
      return operationEvent({
        expectedKey: taskWorkSessionReportedRecordKey(event.operationId, event.report.observationId),
        operationId: event.operationId,
        requiredPredecessorKey: providerObservationRequestRecordKey(event.report.observationId)
      })
    case "TaskWorkSessionResultReported":
      return sessionResultEvent(
        taskWorkSessionResultRecordKey(event.report.observationId),
        event.report.sessionId
      )
    case "TaskExecutionRequestAttemptRecorded":
      return operationEvent({
        expectedKey: taskExecutionRequestAttemptRecordKey(event.request.operationId),
        operationId: event.request.operationId,
        plannedAttempt: event.request.plannedAttempt
      })
    case "TaskExecutionRequestReturned":
      return operationEvent({
        expectedKey: taskExecutionRequestReturnedRecordKey(event.operationId, event.acknowledgement.observationId),
        operationId: event.operationId,
        requiredPredecessorKey: taskExecutionRequestAttemptRecordKey(event.operationId)
      })
    case "TaskExecutionRequestFailed":
      return operationEvent({
        expectedKey: taskExecutionRequestFailedRecordKey(event.request.operationId, event.failure.observationId),
        operationId: event.request.operationId,
        plannedAttempt: event.request.plannedAttempt,
        relatedOperationIds: [event.failure.operationId],
        requiredPredecessorKey: taskExecutionRequestAttemptRecordKey(event.request.operationId)
      })
    case "TaskExecutionObservationFailed":
      return operationEvent({
        expectedKey: taskExecutionObservationFailedRecordKey(event.operationId, event.failure.observationId),
        operationId: event.operationId,
        relatedOperationIds: [event.failure.operationId]
      })
    case "TaskExecutionReported":
      return operationEvent({
        expectedKey: taskExecutionReportedRecordKey(event.operationId, event.report.observationId),
        operationId: event.operationId,
        relatedOperationIds: [event.report.operationId]
      })
    case "TechnicalRetryPolicyCaptured":
      return operationEvent({
        expectedKey: technicalRetryPolicyRecordKey(event.scope),
        operationId: event.scope.operationId
      })
    case "TechnicalRetryScheduled":
      return operationEvent({
        expectedKey: technicalRetryScheduledRecordKey(event.scope, event.retryOrdinal),
        operationId: event.scope.operationId,
        requiredPredecessorKey: event.retryOrdinal === 1
          ? technicalRetryPolicyRecordKey(event.scope)
          : technicalRetryDeferralSupersededRecordKey(
            event.scope,
            TechnicalRetryOrdinal.make(event.retryOrdinal - 1)
          )
      })
    case "TechnicalRetryDeferralSuperseded":
      return operationEvent({
        expectedKey: technicalRetryDeferralSupersededRecordKey(event.scope, event.retryOrdinal),
        operationId: event.scope.operationId,
        requiredPredecessorKey: technicalRetryScheduledRecordKey(event.scope, event.retryOrdinal)
      })
  }
}
