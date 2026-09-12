/* eslint-disable functional/immutable-data, max-lines -- Historical facet fold uses private mutable reducer state. */
import { Option, Schema } from "effect"
import { IntegrationTarget, plannedTaskAttemptEquivalence, type AttemptId, type TaskId } from "@dalph/contracts"
import type { OperationId } from "../workflow/identity.js"
import { workflowOperationId } from "../workflow/registry/operation.js"
import {
  IntegratorRunCorrelation,
  IntegratorSessionCorrelation,
  integratorCandidateHasExactParents
} from "../workflow/protocols/integrator/events.js"
import { acceptedResultEquivalence } from "../workflow/protocols/integration-admission/responsibility.js"
import { targetPromotionCorrelationEquals } from "../workflow/protocols/target-promotion/events.js"
import { taskTrackerTargetKey } from "../authorities/task-tracker/target.js"
import type { TaskDagSnapshot } from "../authorities/task-tracker/graph.js"
import { reconstructedTaskGraphFor } from "../coordination/reconstruction/graph-knowledge.js"
import type { JournalPosition } from "../workflow-journal/identity.js"
import type { WorkflowOccurrence as WorkflowOccurrenceValue } from "../workflow/registry/occurrence-projection.js"
import type {
  CompleteTaskTrackerFactsObserved,
  TaskTrackerFactsObservation,
  UnchangedTaskTrackerFactsReconfirmed
} from "../workflow/task-tracker-facts/observation.js"
import type {
  TraceHistoricalFacets,
  TraceCleanupProgress,
  TraceCleanupStatus,
  TraceControlDispositionFacet,
  TraceControlFact,
  TraceDispositionFact,
  TraceBranchCleanupStep,
  TraceIntegratorCandidateCleanupStep,
  TraceWorktreeCleanupStep,
  TraceCursor,
  TraceHistoryItem,
  TraceIntegrationFact,
  TraceItemIdentity,
  TraceObservationGap,
  TracePreservationDisposition,
  TraceRetainedResponsibility
} from "./trace-reader.js"
import { traceControlDispositionFacetVersion } from "./trace-reader-version.js"
import { sameJson } from "./trace-equality.js"
import { reduceControlDispositionItem } from "./trace-reader-control-disposition.js"
import { prepareFacetVisibility, type FacetVisibility } from "./trace-reader-facet-visibility.js"

type HistoricalCaseFactories<Union extends { readonly _tag: string }> = {
  readonly [Tag in Union["_tag"]]: {
    readonly make: (
      input: Omit<Extract<Union, { readonly _tag: Tag }>, "_tag">
    ) => Extract<Union, { readonly _tag: Tag }>
  }
}

export type HistoricalFacetFactories = {
  readonly observationGap: HistoricalCaseFactories<TraceObservationGap>
  readonly preservationDisposition: HistoricalCaseFactories<TracePreservationDisposition>
  readonly retainedResponsibility: HistoricalCaseFactories<TraceRetainedResponsibility>
  readonly integrationFact: HistoricalCaseFactories<TraceIntegrationFact>
  readonly controlFact: HistoricalCaseFactories<TraceControlFact>
  readonly dispositionFact: HistoricalCaseFactories<TraceDispositionFact>
  readonly cleanupStatus: HistoricalCaseFactories<TraceCleanupStatus>
  readonly cleanupProgress: HistoricalCaseFactories<TraceCleanupProgress>
  readonly branchCleanupStep: { readonly make: (input: Omit<TraceBranchCleanupStep, "_tag">) => TraceBranchCleanupStep }
  readonly integratorCandidateCleanupStep: {
    readonly make: (input: Omit<TraceIntegratorCandidateCleanupStep, "_tag">) => TraceIntegratorCandidateCleanupStep
  }
  readonly worktreeCleanupStep: {
    readonly make: (input: Omit<TraceWorktreeCleanupStep, "_tag">) => TraceWorktreeCleanupStep
  }
  readonly controlDisposition: {
    readonly make: (input: Omit<TraceControlDispositionFacet, "_tag">) => TraceControlDispositionFacet
  }
  readonly facets: {
    readonly make: (input: {
      readonly controlDisposition: TraceControlDispositionFacet
      readonly integration: { readonly facts: ReadonlyArray<TraceIntegrationFact> }
      readonly recovery: {
        readonly observationGaps: ReadonlyArray<TraceObservationGap>
        readonly preservationDispositions: ReadonlyArray<TracePreservationDisposition>
        readonly retainedResponsibilities: ReadonlyArray<TraceRetainedResponsibility>
      }
    }) => TraceHistoricalFacets
  }
}

const sortedUniqueTaskIds = (taskIds: ReadonlyArray<TaskId>): ReadonlyArray<TaskId> => [...new Set(taskIds)].sort()

const exactTaskIds = (left: ReadonlyArray<TaskId>, right: ReadonlyArray<TaskId>): boolean =>
  sameJson(sortedUniqueTaskIds(left), sortedUniqueTaskIds(right))

const executorReportGapIssue = (
  gap: Extract<TraceObservationGap, { readonly _tag: "ExecutorReport" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  occurrence._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
  occurrence.plannedAttempt.attemptId === gap.attemptId
    ? undefined
    : "Executor report gap must identify the exact executor responsibility beginning"

const integratorResultGapIssue = (
  gap: Extract<TraceObservationGap, { readonly _tag: "IntegratorResult" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  occurrence._tag === "IntegratorRunStarted" && sameIntegratorRun(occurrence.run, gap.run)
    ? undefined
    : "Integrator-result gap must identify the exact run-start occurrence"

const candidateQualificationGapIssue = (
  gap: Extract<TraceObservationGap, { readonly _tag: "CandidateQualification" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  occurrence._tag === "IntegratorCandidateQualificationInitiated" &&
  occurrence.candidateText === gap.candidateText &&
  sameIntegratorRun(occurrence.run, gap.run)
    ? undefined
    : "Candidate-qualification gap must identify the exact qualification intent"

const promotionResultGapIssue = (
  gap: Extract<TraceObservationGap, { readonly _tag: "PromotionResult" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  occurrence._tag === "TargetPromotionAttemptRequested" &&
  occurrence.attemptOrdinal === gap.attemptOrdinal &&
  samePromotion(occurrence.correlation, gap.correlation)
    ? undefined
    : "Promotion-result gap must identify the exact numbered attempt"

const claimAcquisitionGapIssue = (
  gap: Extract<TraceObservationGap, { readonly _tag: "TrackerObservation" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  occurrence._tag === "TaskClaimAcquisitionInitiated" &&
  workflowOperationId(occurrence.operation) === gap.operationId &&
  exactTaskIds([occurrence.operation.acquisition.taskId], gap.taskIds)
    ? undefined
    : "Claim-acquisition gap must identify its exact tracker operation"

const claimReleaseGapIssue = (
  gap: Extract<TraceObservationGap, { readonly _tag: "TrackerObservation" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  occurrence._tag === "TaskClaimReleaseInitiated" &&
  workflowOperationId(occurrence.operation) === gap.operationId &&
  exactTaskIds([occurrence.operation.release.claim.taskId], gap.taskIds)
    ? undefined
    : "Claim-release gap must identify its exact tracker operation"

const trackerReadGapIssue = (
  gap: Extract<TraceObservationGap, { readonly _tag: "TrackerObservation" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined => {
  if (occurrence._tag !== "TaskTrackerReadInitiated") {
    return "Tracker-observation gap must identify the exact tracker read intent"
  }
  const expectedTaskIds =
    occurrence.operation._tag === "ReadTrackerGraph"
      ? occurrence.operation.readShape.explicitlyCoveredTaskIds
      : occurrence.operation._tag === "ReadCompletionTaskFacts"
        ? [occurrence.operation.request.taskId]
        : [occurrence.operation.taskId]
  return workflowOperationId(occurrence.operation) === gap.operationId && exactTaskIds(expectedTaskIds, gap.taskIds)
    ? undefined
    : "Tracker-observation gap must preserve operation and task coverage"
}

const trackerObservationGapIssue = (
  gap: Extract<TraceObservationGap, { readonly _tag: "TrackerObservation" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined => {
  if (gap.required === "TaskClaimAcquired") return claimAcquisitionGapIssue(gap, occurrence)
  if (gap.required === "TaskClaimReleased") return claimReleaseGapIssue(gap, occurrence)
  return trackerReadGapIssue(gap, occurrence)
}

type GitObservationGap = Extract<TraceObservationGap, { readonly _tag: "GitObservation" }>

const worktreeReadyGapIssue = (gap: GitObservationGap, occurrence: WorkflowOccurrenceValue): string | undefined =>
  occurrence._tag === "TaskWorktreeReconciliationInitiated" &&
  workflowOperationId(occurrence.operation) === gap.operationId &&
  exactTaskIds([occurrence.operation.plannedAttempt.taskId], gap.taskIds)
    ? undefined
    : "Git-observation gap must identify its exact worktree reconciliation intent"

const gitReadOperationTagFor = (
  required: GitObservationGap["required"]
): "ReadTaskWorktree" | "ReadTargetLineage" | "ReconcileTaskWorktree" =>
  required === "PlannedAttemptWorktreeObserved"
    ? "ReadTaskWorktree"
    : /* v8 ignore next -- @preserve gitObservationGapIssue dispatches TaskWorktreeReady before this mapper, so only the two read intents reach this union arm. */ required ===
        "TargetLineageObserved"
      ? "ReadTargetLineage"
      : "ReconcileTaskWorktree"

const gitReadGapIssue = (gap: GitObservationGap, occurrence: WorkflowOccurrenceValue): string | undefined => {
  if (occurrence._tag !== "GitReadInitiated") {
    return "Git-observation gap must identify its exact Git read intent"
  }
  return occurrence.operation._tag === gitReadOperationTagFor(gap.required) &&
    workflowOperationId(occurrence.operation) === gap.operationId &&
    exactTaskIds([occurrence.operation.plannedAttempt.taskId], gap.taskIds)
    ? undefined
    : "Git-observation gap must identify its exact Git read intent"
}

const gitObservationGapIssue = (gap: GitObservationGap, occurrence: WorkflowOccurrenceValue): string | undefined =>
  gap.required === "TaskWorktreeReady" ? worktreeReadyGapIssue(gap, occurrence) : gitReadGapIssue(gap, occurrence)

const traceObservationGapIssue = (
  gap: TraceObservationGap,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  const action = provenHistoryItemAt(items, gap.action)
  const occurrence = action.occurrence
  if (gap._tag === "ExecutorReport") return executorReportGapIssue(gap, occurrence)
  if (gap._tag === "IntegratorResult") return integratorResultGapIssue(gap, occurrence)
  if (gap._tag === "CandidateQualification") return candidateQualificationGapIssue(gap, occurrence)
  if (gap._tag === "PromotionResult") return promotionResultGapIssue(gap, occurrence)
  if (gap._tag === "TrackerObservation") return trackerObservationGapIssue(gap, occurrence)
  return gitObservationGapIssue(gap, occurrence)
}

const retainedExecutorWorkIssue = (
  responsibility: Extract<TraceRetainedResponsibility, { readonly _tag: "ExecutorWork" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  occurrence._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
  plannedTaskAttemptEquivalence(occurrence.plannedAttempt, responsibility.plannedAttempt)
    ? undefined
    : "Retained executor work must identify its exact responsibility beginning"

const retainedTaskClaimIssue = (
  responsibility: Extract<TraceRetainedResponsibility, { readonly _tag: "TaskClaim" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  occurrence._tag === "TaskClaimAcquired" && sameJson(occurrence.claim, responsibility.claim)
    ? undefined
    : "Retained task claim must identify its exact acquisition result"

const retainedTaskAttemptPlanIssue = (
  responsibility: Extract<TraceRetainedResponsibility, { readonly _tag: "TaskAttempt" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  occurrence._tag === "TaskAttemptPlanned" &&
  plannedTaskAttemptEquivalence(occurrence.plannedAttempt, responsibility.plannedAttempt)
    ? undefined
    : "Retained task attempt must identify its exact plan or replacement successor"

const retainedTaskAttemptReplacementIssue = (
  responsibility: Extract<TraceRetainedResponsibility, { readonly _tag: "TaskAttempt" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  /* v8 ignore next -- @preserve retainedTaskAttemptIssue dispatches only a PlannedAttemptReplaced occurrence to this helper. */
  occurrence._tag === "PlannedAttemptReplaced" &&
  plannedTaskAttemptEquivalence(occurrence.successorPlan.plannedAttempt, responsibility.plannedAttempt)
    ? undefined
    : "Retained task attempt must identify its exact plan or replacement successor"

const retainedTaskAttemptIssue = (
  responsibility: Extract<TraceRetainedResponsibility, { readonly _tag: "TaskAttempt" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  occurrence._tag === "TaskAttemptPlanned"
    ? retainedTaskAttemptPlanIssue(responsibility, occurrence)
    : occurrence._tag === "PlannedAttemptReplaced"
      ? retainedTaskAttemptReplacementIssue(responsibility, occurrence)
      : "Retained task attempt must identify its exact plan or replacement successor"

const retainedWorktreeIssue = (
  responsibility: Extract<TraceRetainedResponsibility, { readonly _tag: "Worktree" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  occurrence._tag === "TaskWorktreeReady" &&
  plannedTaskAttemptEquivalence(occurrence.operation.plannedAttempt, responsibility.plannedAttempt) &&
  sameJson(occurrence.proof, responsibility.proof)
    ? undefined
    : "Retained worktree must identify its exact readiness proof"

const traceRetainedResponsibilityIssue = (
  responsibility: TraceRetainedResponsibility,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  const source = provenHistoryItemAt(items, responsibility.source)
  const occurrence = source.occurrence
  if (responsibility._tag === "ExecutorWork") return retainedExecutorWorkIssue(responsibility, occurrence)
  if (responsibility._tag === "TaskClaim") return retainedTaskClaimIssue(responsibility, occurrence)
  if (responsibility._tag === "TaskAttempt") return retainedTaskAttemptIssue(responsibility, occurrence)
  return retainedWorktreeIssue(responsibility, occurrence)
}

const worktreeLostDispositionIssue = (
  disposition: Extract<TracePreservationDisposition, { readonly _tag: "WorktreeLost" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  occurrence._tag === "PlannedAttemptWorktreeObserved" &&
  occurrence.observation._tag === "AttemptWorktreeLost" &&
  plannedTaskAttemptEquivalence(occurrence.observation.plannedAttempt, disposition.plannedAttempt) &&
  sameJson(occurrence.observation, disposition.observation)
    ? undefined
    : "Worktree-loss disposition must preserve its exact observation"

const taskAuthorityConflictDispositionIssue = (
  disposition: Extract<TracePreservationDisposition, { readonly _tag: "TaskAuthorityConflict" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  occurrence._tag === "AttemptRestartAuthorityReadFailed" &&
  sameJson(occurrence.failure, disposition.failure) &&
  sameJson(occurrence.subject, disposition.subject)
    ? undefined
    : "Task-authority disposition must preserve its exact failed read"

const replacementPendingDispositionIssue = (
  disposition: Extract<TracePreservationDisposition, { readonly _tag: "ReplacementPending" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  occurrence._tag === "AppliedAttemptChoice" &&
  occurrence.choice === "RestartTaskImplementation" &&
  sameJson(occurrence.subject, disposition.choice)
    ? undefined
    : "Replacement-pending disposition must preserve its exact applied choice"

const integrationQuarantineDispositionIssue = (
  disposition: Extract<TracePreservationDisposition, { readonly _tag: "IntegrationQuarantined" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  occurrence._tag === "IntegrationQuarantined" &&
  Schema.toEquivalence(IntegratorSessionCorrelation)(occurrence.correlation, disposition.correlation) &&
  sameJson(occurrence.basis, disposition.basis)
    ? undefined
    : "Quarantine disposition must preserve its exact quarantine occurrence"

const nonConvergentDispositionIssue = (
  disposition: Extract<TracePreservationDisposition, { readonly _tag: "NonConvergentPromotion" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined =>
  occurrence._tag === "TargetPromotionNonConvergent" &&
  samePromotion(occurrence.correlation, disposition.correlation) &&
  sameJson(occurrence.lastObservation, disposition.lastObservation)
    ? undefined
    : "Non-convergent disposition must preserve its exact terminal occurrence"

const tracePreservationDispositionIssue = (
  disposition: TracePreservationDisposition,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  const source = provenHistoryItemAt(items, disposition.source)
  const occurrence = source.occurrence
  if (disposition._tag === "WorktreeLost") return worktreeLostDispositionIssue(disposition, occurrence)
  if (disposition._tag === "TaskAuthorityConflict")
    return taskAuthorityConflictDispositionIssue(disposition, occurrence)
  if (disposition._tag === "ReplacementPending") return replacementPendingDispositionIssue(disposition, occurrence)
  if (disposition._tag === "IntegrationQuarantined")
    return integrationQuarantineDispositionIssue(disposition, occurrence)
  return nonConvergentDispositionIssue(disposition, occurrence)
}

type AcceptedResultFact = Extract<TraceIntegrationFact, { readonly _tag: "AcceptedResult" }>
type ResponsibilityFact = Extract<TraceIntegrationFact, { readonly _tag: "Responsibility" }>
type SessionStartedFact = Extract<TraceIntegrationFact, { readonly _tag: "SessionStarted" }>
type SessionFact = Extract<TraceIntegrationFact, { readonly _tag: "Session" }>
type IntegratorResultFact = Extract<TraceIntegrationFact, { readonly _tag: "IntegratorResult" }>
type CandidateObservedFact = Extract<TraceIntegrationFact, { readonly _tag: "CandidateObserved" }>
type CandidateQualificationFact = Extract<TraceIntegrationFact, { readonly _tag: "CandidateQualification" }>
type PromotionRequestedFact = Extract<TraceIntegrationFact, { readonly _tag: "PromotionRequested" }>
type PromotionAttemptFact = Extract<TraceIntegrationFact, { readonly _tag: "PromotionAttempt" }>
type PromotionSucceededFact = Extract<TraceIntegrationFact, { readonly _tag: "PromotionSucceeded" }>
type PromotionStaleFact = Extract<TraceIntegrationFact, { readonly _tag: "PromotionStale" }>
type PromotionNonConvergentFact = Extract<TraceIntegrationFact, { readonly _tag: "PromotionNonConvergent" }>
type FocusedCompletionFact = Extract<TraceIntegrationFact, { readonly _tag: "FocusedCompletion" }>
type ClaimReplacementFact = Extract<TraceIntegrationFact, { readonly _tag: "ClaimReplacement" }>
type ClaimDeletionFact = Extract<TraceIntegrationFact, { readonly _tag: "ClaimDeletion" }>
type SettlementFact = Extract<TraceIntegrationFact, { readonly _tag: "Settlement" }>
type DependantReleaseFact = Extract<TraceIntegrationFact, { readonly _tag: "DependantRelease" }>
type QuarantineFact = Extract<TraceIntegrationFact, { readonly _tag: "Quarantine" }>
type ProviderActivityAbsentFact = Extract<TraceIntegrationFact, { readonly _tag: "ProviderActivityAbsent" }>
type QuarantineDirectionFact = Extract<TraceIntegrationFact, { readonly _tag: "QuarantineDirection" }>

type CompleteGraphObservationOccurrence = Extract<
  WorkflowOccurrenceValue,
  { readonly _tag: "TaskTrackerFactsObserved" }
> & { readonly evidence: CompleteTaskTrackerFactsObserved | UnchangedTaskTrackerFactsReconfirmed }

const isCompleteGraphObservation = (
  occurrence: WorkflowOccurrenceValue
): occurrence is CompleteGraphObservationOccurrence =>
  occurrence._tag === "TaskTrackerFactsObserved" &&
  (occurrence.evidence._tag === "CompleteTaskTrackerFacts" ||
    occurrence.evidence._tag === "UnchangedTaskTrackerFactsReconfirmed")

const integrationResponsibilityFactKinds = { Responsibility: true, Session: true, SessionStarted: true } as const

type IntegrationResponsibilityFact = Extract<
  TraceIntegrationFact,
  { readonly _tag: keyof typeof integrationResponsibilityFactKinds }
>

const isIntegrationResponsibilityFact = (fact: TraceIntegrationFact): fact is IntegrationResponsibilityFact =>
  Object.hasOwn(integrationResponsibilityFactKinds, fact._tag)

const integrationResultFactKinds = {
  CandidateObserved: true,
  CandidateQualification: true,
  IntegratorResult: true
} as const

type IntegrationResultFact = Extract<TraceIntegrationFact, { readonly _tag: keyof typeof integrationResultFactKinds }>

const isIntegrationResultFact = (fact: TraceIntegrationFact): fact is IntegrationResultFact =>
  Object.hasOwn(integrationResultFactKinds, fact._tag)

const promotionFactKinds = {
  PromotionAttempt: true,
  PromotionNonConvergent: true,
  PromotionRequested: true,
  PromotionStale: true,
  PromotionSucceeded: true
} as const

type PromotionFact = Extract<TraceIntegrationFact, { readonly _tag: keyof typeof promotionFactKinds }>

const isPromotionFact = (fact: TraceIntegrationFact): fact is PromotionFact =>
  Object.hasOwn(promotionFactKinds, fact._tag)

const completionFactKinds = {
  ClaimDeletion: true,
  ClaimReplacement: true,
  FocusedCompletion: true,
  Settlement: true
} as const

type CompletionFact = Extract<TraceIntegrationFact, { readonly _tag: keyof typeof completionFactKinds }>

const isCompletionFact = (fact: TraceIntegrationFact): fact is CompletionFact =>
  Object.hasOwn(completionFactKinds, fact._tag)

const preservationFactKinds = { ProviderActivityAbsent: true, Quarantine: true, QuarantineDirection: true } as const

type PreservationFact = Extract<TraceIntegrationFact, { readonly _tag: keyof typeof preservationFactKinds }>

const isPreservationFact = (fact: TraceIntegrationFact): fact is PreservationFact =>
  Object.hasOwn(preservationFactKinds, fact._tag)

type AcceptedExecutorReport = Extract<WorkflowOccurrenceValue, { readonly _tag: "PlannedAttemptExecutorWorkReported" }>

const acceptedExecutorReportOf = (
  fact: AcceptedResultFact,
  source: WorkflowOccurrenceValue
): AcceptedExecutorReport["report"] | undefined => {
  if (
    source._tag !== "PlannedAttemptExecutorWorkReported" ||
    source.report._tag !== "ExecutorWorkTerminal" ||
    source.report.result._tag !== "Accepted" ||
    !acceptedResultEquivalence(fact.acceptedResult, source.report.result.acceptedResult)
  ) {
    return undefined
  }
  return source.report
}

const acceptedResultResponsibilityMatches = (
  fact: AcceptedResultFact,
  report: AcceptedExecutorReport["report"],
  responsibility: TraceHistoryItem | undefined
): boolean =>
  responsibility?.occurrence._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
  responsibility.occurrence.plannedAttempt.runId === report.correlation.runId &&
  plannedTaskAttemptEquivalence(fact.plannedAttempt, responsibility.occurrence.plannedAttempt)

const acceptedResultFactIssue = (
  fact: AcceptedResultFact,
  source: WorkflowOccurrenceValue,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  const report = acceptedExecutorReportOf(fact, source)
  if (report === undefined) return "Accepted result fact must identify one exact terminal executor report"
  const responsibility = items.find(
    ({ occurrence }) =>
      occurrence._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      occurrence.plannedAttempt.attemptId === report.correlation.attemptId
  )
  return acceptedResultResponsibilityMatches(fact, report, responsibility)
    ? undefined
    : "Accepted result fact must retain the source executor report's exact planned attempt"
}

const responsibilitySourceMatches = (
  fact: ResponsibilityFact,
  source: WorkflowOccurrenceValue
): source is Extract<WorkflowOccurrenceValue, { readonly _tag: "IntegrationResponsibilityBegan" }> =>
  source._tag === "IntegrationResponsibilityBegan" &&
  acceptedResultEquivalence(fact.acceptedResult, source.acceptedResult) &&
  plannedTaskAttemptEquivalence(fact.plannedAttempt, source.plannedAttempt) &&
  sameIntegrationTarget(fact.target, source.integrationTarget)

const responsibilityPredecessorMatches = (
  fact: ResponsibilityFact,
  source: Extract<WorkflowOccurrenceValue, { readonly _tag: "IntegrationResponsibilityBegan" }>,
  items: ReadonlyArray<TraceHistoryItem>
): boolean => {
  if (fact.sameTargetPredecessor === null) return true
  const predecessor = historyItemAt(items, fact.sameTargetPredecessor)
  return (
    predecessor?.occurrence._tag === "IntegrationResponsibilityBegan" &&
    predecessor.occurrence.recordedAt < source.recordedAt &&
    sameIntegrationTarget(predecessor.occurrence.integrationTarget, source.integrationTarget)
  )
}

const responsibilityFactIssue = (
  fact: ResponsibilityFact,
  source: WorkflowOccurrenceValue,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  if (!responsibilitySourceMatches(fact, source)) {
    return "Integration responsibility fact must identify its exact source occurrence"
  }
  return responsibilityPredecessorMatches(fact, source, items)
    ? undefined
    : "Same-target responsibility order must point to one earlier responsibility for that target"
}

const sessionStartedFactIssue = (
  fact: SessionStartedFact,
  source: WorkflowOccurrenceValue,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  const responsibility = historyItemAt(items, fact.responsibility)
  return source._tag === "IntegrationStarted" &&
    source.responsibilityBeganAt === fact.responsibility.position &&
    responsibility?.occurrence._tag === "IntegrationResponsibilityBegan" &&
    responsibility.occurrence.recordedAt < source.recordedAt &&
    sameIntegrationTarget(responsibility.occurrence.integrationTarget, source.integrationTarget)
    ? undefined
    : "Integration session start must point to its exact earlier responsibility occurrence"
}

const sessionFactIssue = (fact: SessionFact, source: WorkflowOccurrenceValue): string | undefined =>
  source._tag === "IntegratorSessionFixed" &&
  Schema.toEquivalence(IntegratorSessionCorrelation)(fact.correlation, source.correlation)
    ? undefined
    : "Integrator session fact must identify its exact fixed-session occurrence"

const integrationResponsibilityFactIssue = (
  fact: IntegrationResponsibilityFact,
  source: WorkflowOccurrenceValue,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  if (fact._tag === "Responsibility") return responsibilityFactIssue(fact, source, items)
  if (fact._tag === "SessionStarted") return sessionStartedFactIssue(fact, source, items)
  return sessionFactIssue(fact, source)
}

const integratorResultFactIssue = (fact: IntegratorResultFact, source: WorkflowOccurrenceValue): string | undefined =>
  source._tag === "IntegratorRunResultRecorded" &&
  sameIntegratorRun(fact.run, source.run) &&
  sameJson(fact.result, source.result)
    ? undefined
    : "Integrator result fact must identify its exact outer result occurrence"

const candidateObservedFactIssue = (
  fact: CandidateObservedFact,
  source: WorkflowOccurrenceValue
): string | undefined =>
  source._tag === "IntegratorCandidateQualificationObserved" &&
  source.candidateText === fact.candidateText &&
  sameIntegratorRun(source.originatingActionRun, fact.run) &&
  sameJson(source.observation, fact.observation)
    ? undefined
    : "Candidate observation fact must identify its exact Git observation occurrence"

type CandidateQualificationObservation = Extract<
  WorkflowOccurrenceValue,
  { readonly _tag: "IntegratorCandidateQualificationObserved" }
>

const candidateQualificationSourceMatches = (
  fact: CandidateQualificationFact,
  source: WorkflowOccurrenceValue
): source is CandidateQualificationObservation =>
  source._tag === "IntegratorCandidateQualificationObserved" &&
  source.observation._tag === "Commit" &&
  source.candidateText === fact.candidateText &&
  source.observation.commit === fact.candidateCommit &&
  sameJson(source.observation.directParents, fact.directParents) &&
  integratorCandidateHasExactParents(
    source.observation,
    source.originatingActionRun.session.expectedTargetHead,
    source.originatingActionRun.session.acceptedResult.commit
  ) &&
  sameIntegratorRun(source.originatingActionRun, fact.run)

const candidateQualificationPreparedResultExists = (
  fact: CandidateQualificationFact,
  source: CandidateQualificationObservation,
  items: ReadonlyArray<TraceHistoryItem>
): boolean =>
  items.some(
    ({ occurrence }) =>
      occurrence._tag === "IntegratorRunResultRecorded" &&
      occurrence.recordedAt < source.recordedAt &&
      sameIntegratorRun(occurrence.run, source.originatingActionRun) &&
      occurrence.result._tag === "PreparedCandidate" &&
      occurrence.result.candidateText === fact.candidateText
  )

const candidateQualificationFactIssue = (
  fact: CandidateQualificationFact,
  source: WorkflowOccurrenceValue,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  if (!candidateQualificationSourceMatches(fact, source)) {
    return "Candidate qualification fact must preserve PreparedCandidate and ordered Git parents [H, C]"
  }
  return candidateQualificationPreparedResultExists(fact, source, items)
    ? undefined
    : "Candidate qualification fact must preserve PreparedCandidate and ordered Git parents [H, C]"
}

const integrationResultFactIssue = (
  fact: IntegrationResultFact,
  source: WorkflowOccurrenceValue,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  if (fact._tag === "IntegratorResult") return integratorResultFactIssue(fact, source)
  if (fact._tag === "CandidateObserved") return candidateObservedFactIssue(fact, source)
  return candidateQualificationFactIssue(fact, source, items)
}

const promotionRequestedFactIssue = (
  fact: PromotionRequestedFact,
  source: WorkflowOccurrenceValue
): string | undefined =>
  source._tag === "TargetPromotionRequested" && targetPromotionCorrelationEquals(source.correlation, fact.correlation)
    ? undefined
    : "Promotion request fact must identify its exact request occurrence"

type PromotionAttemptOccurrence = Extract<WorkflowOccurrenceValue, { readonly _tag: "TargetPromotionAttemptRequested" }>

const promotionAttemptSourceMatches = (
  fact: PromotionAttemptFact,
  source: WorkflowOccurrenceValue
): source is PromotionAttemptOccurrence =>
  source._tag === "TargetPromotionAttemptRequested" &&
  targetPromotionCorrelationEquals(source.correlation, fact.correlation) &&
  source.attemptOrdinal === fact.attemptOrdinal &&
  sameJson(source.reason, fact.reason)

const firstPromotionAttemptMatches = (
  source: PromotionAttemptOccurrence,
  earlierAttempts: ReadonlyArray<TraceHistoryItem>
): boolean => source.reason._tag === "Initial" && earlierAttempts.length === 0

const retriedPromotionAttemptMatches = (
  source: PromotionAttemptOccurrence,
  earlierAttempts: ReadonlyArray<TraceHistoryItem>
): boolean => {
  if (source.attemptOrdinal === 1 || source.reason._tag !== "ReconciledExpectedHead") return false
  const previousOrdinal = source.attemptOrdinal - 1
  return (
    source.reason.previousAttemptOrdinal === previousOrdinal &&
    earlierAttempts.some(
      ({ occurrence }) =>
        occurrence._tag === "TargetPromotionAttemptRequested" && occurrence.attemptOrdinal === previousOrdinal
    )
  )
}

const promotionAttemptFactIssue = (
  fact: PromotionAttemptFact,
  source: WorkflowOccurrenceValue,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  if (source._tag !== "TargetPromotionAttemptRequested") {
    return "Promotion attempt fact must identify its exact numbered attempt occurrence"
  }
  if (!promotionAttemptSourceMatches(fact, source)) {
    return "Promotion attempt fact must preserve its exact ordinal, reason, and correlation"
  }
  const earlierAttempts = items.filter(
    ({ occurrence }) =>
      occurrence._tag === "TargetPromotionAttemptRequested" &&
      occurrence.recordedAt < source.recordedAt &&
      targetPromotionCorrelationEquals(occurrence.correlation, source.correlation)
  )
  return source.attemptOrdinal === 1
    ? firstPromotionAttemptMatches(source, earlierAttempts)
      ? undefined
      : "First promotion attempt must use Initial reason with no earlier attempt"
    : retriedPromotionAttemptMatches(source, earlierAttempts)
      ? undefined
      : "Retried promotion attempt must reference the immediately preceding ordinal"
}

const promotionSucceededFactIssue = (
  fact: PromotionSucceededFact,
  source: WorkflowOccurrenceValue
): string | undefined =>
  source._tag === "TargetPromotionSucceeded" &&
  targetPromotionCorrelationEquals(source.correlation, fact.correlation) &&
  sameJson(source.basis, fact.basis) &&
  sameJson(source.observation, fact.observation)
    ? undefined
    : "Promotion success fact must identify its exact Git success occurrence"

const promotionStaleFactIssue = (fact: PromotionStaleFact, source: WorkflowOccurrenceValue): string | undefined =>
  source._tag === "TargetPromotionStale" &&
  targetPromotionCorrelationEquals(source.correlation, fact.correlation) &&
  sameJson(source.basis, fact.basis) &&
  sameJson(source.observation, fact.observation)
    ? undefined
    : "Promotion stale fact must identify its exact Git stale occurrence"

const promotionNonConvergentFactIssue = (
  fact: PromotionNonConvergentFact,
  source: WorkflowOccurrenceValue
): string | undefined =>
  source._tag === "TargetPromotionNonConvergent" &&
  targetPromotionCorrelationEquals(source.correlation, fact.correlation) &&
  fact.attemptOrdinal === source.attemptOrdinal &&
  sameJson(source.lastObservation, fact.lastObservation)
    ? undefined
    : "Promotion non-convergence fact must identify its exact terminal occurrence"

const promotionTerminalFactIssue = (
  fact: PromotionSucceededFact | PromotionStaleFact | PromotionNonConvergentFact,
  source: WorkflowOccurrenceValue
): string | undefined => {
  if (fact._tag === "PromotionSucceeded") return promotionSucceededFactIssue(fact, source)
  if (fact._tag === "PromotionStale") return promotionStaleFactIssue(fact, source)
  return promotionNonConvergentFactIssue(fact, source)
}

const promotionFactIssue = (
  fact: PromotionFact,
  source: WorkflowOccurrenceValue,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  if (fact._tag === "PromotionRequested") return promotionRequestedFactIssue(fact, source)
  if (fact._tag === "PromotionAttempt") return promotionAttemptFactIssue(fact, source, items)
  return promotionTerminalFactIssue(fact, source)
}

const focusedCompletionFactIssue = (
  fact: FocusedCompletionFact,
  source: WorkflowOccurrenceValue
): string | undefined =>
  source._tag === "IntegrationFocusedCompletionOccurred" && sameJson(fact.event, source.event)
    ? undefined
    : "Focused completion fact must identify its exact completion step"

const claimReplacementFactIssue = (fact: ClaimReplacementFact, source: WorkflowOccurrenceValue): string | undefined =>
  source._tag === "IntegrationClaimReplacementOccurred" && sameJson(fact.event, source.event)
    ? undefined
    : "Claim replacement fact must identify its exact replacement step"

const claimDeletionFactIssue = (fact: ClaimDeletionFact, source: WorkflowOccurrenceValue): string | undefined =>
  source._tag === "IntegrationClaimDeletionOccurred" && sameJson(fact.event, source.event)
    ? undefined
    : "Claim deletion fact must identify its exact deletion step"

const settlementFactIssue = (fact: SettlementFact, source: WorkflowOccurrenceValue): string | undefined =>
  source._tag === "IntegrationFinalitySettledOccurred" && sameJson(fact.event, source.event)
    ? undefined
    : "Settlement fact must identify its exact settlement event"

const completionFactIssue = (fact: CompletionFact, source: WorkflowOccurrenceValue): string | undefined => {
  if (fact._tag === "FocusedCompletion") return focusedCompletionFactIssue(fact, source)
  if (fact._tag === "ClaimReplacement") return claimReplacementFactIssue(fact, source)
  if (fact._tag === "ClaimDeletion") return claimDeletionFactIssue(fact, source)
  return settlementFactIssue(fact, source)
}

const dependantGraphObservationMatches = (
  fact: DependantReleaseFact,
  sourceItem: TraceHistoryItem
): sourceItem is TraceHistoryItem & { readonly occurrence: CompleteGraphObservationOccurrence } => {
  /* v8 ignore next -- @preserve sourceItem is proven by fact.source immediately before this validator, so its identity cannot differ here. */
  if (!sameTraceItemIdentity(sourceItem.identity, fact.source)) return false
  if (!sameTraceItemIdentity(sourceItem.identity, fact.graphSource)) return false
  const source = sourceItem.occurrence
  return isCompleteGraphObservation(source) && sameJson(source.evidence, fact.graphObservation)
}

type SettledOccurrence = Extract<WorkflowOccurrenceValue, { readonly _tag: "IntegrationFinalitySettledOccurred" }>

const dependantReleaseSettlementIdentityMatches = (
  fact: DependantReleaseFact,
  settlement: TraceHistoryItem | undefined
): settlement is TraceHistoryItem & { readonly occurrence: SettledOccurrence } =>
  settlement !== undefined &&
  settlement.occurrence._tag === "IntegrationFinalitySettledOccurred" &&
  sameTraceItemIdentity(settlement.identity, fact.settlementSource)

const completeLifecycle = (lifecycle: Option.Option<{ readonly _tag: string }>): boolean =>
  Option.isSome(lifecycle) && lifecycle.value._tag === "CompletedSuccessfully"

const dependantReleaseGraphProvesSettledTask = (graph: TaskDagSnapshot, taskId: TaskId): boolean =>
  completeLifecycle(graph.lifecycleOf(taskId)) &&
  graph.prerequisitesOf(taskId).every((prerequisite) => completeLifecycle(graph.lifecycleOf(prerequisite)))

const dependantReleaseGraphObservationsThrough = (
  items: ReadonlyArray<TraceHistoryItem>,
  position: JournalPosition
): ReadonlyArray<TaskTrackerFactsObservation> =>
  items.flatMap(({ occurrence }) =>
    occurrence._tag === "TaskTrackerFactsObserved" && occurrence.recordedAt <= position ? [occurrence.evidence] : []
  )

const dependantReleaseGraphFor = (
  source: Extract<WorkflowOccurrenceValue, { readonly _tag: "TaskTrackerFactsObserved" }>,
  settlement: SettledOccurrence,
  items: ReadonlyArray<TraceHistoryItem>
): Option.Option<TaskDagSnapshot> =>
  reconstructedTaskGraphFor(
    { taskTrackerFacts: dependantReleaseGraphObservationsThrough(items, source.recordedAt) },
    settlement.event.successObservation.target
  )

const dependantReleaseSettlementProofMatches = (
  source: CompleteGraphObservationOccurrence,
  settlement: SettledOccurrence
): boolean =>
  taskTrackerTargetKey(source.evidence.target) === taskTrackerTargetKey(settlement.event.successObservation.target)

const dependantReleaseFactMatchesSettlement = (
  fact: DependantReleaseFact,
  source: CompleteGraphObservationOccurrence,
  settlement: SettledOccurrence
): boolean =>
  sameJson(settlement.event, fact.settlement) &&
  taskIdsOfCompleteGraphObservation(source.evidence).includes(settlement.event.claim.plannedAttempt.taskId) &&
  fact.settlementSource.position < fact.graphSource.position &&
  source.recordedAt === fact.graphSource.position

const dependantReleaseSettlementMatches = (
  fact: DependantReleaseFact,
  source: CompleteGraphObservationOccurrence,
  settlement: TraceHistoryItem | undefined,
  items: ReadonlyArray<TraceHistoryItem>
): boolean => {
  if (!dependantReleaseSettlementIdentityMatches(fact, settlement)) return false
  if (!dependantReleaseSettlementProofMatches(source, settlement.occurrence)) return false
  const reconstructed = dependantReleaseGraphFor(source, settlement.occurrence, items)
  if (Option.isNone(reconstructed)) return false
  const taskId = settlement.occurrence.event.claim.plannedAttempt.taskId
  return (
    dependantReleaseGraphProvesSettledTask(reconstructed.value, taskId) &&
    dependantReleaseFactMatchesSettlement(fact, source, settlement.occurrence)
  )
}

const dependantReleaseFactIssue = (
  fact: DependantReleaseFact,
  sourceItem: TraceHistoryItem,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  const settlement = historyItemAt(items, fact.settlementSource)
  if (!dependantGraphObservationMatches(fact, sourceItem)) {
    return "Dependant-release evidence must bind the exact later complete graph and earlier settlement"
  }
  return dependantReleaseSettlementMatches(fact, sourceItem.occurrence, settlement, items)
    ? undefined
    : "Dependant-release evidence must bind the exact later complete graph and earlier settlement"
}

const quarantineFactIssue = (fact: QuarantineFact, source: WorkflowOccurrenceValue): string | undefined =>
  source._tag === "IntegrationQuarantined" &&
  Schema.toEquivalence(IntegratorSessionCorrelation)(fact.correlation, source.correlation) &&
  sameJson(fact.basis, source.basis)
    ? undefined
    : "Quarantine fact must identify its exact preservation occurrence"

const providerActivityAbsentFactIssue = (
  fact: ProviderActivityAbsentFact,
  source: WorkflowOccurrenceValue
): string | undefined =>
  source._tag === "IntegrationProviderRunActivityAbsent" &&
  sameIntegratorRun(fact.run, source.run) &&
  Schema.toEquivalence(IntegratorSessionCorrelation)(fact.correlation, source.correlation)
    ? undefined
    : "Provider-activity fact must identify its exact observation occurrence"

const quarantineDirectionFactIssue = (
  fact: QuarantineDirectionFact,
  source: WorkflowOccurrenceValue
): string | undefined =>
  source._tag === "IntegrationQuarantineDirectionApplied" && sameJson(fact.fingerprint, source.fingerprint)
    ? undefined
    : "Quarantine direction fact must identify its exact operator occurrence"

const preservationFactIssue = (fact: PreservationFact, source: WorkflowOccurrenceValue): string | undefined => {
  if (fact._tag === "Quarantine") return quarantineFactIssue(fact, source)
  if (fact._tag === "ProviderActivityAbsent") return providerActivityAbsentFactIssue(fact, source)
  return quarantineDirectionFactIssue(fact, source)
}

const traceHistoricalFactIssueAfterSource = (
  fact: TraceIntegrationFact,
  sourceItem: TraceHistoryItem,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  const source = sourceItem.occurrence
  if (fact._tag === "AcceptedResult") return acceptedResultFactIssue(fact, source, items)
  if (isIntegrationResponsibilityFact(fact)) return integrationResponsibilityFactIssue(fact, source, items)
  if (isIntegrationResultFact(fact)) return integrationResultFactIssue(fact, source, items)
  if (isPromotionFact(fact)) return promotionFactIssue(fact, source, items)
  if (isCompletionFact(fact)) return completionFactIssue(fact, source)
  if (fact._tag === "DependantRelease") return dependantReleaseFactIssue(fact, sourceItem, items)
  /* v8 ignore next -- @preserve TraceIntegrationFact is a closed TaggedUnion and all non-preservation variants are dispatched above. */
  if (isPreservationFact(fact)) return preservationFactIssue(fact, source)
  return undefined
}

const traceHistoricalFactIssue = (
  fact: TraceIntegrationFact,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  const sourceItem = provenHistoryItemAt(items, fact.source)
  return traceHistoricalFactIssueAfterSource(fact, sourceItem, items)
}

export const traceHistoricalFacetsIssue = (
  view: {
    readonly cursor: TraceCursor
    readonly items: ReadonlyArray<TraceHistoryItem>
    readonly facets: TraceHistoricalFacets
  },
  factories: HistoricalFacetFactories
): string | undefined => {
  const identities: ReadonlyArray<TraceItemIdentity> = [
    ...view.facets.recovery.observationGaps.map(({ action }) => action),
    ...view.facets.recovery.preservationDispositions.map(({ source }) => source),
    ...view.facets.recovery.retainedResponsibilities.map(({ source }) => source),
    ...view.facets.integration.facts.flatMap((fact) => {
      if (fact._tag === "SessionStarted") return [fact.source, fact.responsibility]
      if (fact._tag === "Responsibility" && fact.sameTargetPredecessor !== null) {
        return [fact.source, fact.sameTargetPredecessor]
      }
      if (fact._tag === "DependantRelease") {
        return [fact.source, fact.graphSource, fact.settlementSource]
      }
      return [fact.source]
    })
  ]
  const invalid = invalidSourceIdentityFor(identities, view.cursor, view.items)
  if (invalid !== undefined) return "Every historical facet source must resolve to an item in the cursor prefix"
  const invalidGap = view.facets.recovery.observationGaps.find(
    (gap) => traceObservationGapIssue(gap, view.items) !== undefined
  )
  if (invalidGap !== undefined) return traceObservationGapIssue(invalidGap, view.items)
  const invalidDisposition = view.facets.recovery.preservationDispositions.find(
    (disposition) => tracePreservationDispositionIssue(disposition, view.items) !== undefined
  )
  if (invalidDisposition !== undefined) return tracePreservationDispositionIssue(invalidDisposition, view.items)
  const invalidResponsibility = view.facets.recovery.retainedResponsibilities.find(
    (responsibility) => traceRetainedResponsibilityIssue(responsibility, view.items) !== undefined
  )
  if (invalidResponsibility !== undefined) return traceRetainedResponsibilityIssue(invalidResponsibility, view.items)
  const invalidFact = view.facets.integration.facts.find(
    (fact) => traceHistoricalFactIssue(fact, view.items) !== undefined
  )
  if (invalidFact !== undefined) return traceHistoricalFactIssue(invalidFact, view.items)
  const invalidControlDispositionSource = invalidSourceIdentityFor(
    controlDispositionSourcesFor(view.facets.controlDisposition),
    view.cursor,
    view.items
  )
  if (invalidControlDispositionSource !== undefined) {
    return "Every control, disposition, and cleanup source must resolve to an item in the cursor prefix"
  }
  const expected = traceHistoricalFacetsAt(view.items, factories)
  return sameJson(expected, view.facets)
    ? undefined
    : "Historical recovery and integration facets must equal the exact validated cursor fold"
}

const latestSameTargetResponsibilityIndex = -1 // eslint-disable-line no-magic-numbers

const identityOutsideCursor = (identity: TraceItemIdentity, cursor: TraceCursor): boolean =>
  identity.runId !== cursor.runId || identity.position > cursor.position

const historyItemAt = (
  items: ReadonlyArray<TraceHistoryItem>,
  identity: TraceItemIdentity
): TraceHistoryItem | undefined =>
  items.find(
    ({ identity: itemIdentity }) => itemIdentity.runId === identity.runId && itemIdentity.position === identity.position
  )

const invalidSourceIdentityFor = (
  identities: ReadonlyArray<TraceItemIdentity>,
  cursor: TraceCursor,
  items: ReadonlyArray<TraceHistoryItem>
): TraceItemIdentity | undefined =>
  identities.find((identity) => identityOutsideCursor(identity, cursor) || historyItemAt(items, identity) === undefined)

const controlDispositionSourcesFor = (facet: TraceControlDispositionFacet): ReadonlyArray<TraceItemIdentity> => [
  ...facet.controls.map(({ source }) => source),
  ...facet.dispositions.map(({ source }) => source),
  ...facet.cleanup.flatMap((progress) => [progress.status.source, ...progress.steps.map(({ source }) => source)])
]

/** The public facet invariant proves this lookup before any private facet validator runs. */
const provenHistoryItemAt = (items: ReadonlyArray<TraceHistoryItem>, identity: TraceItemIdentity): TraceHistoryItem =>
  Option.getOrThrow(Option.fromUndefinedOr(historyItemAt(items, identity)))

const sameTraceItemIdentity = (left: TraceItemIdentity, right: TraceItemIdentity): boolean =>
  left.runId === right.runId && left.position === right.position

const traceItemAt = (
  items: ReadonlyArray<TraceHistoryItem>,
  position: JournalPosition
): TraceItemIdentity | undefined => items.find(({ identity }) => identity.position === position)?.identity

const itemForOccurrence = (
  items: ReadonlyArray<TraceHistoryItem>,
  predicate: (occurrence: WorkflowOccurrenceValue) => boolean
): TraceHistoryItem | undefined => items.find(({ occurrence }) => predicate(occurrence))

const sameIntegratorRun = (left: IntegratorRunCorrelation, right: IntegratorRunCorrelation): boolean =>
  Schema.toEquivalence(IntegratorRunCorrelation)(left, right)

const samePromotion = targetPromotionCorrelationEquals

const sameIntegrationTarget = Schema.toEquivalence(IntegrationTarget)

const taskIdsOfCompleteGraphObservation = (
  observation: CompleteGraphObservationOccurrence["evidence"]
): ReadonlyArray<TaskId> =>
  observation._tag === "CompleteTaskTrackerFacts"
    ? observation.factFamilies[0].taskIds
    : observation.factFamilies[1].subjectTaskIds

const operationIdsOfHistoricalWorktreeOccurrence = (
  occurrence: WorkflowOccurrenceValue
): ReadonlyArray<OperationId> | undefined => {
  /* v8 ignore next -- @preserve historicalFacetHasObservationFor filters outcome tags only; no public fold invokes this helper for the reconciliation-intent tag. */
  if (occurrence._tag === "TaskWorktreeReconciliationInitiated") return [workflowOperationId(occurrence.operation)]
  return occurrence._tag === "TaskWorktreeReady" ? [occurrence.operationId] : undefined
}

const operationIdsOfObservedOccurrence = (
  occurrence: WorkflowOccurrenceValue
): ReadonlyArray<OperationId> | undefined => {
  /* v8 ignore next -- @preserve historicalFacetHasObservationFor checks tags before calling operationIdsOfOccurrence, so this negative guard cannot be selected by a validated fold. */
  if (
    occurrence._tag !== "PlannedAttemptWorktreeObserved" &&
    occurrence._tag !== "TargetLineageObserved" &&
    occurrence._tag !== "AttemptRestartAuthorityReadFailed" &&
    occurrence._tag !== "TaskClaimAcquired" &&
    occurrence._tag !== "TaskClaimReleased" &&
    occurrence._tag !== "TaskTrackerFactsObserved"
  ) {
    return undefined
  }
  return [occurrence.originatingActionOperationId]
}

const operationIdsOfOccurrence = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<OperationId> =>
  /* v8 ignore next -- @preserve historicalFacetHasObservationFor admits only TaskWorktreeReady or observed-operation tags before this fallback chain. */
  operationIdsOfHistoricalWorktreeOccurrence(occurrence) ?? operationIdsOfObservedOccurrence(occurrence) ?? []

type ExecutorReportOccurrence = Extract<
  WorkflowOccurrenceValue,
  { readonly _tag: "PlannedAttemptExecutorWorkReported" }
>

export type HistoricalFacetReductionState = {
  readonly cleanup: Array<TraceCleanupProgress>
  readonly controls: Array<TraceControlFact>
  readonly dispositions: Array<TraceDispositionFact>
  readonly factories: HistoricalFacetFactories
  readonly executorReports: Map<AttemptId, ExecutorReportOccurrence>
  readonly integrationFacts: Array<TraceIntegrationFact>
  readonly items: ReadonlyArray<TraceHistoryItem>
  readonly observationGaps: Array<TraceObservationGap>
  readonly preservationDispositions: Array<TracePreservationDisposition>
  readonly retainedClaims: RetainedResponsibilityCollection<OperationId>
  readonly retainedExecutorWork: RetainedResponsibilityCollection<AttemptId>
  readonly retainedTaskAttempts: RetainedResponsibilityCollection<AttemptId>
  readonly retainedWorktrees: RetainedResponsibilityCollection<AttemptId>
}

const makeHistoricalFacetReductionState = (
  items: ReadonlyArray<TraceHistoryItem>,
  factories: HistoricalFacetFactories
): HistoricalFacetReductionState => ({
  cleanup: [],
  controls: [],
  dispositions: [],
  factories,
  executorReports: new Map(),
  integrationFacts: [],
  items,
  observationGaps: [],
  preservationDispositions: [],
  retainedClaims: new Map(),
  retainedExecutorWork: new Map(),
  retainedTaskAttempts: new Map(),
  retainedWorktrees: new Map()
})

const historicalFacetHasObservationFor = (
  items: ReadonlyArray<TraceHistoryItem>,
  operationId: OperationId,
  tags: ReadonlyArray<string>
): boolean =>
  items.some(
    ({ occurrence }) => tags.includes(occurrence._tag) && operationIdsOfOccurrence(occurrence).includes(operationId)
  )

const historicalFacetTaskIdsOfTrackerOperation = (
  operation: Extract<WorkflowOccurrenceValue, { readonly _tag: "TaskTrackerReadInitiated" }>["operation"]
): ReadonlyArray<TaskId> => {
  if (operation._tag === "ReadTrackerGraph") return operation.readShape.explicitlyCoveredTaskIds
  return operation._tag === "ReadCompletionTaskFacts" ? [operation.request.taskId] : [operation.taskId]
}

const reduceDependantReleaseFact = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (!isCompleteGraphObservation(occurrence)) return
  const graphTaskIds = taskIdsOfCompleteGraphObservation(occurrence.evidence)
  const settlement = state.items.findLast(
    ({ occurrence: candidate }) =>
      candidate._tag === "IntegrationFinalitySettledOccurred" &&
      candidate.recordedAt < occurrence.recordedAt &&
      graphTaskIds.includes(candidate.event.claim.plannedAttempt.taskId)
  )
  if (settlement?.occurrence._tag !== "IntegrationFinalitySettledOccurred") return
  const fact = state.factories.integrationFact.DependantRelease.make({
    graphObservation: occurrence.evidence,
    graphSource: item.identity,
    settlement: settlement.occurrence.event,
    settlementSource: settlement.identity,
    source: item.identity
  })
  if (dependantReleaseFactIssue(fact, item, state.items) !== undefined) return
  state.integrationFacts.push(fact)
}

const reduceTrackerReadGap = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "TaskTrackerReadInitiated") return
  const operationId = workflowOperationId(occurrence.operation)
  if (
    historicalFacetHasObservationFor(state.items, operationId, [
      "TaskTrackerFactsObserved",
      "AttemptRestartAuthorityReadFailed"
    ])
  ) {
    return
  }
  state.observationGaps.push(
    state.factories.observationGap.TrackerObservation.make({
      action: item.identity,
      operationId,
      required: "TaskTrackerFactsObserved",
      taskIds: historicalFacetTaskIdsOfTrackerOperation(occurrence.operation)
    })
  )
}

const reduceGitReadGap = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "GitReadInitiated") return
  const operationId = workflowOperationId(occurrence.operation)
  if (
    historicalFacetHasObservationFor(state.items, operationId, [
      "PlannedAttemptWorktreeObserved",
      "TargetLineageObserved",
      "AttemptRestartAuthorityReadFailed"
    ])
  ) {
    return
  }
  state.observationGaps.push(
    state.factories.observationGap.GitObservation.make({
      action: item.identity,
      operationId,
      required:
        occurrence.operation._tag === "ReadTaskWorktree" ? "PlannedAttemptWorktreeObserved" : "TargetLineageObserved",
      taskIds: [occurrence.operation.plannedAttempt.taskId]
    })
  )
}

const reduceTaskWorktreeReconciliationGap = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "TaskWorktreeReconciliationInitiated") return
  const operationId = workflowOperationId(occurrence.operation)
  if (historicalFacetHasObservationFor(state.items, operationId, ["TaskWorktreeReady"])) return
  state.observationGaps.push(
    state.factories.observationGap.GitObservation.make({
      action: item.identity,
      operationId,
      required: "TaskWorktreeReady",
      taskIds: [occurrence.operation.plannedAttempt.taskId]
    })
  )
}

const reduceClaimAcquisitionGap = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "TaskClaimAcquisitionInitiated") return
  const operationId = occurrence.operation.acquisition.operationId
  if (historicalFacetHasObservationFor(state.items, operationId, ["TaskClaimAcquired"])) return
  state.observationGaps.push(
    state.factories.observationGap.TrackerObservation.make({
      action: item.identity,
      operationId,
      required: "TaskClaimAcquired",
      taskIds: [occurrence.operation.acquisition.taskId]
    })
  )
}

const reduceClaimReleaseGap = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "TaskClaimReleaseInitiated") return
  const operationId = occurrence.operation.release.operationId
  if (historicalFacetHasObservationFor(state.items, operationId, ["TaskClaimReleased"])) return
  state.observationGaps.push(
    state.factories.observationGap.TrackerObservation.make({
      action: item.identity,
      operationId,
      required: "TaskClaimReleased",
      taskIds: [occurrence.operation.release.claim.taskId]
    })
  )
}

const reduceObservationGaps = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  reduceTrackerReadGap(item, state)
  reduceGitReadGap(item, state)
  reduceTaskWorktreeReconciliationGap(item, state)
  reduceClaimAcquisitionGap(item, state)
  reduceClaimReleaseGap(item, state)
}

const reduceExecutorResponsibilities = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
    state.retainedExecutorWork.set(
      occurrence.plannedAttempt.attemptId,
      state.factories.retainedResponsibility.ExecutorWork.make({
        plannedAttempt: occurrence.plannedAttempt,
        source: item.identity
      })
    )
  }
  if (occurrence._tag !== "PlannedAttemptExecutorWorkReported") return
  state.executorReports.set(occurrence.report.correlation.attemptId, occurrence)
  if (occurrence.report._tag !== "ExecutorWorkExecuting") {
    state.retainedExecutorWork.delete(occurrence.report.correlation.attemptId)
  }
}

const reduceTaskAttemptResponsibilities = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag === "TaskAttemptPlanned") {
    state.retainedTaskAttempts.set(
      occurrence.plannedAttempt.attemptId,
      state.factories.retainedResponsibility.TaskAttempt.make({
        plannedAttempt: occurrence.plannedAttempt,
        source: item.identity
      })
    )
  }
  if (occurrence._tag === "PlannedAttemptReplaced") {
    const priorAttemptId = occurrence.subject.plannedAttempt.attemptId
    state.retainedTaskAttempts.delete(priorAttemptId)
    state.retainedExecutorWork.delete(priorAttemptId)
    state.retainedWorktrees.delete(priorAttemptId)
    state.retainedTaskAttempts.set(
      occurrence.successorPlan.plannedAttempt.attemptId,
      state.factories.retainedResponsibility.TaskAttempt.make({
        plannedAttempt: occurrence.successorPlan.plannedAttempt,
        source: item.identity
      })
    )
  }
  if (occurrence._tag === "AttemptImplementationAbandoned") {
    state.retainedExecutorWork.delete(occurrence.subject.plannedAttempt.attemptId)
  }
}

const reduceClaimAndWorktreeResponsibilities = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag === "TaskClaimAcquired") {
    state.retainedClaims.set(
      occurrence.claim.operationId,
      state.factories.retainedResponsibility.TaskClaim.make({ claim: occurrence.claim, source: item.identity })
    )
  }
  if (occurrence._tag === "TaskWorktreeReady") {
    state.retainedWorktrees.set(
      occurrence.operation.plannedAttempt.attemptId,
      state.factories.retainedResponsibility.Worktree.make({
        plannedAttempt: occurrence.operation.plannedAttempt,
        proof: occurrence.proof,
        source: item.identity
      })
    )
  }
  if (occurrence._tag === "TaskClaimReleased") {
    state.retainedClaims.delete(occurrence.release.claim.operationId)
  }
  if (occurrence._tag === "PlannedAttemptWorktreeObserved" && occurrence.observation._tag === "AttemptWorktreeLost") {
    state.retainedWorktrees.delete(occurrence.observation.plannedAttempt.attemptId)
  }
}

const reduceTaskResponsibilities = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  reduceTaskAttemptResponsibilities(item, state)
  reduceClaimAndWorktreeResponsibilities(item, state)
}

const reduceWorktreeLostDisposition = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "PlannedAttemptWorktreeObserved" || occurrence.observation._tag !== "AttemptWorktreeLost") {
    return
  }
  state.preservationDispositions.push(
    state.factories.preservationDisposition.WorktreeLost.make({
      observation: occurrence.observation,
      plannedAttempt: occurrence.observation.plannedAttempt,
      source: item.identity
    })
  )
}

const reduceTaskAuthorityConflictDisposition = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "AttemptRestartAuthorityReadFailed") return
  state.preservationDispositions.push(
    state.factories.preservationDisposition.TaskAuthorityConflict.make({
      failure: occurrence.failure,
      source: item.identity,
      subject: occurrence.subject
    })
  )
}

const reduceReplacementPendingDisposition = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "AppliedAttemptChoice" || occurrence.choice !== "RestartTaskImplementation") return
  const replacement = itemForOccurrence(
    state.items,
    (candidate) =>
      candidate._tag === "PlannedAttemptReplaced" && candidate.requestId.nonce === occurrence.requestId.nonce
  )
  if (replacement !== undefined) return
  state.preservationDispositions.push(
    state.factories.preservationDisposition.ReplacementPending.make({
      choice: occurrence.subject,
      source: item.identity
    })
  )
}

const reduceIntegrationQuarantineDisposition = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "IntegrationQuarantined") return
  state.preservationDispositions.push(
    state.factories.preservationDisposition.IntegrationQuarantined.make({
      basis: occurrence.basis,
      correlation: occurrence.correlation,
      source: item.identity
    })
  )
}

const reduceNonConvergentDisposition = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "TargetPromotionNonConvergent") return
  state.preservationDispositions.push(
    state.factories.preservationDisposition.NonConvergentPromotion.make({
      correlation: occurrence.correlation,
      lastObservation: occurrence.lastObservation,
      source: item.identity
    })
  )
}

const reducePreservationDispositions = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  reduceWorktreeLostDisposition(item, state)
  reduceTaskAuthorityConflictDisposition(item, state)
  reduceReplacementPendingDisposition(item, state)
  reduceIntegrationQuarantineDisposition(item, state)
  reduceNonConvergentDisposition(item, state)
}

const reduceAcceptedResultFact = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (
    occurrence._tag !== "PlannedAttemptExecutorWorkReported" ||
    occurrence.report._tag !== "ExecutorWorkTerminal" ||
    occurrence.report.result._tag !== "Accepted"
  ) {
    return
  }
  const responsibility = itemForOccurrence(
    state.items,
    (candidate) =>
      candidate._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      candidate.plannedAttempt.attemptId === occurrence.report.correlation.attemptId
  )
  /* v8 ignore next -- @preserve fullHistoryIssue requires every accepted executor report to follow its exact responsibility beginning. */
  if (responsibility?.occurrence._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan") return
  state.integrationFacts.push(
    state.factories.integrationFact.AcceptedResult.make({
      acceptedResult: occurrence.report.result.acceptedResult,
      plannedAttempt: responsibility.occurrence.plannedAttempt,
      source: item.identity
    })
  )
}

const reduceIntegrationResponsibilityFacts = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag === "IntegrationResponsibilityBegan") {
    const sameTargetPredecessor = state.items
      .filter(
        ({ occurrence: candidate }) =>
          candidate._tag === "IntegrationResponsibilityBegan" &&
          candidate.recordedAt < occurrence.recordedAt &&
          sameIntegrationTarget(candidate.integrationTarget, occurrence.integrationTarget)
      )
      .at(latestSameTargetResponsibilityIndex)
    state.integrationFacts.push(
      state.factories.integrationFact.Responsibility.make({
        acceptedResult: occurrence.acceptedResult,
        plannedAttempt: occurrence.plannedAttempt,
        sameTargetPredecessor: sameTargetPredecessor?.identity ?? null,
        source: item.identity,
        target: occurrence.integrationTarget
      })
    )
  }
  if (occurrence._tag !== "IntegrationStarted") return
  const responsibility = traceItemAt(state.items, occurrence.responsibilityBeganAt)
  /* v8 ignore next -- @preserve fullHistoryIssue requires IntegrationStarted to reference its earlier responsibility. */
  if (responsibility === undefined) return
  state.integrationFacts.push(
    state.factories.integrationFact.SessionStarted.make({
      responsibility,
      source: item.identity,
      target: occurrence.integrationTarget
    })
  )
}

const reduceSessionFact = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "IntegratorSessionFixed") return
  state.integrationFacts.push(
    state.factories.integrationFact.Session.make({ correlation: occurrence.correlation, source: item.identity })
  )
}

const reduceIntegratorRunFacts = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag === "IntegratorRunStarted") {
    const result = itemForOccurrence(
      state.items,
      (candidate) =>
        candidate._tag === "IntegratorRunResultRecorded" && sameIntegratorRun(candidate.run, occurrence.run)
    )
    if (result === undefined) {
      state.observationGaps.push(
        state.factories.observationGap.IntegratorResult.make({ action: item.identity, run: occurrence.run })
      )
    }
  }
  if (occurrence._tag !== "IntegratorRunResultRecorded") return
  state.integrationFacts.push(
    state.factories.integrationFact.IntegratorResult.make({
      result: occurrence.result,
      run: occurrence.run,
      source: item.identity
    })
  )
}

const reduceCandidateQualificationObservation = (
  item: TraceHistoryItem,
  state: HistoricalFacetReductionState
): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "IntegratorCandidateQualificationObserved") return
  state.integrationFacts.push(
    state.factories.integrationFact.CandidateObserved.make({
      candidateText: occurrence.candidateText,
      observation: occurrence.observation,
      run: occurrence.originatingActionRun,
      source: item.identity
    })
  )
  if (occurrence.observation._tag !== "Commit") return
  if (
    !integratorCandidateHasExactParents(
      occurrence.observation,
      occurrence.originatingActionRun.session.expectedTargetHead,
      occurrence.originatingActionRun.session.acceptedResult.commit
    )
  ) {
    return
  }
  const prepared = state.items.some(
    ({ occurrence: candidate }) =>
      candidate._tag === "IntegratorRunResultRecorded" &&
      candidate.recordedAt < occurrence.recordedAt &&
      sameIntegratorRun(candidate.run, occurrence.originatingActionRun) &&
      candidate.result._tag === "PreparedCandidate" &&
      candidate.result.candidateText === occurrence.candidateText
  )
  /* v8 ignore next -- @preserve fullHistoryIssue accepts candidate qualification only after the matching PreparedCandidate result. */
  if (!prepared) return
  const first = occurrence.observation.directParents[0]
  const second = occurrence.observation.directParents[1]
  state.integrationFacts.push(
    state.factories.integrationFact.CandidateQualification.make({
      candidateCommit: occurrence.observation.commit,
      candidateText: occurrence.candidateText,
      directParents: [first, second],
      run: occurrence.originatingActionRun,
      source: item.identity
    })
  )
}

const reduceCandidateQualificationIntent = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "IntegratorCandidateQualificationInitiated") return
  const observed = itemForOccurrence(
    state.items,
    (candidate) =>
      candidate._tag === "IntegratorCandidateQualificationObserved" &&
      candidate.candidateText === occurrence.candidateText &&
      sameIntegratorRun(candidate.originatingActionRun, occurrence.run)
  )
  if (observed !== undefined) return
  state.observationGaps.push(
    state.factories.observationGap.CandidateQualification.make({
      action: item.identity,
      candidateText: occurrence.candidateText,
      run: occurrence.run
    })
  )
}

const reduceCandidateFacts = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  reduceCandidateQualificationIntent(item, state)
  reduceCandidateQualificationObservation(item, state)
}

const reducePromotionRequestFact = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "TargetPromotionRequested") return
  state.integrationFacts.push(
    state.factories.integrationFact.PromotionRequested.make({
      basis: "BeforeFirstAttempt",
      correlation: occurrence.correlation,
      source: item.identity
    })
  )
}

const isPromotionTerminalOccurrence = (
  occurrence: WorkflowOccurrenceValue
): occurrence is Extract<
  WorkflowOccurrenceValue,
  { readonly _tag: "TargetPromotionSucceeded" | "TargetPromotionStale" | "TargetPromotionNonConvergent" }
> =>
  occurrence._tag === "TargetPromotionSucceeded" ||
  occurrence._tag === "TargetPromotionStale" ||
  occurrence._tag === "TargetPromotionNonConvergent"

const reducePromotionAttemptFact = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "TargetPromotionAttemptRequested") return
  const terminal = state.items.find(
    ({ occurrence: candidate }) =>
      isPromotionTerminalOccurrence(candidate) && samePromotion(candidate.correlation, occurrence.correlation)
  )
  if (terminal === undefined) {
    state.observationGaps.push(
      state.factories.observationGap.PromotionResult.make({
        action: item.identity,
        attemptOrdinal: occurrence.attemptOrdinal,
        correlation: occurrence.correlation
      })
    )
  }
  state.integrationFacts.push(
    state.factories.integrationFact.PromotionAttempt.make({
      attemptOrdinal: occurrence.attemptOrdinal,
      correlation: occurrence.correlation,
      reason: occurrence.reason,
      source: item.identity
    })
  )
}

const reducePromotionTerminalFact = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (!isPromotionTerminalOccurrence(occurrence)) return
  if (occurrence._tag === "TargetPromotionSucceeded") {
    state.integrationFacts.push(
      state.factories.integrationFact.PromotionSucceeded.make({
        basis: occurrence.basis,
        correlation: occurrence.correlation,
        observation: occurrence.observation,
        source: item.identity
      })
    )
  }
  if (occurrence._tag === "TargetPromotionStale") {
    state.integrationFacts.push(
      state.factories.integrationFact.PromotionStale.make({
        basis: occurrence.basis,
        correlation: occurrence.correlation,
        observation: occurrence.observation,
        source: item.identity
      })
    )
  }
  if (occurrence._tag === "TargetPromotionNonConvergent") {
    state.integrationFacts.push(
      state.factories.integrationFact.PromotionNonConvergent.make({
        attemptOrdinal: occurrence.attemptOrdinal,
        basis: "AfterAttempt",
        correlation: occurrence.correlation,
        lastObservation: occurrence.lastObservation,
        source: item.identity
      })
    )
  }
}

const reducePromotionFacts = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  reducePromotionRequestFact(item, state)
  reducePromotionAttemptFact(item, state)
  reducePromotionTerminalFact(item, state)
}

const reduceBoundaryFacts = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag === "IntegrationQuarantined") {
    state.integrationFacts.push(
      state.factories.integrationFact.Quarantine.make({
        basis: occurrence.basis,
        correlation: occurrence.correlation,
        source: item.identity
      })
    )
  }
  if (occurrence._tag === "IntegrationProviderRunActivityAbsent") {
    state.integrationFacts.push(
      state.factories.integrationFact.ProviderActivityAbsent.make({
        correlation: occurrence.correlation,
        run: occurrence.run,
        source: item.identity
      })
    )
  }
  if (occurrence._tag !== "IntegrationQuarantineDirectionApplied") return
  state.integrationFacts.push(
    state.factories.integrationFact.QuarantineDirection.make({
      fingerprint: occurrence.fingerprint,
      source: item.identity
    })
  )
}

const reduceCompletionFacts = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag === "IntegrationFocusedCompletionOccurred") {
    state.integrationFacts.push(
      state.factories.integrationFact.FocusedCompletion.make({ event: occurrence.event, source: item.identity })
    )
  }
  if (occurrence._tag === "IntegrationClaimReplacementOccurred") {
    state.integrationFacts.push(
      state.factories.integrationFact.ClaimReplacement.make({ event: occurrence.event, source: item.identity })
    )
  }
  if (occurrence._tag === "IntegrationClaimDeletionOccurred") {
    state.integrationFacts.push(
      state.factories.integrationFact.ClaimDeletion.make({ event: occurrence.event, source: item.identity })
    )
  }
  if (occurrence._tag !== "IntegrationFinalitySettledOccurred") return
  state.integrationFacts.push(
    state.factories.integrationFact.Settlement.make({ event: occurrence.event, source: item.identity })
  )
}

const reduceSettledResponsibilities = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "IntegrationFinalitySettledOccurred") return
  const attemptId = occurrence.event.claim.plannedAttempt.attemptId
  state.retainedTaskAttempts.delete(attemptId)
  state.retainedExecutorWork.delete(attemptId)
  state.retainedWorktrees.delete(attemptId)
  state.retainedClaims.delete(occurrence.event.claim.originalClaim.operationId)
}

const reduceHistoricalFacetItem = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  reduceControlDispositionItem(item, state)
  reduceDependantReleaseFact(item, state)
  reduceObservationGaps(item, state)
  reduceExecutorResponsibilities(item, state)
  reduceTaskResponsibilities(item, state)
  reducePreservationDispositions(item, state)
  reduceAcceptedResultFact(item, state)
  reduceIntegrationResponsibilityFacts(item, state)
  reduceSessionFact(item, state)
  reduceIntegratorRunFacts(item, state)
  reduceCandidateFacts(item, state)
  reducePromotionFacts(item, state)
  reduceBoundaryFacts(item, state)
  reduceCompletionFacts(item, state)
  reduceSettledResponsibilities(item, state)
}

/** One responsibility's accepted source versions; deletion closes visibility, not its provenance. */
interface RetainedResponsibilityVersion {
  readonly at: JournalPosition
  readonly value: TraceRetainedResponsibility | undefined
}

const historicalBinaryPartitionDivisor = 2
const absentCleanupHeadIndex = -1

interface RetainedResponsibilityCollection<Key> {
  readonly set: (key: Key, value: TraceRetainedResponsibility) => void
  readonly delete: (key: Key) => boolean
  readonly values: () => IterableIterator<TraceRetainedResponsibility>
}

const prepareResponsibilityVersions = <Key>(initialPosition: JournalPosition) => {
  const current = new Map<Key, TraceRetainedResponsibility>()
  const versions = new Map<Key, Array<RetainedResponsibilityVersion>>()
  let position = initialPosition
  return {
    versions,
    get position() {
      return position
    },
    set position(value: JournalPosition) {
      position = value
    },
    set: (key: Key, value: TraceRetainedResponsibility): void => {
      const accepted = versions.get(key) ?? []
      accepted.push({ at: position, value })
      versions.set(key, accepted)
      current.set(key, value)
    },
    delete: (key: Key): boolean => {
      if (!current.has(key)) return false
      versions.get(key)?.push({ at: position, value: undefined })
      return current.delete(key)
    },
    values: () => current.values()
  }
}

interface PreparedCleanupHead {
  readonly progress: TraceCleanupProgress
  readonly previous: PreparedCleanupHead | undefined
}

const worktreeCleanupAtHead = (
  head: PreparedCleanupHead,
  progress: Extract<TraceCleanupProgress, { readonly _tag: "Worktree" }>,
  factories: HistoricalFacetFactories
) => {
  const steps: Array<TraceWorktreeCleanupStep> = []
  let authorization = progress.authorization
  for (let current: PreparedCleanupHead | undefined = head; current !== undefined; current = current.previous) {
    if (current.progress._tag === "Worktree") {
      steps.push(...current.progress.steps)
      authorization = current.progress.authorization
    }
  }
  return factories.cleanupProgress.Worktree.make({ ...progress, authorization, steps: steps.reverse() })
}

const branchCleanupAtHead = (
  head: PreparedCleanupHead,
  progress: Extract<TraceCleanupProgress, { readonly _tag: "Branch" }>,
  factories: HistoricalFacetFactories
) => {
  const steps: Array<TraceBranchCleanupStep> = []
  let authorization = progress.authorization
  for (let current: PreparedCleanupHead | undefined = head; current !== undefined; current = current.previous) {
    if (current.progress._tag === "Branch") {
      steps.push(...current.progress.steps)
      authorization = current.progress.authorization
    }
  }
  return factories.cleanupProgress.Branch.make({ ...progress, authorization, steps: steps.reverse() })
}

const candidateCleanupAtHead = (
  head: PreparedCleanupHead,
  progress: Extract<TraceCleanupProgress, { readonly _tag: "IntegratorCandidate" }>,
  factories: HistoricalFacetFactories
) => {
  const steps: Array<TraceIntegratorCandidateCleanupStep> = []
  let authorization = progress.authorization
  for (let current: PreparedCleanupHead | undefined = head; current !== undefined; current = current.previous) {
    if (current.progress._tag === "IntegratorCandidate") {
      steps.push(...current.progress.steps)
      authorization = current.progress.authorization
    }
  }
  return factories.cleanupProgress.IntegratorCandidate.make({ ...progress, authorization, steps: steps.reverse() })
}

const cleanupAtHead = (head: PreparedCleanupHead, factories: HistoricalFacetFactories): TraceCleanupProgress => {
  const progress = head.progress
  switch (progress._tag) {
    case "Worktree":
      return worktreeCleanupAtHead(head, progress, factories)
    case "Branch":
      return branchCleanupAtHead(head, progress, factories)
    case "IntegratorCandidate":
      return candidateCleanupAtHead(head, progress, factories)
  }
}

/** Sealed historical ledgers and source-version timelines owned by one preparation. */
export const prepareTraceHistoricalFacets = (
  items: ReadonlyArray<TraceHistoryItem>,
  factories: HistoricalFacetFactories
) => {
  const initialPosition = items[0]?.identity.position
  const empty = () =>
    factories.facets.make({
      controlDisposition: factories.controlDisposition.make({
        cleanup: [],
        controls: [],
        dispositions: [],
        version: traceControlDispositionFacetVersion
      }),
      integration: { facts: [] },
      recovery: { observationGaps: [], preservationDispositions: [], retainedResponsibilities: [] }
    })
  if (initialPosition === undefined) {
    const visibility = prepareFacetVisibility({ gaps: [], responsibilities: [], dispositions: [], preservation: [] })
    return {
      at: (_position: JournalPosition) => empty(),
      counts: () => ({
        ...visibility.counts(),
        lookupVisits: 0,
        selectionVisits: 0,
        sourceVisits: 0,
        cleanupHeads: 0,
        cleanupStepReferences: 0
      })
    }
  }
  const claims = prepareResponsibilityVersions<OperationId>(initialPosition)
  const executorWork = prepareResponsibilityVersions<AttemptId>(initialPosition)
  const attempts = prepareResponsibilityVersions<AttemptId>(initialPosition)
  const worktrees = prepareResponsibilityVersions<AttemptId>(initialPosition)
  let relatedItems: ReadonlyArray<TraceHistoryItem> = []
  const state: HistoricalFacetReductionState = {
    ...makeHistoricalFacetReductionState(items, factories),
    get items() {
      return relatedItems
    },
    retainedClaims: claims,
    retainedExecutorWork: executorWork,
    retainedTaskAttempts: attempts,
    retainedWorktrees: worktrees
  }
  const gapState = makeHistoricalFacetReductionState([], factories)
  const cleanup = new Map<string, Array<PreparedCleanupHead>>()
  const replacementPositions = new Map<string, JournalPosition>()
  const replacementSources = new Map<JournalPosition, string>()
  const replacementKey = (request: Extract<WorkflowOccurrenceValue, { _tag: "AppliedAttemptChoice" }>["requestId"]) =>
    JSON.stringify([request.runId, request.nonce])
  const observations = new Map<string, Array<TraceHistoryItem>>()
  const runKey = (run: IntegratorRunCorrelation) => `${run.session.sessionId}:${run.ordinal}`
  const byPosition = new Map<JournalPosition, TraceHistoryItem>()
  const executorBeginnings = new Map<AttemptId, TraceHistoryItem>()
  const integrationResponsibilities = new Map<string, Array<TraceHistoryItem>>()
  const graphFullObservations = new Map<OperationId, TraceHistoryItem>()
  const settlementsByTask = new Map<TaskId, Array<TraceHistoryItem>>()
  const targetKey = (target: IntegrationTarget) => JSON.stringify([target.repository, target.ref])
  let lookupVisits = 0
  let sourceVisits = 0
  let cleanupHeads = 0
  let cleanupStepReferences = 0
  const addObservation = (key: string, item: TraceHistoryItem) => {
    const bucket = observations.get(key) ?? []
    bucket.push(item)
    observations.set(key, bucket)
  }
  const indexResponsibilities = (item: TraceHistoryItem) => {
    const occurrence = item.occurrence
    if (!byPosition.has(item.identity.position)) byPosition.set(item.identity.position, item)
    if (
      occurrence._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      !executorBeginnings.has(occurrence.plannedAttempt.attemptId)
    )
      executorBeginnings.set(occurrence.plannedAttempt.attemptId, item)
    if (occurrence._tag === "IntegrationResponsibilityBegan") {
      const key = targetKey(occurrence.integrationTarget)
      const bucket = integrationResponsibilities.get(key) ?? []
      bucket.push(item)
      integrationResponsibilities.set(key, bucket)
    }
  }
  const indexGraphFacts = (item: TraceHistoryItem) => {
    const occurrence = item.occurrence
    if (
      occurrence._tag === "TaskTrackerFactsObserved" &&
      occurrence.evidence._tag === "CompleteTaskTrackerFacts" &&
      !graphFullObservations.has(occurrence.evidence.operationId)
    )
      graphFullObservations.set(occurrence.evidence.operationId, item)
    if (occurrence._tag === "IntegrationFinalitySettledOccurred") {
      const taskId = occurrence.event.claim.plannedAttempt.taskId
      const bucket = settlementsByTask.get(taskId) ?? []
      bucket.push(item)
      settlementsByTask.set(taskId, bucket)
    }
  }
  const indexObservations = (item: TraceHistoryItem) => {
    const occurrence = item.occurrence
    for (const operationId of operationIdsOfOccurrence(occurrence)) addObservation(`operation:${operationId}`, item)
    if (occurrence._tag === "PlannedAttemptExecutorWorkReported")
      addObservation(`executor:${occurrence.report.correlation.attemptId}`, item)
    if (occurrence._tag === "IntegratorRunResultRecorded") addObservation(`run:${runKey(occurrence.run)}`, item)
    if (occurrence._tag === "IntegratorCandidateQualificationObserved")
      addObservation(`candidate:${runKey(occurrence.originatingActionRun)}:${occurrence.candidateText}`, item)
    if (isPromotionTerminalOccurrence(occurrence)) addObservation(`promotion:${occurrence.correlation.requestId}`, item)
  }
  const indexReplacement = (item: TraceHistoryItem) => {
    const occurrence = item.occurrence
    if (occurrence._tag === "PlannedAttemptReplaced" && !replacementPositions.has(replacementKey(occurrence.requestId)))
      replacementPositions.set(replacementKey(occurrence.requestId), item.identity.position)
    if (occurrence._tag === "AppliedAttemptChoice")
      replacementSources.set(item.identity.position, replacementKey(occurrence.requestId))
  }
  for (const item of items) {
    sourceVisits += 1
    indexResponsibilities(item)
    indexGraphFacts(item)
    indexObservations(item)
    indexReplacement(item)
  }
  const earlier = (
    bucket: ReadonlyArray<TraceHistoryItem>,
    position: JournalPosition
  ): TraceHistoryItem | undefined => {
    let lower = 0
    let upper = bucket.length
    while (lower < upper) {
      lookupVisits += 1
      const middle = Math.floor((lower + upper) / historicalBinaryPartitionDivisor)
      if (Option.getOrThrow(Option.fromUndefinedOr(bucket[middle])).occurrence.recordedAt < position) lower = middle + 1
      else upper = middle
    }
    return bucket[lower - 1]
  }
  const indexedCandidateItems = (
    occurrence: Extract<WorkflowOccurrenceValue, { readonly _tag: "IntegratorCandidateQualificationObserved" }>
  ) =>
    (observations.get(`run:${runKey(occurrence.originatingActionRun)}`) ?? []).filter((candidate) => {
      lookupVisits += 1
      return candidate.occurrence.recordedAt < occurrence.recordedAt
    })
  const isLaterSettlement = (candidate: TraceHistoryItem, settlement: TraceHistoryItem | undefined) =>
    settlement === undefined || candidate.occurrence.recordedAt > settlement.occurrence.recordedAt
  const indexedGraphItems = (item: TraceHistoryItem, occurrence: CompleteGraphObservationOccurrence) => {
    let settlement: TraceHistoryItem | undefined
    for (const taskId of taskIdsOfCompleteGraphObservation(occurrence.evidence)) {
      lookupVisits += 1
      const candidate = earlier(settlementsByTask.get(taskId) ?? [], occurrence.recordedAt)
      if (candidate !== undefined && isLaterSettlement(candidate, settlement)) settlement = candidate
    }
    if (settlement === undefined) return []
    const full =
      occurrence.evidence._tag === "UnchangedTaskTrackerFactsReconfirmed"
        ? graphFullObservations.get(occurrence.evidence.priorFullObservationOperationId)
        : undefined
    return full === undefined ? [settlement, item] : [settlement, full, item]
  }
  const singletonIndexedItem = (item: TraceHistoryItem | undefined) => (item === undefined ? [] : [item])
  const indexedItemsFor = (item: TraceHistoryItem): ReadonlyArray<TraceHistoryItem> => {
    lookupVisits += 1
    const occurrence = item.occurrence
    if (occurrence._tag === "PlannedAttemptExecutorWorkReported") {
      const beginning = executorBeginnings.get(occurrence.report.correlation.attemptId)
      return singletonIndexedItem(beginning)
    }
    if (occurrence._tag === "IntegrationStarted") {
      const responsibility = byPosition.get(occurrence.responsibilityBeganAt)
      return singletonIndexedItem(responsibility)
    }
    if (occurrence._tag === "IntegrationResponsibilityBegan") {
      const predecessor = earlier(
        integrationResponsibilities.get(targetKey(occurrence.integrationTarget)) ?? [],
        occurrence.recordedAt
      )
      return singletonIndexedItem(predecessor)
    }
    if (occurrence._tag === "IntegratorCandidateQualificationObserved") {
      return indexedCandidateItems(occurrence)
    }
    if (isCompleteGraphObservation(occurrence)) {
      return indexedGraphItems(item, occurrence)
    }
    return []
  }
  const reducePreparedFacts = (item: TraceHistoryItem) => {
    // Each cleanup event produces one immutable step; full chains are selected only on demand.
    state.cleanup.length = 0
    const controlState = makeHistoricalFacetReductionState([], factories)
    reduceControlDispositionItem(item, controlState)
    state.controls.push(...controlState.controls)
    state.dispositions.push(...controlState.dispositions.filter((value) => value._tag !== "ReplacementPending"))
    state.cleanup.push(...controlState.cleanup)
    reduceDependantReleaseFact(item, state)
    reduceExecutorResponsibilities(item, state)
    reduceTaskResponsibilities(item, state)
    reduceWorktreeLostDisposition(item, state)
    reduceTaskAuthorityConflictDisposition(item, state)
    reduceIntegrationQuarantineDisposition(item, state)
    reduceNonConvergentDisposition(item, state)
    reduceAcceptedResultFact(item, state)
    reduceIntegrationResponsibilityFacts(item, state)
    reduceSessionFact(item, state)
    if (item.occurrence._tag === "IntegratorRunResultRecorded") reduceIntegratorRunFacts(item, state)
    reduceCandidateQualificationObservation(item, state)
    reducePromotionRequestFact(item, state)
    reducePromotionTerminalFact(item, state)
    reduceBoundaryFacts(item, state)
    reduceCompletionFacts(item, state)
    reduceSettledResponsibilities(item, state)
  }
  const retainCleanupHeads = () => {
    for (const progress of state.cleanup) {
      const key = `${progress._tag}:${progress.authorization.operationId}`
      const versions = cleanup.get(key) ?? []
      const previous = versions.at(absentCleanupHeadIndex)
      versions.push({ progress, previous })
      cleanupHeads += 1
      cleanupStepReferences += progress.steps.length
      cleanup.set(key, versions)
    }
  }
  const reducePreparedGaps = (item: TraceHistoryItem) => {
    reduceObservationGaps(item, gapState)
    if (item.occurrence._tag === "IntegratorRunStarted") reduceIntegratorRunFacts(item, gapState)
    reduceCandidateQualificationIntent(item, gapState)
    if (item.occurrence._tag === "TargetPromotionAttemptRequested") {
      const priorFacts = gapState.integrationFacts.length
      reducePromotionAttemptFact(item, gapState)
      state.integrationFacts.push(...gapState.integrationFacts.slice(priorFacts))
    }
    if (item.occurrence._tag === "AppliedAttemptChoice") {
      reduceReplacementPendingDisposition(item, gapState)
      reduceControlDispositionItem(item, gapState)
    }
    if (item.occurrence._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
      gapState.observationGaps.push(
        factories.observationGap.ExecutorReport.make({
          action: item.identity,
          attemptId: item.occurrence.plannedAttempt.attemptId
        })
      )
    }
  }
  for (const item of items) {
    sourceVisits += 1
    relatedItems = indexedItemsFor(item)
    for (const map of [claims, executorWork, attempts, worktrees]) map.position = item.identity.position
    reducePreparedFacts(item)
    retainCleanupHeads()
    reducePreparedGaps(item)
  }
  const candidatesForGap = (gap: TraceObservationGap): ReadonlyArray<TraceHistoryItem> => {
    if (gap._tag === "TrackerObservation" || gap._tag === "GitObservation")
      return observations.get(`operation:${gap.operationId}`) ?? []
    const key =
      gap._tag === "ExecutorReport"
        ? `executor:${gap.attemptId}`
        : gap._tag === "IntegratorResult"
          ? `run:${runKey(gap.run)}`
          : gap._tag === "CandidateQualification"
            ? `candidate:${runKey(gap.run)}:${gap.candidateText}`
            : `promotion:${gap.correlation.requestId}`
    return observations.get(key) ?? []
  }
  const closesExecutorGap = (
    gap: Extract<TraceObservationGap, { readonly _tag: "ExecutorReport" }>,
    occurrence: WorkflowOccurrenceValue
  ) =>
    occurrence._tag === "PlannedAttemptExecutorWorkReported" &&
    occurrence.report.correlation.attemptId === gap.attemptId
  const closesIntegratorGap = (
    gap: Extract<TraceObservationGap, { readonly _tag: "IntegratorResult" }>,
    occurrence: WorkflowOccurrenceValue
  ) => occurrence._tag === "IntegratorRunResultRecorded" && sameIntegratorRun(occurrence.run, gap.run)
  const closesCandidateGap = (
    gap: Extract<TraceObservationGap, { readonly _tag: "CandidateQualification" }>,
    occurrence: WorkflowOccurrenceValue
  ) =>
    occurrence._tag === "IntegratorCandidateQualificationObserved" &&
    occurrence.candidateText === gap.candidateText &&
    sameIntegratorRun(occurrence.originatingActionRun, gap.run)
  const closesPromotionGap = (
    gap: Extract<TraceObservationGap, { readonly _tag: "PromotionResult" }>,
    occurrence: WorkflowOccurrenceValue
  ) => isPromotionTerminalOccurrence(occurrence) && samePromotion(occurrence.correlation, gap.correlation)
  const closesBoundaryGap = (
    gap: Extract<TraceObservationGap, { readonly _tag: "TrackerObservation" | "GitObservation" }>,
    occurrence: WorkflowOccurrenceValue
  ) => {
    const tags =
      gap.required === "TaskTrackerFactsObserved"
        ? ["TaskTrackerFactsObserved", "AttemptRestartAuthorityReadFailed"]
        : gap.required === "PlannedAttemptWorktreeObserved" || gap.required === "TargetLineageObserved"
          ? ["PlannedAttemptWorktreeObserved", "TargetLineageObserved", "AttemptRestartAuthorityReadFailed"]
          : [gap.required]
    return tags.includes(occurrence._tag)
  }
  const closesGap = (gap: TraceObservationGap, item: TraceHistoryItem): boolean => {
    lookupVisits += 1
    const occurrence = item.occurrence
    switch (gap._tag) {
      case "ExecutorReport":
        return closesExecutorGap(gap, occurrence)
      case "IntegratorResult":
        return closesIntegratorGap(gap, occurrence)
      case "CandidateQualification":
        return closesCandidateGap(gap, occurrence)
      case "PromotionResult":
        return closesPromotionGap(gap, occurrence)
      case "TrackerObservation":
        return closesBoundaryGap(gap, occurrence)
      case "GitObservation":
        return closesBoundaryGap(gap, occurrence)
    }
  }
  const gaps = gapState.observationGaps.map((gap) => ({
    gap,
    closedAt: candidatesForGap(gap)
      .filter((item) => closesGap(gap, item))
      .reduce<JournalPosition | undefined>(
        (earliest, item) =>
          earliest === undefined || item.identity.position < earliest ? item.identity.position : earliest,
        undefined
      )
  }))
  const replacementEnd = (value: TracePreservationDisposition | TraceDispositionFact): JournalPosition | undefined => {
    if (value._tag !== "ReplacementPending") return undefined
    const nonce = replacementSources.get(value.source.position)
    const replacedAt = nonce === undefined ? undefined : replacementPositions.get(nonce)
    return replacedAt
  }
  const responsibilityIntervalsFor = () => {
    const responsibilityIntervals: Array<FacetVisibility<TraceRetainedResponsibility>> = []
    for (const map of [claims, executorWork, attempts, worktrees]) {
      for (const versions of map.versions.values()) {
        for (let index = 0; index < versions.length; index += 1) {
          const version = Option.getOrThrow(Option.fromUndefinedOr(versions[index]))
          if (version.value !== undefined)
            responsibilityIntervals.push({
              start: version.at,
              end: versions[index + 1]?.at,
              order: version.value.source.position,
              value: version.value
            })
        }
      }
    }
    return responsibilityIntervals
  }
  const gapIntervals = gaps.map(({ closedAt, gap }) => ({
    start: gap.action.position,
    end: closedAt,
    order: gap.action.position,
    value: gap
  }))
  let selectionVisits = 0
  const prefix = <Value extends { readonly source: TraceItemIdentity }>(
    ledger: ReadonlyArray<Value>,
    position: JournalPosition
  ): ReadonlyArray<Value> => {
    let lower = 0
    let upper = ledger.length
    while (lower < upper) {
      selectionVisits += 1
      const middle = Math.floor((lower + upper) / historicalBinaryPartitionDivisor)
      if (Option.getOrThrow(Option.fromUndefinedOr(ledger[middle])).source.position <= position) lower = middle + 1
      else upper = middle
    }
    return ledger.slice(0, lower)
  }
  const dispositions = [
    ...state.dispositions.filter((value) => value._tag !== "ReplacementPending"),
    ...gapState.dispositions.filter((value) => value._tag === "ReplacementPending")
  ].sort((left, right) => Number(left.source.position) - Number(right.source.position))
  const preservationDispositions = [
    ...state.preservationDispositions.filter((value) => value._tag !== "ReplacementPending"),
    ...gapState.preservationDispositions
  ].sort((left, right) => Number(left.source.position) - Number(right.source.position))
  const visibility = prepareFacetVisibility({
    gaps: gapIntervals,
    responsibilities: responsibilityIntervalsFor(),
    dispositions: dispositions.map((value) => ({
      start: value.source.position,
      end: replacementEnd(value),
      order: value.source.position,
      value
    })),
    preservation: preservationDispositions.map((value) => ({
      start: value.source.position,
      end: replacementEnd(value),
      order: value.source.position,
      value
    }))
  })
  const cleanupByStart = [...cleanup.values()].map((versions) => ({
    source: Option.getOrThrow(Option.fromUndefinedOr(versions[0])).progress.status.source,
    versions
  }))
  return {
    counts: () => ({
      ...visibility.counts(),
      lookupVisits,
      selectionVisits,
      sourceVisits,
      cleanupHeads,
      cleanupStepReferences
    }),
    at: (position: JournalPosition): TraceHistoricalFacets => {
      const selectedCleanup: Array<TraceCleanupProgress> = []
      for (const { versions } of prefix(cleanupByStart, position)) {
        let lower = 0
        let upper = versions.length
        while (lower < upper) {
          selectionVisits += 1
          const middle = Math.floor((lower + upper) / historicalBinaryPartitionDivisor)
          if (Option.getOrThrow(Option.fromUndefinedOr(versions[middle])).progress.status.source.position <= position)
            lower = middle + 1
          else upper = middle
        }
        const head = versions[lower - 1]
        if (head !== undefined) selectedCleanup.push(cleanupAtHead(head, factories))
      }
      selectedCleanup.sort(
        (left, right) => Number(left.steps[0]?.source.position ?? 0) - Number(right.steps[0]?.source.position ?? 0)
      )
      const retainedResponsibilities = visibility.responsibilitiesAt(position)
      const observationGaps = visibility
        .gapsAt(position)
        .toSorted((left, right) => Number(left._tag === "ExecutorReport") - Number(right._tag === "ExecutorReport"))
      return factories.facets.make({
        controlDisposition: factories.controlDisposition.make({
          cleanup: selectedCleanup,
          controls: prefix(state.controls, position),
          dispositions: visibility.dispositionsAt(position),
          version: traceControlDispositionFacetVersion
        }),
        integration: { facts: prefix(state.integrationFacts, position) },
        recovery: {
          observationGaps,
          preservationDispositions: visibility.preservationAt(position),
          retainedResponsibilities
        }
      })
    }
  }
}

export const traceHistoricalFacetsAt = (
  items: ReadonlyArray<TraceHistoryItem>,
  factories: HistoricalFacetFactories
): TraceHistoricalFacets => {
  const state = makeHistoricalFacetReductionState(items, factories)
  for (const item of items) reduceHistoricalFacetItem(item, state)
  for (const item of items) {
    if (
      item.occurrence._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      !state.executorReports.has(item.occurrence.plannedAttempt.attemptId)
    ) {
      state.observationGaps.push(
        state.factories.observationGap.ExecutorReport.make({
          action: item.identity,
          attemptId: item.occurrence.plannedAttempt.attemptId
        })
      )
    }
  }
  const retainedResponsibilities = [
    ...state.retainedTaskAttempts.values(),
    ...state.retainedExecutorWork.values(),
    ...state.retainedClaims.values(),
    ...state.retainedWorktrees.values()
  ].sort((left, right) => Number(left.source.position) - Number(right.source.position))
  const cleanup = [...state.cleanup].sort((left, right) => {
    /* v8 ignore next -- @preserve every cleanup progress is created by reduceCleanupFamily with its first durable step. */
    const leftSource = left.steps[0]?.source.position ?? 0
    /* v8 ignore next -- @preserve every cleanup progress is created by reduceCleanupFamily with its first durable step. */
    const rightSource = right.steps[0]?.source.position ?? 0
    return Number(leftSource) - Number(rightSource)
  })
  return state.factories.facets.make({
    controlDisposition: state.factories.controlDisposition.make({
      cleanup,
      controls: state.controls,
      dispositions: state.dispositions,
      version: traceControlDispositionFacetVersion
    }),
    integration: { facts: state.integrationFacts },
    recovery: {
      observationGaps: state.observationGaps,
      preservationDispositions: state.preservationDispositions,
      retainedResponsibilities
    }
  })
}
