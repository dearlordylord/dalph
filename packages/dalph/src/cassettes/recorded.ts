/* eslint-disable max-lines -- Projection, inverse fold, and presentation share one exhaustive cassette boundary. */
import { Effect, Schema } from "effect"
import {
  AttemptChoiceAppliedEvent,
  AttemptImplementationAbandonedEvent,
  AttemptStoppageIntendedEvent,
  ControlDirectionAppliedEvent,
  describeJournalEvent,
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent,
  IntegrationCandidateAgentReportedEvent,
  IntegrationCandidateConstructedEvent,
  IntegrationCandidateConstructionIntendedEvent,
  IntegrationCandidateGitObservedEvent,
  IntegrationCandidateGitValidationFailedEvent,
  IntegrationCandidateCorrectionLimitReachedEvent,
  IntegrationCandidateContinuationLimitReachedEvent,
  integrationCandidateCorrelationEquals,
  JournalPosition,
  PlannedAttemptContinuationAuthorizedEvent,
  TargetVerificationCorrelationContradictedEvent,
  TargetVerificationEvidenceSealedEvent,
  TargetVerificationIntendedEvent,
  TargetPromotionIntendedEvent,
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionObservedSuccessEvent,
  TargetPromotionStaleEvent,
  TargetPromotionNonConvergenceEvent,
  CompletionClaimReplacementIntendedEvent,
  CompletionClaimReplacementAttemptIntendedEvent,
  CompletionClaimReplacedEvent,
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimDeletionAttemptIntendedEvent,
  CompletionClaimDeletedEvent,
  IntegrationFinalitySettledEvent,
  type JournalRecord,
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandResponseContradictedEvent,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquisitionRejectedEvent,
  taskTrackerReadIntent,
  taskTrackerFactsObservedEvent,
  type WorkflowJournalEvent,
  WorkflowActor,
  workflowJournalEventVersion,
  reduceWorkflowJournalHistory,
  StoppedAttemptClaimNoReleaseObservedEvent,
  TaskClaimReacquisitionDirectedEvent
} from "@dalph/orchestrator"
import {
  type CassetteIdentityRenaming,
  RecordedCassette,
  type RecordedCassette as RecordedCassetteType,
  type RecordedCassetteEntry,
  recordedCassetteVersion
} from "./recorded-domain.js"
import { renameRecordedCassette } from "./recorded-renaming.js"
import { appliedOccurrencePosition, semanticJson, semanticState } from "./recorded-semantic-state.js"
import {
  eventForGitObservationEntry,
  isRecordedGitObservationEntry,
  lyricForGitObservationEntry,
  recordGitObservationEntry,
  type RecordedGitObservationEntry
} from "./recorded-git-observation-mapping.js"
import {
  eventForRunEntry,
  isJournalRunEntry,
  isRecordedRunEntry,
  lyricForRunEntry,
  recordedRunEntryFor,
  type RecordedRunEntry
} from "./recorded-run-mapping.js"
import {
  eventForClaimReleaseEntry,
  eventForWorktreeEntry,
  isRecordedClaimReleaseEntry,
  isRecordedWorktreeEntry,
  lyricForClaimReleaseEntry,
  lyricForWorktreeEntry,
  recordClaimReleaseEntry,
  recordWorktreeEntry
} from "./recorded-task-boundary-mapping.js"

const coordinator = () => WorkflowActor.cases.DalphCoordinator.make({})

const recordTrackerEntry = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" | "TaskTrackerReadIntentRecorded" }>
): RecordedCassetteEntry =>
  event._tag === "TaskTrackerReadIntentRecorded" ? trackerReadEntry(event) : trackerFactsEntry(event)

// Separate constructors keep the exhaustive journal mapping small.
const trackerReadEntry = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerReadIntentRecorded" }>
): RecordedCassetteEntry => ({
  _tag: "TaskTrackerReadInitiated",
  initiatedBy: coordinator(),
  occurrenceClassification: "InitiatedAction",
  operation: event.operation
})

const trackerFactsEntry = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" }>
): RecordedCassetteEntry => ({
  _tag: "TaskTrackerFactsObserved",
  evidence: event.observation,
  occurrenceClassification: "NonActionOccurrence",
  originatingActionOperationId: event.operationId
})

const recordExecutorEntry = (
  event: Extract<
    WorkflowJournalEvent,
    {
      readonly _tag:
        | "PlannedAttemptExecutorCommandIntended"
        | "PlannedAttemptExecutorCommandProjectionObserved"
        | "PlannedAttemptExecutorCommandResponseContradicted"
        | "PlannedAttemptExecutorStateObserved"
        | "PlannedAttemptExecutorWorkReported"
        | "PlannedAttemptExecutorWorkResponsibilityBegan"
    }
  >
): RecordedCassetteEntry => {
  switch (event._tag) {
    case "PlannedAttemptExecutorWorkResponsibilityBegan":
      return {
        _tag: "PlannedAttemptExecutorWorkResponsibilityBegan",
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        plannedAttempt: event.plannedAttempt
      }
    case "PlannedAttemptExecutorWorkReported":
      return {
        _tag: "PlannedAttemptExecutorWorkReported",
        occurrenceClassification: "NonActionOccurrence",
        ordinal: event.ordinal,
        report: event.report
      }
    case "PlannedAttemptExecutorCommandIntended":
      return {
        _tag: "PlannedAttemptExecutorCommandIntended",
        command: event.command,
        initiatedBy: event.initiatedBy,
        occurrenceClassification: event.occurrenceClassification,
        ordinal: event.ordinal,
        plannedAttempt: event.plannedAttempt
      }
    case "PlannedAttemptExecutorCommandProjectionObserved":
      return {
        _tag: "PlannedAttemptExecutorCommandProjectionObserved",
        commandOrdinal: event.commandOrdinal,
        observation: event.observation,
        occurrenceClassification: event.occurrenceClassification,
        plannedAttempt: event.plannedAttempt,
        projectionOrdinal: event.projectionOrdinal
      }
    case "PlannedAttemptExecutorCommandResponseContradicted":
      return {
        _tag: "PlannedAttemptExecutorCommandResponseContradicted",
        commandOrdinal: event.commandOrdinal,
        observed: event.observed,
        occurrenceClassification: event.occurrenceClassification,
        plannedAttempt: event.plannedAttempt
      }
    case "PlannedAttemptExecutorStateObserved":
      return {
        _tag: "PlannedAttemptExecutorStateObserved",
        observation: event.observation,
        occurrenceClassification: event.occurrenceClassification,
        ordinal: event.ordinal,
        plannedAttempt: event.plannedAttempt
      }
  }
}

type RecordedIntegrationEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "IntegrationResponsibilityBegan" | "IntegrationStarted" }
>

const isRecordedIntegrationEntry = <Value extends { readonly _tag: string }>(
  value: Value
): value is Extract<Value, { readonly _tag: "IntegrationResponsibilityBegan" | "IntegrationStarted" }> =>
  value._tag === "IntegrationResponsibilityBegan" || value._tag === "IntegrationStarted"

const recordIntegrationEntry = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationResponsibilityBegan" | "IntegrationStarted" }>
): RecordedIntegrationEntry => ({
  _tag: event._tag,
  acceptedResult: event.acceptedResult,
  initiatedBy: coordinator(),
  integrationTarget: event.integrationTarget,
  occurrenceClassification: "InitiatedAction",
  plannedAttempt: event.plannedAttempt
})

type CandidateConstructionEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "IntegrationCandidateAgentReported"
      | "IntegrationCandidateConstructed"
      | "IntegrationCandidateConstructionIntended"
      | "IntegrationCandidateGitObserved"
      | "IntegrationCandidateGitValidationFailed"
      | "IntegrationCandidateCorrectionLimitReached"
      | "IntegrationCandidateContinuationLimitReached"
  }
>

type RecordedCandidateConstructionEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: CandidateConstructionEvent["_tag"] }
>

const isCandidateConstructionEvent = (event: WorkflowJournalEvent): event is CandidateConstructionEvent =>
  event._tag === "IntegrationCandidateAgentReported" ||
  event._tag === "IntegrationCandidateConstructed" ||
  event._tag === "IntegrationCandidateConstructionIntended" ||
  event._tag === "IntegrationCandidateGitObserved" ||
  event._tag === "IntegrationCandidateGitValidationFailed" ||
  event._tag === "IntegrationCandidateCorrectionLimitReached" ||
  event._tag === "IntegrationCandidateContinuationLimitReached"

const isRecordedCandidateConstructionEntry = (
  entry: RecordedCassetteEntry
): entry is RecordedCandidateConstructionEntry =>
  new Set([
    "IntegrationCandidateAgentReported",
    "IntegrationCandidateConstructed",
    "IntegrationCandidateConstructionIntended",
    "IntegrationCandidateGitObserved",
    "IntegrationCandidateGitValidationFailed",
    "IntegrationCandidateCorrectionLimitReached",
    "IntegrationCandidateContinuationLimitReached"
  ]).has(entry._tag)

const recordCandidateConstructionEntry = (event: CandidateConstructionEvent): RecordedCandidateConstructionEntry => {
  switch (event._tag) {
    case "IntegrationCandidateConstructionIntended":
      return {
        _tag: event._tag,
        correlation: event.correlation,
        correctionLimit: event.correctionLimit,
        continuationLimit: event.continuationLimit,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        plannedAttempt: event.plannedAttempt
      }
    case "IntegrationCandidateAgentReported":
      return {
        _tag: event._tag,
        expectedCorrelation: event.expectedCorrelation,
        occurrenceClassification: "NonActionOccurrence",
        ordinal: event.ordinal,
        report: event.report
      }
    case "IntegrationCandidateGitObserved":
      return {
        _tag: event._tag,
        candidateCommit: event.candidateCommit,
        correlation: event.correlation,
        observation: event.observation,
        occurrenceClassification: "NonActionOccurrence"
      }
    case "IntegrationCandidateConstructed":
      return {
        _tag: event._tag,
        candidateCommit: event.candidateCommit,
        correlation: event.correlation,
        occurrenceClassification: "NonActionOccurrence"
      }
    case "IntegrationCandidateGitValidationFailed":
      return {
        _tag: event._tag,
        attemptOrdinal: event.attemptOrdinal,
        candidateCommit: event.candidateCommit,
        correlation: event.correlation,
        detail: event.detail,
        occurrenceClassification: "NonActionOccurrence"
      }
    case "IntegrationCandidateCorrectionLimitReached":
      return {
        _tag: event._tag,
        correctionCount: event.correctionCount,
        correctionLimit: event.correctionLimit,
        correlation: event.correlation,
        occurrenceClassification: "NonActionOccurrence"
      }
    case "IntegrationCandidateContinuationLimitReached":
      return {
        _tag: event._tag,
        continuationCount: event.continuationCount,
        continuationLimit: event.continuationLimit,
        correlation: event.correlation,
        occurrenceClassification: "NonActionOccurrence"
      }
  }
}

type TargetVerificationEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "TargetVerificationIntended"
      | "TargetVerificationEvidenceSealed"
      | "TargetVerificationCorrelationContradicted"
  }
>

type RecordedTargetVerificationEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: TargetVerificationEvent["_tag"] }
>

const isTargetVerificationEvent = (event: WorkflowJournalEvent): event is TargetVerificationEvent =>
  event._tag === "TargetVerificationIntended" ||
  event._tag === "TargetVerificationEvidenceSealed" ||
  event._tag === "TargetVerificationCorrelationContradicted"

const isRecordedTargetVerificationEntry = (entry: RecordedCassetteEntry): entry is RecordedTargetVerificationEntry =>
  entry._tag === "TargetVerificationIntended" ||
  entry._tag === "TargetVerificationEvidenceSealed" ||
  entry._tag === "TargetVerificationCorrelationContradicted"

const recordTargetVerificationEntry = (event: TargetVerificationEvent): RecordedTargetVerificationEntry => {
  switch (event._tag) {
    case "TargetVerificationIntended":
      return {
        _tag: event._tag,
        correlation: event.correlation,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction"
      }
    case "TargetVerificationEvidenceSealed":
      return {
        _tag: event._tag,
        correlation: event.correlation,
        manifest: event.manifest,
        occurrenceClassification: "NonActionOccurrence",
        terminal: event.terminal
      }
    case "TargetVerificationCorrelationContradicted":
      return {
        _tag: event._tag,
        expected: event.expected,
        occurrenceClassification: "NonActionOccurrence",
        received: event.received
      }
  }
}

type TargetPromotionEvent = Extract<WorkflowJournalEvent, { readonly _tag: `TargetPromotion${string}` }>
type RecordedTargetPromotionEntry = Extract<RecordedCassetteEntry, { readonly _tag: TargetPromotionEvent["_tag"] }>

const isTargetPromotionEvent = (event: WorkflowJournalEvent): event is TargetPromotionEvent =>
  event._tag === "TargetPromotionIntended" ||
  event._tag === "TargetPromotionAttemptIntended" ||
  event._tag === "TargetPromotionObservedSuccess" ||
  event._tag === "TargetPromotionStale" ||
  event._tag === "TargetPromotionNonConvergence"

const isRecordedTargetPromotionEntry = (entry: RecordedCassetteEntry): entry is RecordedTargetPromotionEntry =>
  entry._tag === "TargetPromotionIntended" ||
  entry._tag === "TargetPromotionAttemptIntended" ||
  entry._tag === "TargetPromotionObservedSuccess" ||
  entry._tag === "TargetPromotionStale" ||
  entry._tag === "TargetPromotionNonConvergence"

const recordTargetPromotionEntry = (event: TargetPromotionEvent): RecordedTargetPromotionEntry => {
  switch (event._tag) {
    case "TargetPromotionIntended":
      return {
        _tag: event._tag,
        correlation: event.correlation,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction"
      }
    case "TargetPromotionAttemptIntended":
      return {
        _tag: event._tag,
        attemptOrdinal: event.attemptOrdinal,
        correlation: event.correlation,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        reason: event.reason
      }
    case "TargetPromotionObservedSuccess":
      return {
        _tag: event._tag,
        basis: event.basis,
        correlation: event.correlation,
        observation: event.observation,
        occurrenceClassification: "NonActionOccurrence"
      }
    case "TargetPromotionStale":
      return {
        _tag: event._tag,
        basis: event.basis,
        correlation: event.correlation,
        observation: event.observation,
        occurrenceClassification: "NonActionOccurrence"
      }
    case "TargetPromotionNonConvergence":
      return {
        _tag: event._tag,
        attemptLimit: event.attemptLimit,
        attemptOrdinal: event.attemptOrdinal,
        correlation: event.correlation,
        lastObservation: event.lastObservation,
        occurrenceClassification: "NonActionOccurrence"
      }
  }
}

type IntegrationFinalityEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "CompletionClaimReplacementIntended"
      | "CompletionClaimReplacementAttemptIntended"
      | "CompletionClaimReplaced"
      | "CompletionClaimDeletionIntended"
      | "CompletionClaimDeletionAttemptIntended"
      | "CompletionClaimDeleted"
      | "IntegrationFinalitySettled"
  }
>
type RecordedIntegrationFinalityEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: IntegrationFinalityEvent["_tag"] }
>

const isIntegrationFinalityEvent = (event: WorkflowJournalEvent): event is IntegrationFinalityEvent =>
  event._tag === "CompletionClaimReplacementIntended" ||
  event._tag === "CompletionClaimReplacementAttemptIntended" ||
  event._tag === "CompletionClaimReplaced" ||
  event._tag === "CompletionClaimDeletionIntended" ||
  event._tag === "CompletionClaimDeletionAttemptIntended" ||
  event._tag === "CompletionClaimDeleted" ||
  event._tag === "IntegrationFinalitySettled"

const isRecordedIntegrationFinalityEntry = (entry: RecordedCassetteEntry): entry is RecordedIntegrationFinalityEntry =>
  entry._tag === "CompletionClaimReplacementIntended" ||
  entry._tag === "CompletionClaimReplacementAttemptIntended" ||
  entry._tag === "CompletionClaimReplaced" ||
  entry._tag === "CompletionClaimDeletionIntended" ||
  entry._tag === "CompletionClaimDeletionAttemptIntended" ||
  entry._tag === "CompletionClaimDeleted" ||
  entry._tag === "IntegrationFinalitySettled"

const recordIntegrationFinalityEntry = (event: IntegrationFinalityEvent): RecordedIntegrationFinalityEntry => {
  switch (event._tag) {
    case "CompletionClaimReplacementIntended":
      return {
        _tag: event._tag,
        claim: event.claim,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        operationId: event.operationId
      }
    case "CompletionClaimReplacementAttemptIntended":
      return {
        _tag: event._tag,
        attemptOrdinal: event.attemptOrdinal,
        claim: event.claim,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        operationId: event.operationId
      }
    case "CompletionClaimReplaced":
      return {
        _tag: event._tag,
        claim: event.claim,
        occurrenceClassification: "NonActionOccurrence",
        operationId: event.operationId
      }
    case "CompletionClaimDeletionIntended":
      return {
        _tag: event._tag,
        claim: event.claim,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        operationId: event.operationId,
        successObservation: event.successObservation
      }
    case "CompletionClaimDeletionAttemptIntended":
      return {
        _tag: event._tag,
        attemptOrdinal: event.attemptOrdinal,
        claim: event.claim,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        operationId: event.operationId,
        successObservation: event.successObservation
      }
    case "CompletionClaimDeleted":
      return {
        _tag: event._tag,
        claim: event.claim,
        occurrenceClassification: "NonActionOccurrence",
        operationId: event.operationId,
        successObservation: event.successObservation
      }
    case "IntegrationFinalitySettled":
      return {
        _tag: event._tag,
        claim: event.claim,
        deletionOperationId: event.deletionOperationId,
        occurrenceClassification: "NonActionOccurrence",
        replacementOperationId: event.replacementOperationId,
        successObservation: event.successObservation
      }
  }
}

type IntegrationPreparationEvent =
  | CandidateConstructionEvent
  | TargetVerificationEvent
  | TargetPromotionEvent
  | IntegrationFinalityEvent
type RecordedIntegrationPreparationEntry =
  | RecordedCandidateConstructionEntry
  | RecordedTargetVerificationEntry
  | RecordedTargetPromotionEntry
  | RecordedIntegrationFinalityEntry

const isIntegrationPreparationEvent = (event: WorkflowJournalEvent): event is IntegrationPreparationEvent =>
  isCandidateConstructionEvent(event) ||
  isTargetVerificationEvent(event) ||
  isTargetPromotionEvent(event) ||
  isIntegrationFinalityEvent(event)

const recordIntegrationPreparationEntry = (event: IntegrationPreparationEvent): RecordedIntegrationPreparationEntry => {
  if (isCandidateConstructionEvent(event)) return recordCandidateConstructionEntry(event)
  if (isTargetVerificationEvent(event)) return recordTargetVerificationEntry(event)
  if (isTargetPromotionEvent(event)) return recordTargetPromotionEntry(event)
  return recordIntegrationFinalityEntry(event)
}

const isRecordedIntegrationPreparationEntry = (
  entry: RecordedCassetteEntry
): entry is RecordedIntegrationPreparationEntry =>
  isRecordedCandidateConstructionEntry(entry) ||
  isRecordedTargetVerificationEntry(entry) ||
  isRecordedTargetPromotionEntry(entry) ||
  isRecordedIntegrationFinalityEntry(entry)

const recordTaskBoundaryEntry = (
  event: Exclude<
    WorkflowJournalEvent,
    {
      readonly _tag:
        | "AttemptChoiceApplied"
        | "AttemptImplementationAbandoned"
        | "AttemptStoppageIntended"
        | "ControlDirectionApplied"
        | "TaskClaimReacquisitionDirected"
        | "GitReadIntentRecorded"
        | "PlannedAttemptWorktreeObserved"
        | "TargetLineageObserved"
        | "PlannedAttemptExecutorCommandIntended"
        | "PlannedAttemptExecutorCommandProjectionObserved"
        | "PlannedAttemptExecutorCommandResponseContradicted"
        | "PlannedAttemptExecutorStateObserved"
        | "PlannedAttemptExecutorWorkReported"
        | "PlannedAttemptExecutorWorkResponsibilityBegan"
        | "IntegrationCandidateAgentReported"
        | "IntegrationCandidateConstructed"
        | "IntegrationCandidateConstructionIntended"
        | "IntegrationCandidateGitObserved"
        | "IntegrationCandidateGitValidationFailed"
        | "IntegrationCandidateCorrectionLimitReached"
        | "IntegrationCandidateContinuationLimitReached"
        | "TargetVerificationIntended"
        | "TargetVerificationEvidenceSealed"
        | "TargetVerificationCorrelationContradicted"
        | `TargetPromotion${string}`
        | "CompletionClaimReplacementIntended"
        | "CompletionClaimReplacementAttemptIntended"
        | "CompletionClaimReplaced"
        | "CompletionClaimDeletionIntended"
        | "CompletionClaimDeletionAttemptIntended"
        | "CompletionClaimDeleted"
        | "IntegrationFinalitySettled"
        | "TaskTrackerFactsObserved"
        | "TaskTrackerReadIntentRecorded"
        | "PlannedAttemptContinuationAuthorized"
        | "TaskWorkCapacityChanged"
        | "WorkflowRunBegan"
        | "WorkflowRunTerminated"
        | "StoppedAttemptClaimNoReleaseObserved"
    }
  >
): RecordedCassetteEntry => {
  if (isRecordedClaimReleaseEntry(event)) return recordClaimReleaseEntry(event)
  if (isRecordedIntegrationEntry(event)) return recordIntegrationEntry(event)
  if (isRecordedWorktreeEntry(event)) return recordWorktreeEntry(event)
  switch (event._tag) {
    case "TaskAttemptPlanned":
      return { _tag: "TaskAttemptPlanned", operation: event.operation }
    case "TaskClaimAcquired":
      return { _tag: "TaskClaimAcquired", claim: event.claim }
    case "TaskClaimAcquisitionIntended":
      return { _tag: "TaskClaimAcquisitionIntended", operation: event.operation }
    case "TaskClaimAcquisitionRejected":
      return {
        _tag: "TaskClaimAcquisitionRejected",
        observed: event.observed,
        operationId: event.operationId,
        reason: event.reason
      }
  }
}

type OperatorDirectionEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "AttemptChoiceApplied" | "ControlDirectionApplied" | "TaskClaimReacquisitionDirected" }
>

const isOperatorDirectionEvent = (event: WorkflowJournalEvent): event is OperatorDirectionEvent =>
  event._tag === "AttemptChoiceApplied" ||
  event._tag === "ControlDirectionApplied" ||
  event._tag === "TaskClaimReacquisitionDirected"

const recordedOperatorDirectionEntryFor = (event: OperatorDirectionEvent): RecordedCassetteEntry => {
  if (event._tag === "AttemptChoiceApplied") {
    return {
      _tag: "AttemptChoiceApplied",
      choice: event.choice,
      initiatedBy: event.initiatedBy,
      occurrenceClassification: event.occurrenceClassification,
      requestId: event.requestId,
      subject: event.subject
    }
  }
  if (event._tag === "ControlDirectionApplied") {
    return {
      _tag: "ControlDirectionApplied",
      direction: event.direction,
      initiatedBy: event.initiatedBy,
      occurrenceClassification: event.occurrenceClassification,
      ordinal: event.ordinal,
      subject: event.subject
    }
  }
  return {
    _tag: "TaskClaimReacquisitionDirected",
    initiatedBy: event.initiatedBy,
    occurrenceClassification: event.occurrenceClassification,
    requestId: event.requestId,
    taskId: event.subject.taskId
  }
}

type AttemptStopEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag: "AttemptImplementationAbandoned" | "AttemptStoppageIntended" | "StoppedAttemptClaimNoReleaseObserved"
  }
>

const isAttemptStopEvent = (event: WorkflowJournalEvent): event is AttemptStopEvent =>
  event._tag === "AttemptImplementationAbandoned" ||
  event._tag === "AttemptStoppageIntended" ||
  event._tag === "StoppedAttemptClaimNoReleaseObserved"

const recordedAttemptStopEntryFor = (event: AttemptStopEvent): RecordedCassetteEntry => {
  switch (event._tag) {
    case "AttemptStoppageIntended":
      return {
        _tag: event._tag,
        initiatedBy: event.initiatedBy,
        occurrenceClassification: event.occurrenceClassification,
        requestId: event.requestId,
        subject: event.subject
      }
    case "AttemptImplementationAbandoned":
      return {
        _tag: event._tag,
        expectedClaim: event.expectedClaim,
        initiatedBy: event.initiatedBy,
        occurrenceClassification: event.occurrenceClassification,
        proof: event.proof,
        requestId: event.requestId,
        subject: event.subject
      }
    case "StoppedAttemptClaimNoReleaseObserved":
      return {
        _tag: event._tag,
        expectedClaim: event.expectedClaim,
        observation: event.observation,
        observationOperationId: event.observationOperationId,
        occurrenceClassification: event.occurrenceClassification,
        requestId: event.requestId,
        subject: event.subject
      }
  }
}

// eslint-disable-next-line complexity -- The closed journal vocabulary has one total projection into recorded cassette entries.
const recordedEntryFor = (event: WorkflowJournalEvent): RecordedCassetteEntry => {
  if (isJournalRunEntry(event)) return recordedRunEntryFor(event)
  if (isOperatorDirectionEvent(event)) return recordedOperatorDirectionEntryFor(event)
  if (isAttemptStopEvent(event)) return recordedAttemptStopEntryFor(event)
  if (isIntegrationPreparationEvent(event)) return recordIntegrationPreparationEntry(event)
  if (
    event._tag === "GitReadIntentRecorded" ||
    event._tag === "PlannedAttemptWorktreeObserved" ||
    event._tag === "TargetLineageObserved"
  ) {
    return recordGitObservationEntry(event)
  }
  if (event._tag === "TaskTrackerReadIntentRecorded" || event._tag === "TaskTrackerFactsObserved") {
    return recordTrackerEntry(event)
  }
  if (
    event._tag === "PlannedAttemptExecutorCommandIntended" ||
    event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
    event._tag === "PlannedAttemptExecutorCommandResponseContradicted" ||
    event._tag === "PlannedAttemptExecutorStateObserved" ||
    event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ||
    event._tag === "PlannedAttemptExecutorWorkReported"
  ) {
    return recordExecutorEntry(event)
  }
  if (event._tag === "PlannedAttemptContinuationAuthorized") {
    return {
      _tag: "PlannedAttemptContinuationAuthorized",
      plannedAttempt: event.plannedAttempt,
      witness: event.witness
    }
  }
  return recordTaskBoundaryEntry(event)
}

export class EmptyJournalCannotBeRecorded extends Schema.TaggedError<EmptyJournalCannotBeRecorded>()(
  "EmptyJournalCannotBeRecorded",
  {}
) {}

/** Projects a valid one-run journal without exposing a partial cassette. */
export const projectRecordedCassette = Effect.fn("ScenarioCassette.projectRecorded")(function* (
  records: ReadonlyArray<JournalRecord>
) {
  const runId = records[0]?.runId
  if (runId === undefined) return yield* new EmptyJournalCannotBeRecorded({})
  const history = reduceWorkflowJournalHistory(runId, records)
  if (history._tag === "InvalidWorkflowJournalHistory") return yield* Effect.fail(history)
  return RecordedCassette.make({
    entries: records.map(({ event }) => recordedEntryFor(event)),
    runId,
    schemaVersion: recordedCassetteVersion
  })
})

const eventForTaskBoundaryEntry = (
  entry: Extract<
    RecordedCassetteEntry,
    {
      readonly _tag:
        | "TaskAttemptPlanned"
        | "TaskClaimAcquired"
        | "TaskClaimAcquisitionIntended"
        | "TaskClaimAcquisitionRejected"
        | "TaskClaimReleaseIntended"
        | "TaskClaimReleased"
        | "IntegrationResponsibilityBegan"
        | "IntegrationStarted"
        | "TaskWorktreeReady"
        | "TaskWorktreeReconciliationIntended"
    }
  >,
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number
): WorkflowJournalEvent => {
  if (isRecordedClaimReleaseEntry(entry)) return eventForClaimReleaseEntry(entry)
  if (isRecordedIntegrationEntry(entry)) return eventForIntegrationEntry(entry, entries, index)
  if (isRecordedWorktreeEntry(entry)) return eventForWorktreeEntry(entry)
  switch (entry._tag) {
    case "TaskAttemptPlanned":
      return TaskAttemptPlannedEvent.make({ operation: entry.operation, version: workflowJournalEventVersion })
    case "TaskClaimAcquired":
      return TaskClaimAcquiredEvent.make({ claim: entry.claim, version: workflowJournalEventVersion })
    case "TaskClaimAcquisitionIntended":
      return TaskClaimAcquisitionIntendedEvent.make({
        operation: entry.operation,
        version: workflowJournalEventVersion
      })
    case "TaskClaimAcquisitionRejected":
      return TaskClaimAcquisitionRejectedEvent.make({
        observed: entry.observed,
        operationId: entry.operationId,
        reason: entry.reason,
        version: workflowJournalEventVersion
      })
  }
}

type RecordedExecutorEntry = Extract<
  RecordedCassetteEntry,
  {
    readonly _tag:
      | "PlannedAttemptExecutorCommandIntended"
      | "PlannedAttemptExecutorCommandProjectionObserved"
      | "PlannedAttemptExecutorCommandResponseContradicted"
      | "PlannedAttemptExecutorStateObserved"
      | "PlannedAttemptExecutorWorkReported"
      | "PlannedAttemptExecutorWorkResponsibilityBegan"
  }
>
const isRecordedExecutorEntry = (entry: RecordedCassetteEntry): entry is RecordedExecutorEntry =>
  new Set([
    "PlannedAttemptExecutorCommandIntended",
    "PlannedAttemptExecutorCommandProjectionObserved",
    "PlannedAttemptExecutorCommandResponseContradicted",
    "PlannedAttemptExecutorStateObserved",
    "PlannedAttemptExecutorWorkReported",
    "PlannedAttemptExecutorWorkResponsibilityBegan"
  ]).has(entry._tag)

const eventForExecutorEntry = (entry: RecordedExecutorEntry): WorkflowJournalEvent => {
  switch (entry._tag) {
    case "PlannedAttemptExecutorWorkReported":
      return PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: entry.ordinal,
        report: entry.report,
        version: workflowJournalEventVersion
      })
    case "PlannedAttemptExecutorWorkResponsibilityBegan":
      return PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: entry.plannedAttempt,
        version: workflowJournalEventVersion
      })
    case "PlannedAttemptExecutorCommandIntended":
      return PlannedAttemptExecutorCommandIntendedEvent.make({
        command: entry.command,
        initiatedBy: entry.initiatedBy,
        occurrenceClassification: entry.occurrenceClassification,
        ordinal: entry.ordinal,
        plannedAttempt: entry.plannedAttempt,
        version: workflowJournalEventVersion
      })
    case "PlannedAttemptExecutorCommandProjectionObserved":
      return PlannedAttemptExecutorCommandProjectionObservedEvent.make({
        commandOrdinal: entry.commandOrdinal,
        observation: entry.observation,
        occurrenceClassification: entry.occurrenceClassification,
        plannedAttempt: entry.plannedAttempt,
        projectionOrdinal: entry.projectionOrdinal,
        version: workflowJournalEventVersion
      })
    case "PlannedAttemptExecutorCommandResponseContradicted":
      return PlannedAttemptExecutorCommandResponseContradictedEvent.make({
        commandOrdinal: entry.commandOrdinal,
        observed: entry.observed,
        occurrenceClassification: entry.occurrenceClassification,
        plannedAttempt: entry.plannedAttempt,
        version: workflowJournalEventVersion
      })
    case "PlannedAttemptExecutorStateObserved":
      return PlannedAttemptExecutorStateObservedEvent.make({
        observation: entry.observation,
        occurrenceClassification: entry.occurrenceClassification,
        ordinal: entry.ordinal,
        plannedAttempt: entry.plannedAttempt,
        version: workflowJournalEventVersion
      })
  }
}

type RecordedTrackerEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "TaskTrackerFactsObserved" | "TaskTrackerReadInitiated" }
>
const isRecordedTrackerEntry = (entry: RecordedCassetteEntry): entry is RecordedTrackerEntry =>
  new Set(["TaskTrackerFactsObserved", "TaskTrackerReadInitiated"]).has(entry._tag)

const eventForTrackerEntry = (entry: RecordedTrackerEntry): WorkflowJournalEvent =>
  entry._tag === "TaskTrackerFactsObserved"
    ? taskTrackerFactsObservedEvent(entry.originatingActionOperationId, entry.evidence)
    : taskTrackerReadIntent(entry.operation)

const eventForIntegrationEntry = (
  entry: RecordedIntegrationEntry,
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number
): WorkflowJournalEvent => {
  if (entry._tag === "IntegrationResponsibilityBegan") {
    return IntegrationResponsibilityBeganEvent.make({
      acceptedResult: entry.acceptedResult,
      integrationTarget: entry.integrationTarget,
      plannedAttempt: entry.plannedAttempt,
      version: workflowJournalEventVersion
    })
  }
  const beganIndex = entries.findLastIndex(
    (candidate, candidateIndex) =>
      candidateIndex < index &&
      candidate._tag === "IntegrationResponsibilityBegan" &&
      candidate.plannedAttempt.attemptId === entry.plannedAttempt.attemptId &&
      candidate.acceptedResult.commit === entry.acceptedResult.commit &&
      candidate.integrationTarget.repository === entry.integrationTarget.repository &&
      candidate.integrationTarget.ref === entry.integrationTarget.ref
  )
  return IntegrationStartedEvent.make({
    acceptedResult: entry.acceptedResult,
    integrationTarget: entry.integrationTarget,
    plannedAttempt: entry.plannedAttempt,
    responsibilityBeganAt: JournalPosition.make((beganIndex < 0 ? index : beganIndex) + 1),
    version: workflowJournalEventVersion
  })
}

type RecordedOperatorDirectionEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "AttemptChoiceApplied" | "ControlDirectionApplied" | "TaskClaimReacquisitionDirected" }
>

const isRecordedOperatorDirectionEntry = (entry: RecordedCassetteEntry): entry is RecordedOperatorDirectionEntry =>
  entry._tag === "AttemptChoiceApplied" ||
  entry._tag === "ControlDirectionApplied" ||
  entry._tag === "TaskClaimReacquisitionDirected"

const eventForRecordedOperatorDirectionEntry = (
  entry: RecordedOperatorDirectionEntry,
  runId: RecordedCassetteType["runId"]
): WorkflowJournalEvent => {
  if (entry._tag === "AttemptChoiceApplied") {
    return AttemptChoiceAppliedEvent.make({
      choice: entry.choice,
      initiatedBy: entry.initiatedBy,
      occurrenceClassification: entry.occurrenceClassification,
      requestId: entry.requestId,
      subject: entry.subject,
      version: workflowJournalEventVersion
    })
  }
  if (entry._tag === "ControlDirectionApplied") {
    return ControlDirectionAppliedEvent.make({ ...entry, version: workflowJournalEventVersion })
  }
  return TaskClaimReacquisitionDirectedEvent.make({
    initiatedBy: entry.initiatedBy,
    occurrenceClassification: entry.occurrenceClassification,
    requestId: entry.requestId,
    subject: { runId, taskId: entry.taskId },
    version: workflowJournalEventVersion
  })
}

type RecordedAttemptStopEntry = Extract<
  RecordedCassetteEntry,
  {
    readonly _tag: "AttemptImplementationAbandoned" | "AttemptStoppageIntended" | "StoppedAttemptClaimNoReleaseObserved"
  }
>

const isRecordedAttemptStopEntry = (entry: RecordedCassetteEntry): entry is RecordedAttemptStopEntry =>
  entry._tag === "AttemptImplementationAbandoned" ||
  entry._tag === "AttemptStoppageIntended" ||
  entry._tag === "StoppedAttemptClaimNoReleaseObserved"

const eventForRecordedAttemptStopEntry = (entry: RecordedAttemptStopEntry): WorkflowJournalEvent => {
  switch (entry._tag) {
    case "AttemptStoppageIntended":
      return AttemptStoppageIntendedEvent.make({ ...entry, version: workflowJournalEventVersion })
    case "AttemptImplementationAbandoned":
      return AttemptImplementationAbandonedEvent.make({ ...entry, version: workflowJournalEventVersion })
    case "StoppedAttemptClaimNoReleaseObserved":
      return StoppedAttemptClaimNoReleaseObservedEvent.make({ ...entry, version: workflowJournalEventVersion })
  }
}

const priorEntryPosition = (
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number,
  matches: (entry: RecordedCassetteEntry) => boolean
): JournalPosition => {
  const priorIndex = entries.findLastIndex((entry, candidateIndex) => candidateIndex < index && matches(entry))
  return JournalPosition.make((priorIndex < 0 ? index : priorIndex) + 1)
}

const eventForCandidateConstructionEntry = (
  entry: RecordedCandidateConstructionEntry,
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number
): WorkflowJournalEvent => {
  switch (entry._tag) {
    case "IntegrationCandidateConstructionIntended":
      return IntegrationCandidateConstructionIntendedEvent.make({
        correlation: entry.correlation,
        correctionLimit: entry.correctionLimit,
        continuationLimit: entry.continuationLimit,
        plannedAttempt: entry.plannedAttempt,
        responsibilityBeganAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationResponsibilityBegan" &&
            candidate.plannedAttempt.attemptId === entry.correlation.attemptId
        ),
        startedAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationStarted" &&
            candidate.plannedAttempt.attemptId === entry.correlation.attemptId
        ),
        version: workflowJournalEventVersion
      })
    case "IntegrationCandidateAgentReported":
      return IntegrationCandidateAgentReportedEvent.make({
        expectedCorrelation: entry.expectedCorrelation,
        ordinal: entry.ordinal,
        report: entry.report,
        version: workflowJournalEventVersion
      })
    case "IntegrationCandidateGitObserved":
      return IntegrationCandidateGitObservedEvent.make({
        candidateCommit: entry.candidateCommit,
        correlation: entry.correlation,
        observation: entry.observation,
        submissionAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationCandidateAgentReported" &&
            candidate.report._tag === "Submitted" &&
            candidate.report.candidateCommit === entry.candidateCommit &&
            candidate.report.correlation.candidateId === entry.correlation.candidateId
        ),
        version: workflowJournalEventVersion
      })
    case "IntegrationCandidateConstructed":
      return IntegrationCandidateConstructedEvent.make({
        candidateCommit: entry.candidateCommit,
        correlation: entry.correlation,
        gitObservationAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationCandidateGitObserved" &&
            candidate.candidateCommit === entry.candidateCommit &&
            candidate.correlation.candidateId === entry.correlation.candidateId
        ),
        version: workflowJournalEventVersion
      })
    case "IntegrationCandidateGitValidationFailed":
      return IntegrationCandidateGitValidationFailedEvent.make({
        attemptOrdinal: entry.attemptOrdinal,
        candidateCommit: entry.candidateCommit,
        correlation: entry.correlation,
        detail: entry.detail,
        submissionAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationCandidateAgentReported" &&
            candidate.report._tag === "Submitted" &&
            candidate.report.candidateCommit === entry.candidateCommit &&
            candidate.report.correlation.candidateId === entry.correlation.candidateId
        ),
        version: workflowJournalEventVersion
      })
    case "IntegrationCandidateCorrectionLimitReached":
      return IntegrationCandidateCorrectionLimitReachedEvent.make({
        correctionCount: entry.correctionCount,
        correctionLimit: entry.correctionLimit,
        correlation: entry.correlation,
        invalidObservationAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationCandidateGitObserved" &&
            candidate.correlation.candidateId === entry.correlation.candidateId
        ),
        version: workflowJournalEventVersion
      })
    case "IntegrationCandidateContinuationLimitReached":
      return IntegrationCandidateContinuationLimitReachedEvent.make({
        continuationCount: entry.continuationCount,
        continuationLimit: entry.continuationLimit,
        correlation: entry.correlation,
        lastReportAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationCandidateAgentReported" &&
            candidate.report._tag !== "Submitted" &&
            candidate.report.correlation.candidateId === entry.correlation.candidateId
        ),
        version: workflowJournalEventVersion
      })
  }
}

const eventForTargetVerificationEntry = (entry: RecordedTargetVerificationEntry): WorkflowJournalEvent => {
  switch (entry._tag) {
    case "TargetVerificationIntended":
      return TargetVerificationIntendedEvent.make({
        correlation: entry.correlation,
        version: workflowJournalEventVersion
      })
    case "TargetVerificationEvidenceSealed":
      return TargetVerificationEvidenceSealedEvent.make({
        correlation: entry.correlation,
        manifest: entry.manifest,
        terminal: entry.terminal,
        version: workflowJournalEventVersion
      })
    case "TargetVerificationCorrelationContradicted":
      return TargetVerificationCorrelationContradictedEvent.make({
        expected: entry.expected,
        received: entry.received,
        version: workflowJournalEventVersion
      })
  }
}

const eventForTargetPromotionEntry = (entry: RecordedTargetPromotionEntry): WorkflowJournalEvent => {
  const common = { correlation: entry.correlation, version: workflowJournalEventVersion }
  switch (entry._tag) {
    case "TargetPromotionIntended":
      return TargetPromotionIntendedEvent.make(common)
    case "TargetPromotionAttemptIntended":
      return TargetPromotionAttemptIntendedEvent.make({
        ...common,
        attemptOrdinal: entry.attemptOrdinal,
        reason: entry.reason
      })
    case "TargetPromotionObservedSuccess":
      return TargetPromotionObservedSuccessEvent.make({ ...common, basis: entry.basis, observation: entry.observation })
    case "TargetPromotionStale":
      return TargetPromotionStaleEvent.make({ ...common, basis: entry.basis, observation: entry.observation })
    case "TargetPromotionNonConvergence":
      return TargetPromotionNonConvergenceEvent.make({
        ...common,
        attemptLimit: entry.attemptLimit,
        attemptOrdinal: entry.attemptOrdinal,
        lastObservation: entry.lastObservation
      })
  }
}

const eventForIntegrationFinalityEntry = (entry: RecordedIntegrationFinalityEntry): WorkflowJournalEvent => {
  switch (entry._tag) {
    case "CompletionClaimReplacementIntended":
      return CompletionClaimReplacementIntendedEvent.make({
        claim: entry.claim,
        operationId: entry.operationId,
        version: workflowJournalEventVersion
      })
    case "CompletionClaimReplacementAttemptIntended":
      return CompletionClaimReplacementAttemptIntendedEvent.make({
        attemptOrdinal: entry.attemptOrdinal,
        claim: entry.claim,
        operationId: entry.operationId,
        version: workflowJournalEventVersion
      })
    case "CompletionClaimReplaced":
      return CompletionClaimReplacedEvent.make({
        claim: entry.claim,
        operationId: entry.operationId,
        version: workflowJournalEventVersion
      })
    case "CompletionClaimDeletionIntended":
      return CompletionClaimDeletionIntendedEvent.make({
        claim: entry.claim,
        operationId: entry.operationId,
        successObservation: entry.successObservation,
        version: workflowJournalEventVersion
      })
    case "CompletionClaimDeletionAttemptIntended":
      return CompletionClaimDeletionAttemptIntendedEvent.make({
        attemptOrdinal: entry.attemptOrdinal,
        claim: entry.claim,
        operationId: entry.operationId,
        successObservation: entry.successObservation,
        version: workflowJournalEventVersion
      })
    case "CompletionClaimDeleted":
      return CompletionClaimDeletedEvent.make({
        claim: entry.claim,
        operationId: entry.operationId,
        successObservation: entry.successObservation,
        version: workflowJournalEventVersion
      })
    case "IntegrationFinalitySettled":
      return IntegrationFinalitySettledEvent.make({
        claim: entry.claim,
        deletionOperationId: entry.deletionOperationId,
        replacementOperationId: entry.replacementOperationId,
        successObservation: entry.successObservation,
        version: workflowJournalEventVersion
      })
  }
}

const eventForIntegrationPreparationEntry = (
  entry: RecordedIntegrationPreparationEntry,
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number
): WorkflowJournalEvent => {
  if (isRecordedCandidateConstructionEntry(entry)) return eventForCandidateConstructionEntry(entry, entries, index)
  if (isRecordedTargetVerificationEntry(entry)) return eventForTargetVerificationEntry(entry)
  if (isRecordedTargetPromotionEntry(entry)) return eventForTargetPromotionEntry(entry)
  return eventForIntegrationFinalityEntry(entry)
}

type RecordedContinuationAuthorizationEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "PlannedAttemptContinuationAuthorized" }
>

const eventForContinuationAuthorizationEntry = (entry: RecordedContinuationAuthorizationEntry): WorkflowJournalEvent =>
  PlannedAttemptContinuationAuthorizedEvent.make({
    plannedAttempt: entry.plannedAttempt,
    version: workflowJournalEventVersion,
    witness: entry.witness
  })

const eventForOtherRecordedEntry = (
  entry: Exclude<RecordedCassetteEntry, RecordedContinuationAuthorizationEntry>,
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number,
  runId: RecordedCassetteType["runId"]
): WorkflowJournalEvent => {
  if (isRecordedRunEntry(entry)) return eventForRunEntry(entry)
  if (isRecordedOperatorDirectionEntry(entry)) return eventForRecordedOperatorDirectionEntry(entry, runId)
  if (isRecordedAttemptStopEntry(entry)) return eventForRecordedAttemptStopEntry(entry)
  if (isRecordedIntegrationPreparationEntry(entry)) return eventForIntegrationPreparationEntry(entry, entries, index)
  if (isRecordedGitObservationEntry(entry)) return eventForGitObservationEntry(entry)
  if (isRecordedExecutorEntry(entry)) return eventForExecutorEntry(entry)
  if (isRecordedTrackerEntry(entry)) return eventForTrackerEntry(entry)
  return eventForTaskBoundaryEntry(entry, entries, index)
}

const eventForRecordedEntry = (
  entry: RecordedCassetteEntry,
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number,
  runId: RecordedCassetteType["runId"]
): WorkflowJournalEvent =>
  entry._tag === "PlannedAttemptContinuationAuthorized"
    ? eventForContinuationAuthorizationEntry(entry)
    : eventForOtherRecordedEntry(entry, entries, index, runId)

const recordsFor = (cassette: RecordedCassetteType): ReadonlyArray<JournalRecord> =>
  cassette.entries.map((entry, index) => {
    const event = eventForRecordedEntry(entry, cassette.entries, index, cassette.runId)
    return {
      event,
      key: describeJournalEvent(event).expectedKey,
      position: JournalPosition.make(index + 1),
      runId: cassette.runId
    }
  })

/** Folds recorded meanings as workflow history; it never drives boundary implementations. */
export const foldRecordedCassette = (cassette: RecordedCassetteType) =>
  reduceWorkflowJournalHistory(cassette.runId, recordsFor(cassette))

const semanticWorkflowHistory = (history: ReturnType<typeof reduceWorkflowJournalHistory>): unknown =>
  history._tag === "InvalidWorkflowJournalHistory"
    ? { _tag: history._tag, issueKinds: history.issues.map(({ _tag }) => _tag) }
    : history.runState.workflowHistory.records.map(({ event }) => recordedEntryFor(event))

export interface RecordedCassetteCheckpoint {
  readonly appliedOccurrencePositionEquivalent: boolean
  readonly checkpoint: number
  readonly operationalStateEquivalent: boolean
  readonly pureSelectionEquivalent: boolean
  readonly workflowHistoryEquivalent: boolean
}

const checkpointComparison = (
  checkpoint: number,
  expected: ReturnType<typeof reduceWorkflowJournalHistory>,
  actual: ReturnType<typeof reduceWorkflowJournalHistory>
): RecordedCassetteCheckpoint => ({
  appliedOccurrencePositionEquivalent: appliedOccurrencePosition(expected) === appliedOccurrencePosition(actual),
  checkpoint,
  pureSelectionEquivalent:
    expected._tag === "ValidWorkflowJournalHistory" &&
    actual._tag === "ValidWorkflowJournalHistory" &&
    semanticJson(expected.recoveryFrontier) === semanticJson(actual.recoveryFrontier),
  operationalStateEquivalent: semanticJson(semanticState(expected)) === semanticJson(semanticState(actual)),
  workflowHistoryEquivalent:
    semanticJson(semanticWorkflowHistory(expected)) === semanticJson(semanticWorkflowHistory(actual))
})

/** Compares source and recorded folds after every corresponding occurrence. */
export const verifyRecordedCassetteRoundTrip = (
  records: ReadonlyArray<JournalRecord>,
  cassette: RecordedCassetteType
): ReadonlyArray<RecordedCassetteCheckpoint> =>
  records.map((_record, index) => {
    const checkpoint = index + 1
    return checkpointComparison(
      checkpoint,
      reduceWorkflowJournalHistory(cassette.runId, records.slice(0, checkpoint)),
      foldRecordedCassette(RecordedCassette.make({ ...cassette, entries: cassette.entries.slice(0, checkpoint) }))
    )
  })

/** Applies one declared alpha-renaming before the ordinary prefix comparison. */
export const verifyRecordedCassetteRoundTripWithRenaming = Effect.fn(
  "ScenarioCassette.verifyRecordedRoundTripWithRenaming"
)(function* (
  records: ReadonlyArray<JournalRecord>,
  cassette: RecordedCassetteType,
  recordedToJournal: CassetteIdentityRenaming
) {
  return verifyRecordedCassetteRoundTrip(records, yield* renameRecordedCassette(cassette, recordedToJournal))
})

/** Compares two recorded histories occurrence by occurrence with the same selector. */
export const compareRecordedCassetteCheckpoints = (
  expected: RecordedCassetteType,
  actual: RecordedCassetteType
): ReadonlyArray<RecordedCassetteCheckpoint> =>
  expected.entries.map((_entry, index) => {
    const checkpoint = index + 1
    const prefix = (cassette: RecordedCassetteType) =>
      foldRecordedCassette(RecordedCassette.make({ ...cassette, entries: cassette.entries.slice(0, checkpoint) }))
    return checkpointComparison(checkpoint, prefix(expected), prefix(actual))
  })

const lyricForExecutorEntry = (entry: RecordedExecutorEntry): string => {
  switch (entry._tag) {
    case "PlannedAttemptExecutorWorkReported":
      return `The executor returned ${entry.report._tag} for attempt ${entry.report.correlation.attemptId}.`
    case "PlannedAttemptExecutorWorkResponsibilityBegan":
      return `Dalph coordinator began executor-work responsibility for task ${entry.plannedAttempt.taskId}, attempt ${entry.plannedAttempt.attemptId}.`
    case "PlannedAttemptExecutorCommandIntended":
      return `Dalph coordinator intended executor command ${entry.command} for attempt ${entry.plannedAttempt.attemptId}.`
    case "PlannedAttemptExecutorCommandProjectionObserved":
      return `Dalph observed ${entry.observation._tag} while reconciling executor command ${entry.commandOrdinal} for attempt ${entry.plannedAttempt.attemptId}.`
    case "PlannedAttemptExecutorCommandResponseContradicted":
      return `The executor returned a response for attempt ${entry.observed.correlation.attemptId} to command ${entry.commandOrdinal} for expected attempt ${entry.plannedAttempt.attemptId}; Dalph kept the command unresolved.`
    case "PlannedAttemptExecutorStateObserved":
      return `Dalph observed ${entry.observation._tag} from a read-only executor projection for attempt ${entry.plannedAttempt.attemptId}.`
  }
}

const lyricForTrackerEntry = (entry: RecordedTrackerEntry): string =>
  entry._tag === "TaskTrackerFactsObserved"
    ? `Dalph observed ${entry.evidence._tag} through tracker read ${entry.originatingActionOperationId}.`
    : `Dalph coordinator initiated ${entry.operation._tag} for the task tracker.`

// eslint-disable-next-line complexity -- Every closed candidate occurrence receives one concrete actor-first lyric.
const lyricForCandidateConstructionEntry = (entry: RecordedCandidateConstructionEntry): string => {
  switch (entry._tag) {
    case "IntegrationCandidateConstructionIntended":
      return `Dalph coordinator began candidate ${entry.correlation.candidateId} in session ${entry.correlation.integrationSessionId}.`
    case "IntegrationCandidateAgentReported":
      return integrationCandidateCorrelationEquals(entry.expectedCorrelation, entry.report.correlation)
        ? `The integration agent reported ${entry.report._tag} for session ${entry.report.correlation.integrationSessionId}.`
        : `The integration agent returned an infrastructure correlation contradiction for expected session ${entry.expectedCorrelation.integrationSessionId}; Dalph preserved the involved candidate resources.`
    case "IntegrationCandidateGitObserved":
      return `Git reported ${entry.observation._tag} for submitted commit ${entry.candidateCommit}.`
    case "IntegrationCandidateConstructed":
      return `Git proved candidate ${entry.candidateCommit} has the exact ordered parents selected for the session.`
    case "IntegrationCandidateGitValidationFailed":
      return `Git could not validate submitted commit ${entry.candidateCommit}: ${entry.detail}`
    case "IntegrationCandidateCorrectionLimitReached":
      return `Candidate session ${entry.correlation.integrationSessionId} stopped after ${entry.correctionCount} correction attempts.`
    case "IntegrationCandidateContinuationLimitReached":
      return `Candidate session ${entry.correlation.integrationSessionId} stopped after ${entry.continuationCount} automatic agent continuations.`
  }
}

const lyricForTargetVerificationEntry = (entry: RecordedTargetVerificationEntry): string => {
  switch (entry._tag) {
    case "TargetVerificationIntended":
      return `Dalph coordinator fixed verification request ${entry.correlation.requestId} to plan ${entry.correlation.planId}.`
    case "TargetVerificationEvidenceSealed":
      return `The target repository's public verification wrapper returned ${entry.terminal} for candidate ${entry.correlation.candidateCommit}.`
    case "TargetVerificationCorrelationContradicted":
      return `Dalph stopped verification request ${entry.expected.requestId} after the wrapper returned a foreign correlation.`
  }
}

const lyricForTargetPromotionEntry = (entry: RecordedTargetPromotionEntry): string => {
  switch (entry._tag) {
    case "TargetPromotionIntended":
      return `Dalph coordinator fixed exact promotion ${entry.correlation.expectedTargetHead} -> ${entry.correlation.candidateCommit}.`
    case "TargetPromotionAttemptIntended":
      return `Dalph coordinator sent exact compare-and-set attempt ${entry.attemptOrdinal} for candidate ${entry.correlation.candidateCommit}.`
    case "TargetPromotionObservedSuccess":
      return `Git established candidate ${entry.correlation.candidateCommit} by ${entry.observation._tag}.`
    case "TargetPromotionStale":
      return `Git preserved a different target head while candidate ${entry.correlation.candidateCommit} became stale.`
    case "TargetPromotionNonConvergence":
      return `Dalph stopped candidate ${entry.correlation.candidateCommit} after ${entry.attemptOrdinal} ambiguous compare-and-set attempts.`
  }
}

const lyricForIntegrationFinalityEntry = (entry: RecordedIntegrationFinalityEntry): string => {
  switch (entry._tag) {
    case "CompletionClaimReplacementIntended":
      return `Dalph coordinator intended to replace the exact active claim for task ${entry.claim.plannedAttempt.taskId}.`
    case "CompletionClaimReplacementAttemptIntended":
      return `Dalph coordinator sent completion-claim replacement attempt ${entry.attemptOrdinal} for task ${entry.claim.plannedAttempt.taskId}.`
    case "CompletionClaimReplaced":
      return `The task tracker proved the promotion-bound completion claim current for task ${entry.claim.plannedAttempt.taskId}.`
    case "CompletionClaimDeletionIntended":
      return `Dalph coordinator intended to delete the exact completion claim for task ${entry.claim.plannedAttempt.taskId} after fresh success.`
    case "CompletionClaimDeletionAttemptIntended":
      return `Dalph coordinator sent completion-claim deletion attempt ${entry.attemptOrdinal} for task ${entry.claim.plannedAttempt.taskId}.`
    case "CompletionClaimDeleted":
      return `The task tracker proved the exact completion claim absent for successful task ${entry.claim.plannedAttempt.taskId}.`
    case "IntegrationFinalitySettled":
      return `Dalph settled integration finality for promoted task ${entry.claim.plannedAttempt.taskId}.`
  }
}

const lyricForIntegrationPreparationEntry = (entry: RecordedIntegrationPreparationEntry): string => {
  if (isRecordedCandidateConstructionEntry(entry)) return lyricForCandidateConstructionEntry(entry)
  if (isRecordedTargetVerificationEntry(entry)) return lyricForTargetVerificationEntry(entry)
  if (isRecordedTargetPromotionEntry(entry)) return lyricForTargetPromotionEntry(entry)
  return lyricForIntegrationFinalityEntry(entry)
}

type RecordedClaimAcquisitionEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "TaskClaimAcquired" | "TaskClaimAcquisitionIntended" | "TaskClaimAcquisitionRejected" }
>

const isRecordedClaimAcquisitionEntry = (entry: RecordedCassetteEntry): entry is RecordedClaimAcquisitionEntry =>
  entry._tag === "TaskClaimAcquired" ||
  entry._tag === "TaskClaimAcquisitionIntended" ||
  entry._tag === "TaskClaimAcquisitionRejected"

const lyricForClaimAcquisitionEntry = (entry: RecordedClaimAcquisitionEntry): string => {
  switch (entry._tag) {
    case "TaskClaimAcquired":
      return `The task tracker showed Dalph's exact claim for task ${entry.claim.taskId}.`
    case "TaskClaimAcquisitionIntended":
      return `Dalph intended to claim task ${entry.operation.acquisition.taskId}.`
    case "TaskClaimAcquisitionRejected":
      return `The task tracker preserved foreign claim ${entry.observed.operationId} for task ${entry.observed.taskId}.`
  }
}

const lyricForTaskBoundaryEntry = (
  entry: Exclude<
    RecordedCassetteEntry,
    | RecordedCandidateConstructionEntry
    | RecordedAttemptStopEntry
    | RecordedExecutorEntry
    | RecordedGitObservationEntry
    | RecordedRunEntry
    | RecordedTrackerEntry
    | RecordedTargetVerificationEntry
    | RecordedTargetPromotionEntry
    | RecordedIntegrationFinalityEntry
    | { readonly _tag: "PlannedAttemptContinuationAuthorized" }
    | { readonly _tag: "AttemptChoiceApplied" | "ControlDirectionApplied" | "TaskClaimReacquisitionDirected" }
  >
): string => {
  if (isRecordedClaimAcquisitionEntry(entry)) return lyricForClaimAcquisitionEntry(entry)
  if (isRecordedClaimReleaseEntry(entry)) return lyricForClaimReleaseEntry(entry)
  if (isRecordedIntegrationEntry(entry)) {
    return entry._tag === "IntegrationResponsibilityBegan"
      ? `Dalph coordinator queued accepted commit ${entry.acceptedResult.commit} for integration.`
      : `Dalph coordinator started integrating accepted commit ${entry.acceptedResult.commit}.`
  }
  if (isRecordedWorktreeEntry(entry)) return lyricForWorktreeEntry(entry)
  return `Dalph planned attempt ${entry.operation.plannedAttempt.attemptId} for task ${entry.operation.plannedAttempt.taskId}.`
}

const lyricForRecordedOperatorDirectionEntry = (entry: RecordedOperatorDirectionEntry): string => {
  if (entry._tag === "AttemptChoiceApplied") {
    return `Operator chose ${entry.choice} for attempt ${entry.subject.plannedAttempt.attemptId} after observing task revision ${entry.subject.observedTaskRevision}.`
  }
  if (entry._tag === "ControlDirectionApplied") {
    return `Operator applied ${entry.direction} to ${entry.subject._tag === "Run" ? "the Run" : `task ${entry.subject.taskId}`}.`
  }
  return `Operator directed Dalph to reacquire the claim for task ${entry.taskId}.`
}

const lyricForRecordedAttemptStopEntry = (entry: RecordedAttemptStopEntry): string => {
  switch (entry._tag) {
    case "AttemptStoppageIntended":
      return `Dalph coordinator began stopping attempt ${entry.subject.plannedAttempt.attemptId}.`
    case "AttemptImplementationAbandoned":
      return `Dalph coordinator abandoned implementation attempt ${entry.subject.plannedAttempt.attemptId} after proving executor quiescence.`
    case "StoppedAttemptClaimNoReleaseObserved":
      return `The task tracker proved that stopping attempt ${entry.subject.plannedAttempt.attemptId} must not release the current claim.`
  }
}

const lyricForOtherRecordedEntry = (
  entry: Exclude<RecordedCassetteEntry, RecordedContinuationAuthorizationEntry>
): string => {
  if (isRecordedOperatorDirectionEntry(entry)) return lyricForRecordedOperatorDirectionEntry(entry)
  if (isRecordedAttemptStopEntry(entry)) return lyricForRecordedAttemptStopEntry(entry)
  if (isRecordedIntegrationPreparationEntry(entry)) return lyricForIntegrationPreparationEntry(entry)
  if (isRecordedGitObservationEntry(entry)) return lyricForGitObservationEntry(entry)
  if (isRecordedExecutorEntry(entry)) return lyricForExecutorEntry(entry)
  if (isRecordedTrackerEntry(entry)) return lyricForTrackerEntry(entry)
  if (isRecordedRunEntry(entry)) return lyricForRunEntry(entry)
  return lyricForTaskBoundaryEntry(entry)
}

const lyricForRecordedEntry = (entry: RecordedCassetteEntry): string =>
  entry._tag === "PlannedAttemptContinuationAuthorized"
    ? `Dalph authorized continuation of planned attempt ${entry.plannedAttempt.attemptId} after four current observations.`
    : lyricForOtherRecordedEntry(entry)

/** Human-readable prose derived from structured entries, never parsed as a contract. */
export const renderRecordedCassetteLyrics = (cassette: RecordedCassetteType): string =>
  cassette.entries.map(lyricForRecordedEntry).join("\n")
