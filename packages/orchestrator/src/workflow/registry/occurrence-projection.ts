/* eslint-disable functional/immutable-data, max-lines -- The closed occurrence schema, relationship validation, and journal projection share one exhaustive boundary. */
import { Effect, Match, Option, Schema } from "effect"
import {
  AttemptId,
  PlannedTaskAttempt,
  RunId,
  TaskId,
  PlannedAttemptExecutorReport,
  plannedTaskAttemptEquivalence
} from "@dalph/contracts"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "./event.js"
import { PlannedAttemptExecutorReportOrdinal } from "../protocols/planned-attempt-executor-work/events.js"
import { TaskTrackerFactsObservation } from "../task-tracker-facts/observation.js"
import { taskTrackerObservationMatchesRead } from "../task-tracker-facts/observation-match.js"
import { acceptedResultEquivalence } from "../protocols/integration-admission/responsibility.js"
import { IntegratorRunCorrelation, IntegratorSessionCorrelation } from "../protocols/integrator/events.js"
import { WorkflowOperation } from "./operation.js"
import { WorkflowActor } from "./actor.js"
import { PlannedAttemptWorktreeObservation } from "../protocols/planned-attempt-worktree-observation/protocol.js"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import { taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
import { TaskWorkCapacity } from "../../coordination/admission/capacity.js"
import { RunPolicyRevision } from "../../control/policy.js"
import {
  ControlDirectionApplicationOrdinal,
  ControlDirectionSubject
} from "../protocols/control-direction-application/events.js"
import { TaskClaimReacquisitionRequestId } from "../protocols/task-claim-reacquisition/events.js"
import {
  AttemptChoice,
  AttemptChoiceRequestId,
  AttemptChoiceSubject,
  sameAttemptChoiceRequestId,
  sameAttemptChoiceSubject
} from "../protocols/attempt-choice/events.js"
import {
  AttemptRestartAuthorityReadFailure,
  PlannedAttemptReplacementWitness,
  restartAuthorityReadOperationMatches
} from "../protocols/attempt-choice/replacement-events.js"
import {
  IntegrationResponsibilityBegan,
  IntegrationStarted,
  invalidIntegrationOccurrenceRelationship,
  projectIntegrationOccurrence
} from "./integration-occurrence.js"
import {
  AttemptImplementationAbandoned,
  AttemptStoppageIntended,
  HistoricalWorkflowOccurrence,
  IntegrationClaimDeletionOccurred,
  IntegrationClaimReplacementOccurred,
  IntegrationFinalitySettledOccurred,
  IntegrationFocusedCompletionOccurred,
  IntegrationProviderRunActivityAbsent,
  IntegrationQuarantineDirectionApplied,
  IntegrationQuarantined,
  IntegratorCandidateQualificationInitiated,
  IntegratorCandidateQualificationObserved,
  IntegratorRunResultRecorded,
  IntegratorRunStarted,
  IntegratorSessionFixed,
  IntegratorSuccessorSessionFixed,
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
  TaskWorktreeReconciliationInitiated
} from "./historical-occurrence.js"
import {
  targetPromotionCorrelationEquals,
  type TargetPromotionAttemptIntendedEvent,
  type TargetPromotionIntendedEvent
} from "../protocols/target-promotion/events.js"
export { IntegrationResponsibilityBegan, IntegrationStarted } from "./integration-occurrence.js"
export { WorkflowActor } from "./actor.js"

const initiatedActionFields = {
  initiatedBy: WorkflowActor,
  occurrenceClassification: Schema.Literal("InitiatedAction")
}

/** A past-tense occurrence intentionally initiated by its typed actor. */
export const InitiatedAction = Schema.Struct(initiatedActionFields)
export type InitiatedAction = typeof InitiatedAction.Type

const nonActionOccurrenceFields = { occurrenceClassification: Schema.Literal("NonActionOccurrence") }

/** A past-tense occurrence that is not itself an initiated action. */
export const NonActionOccurrence = Schema.Struct(nonActionOccurrenceFields)
export type NonActionOccurrence = typeof NonActionOccurrence.Type

export const WorkflowOccurrenceClassification = Schema.Union([InitiatedAction, NonActionOccurrence])
export type WorkflowOccurrenceClassification = typeof WorkflowOccurrenceClassification.Type

/** Dalph committed the exact tracker read intent and owns its continuation. */
export const TaskTrackerReadInitiated = Schema.TaggedStruct("TaskTrackerReadInitiated", {
  ...initiatedActionFields,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  operation: Schema.Union([
    WorkflowOperation.cases.ReadCompletionTaskFacts,
    WorkflowOperation.cases.ReadTaskClaim,
    WorkflowOperation.cases.ReadTrackerGraph,
    WorkflowOperation.cases.ReadTaskWorkSpecification
  ]),
  recordedAt: JournalPosition,
  runId: RunId
})
export type TaskTrackerReadInitiated = typeof TaskTrackerReadInitiated.Type

/**
 * Dalph observed exact tracker facts through the named read action. The
 * observation does not claim that the read caused those tracker facts.
 */
export const TaskTrackerFactsObserved = Schema.TaggedStruct("TaskTrackerFactsObserved", {
  evidence: TaskTrackerFactsObservation,
  ...nonActionOccurrenceFields,
  originatingActionOperationId: OperationId,
  recordedAt: JournalPosition,
  runId: RunId
}).check(
  Schema.makeFilter((occurrence) =>
    occurrence.evidence.operationId === occurrence.originatingActionOperationId
      ? undefined
      : "tracker evidence must name the originating read operation"
  )
)
export type TaskTrackerFactsObserved = typeof TaskTrackerFactsObserved.Type

/** Dalph committed one exact planned-attempt Git read and owns its continuation. */
export const GitReadInitiated = Schema.TaggedStruct("GitReadInitiated", {
  ...initiatedActionFields,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  operation: Schema.Union([WorkflowOperation.cases.ReadTaskWorktree, WorkflowOperation.cases.ReadTargetLineage]),
  recordedAt: JournalPosition,
  runId: RunId
})
export type GitReadInitiated = typeof GitReadInitiated.Type

/** Git returned the exact worktree observation through its named read action. */
export const PlannedAttemptWorktreeObserved = Schema.TaggedStruct("PlannedAttemptWorktreeObserved", {
  ...nonActionOccurrenceFields,
  observation: PlannedAttemptWorktreeObservation,
  originatingActionOperationId: OperationId,
  recordedAt: JournalPosition,
  runId: RunId
})
export type PlannedAttemptWorktreeObserved = typeof PlannedAttemptWorktreeObserved.Type

/** Git returned the target head and ancestry fact through its distinct named read action. */
export const TargetLineageObserved = Schema.TaggedStruct("TargetLineageObserved", {
  ...nonActionOccurrenceFields,
  observation: TargetLineageObservation,
  originatingActionOperationId: OperationId,
  plannedAttempt: PlannedTaskAttempt,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TargetLineageObserved = typeof TargetLineageObserved.Type

/**
 * Dalph recorded its intent and assumed responsibility for the exact planned
 * attempt before calling the executor. This does not prove executor activity.
 */
export const PlannedAttemptExecutorWorkResponsibilityBegan = Schema.TaggedStruct(
  "PlannedAttemptExecutorWorkResponsibilityBegan",
  {
    ...initiatedActionFields,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    plannedAttempt: PlannedTaskAttempt,
    recordedAt: JournalPosition,
    runId: RunId
  }
).check(
  Schema.makeFilter((occurrence) =>
    occurrence.runId === occurrence.plannedAttempt.runId
      ? undefined
      : "executor-work responsibility must belong to its planned attempt run"
  )
)
export type PlannedAttemptExecutorWorkResponsibilityBegan = typeof PlannedAttemptExecutorWorkResponsibilityBegan.Type

/**
 * Dalph received one executor condition for the exact attempt. The report
 * proves no executor-internal initiating action or actor.
 */
export const PlannedAttemptExecutorWorkReported = Schema.TaggedStruct("PlannedAttemptExecutorWorkReported", {
  ...nonActionOccurrenceFields,
  ordinal: PlannedAttemptExecutorReportOrdinal,
  recordedAt: JournalPosition,
  report: PlannedAttemptExecutorReport,
  runId: RunId
}).check(
  Schema.makeFilter((occurrence) =>
    occurrence.runId === occurrence.report.correlation.runId
      ? undefined
      : "executor-work report must belong to its correlated run"
  )
)
export type PlannedAttemptExecutorWorkReported = typeof PlannedAttemptExecutorWorkReported.Type

export { ControlDirectionSubject }

/**
 * Operator applied one Pause or Unpause direction. Receiving the request is
 * not this event, and V1 records no operator identity.
 */
export const AppliedControlDirection = Schema.TaggedStruct("AppliedControlDirection", {
  direction: Schema.Literals(["Pause", "Unpause"]),
  initiatedBy: WorkflowActor.cases.Operator,
  occurrenceClassification: initiatedActionFields.occurrenceClassification,
  ordinal: ControlDirectionApplicationOrdinal,
  recordedAt: JournalPosition,
  subject: ControlDirectionSubject
})
export type AppliedControlDirection = typeof AppliedControlDirection.Type

/** Operator applied one explicit direction to reacquire the exact task claim. */
export const AppliedTaskClaimReacquisitionDirection = Schema.TaggedStruct("AppliedTaskClaimReacquisitionDirection", {
  initiatedBy: WorkflowActor.cases.Operator,
  occurrenceClassification: initiatedActionFields.occurrenceClassification,
  requestId: TaskClaimReacquisitionRequestId,
  recordedAt: JournalPosition,
  runId: RunId,
  taskId: TaskId
})
export type AppliedTaskClaimReacquisitionDirection = typeof AppliedTaskClaimReacquisitionDirection.Type

/** Operator applied one exact Continue, Restart, or Stop choice before integration. */
export const AppliedAttemptChoice = Schema.TaggedStruct("AppliedAttemptChoice", {
  choice: AttemptChoice,
  initiatedBy: WorkflowActor.cases.Operator,
  occurrenceClassification: initiatedActionFields.occurrenceClassification,
  recordedAt: JournalPosition,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
})
export type AppliedAttemptChoice = typeof AppliedAttemptChoice.Type

/** Dalph atomically superseded P1 and recorded its exact immutable successor P2. */
export const PlannedAttemptReplaced = Schema.TaggedStruct("PlannedAttemptReplaced", {
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: initiatedActionFields.occurrenceClassification,
  recordedAt: JournalPosition,
  requestId: AttemptChoiceRequestId,
  runId: RunId,
  subject: AttemptChoiceSubject,
  successorPlan: WorkflowOperation.cases.RecordTaskAttemptPlan,
  witness: PlannedAttemptReplacementWitness
})
export type PlannedAttemptReplaced = typeof PlannedAttemptReplaced.Type

/** A Restart authority read failed and therefore proved no successor authority. */
export const AttemptRestartAuthorityReadFailed = Schema.TaggedStruct("AttemptRestartAuthorityReadFailed", {
  failure: AttemptRestartAuthorityReadFailure,
  ...nonActionOccurrenceFields,
  originatingActionOperationId: OperationId,
  recordedAt: JournalPosition,
  requestId: AttemptChoiceRequestId,
  runId: RunId,
  subject: AttemptChoiceSubject
})
export type AttemptRestartAuthorityReadFailed = typeof AttemptRestartAuthorityReadFailed.Type

/** Operator durably changed the future task-admission ceiling for one Run. */
export const AppliedTaskWorkCapacity = Schema.TaggedStruct("AppliedTaskWorkCapacity", {
  capacity: TaskWorkCapacity,
  initiatedBy: WorkflowActor.cases.Operator,
  occurrenceClassification: initiatedActionFields.occurrenceClassification,
  policyRevision: RunPolicyRevision,
  recordedAt: JournalPosition,
  runId: RunId
})
export type AppliedTaskWorkCapacity = typeof AppliedTaskWorkCapacity.Type

export const WorkflowOccurrence = Schema.Union([
  AppliedAttemptChoice,
  AttemptRestartAuthorityReadFailed,
  AppliedControlDirection,
  AppliedTaskClaimReacquisitionDirection,
  AppliedTaskWorkCapacity,
  IntegrationResponsibilityBegan,
  IntegrationStarted,
  GitReadInitiated,
  PlannedAttemptExecutorWorkReported,
  PlannedAttemptExecutorWorkResponsibilityBegan,
  PlannedAttemptReplaced,
  PlannedAttemptWorktreeObserved,
  TargetLineageObserved,
  TaskTrackerReadInitiated,
  TaskTrackerFactsObserved,
  HistoricalWorkflowOccurrence
])
export type WorkflowOccurrence = typeof WorkflowOccurrence.Type

/** Rejects unsupported variants and extra attribution at the production boundary. */
export const decodeWorkflowOccurrence = Schema.decodeUnknownEffect(WorkflowOccurrence, { onExcessProperty: "error" })

export type WorkflowOccurrencePresentation =
  | { readonly classification: "InitiatedAction"; readonly actor: WorkflowActor["_tag"] }
  | { readonly classification: "NonActionOccurrence" }

/**
 * Generic consumers select presentation from the occurrence's own exhaustive
 * classification and actor, never from a concrete event-name table.
 */
export const presentWorkflowOccurrence = (occurrence: WorkflowOccurrence): WorkflowOccurrencePresentation =>
  occurrence.occurrenceClassification === "NonActionOccurrence"
    ? { classification: "NonActionOccurrence" }
    : {
        actor: WorkflowActor.match(occurrence.initiatedBy, {
          DalphCoordinator: () => "DalphCoordinator",
          Operator: () => "Operator"
        }),
        classification: "InitiatedAction"
      }

export const workflowOccurrenceProjectionVersion = 9 as const // eslint-disable-line no-magic-numbers

const relationshipKey = (runId: RunId, relatedId: string): string => JSON.stringify([runId, relatedId])

const isOriginatingActionFor =
  (observation: TaskTrackerFactsObserved) =>
  (occurrence: WorkflowOccurrence): occurrence is TaskTrackerReadInitiated =>
    occurrence._tag === "TaskTrackerReadInitiated" &&
    occurrence.runId === observation.runId &&
    occurrence.operation.operationId === observation.originatingActionOperationId &&
    occurrence.recordedAt < observation.recordedAt &&
    taskTrackerObservationMatchesRead(observation.evidence, occurrence.operation)

const isExecutorResponsibilityFor =
  (report: PlannedAttemptExecutorWorkReported) =>
  (occurrence: WorkflowOccurrence): occurrence is PlannedAttemptExecutorWorkResponsibilityBegan =>
    occurrence._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
    occurrence.runId === report.runId &&
    occurrence.plannedAttempt.attemptId === report.report.correlation.attemptId &&
    occurrence.recordedAt < report.recordedAt

const isOriginatingGitReadFor =
  (observation: PlannedAttemptWorktreeObserved | TargetLineageObserved) =>
  (occurrence: WorkflowOccurrence): occurrence is GitReadInitiated =>
    occurrence._tag === "GitReadInitiated" &&
    occurrence.runId === observation.runId &&
    occurrence.operation.operationId === observation.originatingActionOperationId &&
    occurrence.recordedAt < observation.recordedAt

const ambiguousRelationship = Symbol("ambiguous workflow-occurrence relationship")
type IndexedRelationship<A> = A | typeof ambiguousRelationship

const rememberUniqueRelationship = <A>(
  relationships: Map<string, IndexedRelationship<A>>,
  key: string,
  occurrence: A
): void => {
  relationships.set(key, relationships.has(key) ? ambiguousRelationship : occurrence)
}

const invalidTrackerRelationship = (
  trackerActions: ReadonlyMap<string, IndexedRelationship<TaskTrackerReadInitiated>>,
  occurrence: TaskTrackerFactsObserved,
  index: number
) => {
  const action = trackerActions.get(relationshipKey(occurrence.runId, occurrence.originatingActionOperationId))
  return action !== undefined && action !== ambiguousRelationship && isOriginatingActionFor(occurrence)(action)
    ? undefined
    : {
        issue: `tracker observation must have one exact earlier initiating read action ${occurrence.originatingActionOperationId}`,
        path: ["occurrences", index]
      }
}

const invalidExecutorRelationship = (
  executorResponsibilities: ReadonlyMap<string, IndexedRelationship<PlannedAttemptExecutorWorkResponsibilityBegan>>,
  occurrence: PlannedAttemptExecutorWorkReported,
  index: number
) => {
  const responsibility = executorResponsibilities.get(
    relationshipKey(occurrence.runId, occurrence.report.correlation.attemptId)
  )
  return responsibility !== undefined &&
    responsibility !== ambiguousRelationship &&
    isExecutorResponsibilityFor(occurrence)(responsibility)
    ? undefined
    : {
        issue: `executor report must have one exact earlier responsibility-began action ${occurrence.report.correlation.attemptId}`,
        path: ["occurrences", index]
      }
}

const exactTrackerReadForRestartFailure = (
  trackerActions: ReadonlyMap<string, IndexedRelationship<TaskTrackerReadInitiated>>,
  occurrence: AttemptRestartAuthorityReadFailed
): boolean => {
  if (occurrence.failure._tag !== "AttemptRestartTaskFactsReadFailure") return false
  const action = trackerActions.get(relationshipKey(occurrence.runId, occurrence.originatingActionOperationId))
  if (action === undefined || action === ambiguousRelationship || action.recordedAt >= occurrence.recordedAt) {
    return false
  }
  return restartAuthorityReadOperationMatches(action.operation, occurrence.failure, occurrence.subject)
}

const isExactEarlierGitReadForRestartFailure =
  (occurrence: AttemptRestartAuthorityReadFailed) =>
  (candidate: WorkflowOccurrence): candidate is GitReadInitiated =>
    candidate._tag === "GitReadInitiated" &&
    candidate.runId === occurrence.runId &&
    candidate.operation.operationId === occurrence.originatingActionOperationId &&
    candidate.recordedAt < occurrence.recordedAt

const exactGitReadForRestartFailure = (
  occurrences: ReadonlyArray<WorkflowOccurrence>,
  occurrence: AttemptRestartAuthorityReadFailed
): boolean => {
  if (occurrence.failure._tag === "AttemptRestartTaskFactsReadFailure") return false
  const actions = occurrences.filter(isExactEarlierGitReadForRestartFailure(occurrence))
  if (actions.length !== 1) return false
  const operation = actions[0]?.operation
  /* v8 ignore next -- @preserve A schema-valid GitReadInitiated occurrence always has operation when the exact-one filter succeeds. */
  if (operation === undefined) return false
  return restartAuthorityReadOperationMatches(operation, occurrence.failure, occurrence.subject)
}

const restartFailureHasExactEarlierRead = (
  occurrences: ReadonlyArray<WorkflowOccurrence>,
  trackerActions: ReadonlyMap<string, IndexedRelationship<TaskTrackerReadInitiated>>,
  occurrence: AttemptRestartAuthorityReadFailed
): boolean =>
  occurrence.requestId.runId === occurrence.runId &&
  occurrence.subject.plannedAttempt.runId === occurrence.runId &&
  (exactTrackerReadForRestartFailure(trackerActions, occurrence) ||
    exactGitReadForRestartFailure(occurrences, occurrence))

type RestartDependentOccurrence = AttemptRestartAuthorityReadFailed | PlannedAttemptReplaced

const isRestartDependentOccurrence = (occurrence: WorkflowOccurrence): occurrence is RestartDependentOccurrence =>
  occurrence._tag === "AttemptRestartAuthorityReadFailed" || occurrence._tag === "PlannedAttemptReplaced"

const restartOccurrenceHasExactAppliedChoice = (
  occurrences: ReadonlyArray<WorkflowOccurrence>,
  occurrence: RestartDependentOccurrence
): boolean =>
  occurrences.filter(
    (candidate) =>
      candidate._tag === "AppliedAttemptChoice" &&
      candidate.choice === "RestartTaskImplementation" &&
      candidate.recordedAt < occurrence.recordedAt &&
      sameAttemptChoiceRequestId(candidate.requestId, occurrence.requestId) &&
      sameAttemptChoiceSubject(candidate.subject, occurrence.subject)
  ).length === 1

const invalidRestartOccurrenceRelationship = (
  occurrences: ReadonlyArray<WorkflowOccurrence>,
  trackerActions: ReadonlyMap<string, IndexedRelationship<TaskTrackerReadInitiated>>,
  occurrence: RestartDependentOccurrence,
  index: number
) => {
  if (!restartOccurrenceHasExactAppliedChoice(occurrences, occurrence)) {
    const subject =
      occurrence._tag === "AttemptRestartAuthorityReadFailed"
        ? "Restart authority failure"
        : "planned-attempt replacement"
    return {
      issue: `${subject} requires its exact earlier applied Restart ${occurrence.requestId.nonce}`,
      path: ["occurrences", index]
    }
  }
  if (occurrence._tag === "PlannedAttemptReplaced") return undefined
  return !restartFailureHasExactEarlierRead(occurrences, trackerActions, occurrence)
    ? {
        issue: `Restart authority failure must have one exact earlier initiating read action ${occurrence.originatingActionOperationId}`,
        path: ["occurrences", index]
      }
    : undefined
}

const invalidOutcomeRelationship = (
  projection: { readonly occurrences: ReadonlyArray<WorkflowOccurrence> },
  occurrence: WorkflowOccurrence,
  index: number,
  trackerActions: ReadonlyMap<string, IndexedRelationship<TaskTrackerReadInitiated>>,
  executorResponsibilities: ReadonlyMap<string, IndexedRelationship<PlannedAttemptExecutorWorkResponsibilityBegan>>
) => {
  if (occurrence._tag === "TaskTrackerFactsObserved") {
    return invalidTrackerRelationship(trackerActions, occurrence, index)
  }
  if (isRestartDependentOccurrence(occurrence)) {
    return invalidRestartOccurrenceRelationship(projection.occurrences, trackerActions, occurrence, index)
  }
  if (occurrence._tag === "PlannedAttemptExecutorWorkReported") {
    return invalidExecutorRelationship(executorResponsibilities, occurrence, index)
  }
  if (occurrence._tag === "PlannedAttemptWorktreeObserved" || occurrence._tag === "TargetLineageObserved") {
    const action = projection.occurrences.find(isOriginatingGitReadFor(occurrence))
    return action === undefined
      ? {
          issue: `Git worktree observation must have one exact earlier initiating read action ${occurrence.originatingActionOperationId}`,
          path: ["occurrences", index]
        }
      : undefined
  }
  return invalidIntegrationOccurrenceRelationship(projection.occurrences, occurrence, index)
}

const invalidOriginatingAction = (projection: { readonly occurrences: ReadonlyArray<WorkflowOccurrence> }) => {
  const trackerActions = new Map<string, IndexedRelationship<TaskTrackerReadInitiated>>()
  const executorResponsibilities = new Map<string, IndexedRelationship<PlannedAttemptExecutorWorkResponsibilityBegan>>()

  for (const [index, occurrence] of projection.occurrences.entries()) {
    if (occurrence._tag === "TaskTrackerReadInitiated") {
      rememberUniqueRelationship(
        trackerActions,
        relationshipKey(occurrence.runId, occurrence.operation.operationId),
        occurrence
      )
      continue
    }
    if (occurrence._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
      rememberUniqueRelationship(
        executorResponsibilities,
        relationshipKey(occurrence.runId, occurrence.plannedAttempt.attemptId),
        occurrence
      )
      continue
    }
    const invalid = invalidOutcomeRelationship(projection, occurrence, index, trackerActions, executorResponsibilities)
    if (invalid !== undefined) return invalid
  }
  return undefined
}

/** Schema-versioned semantic values intended for production trace consumers. */
export const WorkflowOccurrenceProjection = Schema.Struct({
  occurrences: Schema.Array(WorkflowOccurrence),
  version: Schema.Literal(workflowOccurrenceProjectionVersion)
}).check(Schema.makeFilter(invalidOriginatingAction))
export type WorkflowOccurrenceProjection = typeof WorkflowOccurrenceProjection.Type

type ProjectedJournalEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "PlannedAttemptExecutorWorkReported"
      | "PlannedAttemptExecutorWorkResponsibilityBegan"
      | "IntegrationResponsibilityBegan"
      | "IntegrationStarted"
      | "GitReadIntentRecorded"
      | "PlannedAttemptWorktreeObserved"
      | "TargetLineageObserved"
      | "TaskWorkCapacityChanged"
      | "AttemptChoiceApplied"
      | "PlannedAttemptReplaced"
      | "AttemptRestartAuthorityReadFailed"
      | "ControlDirectionApplied"
      | "TaskClaimReacquisitionDirected"
      | "TaskTrackerReadIntentRecorded"
      | "TaskTrackerFactsObserved"
  }
>
type NonProjectedJournalEvent = Exclude<WorkflowJournalEvent, ProjectedJournalEvent>

const nonProjectedJournalEventKinds = {
  AttemptImplementationAbandoned: true,
  AttemptStoppageIntended: true,
  IntegratorRunCandidateGitObserved: true,
  IntegratorRunCandidateGitReadIntended: true,
  IntegratorRunResultRecorded: true,
  IntegratorRunStarted: true,
  IntegratorSessionFixed: true,
  IntegratorSuccessorSessionFixed: true,
  TargetPromotionAttemptIntended: true,
  TargetPromotionIntended: true,
  TargetPromotionNonConvergence: true,
  TargetPromotionObservedSuccess: true,
  TargetPromotionStale: true,
  PlannedAttemptContinuationAuthorized: true,
  CompletionClaimReplacementIntended: true,
  CompletionClaimReplacementAttemptIntended: true,
  CompletionClaimReplaced: true,
  CompletionClaimDeletionIntended: true,
  CompletionClaimDeletionAttemptIntended: true,
  CompletionClaimDeleted: true,
  CompletionClaimDeletionReadObserved: true,
  IntegrationFinalitySettled: true,
  IntegrationQuarantined: true,
  IntegrationQuarantineDirectionApplied: true,
  IntegrationProviderRunActivityAbsent: true,
  CompletionTaskIntended: true,
  CompletionTaskAttemptIntended: true,
  CompletionTaskAcknowledged: true,
  CompletionTaskResponseLost: true,
  CompletionTaskRejected: true,
  CompletionTaskCandidateAncestryReadIntended: true,
  CompletionTaskCandidateAncestryObserved: true,
  CompletionTaskRequestLookupIntended: true,
  CompletionTaskRequestLookupObserved: true,
  PostPromotionBlockerCandidateAncestryReadIntended: true,
  PostPromotionBlockerCandidateAncestryObserved: true,
  PlannedAttemptExecutorCommandIntended: true,
  PlannedAttemptExecutorCommandProjectionObserved: true,
  PlannedAttemptExecutorCommandResponseContradicted: true,
  PlannedAttemptExecutorStateObserved: true,
  TaskAttemptPlanned: true,
  TaskClaimAcquired: true,
  TaskClaimAcquisitionIntended: true,
  TaskClaimAcquisitionRejected: true,
  TaskClaimReleaseIntended: true,
  TaskClaimReleased: true,
  StoppedAttemptClaimNoReleaseObserved: true,
  TaskWorktreeReady: true,
  TaskWorktreeReconciliationIntended: true,
  WorkflowRunBegan: true,
  WorkflowRunTerminated: true
} satisfies Record<NonProjectedJournalEvent["_tag"], true>

const historicalJournalEventKinds = {
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
  TaskClaimReleased: true,
  TaskClaimReleaseIntended: true,
  TaskWorktreeReconciliationIntended: true,
  TaskWorktreeReady: true
} as const

type HistoricalJournalEvent = Extract<WorkflowJournalEvent, { readonly _tag: keyof typeof historicalJournalEventKinds }>

const historicalFocusedCompletionEventKinds = {
  CompletionTaskAcknowledged: true,
  CompletionTaskAttemptIntended: true,
  CompletionTaskCandidateAncestryObserved: true,
  CompletionTaskCandidateAncestryReadIntended: true,
  CompletionTaskIntended: true,
  CompletionTaskRejected: true,
  CompletionTaskRequestLookupIntended: true,
  CompletionTaskRequestLookupObserved: true,
  CompletionTaskResponseLost: true,
  PostPromotionBlockerCandidateAncestryReadIntended: true,
  PostPromotionBlockerCandidateAncestryObserved: true
} as const

const historicalClaimReplacementEventKinds = {
  CompletionClaimReplaced: true,
  CompletionClaimReplacementAttemptIntended: true,
  CompletionClaimReplacementIntended: true
} as const

const historicalClaimDeletionEventKinds = {
  CompletionClaimDeleted: true,
  CompletionClaimDeletionAttemptIntended: true,
  CompletionClaimDeletionIntended: true,
  CompletionClaimDeletionReadObserved: true
} as const

type HistoricalFocusedCompletionJournalEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: keyof typeof historicalFocusedCompletionEventKinds }
>
type HistoricalClaimReplacementJournalEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: keyof typeof historicalClaimReplacementEventKinds }
>
type HistoricalClaimDeletionJournalEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: keyof typeof historicalClaimDeletionEventKinds }
>

const isHistoricalFocusedCompletionJournalEvent = (
  event: WorkflowJournalEvent
): event is HistoricalFocusedCompletionJournalEvent => Object.hasOwn(historicalFocusedCompletionEventKinds, event._tag)

const isHistoricalClaimReplacementJournalEvent = (
  event: WorkflowJournalEvent
): event is HistoricalClaimReplacementJournalEvent => Object.hasOwn(historicalClaimReplacementEventKinds, event._tag)

const isHistoricalClaimDeletionJournalEvent = (
  event: WorkflowJournalEvent
): event is HistoricalClaimDeletionJournalEvent => Object.hasOwn(historicalClaimDeletionEventKinds, event._tag)

const isHistoricalJournalEvent = (event: WorkflowJournalEvent): event is HistoricalJournalEvent =>
  Object.hasOwn(historicalJournalEventKinds, event._tag)

const noOccurrence = (event: NonProjectedJournalEvent): ReadonlyArray<WorkflowOccurrence> => {
  void nonProjectedJournalEventKinds[event._tag]
  return []
}

/** A tracker result cannot prove which same-run read action observed it. */
export class TrackerOutcomeWithoutReadIntent extends Schema.TaggedError<TrackerOutcomeWithoutReadIntent>()(
  "TrackerOutcomeWithoutReadIntent",
  { operationId: OperationId, position: JournalPosition, runId: RunId }
) {}

/** A Git result cannot prove which same-run read action observed it. */
export class GitOutcomeWithoutReadIntent extends Schema.TaggedError<GitOutcomeWithoutReadIntent>()(
  "GitOutcomeWithoutReadIntent",
  { operationId: OperationId, position: JournalPosition, runId: RunId }
) {}

/** An executor report cannot prove which Dalph responsibility preceded it. */
export class ExecutorReportWithoutResponsibilityBegan extends Schema.TaggedError<ExecutorReportWithoutResponsibilityBegan>()(
  "ExecutorReportWithoutResponsibilityBegan",
  { attemptId: AttemptId, position: JournalPosition, runId: RunId }
) {}

type DirectlyProjectedJournalEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "IntegrationResponsibilityBegan"
      | "IntegrationStarted"
      | "PlannedAttemptExecutorWorkResponsibilityBegan"
      | "TaskWorkCapacityChanged"
      | "AttemptChoiceApplied"
      | "PlannedAttemptReplaced"
      | "ControlDirectionApplied"
      | "TaskClaimReacquisitionDirected"
  }
>

const isDirectlyProjectedJournalEvent = (event: WorkflowJournalEvent): event is DirectlyProjectedJournalEvent =>
  event._tag === "IntegrationResponsibilityBegan" ||
  event._tag === "IntegrationStarted" ||
  event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ||
  event._tag === "AttemptChoiceApplied" ||
  event._tag === "PlannedAttemptReplaced" ||
  event._tag === "ControlDirectionApplied" ||
  event._tag === "TaskClaimReacquisitionDirected" ||
  event._tag === "TaskWorkCapacityChanged"

const projectDirectOccurrence = (
  record: JournalRecord,
  event: DirectlyProjectedJournalEvent,
  executorResponsibilities: Set<string>,
  occurrences: Array<WorkflowOccurrence>
): void => {
  if (event._tag === "AttemptChoiceApplied") {
    occurrences.push(
      AppliedAttemptChoice.make({
        choice: event.choice,
        initiatedBy: event.initiatedBy,
        occurrenceClassification: event.occurrenceClassification,
        recordedAt: record.position,
        requestId: event.requestId,
        subject: event.subject
      })
    )
    return
  }
  if (event._tag === "PlannedAttemptReplaced") {
    occurrences.push(
      PlannedAttemptReplaced.make({
        initiatedBy: event.initiatedBy,
        occurrenceClassification: event.occurrenceClassification,
        recordedAt: record.position,
        requestId: event.requestId,
        runId: record.runId,
        subject: event.subject,
        successorPlan: event.successorPlan,
        witness: event.witness
      })
    )
    return
  }
  if (event._tag === "ControlDirectionApplied") {
    occurrences.push(
      AppliedControlDirection.make({
        direction: event.direction,
        initiatedBy: event.initiatedBy,
        occurrenceClassification: event.occurrenceClassification,
        ordinal: event.ordinal,
        recordedAt: record.position,
        subject: event.subject
      })
    )
    return
  }
  if (event._tag === "TaskClaimReacquisitionDirected") {
    occurrences.push(
      AppliedTaskClaimReacquisitionDirection.make({
        initiatedBy: event.initiatedBy,
        occurrenceClassification: event.occurrenceClassification,
        requestId: event.requestId,
        recordedAt: record.position,
        runId: event.subject.runId,
        taskId: event.subject.taskId
      })
    )
    return
  }
  if (event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
    executorResponsibilities.add(relationshipKey(record.runId, event.plannedAttempt.attemptId))
    occurrences.push(
      PlannedAttemptExecutorWorkResponsibilityBegan.make({
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        plannedAttempt: event.plannedAttempt,
        recordedAt: record.position,
        runId: record.runId
      })
    )
    return
  }
  if (event._tag === "IntegrationResponsibilityBegan") {
    occurrences.push(projectIntegrationOccurrence(record, event))
    return
  }
  if (event._tag === "IntegrationStarted") {
    occurrences.push(projectIntegrationOccurrence(record, event))
    return
  }
  occurrences.push(
    AppliedTaskWorkCapacity.make({
      capacity: event.capacity,
      initiatedBy: WorkflowActor.cases.Operator.make({}),
      occurrenceClassification: "InitiatedAction",
      policyRevision: event.revision,
      recordedAt: record.position,
      runId: record.runId
    })
  )
}

type TaskClaimAcquisitionJournalEvent = Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquisitionIntended" }>
type TaskClaimReleaseJournalEvent = Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimReleaseIntended" }>
type IntegratorSessionJournalEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "IntegratorSessionFixed" | "IntegratorSuccessorSessionFixed" }
>
type IntegratorRunStartedJournalEvent = Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorRunStarted" }>
type IntegratorCandidateIntentJournalEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "IntegratorRunCandidateGitReadIntended" }
>

const historicalRunKey = (run: {
  readonly session: { readonly sessionId: string }
  readonly ordinal: number
}): string => JSON.stringify([run.session.sessionId, run.ordinal])

const integratorSessionKey = (session: { readonly sessionId: string }): string => session.sessionId

const promotionAttemptKey = (requestId: string, ordinal: number): string => JSON.stringify([requestId, ordinal])

const historicalCandidateKey = (
  run: { readonly session: { readonly sessionId: string }; readonly ordinal: number },
  candidateText: string
): string => JSON.stringify([run.session.sessionId, run.ordinal, candidateText])

const integratorSessionCorrelationsEqual = Schema.toEquivalence(IntegratorSessionCorrelation)

const sessionCorrelationOf = (event: IntegratorSessionJournalEvent): IntegratorSessionCorrelation =>
  event._tag === "IntegratorSessionFixed" ? event.correlation : event.successor

const integrationTargetEqual = (
  left: { readonly repository: string; readonly ref: string },
  right: { readonly repository: string; readonly ref: string }
): boolean => left.repository === right.repository && left.ref === right.ref

const integrationStartedMatchesSession = (
  occurrence: WorkflowOccurrence,
  correlation: IntegratorSessionCorrelation,
  position: JournalPosition
): boolean =>
  occurrence._tag === "IntegrationStarted" &&
  occurrence.recordedAt < position &&
  occurrence.recordedAt === correlation.startedAt &&
  occurrence.responsibilityBeganAt === correlation.queuedAt &&
  acceptedResultEquivalence(occurrence.acceptedResult, correlation.acceptedResult) &&
  plannedTaskAttemptEquivalence(occurrence.plannedAttempt, correlation.plannedAttempt) &&
  integrationTargetEqual(occurrence.integrationTarget, correlation.integrationTarget)

const targetLineageMatchesSession = (
  occurrence: WorkflowOccurrence,
  correlation: IntegratorSessionCorrelation,
  position: JournalPosition
): boolean =>
  occurrence._tag === "TargetLineageObserved" &&
  occurrence.recordedAt < position &&
  occurrence.recordedAt === correlation.targetLineageObservedAt &&
  plannedTaskAttemptEquivalence(occurrence.plannedAttempt, correlation.plannedAttempt) &&
  occurrence.observation.targetHeadSha === correlation.expectedTargetHead

type HistoricalProjectionContext = ProjectionContext & {
  readonly taskClaimAcquisitionIntents: Map<string, TaskClaimAcquisitionJournalEvent>
  readonly taskClaimReleaseIntents: Map<string, TaskClaimReleaseJournalEvent>
  readonly taskWorktreeIntents: Map<string, typeof WorkflowOperation.cases.ReconcileTaskWorktree.Type>
  readonly integratorSessions: Map<string, IntegratorSessionJournalEvent>
  readonly integratorRunStarts: Map<string, IntegratorRunStartedJournalEvent>
  readonly integratorCandidateIntents: Map<string, IntegratorCandidateIntentJournalEvent>
  readonly promotionIntents: Map<string, TargetPromotionIntendedEvent>
  readonly promotionAttemptIntents: Map<string, TargetPromotionAttemptIntendedEvent>
}

const historicalTaskClaimEventKinds = {
  TaskClaimAcquired: true,
  TaskClaimAcquisitionIntended: true,
  TaskClaimReleased: true,
  TaskClaimReleaseIntended: true
} as const

const historicalAttemptWorktreeEventKinds = {
  AttemptImplementationAbandoned: true,
  AttemptStoppageIntended: true,
  StoppedAttemptClaimNoReleaseObserved: true,
  TaskAttemptPlanned: true,
  TaskWorktreeReady: true,
  TaskWorktreeReconciliationIntended: true
} as const

const historicalIntegratorEventKinds = {
  IntegratorRunCandidateGitObserved: true,
  IntegratorRunCandidateGitReadIntended: true,
  IntegratorRunResultRecorded: true,
  IntegratorRunStarted: true,
  IntegratorSessionFixed: true,
  IntegratorSuccessorSessionFixed: true
} as const

const historicalPromotionEventKinds = {
  TargetPromotionAttemptIntended: true,
  TargetPromotionIntended: true,
  TargetPromotionNonConvergence: true,
  TargetPromotionObservedSuccess: true,
  TargetPromotionStale: true
} as const

const historicalBoundaryEventKinds = {
  IntegrationProviderRunActivityAbsent: true,
  IntegrationQuarantineDirectionApplied: true,
  IntegrationQuarantined: true
} as const

const historicalFinalityStepEventKinds = {
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

type HistoricalTaskClaimEvent = Extract<
  HistoricalJournalEvent,
  { readonly _tag: keyof typeof historicalTaskClaimEventKinds }
>
type HistoricalAttemptWorktreeEvent = Extract<
  HistoricalJournalEvent,
  { readonly _tag: keyof typeof historicalAttemptWorktreeEventKinds }
>
type HistoricalIntegratorEvent = Extract<
  HistoricalJournalEvent,
  { readonly _tag: keyof typeof historicalIntegratorEventKinds }
>
type HistoricalPromotionEvent = Extract<
  HistoricalJournalEvent,
  { readonly _tag: keyof typeof historicalPromotionEventKinds }
>
type HistoricalBoundaryEvent = Extract<
  HistoricalJournalEvent,
  { readonly _tag: keyof typeof historicalBoundaryEventKinds }
>
type HistoricalFinalityStepEvent = Extract<
  HistoricalJournalEvent,
  { readonly _tag: keyof typeof historicalFinalityStepEventKinds }
>

const isHistoricalTaskClaimEvent = (event: HistoricalJournalEvent): event is HistoricalTaskClaimEvent =>
  Object.hasOwn(historicalTaskClaimEventKinds, event._tag)

const isHistoricalAttemptWorktreeEvent = (event: HistoricalJournalEvent): event is HistoricalAttemptWorktreeEvent =>
  Object.hasOwn(historicalAttemptWorktreeEventKinds, event._tag)

const isHistoricalIntegratorEvent = (event: HistoricalJournalEvent): event is HistoricalIntegratorEvent =>
  Object.hasOwn(historicalIntegratorEventKinds, event._tag)

const isHistoricalPromotionEvent = (event: HistoricalJournalEvent): event is HistoricalPromotionEvent =>
  Object.hasOwn(historicalPromotionEventKinds, event._tag)

const isHistoricalBoundaryEvent = (event: HistoricalJournalEvent): event is HistoricalBoundaryEvent =>
  Object.hasOwn(historicalBoundaryEventKinds, event._tag)

const isHistoricalFinalityStepEvent = (event: HistoricalJournalEvent): event is HistoricalFinalityStepEvent =>
  Object.hasOwn(historicalFinalityStepEventKinds, event._tag)

/** A historical action/result relation was not provable from the committed prefix. */
export class HistoricalOutcomeWithoutInitiatingAction extends Schema.TaggedError<HistoricalOutcomeWithoutInitiatingAction>()(
  "HistoricalOutcomeWithoutInitiatingAction",
  { detail: Schema.String, position: JournalPosition, runId: RunId }
) {}

type HistoricalProjectionResult = Effect.Effect<
  WorkflowOccurrence | void,
  TrackerOutcomeWithoutReadIntent | GitOutcomeWithoutReadIntent | HistoricalOutcomeWithoutInitiatingAction
>

const historicalFailure = (record: JournalRecord, detail: string): HistoricalProjectionResult =>
  Effect.fail(new HistoricalOutcomeWithoutInitiatingAction({ detail, position: record.position, runId: record.runId }))

const projectHistoricalTaskClaim = (
  record: JournalRecord,
  event: HistoricalTaskClaimEvent,
  context: HistoricalProjectionContext
): HistoricalProjectionResult => {
  if (event._tag === "TaskClaimAcquisitionIntended") {
    context.taskClaimAcquisitionIntents.set(
      relationshipKey(record.runId, event.operation.acquisition.operationId),
      event
    )
    return Effect.succeed(
      TaskClaimAcquisitionInitiated.make({
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operation: event.operation,
        recordedAt: record.position,
        runId: record.runId
      })
    )
  }
  if (event._tag === "TaskClaimAcquired") {
    const operationId = event.claim.operationId
    if (!context.taskClaimAcquisitionIntents.has(relationshipKey(record.runId, operationId))) {
      return Effect.fail(
        new TrackerOutcomeWithoutReadIntent({ operationId, position: record.position, runId: record.runId })
      )
    }
    return Effect.succeed(
      TaskClaimAcquired.make({
        claim: event.claim,
        occurrenceClassification: "NonActionOccurrence",
        originatingActionOperationId: operationId,
        recordedAt: record.position,
        runId: record.runId
      })
    )
  }
  if (event._tag === "TaskClaimReleaseIntended") {
    context.taskClaimReleaseIntents.set(relationshipKey(record.runId, event.operation.release.operationId), event)
    return Effect.succeed(
      TaskClaimReleaseInitiated.make({
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operation: event.operation,
        recordedAt: record.position,
        runId: record.runId
      })
    )
  }
  const operationId = event.release.operationId
  if (!context.taskClaimReleaseIntents.has(relationshipKey(record.runId, operationId))) {
    return Effect.fail(
      new TrackerOutcomeWithoutReadIntent({ operationId, position: record.position, runId: record.runId })
    )
  }
  return Effect.succeed(
    TaskClaimReleased.make({
      occurrenceClassification: "NonActionOccurrence",
      originatingActionOperationId: operationId,
      recordedAt: record.position,
      release: event.release,
      runId: record.runId
    })
  )
}

const projectHistoricalAttemptWorktree = (
  record: JournalRecord,
  event: HistoricalAttemptWorktreeEvent,
  context: HistoricalProjectionContext
): HistoricalProjectionResult => {
  if (event._tag === "TaskAttemptPlanned") {
    return Effect.succeed(
      TaskAttemptPlanned.make({
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operation: event.operation,
        plannedAttempt: event.operation.plannedAttempt,
        recordedAt: record.position,
        runId: record.runId
      })
    )
  }
  if (event._tag === "TaskWorktreeReady") {
    const intent = context.taskWorktreeIntents.get(relationshipKey(record.runId, event.operationId))
    if (intent === undefined) {
      return Effect.fail(
        new GitOutcomeWithoutReadIntent({
          operationId: event.operationId,
          position: record.position,
          runId: record.runId
        })
      )
    }
    return Effect.succeed(
      TaskWorktreeReady.make({
        occurrenceClassification: "NonActionOccurrence",
        operation: intent,
        operationId: event.operationId,
        proof: event.proof,
        recordedAt: record.position,
        runId: record.runId
      })
    )
  }
  if (event._tag === "TaskWorktreeReconciliationIntended") {
    context.taskWorktreeIntents.set(relationshipKey(record.runId, event.operation.operationId), event.operation)
    return Effect.succeed(
      TaskWorktreeReconciliationInitiated.make({
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operation: event.operation,
        recordedAt: record.position,
        runId: record.runId
      })
    )
  }
  if (event._tag === "AttemptStoppageIntended") {
    return Effect.succeed(
      AttemptStoppageIntended.make({
        initiatedBy: event.initiatedBy,
        occurrenceClassification: event.occurrenceClassification,
        recordedAt: record.position,
        requestId: event.requestId,
        runId: record.runId,
        subject: event.subject
      })
    )
  }
  if (event._tag === "AttemptImplementationAbandoned") {
    return Effect.succeed(
      AttemptImplementationAbandoned.make({
        expectedClaim: event.expectedClaim,
        initiatedBy: event.initiatedBy,
        occurrenceClassification: event.occurrenceClassification,
        proof: event.proof,
        recordedAt: record.position,
        requestId: event.requestId,
        runId: record.runId,
        subject: event.subject
      })
    )
  }
  return Effect.succeed(
    StoppedAttemptClaimPreserved.make({
      expectedClaim: event.expectedClaim,
      observation: event.observation,
      occurrenceClassification: event.occurrenceClassification,
      observationOperationId: event.observationOperationId,
      recordedAt: record.position,
      requestId: event.requestId,
      runId: record.runId,
      subject: event.subject
    })
  )
}

type HistoricalSessionEvent = Extract<
  HistoricalIntegratorEvent,
  { readonly _tag: "IntegratorSessionFixed" | "IntegratorSuccessorSessionFixed" }
>
type HistoricalRunEvent = Extract<
  HistoricalIntegratorEvent,
  { readonly _tag: "IntegratorRunStarted" | "IntegratorRunResultRecorded" }
>
type HistoricalCandidateEvent = Extract<
  HistoricalIntegratorEvent,
  { readonly _tag: "IntegratorRunCandidateGitReadIntended" | "IntegratorRunCandidateGitObserved" }
>

const projectHistoricalSessionFixed = (
  record: JournalRecord,
  event: Extract<HistoricalSessionEvent, { readonly _tag: "IntegratorSessionFixed" }>,
  context: HistoricalProjectionContext
): HistoricalProjectionResult => {
  const hasStart = context.occurrences.some((occurrence) =>
    integrationStartedMatchesSession(occurrence, event.correlation, record.position)
  )
  const hasLineage = context.occurrences.some((occurrence) =>
    targetLineageMatchesSession(occurrence, event.correlation, record.position)
  )
  if (!hasStart || !hasLineage || event.correlation.plannedAttempt.runId !== record.runId) {
    return historicalFailure(
      record,
      "Integrator session " +
        event.correlation.sessionId +
        " must identify one exact earlier integration start and target lineage"
    )
  }
  if (context.integratorSessions.has(integratorSessionKey(event.correlation))) {
    return historicalFailure(record, "duplicate Integrator session " + event.correlation.sessionId)
  }
  context.integratorSessions.set(integratorSessionKey(event.correlation), event)
  return Effect.succeed(
    IntegratorSessionFixed.make({
      correlation: event.correlation,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      recordedAt: record.position,
      runId: record.runId
    })
  )
}

const projectHistoricalSuccessorSession = (
  record: JournalRecord,
  event: Extract<HistoricalSessionEvent, { readonly _tag: "IntegratorSuccessorSessionFixed" }>,
  context: HistoricalProjectionContext
): HistoricalProjectionResult => {
  if (!context.integratorSessions.has(integratorSessionKey(event.predecessor))) {
    return historicalFailure(
      record,
      "successor session " + event.successor.sessionId + " has no earlier predecessor session"
    )
  }
  const quarantined = context.occurrences.some(
    (occurrence) => occurrence._tag === "IntegrationQuarantined" && occurrence.recordedAt === event.quarantineAt
  )
  if (!quarantined) {
    return historicalFailure(
      record,
      "successor session " + event.successor.sessionId + " has no exact quarantine occurrence"
    )
  }
  if (context.integratorSessions.has(integratorSessionKey(event.successor))) {
    return historicalFailure(record, "duplicate Integrator successor session " + event.successor.sessionId)
  }
  context.integratorSessions.set(integratorSessionKey(event.predecessor), event)
  context.integratorSessions.set(integratorSessionKey(event.successor), event)
  return Effect.succeed(
    IntegratorSuccessorSessionFixed.make({
      direction: event.direction,
      directionAppliedAt: event.directionAppliedAt,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      predecessor: event.predecessor,
      quarantineAt: event.quarantineAt,
      recordedAt: record.position,
      runId: record.runId,
      successor: event.successor,
      successorGeneration: event.successorGeneration
    })
  )
}

const projectHistoricalRunStarted = (
  record: JournalRecord,
  event: Extract<HistoricalRunEvent, { readonly _tag: "IntegratorRunStarted" }>,
  context: HistoricalProjectionContext
): HistoricalProjectionResult => {
  const sessionEvent = context.integratorSessions.get(integratorSessionKey(event.run.session))
  if (
    sessionEvent === undefined ||
    !integratorSessionCorrelationsEqual(sessionCorrelationOf(sessionEvent), event.run.session) ||
    event.run.session.plannedAttempt.runId !== record.runId
  ) {
    return historicalFailure(record, "Integrator run " + historicalRunKey(event.run) + " has no fixed session")
  }
  const runKey = historicalRunKey(event.run)
  if (context.integratorRunStarts.has(runKey)) {
    return historicalFailure(record, "duplicate Integrator run " + runKey)
  }
  context.integratorRunStarts.set(runKey, event)
  return Effect.succeed(
    IntegratorRunStarted.make({
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      recordedAt: record.position,
      run: event.run,
      runId: record.runId
    })
  )
}

const projectHistoricalRunResult = (
  record: JournalRecord,
  event: Extract<HistoricalRunEvent, { readonly _tag: "IntegratorRunResultRecorded" }>,
  context: HistoricalProjectionContext
): HistoricalProjectionResult => {
  const start = context.integratorRunStarts.get(historicalRunKey(event.run))
  if (start === undefined || !Schema.toEquivalence(IntegratorRunCorrelation)(start.run, event.run)) {
    return historicalFailure(record, "Integrator result " + historicalRunKey(event.run) + " has no earlier run start")
  }
  return Effect.succeed(
    IntegratorRunResultRecorded.make({
      occurrenceClassification: "NonActionOccurrence",
      recordedAt: record.position,
      result: event.result,
      run: event.run,
      runId: record.runId
    })
  )
}

const projectHistoricalCandidateIntent = (
  record: JournalRecord,
  event: Extract<HistoricalCandidateEvent, { readonly _tag: "IntegratorRunCandidateGitReadIntended" }>,
  context: HistoricalProjectionContext
): HistoricalProjectionResult => {
  const start = context.integratorRunStarts.get(historicalRunKey(event.run))
  if (start === undefined || !Schema.toEquivalence(IntegratorRunCorrelation)(start.run, event.run)) {
    return historicalFailure(record, "candidate qualification " + event.candidateText + " has no earlier run start")
  }
  const candidateKey = historicalCandidateKey(event.run, event.candidateText)
  if (context.integratorCandidateIntents.has(candidateKey)) {
    return historicalFailure(record, "duplicate candidate qualification intent " + candidateKey)
  }
  context.integratorCandidateIntents.set(candidateKey, event)
  return Effect.succeed(
    IntegratorCandidateQualificationInitiated.make({
      candidateText: event.candidateText,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      recordedAt: record.position,
      run: event.run,
      runId: record.runId
    })
  )
}

const projectHistoricalCandidateObserved = (
  record: JournalRecord,
  event: Extract<HistoricalCandidateEvent, { readonly _tag: "IntegratorRunCandidateGitObserved" }>,
  context: HistoricalProjectionContext
): HistoricalProjectionResult => {
  const key = historicalCandidateKey(event.run, event.candidateText)
  const intent = context.integratorCandidateIntents.get(key)
  if (
    intent === undefined ||
    !Schema.toEquivalence(IntegratorRunCorrelation)(intent.run, event.run) ||
    intent.candidateText !== event.candidateText
  ) {
    return Effect.fail(
      new GitOutcomeWithoutReadIntent({
        operationId: OperationId.make(key),
        position: record.position,
        runId: record.runId
      })
    )
  }
  return Effect.succeed(
    IntegratorCandidateQualificationObserved.make({
      candidateText: event.candidateText,
      observation: event.observation,
      occurrenceClassification: "NonActionOccurrence",
      originatingActionRun: event.run,
      recordedAt: record.position,
      runId: record.runId
    })
  )
}

const projectHistoricalIntegrator = (
  record: JournalRecord,
  event: HistoricalIntegratorEvent,
  context: HistoricalProjectionContext
): HistoricalProjectionResult => {
  if (event._tag === "IntegratorSessionFixed") return projectHistoricalSessionFixed(record, event, context)
  if (event._tag === "IntegratorSuccessorSessionFixed") return projectHistoricalSuccessorSession(record, event, context)
  if (event._tag === "IntegratorRunStarted") return projectHistoricalRunStarted(record, event, context)
  if (event._tag === "IntegratorRunResultRecorded") return projectHistoricalRunResult(record, event, context)
  if (event._tag === "IntegratorRunCandidateGitReadIntended")
    return projectHistoricalCandidateIntent(record, event, context)
  return projectHistoricalCandidateObserved(record, event, context)
}

type HistoricalPromotionRequestedEvent = Extract<HistoricalPromotionEvent, { readonly _tag: "TargetPromotionIntended" }>
type HistoricalPromotionAttemptEvent = Extract<
  HistoricalPromotionEvent,
  { readonly _tag: "TargetPromotionAttemptIntended" }
>
type HistoricalPromotionSuccessEvent = Extract<
  HistoricalPromotionEvent,
  { readonly _tag: "TargetPromotionObservedSuccess" }
>
type HistoricalPromotionStaleEvent = Extract<HistoricalPromotionEvent, { readonly _tag: "TargetPromotionStale" }>
type HistoricalPromotionNonConvergenceEvent = Extract<
  HistoricalPromotionEvent,
  { readonly _tag: "TargetPromotionNonConvergence" }
>

const projectHistoricalPromotionRequested = (
  record: JournalRecord,
  event: HistoricalPromotionRequestedEvent,
  context: HistoricalProjectionContext
): HistoricalProjectionResult => {
  const candidate = event.correlation.qualifiedCandidate
  const candidateObserved = context.occurrences.some(
    (occurrence) =>
      occurrence._tag === "IntegratorCandidateQualificationObserved" &&
      occurrence.candidateText === candidate.candidateText &&
      Schema.toEquivalence(IntegratorRunCorrelation)(occurrence.originatingActionRun, candidate.run) &&
      occurrence.recordedAt < record.position
  )
  const preparedResult = context.occurrences.some(
    (occurrence) =>
      occurrence._tag === "IntegratorRunResultRecorded" &&
      occurrence.result._tag === "PreparedCandidate" &&
      occurrence.result.candidateText === candidate.candidateText &&
      Schema.toEquivalence(IntegratorRunCorrelation)(occurrence.run, candidate.run) &&
      occurrence.recordedAt < record.position
  )
  if (!candidateObserved || !preparedResult) {
    return historicalFailure(
      record,
      "promotion " + event.correlation.requestId + " has no candidate qualification observation"
    )
  }
  if (context.promotionIntents.has(event.correlation.requestId)) {
    return historicalFailure(record, "duplicate promotion intent " + event.correlation.requestId)
  }
  context.promotionIntents.set(event.correlation.requestId, event)
  return Effect.succeed(
    TargetPromotionRequested.make({
      correlation: event.correlation,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      recordedAt: record.position,
      runId: record.runId
    })
  )
}

const projectHistoricalPromotionAttempt = (
  record: JournalRecord,
  event: HistoricalPromotionAttemptEvent,
  context: HistoricalProjectionContext
): HistoricalProjectionResult => {
  const intent = context.promotionIntents.get(event.correlation.requestId)
  if (intent === undefined || !targetPromotionCorrelationEquals(intent.correlation, event.correlation)) {
    return historicalFailure(
      record,
      "promotion attempt " + event.correlation.requestId + " has no exact promotion intent"
    )
  }
  const attemptKey = promotionAttemptKey(event.correlation.requestId, event.attemptOrdinal)
  if (context.promotionAttemptIntents.has(attemptKey)) {
    return historicalFailure(record, "duplicate promotion attempt " + attemptKey)
  }
  context.promotionAttemptIntents.set(attemptKey, event)
  return Effect.succeed(
    TargetPromotionAttemptRequested.make({
      attemptOrdinal: event.attemptOrdinal,
      correlation: event.correlation,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      reason: event.reason,
      recordedAt: record.position,
      runId: record.runId
    })
  )
}

const promotionAttemptIsRecorded = (
  context: HistoricalProjectionContext,
  requestId: string,
  attemptOrdinal: number
): boolean => context.promotionAttemptIntents.has(promotionAttemptKey(requestId, attemptOrdinal))

const promotionTerminalIntentIsValid = (
  context: HistoricalProjectionContext,
  requestId: string,
  basis: { readonly _tag: "BeforeFirstAttempt" } | { readonly _tag: "AfterAttempt"; readonly attemptOrdinal: number }
): boolean =>
  basis._tag === "BeforeFirstAttempt" || promotionAttemptIsRecorded(context, requestId, basis.attemptOrdinal)

const projectHistoricalPromotionSuccess = (
  record: JournalRecord,
  event: HistoricalPromotionSuccessEvent,
  context: HistoricalProjectionContext
): HistoricalProjectionResult => {
  const intent = context.promotionIntents.get(event.correlation.requestId)
  if (intent === undefined || !targetPromotionCorrelationEquals(intent.correlation, event.correlation)) {
    return historicalFailure(
      record,
      "promotion success " + event.correlation.requestId + " has no exact promotion intent"
    )
  }
  if (!promotionTerminalIntentIsValid(context, event.correlation.requestId, event.basis)) {
    return historicalFailure(
      record,
      "promotion success " + event.correlation.requestId + " has no exact attempt intent"
    )
  }
  return Effect.succeed(
    TargetPromotionSucceeded.make({
      basis: event.basis,
      correlation: event.correlation,
      occurrenceClassification: "NonActionOccurrence",
      observation: event.observation,
      recordedAt: record.position,
      runId: record.runId
    })
  )
}

const projectHistoricalPromotionStale = (
  record: JournalRecord,
  event: HistoricalPromotionStaleEvent,
  context: HistoricalProjectionContext
): HistoricalProjectionResult => {
  const intent = context.promotionIntents.get(event.correlation.requestId)
  if (intent === undefined || !targetPromotionCorrelationEquals(intent.correlation, event.correlation)) {
    return historicalFailure(
      record,
      "promotion stale result " + event.correlation.requestId + " has no exact promotion intent"
    )
  }
  if (!promotionTerminalIntentIsValid(context, event.correlation.requestId, event.basis)) {
    return historicalFailure(
      record,
      "promotion stale result " + event.correlation.requestId + " has no exact attempt intent"
    )
  }
  return Effect.succeed(
    TargetPromotionStale.make({
      basis: event.basis,
      correlation: event.correlation,
      occurrenceClassification: "NonActionOccurrence",
      observation: event.observation,
      recordedAt: record.position,
      runId: record.runId
    })
  )
}

const projectHistoricalPromotionNonConvergence = (
  record: JournalRecord,
  event: HistoricalPromotionNonConvergenceEvent,
  context: HistoricalProjectionContext
): HistoricalProjectionResult => {
  const intent = context.promotionIntents.get(event.correlation.requestId)
  if (intent === undefined || !targetPromotionCorrelationEquals(intent.correlation, event.correlation)) {
    return historicalFailure(
      record,
      "promotion non-convergence " + event.correlation.requestId + " has no exact promotion intent"
    )
  }
  if (
    event.attemptOrdinal !== event.attemptLimit ||
    !promotionAttemptIsRecorded(context, event.correlation.requestId, event.attemptOrdinal)
  ) {
    return historicalFailure(
      record,
      "promotion non-convergence " + event.correlation.requestId + " has no exact attempt intent"
    )
  }
  return Effect.succeed(
    TargetPromotionNonConvergent.make({
      attemptLimit: event.attemptLimit,
      attemptOrdinal: event.attemptOrdinal,
      correlation: event.correlation,
      lastObservation: event.lastObservation,
      occurrenceClassification: "NonActionOccurrence",
      recordedAt: record.position,
      runId: record.runId
    })
  )
}

const projectHistoricalPromotion = (
  record: JournalRecord,
  event: HistoricalPromotionEvent,
  context: HistoricalProjectionContext
): HistoricalProjectionResult => {
  if (event._tag === "TargetPromotionIntended") return projectHistoricalPromotionRequested(record, event, context)
  if (event._tag === "TargetPromotionAttemptIntended") return projectHistoricalPromotionAttempt(record, event, context)
  if (event._tag === "TargetPromotionObservedSuccess") return projectHistoricalPromotionSuccess(record, event, context)
  if (event._tag === "TargetPromotionStale") return projectHistoricalPromotionStale(record, event, context)
  return projectHistoricalPromotionNonConvergence(record, event, context)
}

const projectHistoricalBoundary = (
  record: JournalRecord,
  event: HistoricalBoundaryEvent
): HistoricalProjectionResult => {
  if (event._tag === "IntegrationQuarantined") {
    return Effect.succeed(
      IntegrationQuarantined.make({
        basis: event.basis,
        correlation: event.correlation,
        occurrenceClassification: "NonActionOccurrence",
        recordedAt: record.position,
        runId: record.runId
      })
    )
  }
  if (event._tag === "IntegrationProviderRunActivityAbsent") {
    return Effect.succeed(
      IntegrationProviderRunActivityAbsent.make({
        correlation: event.correlation,
        detail: event.detail,
        occurrenceClassification: "NonActionOccurrence",
        recordedAt: record.position,
        run: event.run,
        runId: record.runId
      })
    )
  }
  return Effect.succeed(
    IntegrationQuarantineDirectionApplied.make({
      fingerprint: event.fingerprint,
      initiatedBy: event.initiatedBy,
      occurrenceClassification: event.occurrenceClassification,
      recordedAt: record.position,
      requestId: event.requestId,
      runId: record.runId
    })
  )
}

const projectHistoricalFinalityStep = (
  record: JournalRecord,
  event: HistoricalFinalityStepEvent
): HistoricalProjectionResult => {
  if (isHistoricalFocusedCompletionJournalEvent(event)) {
    return Effect.succeed(
      IntegrationFocusedCompletionOccurred.make({
        event,
        occurrenceClassification: "NonActionOccurrence",
        recordedAt: record.position,
        runId: record.runId
      })
    )
  }
  if (isHistoricalClaimReplacementJournalEvent(event)) {
    return Effect.succeed(
      IntegrationClaimReplacementOccurred.make({
        event,
        occurrenceClassification: "NonActionOccurrence",
        recordedAt: record.position,
        runId: record.runId
      })
    )
  }
  if (isHistoricalClaimDeletionJournalEvent(event)) {
    return Effect.succeed(
      IntegrationClaimDeletionOccurred.make({
        event,
        occurrenceClassification: "NonActionOccurrence",
        recordedAt: record.position,
        runId: record.runId
      })
    )
  }
  return Effect.succeed(
    IntegrationFinalitySettledOccurred.make({
      event,
      occurrenceClassification: "NonActionOccurrence",
      recordedAt: record.position,
      runId: record.runId
    })
  )
}

const projectHistoricalOccurrence = (
  record: JournalRecord,
  event: HistoricalJournalEvent,
  context: HistoricalProjectionContext
): HistoricalProjectionResult => {
  if (isHistoricalTaskClaimEvent(event)) return projectHistoricalTaskClaim(record, event, context)
  if (isHistoricalAttemptWorktreeEvent(event)) return projectHistoricalAttemptWorktree(record, event, context)
  if (isHistoricalIntegratorEvent(event)) return projectHistoricalIntegrator(record, event, context)
  if (isHistoricalPromotionEvent(event)) return projectHistoricalPromotion(record, event, context)
  if (isHistoricalBoundaryEvent(event)) return projectHistoricalBoundary(record, event)
  if (isHistoricalFinalityStepEvent(event)) return projectHistoricalFinalityStep(record, event)
  return Effect.void
}
type TrackerReadIntentJournalEvent = Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerReadIntentRecorded" }>
type GitReadIntentJournalEvent = Extract<WorkflowJournalEvent, { readonly _tag: "GitReadIntentRecorded" }>
type GitObservationJournalEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "PlannedAttemptWorktreeObserved" | "TargetLineageObserved" }
>

const gitObservationJournalEventTags = {
  PlannedAttemptWorktreeObserved: true,
  TargetLineageObserved: true
} satisfies Record<GitObservationJournalEvent["_tag"], true>

const isGitObservationJournalEvent = (event: WorkflowJournalEvent): event is GitObservationJournalEvent =>
  Object.hasOwn(gitObservationJournalEventTags, event._tag)

type ProjectionContext = {
  readonly occurrences: Array<WorkflowOccurrence>
  readonly trackerReadIntents: Map<string, TrackerReadIntentJournalEvent>
  readonly gitReadIntents: Map<string, GitReadIntentJournalEvent>
  readonly executorResponsibilities: Set<string>
}

type ProjectionError =
  | TrackerOutcomeWithoutReadIntent
  | GitOutcomeWithoutReadIntent
  | ExecutorReportWithoutResponsibilityBegan

const projectTrackerReadIntent = (
  record: JournalRecord,
  event: TrackerReadIntentJournalEvent,
  trackerReadIntents: Map<string, TrackerReadIntentJournalEvent>
): TaskTrackerReadInitiated => {
  trackerReadIntents.set(relationshipKey(record.runId, event.operation.operationId), event)
  return TaskTrackerReadInitiated.make({
    initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
    occurrenceClassification: "InitiatedAction",
    operation: event.operation,
    recordedAt: record.position,
    runId: record.runId
  })
}

const projectGitReadIntent = (
  record: JournalRecord,
  event: GitReadIntentJournalEvent,
  gitReadIntents: Map<string, GitReadIntentJournalEvent>
): GitReadInitiated => {
  gitReadIntents.set(relationshipKey(record.runId, event.operation.operationId), event)
  return GitReadInitiated.make({
    initiatedBy: event.initiatedBy,
    occurrenceClassification: event.occurrenceClassification,
    operation: event.operation,
    recordedAt: record.position,
    runId: record.runId
  })
}

const projectGitObservation = (
  record: JournalRecord,
  event: GitObservationJournalEvent,
  gitReadIntents: ReadonlyMap<string, GitReadIntentJournalEvent>
): Effect.Effect<WorkflowOccurrence, GitOutcomeWithoutReadIntent> =>
  Match.valueTags(event, {
    PlannedAttemptWorktreeObserved: (value) => {
      const intent = gitReadIntents.get(relationshipKey(record.runId, value.operationId))
      if (intent?.operation._tag !== "ReadTaskWorktree") {
        return Effect.fail(
          new GitOutcomeWithoutReadIntent({
            operationId: value.operationId,
            position: record.position,
            runId: record.runId
          })
        )
      }
      return Effect.succeed(
        PlannedAttemptWorktreeObserved.make({
          observation: value.observation,
          occurrenceClassification: value.occurrenceClassification,
          originatingActionOperationId: value.operationId,
          recordedAt: record.position,
          runId: record.runId
        })
      )
    },
    TargetLineageObserved: (value) => {
      const intent = gitReadIntents.get(relationshipKey(record.runId, value.operationId))
      if (intent?.operation._tag !== "ReadTargetLineage") {
        return Effect.fail(
          new GitOutcomeWithoutReadIntent({
            operationId: value.operationId,
            position: record.position,
            runId: record.runId
          })
        )
      }
      return Effect.succeed(
        TargetLineageObserved.make({
          observation: value.observation,
          occurrenceClassification: value.occurrenceClassification,
          originatingActionOperationId: value.operationId,
          plannedAttempt: value.plannedAttempt,
          recordedAt: record.position,
          runId: record.runId
        })
      )
    }
  })

const projectTrackerFactsObservation = (
  record: JournalRecord,
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" }>,
  trackerReadIntents: ReadonlyMap<string, TrackerReadIntentJournalEvent>
): Effect.Effect<TaskTrackerFactsObserved, TrackerOutcomeWithoutReadIntent> => {
  const intent = trackerReadIntents.get(relationshipKey(record.runId, event.operationId))
  if (intent === undefined) {
    return Effect.fail(
      new TrackerOutcomeWithoutReadIntent({
        operationId: event.operationId,
        position: record.position,
        runId: record.runId
      })
    )
  }
  return Effect.succeed(
    TaskTrackerFactsObserved.make({
      evidence: event.observation,
      occurrenceClassification: "NonActionOccurrence",
      originatingActionOperationId: event.operationId,
      recordedAt: record.position,
      runId: record.runId
    })
  )
}

const projectExecutorReport = (
  record: JournalRecord,
  event: Extract<WorkflowJournalEvent, { readonly _tag: "PlannedAttemptExecutorWorkReported" }>,
  executorResponsibilities: ReadonlySet<string>
): Effect.Effect<PlannedAttemptExecutorWorkReported, ExecutorReportWithoutResponsibilityBegan> => {
  if (!executorResponsibilities.has(relationshipKey(record.runId, event.report.correlation.attemptId))) {
    return Effect.fail(
      new ExecutorReportWithoutResponsibilityBegan({
        attemptId: event.report.correlation.attemptId,
        position: record.position,
        runId: record.runId
      })
    )
  }
  return Effect.succeed(
    PlannedAttemptExecutorWorkReported.make({
      occurrenceClassification: "NonActionOccurrence",
      ordinal: event.ordinal,
      recordedAt: record.position,
      report: event.report,
      runId: record.runId
    })
  )
}

const exactTaskFactsRestartIntentMatches = (
  intent: TrackerReadIntentJournalEvent | undefined,
  event: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptRestartAuthorityReadFailed" }>
): boolean => {
  if (intent === undefined) return false
  const operation = intent.operation
  return (
    event.failure._tag === "AttemptRestartTaskFactsReadFailure" &&
    ((operation._tag === "ReadTrackerGraph" &&
      operation.readShape.explicitlyCoveredTaskIds.includes(event.subject.plannedAttempt.taskId)) ||
      (operation._tag === "ReadTaskWorkSpecification" && operation.taskId === event.subject.plannedAttempt.taskId)) &&
    taskTrackerTargetKey(operation.target) === taskTrackerTargetKey(event.failure.target)
  )
}

const exactGitRestartIntentMatches = (
  intent: GitReadIntentJournalEvent | undefined,
  event: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptRestartAuthorityReadFailed" }>
): boolean => {
  if (
    intent === undefined ||
    !plannedTaskAttemptEquivalence(intent.operation.plannedAttempt, event.subject.plannedAttempt)
  ) {
    return false
  }
  return event.failure._tag === "GitWorktreeReadFailure"
    ? intent.operation._tag === "ReadTaskWorktree"
    : event.failure._tag === "GitTargetLineageReadFailure" &&
        intent.operation._tag === "ReadTargetLineage" &&
        intent.operation.integrationTarget.repository === event.failure.target.repository &&
        intent.operation.integrationTarget.ref === event.failure.target.ref
}

const restartFailureHasExactReadIntent = (
  record: JournalRecord,
  event: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptRestartAuthorityReadFailed" }>,
  trackerReadIntents: ReadonlyMap<string, TrackerReadIntentJournalEvent>,
  gitReadIntents: ReadonlyMap<string, GitReadIntentJournalEvent>
): boolean => {
  const relationship = relationshipKey(record.runId, event.operationId)
  return (
    exactTaskFactsRestartIntentMatches(trackerReadIntents.get(relationship), event) ||
    exactGitRestartIntentMatches(gitReadIntents.get(relationship), event)
  )
}

const projectRestartFailure = (
  record: JournalRecord,
  event: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptRestartAuthorityReadFailed" }>,
  trackerReadIntents: ReadonlyMap<string, TrackerReadIntentJournalEvent>,
  gitReadIntents: ReadonlyMap<string, GitReadIntentJournalEvent>
): Effect.Effect<AttemptRestartAuthorityReadFailed, TrackerOutcomeWithoutReadIntent | GitOutcomeWithoutReadIntent> => {
  if (!restartFailureHasExactReadIntent(record, event, trackerReadIntents, gitReadIntents)) {
    const Failure =
      event.failure._tag === "AttemptRestartTaskFactsReadFailure"
        ? TrackerOutcomeWithoutReadIntent
        : GitOutcomeWithoutReadIntent
    return Effect.fail(new Failure({ operationId: event.operationId, position: record.position, runId: record.runId }))
  }
  return Effect.succeed(
    AttemptRestartAuthorityReadFailed.make({
      failure: event.failure,
      occurrenceClassification: event.occurrenceClassification,
      originatingActionOperationId: event.operationId,
      recordedAt: record.position,
      requestId: event.requestId,
      runId: record.runId,
      subject: event.subject
    })
  )
}

const projectJournalRecord = (
  record: JournalRecord,
  context: ProjectionContext
): Effect.Effect<WorkflowOccurrence | void, ProjectionError> => {
  const event = record.event
  if (isDirectlyProjectedJournalEvent(event)) {
    projectDirectOccurrence(record, event, context.executorResponsibilities, context.occurrences)
    return Effect.void
  }
  if (event._tag === "TaskTrackerReadIntentRecorded") {
    return Effect.succeed(projectTrackerReadIntent(record, event, context.trackerReadIntents))
  }
  if (event._tag === "GitReadIntentRecorded") {
    return Effect.succeed(projectGitReadIntent(record, event, context.gitReadIntents))
  }
  if (isGitObservationJournalEvent(event)) return projectGitObservation(record, event, context.gitReadIntents)
  if (event._tag === "AttemptRestartAuthorityReadFailed") {
    return projectRestartFailure(record, event, context.trackerReadIntents, context.gitReadIntents)
  }
  if (event._tag === "TaskTrackerFactsObserved") {
    return projectTrackerFactsObservation(record, event, context.trackerReadIntents)
  }
  if (event._tag === "PlannedAttemptExecutorWorkReported") {
    return projectExecutorReport(record, event, context.executorResponsibilities)
  }
  void noOccurrence(event)
  return Effect.void
}

/**
 * Projects immutable journal records in one pass. Missing relationships fail
 * before any partial semantic projection becomes visible.
 */
export const projectWorkflowOccurrences = Effect.fn("WorkflowOccurrence.project")(function* (
  records: ReadonlyArray<JournalRecord>
) {
  const occurrences: Array<WorkflowOccurrence> = []
  const context: ProjectionContext = {
    executorResponsibilities: new Set<string>(),
    gitReadIntents: new Map<string, GitReadIntentJournalEvent>(),
    occurrences,
    trackerReadIntents: new Map<string, TrackerReadIntentJournalEvent>()
  }

  const historicalContext: HistoricalProjectionContext = {
    ...context,
    integratorCandidateIntents: new Map<string, IntegratorCandidateIntentJournalEvent>(),
    integratorRunStarts: new Map<string, IntegratorRunStartedJournalEvent>(),
    integratorSessions: new Map<string, IntegratorSessionJournalEvent>(),
    promotionAttemptIntents: new Map<string, TargetPromotionAttemptIntendedEvent>(),
    promotionIntents: new Map<string, TargetPromotionIntendedEvent>(),
    taskClaimAcquisitionIntents: new Map<string, TaskClaimAcquisitionJournalEvent>(),
    taskClaimReleaseIntents: new Map<string, TaskClaimReleaseJournalEvent>(),
    taskWorktreeIntents: new Map<string, typeof WorkflowOperation.cases.ReconcileTaskWorktree.Type>()
  }

  for (const record of records) {
    const occurrence = isHistoricalJournalEvent(record.event)
      ? yield* projectHistoricalOccurrence(record, record.event, historicalContext)
      : yield* projectJournalRecord(record, context)
    if (occurrence !== undefined) occurrences.push(occurrence)
  }

  return yield* Schema.decodeUnknownEffect(WorkflowOccurrenceProjection)({
    occurrences,
    version: workflowOccurrenceProjectionVersion
  })
})

/** Follows only the exact operation relationship carried by the observation. */
export const originatingActionForTrackerObservation = (
  projection: WorkflowOccurrenceProjection,
  observation: TaskTrackerFactsObserved
): Option.Option<TaskTrackerReadInitiated> =>
  Option.fromUndefinedOr(projection.occurrences.find(isOriginatingActionFor(observation)))

/** Follows only the exact operation relationship carried by the Git observation. */
export const originatingActionForPlannedAttemptWorktreeObservation = (
  projection: WorkflowOccurrenceProjection,
  observation: PlannedAttemptWorktreeObserved
): Option.Option<GitReadInitiated> =>
  Option.fromUndefinedOr(projection.occurrences.find(isOriginatingGitReadFor(observation)))

/** Follows only the exact operation relationship carried by the target-lineage observation. */
export const originatingActionForTargetLineageObservation = (
  projection: WorkflowOccurrenceProjection,
  observation: TargetLineageObserved
): Option.Option<GitReadInitiated> =>
  Option.fromUndefinedOr(projection.occurrences.find(isOriginatingGitReadFor(observation)))

/** Follows one report to the exact Dalph responsibility that preceded it. */
export const plannedAttemptExecutorResponsibilityForReport = (
  projection: WorkflowOccurrenceProjection,
  report: PlannedAttemptExecutorWorkReported
): Option.Option<PlannedAttemptExecutorWorkResponsibilityBegan> =>
  Option.fromUndefinedOr(projection.occurrences.find(isExecutorResponsibilityFor(report)))
