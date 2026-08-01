import { Schema } from "effect"
import {
  AcceptedResult,
  AttemptId,
  GitCommitSha,
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
  ClaimToken,
  ControlDirection,
  ControlDirectionApplicationOrdinal,
  ControlDirectionSubject,
  InitialControlPolicy,
  OperationId,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptWorktreeObservation,
  PlannedWorktreeReady,
  TrackerTarget,
  RunPolicyRevision,
  TaskWorkCapacity,
  TaskClaimRelease,
  TargetLineageObservation,
  TaskTrackerFactsObservation,
  WorkflowActor,
  WorkflowOperation,
  TaskClaimReacquisitionRequestId,
  IntegrationCandidateAgentReport,
  CandidateCorrectionLimit,
  CandidateContinuationLimit,
  IntegrationCandidateAgentReportOrdinal,
  IntegrationCandidateCorrelation,
  IntegrationCandidateGitObservation,
  IntegrationCandidateGitValidationAttemptOrdinal,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId
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
  IntegrationCandidateConstructionIntended: {
    correlation: IntegrationCandidateCorrelation,
    correctionLimit: CandidateCorrectionLimit,
    continuationLimit: CandidateContinuationLimit,
    ...initiatedByCoordinator,
    plannedAttempt: PlannedTaskAttempt
  },
  IntegrationCandidateAgentReported: {
    ...nonActionOccurrence,
    expectedCorrelation: IntegrationCandidateCorrelation,
    ordinal: IntegrationCandidateAgentReportOrdinal,
    report: IntegrationCandidateAgentReport
  },
  IntegrationCandidateGitObserved: {
    candidateCommit: GitCommitSha,
    correlation: IntegrationCandidateCorrelation,
    ...nonActionOccurrence,
    observation: IntegrationCandidateGitObservation
  },
  IntegrationCandidateConstructed: {
    candidateCommit: GitCommitSha,
    correlation: IntegrationCandidateCorrelation,
    ...nonActionOccurrence
  },
  IntegrationCandidateGitValidationFailed: {
    attemptOrdinal: IntegrationCandidateGitValidationAttemptOrdinal,
    candidateCommit: GitCommitSha,
    correlation: IntegrationCandidateCorrelation,
    detail: Schema.String,
    ...nonActionOccurrence
  },
  IntegrationCandidateCorrectionLimitReached: {
    correctionCount: Schema.Int.check(Schema.isGreaterThan(0)),
    correctionLimit: CandidateCorrectionLimit,
    correlation: IntegrationCandidateCorrelation,
    ...nonActionOccurrence
  },
  IntegrationCandidateContinuationLimitReached: {
    continuationCount: Schema.Int.check(Schema.isGreaterThan(0)),
    continuationLimit: CandidateContinuationLimit,
    correlation: IntegrationCandidateCorrelation,
    ...nonActionOccurrence
  },
  PlannedAttemptExecutorWorkReported: {
    ...nonActionOccurrence,
    ordinal: PlannedAttemptExecutorReportOrdinal,
    report: PlannedAttemptExecutorReport
  },
  PlannedAttemptExecutorWorkResponsibilityBegan: { ...initiatedByCoordinator, plannedAttempt: PlannedTaskAttempt },
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
  WorkflowRunTerminated: { ...nonActionOccurrence, disposition: Schema.Literal("Completed") }
})
export type RecordedCassetteEntry = typeof RecordedCassetteEntry.Type

/**
 * Provisional recorded format version. Incrementing it does not promise
 * backward compatibility until the project owner removes this comment.
 */
const currentRecordedCassetteVersion = 5
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
  integrationCandidateIds: Schema.Array(
    Schema.Struct({ from: IntegrationCandidateId, to: IntegrationCandidateId })
  ).check(consistentIdentityRenaming),
  integrationCandidateResourceLocators: Schema.Array(
    Schema.Struct({ from: IntegrationCandidateResourceLocator, to: IntegrationCandidateResourceLocator })
  ).check(consistentIdentityRenaming),
  integrationSessionIds: Schema.Array(Schema.Struct({ from: IntegrationSessionId, to: IntegrationSessionId })).check(
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
