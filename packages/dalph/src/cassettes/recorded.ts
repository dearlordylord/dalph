/* eslint-disable max-lines -- Projection, inverse fold, and presentation share one exhaustive cassette boundary. */
import { Effect, Match, Schema } from "effect"
import { evidenceReferenceEquals } from "@dalph/contracts"
import {
  AttemptChoiceAppliedEvent,
  AttemptRestartAuthorityReadFailedEvent,
  AttemptImplementationAbandonedEvent,
  AttemptStoppageIntendedEvent,
  ControlDirectionAppliedEvent,
  describeJournalEvent,
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent,
  IntegrationProviderRunActivityAbsentEvent,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantinedEvent,
  IntegratorJournalEvent,
  IntegrationCandidateAgentReportedEvent,
  IntegrationCandidateConstructedEvent,
  IntegrationCandidateConstructionIntendedEvent,
  IntegrationCandidateSessionSupersededEvent,
  IntegrationCandidateGitObservedEvent,
  IntegrationCandidateGitValidationFailedEvent,
  IntegrationCandidateCorrectionLimitReachedEvent,
  IntegrationCandidateContinuationLimitReachedEvent,
  integrationCandidateCorrelationEquals,
  JournalPosition,
  PlannedAttemptContinuationAuthorizedEvent,
  PlannedAttemptReplacedEvent,
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
  CompletionClaimDeletionReadObservedEvent,
  CompletionClaimDeletedEvent,
  IntegrationFinalitySettledEvent,
  CompletionTaskAcknowledgedEvent,
  CompletionTaskAttemptIntendedEvent,
  CompletionTaskCandidateAncestryObservedEvent,
  CompletionTaskCandidateAncestryReadIntendedEvent,
  CompletionTaskIntendedEvent,
  CompletionTaskRequestLookupIntendedEvent,
  CompletionTaskRequestLookupObservedEvent,
  CompletionTaskRejectedEvent,
  CompletionTaskResponseLostEvent,
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
): RecordedCassetteEntry =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      PlannedAttemptExecutorWorkResponsibilityBegan: (value): RecordedCassetteEntry => ({
        _tag: "PlannedAttemptExecutorWorkResponsibilityBegan",
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        plannedAttempt: value.plannedAttempt
      }),
      PlannedAttemptExecutorWorkReported: (value): RecordedCassetteEntry => ({
        _tag: "PlannedAttemptExecutorWorkReported",
        occurrenceClassification: "NonActionOccurrence",
        ordinal: value.ordinal,
        report: value.report
      }),
      PlannedAttemptExecutorCommandIntended: (value): RecordedCassetteEntry => ({
        _tag: "PlannedAttemptExecutorCommandIntended",
        command: value.command,
        initiatedBy: value.initiatedBy,
        occurrenceClassification: value.occurrenceClassification,
        ordinal: value.ordinal,
        plannedAttempt: value.plannedAttempt
      }),
      PlannedAttemptExecutorCommandProjectionObserved: (value): RecordedCassetteEntry => ({
        _tag: "PlannedAttemptExecutorCommandProjectionObserved",
        commandOrdinal: value.commandOrdinal,
        observation: value.observation,
        occurrenceClassification: value.occurrenceClassification,
        plannedAttempt: value.plannedAttempt,
        projectionOrdinal: value.projectionOrdinal
      }),
      PlannedAttemptExecutorCommandResponseContradicted: (value): RecordedCassetteEntry => ({
        _tag: "PlannedAttemptExecutorCommandResponseContradicted",
        commandOrdinal: value.commandOrdinal,
        observed: value.observed,
        occurrenceClassification: value.occurrenceClassification,
        plannedAttempt: value.plannedAttempt
      }),
      PlannedAttemptExecutorStateObserved: (value): RecordedCassetteEntry => ({
        _tag: "PlannedAttemptExecutorStateObserved",
        observation: value.observation,
        occurrenceClassification: value.occurrenceClassification,
        ordinal: value.ordinal,
        plannedAttempt: value.plannedAttempt
      })
    })
  )

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
      | "IntegrationCandidateSessionSuperseded"
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
  event._tag === "IntegrationCandidateSessionSuperseded" ||
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
    "IntegrationCandidateSessionSuperseded",
    "IntegrationCandidateGitObserved",
    "IntegrationCandidateGitValidationFailed",
    "IntegrationCandidateCorrectionLimitReached",
    "IntegrationCandidateContinuationLimitReached"
  ]).has(entry._tag)

const recordCandidateConstructionEntry = (event: CandidateConstructionEvent): RecordedCandidateConstructionEntry =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      IntegrationCandidateConstructionIntended: (value): RecordedCandidateConstructionEntry => ({
        _tag: value._tag,
        correlation: value.correlation,
        correctionLimit: value.correctionLimit,
        continuationLimit: value.continuationLimit,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        plannedAttempt: value.plannedAttempt
      }),
      IntegrationCandidateSessionSuperseded: (value): RecordedCandidateConstructionEntry => ({
        _tag: value._tag,
        observedTargetHead: value.observedTargetHead,
        occurrenceClassification: "NonActionOccurrence",
        priorCandidateCommit: value.priorCandidateCommit,
        priorCorrelation: value.priorCorrelation,
        successorCorrelation: value.successorCorrelation
      }),
      IntegrationCandidateAgentReported: (value): RecordedCandidateConstructionEntry => ({
        _tag: value._tag,
        expectedCorrelation: value.expectedCorrelation,
        occurrenceClassification: "NonActionOccurrence",
        ordinal: value.ordinal,
        report: value.report
      }),
      IntegrationCandidateGitObserved: (value): RecordedCandidateConstructionEntry => ({
        _tag: value._tag,
        candidateCommit: value.candidateCommit,
        correlation: value.correlation,
        observation: value.observation,
        occurrenceClassification: "NonActionOccurrence"
      }),
      IntegrationCandidateConstructed: (value): RecordedCandidateConstructionEntry => ({
        _tag: value._tag,
        candidateCommit: value.candidateCommit,
        correlation: value.correlation,
        occurrenceClassification: "NonActionOccurrence",
        reviewManifest: value.reviewManifest
      }),
      IntegrationCandidateGitValidationFailed: (value): RecordedCandidateConstructionEntry => ({
        _tag: value._tag,
        attemptOrdinal: value.attemptOrdinal,
        candidateCommit: value.candidateCommit,
        correlation: value.correlation,
        detail: value.detail,
        occurrenceClassification: "NonActionOccurrence"
      }),
      IntegrationCandidateCorrectionLimitReached: (value): RecordedCandidateConstructionEntry => ({
        _tag: value._tag,
        correctionCount: value.correctionCount,
        correctionLimit: value.correctionLimit,
        correlation: value.correlation,
        occurrenceClassification: "NonActionOccurrence"
      }),
      IntegrationCandidateContinuationLimitReached: (value): RecordedCandidateConstructionEntry => ({
        _tag: value._tag,
        continuationCount: value.continuationCount,
        continuationLimit: value.continuationLimit,
        correlation: value.correlation,
        occurrenceClassification: "NonActionOccurrence"
      })
    })
  )

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

const recordTargetVerificationEntry = (event: TargetVerificationEvent): RecordedTargetVerificationEntry =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TargetVerificationIntended: (value): RecordedTargetVerificationEntry => ({
        _tag: value._tag,
        correlation: value.correlation,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction"
      }),
      TargetVerificationEvidenceSealed: (value): RecordedTargetVerificationEntry => ({
        _tag: value._tag,
        correlation: value.correlation,
        manifest: value.manifest,
        occurrenceClassification: "NonActionOccurrence",
        terminal: value.terminal
      }),
      TargetVerificationCorrelationContradicted: (value): RecordedTargetVerificationEntry => ({
        _tag: value._tag,
        expected: value.expected,
        occurrenceClassification: "NonActionOccurrence",
        received: value.received
      })
    })
  )

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

const recordTargetPromotionEntry = (event: TargetPromotionEvent): RecordedTargetPromotionEntry =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TargetPromotionIntended: (value): RecordedTargetPromotionEntry => ({
        _tag: value._tag,
        correlation: value.correlation,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction"
      }),
      TargetPromotionAttemptIntended: (value): RecordedTargetPromotionEntry => ({
        _tag: value._tag,
        attemptOrdinal: value.attemptOrdinal,
        correlation: value.correlation,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        reason: value.reason
      }),
      TargetPromotionObservedSuccess: (value): RecordedTargetPromotionEntry => ({
        _tag: value._tag,
        basis: value.basis,
        correlation: value.correlation,
        observation: value.observation,
        occurrenceClassification: "NonActionOccurrence"
      }),
      TargetPromotionStale: (value): RecordedTargetPromotionEntry => ({
        _tag: value._tag,
        basis: value.basis,
        correlation: value.correlation,
        observation: value.observation,
        occurrenceClassification: "NonActionOccurrence"
      }),
      TargetPromotionNonConvergence: (value): RecordedTargetPromotionEntry => ({
        _tag: value._tag,
        attemptLimit: value.attemptLimit,
        attemptOrdinal: value.attemptOrdinal,
        correlation: value.correlation,
        lastObservation: value.lastObservation,
        occurrenceClassification: "NonActionOccurrence"
      })
    })
  )

const integrationFinalityTags = [
  "CompletionClaimReplacementIntended",
  "CompletionClaimReplacementAttemptIntended",
  "CompletionClaimReplaced",
  "CompletionClaimDeletionIntended",
  "CompletionClaimDeletionAttemptIntended",
  "CompletionClaimDeletionReadObserved",
  "CompletionClaimDeleted",
  "IntegrationFinalitySettled",
  "CompletionTaskIntended",
  "CompletionTaskAttemptIntended",
  "CompletionTaskAcknowledged",
  "CompletionTaskResponseLost",
  "CompletionTaskRejected",
  "CompletionTaskCandidateAncestryReadIntended",
  "CompletionTaskCandidateAncestryObserved",
  "CompletionTaskRequestLookupIntended",
  "CompletionTaskRequestLookupObserved"
] as const satisfies ReadonlyArray<WorkflowJournalEvent["_tag"] & RecordedCassetteEntry["_tag"]>

type IntegrationFinalityTag = (typeof integrationFinalityTags)[number]
type IntegrationFinalityEvent = Extract<WorkflowJournalEvent, { readonly _tag: IntegrationFinalityTag }>
type RecordedIntegrationFinalityEntry = Extract<RecordedCassetteEntry, { readonly _tag: IntegrationFinalityTag }>

const isIntegrationFinalityTagged = <Value extends { readonly _tag: string }>(
  value: Value
): value is Extract<Value, { readonly _tag: IntegrationFinalityTag }> =>
  integrationFinalityTags.some((tag) => tag === value._tag)

const recordIntegrationFinalityEntry = (event: IntegrationFinalityEvent): RecordedIntegrationFinalityEntry =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      CompletionClaimReplacementIntended: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        claim: value.claim,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        operationId: value.operationId
      }),
      CompletionClaimReplacementAttemptIntended: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        attemptOrdinal: value.attemptOrdinal,
        claim: value.claim,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        operationId: value.operationId
      }),
      CompletionClaimReplaced: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        claim: value.claim,
        occurrenceClassification: "NonActionOccurrence",
        operationId: value.operationId
      }),
      CompletionClaimDeletionIntended: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        claim: value.claim,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        operationId: value.operationId,
        successObservation: value.successObservation
      }),
      CompletionClaimDeletionAttemptIntended: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        attemptOrdinal: value.attemptOrdinal,
        claim: value.claim,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        operationId: value.operationId,
        successObservation: value.successObservation
      }),
      CompletionClaimDeletionReadObserved: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        observation: value.observation,
        occurrenceClassification: "NonActionOccurrence",
        purpose: value.purpose,
        replacementOperationId: value.replacementOperationId,
        request: value.request
      }),
      CompletionClaimDeleted: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        claim: value.claim,
        occurrenceClassification: "NonActionOccurrence",
        operationId: value.operationId,
        successObservation: value.successObservation
      }),
      IntegrationFinalitySettled: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        claim: value.claim,
        deletionOperationId: value.deletionOperationId,
        occurrenceClassification: "NonActionOccurrence",
        replacementOperationId: value.replacementOperationId,
        successObservation: value.successObservation
      }),
      CompletionTaskIntended: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        request: value.request
      }),
      CompletionTaskAttemptIntended: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        attemptOrdinal: value.attemptOrdinal,
        focusedFactsOperationId: value.focusedFactsOperationId,
        gitReadOperationId: value.gitReadOperationId,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        request: value.request
      }),
      CompletionTaskAcknowledged: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        acknowledgement: value.acknowledgement,
        attemptOrdinal: value.attemptOrdinal,
        occurrenceClassification: "NonActionOccurrence",
        request: value.request
      }),
      CompletionTaskResponseLost: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        attemptOrdinal: value.attemptOrdinal,
        occurrenceClassification: "NonActionOccurrence",
        request: value.request
      }),
      CompletionTaskRejected: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        attemptOrdinal: value.attemptOrdinal,
        detail: value.detail,
        occurrenceClassification: "NonActionOccurrence",
        request: value.request
      }),
      CompletionTaskCandidateAncestryReadIntended: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        attemptOrdinal: value.attemptOrdinal,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        operationId: value.operationId,
        request: value.request
      }),
      CompletionTaskCandidateAncestryObserved: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        attemptOrdinal: value.attemptOrdinal,
        observation: value.observation,
        occurrenceClassification: "NonActionOccurrence",
        operationId: value.operationId,
        request: value.request
      }),
      CompletionTaskRequestLookupIntended: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        attemptOrdinal: value.attemptOrdinal,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        operationId: value.operationId,
        request: value.request
      }),
      CompletionTaskRequestLookupObserved: (value): RecordedIntegrationFinalityEntry => ({
        _tag: value._tag,
        attemptOrdinal: value.attemptOrdinal,
        lookup: value.lookup,
        occurrenceClassification: "NonActionOccurrence",
        operationId: value.operationId,
        request: value.request
      })
    })
  )

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
  isIntegrationFinalityTagged(event)

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
  isIntegrationFinalityTagged(entry)

type TaskBoundaryEvent = Extract<
  WorkflowJournalEvent,
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
      | "PlannedAttemptReplaced"
      | "TaskWorktreeReady"
      | "TaskWorktreeReconciliationIntended"
  }
>

const recordTaskBoundaryEntry = (event: TaskBoundaryEvent): RecordedCassetteEntry => {
  if (event._tag === "PlannedAttemptReplaced") {
    return {
      _tag: event._tag,
      initiatedBy: event.initiatedBy,
      occurrenceClassification: event.occurrenceClassification,
      requestId: event.requestId,
      subject: event.subject,
      successorPlan: event.successorPlan,
      witness: event.witness
    }
  }
  if (isRecordedClaimReleaseEntry(event)) return recordClaimReleaseEntry(event)
  if (isRecordedIntegrationEntry(event)) return recordIntegrationEntry(event)
  if (isRecordedWorktreeEntry(event)) return recordWorktreeEntry(event)
  return Match.value(event).pipe(
    Match.tagsExhaustive({
      TaskAttemptPlanned: (value) => ({ _tag: value._tag, operation: value.operation }),
      TaskClaimAcquired: (value) => ({ _tag: value._tag, claim: value.claim }),
      TaskClaimAcquisitionIntended: (value) => ({ _tag: value._tag, operation: value.operation }),
      TaskClaimAcquisitionRejected: (value) => ({
        _tag: value._tag,
        observed: value.observed,
        operationId: value.operationId,
        reason: value.reason
      })
    })
  )
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

const recordedAttemptStopEntryFor = (event: AttemptStopEvent): RecordedCassetteEntry =>
  Match.valueTags(event, {
    AttemptStoppageIntended: (value) => ({
      _tag: value._tag,
      initiatedBy: value.initiatedBy,
      occurrenceClassification: value.occurrenceClassification,
      requestId: value.requestId,
      subject: value.subject
    }),
    AttemptImplementationAbandoned: (value) => ({
      _tag: value._tag,
      expectedClaim: value.expectedClaim,
      initiatedBy: value.initiatedBy,
      occurrenceClassification: value.occurrenceClassification,
      proof: value.proof,
      requestId: value.requestId,
      subject: value.subject
    }),
    StoppedAttemptClaimNoReleaseObserved: (value) => ({
      _tag: value._tag,
      expectedClaim: value.expectedClaim,
      observation: value.observation,
      observationOperationId: value.observationOperationId,
      occurrenceClassification: value.occurrenceClassification,
      requestId: value.requestId,
      subject: value.subject
    })
  })

type OuterIntegratorEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "IntegratorCandidateGitObserved"
      | "IntegratorCandidateGitReadIntended"
      | "IntegratorResultRecorded"
      | "IntegratorRunCandidateGitObserved"
      | "IntegratorRunCandidateGitReadIntended"
      | "IntegratorRunResultRecorded"
      | "IntegratorRunStarted"
      | "IntegratorSessionFixed"
  }
>

type IntegrationQuarantineEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "IntegrationProviderRunActivityAbsent"
      | "IntegrationQuarantineDirectionApplied"
      | "IntegrationQuarantined"
  }
>

const isIntegrationQuarantineEvent = (event: WorkflowJournalEvent): event is IntegrationQuarantineEvent =>
  event._tag === "IntegrationProviderRunActivityAbsent" ||
  event._tag === "IntegrationQuarantineDirectionApplied" ||
  event._tag === "IntegrationQuarantined"

const isOuterIntegratorEvent = (event: WorkflowJournalEvent): event is OuterIntegratorEvent =>
  event._tag === "IntegratorCandidateGitObserved" ||
  event._tag === "IntegratorCandidateGitReadIntended" ||
  event._tag === "IntegratorResultRecorded" ||
  event._tag === "IntegratorRunCandidateGitObserved" ||
  event._tag === "IntegratorRunCandidateGitReadIntended" ||
  event._tag === "IntegratorRunResultRecorded" ||
  event._tag === "IntegratorRunStarted" ||
  event._tag === "IntegratorSessionFixed"

type RecordedOuterIntegratorEntry = Extract<RecordedCassetteEntry, { readonly _tag: OuterIntegratorEvent["_tag"] }>

const isRecordedOuterIntegratorEntry = (entry: RecordedCassetteEntry): entry is RecordedOuterIntegratorEntry =>
  entry._tag === "IntegratorCandidateGitObserved" ||
  entry._tag === "IntegratorCandidateGitReadIntended" ||
  entry._tag === "IntegratorResultRecorded" ||
  entry._tag === "IntegratorRunCandidateGitObserved" ||
  entry._tag === "IntegratorRunCandidateGitReadIntended" ||
  entry._tag === "IntegratorRunResultRecorded" ||
  entry._tag === "IntegratorRunStarted" ||
  entry._tag === "IntegratorSessionFixed"

const recordOuterIntegratorEntry = (event: OuterIntegratorEvent): RecordedOuterIntegratorEntry =>
  Match.valueTags(event, {
    IntegratorSessionFixed: (value): RecordedOuterIntegratorEntry => ({
      _tag: value._tag,
      correlation: value.correlation
    }),
    IntegratorResultRecorded: (value): RecordedOuterIntegratorEntry => ({ _tag: value._tag, result: value.result }),
    IntegratorCandidateGitReadIntended: (value): RecordedOuterIntegratorEntry => ({
      _tag: value._tag,
      candidateText: value.candidateText,
      correlation: value.correlation
    }),
    IntegratorCandidateGitObserved: (value): RecordedOuterIntegratorEntry => ({
      _tag: value._tag,
      candidateText: value.candidateText,
      correlation: value.correlation,
      observation: value.observation
    }),
    IntegratorRunStarted: (value): RecordedOuterIntegratorEntry => ({ _tag: value._tag, run: value.run }),
    IntegratorRunResultRecorded: (value): RecordedOuterIntegratorEntry => ({
      _tag: value._tag,
      result: value.result,
      run: value.run
    }),
    IntegratorRunCandidateGitReadIntended: (value): RecordedOuterIntegratorEntry => ({
      _tag: value._tag,
      candidateText: value.candidateText,
      run: value.run
    }),
    IntegratorRunCandidateGitObserved: (value): RecordedOuterIntegratorEntry => ({
      _tag: value._tag,
      candidateText: value.candidateText,
      observation: value.observation,
      run: value.run
    })
  })

type RecordedIntegrationQuarantineEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: IntegrationQuarantineEvent["_tag"] }
>

const isRecordedIntegrationQuarantineEntry = (
  entry: RecordedCassetteEntry
): entry is RecordedIntegrationQuarantineEntry =>
  entry._tag === "IntegrationProviderRunActivityAbsent" ||
  entry._tag === "IntegrationQuarantineDirectionApplied" ||
  entry._tag === "IntegrationQuarantined"

const recordIntegrationQuarantineEntry = (event: IntegrationQuarantineEvent): RecordedIntegrationQuarantineEntry =>
  Match.valueTags(event, {
    IntegrationProviderRunActivityAbsent: (value): RecordedIntegrationQuarantineEntry => ({
      _tag: value._tag,
      correlation: value.correlation,
      detail: value.detail,
      occurrenceClassification: value.occurrenceClassification
    }),
    IntegrationQuarantineDirectionApplied: (value): RecordedIntegrationQuarantineEntry => ({
      _tag: value._tag,
      fingerprint: value.fingerprint,
      initiatedBy: value.initiatedBy,
      occurrenceClassification: value.occurrenceClassification,
      requestId: value.requestId
    }),
    IntegrationQuarantined: (value): RecordedIntegrationQuarantineEntry => ({
      _tag: value._tag,
      basis: value.basis,
      correlation: value.correlation,
      occurrenceClassification: value.occurrenceClassification
    })
  })

// eslint-disable-next-line complexity -- The closed journal vocabulary has one total projection into recorded cassette entries.
const recordedEntryFor = (event: WorkflowJournalEvent): RecordedCassetteEntry => {
  if (isOuterIntegratorEvent(event)) return recordOuterIntegratorEntry(event)
  if (isIntegrationQuarantineEvent(event)) return recordIntegrationQuarantineEntry(event)
  if (isJournalRunEntry(event)) return recordedRunEntryFor(event)
  if (isOperatorDirectionEvent(event)) return recordedOperatorDirectionEntryFor(event)
  if (isAttemptStopEvent(event)) return recordedAttemptStopEntryFor(event)
  if (event._tag === "AttemptRestartAuthorityReadFailed") {
    return {
      _tag: event._tag,
      failure: event.failure,
      occurrenceClassification: event.occurrenceClassification,
      operationId: event.operationId,
      requestId: event.requestId,
      subject: event.subject
    }
  }
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

/** A recorded inverse cannot invent a causal journal position for a missing predecessor. */
export class RecordedCausalPositionMissing extends Schema.TaggedError<RecordedCausalPositionMissing>()(
  "RecordedCausalPositionMissing",
  { entryIndex: Schema.Int, relation: Schema.String }
) {}

/** Projects a valid one-run journal without exposing a partial cassette. */
export const projectRecordedCassette = Effect.fn("ScenarioCassette.projectRecorded")(function* (
  records: ReadonlyArray<JournalRecord>
) {
  const runId = records[0]?.runId
  if (runId === undefined) return yield* new EmptyJournalCannotBeRecorded({})
  const history = reduceWorkflowJournalHistory(runId, records)
  if (history._tag === "InvalidWorkflowJournalHistory") return yield* Effect.fail(history)
  const entries = records.map(({ event }) => recordedEntryFor(event))
  return RecordedCassette.make({ entries, runId, schemaVersion: recordedCassetteVersion })
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
        | "PlannedAttemptReplaced"
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
  if (entry._tag === "PlannedAttemptReplaced") {
    return PlannedAttemptReplacedEvent.make({ ...entry, version: workflowJournalEventVersion })
  }
  return Match.valueTags(entry, {
    TaskAttemptPlanned: (value) =>
      TaskAttemptPlannedEvent.make({ operation: value.operation, version: workflowJournalEventVersion }),
    TaskClaimAcquired: (value) =>
      TaskClaimAcquiredEvent.make({ claim: value.claim, version: workflowJournalEventVersion }),
    TaskClaimAcquisitionIntended: (value) =>
      TaskClaimAcquisitionIntendedEvent.make({ operation: value.operation, version: workflowJournalEventVersion }),
    TaskClaimAcquisitionRejected: (value) =>
      TaskClaimAcquisitionRejectedEvent.make({
        observed: value.observed,
        operationId: value.operationId,
        reason: value.reason,
        version: workflowJournalEventVersion
      })
  })
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

const eventForExecutorEntry = (entry: RecordedExecutorEntry): WorkflowJournalEvent =>
  Match.valueTags(entry, {
    PlannedAttemptExecutorWorkReported: (value) =>
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: value.ordinal,
        report: value.report,
        version: workflowJournalEventVersion
      }),
    PlannedAttemptExecutorWorkResponsibilityBegan: (value) =>
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: value.plannedAttempt,
        version: workflowJournalEventVersion
      }),
    PlannedAttemptExecutorCommandIntended: (value) =>
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: value.command,
        initiatedBy: value.initiatedBy,
        occurrenceClassification: value.occurrenceClassification,
        ordinal: value.ordinal,
        plannedAttempt: value.plannedAttempt,
        version: workflowJournalEventVersion
      }),
    PlannedAttemptExecutorCommandProjectionObserved: (value) =>
      PlannedAttemptExecutorCommandProjectionObservedEvent.make({
        commandOrdinal: value.commandOrdinal,
        observation: value.observation,
        occurrenceClassification: value.occurrenceClassification,
        plannedAttempt: value.plannedAttempt,
        projectionOrdinal: value.projectionOrdinal,
        version: workflowJournalEventVersion
      }),
    PlannedAttemptExecutorCommandResponseContradicted: (value) =>
      PlannedAttemptExecutorCommandResponseContradictedEvent.make({
        commandOrdinal: value.commandOrdinal,
        observed: value.observed,
        occurrenceClassification: value.occurrenceClassification,
        plannedAttempt: value.plannedAttempt,
        version: workflowJournalEventVersion
      }),
    PlannedAttemptExecutorStateObserved: (value) =>
      PlannedAttemptExecutorStateObservedEvent.make({
        observation: value.observation,
        occurrenceClassification: value.occurrenceClassification,
        ordinal: value.ordinal,
        plannedAttempt: value.plannedAttempt,
        version: workflowJournalEventVersion
      })
  })

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

const eventForOuterIntegratorEntry = (entry: RecordedOuterIntegratorEntry): WorkflowJournalEvent =>
  Schema.decodeUnknownSync(IntegratorJournalEvent)({ ...entry, version: workflowJournalEventVersion })

const eventForIntegrationQuarantineEntry = (entry: RecordedIntegrationQuarantineEntry): WorkflowJournalEvent =>
  Match.valueTags(entry, {
    IntegrationProviderRunActivityAbsent: (value) =>
      IntegrationProviderRunActivityAbsentEvent.make({
        correlation: value.correlation,
        detail: value.detail,
        occurrenceClassification: value.occurrenceClassification,
        version: workflowJournalEventVersion
      }),
    IntegrationQuarantineDirectionApplied: (value) =>
      IntegrationQuarantineDirectionAppliedEvent.make({
        fingerprint: value.fingerprint,
        initiatedBy: value.initiatedBy,
        occurrenceClassification: value.occurrenceClassification,
        requestId: value.requestId,
        version: workflowJournalEventVersion
      }),
    IntegrationQuarantined: (value) =>
      IntegrationQuarantinedEvent.make({
        basis: value.basis,
        correlation: value.correlation,
        occurrenceClassification: value.occurrenceClassification,
        version: workflowJournalEventVersion
      })
  })

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
  return IntegrationStartedEvent.make({
    acceptedResult: entry.acceptedResult,
    integrationTarget: entry.integrationTarget,
    plannedAttempt: entry.plannedAttempt,
    responsibilityBeganAt: priorEntryPosition(
      entries,
      index,
      (candidate) =>
        candidate._tag === "IntegrationResponsibilityBegan" &&
        candidate.plannedAttempt.attemptId === entry.plannedAttempt.attemptId &&
        candidate.acceptedResult.commit === entry.acceptedResult.commit &&
        candidate.integrationTarget.repository === entry.integrationTarget.repository &&
        candidate.integrationTarget.ref === entry.integrationTarget.ref,
      "IntegrationStarted requires its matching IntegrationResponsibilityBegan"
    ),
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

const eventForRecordedAttemptStopEntry = (entry: RecordedAttemptStopEntry): WorkflowJournalEvent =>
  Match.valueTags(entry, {
    AttemptStoppageIntended: (value) =>
      AttemptStoppageIntendedEvent.make({ ...value, version: workflowJournalEventVersion }),
    AttemptImplementationAbandoned: (value) =>
      AttemptImplementationAbandonedEvent.make({ ...value, version: workflowJournalEventVersion }),
    StoppedAttemptClaimNoReleaseObserved: (value) =>
      StoppedAttemptClaimNoReleaseObservedEvent.make({ ...value, version: workflowJournalEventVersion })
  })

const priorEntryPosition = (
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number,
  matches: (entry: RecordedCassetteEntry) => boolean,
  relation: string
): JournalPosition => {
  const priorIndex = entries.findLastIndex((entry, candidateIndex) => candidateIndex < index && matches(entry))
  if (priorIndex < 0) {
    return Effect.runSync(Effect.die(new RecordedCausalPositionMissing({ entryIndex: index, relation })))
  }
  return JournalPosition.make(priorIndex + 1)
}

const eventForCandidateConstructionEntry = (
  entry: RecordedCandidateConstructionEntry,
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number
): WorkflowJournalEvent =>
  Match.valueTags(entry, {
    IntegrationCandidateConstructionIntended: (value) =>
      IntegrationCandidateConstructionIntendedEvent.make({
        correlation: value.correlation,
        correctionLimit: value.correctionLimit,
        continuationLimit: value.continuationLimit,
        plannedAttempt: value.plannedAttempt,
        responsibilityBeganAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationResponsibilityBegan" &&
            candidate.plannedAttempt.attemptId === value.correlation.attemptId,
          "IntegrationCandidateConstructionIntended requires IntegrationResponsibilityBegan"
        ),
        startedAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationStarted" &&
            candidate.plannedAttempt.attemptId === value.correlation.attemptId,
          "IntegrationCandidateConstructionIntended requires IntegrationStarted"
        ),
        version: workflowJournalEventVersion
      }),
    IntegrationCandidateSessionSuperseded: (value) =>
      IntegrationCandidateSessionSupersededEvent.make({
        observedTargetHead: value.observedTargetHead,
        priorCandidateCommit: value.priorCandidateCommit,
        priorCorrelation: value.priorCorrelation,
        responsibilityBeganAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationResponsibilityBegan" &&
            candidate.plannedAttempt.attemptId === value.priorCorrelation.attemptId &&
            candidate.acceptedResult.commit === value.priorCorrelation.acceptedResultCommit &&
            evidenceReferenceEquals(
              candidate.acceptedResult.evidenceManifest,
              value.priorCorrelation.acceptanceManifest
            ) &&
            candidate.integrationTarget.repository === value.priorCorrelation.integrationTarget.repository &&
            candidate.integrationTarget.ref === value.priorCorrelation.integrationTarget.ref,
          "IntegrationCandidateSessionSuperseded requires matching prior IntegrationResponsibilityBegan"
        ),
        startedAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationStarted" &&
            candidate.plannedAttempt.attemptId === value.priorCorrelation.attemptId &&
            candidate.acceptedResult.commit === value.priorCorrelation.acceptedResultCommit &&
            evidenceReferenceEquals(
              candidate.acceptedResult.evidenceManifest,
              value.priorCorrelation.acceptanceManifest
            ) &&
            candidate.integrationTarget.repository === value.priorCorrelation.integrationTarget.repository &&
            candidate.integrationTarget.ref === value.priorCorrelation.integrationTarget.ref,
          "IntegrationCandidateSessionSuperseded requires matching prior IntegrationStarted"
        ),
        successorCorrelation: value.successorCorrelation,
        version: workflowJournalEventVersion
      }),
    IntegrationCandidateAgentReported: (value) =>
      IntegrationCandidateAgentReportedEvent.make({
        expectedCorrelation: value.expectedCorrelation,
        ordinal: value.ordinal,
        report: value.report,
        version: workflowJournalEventVersion
      }),
    IntegrationCandidateGitObserved: (value) =>
      IntegrationCandidateGitObservedEvent.make({
        candidateCommit: value.candidateCommit,
        correlation: value.correlation,
        observation: value.observation,
        submissionAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationCandidateAgentReported" &&
            candidate.report._tag === "Submitted" &&
            candidate.report.candidateCommit === value.candidateCommit &&
            candidate.report.correlation.candidateId === value.correlation.candidateId,
          "IntegrationCandidateGitObserved requires its matching submitted report"
        ),
        version: workflowJournalEventVersion
      }),
    IntegrationCandidateConstructed: (value) =>
      IntegrationCandidateConstructedEvent.make({
        candidateCommit: value.candidateCommit,
        correlation: value.correlation,
        gitObservationAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationCandidateGitObserved" &&
            candidate.candidateCommit === value.candidateCommit &&
            candidate.correlation.candidateId === value.correlation.candidateId,
          "IntegrationCandidateConstructed requires its matching Git observation"
        ),
        reviewManifest: value.reviewManifest,
        version: workflowJournalEventVersion
      }),
    IntegrationCandidateGitValidationFailed: (value) =>
      IntegrationCandidateGitValidationFailedEvent.make({
        attemptOrdinal: value.attemptOrdinal,
        candidateCommit: value.candidateCommit,
        correlation: value.correlation,
        detail: value.detail,
        submissionAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationCandidateAgentReported" &&
            candidate.report._tag === "Submitted" &&
            candidate.report.candidateCommit === value.candidateCommit &&
            candidate.report.correlation.candidateId === value.correlation.candidateId,
          "IntegrationCandidateGitValidationFailed requires its matching submitted report"
        ),
        version: workflowJournalEventVersion
      }),
    IntegrationCandidateCorrectionLimitReached: (value) =>
      IntegrationCandidateCorrectionLimitReachedEvent.make({
        correctionCount: value.correctionCount,
        correctionLimit: value.correctionLimit,
        correlation: value.correlation,
        invalidObservationAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationCandidateGitObserved" &&
            candidate.correlation.candidateId === value.correlation.candidateId,
          "IntegrationCandidateCorrectionLimitReached requires its invalid Git observation"
        ),
        version: workflowJournalEventVersion
      }),
    IntegrationCandidateContinuationLimitReached: (value) =>
      IntegrationCandidateContinuationLimitReachedEvent.make({
        continuationCount: value.continuationCount,
        continuationLimit: value.continuationLimit,
        correlation: value.correlation,
        lastReportAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationCandidateAgentReported" &&
            candidate.report._tag !== "Submitted" &&
            candidate.report.correlation.candidateId === value.correlation.candidateId,
          "IntegrationCandidateContinuationLimitReached requires its prior candidate report"
        ),
        version: workflowJournalEventVersion
      })
  })

const eventForTargetVerificationEntry = (entry: RecordedTargetVerificationEntry): WorkflowJournalEvent =>
  Match.valueTags(entry, {
    TargetVerificationIntended: (value) =>
      TargetVerificationIntendedEvent.make({ correlation: value.correlation, version: workflowJournalEventVersion }),
    TargetVerificationEvidenceSealed: (value) =>
      TargetVerificationEvidenceSealedEvent.make({
        correlation: value.correlation,
        manifest: value.manifest,
        terminal: value.terminal,
        version: workflowJournalEventVersion
      }),
    TargetVerificationCorrelationContradicted: (value) =>
      TargetVerificationCorrelationContradictedEvent.make({
        expected: value.expected,
        received: value.received,
        version: workflowJournalEventVersion
      })
  })

const eventForTargetPromotionEntry = (entry: RecordedTargetPromotionEntry): WorkflowJournalEvent =>
  Match.valueTags(entry, {
    TargetPromotionIntended: (value) =>
      TargetPromotionIntendedEvent.make({ correlation: value.correlation, version: workflowJournalEventVersion }),
    TargetPromotionAttemptIntended: (value) =>
      TargetPromotionAttemptIntendedEvent.make({
        attemptOrdinal: value.attemptOrdinal,
        correlation: value.correlation,
        reason: value.reason,
        version: workflowJournalEventVersion
      }),
    TargetPromotionObservedSuccess: (value) =>
      TargetPromotionObservedSuccessEvent.make({
        basis: value.basis,
        correlation: value.correlation,
        observation: value.observation,
        version: workflowJournalEventVersion
      }),
    TargetPromotionStale: (value) =>
      TargetPromotionStaleEvent.make({
        basis: value.basis,
        correlation: value.correlation,
        observation: value.observation,
        version: workflowJournalEventVersion
      }),
    TargetPromotionNonConvergence: (value) =>
      TargetPromotionNonConvergenceEvent.make({
        attemptLimit: value.attemptLimit,
        attemptOrdinal: value.attemptOrdinal,
        correlation: value.correlation,
        lastObservation: value.lastObservation,
        version: workflowJournalEventVersion
      })
  })

const eventForIntegrationFinalityEntry = (entry: RecordedIntegrationFinalityEntry): WorkflowJournalEvent =>
  Match.valueTags(entry, {
    CompletionClaimReplacementIntended: (value) =>
      CompletionClaimReplacementIntendedEvent.make({
        claim: value.claim,
        operationId: value.operationId,
        version: workflowJournalEventVersion
      }),
    CompletionClaimReplacementAttemptIntended: (value) =>
      CompletionClaimReplacementAttemptIntendedEvent.make({
        attemptOrdinal: value.attemptOrdinal,
        claim: value.claim,
        operationId: value.operationId,
        version: workflowJournalEventVersion
      }),
    CompletionClaimReplaced: (value) =>
      CompletionClaimReplacedEvent.make({
        claim: value.claim,
        operationId: value.operationId,
        version: workflowJournalEventVersion
      }),
    CompletionClaimDeletionIntended: (value) =>
      CompletionClaimDeletionIntendedEvent.make({
        claim: value.claim,
        operationId: value.operationId,
        successObservation: value.successObservation,
        version: workflowJournalEventVersion
      }),
    CompletionClaimDeletionAttemptIntended: (value) =>
      CompletionClaimDeletionAttemptIntendedEvent.make({
        attemptOrdinal: value.attemptOrdinal,
        claim: value.claim,
        operationId: value.operationId,
        successObservation: value.successObservation,
        version: workflowJournalEventVersion
      }),
    CompletionClaimDeletionReadObserved: (value) =>
      CompletionClaimDeletionReadObservedEvent.make({
        observation: value.observation,
        purpose: value.purpose,
        replacementOperationId: value.replacementOperationId,
        request: value.request,
        version: workflowJournalEventVersion
      }),
    CompletionClaimDeleted: (value) =>
      CompletionClaimDeletedEvent.make({
        claim: value.claim,
        operationId: value.operationId,
        successObservation: value.successObservation,
        version: workflowJournalEventVersion
      }),
    IntegrationFinalitySettled: (value) =>
      IntegrationFinalitySettledEvent.make({
        claim: value.claim,
        deletionOperationId: value.deletionOperationId,
        replacementOperationId: value.replacementOperationId,
        successObservation: value.successObservation,
        version: workflowJournalEventVersion
      }),
    CompletionTaskIntended: (value) =>
      CompletionTaskIntendedEvent.make({ request: value.request, version: workflowJournalEventVersion }),
    CompletionTaskAttemptIntended: (value) =>
      CompletionTaskAttemptIntendedEvent.make({
        attemptOrdinal: value.attemptOrdinal,
        focusedFactsOperationId: value.focusedFactsOperationId,
        gitReadOperationId: value.gitReadOperationId,
        request: value.request,
        version: workflowJournalEventVersion
      }),
    CompletionTaskAcknowledged: (value) =>
      CompletionTaskAcknowledgedEvent.make({
        acknowledgement: value.acknowledgement,
        attemptOrdinal: value.attemptOrdinal,
        request: value.request,
        version: workflowJournalEventVersion
      }),
    CompletionTaskResponseLost: (value) =>
      CompletionTaskResponseLostEvent.make({
        attemptOrdinal: value.attemptOrdinal,
        request: value.request,
        version: workflowJournalEventVersion
      }),
    CompletionTaskRejected: (value) =>
      CompletionTaskRejectedEvent.make({
        attemptOrdinal: value.attemptOrdinal,
        detail: value.detail,
        request: value.request,
        version: workflowJournalEventVersion
      }),
    CompletionTaskCandidateAncestryReadIntended: (value) =>
      CompletionTaskCandidateAncestryReadIntendedEvent.make({
        attemptOrdinal: value.attemptOrdinal,
        operationId: value.operationId,
        request: value.request,
        version: workflowJournalEventVersion
      }),
    CompletionTaskCandidateAncestryObserved: (value) =>
      CompletionTaskCandidateAncestryObservedEvent.make({
        attemptOrdinal: value.attemptOrdinal,
        observation: value.observation,
        operationId: value.operationId,
        request: value.request,
        version: workflowJournalEventVersion
      }),
    CompletionTaskRequestLookupIntended: (value) =>
      CompletionTaskRequestLookupIntendedEvent.make({
        attemptOrdinal: value.attemptOrdinal,
        operationId: value.operationId,
        request: value.request,
        version: workflowJournalEventVersion
      }),
    CompletionTaskRequestLookupObserved: (value) =>
      CompletionTaskRequestLookupObservedEvent.make({
        attemptOrdinal: value.attemptOrdinal,
        lookup: value.lookup,
        operationId: value.operationId,
        request: value.request,
        version: workflowJournalEventVersion
      })
  })

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

// eslint-disable-next-line complexity -- The inverse fold exhaustively routes the closed recorded cassette vocabulary.
const eventForOtherRecordedEntry = (
  entry: Exclude<RecordedCassetteEntry, RecordedContinuationAuthorizationEntry>,
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number,
  runId: RecordedCassetteType["runId"]
): WorkflowJournalEvent => {
  if (isRecordedRunEntry(entry)) return eventForRunEntry(entry)
  if (isRecordedOperatorDirectionEntry(entry)) return eventForRecordedOperatorDirectionEntry(entry, runId)
  if (isRecordedAttemptStopEntry(entry)) return eventForRecordedAttemptStopEntry(entry)
  if (entry._tag === "AttemptRestartAuthorityReadFailed") {
    return AttemptRestartAuthorityReadFailedEvent.make({ ...entry, version: workflowJournalEventVersion })
  }
  if (isRecordedOuterIntegratorEntry(entry)) return eventForOuterIntegratorEntry(entry)
  if (isRecordedIntegrationQuarantineEntry(entry)) return eventForIntegrationQuarantineEntry(entry)
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

const lyricForExecutorEntry = (entry: RecordedExecutorEntry): string =>
  Match.valueTags(entry, {
    PlannedAttemptExecutorWorkReported: (value) =>
      `The executor returned ${value.report._tag} for attempt ${value.report.correlation.attemptId}.`,
    PlannedAttemptExecutorWorkResponsibilityBegan: (value) =>
      `Dalph coordinator began executor-work responsibility for task ${value.plannedAttempt.taskId}, attempt ${value.plannedAttempt.attemptId}.`,
    PlannedAttemptExecutorCommandIntended: (value) =>
      `Dalph coordinator intended executor command ${value.command} for attempt ${value.plannedAttempt.attemptId}.`,
    PlannedAttemptExecutorCommandProjectionObserved: (value) =>
      `Dalph observed ${value.observation._tag} while reconciling executor command ${value.commandOrdinal} for attempt ${value.plannedAttempt.attemptId}.`,
    PlannedAttemptExecutorCommandResponseContradicted: (value) =>
      `The executor returned a response for attempt ${value.observed.correlation.attemptId} to command ${value.commandOrdinal} for expected attempt ${value.plannedAttempt.attemptId}; Dalph kept the command unresolved.`,
    PlannedAttemptExecutorStateObserved: (value) =>
      `Dalph observed ${value.observation._tag} from a read-only executor projection for attempt ${value.plannedAttempt.attemptId}.`
  })

const lyricForTrackerEntry = (entry: RecordedTrackerEntry): string =>
  entry._tag === "TaskTrackerFactsObserved"
    ? `Dalph observed ${entry.evidence._tag} through tracker read ${entry.originatingActionOperationId}.`
    : `Dalph coordinator initiated ${entry.operation._tag} for the task tracker.`

const lyricForOuterIntegratorEntry = (entry: RecordedOuterIntegratorEntry): string =>
  Match.valueTags(entry, {
    IntegratorSessionFixed: (value) =>
      `Dalph coordinator fixed Integrator session ${value.correlation.sessionId} for target head ${value.correlation.expectedTargetHead}.`,
    IntegratorResultRecorded: (value) =>
      value.result._tag === "PreparedCandidate"
        ? `The Integrator reported candidate ${value.result.candidateText} for session ${value.result.correlation.sessionId}.`
        : `The Integrator reported NotPrepared for session ${value.result.correlation.sessionId}: ${value.result.detail}.`,
    IntegratorCandidateGitReadIntended: (value) =>
      `Dalph coordinator intended to ask Git about explicitly reported candidate ${value.candidateText}.`,
    IntegratorCandidateGitObserved: (value) =>
      `Git reported ${value.observation._tag} for explicitly reported candidate ${value.candidateText}.`,
    IntegratorRunStarted: (value) =>
      `Dalph coordinator intended Integrator run ${value.run.ordinal} in session ${value.run.session.sessionId}.`,
    IntegratorRunResultRecorded: (value) =>
      value.result._tag === "PreparedCandidate"
        ? `Integrator run ${value.run.ordinal} reported candidate ${value.result.candidateText} for session ${value.run.session.sessionId}.`
        : `Integrator run ${value.run.ordinal} reported NotPrepared for session ${value.run.session.sessionId}: ${value.result.detail}.`,
    IntegratorRunCandidateGitReadIntended: (value) =>
      `Dalph coordinator intended to ask Git about candidate ${value.candidateText} from Integrator run ${value.run.ordinal}.`,
    IntegratorRunCandidateGitObserved: (value) =>
      `Git reported ${value.observation._tag} for candidate ${value.candidateText} from Integrator run ${value.run.ordinal}.`
  })

const lyricForIntegrationQuarantineEntry = (entry: RecordedIntegrationQuarantineEntry): string =>
  Match.valueTags(entry, {
    IntegrationProviderRunActivityAbsent: (value) =>
      `The provider reported no owned Integrator activity for session ${value.correlation.sessionId}: ${value.detail}.`,
    IntegrationQuarantineDirectionApplied: (value) =>
      `Operator applied ${value.fingerprint.direction} to the Integrator quarantine at ${value.fingerprint.quarantineAt}.`,
    IntegrationQuarantined: (value) =>
      `Dalph quarantined Integrator session ${value.correlation.sessionId} on ${value.basis._tag} evidence.`
  })

// eslint-disable-next-line complexity -- Every closed candidate occurrence receives one concrete actor-first lyric.
const lyricForCandidateConstructionEntry = (entry: RecordedCandidateConstructionEntry): string =>
  Match.valueTags(entry, {
    IntegrationCandidateConstructionIntended: (value) =>
      `Dalph coordinator began candidate ${value.correlation.candidateId} in session ${value.correlation.integrationSessionId}.`,
    IntegrationCandidateSessionSuperseded: (value) =>
      `Dalph preserved candidate ${value.priorCandidateCommit} and superseded its stale session for target ${value.observedTargetHead}.`,
    IntegrationCandidateAgentReported: (value) =>
      integrationCandidateCorrelationEquals(value.expectedCorrelation, value.report.correlation)
        ? `The integration agent reported ${value.report._tag} for session ${value.report.correlation.integrationSessionId}.`
        : `The integration agent returned an infrastructure correlation contradiction for expected session ${value.expectedCorrelation.integrationSessionId}; Dalph preserved the involved candidate resources.`,
    IntegrationCandidateGitObserved: (value) =>
      `Git reported ${value.observation._tag} for submitted commit ${value.candidateCommit}.`,
    IntegrationCandidateConstructed: (value) =>
      `Git proved candidate ${value.candidateCommit} has the exact ordered parents selected for the session.`,
    IntegrationCandidateGitValidationFailed: (value) =>
      `Git could not validate submitted commit ${value.candidateCommit}: ${value.detail}`,
    IntegrationCandidateCorrectionLimitReached: (value) =>
      `Candidate session ${value.correlation.integrationSessionId} stopped after ${value.correctionCount} correction attempts.`,
    IntegrationCandidateContinuationLimitReached: (value) =>
      `Candidate session ${value.correlation.integrationSessionId} stopped after ${value.continuationCount} automatic agent continuations.`
  })

const lyricForTargetVerificationEntry = (entry: RecordedTargetVerificationEntry): string =>
  Match.valueTags(entry, {
    TargetVerificationIntended: (value) =>
      `Dalph coordinator fixed verification request ${value.correlation.requestId} to plan ${value.correlation.planId}.`,
    TargetVerificationEvidenceSealed: (value) =>
      `The target repository's public verification wrapper returned ${value.terminal} for candidate ${value.correlation.candidateCommit}.`,
    TargetVerificationCorrelationContradicted: (value) =>
      `Dalph stopped verification request ${value.expected.requestId} after the wrapper returned a foreign correlation.`
  })

const lyricForTargetPromotionEntry = (entry: RecordedTargetPromotionEntry): string =>
  Match.valueTags(entry, {
    TargetPromotionIntended: (value) =>
      `Dalph coordinator fixed exact promotion ${value.correlation.qualifiedCandidate.run.session.expectedTargetHead} -> ${value.correlation.qualifiedCandidate.candidateCommit}.`,
    TargetPromotionAttemptIntended: (value) =>
      `Dalph coordinator sent exact compare-and-set attempt ${value.attemptOrdinal} for candidate ${value.correlation.qualifiedCandidate.candidateCommit}.`,
    TargetPromotionObservedSuccess: (value) =>
      `Git established candidate ${value.correlation.qualifiedCandidate.candidateCommit} by ${value.observation._tag}.`,
    TargetPromotionStale: (value) =>
      `Git preserved a different target head while candidate ${value.correlation.qualifiedCandidate.candidateCommit} became stale.`,
    TargetPromotionNonConvergence: (value) =>
      `Dalph stopped candidate ${value.correlation.qualifiedCandidate.candidateCommit} after ${value.attemptOrdinal} ambiguous compare-and-set attempts.`
  })

const lyricForIntegrationFinalityEntry = (entry: RecordedIntegrationFinalityEntry): string =>
  Match.valueTags(entry, {
    CompletionClaimReplacementIntended: (value) =>
      `Dalph coordinator intended to replace the exact active claim for task ${value.claim.plannedAttempt.taskId}.`,
    CompletionClaimReplacementAttemptIntended: (value) =>
      `Dalph coordinator sent completion-claim replacement attempt ${value.attemptOrdinal} for task ${value.claim.plannedAttempt.taskId}.`,
    CompletionClaimReplaced: (value) =>
      `The task tracker proved the promotion-bound completion claim current for task ${value.claim.plannedAttempt.taskId}.`,
    CompletionClaimDeletionIntended: (value) =>
      `Dalph coordinator intended to delete the exact completion claim for task ${value.claim.plannedAttempt.taskId} after fresh success.`,
    CompletionClaimDeletionAttemptIntended: (value) =>
      `Dalph coordinator sent completion-claim deletion attempt ${value.attemptOrdinal} for task ${value.claim.plannedAttempt.taskId}.`,
    CompletionClaimDeletionReadObserved: (value) =>
      `The task tracker returned ${value.observation._tag} for completion-claim cleanup ${value.purpose._tag}.`,
    CompletionClaimDeleted: (value) =>
      `The task tracker proved the exact completion claim absent for successful task ${value.claim.plannedAttempt.taskId}.`,
    IntegrationFinalitySettled: (value) =>
      `Dalph settled integration finality for promoted task ${value.claim.plannedAttempt.taskId}.`,
    CompletionTaskIntended: (value) =>
      `Dalph coordinator fixed one exact tracker completion request for task ${value.request.taskId}.`,
    CompletionTaskAttemptIntended: (value) =>
      `Dalph coordinator intended tracker completion call ${value.attemptOrdinal} for task ${value.request.taskId} after focused tracker read ${value.focusedFactsOperationId} and Git read ${value.gitReadOperationId}.`,
    CompletionTaskAcknowledged: (value) =>
      `The task tracker acknowledged completion request ${value.request.operationId} for task ${value.request.taskId}; Dalph still required a later focused success read.`,
    CompletionTaskResponseLost: (value) =>
      `Dalph lost the response to tracker completion call ${value.attemptOrdinal} for task ${value.request.taskId}.`,
    CompletionTaskRejected: (value) =>
      `The task tracker definitively rejected completion call ${value.attemptOrdinal} for task ${value.request.taskId}: ${value.detail}`,
    CompletionTaskCandidateAncestryReadIntended: (value) =>
      `Dalph coordinator intended a current Git ancestry read before completion call ${value.attemptOrdinal} for task ${value.request.taskId}.`,
    CompletionTaskCandidateAncestryObserved: (value) =>
      `Git reported ${value.observation._tag} for promoted candidate ${value.request.claim.promotionCorrelation.qualifiedCandidate.candidateCommit}.`,
    CompletionTaskRequestLookupIntended: (value) =>
      `Dalph coordinator intended to look up exact completion request ${value.request.operationId} after call ${value.attemptOrdinal}.`,
    CompletionTaskRequestLookupObserved: (value) =>
      `The task tracker reported ${value.lookup._tag} for exact completion request ${value.request.operationId}.`
  })

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

const lyricForClaimAcquisitionEntry = (entry: RecordedClaimAcquisitionEntry): string =>
  Match.valueTags(entry, {
    TaskClaimAcquired: (value) => `The task tracker showed Dalph's exact claim for task ${value.claim.taskId}.`,
    TaskClaimAcquisitionIntended: (value) => `Dalph intended to claim task ${value.operation.acquisition.taskId}.`,
    TaskClaimAcquisitionRejected: (value) =>
      `The task tracker preserved foreign claim ${value.observed.operationId} for task ${value.observed.taskId}.`
  })

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
    | RecordedOuterIntegratorEntry
    | RecordedIntegrationQuarantineEntry
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
  if (entry._tag === "AttemptRestartAuthorityReadFailed") {
    return `The ${entry.failure._tag} boundary failed while Dalph checked whether attempt ${entry.subject.plannedAttempt.attemptId} could be replaced.`
  }
  if (entry._tag === "PlannedAttemptReplaced") {
    return `Dalph atomically replaced attempt ${entry.subject.plannedAttempt.attemptId} with clean attempt ${entry.successorPlan.plannedAttempt.attemptId}.`
  }
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

const lyricForRecordedAttemptStopEntry = (entry: RecordedAttemptStopEntry): string =>
  Match.valueTags(entry, {
    AttemptStoppageIntended: (value) =>
      `Dalph coordinator began stopping attempt ${value.subject.plannedAttempt.attemptId}.`,
    AttemptImplementationAbandoned: (value) =>
      `Dalph coordinator abandoned implementation attempt ${value.subject.plannedAttempt.attemptId} after proving executor quiescence.`,
    StoppedAttemptClaimNoReleaseObserved: (value) =>
      `The task tracker proved that stopping attempt ${value.subject.plannedAttempt.attemptId} must not release the current claim.`
  })

type RecordedOtherEntry = Exclude<RecordedCassetteEntry, RecordedContinuationAuthorizationEntry>
type RecordedPresentationResidualEntry = Exclude<
  RecordedOtherEntry,
  | RecordedAttemptStopEntry
  | RecordedIntegrationPreparationEntry
  | RecordedOperatorDirectionEntry
  | RecordedOuterIntegratorEntry
  | RecordedIntegrationQuarantineEntry
>

const lyricForRecordedPresentationResidual = (entry: RecordedPresentationResidualEntry): string => {
  if (isRecordedGitObservationEntry(entry)) return lyricForGitObservationEntry(entry)
  if (isRecordedExecutorEntry(entry)) return lyricForExecutorEntry(entry)
  if (isRecordedTrackerEntry(entry)) return lyricForTrackerEntry(entry)
  if (isRecordedRunEntry(entry)) return lyricForRunEntry(entry)
  return lyricForTaskBoundaryEntry(entry)
}

const lyricForOtherRecordedEntry = (entry: RecordedOtherEntry): string => {
  if (isRecordedOperatorDirectionEntry(entry)) return lyricForRecordedOperatorDirectionEntry(entry)
  if (isRecordedAttemptStopEntry(entry)) return lyricForRecordedAttemptStopEntry(entry)
  if (isRecordedOuterIntegratorEntry(entry)) return lyricForOuterIntegratorEntry(entry)
  if (isRecordedIntegrationQuarantineEntry(entry)) return lyricForIntegrationQuarantineEntry(entry)
  if (isRecordedIntegrationPreparationEntry(entry)) return lyricForIntegrationPreparationEntry(entry)
  return lyricForRecordedPresentationResidual(entry)
}

const lyricForRecordedEntry = (entry: RecordedCassetteEntry): string =>
  entry._tag === "PlannedAttemptContinuationAuthorized"
    ? `Dalph authorized continuation of planned attempt ${entry.plannedAttempt.attemptId} after four current observations.`
    : lyricForOtherRecordedEntry(entry)

/** Human-readable prose derived from structured entries, never parsed as a contract. */
export const renderRecordedCassetteLyrics = (cassette: RecordedCassetteType): string =>
  cassette.entries.map(lyricForRecordedEntry).join("\n")
