/* eslint-disable max-lines -- The closed event vocabulary and its exact durable-key descriptors stay exhaustive. */
import { Match } from "effect"
import {
  type AttemptId,
  type PlannedAttemptExecutorCorrelation,
  type PlannedTaskAttempt,
  type RunId
} from "@dalph/contracts"
import type { ControlDirectionApplicationOrdinal } from "../protocols/control-direction-application/events.js"
import type { TaskClaimReacquisitionRequestId } from "../protocols/task-claim-reacquisition/events.js"
import type { AttemptChoiceRequestId } from "../protocols/attempt-choice/events.js"
import { type JournalPosition, type JournalRecordKey } from "../../workflow-journal/identity.js"
import { type OperationId } from "../identity.js"
import {
  attemptPlanRecordKey,
  attemptChoiceAppliedRecordKey,
  attemptImplementationAbandonedRecordKey,
  attemptStoppageIntentRecordKey,
  controlDirectionAppliedRecordKey,
  taskClaimReacquisitionDirectedRecordKey,
  intentRecordKey,
  integrationResponsibilityBeganRecordKey,
  integrationStartedRecordKey,
  integrationCandidateAgentReportRecordKey,
  integrationCandidateConstructedRecordKey,
  integrationCandidateConstructionIntentRecordKey,
  integrationCandidateSessionSupersededRecordKey,
  integrationCandidateGitObservationRecordKey,
  integrationCandidateGitValidationFailureRecordKey,
  integrationCandidateCorrectionLimitReachedRecordKey,
  integrationCandidateContinuationLimitReachedRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandProjectionObservedRecordKey,
  plannedAttemptExecutorCommandResponseContradictedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  stoppedAttemptClaimNoReleaseRecordKey,
  workflowRunBeganRecordKey,
  workflowRunTerminatedRecordKey,
  taskWorkCapacityPolicyRecordKey,
  targetVerificationCorrelationContradictedRecordKey,
  targetVerificationEvidenceSealedRecordKey,
  targetVerificationIntentRecordKey,
  targetPromotionAttemptIntentRecordKey,
  targetPromotionIntentRecordKey,
  targetPromotionNonConvergenceRecordKey,
  targetPromotionObservedSuccessRecordKey,
  targetPromotionStaleRecordKey,
  completionClaimReplacementIntentRecordKey,
  completionClaimReplacementAttemptIntentRecordKey,
  completionClaimReplacedRecordKey,
  completionClaimDeletionIntentRecordKey,
  completionClaimDeletionAttemptIntentRecordKey,
  completionClaimDeletionReadObservedRecordKey,
  completionClaimDeletedRecordKey,
  integrationFinalitySettledRecordKey,
  completionTaskAcknowledgedRecordKey,
  completionTaskAttemptIntentRecordKey,
  completionTaskCandidateAncestryObservedRecordKey,
  completionTaskCandidateAncestryReadIntentRecordKey,
  completionTaskIntentRecordKey,
  completionTaskRequestLookupIntentRecordKey,
  completionTaskRequestLookupRecordKey,
  completionTaskRejectedRecordKey,
  completionTaskResponseLostRecordKey,
  plannedAttemptContinuationAuthorizedRecordKey,
  plannedAttemptReplacedRecordKey
} from "../../workflow-journal/record-key.js"
import type { WorkflowJournalEvent } from "./event.js"
import type {
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal
} from "../protocols/planned-attempt-executor-work/events.js"

interface OperationEventDescriptor {
  readonly _tag: "OperationEventDescriptor"
  readonly expectedKey: JournalRecordKey
  readonly operationId: OperationId
  readonly plannedAttempt: PlannedAttemptFact
  readonly relatedOperationIds: ReadonlyArray<OperationId>
  readonly requiredOperationIds: ReadonlyArray<OperationId>
  readonly requiredPredecessorKinds: ReadonlyArray<WorkflowJournalEvent["_tag"]>
  readonly recordPredecessor: RecordPredecessorFact
}

interface ControlDirectionEventDescriptor {
  readonly _tag: "ControlDirectionEventDescriptor"
  readonly expectedKey: JournalRecordKey
  readonly ordinal: ControlDirectionApplicationOrdinal
  readonly runId: RunId
}

interface AttemptChoiceEventDescriptor {
  readonly _tag: "AttemptChoiceEventDescriptor"
  readonly expectedKey: JournalRecordKey
  readonly requestId: AttemptChoiceRequestId
  readonly runId: RunId
}

interface TaskClaimReacquisitionDirectionEventDescriptor {
  readonly _tag: "TaskClaimReacquisitionDirectionEventDescriptor"
  readonly expectedKey: JournalRecordKey
  readonly requestId: TaskClaimReacquisitionRequestId
  readonly runId: RunId
}

interface PlannedAttemptExecutorEventDescriptor {
  readonly _tag: "PlannedAttemptExecutorEventDescriptor"
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly expectedKey: JournalRecordKey
  readonly ordinal: PlannedAttemptExecutorCommandOrdinal | PlannedAttemptExecutorReportOrdinal | undefined
  readonly plannedAttempt: PlannedTaskAttempt | undefined
}

interface WorkflowRunLifecycleEventDescriptor {
  readonly _tag: "WorkflowRunLifecycleEventDescriptor"
  readonly expectedKey: JournalRecordKey
}

interface RunPolicyEventDescriptor {
  readonly _tag: "RunPolicyEventDescriptor"
  readonly expectedKey: JournalRecordKey
}

interface GenericEventDescriptor {
  readonly _tag: "GenericEventDescriptor"
  readonly expectedKey: JournalRecordKey
}

interface IntegrationEventDescriptor {
  readonly _tag: "IntegrationEventDescriptor"
  readonly attemptId: AttemptId
  readonly expectedKey: JournalRecordKey
  readonly responsibilityBeganAt: JournalPosition | undefined
  readonly runId: RunId
}

type JournalEventDescriptor =
  | AttemptChoiceEventDescriptor
  | ControlDirectionEventDescriptor
  | GenericEventDescriptor
  | IntegrationEventDescriptor
  | OperationEventDescriptor
  | PlannedAttemptExecutorEventDescriptor
  | RunPolicyEventDescriptor
  | TaskClaimReacquisitionDirectionEventDescriptor
  | WorkflowRunLifecycleEventDescriptor

type PlannedAttemptFact =
  | { readonly _tag: "NoPlannedAttempt" }
  | { readonly _tag: "PlannedAttempt"; readonly plannedAttempt: PlannedTaskAttempt }

type RecordPredecessorFact =
  | { readonly _tag: "NoRecordPredecessor" }
  | { readonly _tag: "RequiredRecordPredecessor"; readonly key: JournalRecordKey }

interface OperationEventInput {
  readonly expectedKey: JournalRecordKey
  readonly operationId: OperationId
  readonly plannedAttempt?: PlannedTaskAttempt
  readonly relatedOperationIds?: ReadonlyArray<OperationId>
  readonly requiredOperationIds: ReadonlyArray<OperationId>
  readonly requiredPredecessorKey?: JournalRecordKey
  readonly requiredPredecessorKinds?: ReadonlyArray<WorkflowJournalEvent["_tag"]>
}

const operationEvent = (input: OperationEventInput): OperationEventDescriptor => ({
  _tag: "OperationEventDescriptor",
  expectedKey: input.expectedKey,
  operationId: input.operationId,
  plannedAttempt:
    input.plannedAttempt === undefined
      ? { _tag: "NoPlannedAttempt" }
      : { _tag: "PlannedAttempt", plannedAttempt: input.plannedAttempt },
  recordPredecessor:
    input.requiredPredecessorKey === undefined
      ? { _tag: "NoRecordPredecessor" }
      : { _tag: "RequiredRecordPredecessor", key: input.requiredPredecessorKey },
  relatedOperationIds: input.relatedOperationIds ?? [],
  requiredOperationIds: input.requiredOperationIds,
  requiredPredecessorKinds: input.requiredPredecessorKinds ?? []
})

const plannedAttemptExecutorEvent = (
  correlation: PlannedAttemptExecutorCorrelation,
  expectedKey: JournalRecordKey,
  plannedAttempt: PlannedTaskAttempt | undefined,
  ordinal: PlannedAttemptExecutorCommandOrdinal | PlannedAttemptExecutorReportOrdinal | undefined
): PlannedAttemptExecutorEventDescriptor => ({
  _tag: "PlannedAttemptExecutorEventDescriptor",
  correlation,
  expectedKey,
  ordinal,
  plannedAttempt
})

/** Derives canonical storage identity and causal facts from one generic event. */
export const describeJournalEvent = Match.type<WorkflowJournalEvent>().pipe(
  Match.withReturnType<JournalEventDescriptor>(),
  Match.tagsExhaustive({
    WorkflowRunBegan: () => ({ _tag: "WorkflowRunLifecycleEventDescriptor", expectedKey: workflowRunBeganRecordKey }),
    WorkflowRunTerminated: () => ({
      _tag: "WorkflowRunLifecycleEventDescriptor",
      expectedKey: workflowRunTerminatedRecordKey
    }),
    TaskWorkCapacityChanged: (event) => ({
      _tag: "RunPolicyEventDescriptor",
      expectedKey: taskWorkCapacityPolicyRecordKey(event.revision)
    }),
    ControlDirectionApplied: (event) => ({
      _tag: "ControlDirectionEventDescriptor",
      expectedKey: controlDirectionAppliedRecordKey(event.ordinal),
      ordinal: event.ordinal,
      runId: event.subject.runId
    }),
    AttemptChoiceApplied: (event) => ({
      _tag: "AttemptChoiceEventDescriptor",
      expectedKey: attemptChoiceAppliedRecordKey(event.requestId),
      requestId: event.requestId,
      runId: event.subject.plannedAttempt.runId
    }),
    PlannedAttemptReplaced: (event) =>
      operationEvent({
        expectedKey: plannedAttemptReplacedRecordKey(event.subject.plannedAttempt.attemptId),
        operationId: event.successorPlan.operationId,
        plannedAttempt: event.successorPlan.plannedAttempt,
        relatedOperationIds: [
          event.witness.graphObservationOperationId,
          event.witness.specificationObservationOperationId,
          event.witness.claimObservationOperationId,
          event.witness.oldWorktreeObservationOperationId,
          event.witness.targetLineageObservationOperationId
        ],
        requiredOperationIds: event.successorPlan.predecessorOperationIds
      }),
    AttemptRestartAuthorityReadFailed: (event) =>
      operationEvent({
        expectedKey: outcomeRecordKey(event.operationId),
        operationId: event.operationId,
        plannedAttempt: event.subject.plannedAttempt,
        requiredOperationIds: [event.operationId],
        requiredPredecessorKey: intentRecordKey(event.operationId),
        requiredPredecessorKinds: [
          event.failure._tag === "AttemptRestartTaskFactsReadFailure"
            ? "TaskTrackerReadIntentRecorded"
            : "GitReadIntentRecorded"
        ]
      }),
    AttemptStoppageIntended: (event) => ({
      _tag: "AttemptChoiceEventDescriptor",
      expectedKey: attemptStoppageIntentRecordKey(event.requestId),
      requestId: event.requestId,
      runId: event.subject.plannedAttempt.runId
    }),
    AttemptImplementationAbandoned: (event) => ({
      _tag: "AttemptChoiceEventDescriptor",
      expectedKey: attemptImplementationAbandonedRecordKey(event.requestId),
      requestId: event.requestId,
      runId: event.subject.plannedAttempt.runId
    }),
    StoppedAttemptClaimNoReleaseObserved: (event) => ({
      _tag: "AttemptChoiceEventDescriptor",
      expectedKey: stoppedAttemptClaimNoReleaseRecordKey(event.requestId),
      requestId: event.requestId,
      runId: event.subject.plannedAttempt.runId
    }),
    TaskClaimReacquisitionDirected: (event) => ({
      _tag: "TaskClaimReacquisitionDirectionEventDescriptor",
      expectedKey: taskClaimReacquisitionDirectedRecordKey(event.requestId),
      requestId: event.requestId,
      runId: event.subject.runId
    }),
    PlannedAttemptExecutorWorkResponsibilityBegan: (event) =>
      plannedAttemptExecutorEvent(
        { attemptId: event.plannedAttempt.attemptId, runId: event.plannedAttempt.runId },
        plannedAttemptExecutorWorkResponsibilityBeganRecordKey(event.plannedAttempt.attemptId),
        event.plannedAttempt,
        undefined
      ),
    PlannedAttemptContinuationAuthorized: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: plannedAttemptContinuationAuthorizedRecordKey(event.plannedAttempt.attemptId, [
        event.witness.activeTaskContinuationRead.graphObservationOperationId,
        event.witness.activeTaskContinuationRead.taskClaimObservationOperationId,
        event.witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId,
        event.witness.worktreeObservationOperationId
      ])
    }),
    PlannedAttemptExecutorCommandIntended: (event) =>
      plannedAttemptExecutorEvent(
        { attemptId: event.plannedAttempt.attemptId, runId: event.plannedAttempt.runId },
        plannedAttemptExecutorCommandIntendedRecordKey(event.plannedAttempt.attemptId, event.ordinal),
        event.plannedAttempt,
        event.ordinal
      ),
    PlannedAttemptExecutorCommandProjectionObserved: (event) =>
      plannedAttemptExecutorEvent(
        { attemptId: event.plannedAttempt.attemptId, runId: event.plannedAttempt.runId },
        plannedAttemptExecutorCommandProjectionObservedRecordKey(
          event.plannedAttempt.attemptId,
          event.commandOrdinal,
          event.projectionOrdinal
        ),
        event.plannedAttempt,
        event.commandOrdinal
      ),
    PlannedAttemptExecutorCommandResponseContradicted: (event) =>
      plannedAttemptExecutorEvent(
        { attemptId: event.plannedAttempt.attemptId, runId: event.plannedAttempt.runId },
        plannedAttemptExecutorCommandResponseContradictedRecordKey(
          event.plannedAttempt.attemptId,
          event.commandOrdinal
        ),
        event.plannedAttempt,
        event.commandOrdinal
      ),
    PlannedAttemptExecutorStateObserved: (event) =>
      plannedAttemptExecutorEvent(
        { attemptId: event.plannedAttempt.attemptId, runId: event.plannedAttempt.runId },
        plannedAttemptExecutorStateObservedRecordKey(event.plannedAttempt.attemptId, event.ordinal),
        event.plannedAttempt,
        undefined
      ),
    PlannedAttemptExecutorWorkReported: (event) =>
      plannedAttemptExecutorEvent(
        event.report.correlation,
        plannedAttemptExecutorWorkReportedRecordKey(event.report.correlation.attemptId, event.ordinal),
        undefined,
        event.ordinal
      ),
    IntegrationResponsibilityBegan: (event) => ({
      _tag: "IntegrationEventDescriptor",
      attemptId: event.plannedAttempt.attemptId,
      expectedKey: integrationResponsibilityBeganRecordKey(event.plannedAttempt.attemptId),
      responsibilityBeganAt: undefined,
      runId: event.plannedAttempt.runId
    }),
    IntegrationStarted: (event) => ({
      _tag: "IntegrationEventDescriptor",
      attemptId: event.plannedAttempt.attemptId,
      expectedKey: integrationStartedRecordKey(event.plannedAttempt.attemptId),
      responsibilityBeganAt: event.responsibilityBeganAt,
      runId: event.plannedAttempt.runId
    }),
    IntegrationCandidateConstructionIntended: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: integrationCandidateConstructionIntentRecordKey(event.correlation)
    }),
    IntegrationCandidateSessionSuperseded: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: integrationCandidateSessionSupersededRecordKey(
        event.priorCorrelation,
        event.successorCorrelation
      )
    }),
    IntegrationCandidateAgentReported: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: integrationCandidateAgentReportRecordKey(event.expectedCorrelation, event.ordinal)
    }),
    IntegrationCandidateGitObserved: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: integrationCandidateGitObservationRecordKey(event.correlation, event.submissionAt)
    }),
    IntegrationCandidateConstructed: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: integrationCandidateConstructedRecordKey(event.correlation)
    }),
    IntegrationCandidateGitValidationFailed: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: integrationCandidateGitValidationFailureRecordKey(
        event.correlation,
        event.submissionAt,
        event.attemptOrdinal
      )
    }),
    IntegrationCandidateCorrectionLimitReached: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: integrationCandidateCorrectionLimitReachedRecordKey(event.correlation)
    }),
    IntegrationCandidateContinuationLimitReached: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: integrationCandidateContinuationLimitReachedRecordKey(event.correlation)
    }),
    TargetVerificationIntended: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: targetVerificationIntentRecordKey(event.correlation.requestId)
    }),
    TargetVerificationEvidenceSealed: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: targetVerificationEvidenceSealedRecordKey(event.correlation.requestId)
    }),
    TargetVerificationCorrelationContradicted: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: targetVerificationCorrelationContradictedRecordKey(event.expected.requestId)
    }),
    TargetPromotionIntended: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: targetPromotionIntentRecordKey(event.correlation.requestId)
    }),
    TargetPromotionAttemptIntended: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: targetPromotionAttemptIntentRecordKey(event.correlation.requestId, event.attemptOrdinal)
    }),
    TargetPromotionObservedSuccess: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: targetPromotionObservedSuccessRecordKey(event.correlation.requestId)
    }),
    TargetPromotionStale: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: targetPromotionStaleRecordKey(event.correlation.requestId)
    }),
    TargetPromotionNonConvergence: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: targetPromotionNonConvergenceRecordKey(event.correlation.requestId)
    }),
    CompletionClaimReplacementIntended: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: completionClaimReplacementIntentRecordKey(event.operationId)
    }),
    CompletionClaimReplacementAttemptIntended: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: completionClaimReplacementAttemptIntentRecordKey(event.operationId, event.attemptOrdinal)
    }),
    CompletionClaimReplaced: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: completionClaimReplacedRecordKey(event.operationId)
    }),
    CompletionClaimDeletionIntended: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: completionClaimDeletionIntentRecordKey(event.operationId)
    }),
    CompletionClaimDeletionAttemptIntended: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: completionClaimDeletionAttemptIntentRecordKey(event.operationId, event.attemptOrdinal)
    }),
    CompletionClaimDeletionReadObserved: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: completionClaimDeletionReadObservedRecordKey(event.request.operationId, event.purpose)
    }),
    CompletionClaimDeleted: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: completionClaimDeletedRecordKey(event.operationId)
    }),
    IntegrationFinalitySettled: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: integrationFinalitySettledRecordKey(event.claim.promotionCorrelation.requestId)
    }),
    CompletionTaskIntended: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: completionTaskIntentRecordKey(event.request)
    }),
    CompletionTaskAttemptIntended: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: completionTaskAttemptIntentRecordKey(event.request, event.attemptOrdinal)
    }),
    CompletionTaskAcknowledged: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: completionTaskAcknowledgedRecordKey(event.request)
    }),
    CompletionTaskResponseLost: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: completionTaskResponseLostRecordKey(event.request, event.attemptOrdinal)
    }),
    CompletionTaskRejected: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: completionTaskRejectedRecordKey(event.request, event.attemptOrdinal)
    }),
    CompletionTaskCandidateAncestryReadIntended: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: completionTaskCandidateAncestryReadIntentRecordKey(event.operationId)
    }),
    CompletionTaskCandidateAncestryObserved: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: completionTaskCandidateAncestryObservedRecordKey(event.operationId)
    }),
    CompletionTaskRequestLookupIntended: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: completionTaskRequestLookupIntentRecordKey(event.request, event.attemptOrdinal)
    }),
    CompletionTaskRequestLookupObserved: (event) => ({
      _tag: "GenericEventDescriptor",
      expectedKey: completionTaskRequestLookupRecordKey(event.request, event.attemptOrdinal)
    }),
    TaskTrackerReadIntentRecorded: (event) =>
      operationEvent({
        expectedKey: intentRecordKey(event.operation.operationId),
        operationId: event.operation.operationId,
        requiredOperationIds: event.operation.predecessorOperationIds
      }),
    GitReadIntentRecorded: (event) =>
      operationEvent({
        expectedKey: intentRecordKey(event.operation.operationId),
        operationId: event.operation.operationId,
        plannedAttempt: event.operation.plannedAttempt,
        requiredOperationIds: event.operation.predecessorOperationIds
      }),
    PlannedAttemptWorktreeObserved: (event) =>
      operationEvent({
        expectedKey: outcomeRecordKey(event.operationId),
        operationId: event.operationId,
        requiredOperationIds: [event.operationId],
        requiredPredecessorKey: intentRecordKey(event.operationId),
        requiredPredecessorKinds: ["GitReadIntentRecorded"]
      }),
    TargetLineageObserved: (event) =>
      operationEvent({
        expectedKey: outcomeRecordKey(event.operationId),
        operationId: event.operationId,
        plannedAttempt: event.plannedAttempt,
        requiredOperationIds: [event.operationId],
        requiredPredecessorKey: intentRecordKey(event.operationId),
        requiredPredecessorKinds: ["GitReadIntentRecorded"]
      }),
    TaskTrackerFactsObserved: (event) =>
      operationEvent({
        expectedKey: outcomeRecordKey(event.operationId),
        operationId: event.operationId,
        requiredOperationIds: [event.operationId],
        requiredPredecessorKey: intentRecordKey(event.operationId),
        requiredPredecessorKinds: ["TaskTrackerReadIntentRecorded"]
      }),
    TaskClaimAcquisitionIntended: (event) =>
      operationEvent({
        expectedKey: intentRecordKey(event.operation.acquisition.operationId),
        operationId: event.operation.acquisition.operationId,
        relatedOperationIds: [event.operation.acquisition.operationId],
        requiredOperationIds: event.operation.predecessorOperationIds
      }),
    TaskClaimAcquired: (event) =>
      operationEvent({
        expectedKey: outcomeRecordKey(event.claim.operationId),
        operationId: event.claim.operationId,
        relatedOperationIds: [event.claim.operationId],
        requiredOperationIds: [event.claim.operationId],
        requiredPredecessorKey: intentRecordKey(event.claim.operationId),
        requiredPredecessorKinds: ["TaskClaimAcquisitionIntended"]
      }),
    TaskClaimAcquisitionRejected: (event) =>
      operationEvent({
        expectedKey: outcomeRecordKey(event.operationId),
        operationId: event.operationId,
        relatedOperationIds: [event.operationId, event.observed.operationId],
        requiredOperationIds: [event.operationId],
        requiredPredecessorKey: intentRecordKey(event.operationId),
        requiredPredecessorKinds: ["TaskClaimAcquisitionIntended"]
      }),
    TaskClaimReleaseIntended: (event) =>
      operationEvent({
        expectedKey: intentRecordKey(event.operation.release.operationId),
        operationId: event.operation.release.operationId,
        relatedOperationIds: [event.operation.release.operationId, event.operation.release.claim.operationId],
        requiredOperationIds: event.operation.predecessorOperationIds
      }),
    TaskClaimReleased: (event) =>
      operationEvent({
        expectedKey: outcomeRecordKey(event.release.operationId),
        operationId: event.release.operationId,
        relatedOperationIds: [event.release.operationId, event.release.claim.operationId],
        requiredOperationIds: [event.release.operationId],
        requiredPredecessorKey: intentRecordKey(event.release.operationId),
        requiredPredecessorKinds: ["TaskClaimReleaseIntended"]
      }),
    TaskAttemptPlanned: (event) =>
      operationEvent({
        expectedKey: attemptPlanRecordKey(event.operation.plannedAttempt.attemptId),
        operationId: event.operation.operationId,
        plannedAttempt: event.operation.plannedAttempt,
        requiredOperationIds: event.operation.predecessorOperationIds
      }),
    TaskWorktreeReconciliationIntended: (event) =>
      operationEvent({
        expectedKey: intentRecordKey(event.operation.operationId),
        operationId: event.operation.operationId,
        plannedAttempt: event.operation.plannedAttempt,
        requiredOperationIds: event.operation.predecessorOperationIds
      }),
    TaskWorktreeReady: (event) =>
      operationEvent({
        expectedKey: outcomeRecordKey(event.operationId),
        operationId: event.operationId,
        requiredOperationIds: [event.operationId],
        requiredPredecessorKey: intentRecordKey(event.operationId),
        requiredPredecessorKinds: ["TaskWorktreeReconciliationIntended"]
      })
  })
)

/** Operation identity whose initiating journal fact has already been accepted. */
export const acceptedOperationIdOf = (event: WorkflowJournalEvent): OperationId | undefined => {
  const descriptor = describeJournalEvent(event)
  return descriptor._tag === "OperationEventDescriptor" && descriptor.recordPredecessor._tag === "NoRecordPredecessor"
    ? descriptor.operationId
    : undefined
}
