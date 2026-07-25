import { Match } from "effect"
import type { JournalRecordKey, OperationId, PlannedTaskAttempt, TaskWorkSessionId } from "./domain.js"
import { TechnicalRetryOrdinal } from "./domain.js"
import {
  attemptPlanRecordKey,
  implementationDispositionRecordKey,
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
type PlannedAttemptFact = {
  readonly _tag: "NoPlannedAttempt"
} | {
  readonly _tag: "PlannedAttempt"
  readonly plannedAttempt: PlannedTaskAttempt
}
type RecordPredecessorFact = {
  readonly _tag: "NoRecordPredecessor"
} | {
  readonly _tag: "RequiredRecordPredecessor"
  readonly key: JournalRecordKey
}
type SessionFact = {
  readonly _tag: "NoSessionFact"
} | {
  readonly _tag: "ProducedSession"
  readonly sessionId: TaskWorkSessionId
} | {
  readonly _tag: "RequiredSession"
  readonly sessionId: TaskWorkSessionId
}
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
const describeJournalEventShape = (event: WorkflowJournalEvent): JournalEventDescriptor => {
  return Match.valueTags(event, {
    ImplementationConvergenceDispositionRecorded: event => {
      const request = event.operation.request
      const plannedAttempt = request._tag === "AuthorizedImplementationConvergenceDisposition"
        ? request.disposition.subject.plannedAttempt
        : request.plannedAttempt
      const requiredKind = request._tag === "SimulatedImplementationConvergenceDisposition"
        ? []
        : request.disposition._tag === "Accepted"
            || request.disposition._tag === "ImplementationNonConvergent"
        ? ["ImplementationReviewCompleted" as const]
        : request.disposition._tag === "ReviewTechnicalRetryExhausted"
        ? ["ImplementationReviewIntended" as const]
        : request.disposition._tag === "HandbackTechnicalRetryExhausted"
        ? ["ReviewFindingsHandbackIntended" as const]
        : ["TaskExecutionOutcomeObserved" as const]
      return operationEvent({
        expectedKey: implementationDispositionRecordKey(plannedAttempt.attemptId),
        operationId: request.operationId,
        plannedAttempt,
        requiredOperationIds: event.operation.predecessorOperationIds,
        requiredPredecessorKinds: requiredKind
      })
    },
    TrackerGraphObservationIntentRecorded: event => {
      return intentEvent(
        intentRecordKey(event.operation.operationId),
        event.operation.operationId,
        undefined,
        event.operation.predecessorOperationIds
      )
    },
    TaskWorktreeReconciliationIntended: event => {
      return intentEvent(
        intentRecordKey(event.operation.operationId),
        event.operation.operationId,
        event.operation.plannedAttempt,
        event.operation.predecessorOperationIds,
        ["TaskAttemptPlanned"]
      )
    },
    ImplementationEvidenceSealingIntended: event => {
      return intentEvent(
        intentRecordKey(event.operation.operationId),
        event.operation.operationId,
        event.operation.plannedAttempt,
        event.operation.predecessorOperationIds,
        ["TaskExecutionOutcomeObserved"]
      )
    },
    ImplementationReviewIntended: event => {
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
    },
    ReviewFindingsHandbackIntended: event => {
      return intentEvent(
        intentRecordKey(event.operation.request.operationId),
        event.operation.request.operationId,
        event.operation.request.plannedAttempt,
        event.operation.predecessorOperationIds,
        ["ImplementationReviewCompleted"]
      )
    },
    TaskClaimAcquisitionIntended: event => {
      return intentEvent(
        intentRecordKey(event.operation.acquisition.operationId),
        event.operation.acquisition.operationId,
        undefined,
        event.operation.predecessorOperationIds
      )
    },
    TaskWorkSessionEstablishmentIntentRecorded: event => {
      return intentEvent(
        intentRecordKey(event.operation.request.operationId),
        event.operation.request.operationId,
        event.operation.request.plannedAttempt,
        event.operation.predecessorOperationIds,
        ["TaskAttemptPlanned", "TaskWorktreeReady"]
      )
    },
    TaskExecutionIntentRecorded: event => {
      return intentEvent(
        intentRecordKey(event.operation.request.operationId),
        event.operation.request.operationId,
        event.operation.request.plannedAttempt,
        event.operation.predecessorOperationIds,
        ["TaskWorkSessionEstablished"]
      )
    },
    TrackerGraphOutcomeObserved: event =>
      operationEvent({ expectedKey: outcomeRecordKey(event.operationId), operationId: event.operationId }),
    TaskWorktreeReady: event =>
      operationEvent({ expectedKey: outcomeRecordKey(event.operationId), operationId: event.operationId }),
    ImplementationEvidenceSealed: event =>
      operationEvent({ expectedKey: outcomeRecordKey(event.operationId), operationId: event.operationId }),
    TaskClaimAcquired: event => {
      return operationEvent({
        expectedKey: outcomeRecordKey(event.claim.operationId),
        operationId: event.claim.operationId
      })
    },
    TaskWorkSessionEstablished: event => {
      return operationEvent({
        expectedKey: outcomeRecordKey(event.outcome.operationId),
        operationId: event.outcome.operationId,
        producedSessionId: event.outcome.sessionId
      })
    },
    TaskExecutionOutcomeObserved: event => {
      return operationEvent({
        expectedKey: outcomeRecordKey(event.outcome.outcome.operationId),
        operationId: event.outcome.outcome.operationId
      })
    },
    ImplementationReviewCompleted: event => {
      return operationEvent({
        expectedKey: outcomeRecordKey(event.review.manifest.operationId),
        operationId: event.review.manifest.operationId,
        plannedAttempt: event.review.manifest.plannedAttempt
      })
    },
    ReviewFindingsHandbackCompleted: event => {
      return operationEvent({
        expectedKey: outcomeRecordKey(event.acknowledgement.operationId),
        operationId: event.acknowledgement.operationId
      })
    },
    TaskAttemptPlanned: event => {
      return operationEvent({
        expectedKey: attemptPlanRecordKey(event.operation.plannedAttempt.attemptId),
        operationId: event.operation.operationId,
        plannedAttempt: event.operation.plannedAttempt,
        requiredOperationIds: event.operation.predecessorOperationIds
      })
    },
    TaskWorkStartRequested: event => {
      return operationEvent({
        expectedKey: providerObservationRequestRecordKey(event.observationId),
        operationId: event.request.operationId,
        plannedAttempt: event.request.plannedAttempt
      })
    },
    TaskWorkSessionLookupRequested: event => {
      return operationEvent({
        expectedKey: providerObservationRequestRecordKey(event.observationId),
        operationId: event.lookup.operationId,
        plannedAttempt: event.lookup.plannedAttempt
      })
    },
    TaskWorkStartRequestAcknowledged: event => {
      return operationEvent({
        expectedKey: taskWorkStartAcknowledgedRecordKey(event.operationId, event.acknowledgement.observationId),
        operationId: event.operationId,
        requiredPredecessorKey: providerObservationRequestRecordKey(event.acknowledgement.observationId)
      })
    },
    TaskWorkStartRequestFailed: event => {
      return operationEvent({
        expectedKey: taskWorkStartFailedRecordKey(event.request.operationId, event.failure.observationId),
        operationId: event.request.operationId,
        plannedAttempt: event.request.plannedAttempt,
        requiredPredecessorKey: providerObservationRequestRecordKey(event.failure.observationId)
      })
    },
    TaskWorkSessionLookupFailed: event => {
      return operationEvent({
        expectedKey: taskWorkSessionReportedRecordKey(event.operationId, event.failure.observationId),
        operationId: event.operationId,
        requiredPredecessorKey: providerObservationRequestRecordKey(event.failure.observationId)
      })
    },
    TaskWorkSessionReported: event => {
      return operationEvent({
        expectedKey: taskWorkSessionReportedRecordKey(event.operationId, event.report.observationId),
        operationId: event.operationId,
        requiredPredecessorKey: providerObservationRequestRecordKey(event.report.observationId)
      })
    },
    TaskWorkSessionResultReported: event =>
      sessionResultEvent(taskWorkSessionResultRecordKey(event.report.observationId), event.report.sessionId),
    TaskExecutionRequestAttemptRecorded: event => {
      return operationEvent({
        expectedKey: taskExecutionRequestAttemptRecordKey(event.request.operationId),
        operationId: event.request.operationId,
        plannedAttempt: event.request.plannedAttempt
      })
    },
    TaskExecutionRequestReturned: event => {
      return operationEvent({
        expectedKey: taskExecutionRequestReturnedRecordKey(event.operationId, event.acknowledgement.observationId),
        operationId: event.operationId,
        requiredPredecessorKey: taskExecutionRequestAttemptRecordKey(event.operationId)
      })
    },
    TaskExecutionRequestFailed: event => {
      return operationEvent({
        expectedKey: taskExecutionRequestFailedRecordKey(event.request.operationId, event.failure.observationId),
        operationId: event.request.operationId,
        plannedAttempt: event.request.plannedAttempt,
        relatedOperationIds: [event.failure.operationId],
        requiredPredecessorKey: taskExecutionRequestAttemptRecordKey(event.request.operationId)
      })
    },
    TaskExecutionObservationFailed: event => {
      return operationEvent({
        expectedKey: taskExecutionObservationFailedRecordKey(event.operationId, event.failure.observationId),
        operationId: event.operationId,
        relatedOperationIds: [event.failure.operationId]
      })
    },
    TaskExecutionReported: event => {
      return operationEvent({
        expectedKey: taskExecutionReportedRecordKey(event.operationId, event.report.observationId),
        operationId: event.operationId,
        relatedOperationIds: [event.report.operationId]
      })
    },
    TechnicalRetryPolicyCaptured: event => {
      return operationEvent({
        expectedKey: technicalRetryPolicyRecordKey(event.scope),
        operationId: event.scope.operationId
      })
    },
    TechnicalRetryScheduled: event => {
      return operationEvent({
        expectedKey: technicalRetryScheduledRecordKey(event.scope, event.retryOrdinal),
        operationId: event.scope.operationId,
        requiredPredecessorKey: event.retryOrdinal === 1
          ? technicalRetryPolicyRecordKey(event.scope)
          : technicalRetryDeferralSupersededRecordKey(event.scope, TechnicalRetryOrdinal.make(event.retryOrdinal - 1))
      })
    },
    TechnicalRetryDeferralSuperseded: event => {
      return operationEvent({
        expectedKey: technicalRetryDeferralSupersededRecordKey(event.scope, event.retryOrdinal),
        operationId: event.scope.operationId,
        requiredPredecessorKey: technicalRetryScheduledRecordKey(event.scope, event.retryOrdinal)
      })
    }
  })
}
export const describeJournalEvent = describeJournalEventShape
