/* eslint-disable functional/immutable-data, max-lines -- Historical facet fold uses private mutable reducer state. */
import { Schema } from "effect"
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
import type { JournalPosition } from "../workflow-journal/identity.js"
import type { WorkflowOccurrence as WorkflowOccurrenceValue } from "../workflow/registry/occurrence-projection.js"
import type {
  CompleteTaskTrackerFactsObserved,
  TaskTrackerFactsObservation,
  UnchangedTaskTrackerFactsReconfirmed
} from "../workflow/task-tracker-facts/observation.js"
import type {
  TraceHistoricalFacets,
  TraceCursor,
  TraceHistoryItem,
  TraceIntegrationFact,
  TraceItemIdentity,
  TraceObservationGap,
  TracePreservationDisposition,
  TraceRetainedResponsibility
} from "./trace-reader.js"

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
  readonly facets: {
    readonly make: (input: {
      readonly integration: { readonly facts: ReadonlyArray<TraceIntegrationFact> }
      readonly recovery: {
        readonly observationGaps: ReadonlyArray<TraceObservationGap>
        readonly preservationDispositions: ReadonlyArray<TracePreservationDisposition>
        readonly retainedResponsibilities: ReadonlyArray<TraceRetainedResponsibility>
      }
    }) => TraceHistoricalFacets
  }
}

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

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

const gitObservationGapIssue = (
  gap: Extract<TraceObservationGap, { readonly _tag: "GitObservation" }>,
  occurrence: WorkflowOccurrenceValue
): string | undefined => {
  const expectedTag = gap.required === "PlannedAttemptWorktreeObserved" ? "ReadTaskWorktree" : "ReadTargetLineage"
  return occurrence._tag === "GitReadInitiated" &&
    occurrence.operation._tag === expectedTag &&
    workflowOperationId(occurrence.operation) === gap.operationId &&
    exactTaskIds([occurrence.operation.plannedAttempt.taskId], gap.taskIds)
    ? undefined
    : "Git-observation gap must identify its exact Git read intent"
}

const traceObservationGapIssue = (
  gap: TraceObservationGap,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  const action = historyItemAt(items, gap.action)
  if (action === undefined) return "Observation gap action must identify one history occurrence"
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
  const source = historyItemAt(items, responsibility.source)
  if (source === undefined) return "Retained responsibility source must identify one history occurrence"
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
  const source = historyItemAt(items, disposition.source)
  if (source === undefined) return "Preservation disposition source must identify one history occurrence"
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
    source.report._tag !== "Terminal" ||
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
): sourceItem is TraceHistoryItem & {
  readonly occurrence: Extract<WorkflowOccurrenceValue, { readonly _tag: "TaskTrackerFactsObserved" }>
} => {
  if (
    !sameTraceItemIdentity(sourceItem.identity, fact.source) ||
    !sameTraceItemIdentity(sourceItem.identity, fact.graphSource)
  ) {
    return false
  }
  const source = sourceItem.occurrence
  if (source._tag !== "TaskTrackerFactsObserved") return false
  if (
    source.evidence._tag !== "CompleteTaskTrackerFacts" &&
    source.evidence._tag !== "UnchangedTaskTrackerFactsReconfirmed"
  ) {
    return false
  }
  return sameJson(source.evidence, fact.graphObservation)
}

const dependantReleaseSettlementMatches = (
  fact: DependantReleaseFact,
  source: Extract<WorkflowOccurrenceValue, { readonly _tag: "TaskTrackerFactsObserved" }>,
  graph: TraceHistoryItem | undefined,
  settlement: TraceHistoryItem | undefined
): boolean => {
  if (graph?.occurrence._tag !== "TaskTrackerFactsObserved") return false
  if (settlement?.occurrence._tag !== "IntegrationFinalitySettledOccurred") return false
  return (
    sameJson(settlement.occurrence.event, fact.settlement) &&
    taskIdsOfObservation(source.evidence).includes(fact.settlement.claim.plannedAttempt.taskId) &&
    fact.settlementSource.position < fact.graphSource.position
  )
}

const dependantReleaseFactIssue = (
  fact: DependantReleaseFact,
  sourceItem: TraceHistoryItem,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  const settlement = historyItemAt(items, fact.settlementSource)
  const graph = historyItemAt(items, fact.graphSource)
  if (!dependantGraphObservationMatches(fact, sourceItem)) {
    return "Dependant-release evidence must bind the exact later complete graph and earlier settlement"
  }
  return dependantReleaseSettlementMatches(fact, sourceItem.occurrence, graph, settlement)
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
  if (isPreservationFact(fact)) return preservationFactIssue(fact, source)
  return undefined
}

const traceHistoricalFactIssue = (
  fact: TraceIntegrationFact,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  const sourceItem = historyItemAt(items, fact.source)
  if (sourceItem === undefined) return "Every integration fact source must resolve to a history item"
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
  const invalid = identities.find(
    (identity) => identityOutsideCursor(identity, view.cursor) || historyItemAt(view.items, identity) === undefined
  )
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

const operationIdsOfOccurrence = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<OperationId> => {
  if (
    occurrence._tag === "PlannedAttemptWorktreeObserved" ||
    occurrence._tag === "TargetLineageObserved" ||
    occurrence._tag === "AttemptRestartAuthorityReadFailed" ||
    occurrence._tag === "TaskClaimAcquired" ||
    occurrence._tag === "TaskClaimReleased" ||
    occurrence._tag === "TaskTrackerFactsObserved"
  ) {
    return [occurrence.originatingActionOperationId]
  }
  return []
}

type ExecutorReportOccurrence = Extract<
  WorkflowOccurrenceValue,
  { readonly _tag: "PlannedAttemptExecutorWorkReported" }
>

type CompleteGraphObservationOccurrence = Extract<
  WorkflowOccurrenceValue,
  { readonly _tag: "TaskTrackerFactsObserved" }
> & { readonly evidence: CompleteTaskTrackerFactsObserved | UnchangedTaskTrackerFactsReconfirmed }

type HistoricalFacetReductionState = {
  readonly factories: HistoricalFacetFactories
  readonly executorReports: Map<AttemptId, ExecutorReportOccurrence>
  readonly integrationFacts: Array<TraceIntegrationFact>
  readonly items: ReadonlyArray<TraceHistoryItem>
  readonly observationGaps: Array<TraceObservationGap>
  readonly preservationDispositions: Array<TracePreservationDisposition>
  readonly retainedClaims: Map<OperationId, TraceRetainedResponsibility>
  readonly retainedExecutorWork: Map<AttemptId, TraceRetainedResponsibility>
  readonly retainedTaskAttempts: Map<AttemptId, TraceRetainedResponsibility>
  readonly retainedWorktrees: Map<AttemptId, TraceRetainedResponsibility>
}

const makeHistoricalFacetReductionState = (
  items: ReadonlyArray<TraceHistoryItem>,
  factories: HistoricalFacetFactories
): HistoricalFacetReductionState => ({
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

const isCompleteGraphObservation = (
  occurrence: WorkflowOccurrenceValue
): occurrence is CompleteGraphObservationOccurrence =>
  occurrence._tag === "TaskTrackerFactsObserved" &&
  (occurrence.evidence._tag === "CompleteTaskTrackerFacts" ||
    occurrence.evidence._tag === "UnchangedTaskTrackerFactsReconfirmed")

const reduceDependantReleaseFact = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (!isCompleteGraphObservation(occurrence)) return
  const graphTaskIds = taskIdsOfObservation(occurrence.evidence)
  const settlement = state.items.findLast(
    ({ occurrence: candidate }) =>
      candidate._tag === "IntegrationFinalitySettledOccurred" &&
      candidate.recordedAt < occurrence.recordedAt &&
      graphTaskIds.includes(candidate.event.claim.plannedAttempt.taskId)
  )
  if (settlement?.occurrence._tag !== "IntegrationFinalitySettledOccurred") return
  state.integrationFacts.push(
    state.factories.integrationFact.DependantRelease.make({
      graphObservation: occurrence.evidence,
      graphSource: item.identity,
      settlement: settlement.occurrence.event,
      settlementSource: settlement.identity,
      source: item.identity
    })
  )
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
  if (occurrence.report._tag !== "Running") {
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
    occurrence.report._tag !== "Terminal" ||
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
  return state.factories.facets.make({
    integration: { facts: state.integrationFacts },
    recovery: {
      observationGaps: state.observationGaps,
      preservationDispositions: state.preservationDispositions,
      retainedResponsibilities
    }
  })
}
