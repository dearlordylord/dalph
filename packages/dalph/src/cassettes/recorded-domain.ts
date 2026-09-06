/* eslint-disable max-lines -- The versioned recorded-cassette schema stays one exhaustive compatibility boundary. */
import { Schema } from "effect"
import {
  AcceptedResult,
  AttemptId,
  IntegrationTarget,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskId,
  TaskBranchRef,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  AttemptChoice,
  AttemptQuiescenceProof,
  AttemptChoiceRequestId,
  AttemptChoiceSubject,
  ClaimToken,
  ControlDirection,
  ControlDirectionApplicationOrdinal,
  ControlDirectionSubject,
  InitialControlPolicy,
  OperationId,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptWorktreeObservation,
  PlannedWorktreeReady,
  TrackerTarget,
  RunPolicyRevision,
  TaskWorkCapacity,
  TaskClaimRelease,
  TaskClaimObservation,
  TargetLineageObservation,
  TaskTrackerFactsObservation,
  WorkflowActor,
  WorkflowOperation,
  TaskClaimReacquisitionRequestId,
  IntegratorSessionId,
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorSessionCorrelation,
  IntegratorGitObservation,
  IntegratorResult,
  IntegratorRunCorrelation,
  IntegratorSuccessorGeneration,
  JournalPosition,
  IntegrationQuarantineBasis,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineFailureDetail,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  TargetPromotionCorrelation,
  TargetPromotionSuccessObservation,
  TargetPromotionStaleObservation,
  TargetPromotionNonConvergenceObservation,
  TargetPromotionReconciliationDeferral,
  TargetPromotionAttemptLimit,
  TargetPromotionTerminalBasis,
  CompletionTaskClaim,
  CompletionClaimRequestOrdinal,
  CompletionClaimDeletionReadPurpose,
  CompletionClaimDeletionRequest,
  CompletionClaimCleanupObservation,
  CompletionSuccessObservation,
  CompletionTaskAcknowledgement,
  CompletionTaskRequest,
  CompletionTaskRequestLookup,
  PostPromotionBlockerClearAuthorization,
  PostPromotionBlockerCandidateAncestryObservation,
  CompletionTaskRequestOrdinal,
  TargetPromotionGitReadObservation,
  PlannedAttemptContinuationWitness,
  PlannedAttemptReplacementWitness,
  AttemptRestartAuthorityReadFailure,
  BranchCleanupAuthorization,
  BranchCleanupMutationResult,
  BranchCleanupObservation,
  CleanupMutationOrdinal,
  CleanupObservationOrdinal,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateCleanupObservation,
  WorktreeCleanupAuthorization,
  WorktreeCleanupMutationResult,
  WorktreeCleanupObservation,
  RunFinalityEvidence
} from "@dalph/orchestrator"

const initiatedByCoordinator = {
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction")
}
const nonActionOccurrence = { occurrenceClassification: Schema.Literal("NonActionOccurrence") }

/**
 * One domain meaning per journaled fact. Ordering belongs to the entry array;
 * physical journal keys, positions, payload versions, and storage encoding do
 * not belong to this boundary.
 */
export const RecordedCassetteEntry = Schema.TaggedUnion({
  /** Worktree cleanup preserves the exact owner, locator, disposition, and fresh Git evidence. */
  WorktreeCleanupAuthorized: {
    authorization: WorktreeCleanupAuthorization,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    occurrenceClassification: Schema.Literal("InitiatedAction")
  },
  WorktreeCleanupObservationIntended: {
    authorization: WorktreeCleanupAuthorization,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    operationId: OperationId,
    ordinal: CleanupObservationOrdinal
  },
  WorktreeCleanupObserved: {
    authorization: WorktreeCleanupAuthorization,
    observation: WorktreeCleanupObservation,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    operationId: OperationId,
    ordinal: CleanupObservationOrdinal
  },
  WorktreeCleanupAbsenceConfirmed: {
    authorization: WorktreeCleanupAuthorization,
    cause: Schema.Literals(["InitialAbsence", "MutationResponseReconciliation"]),
    observation: WorktreeCleanupObservation.cases.Absent,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    operationId: OperationId,
    ordinal: CleanupObservationOrdinal
  },
  WorktreeCleanupMutationIntended: {
    attempt: CleanupMutationOrdinal,
    authorization: WorktreeCleanupAuthorization,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    operationId: OperationId
  },
  WorktreeCleanupMutationResultRecorded: {
    attempt: CleanupMutationOrdinal,
    authorization: WorktreeCleanupAuthorization,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    operationId: OperationId,
    result: WorktreeCleanupMutationResult
  },
  WorktreeCleanupContradicted: {
    authorization: WorktreeCleanupAuthorization,
    detail: Schema.String,
    observation: WorktreeCleanupObservation,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    operationId: OperationId
  },
  WorktreeCleanupSettled: {
    authorization: WorktreeCleanupAuthorization,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    result: Schema.Union([
      WorktreeCleanupMutationResult.cases.Removed,
      WorktreeCleanupMutationResult.cases.AlreadyAbsent
    ])
  },
  /** Branch cleanup is a separate family and only follows a recorded worktree settlement. */
  BranchCleanupAuthorized: {
    authorization: BranchCleanupAuthorization,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    occurrenceClassification: Schema.Literal("InitiatedAction")
  },
  BranchCleanupObservationIntended: {
    authorization: BranchCleanupAuthorization,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    operationId: OperationId,
    ordinal: CleanupObservationOrdinal
  },
  BranchCleanupObserved: {
    authorization: BranchCleanupAuthorization,
    observation: BranchCleanupObservation,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    operationId: OperationId,
    ordinal: CleanupObservationOrdinal
  },
  BranchCleanupAbsenceConfirmed: {
    authorization: BranchCleanupAuthorization,
    cause: Schema.Literals(["InitialAbsence", "MutationResponseReconciliation"]),
    observation: BranchCleanupObservation.cases.Absent,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    operationId: OperationId,
    ordinal: CleanupObservationOrdinal
  },
  BranchCleanupMutationIntended: {
    attempt: CleanupMutationOrdinal,
    authorization: BranchCleanupAuthorization,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    operationId: OperationId
  },
  BranchCleanupMutationResultRecorded: {
    attempt: CleanupMutationOrdinal,
    authorization: BranchCleanupAuthorization,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    operationId: OperationId,
    result: BranchCleanupMutationResult
  },
  BranchCleanupContradicted: {
    authorization: BranchCleanupAuthorization,
    detail: Schema.String,
    observation: BranchCleanupObservation,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    operationId: OperationId
  },
  BranchCleanupSettled: {
    authorization: BranchCleanupAuthorization,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    result: Schema.Union([BranchCleanupMutationResult.cases.Removed, BranchCleanupMutationResult.cases.AlreadyAbsent])
  },
  /** Candidate cleanup retains predecessor session ownership and never widens to a successor. */
  IntegratorCandidateCleanupAuthorized: {
    authorization: IntegratorCandidateCleanupAuthorization,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    occurrenceClassification: Schema.Literal("InitiatedAction")
  },
  IntegratorCandidateCleanupObservationIntended: {
    authorization: IntegratorCandidateCleanupAuthorization,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    operationId: OperationId,
    ordinal: CleanupObservationOrdinal
  },
  IntegratorCandidateCleanupObserved: {
    authorization: IntegratorCandidateCleanupAuthorization,
    observation: IntegratorCandidateCleanupObservation,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    operationId: OperationId,
    ordinal: CleanupObservationOrdinal
  },
  IntegratorCandidateCleanupAbsenceConfirmed: {
    authorization: IntegratorCandidateCleanupAuthorization,
    cause: Schema.Literals(["InitialAbsence", "MutationResponseReconciliation"]),
    observation: IntegratorCandidateCleanupObservation.cases.Absent,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    operationId: OperationId,
    ordinal: CleanupObservationOrdinal
  },
  IntegratorCandidateCleanupMutationIntended: {
    attempt: CleanupMutationOrdinal,
    authorization: IntegratorCandidateCleanupAuthorization,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    operationId: OperationId
  },
  IntegratorCandidateCleanupMutationResultRecorded: {
    attempt: CleanupMutationOrdinal,
    authorization: IntegratorCandidateCleanupAuthorization,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    operationId: OperationId,
    result: IntegratorCandidateCleanupMutationResult
  },
  IntegratorCandidateCleanupContradicted: {
    authorization: IntegratorCandidateCleanupAuthorization,
    detail: Schema.String,
    observation: IntegratorCandidateCleanupObservation,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    operationId: OperationId
  },
  IntegratorCandidateCleanupSettled: {
    authorization: IntegratorCandidateCleanupAuthorization,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    result: Schema.Union([
      IntegratorCandidateCleanupMutationResult.cases.Removed,
      IntegratorCandidateCleanupMutationResult.cases.AlreadyAbsent
    ])
  },
  AttemptChoiceApplied: {
    choice: AttemptChoice,
    initiatedBy: WorkflowActor.cases.Operator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    requestId: AttemptChoiceRequestId,
    subject: AttemptChoiceSubject
  },
  PlannedAttemptReplaced: {
    ...initiatedByCoordinator,
    requestId: AttemptChoiceRequestId,
    subject: AttemptChoiceSubject,
    successorPlan: WorkflowOperation.cases.RecordTaskAttemptPlan,
    witness: PlannedAttemptReplacementWitness
  },
  AttemptRestartAuthorityReadFailed: {
    failure: AttemptRestartAuthorityReadFailure,
    ...nonActionOccurrence,
    operationId: OperationId,
    requestId: AttemptChoiceRequestId,
    subject: AttemptChoiceSubject
  },
  AttemptStoppageIntended: {
    ...initiatedByCoordinator,
    requestId: AttemptChoiceRequestId,
    subject: AttemptChoiceSubject
  },
  AttemptImplementationAbandoned: {
    expectedClaim: ActiveTaskClaim,
    ...initiatedByCoordinator,
    proof: AttemptQuiescenceProof,
    requestId: AttemptChoiceRequestId,
    subject: AttemptChoiceSubject
  },
  StoppedAttemptClaimNoReleaseObserved: {
    expectedClaim: ActiveTaskClaim,
    ...nonActionOccurrence,
    observation: TaskClaimObservation,
    observationOperationId: OperationId,
    requestId: AttemptChoiceRequestId,
    subject: AttemptChoiceSubject
  },
  CancelledAttemptImplementationResponsibilityRelinquished: {
    authorizedClaim: ActiveTaskClaim,
    cancellationAppliedAt: JournalPosition,
    ...initiatedByCoordinator,
    plannedAttempt: PlannedTaskAttempt,
    proof: AttemptQuiescenceProof
  },
  CancelledAttemptClaimNoReleaseObserved: {
    cancellationAppliedAt: JournalPosition,
    expectedClaim: ActiveTaskClaim,
    ...nonActionOccurrence,
    observation: TaskClaimObservation,
    observationOperationId: OperationId,
    plannedAttempt: PlannedTaskAttempt
  },
  ControlDirectionApplied: {
    direction: ControlDirection,
    initiatedBy: WorkflowActor.cases.Operator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    ordinal: ControlDirectionApplicationOrdinal,
    subject: ControlDirectionSubject
  },
  GitReadInitiated: {
    ...initiatedByCoordinator,
    operation: Schema.Union([WorkflowOperation.cases.ReadTaskWorktree, WorkflowOperation.cases.ReadTargetLineage])
  },
  IntegrationResponsibilityBegan: {
    acceptedResult: AcceptedResult,
    ...initiatedByCoordinator,
    integrationTarget: IntegrationTarget,
    plannedAttempt: PlannedTaskAttempt
  },
  IntegrationStarted: {
    acceptedResult: AcceptedResult,
    ...initiatedByCoordinator,
    integrationTarget: IntegrationTarget,
    plannedAttempt: PlannedTaskAttempt
  },
  /** Outer Integrator facts retain the exact correlation, including causal Journal positions. */
  IntegratorSessionFixed: { correlation: IntegratorSessionCorrelation },
  /** FullRerun preserves the quarantined predecessor while fixing one fresh-head successor. */
  IntegratorSuccessorSessionFixed: {
    direction: Schema.Literal("FullRerun"),
    directionAppliedAt: JournalPosition,
    predecessor: IntegratorSessionCorrelation,
    quarantineAt: JournalPosition,
    successor: IntegratorSessionCorrelation,
    successorGeneration: IntegratorSuccessorGeneration
  },
  /** Run-scoped Integrator facts retain the exact run ordinal and owning session. */
  IntegratorRunStarted: { run: IntegratorRunCorrelation },
  IntegratorRunResultRecorded: { result: IntegratorResult, run: IntegratorRunCorrelation },
  IntegratorRunCandidateGitReadIntended: { candidateText: IntegratorCandidateText, run: IntegratorRunCorrelation },
  IntegratorRunCandidateGitObserved: {
    candidateText: IntegratorCandidateText,
    observation: IntegratorGitObservation,
    run: IntegratorRunCorrelation
  },
  /** Quarantine facts retain the exact outer session, disposition evidence, and operator occurrence semantics. */
  IntegrationProviderRunActivityAbsent: {
    correlation: IntegratorSessionCorrelation,
    detail: IntegrationQuarantineFailureDetail,
    run: IntegratorRunCorrelation,
    ...nonActionOccurrence
  },
  IntegrationQuarantined: {
    basis: IntegrationQuarantineBasis,
    correlation: IntegratorSessionCorrelation,
    ...nonActionOccurrence
  },
  IntegrationQuarantineDirectionApplied: {
    fingerprint: IntegrationQuarantineDirectionFingerprint,
    initiatedBy: WorkflowActor.cases.Operator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    requestId: IntegrationQuarantineDirectionRequestId
  },
  TargetPromotionIntended: { correlation: TargetPromotionCorrelation, ...initiatedByCoordinator },
  TargetPromotionAttemptIntended: {
    attemptOrdinal: TargetPromotionAttemptOrdinal,
    correlation: TargetPromotionCorrelation,
    reason: TargetPromotionAttemptReason,
    ...initiatedByCoordinator
  },
  TargetPromotionReconciliationDeferred: {
    afterAttemptOrdinal: TargetPromotionAttemptOrdinal,
    correlation: TargetPromotionCorrelation,
    deferral: TargetPromotionReconciliationDeferral,
    ...nonActionOccurrence
  },
  TargetPromotionObservedSuccess: {
    basis: TargetPromotionTerminalBasis,
    correlation: TargetPromotionCorrelation,
    observation: TargetPromotionSuccessObservation,
    ...nonActionOccurrence
  },
  TargetPromotionStale: {
    basis: TargetPromotionTerminalBasis,
    correlation: TargetPromotionCorrelation,
    observation: TargetPromotionStaleObservation,
    ...nonActionOccurrence
  },
  TargetPromotionNonConvergence: {
    attemptLimit: TargetPromotionAttemptLimit,
    attemptOrdinal: TargetPromotionAttemptOrdinal,
    correlation: TargetPromotionCorrelation,
    lastObservation: TargetPromotionNonConvergenceObservation,
    ...nonActionOccurrence
  },
  CompletionClaimReplacementIntended: {
    claim: CompletionTaskClaim,
    ...initiatedByCoordinator,
    operationId: OperationId
  },
  CompletionClaimReplacementAttemptIntended: {
    attemptOrdinal: CompletionClaimRequestOrdinal,
    claim: CompletionTaskClaim,
    ...initiatedByCoordinator,
    operationId: OperationId
  },
  CompletionClaimReplaced: { claim: CompletionTaskClaim, ...nonActionOccurrence, operationId: OperationId },
  CompletionClaimDeletionIntended: {
    claim: CompletionTaskClaim,
    ...initiatedByCoordinator,
    operationId: OperationId,
    successObservation: CompletionSuccessObservation
  },
  CompletionClaimDeletionAttemptIntended: {
    attemptOrdinal: CompletionClaimRequestOrdinal,
    claim: CompletionTaskClaim,
    ...initiatedByCoordinator,
    operationId: OperationId,
    successObservation: CompletionSuccessObservation
  },
  CompletionClaimDeletionReadObserved: {
    observation: CompletionClaimCleanupObservation,
    ...nonActionOccurrence,
    purpose: CompletionClaimDeletionReadPurpose,
    replacementOperationId: OperationId,
    request: CompletionClaimDeletionRequest
  },
  CompletionClaimDeleted: {
    claim: CompletionTaskClaim,
    ...nonActionOccurrence,
    operationId: OperationId,
    successObservation: CompletionSuccessObservation
  },
  IntegrationFinalitySettled: {
    claim: CompletionTaskClaim,
    ...nonActionOccurrence,
    deletionOperationId: OperationId,
    replacementOperationId: OperationId,
    successObservation: CompletionSuccessObservation
  },
  CompletionTaskIntended: { ...initiatedByCoordinator, request: CompletionTaskRequest },
  CompletionTaskAttemptIntended: {
    attemptOrdinal: CompletionTaskRequestOrdinal,
    focusedFactsOperationId: OperationId,
    gitReadOperationId: OperationId,
    ...initiatedByCoordinator,
    request: CompletionTaskRequest
  },
  CompletionTaskAcknowledged: {
    acknowledgement: CompletionTaskAcknowledgement,
    attemptOrdinal: CompletionTaskRequestOrdinal,
    ...nonActionOccurrence,
    request: CompletionTaskRequest
  },
  CompletionTaskResponseLost: {
    attemptOrdinal: CompletionTaskRequestOrdinal,
    ...nonActionOccurrence,
    request: CompletionTaskRequest
  },
  CompletionTaskRejected: {
    attemptOrdinal: CompletionTaskRequestOrdinal,
    detail: Schema.String,
    ...nonActionOccurrence,
    request: CompletionTaskRequest
  },
  CompletionTaskCandidateAncestryReadIntended: {
    attemptOrdinal: CompletionTaskRequestOrdinal,
    operationId: OperationId,
    ...initiatedByCoordinator,
    request: CompletionTaskRequest
  },
  CompletionTaskCandidateAncestryObserved: {
    attemptOrdinal: CompletionTaskRequestOrdinal,
    observation: TargetPromotionGitReadObservation,
    operationId: OperationId,
    ...nonActionOccurrence,
    request: CompletionTaskRequest
  },
  PostPromotionBlockerCandidateAncestryReadIntended: {
    authorization: PostPromotionBlockerClearAuthorization,
    operationId: OperationId,
    ...initiatedByCoordinator
  },
  PostPromotionBlockerCandidateAncestryObserved: {
    authorization: PostPromotionBlockerClearAuthorization,
    observation: PostPromotionBlockerCandidateAncestryObservation,
    operationId: OperationId,
    ...nonActionOccurrence
  },
  CompletionTaskRequestLookupIntended: {
    attemptOrdinal: CompletionTaskRequestOrdinal,
    operationId: OperationId,
    ...initiatedByCoordinator,
    request: CompletionTaskRequest
  },
  CompletionTaskRequestLookupObserved: {
    attemptOrdinal: CompletionTaskRequestOrdinal,
    lookup: CompletionTaskRequestLookup,
    operationId: OperationId,
    ...nonActionOccurrence,
    request: CompletionTaskRequest
  },
  PlannedAttemptExecutorWorkReported: {
    ...nonActionOccurrence,
    ordinal: PlannedAttemptExecutorReportOrdinal,
    report: PlannedAttemptExecutorReport
  },
  PlannedAttemptExecutorCommandIntended: {
    command: Schema.Literals(["Begin", "Resume", "Suspend"]),
    ...initiatedByCoordinator,
    ordinal: PlannedAttemptExecutorCommandOrdinal,
    plannedAttempt: PlannedTaskAttempt
  },
  PlannedAttemptExecutorCommandProjectionObserved: {
    commandOrdinal: PlannedAttemptExecutorCommandOrdinal,
    ...nonActionOccurrence,
    observation: PlannedAttemptExecutorCommandProjectionObservation,
    plannedAttempt: PlannedTaskAttempt,
    projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal
  },
  PlannedAttemptExecutorCommandResponseObserved: {
    commandOrdinal: PlannedAttemptExecutorCommandOrdinal,
    ...nonActionOccurrence,
    plannedAttempt: PlannedTaskAttempt,
    report: PlannedAttemptExecutorReport
  },
  PlannedAttemptExecutorCommandResponseContradicted: {
    commandOrdinal: PlannedAttemptExecutorCommandOrdinal,
    ...nonActionOccurrence,
    observed: PlannedAttemptExecutorReport,
    plannedAttempt: PlannedTaskAttempt
  },
  PlannedAttemptExecutorStateObserved: {
    ...nonActionOccurrence,
    observation: PlannedAttemptExecutorStateObservation,
    ordinal: PlannedAttemptExecutorStateObservationOrdinal,
    plannedAttempt: PlannedTaskAttempt
  },
  PlannedAttemptExecutorWorkResponsibilityBegan: { ...initiatedByCoordinator, plannedAttempt: PlannedTaskAttempt },
  /** Internal journal authorization; it is not a workflow occurrence. */
  PlannedAttemptContinuationAuthorized: {
    plannedAttempt: PlannedTaskAttempt,
    witness: PlannedAttemptContinuationWitness
  },
  PlannedAttemptWorktreeObserved: {
    ...nonActionOccurrence,
    observation: PlannedAttemptWorktreeObservation,
    originatingActionOperationId: OperationId
  },
  TargetLineageObserved: {
    ...nonActionOccurrence,
    observation: TargetLineageObservation,
    originatingActionOperationId: OperationId,
    plannedAttempt: PlannedTaskAttempt
  },
  TaskAttemptPlanned: { operation: WorkflowOperation.cases.RecordTaskAttemptPlan },
  TaskClaimAcquired: { claim: ActiveTaskClaim },
  TaskClaimAcquisitionIntended: { operation: WorkflowOperation.cases.AcquireTaskClaim },
  TaskClaimAcquisitionRejected: {
    observed: ActiveTaskClaim,
    operationId: OperationId,
    reason: Schema.Literal("ForeignClaim")
  },
  TaskClaimReleaseIntended: { operation: WorkflowOperation.cases.ReleaseTaskClaim },
  TaskClaimReleased: { release: TaskClaimRelease },
  TaskClaimReacquisitionDirected: {
    initiatedBy: WorkflowActor.cases.Operator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    requestId: TaskClaimReacquisitionRequestId,
    taskId: TaskId
  },
  TaskTrackerFactsObserved: {
    evidence: TaskTrackerFactsObservation,
    ...nonActionOccurrence,
    originatingActionOperationId: OperationId
  },
  TaskTrackerReadInitiated: {
    ...initiatedByCoordinator,
    operation: Schema.Union([
      WorkflowOperation.cases.ReadCompletionTaskFacts,
      WorkflowOperation.cases.ReadTaskClaim,
      WorkflowOperation.cases.ReadTrackerGraph,
      WorkflowOperation.cases.ReadTaskWorkSpecification
    ])
  },
  TaskWorktreeReady: { operationId: OperationId, proof: PlannedWorktreeReady },
  TaskWorktreeReconciliationIntended: { operation: WorkflowOperation.cases.ReconcileTaskWorktree },
  TaskWorkCapacityChanged: {
    capacity: TaskWorkCapacity,
    initiatedBy: WorkflowActor.cases.Operator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    previousRevision: RunPolicyRevision,
    revision: RunPolicyRevision
  },
  WorkflowRunBegan: { ...initiatedByCoordinator, initialControlPolicy: InitialControlPolicy, target: TrackerTarget },
  WorkflowRunTerminated: {
    ...nonActionOccurrence,
    disposition: Schema.Literals(["Completed", "Blocked", "Cancelled"]),
    evidence: RunFinalityEvidence
  },
  RunCancellationApplied: {
    initiatedBy: WorkflowActor.cases.Operator,
    occurrenceClassification: Schema.Literal("InitiatedAction")
  }
})
export type RecordedCassetteEntry = typeof RecordedCassetteEntry.Type

/**
 * Provisional recorded format version. Version 14 records active-work
 * authority refreshes through the ordinary tracker and Git read vocabulary.
 * Recorded cassettes remain fail-closed at the current version; this change
 * does not claim a migration path for the unreleased version 13 draft.
 */
const currentRecordedCassetteVersion = 14
export const recordedCassetteVersion = currentRecordedCassetteVersion

export const RecordedCassette = Schema.TaggedStruct("RecordedCassette", {
  entries: Schema.Array(RecordedCassetteEntry),
  runId: RunId,
  schemaVersion: Schema.Literal(recordedCassetteVersion)
})
export type RecordedCassette = typeof RecordedCassette.Type

const consistentIdentityRenaming = Schema.makeFilter(
  (renamings: ReadonlyArray<{ readonly from: string; readonly to: string }>) => {
    const from = new Set(renamings.map(({ from }) => from))
    const to = new Set(renamings.map(({ to }) => to))
    return from.size === renamings.length && to.size === renamings.length
      ? undefined
      : "identity renaming must be one-to-one and assign each source only once"
  }
)

/** One explicit, consistent alpha-renaming for generated cassette identities. */
export const CassetteIdentityRenaming = Schema.Struct({
  attemptIds: Schema.Array(Schema.Struct({ from: AttemptId, to: AttemptId })).check(consistentIdentityRenaming),
  integratorCandidateResourceLocators: Schema.Array(
    Schema.Struct({ from: IntegratorCandidateResourceLocator, to: IntegratorCandidateResourceLocator })
  ).check(consistentIdentityRenaming),
  integratorSessionIds: Schema.Array(Schema.Struct({ from: IntegratorSessionId, to: IntegratorSessionId })).check(
    consistentIdentityRenaming
  ),
  claimTokens: Schema.Array(Schema.Struct({ from: ClaimToken, to: ClaimToken })).check(consistentIdentityRenaming),
  operationIds: Schema.Array(Schema.Struct({ from: OperationId, to: OperationId })).check(consistentIdentityRenaming),
  runIds: Schema.Array(Schema.Struct({ from: RunId, to: RunId })).check(consistentIdentityRenaming),
  taskBranchRefs: Schema.Array(Schema.Struct({ from: TaskBranchRef, to: TaskBranchRef })).check(
    consistentIdentityRenaming
  ),
  worktreeLocators: Schema.Array(Schema.Struct({ from: WorktreeLocator, to: WorktreeLocator })).check(
    consistentIdentityRenaming
  )
})
export type CassetteIdentityRenaming = typeof CassetteIdentityRenaming.Type
