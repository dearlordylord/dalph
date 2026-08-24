import { Schema } from "effect"
import { PlannedTaskAttempt, RunId } from "@dalph/contracts"
import {
  ActiveTaskClaim,
  TaskClaimObservation,
  TaskClaimRelease
} from "../../authorities/task-tracker/claim-mutation.js"
import { PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../identity.js"
import { WorkflowOperation } from "./operation.js"
import { WorkflowActor } from "./actor.js"
import {
  AttemptChoiceRequestId,
  AttemptChoiceSubject,
  AttemptQuiescenceProof
} from "../protocols/attempt-choice/events.js"
import {
  IntegratorCandidateText,
  IntegratorGitObservation,
  IntegratorResult,
  IntegratorRunCorrelation,
  IntegratorSessionCorrelation
} from "../protocols/integrator/events.js"
import {
  TargetPromotionCorrelation,
  TargetPromotionAttemptReason,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptLimit,
  TargetPromotionSuccessObservation,
  TargetPromotionStaleObservation,
  TargetPromotionNonConvergenceObservation,
  TargetPromotionTerminalBasis
} from "../protocols/target-promotion/events.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId
} from "../protocols/integration-quarantine/events.js"
import {
  CompletionClaimDeletedEvent,
  CompletionClaimDeletionAttemptIntendedEvent,
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimDeletionReadObservedEvent,
  CompletionClaimReplacedEvent,
  CompletionClaimReplacementAttemptIntendedEvent,
  CompletionClaimReplacementIntendedEvent,
  CompletionTaskAcknowledgedEvent,
  CompletionTaskAttemptIntendedEvent,
  CompletionTaskCandidateAncestryObservedEvent,
  CompletionTaskCandidateAncestryReadIntendedEvent,
  CompletionTaskIntendedEvent,
  CompletionTaskRejectedEvent,
  CompletionTaskRequestLookupIntendedEvent,
  CompletionTaskRequestLookupObservedEvent,
  CompletionTaskResponseLostEvent,
  IntegrationFinalitySettledEvent,
  PostPromotionBlockerCandidateAncestryReadIntendedEvent,
  PostPromotionBlockerCandidateAncestryObservedEvent
} from "../protocols/integration-finality/events.js"
import {
  BranchCleanupOccurred,
  CancelledAttemptClaimNoReleaseObserved,
  CancelledAttemptImplementationResponsibilityRelinquished,
  IntegratorCandidateCleanupOccurred,
  RunCancellationApplied,
  WorktreeCleanupOccurred
} from "./historical-control-disposition-occurrence.js"
export {
  BranchCleanupOccurred,
  CancelledAttemptClaimNoReleaseObserved,
  CancelledAttemptImplementationResponsibilityRelinquished,
  IntegratorCandidateCleanupOccurred,
  RunCancellationApplied,
  WorktreeCleanupOccurred
} from "./historical-control-disposition-occurrence.js"

const successorGeneration = 2 as const // eslint-disable-line no-magic-numbers

const initiatedByCoordinator = {
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction")
}

const nonAction = { occurrenceClassification: Schema.Literal("NonActionOccurrence") }

/** The exact task-claim request that preceded a tracker boundary call. */
export const TaskClaimAcquisitionInitiated = Schema.TaggedStruct("TaskClaimAcquisitionInitiated", {
  ...initiatedByCoordinator,
  operation: WorkflowOperation.cases.AcquireTaskClaim,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TaskClaimAcquisitionInitiated = typeof TaskClaimAcquisitionInitiated.Type

/** The tracker returned the exact claim named by one acquisition request. */
export const TaskClaimAcquired = Schema.TaggedStruct("TaskClaimAcquired", {
  claim: ActiveTaskClaim,
  ...nonAction,
  originatingActionOperationId: OperationId,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TaskClaimAcquired = typeof TaskClaimAcquired.Type

/** The exact task-claim deletion request recorded before a tracker call. */
export const TaskClaimReleaseInitiated = Schema.TaggedStruct("TaskClaimReleaseInitiated", {
  ...initiatedByCoordinator,
  operation: WorkflowOperation.cases.ReleaseTaskClaim,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TaskClaimReleaseInitiated = typeof TaskClaimReleaseInitiated.Type

/** A fresh tracker observation proved the exact claim deletion. */
export const TaskClaimReleased = Schema.TaggedStruct("TaskClaimReleased", {
  ...nonAction,
  originatingActionOperationId: OperationId,
  recordedAt: JournalPosition,
  release: TaskClaimRelease,
  runId: RunId
})
export type TaskClaimReleased = typeof TaskClaimReleased.Type

/** The immutable plan Dalph recorded before creating or using task resources. */
export const TaskAttemptPlanned = Schema.TaggedStruct("TaskAttemptPlanned", {
  ...initiatedByCoordinator,
  operation: WorkflowOperation.cases.RecordTaskAttemptPlan,
  plannedAttempt: PlannedTaskAttempt,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TaskAttemptPlanned = typeof TaskAttemptPlanned.Type

/** Dalph recorded intent before reconciling the exact planned-attempt worktree. */
export const TaskWorktreeReconciliationInitiated = Schema.TaggedStruct("TaskWorktreeReconciliationInitiated", {
  ...initiatedByCoordinator,
  operation: WorkflowOperation.cases.ReconcileTaskWorktree,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TaskWorktreeReconciliationInitiated = typeof TaskWorktreeReconciliationInitiated.Type

/** Git proved the exact planned worktree ready for the task attempt. */
export const TaskWorktreeReady = Schema.TaggedStruct("TaskWorktreeReady", {
  ...nonAction,
  operationId: OperationId,
  operation: WorkflowOperation.cases.ReconcileTaskWorktree,
  proof: PlannedWorktreeReady,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TaskWorktreeReady = typeof TaskWorktreeReady.Type

/** Dalph recorded the stop request before asking the executor to quiesce. */
export const AttemptStoppageIntended = Schema.TaggedStruct("AttemptStoppageIntended", {
  ...initiatedByCoordinator,
  recordedAt: JournalPosition,
  requestId: AttemptChoiceRequestId,
  runId: RunId,
  subject: AttemptChoiceSubject
})
export type AttemptStoppageIntended = typeof AttemptStoppageIntended.Type

/** Quiescence proved that the implementation responsibility was abandoned safely. */
export const AttemptImplementationAbandoned = Schema.TaggedStruct("AttemptImplementationAbandoned", {
  expectedClaim: ActiveTaskClaim,
  ...initiatedByCoordinator,
  proof: AttemptQuiescenceProof,
  recordedAt: JournalPosition,
  requestId: AttemptChoiceRequestId,
  runId: RunId,
  subject: AttemptChoiceSubject
})
export type AttemptImplementationAbandoned = typeof AttemptImplementationAbandoned.Type

/** A claim read preserved an absent or foreign claim after a stopped attempt. */
export const StoppedAttemptClaimPreserved = Schema.TaggedStruct("StoppedAttemptClaimPreserved", {
  expectedClaim: ActiveTaskClaim,
  observation: TaskClaimObservation,
  ...nonAction,
  observationOperationId: OperationId,
  recordedAt: JournalPosition,
  requestId: AttemptChoiceRequestId,
  runId: RunId,
  subject: AttemptChoiceSubject
})
export type StoppedAttemptClaimPreserved = typeof StoppedAttemptClaimPreserved.Type

/** Dalph fixed one opaque Integrator session for an integration responsibility. */
export const IntegratorSessionFixed = Schema.TaggedStruct("IntegratorSessionFixed", {
  ...initiatedByCoordinator,
  correlation: IntegratorSessionCorrelation,
  recordedAt: JournalPosition,
  runId: RunId
})
export type IntegratorSessionFixed = typeof IntegratorSessionFixed.Type

/** A fresh-head FullRerun session superseded one quarantined session. */
export const IntegratorSuccessorSessionFixed = Schema.TaggedStruct("IntegratorSuccessorSessionFixed", {
  ...initiatedByCoordinator,
  direction: Schema.Literal("FullRerun"),
  directionAppliedAt: JournalPosition,
  predecessor: IntegratorSessionCorrelation,
  quarantineAt: JournalPosition,
  recordedAt: JournalPosition,
  runId: RunId,
  successor: IntegratorSessionCorrelation,
  successorGeneration: Schema.Literal(successorGeneration)
})
export type IntegratorSuccessorSessionFixed = typeof IntegratorSuccessorSessionFixed.Type

/** Dalph began one bounded call for an exact opaque Integrator run. */
export const IntegratorRunStarted = Schema.TaggedStruct("IntegratorRunStarted", {
  ...initiatedByCoordinator,
  recordedAt: JournalPosition,
  run: IntegratorRunCorrelation,
  runId: RunId
})
export type IntegratorRunStarted = typeof IntegratorRunStarted.Type

/** The Integrator returned its exact prepared-candidate or not-prepared result. */
export const IntegratorRunResultRecorded = Schema.TaggedStruct("IntegratorRunResultRecorded", {
  ...nonAction,
  recordedAt: JournalPosition,
  result: IntegratorResult,
  run: IntegratorRunCorrelation,
  runId: RunId
})
export type IntegratorRunResultRecorded = typeof IntegratorRunResultRecorded.Type

/** Dalph recorded intent before asking Git to qualify the Integrator candidate. */
export const IntegratorCandidateQualificationInitiated = Schema.TaggedStruct(
  "IntegratorCandidateQualificationInitiated",
  {
    ...initiatedByCoordinator,
    candidateText: IntegratorCandidateText,
    recordedAt: JournalPosition,
    run: IntegratorRunCorrelation,
    runId: RunId
  }
)
export type IntegratorCandidateQualificationInitiated = typeof IntegratorCandidateQualificationInitiated.Type

/** Git returned the object kind and ordered direct parents for the named candidate. */
export const IntegratorCandidateQualificationObserved = Schema.TaggedStruct(
  "IntegratorCandidateQualificationObserved",
  {
    candidateText: IntegratorCandidateText,
    ...nonAction,
    observation: IntegratorGitObservation,
    originatingActionRun: IntegratorRunCorrelation,
    recordedAt: JournalPosition,
    runId: RunId
  }
)
export type IntegratorCandidateQualificationObserved = typeof IntegratorCandidateQualificationObserved.Type

/** Dalph recorded the deterministic promotion request before any Git mutation. */
export const TargetPromotionRequested = Schema.TaggedStruct("TargetPromotionRequested", {
  ...initiatedByCoordinator,
  correlation: TargetPromotionCorrelation,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TargetPromotionRequested = typeof TargetPromotionRequested.Type

/** Dalph recorded one numbered compare-and-set attempt before asking Git. */
export const TargetPromotionAttemptRequested = Schema.TaggedStruct("TargetPromotionAttemptRequested", {
  ...initiatedByCoordinator,
  attemptOrdinal: TargetPromotionAttemptOrdinal,
  correlation: TargetPromotionCorrelation,
  reason: TargetPromotionAttemptReason,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TargetPromotionAttemptRequested = typeof TargetPromotionAttemptRequested.Type

/** Git proved the qualified candidate current or in target ancestry. */
export const TargetPromotionSucceeded = Schema.TaggedStruct("TargetPromotionSucceeded", {
  basis: TargetPromotionTerminalBasis,
  ...nonAction,
  correlation: TargetPromotionCorrelation,
  observation: TargetPromotionSuccessObservation,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TargetPromotionSucceeded = typeof TargetPromotionSucceeded.Type

/** Git proved the expected head or candidate ancestry was stale. */
export const TargetPromotionStale = Schema.TaggedStruct("TargetPromotionStale", {
  basis: TargetPromotionTerminalBasis,
  ...nonAction,
  correlation: TargetPromotionCorrelation,
  observation: TargetPromotionStaleObservation,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TargetPromotionStale = typeof TargetPromotionStale.Type

/** Three unresolved promotion attempts preserved the candidate and evidence. */
export const TargetPromotionNonConvergent = Schema.TaggedStruct("TargetPromotionNonConvergent", {
  attemptLimit: TargetPromotionAttemptLimit,
  attemptOrdinal: TargetPromotionAttemptOrdinal,
  correlation: TargetPromotionCorrelation,
  lastObservation: TargetPromotionNonConvergenceObservation,
  ...nonAction,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TargetPromotionNonConvergent = typeof TargetPromotionNonConvergent.Type

/** A conclusive integration result preserved the session for operator direction. */
export const IntegrationQuarantined = Schema.TaggedStruct("IntegrationQuarantined", {
  basis: IntegrationQuarantineBasis,
  correlation: IntegratorSessionCorrelation,
  ...nonAction,
  recordedAt: JournalPosition,
  runId: RunId
})
export type IntegrationQuarantined = typeof IntegrationQuarantined.Type

/** The provider run had no owned activity; this is evidence, not a crash event. */
export const IntegrationProviderRunActivityAbsent = Schema.TaggedStruct("IntegrationProviderRunActivityAbsent", {
  correlation: IntegratorSessionCorrelation,
  ...nonAction,
  detail: Schema.String,
  recordedAt: JournalPosition,
  run: IntegratorRunCorrelation,
  runId: RunId
})
export type IntegrationProviderRunActivityAbsent = typeof IntegrationProviderRunActivityAbsent.Type

/** Operator chose Retry or FullRerun for one exact quarantined session. */
export const IntegrationQuarantineDirectionApplied = Schema.TaggedStruct("IntegrationQuarantineDirectionApplied", {
  fingerprint: IntegrationQuarantineDirectionFingerprint,
  initiatedBy: WorkflowActor.cases.Operator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  recordedAt: JournalPosition,
  requestId: IntegrationQuarantineDirectionRequestId,
  runId: RunId
})
export type IntegrationQuarantineDirectionApplied = typeof IntegrationQuarantineDirectionApplied.Type

/** One focused task-completion occurrence retained with its own semantic facet. */
export const IntegrationFocusedCompletionOccurred = Schema.TaggedStruct("IntegrationFocusedCompletionOccurred", {
  event: Schema.Union([
    CompletionTaskAcknowledgedEvent,
    CompletionTaskAttemptIntendedEvent,
    CompletionTaskCandidateAncestryObservedEvent,
    CompletionTaskCandidateAncestryReadIntendedEvent,
    CompletionTaskIntendedEvent,
    PostPromotionBlockerCandidateAncestryReadIntendedEvent,
    PostPromotionBlockerCandidateAncestryObservedEvent,
    CompletionTaskRejectedEvent,
    CompletionTaskRequestLookupIntendedEvent,
    CompletionTaskRequestLookupObservedEvent,
    CompletionTaskResponseLostEvent
  ]),
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  recordedAt: JournalPosition,
  runId: RunId
})
export type IntegrationFocusedCompletionOccurred = typeof IntegrationFocusedCompletionOccurred.Type

/** One exact completion-claim replacement occurrence retained as a replacement step. */
export const IntegrationClaimReplacementOccurred = Schema.TaggedStruct("IntegrationClaimReplacementOccurred", {
  event: Schema.Union([
    CompletionClaimReplacedEvent,
    CompletionClaimReplacementAttemptIntendedEvent,
    CompletionClaimReplacementIntendedEvent
  ]),
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  recordedAt: JournalPosition,
  runId: RunId
})
export type IntegrationClaimReplacementOccurred = typeof IntegrationClaimReplacementOccurred.Type

/** One exact completion-claim deletion occurrence retained as a deletion step. */
export const IntegrationClaimDeletionOccurred = Schema.TaggedStruct("IntegrationClaimDeletionOccurred", {
  event: Schema.Union([
    CompletionClaimDeletedEvent,
    CompletionClaimDeletionAttemptIntendedEvent,
    CompletionClaimDeletionIntendedEvent,
    CompletionClaimDeletionReadObservedEvent
  ]),
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  recordedAt: JournalPosition,
  runId: RunId
})
export type IntegrationClaimDeletionOccurred = typeof IntegrationClaimDeletionOccurred.Type

/** One exact task-integration settlement occurrence retained as settlement evidence. */
export const IntegrationFinalitySettledOccurred = Schema.TaggedStruct("IntegrationFinalitySettledOccurred", {
  event: IntegrationFinalitySettledEvent,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  recordedAt: JournalPosition,
  runId: RunId
})
export type IntegrationFinalitySettledOccurred = typeof IntegrationFinalitySettledOccurred.Type

/** Every finality occurrence is one of the semantic completion, replacement, deletion, or settlement variants. */
export const IntegrationFinalityOccurred = Schema.Union([
  IntegrationClaimDeletionOccurred,
  IntegrationClaimReplacementOccurred,
  IntegrationFinalitySettledOccurred,
  IntegrationFocusedCompletionOccurred
])
export type IntegrationFinalityOccurred = typeof IntegrationFinalityOccurred.Type

/** Every historical occurrence added by #81/#82 remains in one closed union. */
export const HistoricalWorkflowOccurrence = Schema.Union([
  AttemptImplementationAbandoned,
  AttemptStoppageIntended,
  BranchCleanupOccurred,
  CancelledAttemptClaimNoReleaseObserved,
  CancelledAttemptImplementationResponsibilityRelinquished,
  IntegrationClaimDeletionOccurred,
  IntegrationClaimReplacementOccurred,
  IntegrationFinalitySettledOccurred,
  IntegrationFocusedCompletionOccurred,
  IntegrationProviderRunActivityAbsent,
  IntegrationQuarantineDirectionApplied,
  IntegrationQuarantined,
  IntegratorCandidateCleanupOccurred,
  IntegratorCandidateQualificationInitiated,
  IntegratorCandidateQualificationObserved,
  IntegratorRunResultRecorded,
  IntegratorRunStarted,
  IntegratorSessionFixed,
  IntegratorSuccessorSessionFixed,
  RunCancellationApplied,
  StoppedAttemptClaimPreserved,
  TargetPromotionAttemptRequested,
  TargetPromotionNonConvergent,
  TargetPromotionRequested,
  TargetPromotionStale,
  TargetPromotionSucceeded,
  TaskAttemptPlanned,
  TaskClaimAcquired,
  TaskClaimAcquisitionInitiated,
  TaskClaimReleased,
  TaskClaimReleaseInitiated,
  TaskWorktreeReady,
  TaskWorktreeReconciliationInitiated,
  WorktreeCleanupOccurred
])
export type HistoricalWorkflowOccurrence = typeof HistoricalWorkflowOccurrence.Type
