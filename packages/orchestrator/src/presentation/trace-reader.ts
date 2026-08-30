/* eslint-disable functional/immutable-data, max-lines -- Prefix validation and relationship indexes are private read-side scratch. */
import { Context, Deferred, Effect, HashMap, Layer, Option, Schema } from "effect"
import {
  AcceptedResult,
  AttemptId,
  GitCommitSha,
  IntegrationTarget,
  PlannedTaskAttempt,
  RunId,
  TaskId
} from "@dalph/contracts"
import { TaskDagWire } from "../authorities/task-tracker/graph.js"
import { taskTrackerTargetKey, type TrackerTarget } from "../authorities/task-tracker/target.js"
import { JournalPosition, JournalRecordKey } from "../workflow-journal/identity.js"
import {
  JournalReadSource,
  journalReadSourceLayer,
  type JournalReadSourceService
} from "../workflow-journal/read-source.js"
import type { JournalRecord, JournalStoreError } from "../workflow-journal/store.js"
import { OperationId } from "../workflow/identity.js"
import { WorkflowRunBeganEvent, type WorkflowJournalEvent } from "../workflow/registry/event.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import { workflowOperationId, type WorkflowOperation } from "../workflow/registry/operation.js"
import {
  projectWorkflowOccurrences,
  WorkflowOccurrence,
  type WorkflowOccurrence as WorkflowOccurrenceValue
} from "../workflow/registry/occurrence-projection.js"
import {
  IntegratorCandidateText,
  IntegratorGitObservation,
  IntegratorResult,
  IntegratorRunCorrelation,
  IntegratorSessionCorrelation
} from "../workflow/protocols/integrator/events.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineDirectionFingerprint
} from "../workflow/protocols/integration-quarantine/events.js"
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
} from "../workflow/protocols/integration-finality/events.js"
import type { IntegrationFinalityJournalEvent } from "../workflow/protocols/integration-finality/events.js"
import type { CompletionSuccessObservation } from "../workflow/protocols/integration-finality/completion-claim.js"
import {
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  TargetPromotionCorrelation,
  TargetPromotionNonConvergenceObservation,
  TargetPromotionStaleObservation,
  TargetPromotionSuccessObservation,
  TargetPromotionTerminalBasis
} from "../workflow/protocols/target-promotion/events.js"
import { AttemptRestartAuthorityReadFailure } from "../workflow/protocols/attempt-choice/replacement-events.js"
import {
  AttemptChoice,
  AttemptChoiceRequestId,
  AttemptChoiceSubject,
  AttemptQuiescenceProof
} from "../workflow/protocols/attempt-choice/events.js"
import { ActiveTaskClaim, TaskClaimObservation } from "../authorities/task-tracker/claim-mutation.js"
import {
  PlannedAttemptWorktreeObservation,
  PlannedWorktreeReady
} from "../workflow/protocols/planned-attempt-worktree-observation/protocol.js"
import {
  CompleteTaskTrackerFactsObserved as CompleteTaskTrackerFactsObservedSchema,
  UnchangedTaskTrackerFactsReconfirmed as UnchangedTaskTrackerFactsReconfirmedSchema,
  type CompleteTaskTrackerFactsObserved,
  type TaskTrackerFactsObservation,
  type UnchangedTaskTrackerFactsReconfirmed
} from "../workflow/task-tracker-facts/observation.js"
import { reconstructedTaskGraphFor } from "../coordination/reconstruction/graph-knowledge.js"
import {
  makeIntegrationFinalityHistoryIndexes,
  validateIntegrationFinalityHistoryRecord
} from "../workflow/protocols/integration-finality/history.js"
import { validateIntegrationHistoryRecord } from "../coordination/reconstruction/integration-history-validation.js"
import { invalidWorkflowRunBinding } from "../coordination/reconstruction/integration-history-run-binding.js"
import {
  validateAttemptStopHistory,
  validateCancellationMultiplicityHistory
} from "../coordination/reconstruction/history.js"
import { validateCancelledAttemptHistoryPrefix } from "../coordination/reconstruction/cancelled-attempt-history.js"
import {
  workflowJournalHistoryIssueDetail,
  type WorkflowJournalHistorySemanticIssue
} from "../coordination/reconstruction/history-result.js"
import { makeIntegrationHistoryIndexes } from "../coordination/reconstruction/integration-history.js"
import type { CurrentSignal } from "../coordination/delivery/relations.js"
import {
  traceHistoricalFacetsAt,
  traceHistoricalFacetsIssue,
  type HistoricalFacetFactories
} from "./trace-reader-historical-facets.js"
import { sameJson } from "./trace-equality.js"
import {
  ControlDirectionSubject,
  ControlDirectionApplicationOrdinal
} from "../workflow/protocols/control-direction-application/events.js"
import { WorkflowActor } from "../workflow/registry/actor.js"
import {
  BranchCleanupAuthorization,
  IntegratorCandidateCleanupAuthorization,
  WorktreeCleanupAuthorization
} from "../workflow/protocols/disposition-cleanup/disposition.js"
import { BranchCleanupJournalEvent } from "../workflow/protocols/disposition-cleanup/branch.js"
import { IntegratorCandidateCleanupJournalEvent } from "../workflow/protocols/disposition-cleanup/integrator-candidate.js"
import { WorktreeCleanupJournalEvent } from "../workflow/protocols/disposition-cleanup/worktree.js"
import {
  validateBranchCleanupHistory,
  validateIntegratorCandidateCleanupHistory,
  validateIntegratorCandidateCleanupProvenance,
  validateSettledWorktreeForBranch,
  validateWorktreeCleanupHistory,
  validateWorktreeCleanupProvenance
} from "../workflow/protocols/disposition-cleanup/provenance.js"
import { traceControlDispositionFacetVersion } from "./trace-reader-version.js"

export { traceControlDispositionFacetVersion } from "./trace-reader-version.js"

/** Version of the immutable production trace contract consumed by presentation. */
export const traceReaderSchemaVersion = 4 as const // eslint-disable-line no-magic-numbers

/**
 * Identifies one exact committed journal position in one Run. Cursors and
 * projected occurrence identities intentionally use this same schema so a
 * presentation value cannot silently substitute a view-local position.
 */
export const TracePositionIdentity = Schema.Struct({ runId: RunId, position: JournalPosition }).pipe(
  Schema.brand("TracePositionIdentity")
)
export type TracePositionIdentity = typeof TracePositionIdentity.Type

/** A fixed historical boundary in the committed Run prefix. */
export const TraceCursor = TracePositionIdentity
export type TraceCursor = TracePositionIdentity

/** Identity retained for every projected workflow occurrence. */
export const TraceItemIdentity = TracePositionIdentity
export type TraceItemIdentity = TracePositionIdentity

/** One task-graph relationship. Prerequisites and grouping are never merged. */
export const TraceTaskGraphEdge = Schema.TaggedUnion({
  Grouping: { childTaskId: TaskId, parentTaskId: TaskId },
  Prerequisite: { dependantTaskId: TaskId, prerequisiteTaskId: TaskId }
})
export type TraceTaskGraphEdge = typeof TraceTaskGraphEdge.Type

/** One explicit workflow OperationId predecessor relationship. */
export const TraceWorkflowCausalEdge = Schema.Struct({
  predecessorOperationId: OperationId,
  successorOperationId: OperationId
})
export type TraceWorkflowCausalEdge = typeof TraceWorkflowCausalEdge.Type

/** One read result acknowledged by the outside authority it queried. */
export const TraceOutsideAuthorityAcknowledgement = Schema.Struct({
  actionOperationId: OperationId,
  action: TraceItemIdentity,
  observation: TraceItemIdentity
})
export type TraceOutsideAuthorityAcknowledgement = typeof TraceOutsideAuthorityAcknowledgement.Type

/** One process-local resource relationship retained separately from workflow causality. */
export const TraceProcessLocalResourceSerialization = Schema.Struct({
  later: TraceItemIdentity,
  earlier: TraceItemIdentity,
  target: IntegrationTarget
})
export type TraceProcessLocalResourceSerialization = typeof TraceProcessLocalResourceSerialization.Type

/** Relationships are grouped by their distinct meaning for presentation consumers. */
export const TraceRelationships = Schema.Struct({
  outsideAuthorityAcknowledgements: Schema.Array(TraceOutsideAuthorityAcknowledgement),
  processLocalResourceSerializations: Schema.Array(TraceProcessLocalResourceSerialization),
  taskGraphEdges: Schema.Array(TraceTaskGraphEdge),
  workflowCausalEdges: Schema.Array(TraceWorkflowCausalEdge)
})
export type TraceRelationships = typeof TraceRelationships.Type

/** Deterministic task order is derived display data and never changes recorded order. */
export const TraceDerivedTaskOrder = Schema.TaggedStruct("DerivedTaskOrder", {
  basis: Schema.Literal("TaskIdCodeUnitAscending"),
  taskIds: Schema.Array(TaskId)
})
export type TraceDerivedTaskOrder = typeof TraceDerivedTaskOrder.Type

/** Graph reconstructed from the latest complete tracker observation at a cursor. */
export const TraceTaskGraph = Schema.Struct({
  edges: Schema.Array(TraceTaskGraphEdge),
  observation: Schema.Struct({ operationId: OperationId, recordedAt: JournalPosition }),
  snapshot: TaskDagWire
})
export type TraceTaskGraph = typeof TraceTaskGraph.Type

/** A committed action whose owning boundary observation is absent at a cursor. */
export const TraceObservationGap = Schema.TaggedUnion({
  CandidateQualification: {
    action: TraceItemIdentity,
    candidateText: IntegratorCandidateText,
    run: IntegratorRunCorrelation
  },
  ExecutorReport: { action: TraceItemIdentity, attemptId: AttemptId },
  GitObservation: {
    action: TraceItemIdentity,
    operationId: OperationId,
    required: Schema.Literals(["PlannedAttemptWorktreeObserved", "TargetLineageObserved", "TaskWorktreeReady"]),
    taskIds: Schema.Array(TaskId)
  },
  IntegratorResult: { action: TraceItemIdentity, run: IntegratorRunCorrelation },
  PromotionResult: {
    action: TraceItemIdentity,
    attemptOrdinal: TargetPromotionAttemptOrdinal,
    correlation: TargetPromotionCorrelation
  },
  TrackerObservation: {
    action: TraceItemIdentity,
    operationId: OperationId,
    required: Schema.Literals(["TaskClaimAcquired", "TaskClaimReleased", "TaskTrackerFactsObserved"]),
    taskIds: Schema.Array(TaskId)
  }
})
export type TraceObservationGap = typeof TraceObservationGap.Type

/** One exact responsibility still retained by the committed prefix. */
export const TraceRetainedResponsibility = Schema.TaggedUnion({
  ExecutorWork: { plannedAttempt: PlannedTaskAttempt, source: TraceItemIdentity },
  TaskClaim: { claim: ActiveTaskClaim, source: TraceItemIdentity },
  TaskAttempt: { plannedAttempt: PlannedTaskAttempt, source: TraceItemIdentity },
  Worktree: { plannedAttempt: PlannedTaskAttempt, proof: PlannedWorktreeReady, source: TraceItemIdentity }
})
export type TraceRetainedResponsibility = typeof TraceRetainedResponsibility.Type

/** A concrete historical preservation disposition, never a generic archive state. */
export const TracePreservationDisposition = Schema.TaggedUnion({
  IntegrationQuarantined: {
    basis: IntegrationQuarantineBasis,
    correlation: IntegratorSessionCorrelation,
    source: TraceItemIdentity
  },
  NonConvergentPromotion: {
    correlation: TargetPromotionCorrelation,
    lastObservation: TargetPromotionNonConvergenceObservation,
    source: TraceItemIdentity
  },
  ReplacementPending: { choice: AttemptChoiceSubject, source: TraceItemIdentity },
  TaskAuthorityConflict: {
    failure: AttemptRestartAuthorityReadFailure,
    source: TraceItemIdentity,
    subject: AttemptChoiceSubject
  },
  WorktreeLost: {
    observation: PlannedAttemptWorktreeObservation,
    plannedAttempt: PlannedTaskAttempt,
    source: TraceItemIdentity
  }
})
export type TracePreservationDisposition = typeof TracePreservationDisposition.Type

/** Generic recovery explanation derived from one validated immutable prefix. */
export const TraceRecoveryFacet = Schema.Struct({
  observationGaps: Schema.Array(TraceObservationGap),
  preservationDispositions: Schema.Array(TracePreservationDisposition),
  retainedResponsibilities: Schema.Array(TraceRetainedResponsibility)
})
export type TraceRecoveryFacet = typeof TraceRecoveryFacet.Type

/** Integration facts retain the exact source identity for every presentation claim. */
export const TraceIntegrationFact = Schema.TaggedUnion({
  AcceptedResult: { acceptedResult: AcceptedResult, plannedAttempt: PlannedTaskAttempt, source: TraceItemIdentity },
  CandidateObserved: {
    candidateText: IntegratorCandidateText,
    observation: IntegratorGitObservation,
    run: IntegratorRunCorrelation,
    source: TraceItemIdentity
  },
  CandidateQualification: {
    candidateCommit: GitCommitSha,
    candidateText: IntegratorCandidateText,
    directParents: Schema.Tuple([GitCommitSha, GitCommitSha]),
    run: IntegratorRunCorrelation,
    source: TraceItemIdentity
  },
  FocusedCompletion: {
    event: Schema.Union([
      CompletionTaskAcknowledgedEvent,
      CompletionTaskAttemptIntendedEvent,
      CompletionTaskCandidateAncestryObservedEvent,
      CompletionTaskCandidateAncestryReadIntendedEvent,
      CompletionTaskIntendedEvent,
      CompletionTaskRejectedEvent,
      CompletionTaskRequestLookupIntendedEvent,
      CompletionTaskRequestLookupObservedEvent,
      CompletionTaskResponseLostEvent,
      PostPromotionBlockerCandidateAncestryReadIntendedEvent,
      PostPromotionBlockerCandidateAncestryObservedEvent
    ]),
    source: TraceItemIdentity
  },
  ClaimReplacement: {
    event: Schema.Union([
      CompletionClaimReplacedEvent,
      CompletionClaimReplacementAttemptIntendedEvent,
      CompletionClaimReplacementIntendedEvent
    ]),
    source: TraceItemIdentity
  },
  ClaimDeletion: {
    event: Schema.Union([
      CompletionClaimDeletedEvent,
      CompletionClaimDeletionAttemptIntendedEvent,
      CompletionClaimDeletionIntendedEvent,
      CompletionClaimDeletionReadObservedEvent
    ]),
    source: TraceItemIdentity
  },
  Settlement: { event: IntegrationFinalitySettledEvent, source: TraceItemIdentity },
  DependantRelease: {
    graphObservation: Schema.Union([
      CompleteTaskTrackerFactsObservedSchema,
      UnchangedTaskTrackerFactsReconfirmedSchema
    ]),
    graphSource: TraceItemIdentity,
    settlement: IntegrationFinalitySettledEvent,
    settlementSource: TraceItemIdentity,
    source: TraceItemIdentity
  },
  IntegratorResult: { result: IntegratorResult, run: IntegratorRunCorrelation, source: TraceItemIdentity },
  Quarantine: {
    basis: IntegrationQuarantineBasis,
    correlation: IntegratorSessionCorrelation,
    source: TraceItemIdentity
  },
  Responsibility: {
    acceptedResult: AcceptedResult,
    plannedAttempt: PlannedTaskAttempt,
    sameTargetPredecessor: Schema.NullOr(TraceItemIdentity),
    source: TraceItemIdentity,
    target: IntegrationTarget
  },
  Session: { correlation: IntegratorSessionCorrelation, source: TraceItemIdentity },
  SessionStarted: { responsibility: TraceItemIdentity, source: TraceItemIdentity, target: IntegrationTarget },
  PromotionRequested: {
    basis: Schema.Literal("BeforeFirstAttempt"),
    correlation: TargetPromotionCorrelation,
    source: TraceItemIdentity
  },
  PromotionAttempt: {
    attemptOrdinal: TargetPromotionAttemptOrdinal,
    correlation: TargetPromotionCorrelation,
    reason: TargetPromotionAttemptReason,
    source: TraceItemIdentity
  },
  PromotionSucceeded: {
    basis: TargetPromotionTerminalBasis,
    correlation: TargetPromotionCorrelation,
    observation: TargetPromotionSuccessObservation,
    source: TraceItemIdentity
  },
  PromotionStale: {
    basis: TargetPromotionTerminalBasis,
    correlation: TargetPromotionCorrelation,
    observation: TargetPromotionStaleObservation,
    source: TraceItemIdentity
  },
  PromotionNonConvergent: {
    attemptOrdinal: TargetPromotionAttemptOrdinal,
    basis: Schema.Literal("AfterAttempt"),
    correlation: TargetPromotionCorrelation,
    lastObservation: TargetPromotionNonConvergenceObservation,
    source: TraceItemIdentity
  },
  ProviderActivityAbsent: {
    correlation: IntegratorSessionCorrelation,
    run: IntegratorRunCorrelation,
    source: TraceItemIdentity
  },
  QuarantineDirection: { fingerprint: IntegrationQuarantineDirectionFingerprint, source: TraceItemIdentity }
})
export type TraceIntegrationFact = typeof TraceIntegrationFact.Type

/** One Operator direction or choice proved by an applied occurrence. */
export const TraceControlFact = Schema.TaggedUnion({
  AttemptChoice: {
    choice: AttemptChoice,
    initiatedBy: WorkflowActor.cases.Operator,
    requestId: AttemptChoiceRequestId,
    source: TraceItemIdentity,
    subject: AttemptChoiceSubject
  },
  Direction: {
    direction: Schema.Literals(["Pause", "Unpause"]),
    initiatedBy: WorkflowActor.cases.Operator,
    ordinal: ControlDirectionApplicationOrdinal,
    source: TraceItemIdentity,
    subject: ControlDirectionSubject
  }
})
export type TraceControlFact = typeof TraceControlFact.Type

/** One durable Run or attempt disposition with its exact source occurrence. */
export const TraceDispositionFact = Schema.TaggedUnion({
  AttemptAbandoned: {
    expectedClaim: ActiveTaskClaim,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    proof: AttemptQuiescenceProof,
    requestId: AttemptChoiceRequestId,
    source: TraceItemIdentity,
    subject: AttemptChoiceSubject
  },
  CancelledAttemptClaimPreserved: {
    cancellationAppliedAt: JournalPosition,
    expectedClaim: ActiveTaskClaim,
    observation: TaskClaimObservation,
    observationOperationId: OperationId,
    plannedAttempt: PlannedTaskAttempt,
    source: TraceItemIdentity
  },
  CancelledAttemptResponsibilityRelinquished: {
    authorizedClaim: ActiveTaskClaim,
    cancellationAppliedAt: JournalPosition,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    plannedAttempt: PlannedTaskAttempt,
    proof: AttemptQuiescenceProof,
    source: TraceItemIdentity
  },
  AttemptClaimPreserved: {
    expectedClaim: ActiveTaskClaim,
    observation: TaskClaimObservation,
    observationOperationId: OperationId,
    requestId: AttemptChoiceRequestId,
    source: TraceItemIdentity,
    subject: AttemptChoiceSubject
  },
  IntegrationQuarantine: {
    basis: IntegrationQuarantineBasis,
    correlation: IntegratorSessionCorrelation,
    source: TraceItemIdentity
  },
  IntegratorCandidatePreserved: {
    predecessor: IntegratorSessionCorrelation,
    source: TraceItemIdentity,
    successor: IntegratorSessionCorrelation
  },
  NonConvergentPromotion: {
    correlation: TargetPromotionCorrelation,
    lastObservation: TargetPromotionNonConvergenceObservation,
    source: TraceItemIdentity
  },
  ReplacementPending: { choice: AttemptChoiceSubject, source: TraceItemIdentity },
  RunCancellationApplied: { initiatedBy: WorkflowActor.cases.Operator, source: TraceItemIdentity },
  TaskAuthorityConflict: {
    failure: AttemptRestartAuthorityReadFailure,
    source: TraceItemIdentity,
    subject: AttemptChoiceSubject
  },
  WorktreeLost: {
    observation: PlannedAttemptWorktreeObservation,
    plannedAttempt: PlannedTaskAttempt,
    source: TraceItemIdentity
  }
})
export type TraceDispositionFact = typeof TraceDispositionFact.Type

/** One cleanup step retains the exact family-specific event and source cursor. */
export const TraceWorktreeCleanupStep = Schema.Struct({ event: WorktreeCleanupJournalEvent, source: TraceItemIdentity })
export type TraceWorktreeCleanupStep = typeof TraceWorktreeCleanupStep.Type

/** One branch cleanup step retains the exact family-specific event and source cursor. */
export const TraceBranchCleanupStep = Schema.Struct({ event: BranchCleanupJournalEvent, source: TraceItemIdentity })
export type TraceBranchCleanupStep = typeof TraceBranchCleanupStep.Type

/** One Integrator predecessor cleanup step retains its exact event and source cursor. */
export const TraceIntegratorCandidateCleanupStep = Schema.Struct({
  event: IntegratorCandidateCleanupJournalEvent,
  source: TraceItemIdentity
})
export type TraceIntegratorCandidateCleanupStep = typeof TraceIntegratorCandidateCleanupStep.Type

/** Last committed state of one exact cleanup authorization. */
export const TraceCleanupStatus = Schema.TaggedUnion({
  Absent: { source: TraceItemIdentity },
  Authorized: { source: TraceItemIdentity },
  Contradicted: { detail: Schema.String, source: TraceItemIdentity },
  MutationPending: { source: TraceItemIdentity },
  MutationResultRecorded: {
    result: Schema.Literals(["AlreadyAbsent", "DefinitelyNotApplied", "Removed", "Unknown"]),
    source: TraceItemIdentity
  },
  ObservationPending: { source: TraceItemIdentity },
  Present: { source: TraceItemIdentity },
  Settled: { result: Schema.Literals(["AlreadyAbsent", "Removed"]), source: TraceItemIdentity }
})
export type TraceCleanupStatus = typeof TraceCleanupStatus.Type

/** Worktree cleanup progress; the authorization and every step name one source identity. */
export const TraceWorktreeCleanupProgress = Schema.TaggedStruct("Worktree", {
  authorization: WorktreeCleanupAuthorization,
  status: TraceCleanupStatus,
  steps: Schema.Array(TraceWorktreeCleanupStep)
})
export type TraceWorktreeCleanupProgress = typeof TraceWorktreeCleanupProgress.Type

/** Branch cleanup progress; branch deletion remains distinct from worktree deletion. */
export const TraceBranchCleanupProgress = Schema.TaggedStruct("Branch", {
  authorization: BranchCleanupAuthorization,
  status: TraceCleanupStatus,
  steps: Schema.Array(TraceBranchCleanupStep)
})
export type TraceBranchCleanupProgress = typeof TraceBranchCleanupProgress.Type

/** Integrator predecessor-candidate cleanup progress remains provider-owned and distinct. */
export const TraceIntegratorCandidateCleanupProgress = Schema.TaggedStruct("IntegratorCandidate", {
  authorization: IntegratorCandidateCleanupAuthorization,
  status: TraceCleanupStatus,
  steps: Schema.Array(TraceIntegratorCandidateCleanupStep)
})
export type TraceIntegratorCandidateCleanupProgress = typeof TraceIntegratorCandidateCleanupProgress.Type

/** The three exact disposition-authorized cleanup families at one committed cursor. */
export const TraceCleanupProgress = Schema.Union([
  TraceBranchCleanupProgress,
  TraceIntegratorCandidateCleanupProgress,
  TraceWorktreeCleanupProgress
])
export type TraceCleanupProgress = typeof TraceCleanupProgress.Type

/** Versioned read-only control, disposition, and cleanup facet for one exact cursor. */
export const TraceControlDispositionFacet = Schema.Struct({
  cleanup: Schema.Array(TraceCleanupProgress),
  controls: Schema.Array(TraceControlFact),
  dispositions: Schema.Array(TraceDispositionFact),
  version: Schema.Literal(traceControlDispositionFacetVersion)
})
export type TraceControlDispositionFacet = typeof TraceControlDispositionFacet.Type

/** One shared versioned envelope consumed by console and Reducer Lab. */
export const TraceHistoricalFacets = Schema.Struct({
  controlDisposition: TraceControlDispositionFacet,
  integration: Schema.Struct({ facts: Schema.Array(TraceIntegrationFact) }),
  recovery: TraceRecoveryFacet
})
export type TraceHistoricalFacets = typeof TraceHistoricalFacets.Type

const historicalFacetFactories = {
  branchCleanupStep: { make: (input: Omit<TraceBranchCleanupStep, "_tag">) => TraceBranchCleanupStep.make(input) },
  cleanupProgress: {
    Branch: { make: (input) => TraceBranchCleanupProgress.make(input) },
    IntegratorCandidate: { make: (input) => TraceIntegratorCandidateCleanupProgress.make(input) },
    Worktree: { make: (input) => TraceWorktreeCleanupProgress.make(input) }
  },
  cleanupStatus: { ...TraceCleanupStatus.cases },
  controlDisposition: {
    make: (input: Omit<TraceControlDispositionFacet, "_tag">) => TraceControlDispositionFacet.make(input)
  },
  controlFact: { ...TraceControlFact.cases },
  dispositionFact: { ...TraceDispositionFact.cases },
  integratorCandidateCleanupStep: {
    make: (input: Omit<TraceIntegratorCandidateCleanupStep, "_tag">) => TraceIntegratorCandidateCleanupStep.make(input)
  },
  observationGap: TraceObservationGap.cases,
  preservationDisposition: TracePreservationDisposition.cases,
  retainedResponsibility: TraceRetainedResponsibility.cases,
  integrationFact: TraceIntegrationFact.cases,
  worktreeCleanupStep: {
    make: (input: Omit<TraceWorktreeCleanupStep, "_tag">) => TraceWorktreeCleanupStep.make(input)
  },
  facets: TraceHistoricalFacets
} satisfies HistoricalFacetFactories

const occurrenceRunId = (occurrence: WorkflowOccurrenceValue): RunId =>
  occurrence._tag === "AppliedControlDirection"
    ? occurrence.subject.runId
    : occurrence._tag === "AppliedAttemptChoice"
      ? occurrence.subject.plannedAttempt.runId
      : occurrence.runId

const traceHistoryItemInvariant = (item: {
  readonly identity: TraceItemIdentity
  readonly occurrence: WorkflowOccurrenceValue
  readonly operationIds: ReadonlyArray<OperationId>
  readonly taskIds: ReadonlyArray<TaskId>
}): string | undefined => {
  if (
    item.identity.runId !== occurrenceRunId(item.occurrence) ||
    item.identity.position !== item.occurrence.recordedAt
  ) {
    return "A history item identity must equal its occurrence Run and recorded journal position"
  }
  const expectedOperationIds = operationIdsOfOccurrence(item.occurrence)
  if (
    item.operationIds.length !== expectedOperationIds.length ||
    item.operationIds.some((operationId, index) => operationId !== expectedOperationIds[index])
  ) {
    return "A history item's operation identities must equal the identities derived from its occurrence"
  }
  const expectedTaskIds = sortedUniqueTaskIds(taskIdsOfOccurrence(item.occurrence))
  return item.taskIds.length === expectedTaskIds.length &&
    item.taskIds.every((taskId, index) => taskId === expectedTaskIds[index])
    ? undefined
    : "A history item's task identities must equal the identities derived from its occurrence"
}

/** One occurrence with its durable identity and only identities Dalph can prove. */
export const TraceHistoryItem = Schema.Struct({
  identity: TraceItemIdentity,
  occurrence: WorkflowOccurrence,
  operationIds: Schema.Array(OperationId).check(Schema.isUnique()),
  taskIds: Schema.Array(TaskId).check(Schema.isUnique())
}).check(Schema.makeFilter(traceHistoryItemInvariant))
export type TraceHistoryItem = typeof TraceHistoryItem.Type

const identityOutsideCursor = (identity: TracePositionIdentity, cursor: TraceCursor): boolean =>
  identity.runId !== cursor.runId || identity.position > cursor.position

const traceItemIssue = (item: TraceHistoryItem, runId: RunId, through: JournalPosition): string | undefined => {
  if (item.identity.runId !== runId) return "Every history item must belong to the history Run"
  if (item.identity.position > through) return "Every history item must be at or before the committed prefix"
  return traceHistoryItemInvariant(item)
}

const traceItemsAreStrictlyIncreasing = (items: ReadonlyArray<TraceHistoryItem>): boolean => {
  let previous: JournalPosition | undefined
  for (const item of items) {
    if (previous !== undefined && item.identity.position <= previous) return false
    previous = item.identity.position
  }
  return true
}

const traceItemsIssue = (
  items: ReadonlyArray<TraceHistoryItem>,
  runId: RunId,
  through: JournalPosition
): string | undefined => {
  const invalidItem = items.find((item) => traceItemIssue(item, runId, through) !== undefined)
  if (invalidItem !== undefined) return traceItemIssue(invalidItem, runId, through)
  return traceItemsAreStrictlyIncreasing(items) ? undefined : "Trace items must have distinct increasing positions"
}

const traceHistoryInvariant = (history: {
  readonly committedThrough: JournalPosition
  readonly items: ReadonlyArray<TraceHistoryItem>
  readonly runId: RunId
}): string | undefined => traceItemsIssue(history.items, history.runId, history.committedThrough)

/** The schema-versioned complete committed history used for replay and redelivery. */
export const TraceHistory = Schema.Struct({
  committedThrough: JournalPosition,
  items: Schema.Array(TraceHistoryItem),
  runId: RunId,
  version: Schema.Literal(traceReaderSchemaVersion)
}).check(Schema.makeFilter(traceHistoryInvariant))
export type TraceHistory = typeof TraceHistory.Type

const traceGraphObservationIssue = (
  graph: TraceTaskGraph | null,
  cursor: TraceCursor,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  if (graph === null) return undefined
  if (graph.observation.recordedAt > cursor.position) {
    return "The graph observation must be recorded at or before the cursor position"
  }
  const item = items.find(
    ({ identity }) => identity.runId === cursor.runId && identity.position === graph.observation.recordedAt
  )
  if (item === undefined) return "The graph observation must identify an item in the cursor prefix"
  return item.operationIds.includes(graph.observation.operationId)
    ? undefined
    : "The graph observation operation must identify its cursor-prefix item"
}

const graphEdgesOf = (snapshot: TaskDagWire): ReadonlyArray<TraceTaskGraphEdge> =>
  snapshot.tasks.flatMap((task) => [
    ...task.prerequisiteIds.map((prerequisiteTaskId) =>
      TraceTaskGraphEdge.cases.Prerequisite.make({ dependantTaskId: task.id, prerequisiteTaskId })
    ),
    ...(task.parentTaskId === null
      ? []
      : [TraceTaskGraphEdge.cases.Grouping.make({ childTaskId: task.id, parentTaskId: task.parentTaskId })])
  ])

const traceTaskGraphEdgeEqual = (actual: TraceTaskGraphEdge, expected: TraceTaskGraphEdge): boolean =>
  JSON.stringify(actual) === JSON.stringify(expected)

const traceTaskGraphEdgesEqual = (
  actual: ReadonlyArray<TraceTaskGraphEdge>,
  expected: ReadonlyArray<TraceTaskGraphEdge>
): boolean =>
  actual.length === expected.length &&
  actual.every((edge, index) => {
    const expectedEdge = expected[index]
    return expectedEdge !== undefined && traceTaskGraphEdgeEqual(edge, expectedEdge)
  })

const traceGraphEdgesIssue = (graph: TraceTaskGraph | null): string | undefined => {
  if (graph === null) return undefined
  return traceTaskGraphEdgesEqual(graph.edges, graphEdgesOf(graph.snapshot))
    ? undefined
    : "Graph edges must exactly match the prerequisite and grouping edges of its snapshot"
}

const traceTaskGraphRelationshipIssue = (
  graph: TraceTaskGraph | null,
  taskGraphEdges: ReadonlyArray<TraceTaskGraphEdge>
): string | undefined =>
  traceTaskGraphEdgesEqual(taskGraphEdges, graph?.edges ?? [])
    ? undefined
    : "Task-graph relationships must exactly match the graph edges or be empty without a graph"

const sortedTaskIds = (taskIds: ReadonlyArray<TaskId>): ReadonlyArray<TaskId> => [...taskIds].sort()

const valuesEqual = <A>(actual: ReadonlyArray<A>, expected: ReadonlyArray<A>): boolean =>
  actual.length === expected.length && actual.every((value, index) => value === expected[index])

const traceDerivedTaskOrderIssue = (
  derivedTaskOrder: TraceDerivedTaskOrder,
  graph: TraceTaskGraph | null
): string | undefined => {
  const expectedTaskIds = graph === null ? [] : sortedTaskIds(graph.snapshot.tasks.map(({ id }) => id))
  return valuesEqual(derivedTaskOrder.taskIds, expectedTaskIds)
    ? undefined
    : "Derived task order must exactly match the sorted graph snapshot task IDs"
}

const historyItemAt = (
  items: ReadonlyArray<TraceHistoryItem>,
  identity: TraceItemIdentity
): TraceHistoryItem | undefined =>
  items.find(
    ({ identity: itemIdentity }) => itemIdentity.runId === identity.runId && itemIdentity.position === identity.position
  )

const traceProcessSerializationIssue = (
  serialization: TraceProcessLocalResourceSerialization,
  cursor: TraceCursor,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  if (identityOutsideCursor(serialization.earlier, cursor) || identityOutsideCursor(serialization.later, cursor)) {
    return "Every process-local relationship identity must belong to the cursor prefix"
  }
  if (
    historyItemAt(items, serialization.earlier) === undefined ||
    historyItemAt(items, serialization.later) === undefined
  ) {
    return "Every process-local relationship identity must resolve to a history item"
  }
  return serialization.earlier.position < serialization.later.position
    ? undefined
    : "A process-local serialization must point from an earlier item to a later item"
}

const traceAcknowledgementIssue = (
  acknowledgement: TraceOutsideAuthorityAcknowledgement,
  cursor: TraceCursor,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  if (
    identityOutsideCursor(acknowledgement.action, cursor) ||
    identityOutsideCursor(acknowledgement.observation, cursor)
  ) {
    return "Every outside-authority relationship identity must belong to the cursor prefix"
  }
  const action = historyItemAt(items, acknowledgement.action)
  const observation = historyItemAt(items, acknowledgement.observation)
  if (action === undefined || observation === undefined) {
    return "Every outside-authority relationship identity must resolve to a history item"
  }
  return action.operationIds.includes(acknowledgement.actionOperationId)
    ? undefined
    : "An outside-authority acknowledgement operation must belong to its action item"
}

const traceRelationshipIssue = (view: {
  readonly cursor: TraceCursor
  readonly items: ReadonlyArray<TraceHistoryItem>
  readonly relationships: TraceRelationships
}): string | undefined => {
  const invalidAcknowledgement = view.relationships.outsideAuthorityAcknowledgements.find(
    (acknowledgement) => traceAcknowledgementIssue(acknowledgement, view.cursor, view.items) !== undefined
  )
  if (invalidAcknowledgement !== undefined) {
    return traceAcknowledgementIssue(invalidAcknowledgement, view.cursor, view.items)
  }
  const invalidSerialization = view.relationships.processLocalResourceSerializations.find(
    (serialization) => traceProcessSerializationIssue(serialization, view.cursor, view.items) !== undefined
  )
  if (invalidSerialization !== undefined) {
    return traceProcessSerializationIssue(invalidSerialization, view.cursor, view.items)
  }
  return undefined
}

const traceAtCursorInvariant = (view: {
  readonly cursor: TraceCursor
  readonly derivedTaskOrder: TraceDerivedTaskOrder
  readonly graph: TraceTaskGraph | null
  readonly items: ReadonlyArray<TraceHistoryItem>
  readonly relationships: TraceRelationships
  readonly facets: TraceHistoricalFacets
}): string | undefined =>
  traceItemsIssue(view.items, view.cursor.runId, view.cursor.position) ??
  traceGraphObservationIssue(view.graph, view.cursor, view.items) ??
  traceGraphEdgesIssue(view.graph) ??
  traceDerivedTaskOrderIssue(view.derivedTaskOrder, view.graph) ??
  traceTaskGraphRelationshipIssue(view.graph, view.relationships.taskGraphEdges) ??
  traceRelationshipIssue(view) ??
  traceHistoricalFacetsIssue(view, historicalFacetFactories)

/** A fixed historical cursor view. Current status is intentionally not stored here. */
export const TraceAtCursor = Schema.Struct({
  cursor: TraceCursor,
  derivedTaskOrder: TraceDerivedTaskOrder,
  graph: Schema.NullOr(TraceTaskGraph),
  items: Schema.Array(TraceHistoryItem),
  relationships: TraceRelationships,
  facets: TraceHistoricalFacets,
  version: Schema.Literal(traceReaderSchemaVersion)
}).check(Schema.makeFilter(traceAtCursorInvariant))
export type TraceAtCursor = typeof TraceAtCursor.Type

/** Prefix validation reports concrete storage facts instead of silently dropping history. */
export const TracePrefixIssue = Schema.TaggedUnion({
  FirstRecordNotRunBeginning: { position: JournalPosition },
  PositionGap: { actualPosition: JournalPosition, expectedPosition: JournalPosition },
  RecordKeyMismatch: { actualKey: JournalRecordKey, expectedKey: JournalRecordKey, position: JournalPosition },
  RunMismatch: { actualRunId: RunId, expectedRunId: RunId, position: JournalPosition }
})
export type TracePrefixIssue = typeof TracePrefixIssue.Type

/** Historical integration records retain their canonical durable key identity. */
const keyCheckedHistoricalEventTags = {
  AttemptImplementationAbandoned: true,
  AttemptStoppageIntended: true,
  CompletionClaimDeleted: true,
  CompletionClaimDeletionAttemptIntended: true,
  CompletionClaimDeletionIntended: true,
  CompletionClaimDeletionReadObserved: true,
  CompletionClaimReplaced: true,
  CompletionClaimReplacementAttemptIntended: true,
  CompletionClaimReplacementIntended: true,
  CompletionTaskAcknowledged: true,
  CompletionTaskAttemptIntended: true,
  CompletionTaskCandidateAncestryObserved: true,
  CompletionTaskCandidateAncestryReadIntended: true,
  CompletionTaskIntended: true,
  CompletionTaskRejected: true,
  CompletionTaskRequestLookupIntended: true,
  CompletionTaskRequestLookupObserved: true,
  CompletionTaskResponseLost: true,
  IntegrationFinalitySettled: true,
  IntegrationProviderRunActivityAbsent: true,
  IntegrationQuarantineDirectionApplied: true,
  IntegrationQuarantined: true,
  IntegratorRunCandidateGitObserved: true,
  IntegratorRunCandidateGitReadIntended: true,
  IntegratorRunResultRecorded: true,
  IntegratorRunStarted: true,
  IntegratorSessionFixed: true,
  IntegratorSuccessorSessionFixed: true,
  PostPromotionBlockerCandidateAncestryObserved: true,
  PostPromotionBlockerCandidateAncestryReadIntended: true,
  StoppedAttemptClaimNoReleaseObserved: true,
  TargetPromotionAttemptIntended: true,
  TargetPromotionIntended: true,
  TargetPromotionNonConvergence: true,
  TargetPromotionObservedSuccess: true,
  TargetPromotionStale: true,
  TaskAttemptPlanned: true,
  TaskClaimAcquired: true,
  TaskClaimAcquisitionIntended: true,
  TaskClaimAcquisitionRejected: true,
  TaskClaimReleaseIntended: true,
  TaskClaimReleased: true,
  TaskWorktreeReady: true,
  TaskWorktreeReconciliationIntended: true
} as const

const hasKeyCheckedHistoricalEvent = (event: WorkflowJournalEvent): boolean =>
  Object.hasOwn(keyCheckedHistoricalEventTags, event._tag)

/** The committed records cannot form one coherent Run prefix for presentation. */
export class TraceJournalPrefixInvalid extends Schema.TaggedError<TraceJournalPrefixInvalid>()(
  "TraceJournalPrefixInvalid",
  { issues: Schema.Array(TracePrefixIssue), runId: RunId }
) {}

/** The requested Run has no committed beginning and is not a trace. */
export class TraceRunNotFound extends Schema.TaggedError<TraceRunNotFound>()("TraceRunNotFound", { runId: RunId }) {}

/** A cursor must name one position committed in the requested Run. */
export class TraceCursorNotCommitted extends Schema.TaggedError<TraceCursorNotCommitted>()("TraceCursorNotCommitted", {
  cursor: TraceCursor
}) {}

/** The journal occurrence projection failed closed instead of returning a partial trace. */
export class TraceProjectionInvalid extends Schema.TaggedError<TraceProjectionInvalid>()("TraceProjectionInvalid", {
  detail: Schema.String,
  runId: RunId
}) {}

/** One explicit predecessor OperationId is absent from the validated prefix. */
export class TraceCausalPredecessorMissing extends Schema.TaggedError<TraceCausalPredecessorMissing>()(
  "TraceCausalPredecessorMissing",
  { predecessorOperationId: OperationId, runId: RunId, successorOperationId: OperationId }
) {}

/** One predecessor relationship is contradictory: duplicate identity or non-earlier position. */
export class TraceCausalPredecessorContradiction extends Schema.TaggedError<TraceCausalPredecessorContradiction>()(
  "TraceCausalPredecessorContradiction",
  {
    predecessorOperationId: OperationId,
    reason: Schema.Literals(["DuplicateOperation", "NotEarlier"]),
    runId: RunId,
    successorOperationId: OperationId
  }
) {}

/** The operation exists but no semantic occurrence was projected for presentation. */
export class TraceCausalPredecessorNotProjected extends Schema.TaggedError<TraceCausalPredecessorNotProjected>()(
  "TraceCausalPredecessorNotProjected",
  { predecessorOperationId: OperationId, runId: RunId, successorOperationId: OperationId }
) {}

export type TraceReaderError =
  | TraceCausalPredecessorContradiction
  | TraceCausalPredecessorMissing
  | TraceCausalPredecessorNotProjected
  | TraceCursorNotCommitted
  | TraceJournalPrefixInvalid
  | TraceProjectionInvalid
  | TraceRunNotFound

/** Read-only journal capability required by the production trace reader. */
export type TraceJournalReadSource = JournalReadSourceService

/** Read-only trace service; it exposes projection reads only. */
export interface TraceReaderService {
  readonly causalPredecessor: (
    cursor: TraceCursor,
    successorOperationId: OperationId,
    predecessorOperationId: OperationId
  ) => Effect.Effect<TraceHistoryItem, TraceReaderError | JournalStoreError>
  readonly read: (runId: RunId) => Effect.Effect<TraceHistory, TraceReaderError | JournalStoreError>
  readonly readAt: (cursor: TraceCursor) => Effect.Effect<TraceAtCursor, TraceReaderError | JournalStoreError>
}

/** Production trace reader service installed over the committed journal read seam. */
export class TraceReader extends Context.Service<TraceReader, TraceReaderService>()("@dalph/TraceReader") {}

const itemIdentity = (runId: RunId, position: JournalPosition): TraceItemIdentity =>
  TracePositionIdentity.make({ runId, position })

const sortedUniqueTaskIds = (taskIds: ReadonlyArray<TaskId>): ReadonlyArray<TaskId> => [...new Set(taskIds)].sort()

const operationOfEvent = (event: WorkflowJournalEvent): WorkflowOperation | undefined => {
  if (
    event._tag === "TaskTrackerReadIntentRecorded" ||
    event._tag === "TaskClaimAcquisitionIntended" ||
    event._tag === "TaskClaimReleaseIntended" ||
    event._tag === "TaskAttemptPlanned" ||
    event._tag === "TaskWorktreeReconciliationIntended" ||
    event._tag === "GitReadIntentRecorded"
  ) {
    return event.operation
  }
  return event._tag === "PlannedAttemptReplaced" ? event.successorPlan : undefined
}

const uniqueOperationIds = (operationIds: ReadonlyArray<OperationId>): ReadonlyArray<OperationId> => [
  ...new Set(operationIds)
]

type FinalityCompletionTaskAttemptEvent = Extract<
  IntegrationFinalityJournalEvent,
  { readonly _tag: "CompletionTaskAttemptIntended" }
>
type FinalityCompletionTaskReadEvent = Extract<
  IntegrationFinalityJournalEvent,
  {
    readonly _tag:
      | "CompletionTaskCandidateAncestryReadIntended"
      | "CompletionTaskCandidateAncestryObserved"
      | "CompletionTaskRequestLookupIntended"
      | "CompletionTaskRequestLookupObserved"
  }
>
type FinalityCompletionTaskOutcomeEvent = Extract<
  IntegrationFinalityJournalEvent,
  {
    readonly _tag:
      | "CompletionTaskIntended"
      | "CompletionTaskAcknowledged"
      | "CompletionTaskResponseLost"
      | "CompletionTaskRejected"
  }
>
type FinalityClaimDeletionReadEvent = Extract<
  IntegrationFinalityJournalEvent,
  { readonly _tag: "CompletionClaimDeletionReadObserved" }
>
type FinalityClaimReplacementEvent = Extract<
  IntegrationFinalityJournalEvent,
  {
    readonly _tag:
      | "CompletionClaimReplacementIntended"
      | "CompletionClaimReplacementAttemptIntended"
      | "CompletionClaimReplaced"
  }
>
type FinalityClaimDeletionEvent = Extract<
  IntegrationFinalityJournalEvent,
  {
    readonly _tag:
      | "CompletionClaimDeletionIntended"
      | "CompletionClaimDeletionAttemptIntended"
      | "CompletionClaimDeleted"
  }
>
type FinalitySettledEvent = Extract<IntegrationFinalityJournalEvent, { readonly _tag: "IntegrationFinalitySettled" }>
type FinalityPostPromotionBlockerAncestryEvent = Extract<
  IntegrationFinalityJournalEvent,
  {
    readonly _tag: "PostPromotionBlockerCandidateAncestryReadIntended" | "PostPromotionBlockerCandidateAncestryObserved"
  }
>

const isFinalityCompletionTaskReadEvent = (
  event: IntegrationFinalityJournalEvent
): event is FinalityCompletionTaskReadEvent =>
  event._tag === "CompletionTaskCandidateAncestryReadIntended" ||
  event._tag === "CompletionTaskCandidateAncestryObserved" ||
  event._tag === "CompletionTaskRequestLookupIntended" ||
  event._tag === "CompletionTaskRequestLookupObserved"

const isFinalityCompletionTaskOutcomeEvent = (
  event: IntegrationFinalityJournalEvent
): event is FinalityCompletionTaskOutcomeEvent =>
  event._tag === "CompletionTaskIntended" ||
  event._tag === "CompletionTaskAcknowledged" ||
  event._tag === "CompletionTaskResponseLost" ||
  event._tag === "CompletionTaskRejected"

const isFinalityClaimReplacementEvent = (
  event: IntegrationFinalityJournalEvent
): event is FinalityClaimReplacementEvent =>
  event._tag === "CompletionClaimReplacementIntended" ||
  event._tag === "CompletionClaimReplacementAttemptIntended" ||
  event._tag === "CompletionClaimReplaced"

const isFinalityClaimDeletionEvent = (event: IntegrationFinalityJournalEvent): event is FinalityClaimDeletionEvent =>
  event._tag === "CompletionClaimDeletionIntended" ||
  event._tag === "CompletionClaimDeletionAttemptIntended" ||
  event._tag === "CompletionClaimDeleted"

const completionTaskAttemptOperationIds = (event: FinalityCompletionTaskAttemptEvent): ReadonlyArray<OperationId> =>
  uniqueOperationIds([event.request.operationId, event.focusedFactsOperationId, event.gitReadOperationId])

const completionTaskReadOperationIds = (event: FinalityCompletionTaskReadEvent): ReadonlyArray<OperationId> =>
  uniqueOperationIds([event.request.operationId, event.operationId])

const completionTaskOutcomeOperationIds = (event: FinalityCompletionTaskOutcomeEvent): ReadonlyArray<OperationId> =>
  uniqueOperationIds([
    event.request.operationId,
    ...(event._tag === "CompletionTaskAcknowledged" ? [event.acknowledgement.operationId] : [])
  ])

const completionClaimDeletionReadOperationIds = (event: FinalityClaimDeletionReadEvent): ReadonlyArray<OperationId> =>
  uniqueOperationIds([
    event.request.operationId,
    event.request.successObservation.operationId,
    event.replacementOperationId
  ])

const completionClaimOperationIds = (
  event: FinalityClaimReplacementEvent | FinalityClaimDeletionEvent
): ReadonlyArray<OperationId> =>
  uniqueOperationIds([
    event.operationId,
    ...("successObservation" in event ? [event.successObservation.operationId] : [])
  ])

const finalitySettledOperationIds = (event: FinalitySettledEvent): ReadonlyArray<OperationId> =>
  uniqueOperationIds([event.replacementOperationId, event.deletionOperationId, event.successObservation.operationId])

const postPromotionBlockerAncestryOperationIds = (
  event: FinalityPostPromotionBlockerAncestryEvent
): ReadonlyArray<OperationId> => [event.operationId]

const operationIdsOfFinalityCompletionEvent = (
  event: IntegrationFinalityJournalEvent
): ReadonlyArray<OperationId> | undefined => {
  if (event._tag === "CompletionTaskAttemptIntended") return completionTaskAttemptOperationIds(event)
  if (isFinalityCompletionTaskReadEvent(event)) return completionTaskReadOperationIds(event)
  if (isFinalityCompletionTaskOutcomeEvent(event)) return completionTaskOutcomeOperationIds(event)
  return undefined
}

const operationIdsOfFinalityClaimEvent = (
  event: IntegrationFinalityJournalEvent
): ReadonlyArray<OperationId> | undefined => {
  if (event._tag === "CompletionClaimDeletionReadObserved") return completionClaimDeletionReadOperationIds(event)
  if (isFinalityClaimReplacementEvent(event) || isFinalityClaimDeletionEvent(event)) {
    return completionClaimOperationIds(event)
  }
  return undefined
}

/** Collects every operation identity carried by one finality event, including nested reads and claim-release requests. */
const operationIdsOfFinalityEvent = (event: IntegrationFinalityJournalEvent): ReadonlyArray<OperationId> => {
  const completion = operationIdsOfFinalityCompletionEvent(event)
  if (completion !== undefined) return completion
  const claim = operationIdsOfFinalityClaimEvent(event)
  if (claim !== undefined) return claim
  if (event._tag === "IntegrationFinalitySettled") return finalitySettledOperationIds(event)
  /* v8 ignore next -- @preserve the closed IntegrationFinalityJournalEvent union is fully dispatched above; every remaining finality event is one of these post-promotion ancestry records. */
  if (
    event._tag === "PostPromotionBlockerCandidateAncestryReadIntended" ||
    event._tag === "PostPromotionBlockerCandidateAncestryObserved"
  ) {
    return postPromotionBlockerAncestryOperationIds(event)
  }
  return []
}

type NestedOperationReference = { readonly id: OperationId; readonly payload: unknown; readonly role: string }

/** The request/observation shapes share this exact task-completion boundary identity. */
const completionFocusedOperationPayload = (
  value: CompletionTaskAttemptIntendedEvent["request"] | CompletionSuccessObservation
): unknown => ({
  claim: value.claim,
  operationId: value.operationId,
  target:
    "target" in value
      ? value.target
      : value.claim.promotionCorrelation.qualifiedCandidate.run.session.integrationTarget,
  taskId: value.taskId,
  taskRevision: value.taskRevision
})

/** Replacement and deletion retries reuse an operation for one exact claim boundary. */
const completionClaimOperationPayload = (
  claim: CompletionClaimDeletionReadObservedEvent["request"]["claim"],
  operationId: OperationId
): unknown => ({ claim, operationId })

const completionTaskAttemptReferences = (
  event: FinalityCompletionTaskAttemptEvent
): ReadonlyArray<NestedOperationReference> => [
  {
    id: event.request.operationId,
    payload: completionFocusedOperationPayload(event.request),
    role: "completion.request"
  },
  {
    id: event.focusedFactsOperationId,
    payload: completionFocusedOperationPayload(event.request),
    role: "completion.focused-facts-read"
  },
  {
    id: event.gitReadOperationId,
    payload: completionFocusedOperationPayload(event.request),
    role: "completion.git-read"
  }
]

const completionTaskReadReferences = (
  event: FinalityCompletionTaskReadEvent
): ReadonlyArray<NestedOperationReference> => [
  {
    id: event.request.operationId,
    payload: completionFocusedOperationPayload(event.request),
    role: "completion.request"
  },
  {
    id: event.operationId,
    payload: completionFocusedOperationPayload(event.request),
    role:
      event._tag === "CompletionTaskCandidateAncestryReadIntended" ||
      event._tag === "CompletionTaskCandidateAncestryObserved"
        ? "completion.git-read"
        : "completion.request-lookup-read"
  }
]

const completionTaskOutcomeReferences = (
  event: FinalityCompletionTaskOutcomeEvent
): ReadonlyArray<NestedOperationReference> => [
  {
    id: event.request.operationId,
    payload: completionFocusedOperationPayload(event.request),
    role: "completion.request"
  },
  ...(event._tag === "CompletionTaskAcknowledged"
    ? [
        {
          id: event.acknowledgement.operationId,
          payload: completionFocusedOperationPayload(event.request),
          role: "completion.request"
        }
      ]
    : [])
]

const completionClaimDeletionReadReferences = (
  event: FinalityClaimDeletionReadEvent
): ReadonlyArray<NestedOperationReference> => [
  {
    id: event.request.operationId,
    payload: completionClaimOperationPayload(event.request.claim, event.request.operationId),
    role: "completion-claim.deletion"
  },
  {
    id: event.request.successObservation.operationId,
    payload: completionFocusedOperationPayload(event.request.successObservation),
    role: "completion.focused-facts-read"
  },
  {
    id: event.replacementOperationId,
    payload: completionClaimOperationPayload(event.request.claim, event.replacementOperationId),
    role: "completion-claim.replacement"
  }
]

const completionClaimReplacementReferences = (
  event: FinalityClaimReplacementEvent
): ReadonlyArray<NestedOperationReference> => [
  {
    id: event.operationId,
    payload: completionClaimOperationPayload(event.claim, event.operationId),
    role: "completion-claim.replacement"
  }
]

const completionClaimDeletionReferences = (
  event: FinalityClaimDeletionEvent
): ReadonlyArray<NestedOperationReference> => [
  {
    id: event.operationId,
    payload: completionClaimOperationPayload(event.claim, event.operationId),
    role: "completion-claim.deletion"
  },
  {
    id: event.successObservation.operationId,
    payload: completionFocusedOperationPayload(event.successObservation),
    role: "completion.focused-facts-read"
  }
]

const finalitySettledReferences = (event: FinalitySettledEvent): ReadonlyArray<NestedOperationReference> => [
  {
    id: event.replacementOperationId,
    payload: completionClaimOperationPayload(event.claim, event.replacementOperationId),
    role: "completion-claim.replacement"
  },
  {
    id: event.deletionOperationId,
    payload: completionClaimOperationPayload(event.claim, event.deletionOperationId),
    role: "completion-claim.deletion"
  },
  {
    id: event.successObservation.operationId,
    payload: completionFocusedOperationPayload(event.successObservation),
    role: "completion.focused-facts-read"
  }
]

const postPromotionBlockerAncestryReferences = (
  event: FinalityPostPromotionBlockerAncestryEvent
): ReadonlyArray<NestedOperationReference> => [
  {
    id: event.operationId,
    payload: { authorization: event.authorization },
    role: "completion.post-promotion-blocker-ancestry-read"
  }
]

const nestedOperationReferencesOfCompletionEvent = (
  event: IntegrationFinalityJournalEvent
): ReadonlyArray<NestedOperationReference> | undefined => {
  if (event._tag === "CompletionTaskAttemptIntended") return completionTaskAttemptReferences(event)
  if (isFinalityCompletionTaskReadEvent(event)) return completionTaskReadReferences(event)
  if (isFinalityCompletionTaskOutcomeEvent(event)) return completionTaskOutcomeReferences(event)
  return undefined
}

const nestedOperationReferencesOfClaimEvent = (
  event: IntegrationFinalityJournalEvent
): ReadonlyArray<NestedOperationReference> | undefined => {
  if (event._tag === "CompletionClaimDeletionReadObserved") return completionClaimDeletionReadReferences(event)
  if (isFinalityClaimReplacementEvent(event)) return completionClaimReplacementReferences(event)
  if (isFinalityClaimDeletionEvent(event)) return completionClaimDeletionReferences(event)
  return undefined
}

/** Names every nested finality operation so one id cannot silently serve two boundaries. */
const nestedOperationReferencesOfFinalityEvent = (
  event: IntegrationFinalityJournalEvent
): ReadonlyArray<NestedOperationReference> => {
  const completion = nestedOperationReferencesOfCompletionEvent(event)
  if (completion !== undefined) return completion
  const claim = nestedOperationReferencesOfClaimEvent(event)
  if (claim !== undefined) return claim
  if (event._tag === "IntegrationFinalitySettled") return finalitySettledReferences(event)
  /* v8 ignore next -- @preserve the closed IntegrationFinalityJournalEvent union is fully dispatched above; every remaining finality event is one of these post-promotion ancestry records. */
  if (
    event._tag === "PostPromotionBlockerCandidateAncestryReadIntended" ||
    event._tag === "PostPromotionBlockerCandidateAncestryObserved"
  ) {
    return postPromotionBlockerAncestryReferences(event)
  }
  return []
}

const operationOccurrenceKinds = {
  GitReadInitiated: true,
  TaskAttemptPlanned: true,
  TaskClaimAcquisitionInitiated: true,
  TaskClaimReleaseInitiated: true,
  TaskTrackerReadInitiated: true,
  TaskWorktreeReady: true
} as const

type OperationOccurrence = Extract<WorkflowOccurrenceValue, { readonly _tag: keyof typeof operationOccurrenceKinds }>

const isOperationOccurrence = (occurrence: WorkflowOccurrenceValue): occurrence is OperationOccurrence =>
  Object.hasOwn(operationOccurrenceKinds, occurrence._tag)

const observedOperationOccurrenceKinds = {
  AttemptRestartAuthorityReadFailed: true,
  PlannedAttemptWorktreeObserved: true,
  StoppedAttemptClaimPreserved: true,
  TargetLineageObserved: true,
  TaskClaimAcquired: true,
  TaskClaimReleased: true,
  TaskTrackerFactsObserved: true
} as const

type ObservedOperationOccurrence = Extract<
  WorkflowOccurrenceValue,
  { readonly _tag: keyof typeof observedOperationOccurrenceKinds }
>

const isObservedOperationOccurrence = (
  occurrence: WorkflowOccurrenceValue
): occurrence is ObservedOperationOccurrence => Object.hasOwn(observedOperationOccurrenceKinds, occurrence._tag)

const finalityOccurrenceKinds = {
  IntegrationClaimDeletionOccurred: true,
  IntegrationClaimReplacementOccurred: true,
  IntegrationFinalitySettledOccurred: true,
  IntegrationFocusedCompletionOccurred: true
} as const

type FinalityOccurrence = Extract<WorkflowOccurrenceValue, { readonly _tag: keyof typeof finalityOccurrenceKinds }>

const isFinalityOccurrence = (occurrence: WorkflowOccurrenceValue): occurrence is FinalityOccurrence =>
  Object.hasOwn(finalityOccurrenceKinds, occurrence._tag)

const operationIdsOfOperationOccurrence = (
  occurrence: WorkflowOccurrenceValue
): ReadonlyArray<OperationId> | undefined =>
  isOperationOccurrence(occurrence) ? [workflowOperationId(occurrence.operation)] : undefined

const operationIdsOfObservedOccurrence = (
  occurrence: WorkflowOccurrenceValue
): ReadonlyArray<OperationId> | undefined => {
  if (!isObservedOperationOccurrence(occurrence)) return undefined
  return [
    occurrence._tag === "StoppedAttemptClaimPreserved"
      ? occurrence.observationOperationId
      : occurrence.originatingActionOperationId
  ]
}

const operationIdsOfReplacementOccurrence = (
  occurrence: WorkflowOccurrenceValue
): ReadonlyArray<OperationId> | undefined =>
  occurrence._tag === "PlannedAttemptReplaced" ? [workflowOperationId(occurrence.successorPlan)] : undefined

const operationIdsOfHistoricalAttemptOccurrence = (
  occurrence: WorkflowOccurrenceValue
): ReadonlyArray<OperationId> | undefined =>
  occurrence._tag === "TaskWorktreeReconciliationInitiated" ? [workflowOperationId(occurrence.operation)] : undefined

const operationIdsOfFinalityOccurrence = (
  occurrence: WorkflowOccurrenceValue
): ReadonlyArray<OperationId> | undefined =>
  isFinalityOccurrence(occurrence) ? operationIdsOfFinalityEvent(occurrence.event) : undefined

const cleanupOccurrenceKinds = {
  BranchCleanupOccurred: true,
  IntegratorCandidateCleanupOccurred: true,
  WorktreeCleanupOccurred: true
} as const

type CleanupOccurrence = Extract<WorkflowOccurrenceValue, { readonly _tag: keyof typeof cleanupOccurrenceKinds }>

const isCleanupOccurrence = (occurrence: WorkflowOccurrenceValue): occurrence is CleanupOccurrence =>
  Object.hasOwn(cleanupOccurrenceKinds, occurrence._tag)

const operationIdsOfCleanupOccurrence = (
  occurrence: WorkflowOccurrenceValue
): ReadonlyArray<OperationId> | undefined => {
  if (!isCleanupOccurrence(occurrence)) return undefined
  const event = occurrence.event
  return "operationId" in event ? [event.operationId] : [event.authorization.operationId]
}

const operationIdsOfCancellationOccurrence = (
  occurrence: WorkflowOccurrenceValue
): ReadonlyArray<OperationId> | undefined =>
  occurrence._tag === "CancelledAttemptClaimNoReleaseObserved" ? [occurrence.observationOperationId] : undefined

const operationIdsOfOccurrence = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<OperationId> =>
  operationIdsOfOperationOccurrence(occurrence) ??
  operationIdsOfObservedOccurrence(occurrence) ??
  operationIdsOfReplacementOccurrence(occurrence) ??
  operationIdsOfHistoricalAttemptOccurrence(occurrence) ??
  operationIdsOfFinalityOccurrence(occurrence) ??
  operationIdsOfCleanupOccurrence(occurrence) ??
  operationIdsOfCancellationOccurrence(occurrence) ??
  []

const taskIdsOfObservation = (observation: TaskTrackerFactsObservation): ReadonlyArray<TaskId> => {
  switch (observation._tag) {
    case "CompleteTaskTrackerFacts":
      return observation.factFamilies[0].taskIds
    case "UnchangedTaskTrackerFactsReconfirmed":
      return observation.factFamilies[1].subjectTaskIds
    case "FocusedTaskWorkSpecificationFacts":
      return [observation.factFamily.taskId]
    case "FocusedTaskClaimFacts":
    case "FocusedTaskClaimFactsUnreadable":
      return [observation.coverage.taskId]
    case "FocusedTaskCompletionFacts":
      return [observation.facts.taskId]
    case "TaskTrackerFactsReadFailed":
      return []
  }
}

const taskIdsOfObservationOccurrence = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<TaskId> | undefined =>
  occurrence._tag === "TaskTrackerFactsObserved" ? taskIdsOfObservation(occurrence.evidence) : undefined

const taskIdsOfDirectPlannedAttemptOccurrence = (
  occurrence: WorkflowOccurrenceValue
): ReadonlyArray<TaskId> | undefined =>
  "plannedAttempt" in occurrence ? [occurrence.plannedAttempt.taskId] : undefined

const taskIdsOfSubjectPlannedAttemptOccurrence = (
  occurrence: WorkflowOccurrenceValue
): ReadonlyArray<TaskId> | undefined =>
  occurrence._tag === "AppliedAttemptChoice" ||
  occurrence._tag === "PlannedAttemptReplaced" ||
  occurrence._tag === "AttemptRestartAuthorityReadFailed"
    ? [occurrence.subject.plannedAttempt.taskId]
    : undefined

const taskIdsOfWorktreeObservation = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<TaskId> | undefined =>
  occurrence._tag === "PlannedAttemptWorktreeObserved"
    ? occurrence.observation._tag === "AttemptWorktreeLost"
      ? [occurrence.observation.plannedAttempt.taskId]
      : []
    : undefined

const taskIdsOfControlOccurrence = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<TaskId> | undefined => {
  if (occurrence._tag === "AppliedControlDirection") {
    return occurrence.subject._tag === "Task" ? [occurrence.subject.taskId] : []
  }
  return occurrence._tag === "AppliedTaskClaimReacquisitionDirection" ? [occurrence.taskId] : undefined
}

const taskIdsOfOccurrence = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<TaskId> =>
  [
    taskIdsOfObservationOccurrence(occurrence),
    taskIdsOfDirectPlannedAttemptOccurrence(occurrence),
    taskIdsOfSubjectPlannedAttemptOccurrence(occurrence),
    taskIdsOfWorktreeObservation(occurrence),
    taskIdsOfControlOccurrence(occurrence),
    taskIdsOfHistoricalOccurrence(occurrence)
  ].find((taskIds): taskIds is ReadonlyArray<TaskId> => taskIds !== undefined) ?? []

const taskIdsOfHistoricalTaskClaim = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<TaskId> | undefined => {
  if (occurrence._tag === "TaskClaimAcquisitionInitiated" || occurrence._tag === "TaskClaimReleaseInitiated") {
    return [
      occurrence.operation._tag === "AcquireTaskClaim"
        ? occurrence.operation.acquisition.taskId
        : occurrence.operation.release.claim.taskId
    ]
  }
  if (occurrence._tag === "TaskClaimAcquired") return [occurrence.claim.taskId]
  return occurrence._tag === "TaskClaimReleased" ? [occurrence.release.claim.taskId] : undefined
}

const historicalAttemptWorktreeOccurrenceKinds = {
  AttemptImplementationAbandoned: true,
  AttemptStoppageIntended: true,
  StoppedAttemptClaimPreserved: true,
  TaskAttemptPlanned: true,
  TaskWorktreeReady: true,
  TaskWorktreeReconciliationInitiated: true
} as const

type HistoricalAttemptWorktreeOccurrence = Extract<
  WorkflowOccurrenceValue,
  { readonly _tag: keyof typeof historicalAttemptWorktreeOccurrenceKinds }
>

const isHistoricalAttemptWorktreeOccurrence = (
  occurrence: WorkflowOccurrenceValue
): occurrence is HistoricalAttemptWorktreeOccurrence =>
  Object.hasOwn(historicalAttemptWorktreeOccurrenceKinds, occurrence._tag)

const taskIdsOfHistoricalAttemptWorktree = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<TaskId> | undefined => {
  if (!isHistoricalAttemptWorktreeOccurrence(occurrence)) return undefined
  if (occurrence._tag === "TaskWorktreeReady") return [occurrence.operation.plannedAttempt.taskId]
  if (occurrence._tag === "TaskAttemptPlanned") return [occurrence.plannedAttempt.taskId]
  if (occurrence._tag === "TaskWorktreeReconciliationInitiated") return [occurrence.operation.plannedAttempt.taskId]
  return [occurrence.subject.plannedAttempt.taskId]
}

const historicalIntegratorOccurrenceKinds = {
  IntegratorCandidateQualificationInitiated: true,
  IntegratorCandidateQualificationObserved: true,
  IntegratorRunResultRecorded: true,
  IntegratorRunStarted: true,
  IntegratorSessionFixed: true,
  IntegratorSuccessorSessionFixed: true
} as const

type HistoricalIntegratorOccurrence = Extract<
  WorkflowOccurrenceValue,
  { readonly _tag: keyof typeof historicalIntegratorOccurrenceKinds }
>

const isHistoricalIntegratorOccurrence = (
  occurrence: WorkflowOccurrenceValue
): occurrence is HistoricalIntegratorOccurrence => Object.hasOwn(historicalIntegratorOccurrenceKinds, occurrence._tag)

const taskIdsOfHistoricalIntegrator = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<TaskId> | undefined => {
  if (!isHistoricalIntegratorOccurrence(occurrence)) return undefined
  if (occurrence._tag === "IntegratorSuccessorSessionFixed") return [occurrence.successor.plannedAttempt.taskId]
  if (occurrence._tag === "IntegratorSessionFixed") return [occurrence.correlation.plannedAttempt.taskId]
  if (occurrence._tag === "IntegratorCandidateQualificationObserved") {
    return [occurrence.originatingActionRun.session.plannedAttempt.taskId]
  }
  return [occurrence.run.session.plannedAttempt.taskId]
}

const isHistoricalPromotionOccurrence = (
  occurrence: WorkflowOccurrenceValue
): occurrence is Extract<
  WorkflowOccurrenceValue,
  {
    readonly _tag:
      | "TargetPromotionRequested"
      | "TargetPromotionAttemptRequested"
      | "TargetPromotionSucceeded"
      | "TargetPromotionStale"
      | "TargetPromotionNonConvergent"
  }
> =>
  occurrence._tag === "TargetPromotionRequested" ||
  occurrence._tag === "TargetPromotionAttemptRequested" ||
  occurrence._tag === "TargetPromotionSucceeded" ||
  occurrence._tag === "TargetPromotionStale" ||
  occurrence._tag === "TargetPromotionNonConvergent"

const taskIdsOfHistoricalPromotion = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<TaskId> | undefined =>
  isHistoricalPromotionOccurrence(occurrence)
    ? [occurrence.correlation.qualifiedCandidate.run.session.plannedAttempt.taskId]
    : undefined

const taskIdsOfHistoricalPreservation = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<TaskId> | undefined => {
  if (occurrence._tag === "IntegrationQuarantined" || occurrence._tag === "IntegrationProviderRunActivityAbsent") {
    return [occurrence.correlation.plannedAttempt.taskId]
  }
  return undefined
}

const isHistoricalFinalityOccurrence = (
  occurrence: WorkflowOccurrenceValue
): occurrence is Extract<
  WorkflowOccurrenceValue,
  {
    readonly _tag:
      | "IntegrationFocusedCompletionOccurred"
      | "IntegrationClaimReplacementOccurred"
      | "IntegrationClaimDeletionOccurred"
      | "IntegrationFinalitySettledOccurred"
  }
> =>
  occurrence._tag === "IntegrationFocusedCompletionOccurred" ||
  occurrence._tag === "IntegrationClaimReplacementOccurred" ||
  occurrence._tag === "IntegrationClaimDeletionOccurred" ||
  occurrence._tag === "IntegrationFinalitySettledOccurred"

const taskIdsOfHistoricalFinality = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<TaskId> | undefined => {
  if (!isHistoricalFinalityOccurrence(occurrence)) return undefined
  const event = occurrence.event
  if ("authorization" in event) return [event.authorization.claim.plannedAttempt.taskId]
  if ("claim" in event) return [event.claim.plannedAttempt.taskId]
  /* v8 ignore next -- @preserve every historical finality event carries authorization, claim, or a request containing claim; the empty arm cannot be constructed by its schemas. */
  if ("request" in event && "claim" in event.request) return [event.request.claim.plannedAttempt.taskId]
  return []
}

const taskIdsOfControlDispositionOccurrence = (
  occurrence: WorkflowOccurrenceValue
): ReadonlyArray<TaskId> | undefined => {
  if (
    occurrence._tag === "CancelledAttemptImplementationResponsibilityRelinquished" ||
    occurrence._tag === "CancelledAttemptClaimNoReleaseObserved"
  ) {
    return [occurrence.plannedAttempt.taskId]
  }
  if (occurrence._tag === "WorktreeCleanupOccurred" || occurrence._tag === "BranchCleanupOccurred") {
    return [occurrence.event.authorization.disposition.plannedAttempt.taskId]
  }
  if (occurrence._tag === "IntegratorCandidateCleanupOccurred") {
    return [occurrence.event.authorization.disposition.predecessor.plannedAttempt.taskId]
  }
  return undefined
}

const taskIdsOfHistoricalOccurrence = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<TaskId> | undefined =>
  [
    taskIdsOfHistoricalTaskClaim(occurrence),
    taskIdsOfHistoricalAttemptWorktree(occurrence),
    taskIdsOfHistoricalIntegrator(occurrence),
    taskIdsOfHistoricalPromotion(occurrence),
    taskIdsOfHistoricalPreservation(occurrence),
    taskIdsOfHistoricalFinality(occurrence),
    taskIdsOfControlDispositionOccurrence(occurrence)
  ].find((taskIds): taskIds is ReadonlyArray<TaskId> => taskIds !== undefined)

const itemFromOccurrence = (runId: RunId, occurrence: WorkflowOccurrenceValue): TraceHistoryItem =>
  TraceHistoryItem.make({
    identity: itemIdentity(runId, occurrence.recordedAt),
    occurrence,
    operationIds: operationIdsOfOccurrence(occurrence),
    taskIds: sortedUniqueTaskIds(taskIdsOfOccurrence(occurrence))
  })

const prefixIssues = (runId: RunId, records: ReadonlyArray<JournalRecord>): ReadonlyArray<TracePrefixIssue> => {
  const issues: Array<TracePrefixIssue> = []
  for (const [index, record] of records.entries()) {
    const expectedPosition = JournalPosition.make(index + 1)
    if (record.runId !== runId) {
      issues.push(
        TracePrefixIssue.cases.RunMismatch.make({
          actualRunId: record.runId,
          expectedRunId: runId,
          position: record.position
        })
      )
    }
    if (record.position !== expectedPosition) {
      issues.push(TracePrefixIssue.cases.PositionGap.make({ actualPosition: record.position, expectedPosition }))
    }
    const expectedKey = describeJournalEvent(record.event).expectedKey
    if (hasKeyCheckedHistoricalEvent(record.event) && record.key !== expectedKey) {
      issues.push(
        TracePrefixIssue.cases.RecordKeyMismatch.make({ actualKey: record.key, expectedKey, position: record.position })
      )
    }
    if (index === 0 && record.event._tag !== "WorkflowRunBegan") {
      issues.push(TracePrefixIssue.cases.FirstRecordNotRunBeginning.make({ position: record.position }))
    }
  }
  return issues
}

const validateRecords = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): Effect.Effect<ReadonlyArray<JournalRecord>, TraceJournalPrefixInvalid | TraceRunNotFound> => {
  if (records.length === 0) return Effect.fail(new TraceRunNotFound({ runId }))
  const issues = prefixIssues(runId, records)
  return issues.length === 0 ? Effect.succeed(records) : Effect.fail(new TraceJournalPrefixInvalid({ issues, runId }))
}

type IndexedOperation = { readonly operation: WorkflowOperation; readonly position: JournalPosition }

const nestedOperationMayBeWorkflowOperation = (role: string): boolean => role === "completion.focused-facts-read"

const indexedFinalityEventKinds = {
  CompletionClaimDeleted: true,
  CompletionClaimDeletionAttemptIntended: true,
  CompletionClaimDeletionIntended: true,
  CompletionClaimDeletionReadObserved: true,
  CompletionClaimReplaced: true,
  CompletionClaimReplacementAttemptIntended: true,
  CompletionClaimReplacementIntended: true,
  CompletionTaskAcknowledged: true,
  CompletionTaskAttemptIntended: true,
  CompletionTaskCandidateAncestryObserved: true,
  CompletionTaskCandidateAncestryReadIntended: true,
  CompletionTaskIntended: true,
  CompletionTaskRejected: true,
  CompletionTaskRequestLookupIntended: true,
  CompletionTaskRequestLookupObserved: true,
  CompletionTaskResponseLost: true,
  IntegrationFinalitySettled: true,
  PostPromotionBlockerCandidateAncestryReadIntended: true,
  PostPromotionBlockerCandidateAncestryObserved: true
} as const

type IndexedFinalityEvent = Extract<WorkflowJournalEvent, { readonly _tag: keyof typeof indexedFinalityEventKinds }>

const isIndexedFinalityEvent = (event: WorkflowJournalEvent): event is IndexedFinalityEvent =>
  Object.hasOwn(indexedFinalityEventKinds, event._tag)

type TraceCausalIssue = TraceCausalPredecessorContradiction | TraceCausalPredecessorMissing

const duplicateOperationIssue = (runId: RunId, operationId: OperationId): TraceCausalPredecessorContradiction =>
  new TraceCausalPredecessorContradiction({
    predecessorOperationId: operationId,
    reason: "DuplicateOperation",
    runId,
    successorOperationId: operationId
  })

const indexWorkflowOperation = (
  runId: RunId,
  record: JournalRecord,
  index: Map<OperationId, IndexedOperation>,
  nestedIndex: ReadonlyMap<OperationId, NestedOperationReference>
): TraceCausalIssue | undefined => {
  const operation = operationOfEvent(record.event)
  if (operation === undefined) return undefined
  const operationId = workflowOperationId(operation)
  const nested = nestedIndex.get(operationId)
  if (index.has(operationId) || (nested !== undefined && !nestedOperationMayBeWorkflowOperation(nested.role))) {
    return duplicateOperationIssue(runId, operationId)
  }
  index.set(operationId, { operation, position: record.position })
  return undefined
}

const indexFinalityOperations = (
  runId: RunId,
  event: IndexedFinalityEvent,
  index: ReadonlyMap<OperationId, IndexedOperation>,
  nestedIndex: Map<OperationId, NestedOperationReference>
): TraceCausalIssue | undefined => {
  for (const reference of nestedOperationReferencesOfFinalityEvent(event)) {
    const prior = nestedIndex.get(reference.id)
    const topLevel = index.get(reference.id)
    const duplicateTopLevel = topLevel !== undefined && !nestedOperationMayBeWorkflowOperation(reference.role)
    const duplicateNested =
      prior !== undefined && (prior.role !== reference.role || !sameJson(prior.payload, reference.payload))
    if (duplicateTopLevel || duplicateNested) return duplicateOperationIssue(runId, reference.id)
    nestedIndex.set(reference.id, reference)
  }
  return undefined
}

const indexJournalRecord = (
  runId: RunId,
  record: JournalRecord,
  index: Map<OperationId, IndexedOperation>,
  nestedIndex: Map<OperationId, NestedOperationReference>
): TraceCausalIssue | undefined => {
  const workflowIssue = indexWorkflowOperation(runId, record, index, nestedIndex)
  if (workflowIssue !== undefined) return workflowIssue
  if (isIndexedFinalityEvent(record.event)) {
    return indexFinalityOperations(runId, record.event, index, nestedIndex)
  }
  return undefined
}

const predecessorIssue = (
  runId: RunId,
  operation: WorkflowOperation,
  position: JournalPosition,
  index: ReadonlyMap<OperationId, IndexedOperation>
): TraceCausalIssue | undefined => {
  const successorOperationId = workflowOperationId(operation)
  for (const predecessorOperationId of operation.predecessorOperationIds) {
    const predecessor = index.get(predecessorOperationId)
    if (predecessor === undefined) {
      return new TraceCausalPredecessorMissing({ predecessorOperationId, runId, successorOperationId })
    }
    if (predecessor.position >= position) {
      return new TraceCausalPredecessorContradiction({
        predecessorOperationId,
        reason: "NotEarlier",
        runId,
        successorOperationId
      })
    }
  }
  return undefined
}

const operationIndexPredecessorIssue = (
  runId: RunId,
  index: ReadonlyMap<OperationId, IndexedOperation>
): TraceCausalIssue | undefined => {
  for (const { operation, position } of index.values()) {
    const issue = predecessorIssue(runId, operation, position, index)
    if (issue !== undefined) return issue
  }
  return undefined
}

const operationIndexOf = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): Effect.Effect<ReadonlyMap<OperationId, IndexedOperation>, TraceReaderError> => {
  const index = new Map<OperationId, IndexedOperation>()
  const nestedIndex = new Map<OperationId, NestedOperationReference>()
  for (const record of records) {
    const issue = indexJournalRecord(runId, record, index, nestedIndex)
    if (issue !== undefined) return Effect.fail(issue)
  }
  const predecessorIssueResult = operationIndexPredecessorIssue(runId, index)
  return predecessorIssueResult === undefined ? Effect.succeed(index) : Effect.fail(predecessorIssueResult)
}

/** Runs the exact indexed finality validator before exposing any finality facet. */
const finalityHistoryIssue = (runId: RunId, records: ReadonlyArray<JournalRecord>): string | undefined => {
  let indexes = makeIntegrationFinalityHistoryIndexes()
  for (const record of records) {
    let issue: string | undefined
    indexes = validateIntegrationFinalityHistoryRecord(
      record,
      runId,
      records,
      indexes,
      (detail) => {
        issue ??= detail
      },
      (detail) => {
        issue ??= detail
      }
    )
    if (issue !== undefined) return issue
  }
  return undefined
}

const integrationHistoryIssue = (runId: RunId, records: ReadonlyArray<JournalRecord>): string | undefined => {
  let indexes = makeIntegrationHistoryIndexes()
  for (const record of records) {
    let issue: string | undefined
    indexes = validateIntegrationHistoryRecord(
      record,
      runId,
      indexes,
      (detail) => {
        issue ??= detail
      },
      (detail) => {
        issue ??= detail
      },
      records
    )
    if (issue !== undefined) return issue
    if (record.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
      indexes = {
        ...indexes,
        executorResponsibilitiesBegan: HashMap.set(
          indexes.executorResponsibilitiesBegan,
          record.event.plannedAttempt.attemptId,
          { plannedAttempt: record.event.plannedAttempt, position: record.position }
        )
      }
    }
    if (
      record.event._tag === "PlannedAttemptExecutorWorkReported" &&
      record.event.report._tag === "ExecutorWorkTerminal" &&
      record.event.report.result._tag === "Accepted"
    ) {
      const attemptId = record.event.report.correlation.attemptId
      indexes = {
        ...indexes,
        acceptedExecutorResults: HashMap.set(
          indexes.acceptedExecutorResults,
          attemptId,
          record.event.report.result.acceptedResult
        )
      }
    }
  }
  return undefined
}

type CleanupEventWithFamily =
  | { readonly family: "Worktree"; readonly event: WorktreeCleanupJournalEvent }
  | { readonly family: "Branch"; readonly event: BranchCleanupJournalEvent }
  | { readonly family: "IntegratorCandidate"; readonly event: IntegratorCandidateCleanupJournalEvent }

const cleanupEventWithFamily = (event: WorkflowJournalEvent): CleanupEventWithFamily | undefined => {
  if (Schema.is(WorktreeCleanupJournalEvent)(event)) return { event, family: "Worktree" }
  if (Schema.is(BranchCleanupJournalEvent)(event)) return { event, family: "Branch" }
  if (Schema.is(IntegratorCandidateCleanupJournalEvent)(event)) return { event, family: "IntegratorCandidate" }
  return undefined
}

/** Cleanup history is checked against the same committed prefix as occurrence projection. */
const cleanupFamilyValidationIssue = (
  records: ReadonlyArray<JournalRecord>,
  cleanup: CleanupEventWithFamily
): string | undefined => {
  const { event, family } = cleanup
  const provenance =
    family === "IntegratorCandidate"
      ? validateIntegratorCandidateCleanupProvenance(records, event.authorization)
      : validateWorktreeCleanupProvenance(records, event.authorization)
  if (provenance._tag === "Invalid") return `${family} cleanup provenance: ${provenance.detail}`
  const history =
    family === "Worktree"
      ? validateWorktreeCleanupHistory(records, event.authorization)
      : family === "Branch"
        ? validateBranchCleanupHistory(records, event.authorization)
        : validateIntegratorCandidateCleanupHistory(records, event.authorization)
  if (history._tag === "Invalid") return `${family} cleanup history: ${history.detail}`
  if (family !== "Branch") return undefined
  const settledWorktree = validateSettledWorktreeForBranch(records, event.authorization)
  return settledWorktree._tag === "Invalid" ? `${family} cleanup provenance: ${settledWorktree.detail}` : undefined
}

const cleanupHistoryIssue = (records: ReadonlyArray<JournalRecord>): string | undefined => {
  const latestByAuthorization = new Map<string, CleanupEventWithFamily>()
  for (const record of records) {
    const cleanup = cleanupEventWithFamily(record.event)
    if (cleanup !== undefined) {
      latestByAuthorization.set(`${cleanup.family}:${cleanup.event.authorization.operationId}`, cleanup)
    }
  }
  for (const cleanup of latestByAuthorization.values()) {
    const issue = cleanupFamilyValidationIssue(records, cleanup)
    if (issue !== undefined) return issue
  }
  return undefined
}

const canonicalHistoryIssue = (issues: ReadonlyArray<WorkflowJournalHistorySemanticIssue>): string | undefined => {
  const issue = issues[0]
  if (issue === undefined) return undefined
  return `${workflowJournalHistoryIssueDetail(issue)} at journal position ${issue.position}`
}

const cancelledAttemptHistoryIssue = (runId: RunId, records: ReadonlyArray<JournalRecord>): string | undefined => {
  const issue = validateCancelledAttemptHistoryPrefix(runId, records)
  return issue === undefined ? undefined : `${issue.detail} at journal position ${issue.position}`
}

/** Validates all nested Run identities before any complete or cursor trace is presented. */
const fullHistoryIssue = (runId: RunId, records: ReadonlyArray<JournalRecord>): string | undefined => {
  for (const record of records) {
    const bindingIssue = invalidWorkflowRunBinding(record.event, runId)
    if (bindingIssue !== undefined) return `${bindingIssue} at journal position ${record.position}`
  }
  return (
    canonicalHistoryIssue(validateAttemptStopHistory(runId, records)) ??
    canonicalHistoryIssue(validateCancellationMultiplicityHistory(runId, records)) ??
    cancelledAttemptHistoryIssue(runId, records) ??
    cleanupHistoryIssue(records) ??
    integrationHistoryIssue(runId, records) ??
    finalityHistoryIssue(runId, records)
  )
}

type CompleteGraphObservation = CompleteTaskTrackerFactsObserved | UnchangedTaskTrackerFactsReconfirmed

type CompleteGraphObservationAt = { readonly observation: CompleteGraphObservation; readonly position: JournalPosition }

const completeGraphObservationAt = (
  record: JournalRecord,
  target: TrackerTarget
): CompleteGraphObservationAt | undefined => {
  const event = record.event
  if (event._tag !== "TaskTrackerFactsObserved") return undefined
  if (
    event.observation._tag !== "CompleteTaskTrackerFacts" &&
    event.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed"
  ) {
    return undefined
  }
  return taskTrackerTargetKey(event.observation.target) === taskTrackerTargetKey(target)
    ? { observation: event.observation, position: record.position }
    : undefined
}

const completeGraphObservationsFor = (
  records: ReadonlyArray<JournalRecord>,
  target: TrackerTarget
): ReadonlyArray<CompleteGraphObservationAt> =>
  records.flatMap((record) => {
    const observation = completeGraphObservationAt(record, target)
    return observation === undefined ? [] : [observation]
  })

const graphObservation = (
  records: ReadonlyArray<JournalRecord>,
  target: TrackerTarget
): CompleteGraphObservationAt | undefined => {
  const observations = completeGraphObservationsFor(records, target)
  return observations.length === 0 ? undefined : observations.reduce((_, observation) => observation)
}

const taskGraphAt = (records: ReadonlyArray<JournalRecord>, target: TrackerTarget): TraceTaskGraph | null => {
  const latest = graphObservation(records, target)
  if (latest === undefined) return null
  const knowledge = {
    taskTrackerFacts: completeGraphObservationsFor(records, target).map(({ observation }) => observation)
  }
  const snapshot = reconstructedTaskGraphFor(knowledge, target)
  if (snapshot._tag === "None") return null
  const wire = snapshot.value.toWire()
  return TraceTaskGraph.make({
    edges: graphEdgesOf(wire),
    observation: { operationId: latest.observation.operationId, recordedAt: latest.position },
    snapshot: wire
  })
}

const occurrenceItemAt = (
  items: ReadonlyArray<TraceHistoryItem>,
  position: JournalPosition
): TraceHistoryItem | undefined => items.find(({ identity }) => identity.position === position)

const operationItem = (
  items: ReadonlyArray<TraceHistoryItem>,
  operationId: OperationId
): TraceHistoryItem | undefined => items.find((item) => item.operationIds.includes(operationId))

const workflowCausalEdgesOf = (
  operationIndex: ReadonlyMap<OperationId, IndexedOperation>
): ReadonlyArray<TraceWorkflowCausalEdge> => {
  const edges: Array<TraceWorkflowCausalEdge> = []
  for (const { operation } of operationIndex.values()) {
    const successorOperationId = workflowOperationId(operation)
    for (const predecessorOperationId of operation.predecessorOperationIds) {
      edges.push({ predecessorOperationId, successorOperationId })
    }
  }
  return edges
}

type IndexedWorkflowCausalEdge = { readonly edge: TraceWorkflowCausalEdge; readonly successorPosition: JournalPosition }

const indexedWorkflowCausalEdgesOf = (
  operationIndex: ReadonlyMap<OperationId, IndexedOperation>
): ReadonlyArray<IndexedWorkflowCausalEdge> => {
  const edges: Array<IndexedWorkflowCausalEdge> = []
  for (const { operation, position } of operationIndex.values()) {
    const successorOperationId = workflowOperationId(operation)
    for (const predecessorOperationId of operation.predecessorOperationIds) {
      edges.push({ edge: { predecessorOperationId, successorOperationId }, successorPosition: position })
    }
  }
  return edges
}

const outsideAuthorityObservationOperationId = (event: WorkflowJournalEvent): OperationId | undefined => {
  if (
    event._tag === "TaskTrackerFactsObserved" ||
    event._tag === "PlannedAttemptWorktreeObserved" ||
    event._tag === "TargetLineageObserved" ||
    event._tag === "AttemptRestartAuthorityReadFailed"
  ) {
    return event.operationId
  }
  return undefined
}

const outsideAuthorityAcknowledgementAt = (
  record: JournalRecord,
  items: ReadonlyArray<TraceHistoryItem>
): TraceOutsideAuthorityAcknowledgement | undefined => {
  const observationOperationId = outsideAuthorityObservationOperationId(record.event)
  if (observationOperationId === undefined) return undefined
  const action = operationItem(items, observationOperationId)
  const observation = occurrenceItemAt(items, record.position)
  /* v8 ignore next -- @preserve validated observation histories project both the intended operation and its exact observation occurrence before relationships are derived. */
  if (action === undefined || observation === undefined) return undefined
  return { action: action.identity, actionOperationId: observationOperationId, observation: observation.identity }
}

const processLocalResourceSerializationAt = (
  record: JournalRecord,
  items: ReadonlyArray<TraceHistoryItem>
): TraceProcessLocalResourceSerialization | undefined => {
  if (record.event._tag !== "IntegrationStarted") return undefined
  const earlier = occurrenceItemAt(items, record.event.responsibilityBeganAt)
  const later = occurrenceItemAt(items, record.position)
  /* v8 ignore next -- @preserve validated IntegrationStarted history binds both responsibility-began and start positions, and projection emits both before relationships are derived. */
  if (earlier === undefined || later === undefined) return undefined
  return { earlier: earlier.identity, later: later.identity, target: record.event.integrationTarget }
}

const singletonOrEmpty = <A>(value: A | undefined): ReadonlyArray<A> => (value === undefined ? [] : [value])

const relationshipsAt = (
  records: ReadonlyArray<JournalRecord>,
  items: ReadonlyArray<TraceHistoryItem>,
  graph: TraceTaskGraph | null,
  operationIndex: ReadonlyMap<OperationId, IndexedOperation>
): TraceRelationships => ({
  outsideAuthorityAcknowledgements: records.flatMap((record) =>
    singletonOrEmpty(outsideAuthorityAcknowledgementAt(record, items))
  ),
  processLocalResourceSerializations: records.flatMap((record) =>
    singletonOrEmpty(processLocalResourceSerializationAt(record, items))
  ),
  taskGraphEdges: graph?.edges ?? [],
  workflowCausalEdges: workflowCausalEdgesOf(operationIndex)
})

const cursorPrefixOf = (
  cursor: TraceCursor,
  records: ReadonlyArray<JournalRecord>
): Effect.Effect<ReadonlyArray<JournalRecord>, TraceCursorNotCommitted> =>
  records.some(({ position }) => position === cursor.position)
    ? Effect.succeed(records.filter(({ position }) => position <= cursor.position))
    : Effect.fail(new TraceCursorNotCommitted({ cursor }))

type WorkflowRunBeginning = Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunBegan" }>

const workflowRunBeginningOf = (
  records: ReadonlyArray<JournalRecord>
): Effect.Effect<WorkflowRunBeginning, TraceJournalPrefixInvalid> =>
  Effect.sync(() => Option.getOrThrow(Schema.decodeUnknownOption(WorkflowRunBeganEvent)(records[0]?.event)))

const historyFromRecords = Effect.fn("TraceReader.historyFromRecords")(function* (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
) {
  yield* validateRecords(runId, records)
  const historyIssue = fullHistoryIssue(runId, records)
  if (historyIssue !== undefined) {
    return yield* new TraceProjectionInvalid({ detail: historyIssue, runId })
  }
  yield* operationIndexOf(runId, records)
  const projection = yield* projectWorkflowOccurrences(records, { includeControlDisposition: true }).pipe(
    Effect.mapError((cause) => new TraceProjectionInvalid({ detail: String(cause), runId }))
  )
  /* v8 ignore next -- @preserve a validated history that reaches this fallback has the same projection used by the complete index; its item mapping is schema-total. */
  const items = projection.occurrences.map((occurrence) => itemFromOccurrence(runId, occurrence))
  const committedThrough = Option.getOrThrow(Option.fromUndefinedOr(records[records.length - 1]?.position))
  return TraceHistory.make({ committedThrough, items, runId, version: traceReaderSchemaVersion })
})

/**
 * A complete immutable journal read can serve every earlier cursor. Keeping
 * the projected items and relationship identities once is important because
 * the authored delivery story asks for one trace view at every position.
 * Prefix views still copy their visible arrays, but do not re-filter,
 * re-validate, or re-project the complete journal from scratch.
 */
type CompleteTraceIndex = {
  readonly committedThrough: JournalPosition
  readonly committedPositions: ReadonlySet<JournalPosition>
  readonly facets: TraceHistoricalFacets
  readonly graphObservations: ReadonlyArray<CompleteGraphObservationAt>
  readonly items: ReadonlyArray<TraceHistoryItem>
  readonly operationIndex: ReadonlyMap<OperationId, IndexedOperation>
  readonly outsideAuthorityAcknowledgements: ReadonlyArray<TraceOutsideAuthorityAcknowledgement>
  readonly processLocalResourceSerializations: ReadonlyArray<TraceProcessLocalResourceSerialization>
  readonly workflowCausalEdges: ReadonlyArray<IndexedWorkflowCausalEdge>
  readonly runId: RunId
  readonly target: TrackerTarget
}

const completeTraceIndexFromRecords = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): Effect.Effect<CompleteTraceIndex, TraceReaderError> =>
  Effect.gen(function* () {
    yield* validateRecords(runId, records)
    const historyIssue = fullHistoryIssue(runId, records)
    if (historyIssue !== undefined) {
      return yield* new TraceProjectionInvalid({ detail: historyIssue, runId })
    }
    const operationIndex = yield* operationIndexOf(runId, records)
    const projection = yield* projectWorkflowOccurrences(records, { includeControlDisposition: true }).pipe(
      Effect.mapError((cause) => new TraceProjectionInvalid({ detail: String(cause), runId }))
    )
    const items = projection.occurrences.map((occurrence) => itemFromOccurrence(runId, occurrence))
    const beginning = yield* workflowRunBeginningOf(records)
    const target = beginning.target
    const graphObservations = completeGraphObservationsFor(records, target)
    const graph = taskGraphAt(records, target)
    const workflowCausalEdges = indexedWorkflowCausalEdgesOf(operationIndex)
    const relationships = relationshipsAt(records, items, graph, operationIndex)
    const facets = traceHistoricalFacetsAt(items, historicalFacetFactories)
    const committedThrough = Option.getOrThrow(Option.fromUndefinedOr(records[records.length - 1]?.position))
    yield* Schema.decodeUnknownEffect(TraceAtCursor)({
      cursor: TraceCursor.make({ position: committedThrough, runId }),
      derivedTaskOrder: TraceDerivedTaskOrder.make({
        basis: "TaskIdCodeUnitAscending",
        taskIds: sortedUniqueTaskIds(graph?.snapshot.tasks.map(({ id }) => id) ?? [])
      }),
      graph,
      items,
      relationships,
      facets,
      version: traceReaderSchemaVersion
    }).pipe(
      /* v8 ignore next -- @preserve validated records and typed projection outputs satisfy TraceAtCursor before this defensive schema error mapping. */
      Effect.mapError((cause) => new TraceProjectionInvalid({ detail: String(cause), runId }))
    )
    const committedPositions: ReadonlySet<JournalPosition> = new Set(records.map(({ position }) => position))
    return {
      committedThrough,
      committedPositions,
      facets,
      graphObservations,
      items,
      operationIndex,
      outsideAuthorityAcknowledgements: relationships.outsideAuthorityAcknowledgements,
      processLocalResourceSerializations: relationships.processLocalResourceSerializations,
      runId,
      target,
      workflowCausalEdges
    } satisfies CompleteTraceIndex
  })

const binarySearchSplitDivisor = 2

const prefixLengthThrough = <A>(
  values: ReadonlyArray<A>,
  positionOf: (value: A) => JournalPosition,
  through: JournalPosition
): number => {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = Math.floor((low + high) / binarySearchSplitDivisor)
    const middleValue = values[middle]
    /* v8 ignore next -- @preserve low < high <= values.length keeps the midpoint inside the array. */
    if (middleValue === undefined) return low
    const position = positionOf(middleValue)
    if (position <= through) low = middle + 1
    else high = middle
  }
  return low
}

const graphAtIndexedPrefix = (
  index: CompleteTraceIndex,
  through: JournalPosition,
  graphByObservationPosition: Map<JournalPosition, TraceTaskGraph | null>
): TraceTaskGraph | null => {
  const latestIndex = prefixLengthThrough(index.graphObservations, ({ position }) => position, through) - 1
  const latest = index.graphObservations[latestIndex]
  if (latest === undefined) return null
  const cached = graphByObservationPosition.get(latest.position)
  if (cached !== undefined) return cached
  const knowledge = {
    taskTrackerFacts: index.graphObservations
      .filter(({ position }) => position <= latest.position)
      .map(({ observation }) => observation)
  }
  const snapshot = reconstructedTaskGraphFor(knowledge, index.target)
  const graph =
    snapshot._tag === "None"
      ? null
      : (() => {
          const wire = snapshot.value.toWire()
          return TraceTaskGraph.make({
            edges: graphEdgesOf(wire),
            observation: { operationId: latest.observation.operationId, recordedAt: latest.position },
            snapshot: wire
          })
        })()
  graphByObservationPosition.set(latest.position, graph)
  return graph
}

/**
 * Constructs a cursor view from the complete index after its full view has
 * passed TraceAtCursor's schema checks. Every field is a prefix slice of an
 * already ordered, relationship-checked value, so checking each cursor again
 * would repeat the same O(prefix) work.
 */
const indexedTraceAtCursor = (
  cursor: TraceCursor,
  graph: TraceTaskGraph | null,
  items: ReadonlyArray<TraceHistoryItem>,
  relationships: TraceRelationships,
  facets: TraceHistoricalFacets
): TraceAtCursor => ({
  cursor,
  derivedTaskOrder: {
    _tag: "DerivedTaskOrder",
    basis: "TaskIdCodeUnitAscending",
    taskIds: sortedUniqueTaskIds(graph?.snapshot.tasks.map(({ id }) => id) ?? [])
  },
  graph,
  items,
  relationships,
  facets,
  version: traceReaderSchemaVersion
})

const atCursorFromCompleteIndex = Effect.fn("TraceReader.atCursorFromCompleteIndex")(function* (
  cursor: TraceCursor,
  index: CompleteTraceIndex,
  graphByObservationPosition: Map<JournalPosition, TraceTaskGraph | null>
) {
  const through = cursor.position
  if (!index.committedPositions.has(through)) {
    return yield* new TraceCursorNotCommitted({ cursor })
  }
  const items = index.items.slice(
    0,
    prefixLengthThrough(index.items, ({ identity }) => identity.position, through)
  )
  const graph = graphAtIndexedPrefix(index, through, graphByObservationPosition)
  const facets = traceHistoricalFacetsAt(items, historicalFacetFactories)
  const relationships: TraceRelationships = {
    outsideAuthorityAcknowledgements: index.outsideAuthorityAcknowledgements.slice(
      0,
      prefixLengthThrough(index.outsideAuthorityAcknowledgements, ({ observation }) => observation.position, through)
    ),
    processLocalResourceSerializations: index.processLocalResourceSerializations.slice(
      0,
      prefixLengthThrough(index.processLocalResourceSerializations, ({ later }) => later.position, through)
    ),
    taskGraphEdges: graph?.edges ?? [],
    workflowCausalEdges: index.workflowCausalEdges
      .slice(
        0,
        prefixLengthThrough(index.workflowCausalEdges, ({ successorPosition }) => successorPosition, through)
      )
      .map(({ edge }) => edge)
  }
  return indexedTraceAtCursor(cursor, graph, items, relationships, facets)
})

const atCursorFromRecords = Effect.fn("TraceReader.atCursorFromRecords")(function* (
  cursor: TraceCursor,
  records: ReadonlyArray<JournalRecord>
) {
  const prefix = yield* cursorPrefixOf(cursor, records)
  yield* validateRecords(cursor.runId, prefix)
  const historyIssue = fullHistoryIssue(cursor.runId, prefix)
  if (historyIssue !== undefined) {
    return yield* new TraceProjectionInvalid({ detail: historyIssue, runId: cursor.runId })
  }
  const operationIndex = yield* operationIndexOf(cursor.runId, prefix)
  const projection = yield* projectWorkflowOccurrences(prefix, { includeControlDisposition: true }).pipe(
    Effect.mapError((cause) => new TraceProjectionInvalid({ detail: String(cause), runId: cursor.runId }))
  )
  const items = projection.occurrences.map((occurrence) => itemFromOccurrence(cursor.runId, occurrence))
  const beginning = yield* workflowRunBeginningOf(prefix)
  const target = beginning.target
  const graph = taskGraphAt(prefix, target)
  const relationships = relationshipsAt(prefix, items, graph, operationIndex)
  const facets = traceHistoricalFacetsAt(items, historicalFacetFactories)
  const taskIds = graph?.snapshot.tasks.flatMap(({ id }) => [id]) ?? []
  return TraceAtCursor.make({
    cursor,
    derivedTaskOrder: TraceDerivedTaskOrder.make({
      basis: "TaskIdCodeUnitAscending",
      taskIds: sortedUniqueTaskIds(taskIds)
    }),
    graph,
    items,
    relationships,
    facets,
    version: traceReaderSchemaVersion
  })
})

/** Builds a reader over a read-only committed-prefix capability. */
export const makeTraceReader = (source: TraceJournalReadSource): TraceReaderService => {
  const readRecords = (runId: RunId) => source.read(runId)
  const completeTraceIndexes = new WeakMap<ReadonlyArray<JournalRecord>, CompleteTraceIndex>()
  type CompleteTraceIndexBuild = {
    readonly deferred: Deferred.Deferred<CompleteTraceIndex, TraceReaderError>
    readonly runId: RunId
  }
  const completeTraceIndexBuilds = new WeakMap<ReadonlyArray<JournalRecord>, CompleteTraceIndexBuild>()
  const graphByIndex = new WeakMap<CompleteTraceIndex, Map<JournalPosition, TraceTaskGraph | null>>()
  const historiesByIndex = new WeakMap<CompleteTraceIndex, TraceHistory>()
  const viewsByIndex = new WeakMap<CompleteTraceIndex, Map<JournalPosition, TraceAtCursor>>()
  const fallbackViewsByRecords = new WeakMap<ReadonlyArray<JournalRecord>, Map<string, TraceAtCursor>>()
  const cursorCacheKey = (cursor: TraceCursor): string => JSON.stringify([cursor.runId, cursor.position])
  const completeTraceIndexFor = (runId: RunId, records: ReadonlyArray<JournalRecord>) => {
    const cached = completeTraceIndexes.get(records)
    if (cached !== undefined && cached.runId === runId) return Effect.succeed(cached)
    const building = completeTraceIndexBuilds.get(records)
    if (building !== undefined && building.runId === runId) return Deferred.await(building.deferred)
    const deferred = Deferred.makeUnsafe<CompleteTraceIndex, TraceReaderError>()
    completeTraceIndexBuilds.set(records, { deferred, runId })
    return completeTraceIndexFromRecords(runId, records).pipe(
      Effect.tap((index) =>
        Effect.sync(() => {
          completeTraceIndexes.set(records, index)
          graphByIndex.set(index, new Map())
          viewsByIndex.set(index, new Map())
        })
      ),
      Effect.tap((index) => Deferred.succeed(deferred, index)),
      Effect.tapError((error) => Deferred.fail(deferred, error))
    )
  }
  const fallbackViewFor = (cursor: TraceCursor, records: ReadonlyArray<JournalRecord>) => {
    const views = fallbackViewsByRecords.get(records) ?? new Map<string, TraceAtCursor>()
    const key = cursorCacheKey(cursor)
    const cached = views.get(key)
    return cached === undefined
      ? atCursorFromRecords(cursor, records).pipe(
          Effect.tap((view) =>
            Effect.sync(() => {
              views.set(key, view)
              fallbackViewsByRecords.set(records, views)
            })
          )
        )
      : Effect.succeed(cached)
  }
  const historyFromIndex = (index: CompleteTraceIndex): TraceHistory =>
    historiesByIndex.get(index) ??
    (() => {
      const history = TraceHistory.make({
        committedThrough: index.committedThrough,
        items: index.items,
        runId: index.runId,
        version: traceReaderSchemaVersion
      })
      historiesByIndex.set(index, history)
      return history
    })()
  const read = (runId: RunId) =>
    readRecords(runId).pipe(
      Effect.flatMap((records) =>
        completeTraceIndexFor(runId, records).pipe(
          Effect.map(historyFromIndex),
          Effect.catch(() => historyFromRecords(runId, records))
        )
      )
    )
  const readAt = (cursor: TraceCursor) =>
    readRecords(cursor.runId).pipe(
      Effect.flatMap((records) =>
        completeTraceIndexFor(cursor.runId, records).pipe(
          Effect.flatMap((index) => {
            /* v8 ignore start -- @preserve completeTraceIndexFor installs this map before publishing the index. */
            const views = viewsByIndex.get(index) ?? new Map<JournalPosition, TraceAtCursor>()
            /* v8 ignore stop */
            const cached = views.get(cursor.position)
            return cached === undefined
              ? atCursorFromCompleteIndex(
                  cursor,
                  index,
                  /* v8 ignore next -- @preserve completeTraceIndexFor installs the graph map before publishing this index. */
                  graphByIndex.get(index) ?? new Map()
                ).pipe(
                  Effect.tap((view) =>
                    Effect.sync(() => {
                      views.set(cursor.position, view)
                      viewsByIndex.set(index, views)
                    })
                  )
                )
              : Effect.succeed(cached)
          }),
          Effect.catch(() => fallbackViewFor(cursor, records))
        )
      )
    )
  const causalPredecessor = (
    cursor: TraceCursor,
    successorOperationId: OperationId,
    predecessorOperationId: OperationId
  ): Effect.Effect<TraceHistoryItem, TraceReaderError | JournalStoreError> =>
    readAt(cursor).pipe(
      Effect.flatMap((view): Effect.Effect<TraceHistoryItem, TraceReaderError> => {
        const edge = view.relationships.workflowCausalEdges.find(
          ({ predecessorOperationId: predecessor, successorOperationId: successor }) =>
            predecessor === predecessorOperationId && successor === successorOperationId
        )
        if (edge === undefined) {
          const failure = new TraceCausalPredecessorMissing({
            predecessorOperationId,
            runId: cursor.runId,
            successorOperationId
          })
          return Effect.fail(failure)
        }
        const item = operationItem(view.items, predecessorOperationId)
        /* v8 ignore next -- @preserve every indexed causal predecessor is emitted by the same validated operation occurrence as the edge. */
        if (item === undefined) {
          const failure = new TraceCausalPredecessorNotProjected({
            predecessorOperationId,
            runId: cursor.runId,
            successorOperationId
          })
          return Effect.fail(failure)
        }
        return Effect.succeed(item)
      })
    )
  return { causalPredecessor, read, readAt }
}

/** Public helper for callers that already hold the read-only service. */
export const readTraceAt = (reader: TraceReaderService, cursor: TraceCursor) => reader.readAt(cursor)

/** Installs the production reader without exposing journal mutation methods to presentation. */
export const TraceReaderLayer = Layer.effect(
  TraceReader,
  Effect.gen(function* () {
    const source = yield* JournalReadSource
    return TraceReader.of(makeTraceReader(source))
  })
).pipe(Layer.provide(journalReadSourceLayer))

/** Read-only current-status composition. Status is a separate value and cannot rewrite history. */
export interface TracePresentation<Status> {
  readonly currentStatus: Status
  readonly history: TraceAtCursor
}

/** Combines one already-fixed historical view with a separately supplied passive status value. */
export const makeTracePresentation = <Status>(
  history: TraceAtCursor,
  currentStatus: Status
): TracePresentation<Status> => ({ currentStatus, history })

/** Keeps the status source passive while preserving the historical cursor as an immutable value. */
export const makeTracePresentationWithStatusSource = <Status>(
  history: TraceAtCursor,
  status: CurrentSignal<Status>
): TracePresentation<CurrentSignal<Status>> => ({ currentStatus: status, history })

/** Narrows the public source to the one passive read capability presentation needs. */
export interface TracePresentationSource<Status> {
  readonly currentStatus: CurrentSignal<Status>
  readonly traceReader: Pick<TraceReaderService, "causalPredecessor" | "read" | "readAt">
}

/** Reads a fixed cursor through presentation's read-only source. */
export const readTracePresentation = <Status>(
  source: TracePresentationSource<Status>,
  cursor: TraceCursor
): Effect.Effect<TracePresentation<CurrentSignal<Status>>, TraceReaderError | JournalStoreError> =>
  source.traceReader
    .readAt(cursor)
    .pipe(Effect.map((history) => makeTracePresentationWithStatusSource(history, source.currentStatus)))
