/* eslint-disable functional/immutable-data, max-lines -- The closed occurrence schema, relationship validation, and journal projection share one exhaustive boundary. */
import { Effect, Option, Schema } from "effect"
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
  PlannedAttemptReplacementWitness
} from "../protocols/attempt-choice/replacement-events.js"
import {
  IntegrationResponsibilityBegan,
  IntegrationStarted,
  invalidIntegrationOccurrenceRelationship,
  projectIntegrationOccurrence
} from "./integration-occurrence.js"
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
  TaskTrackerFactsObserved
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

export const workflowOccurrenceProjectionVersion = 7 as const // eslint-disable-line no-magic-numbers

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

const trackerOperationMatchesRestartFailure = (
  operation: TaskTrackerReadInitiated["operation"],
  occurrence: AttemptRestartAuthorityReadFailed
): boolean => {
  if (occurrence.failure._tag !== "AttemptRestartTaskFactsReadFailure") return false
  const taskId = occurrence.subject.plannedAttempt.taskId
  const coversTask =
    operation._tag === "ReadTrackerGraph"
      ? operation.readShape.explicitlyCoveredTaskIds.includes(taskId)
      : operation._tag === "ReadTaskWorkSpecification" && operation.taskId === taskId
  return coversTask && taskTrackerTargetKey(operation.target) === taskTrackerTargetKey(occurrence.failure.target)
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
  return trackerOperationMatchesRestartFailure(action.operation, occurrence)
}

const isExactEarlierGitReadForRestartFailure =
  (occurrence: AttemptRestartAuthorityReadFailed) =>
  (candidate: WorkflowOccurrence): candidate is GitReadInitiated =>
    candidate._tag === "GitReadInitiated" &&
    candidate.runId === occurrence.runId &&
    candidate.operation.operationId === occurrence.originatingActionOperationId &&
    candidate.recordedAt < occurrence.recordedAt &&
    plannedTaskAttemptEquivalence(candidate.operation.plannedAttempt, occurrence.subject.plannedAttempt)

const gitOperationMatchesRestartFailure = (
  operation: GitReadInitiated["operation"],
  occurrence: AttemptRestartAuthorityReadFailed
): boolean => {
  if (occurrence.failure._tag === "AttemptRestartTaskFactsReadFailure") return false
  if (occurrence.failure._tag === "GitWorktreeReadFailure") {
    return (
      operation._tag === "ReadTaskWorktree" &&
      occurrence.failure.worktree === occurrence.subject.plannedAttempt.worktree
    )
  }
  if (operation._tag !== "ReadTargetLineage") return false
  return [
    occurrence.failure.plannedBaseSha === occurrence.subject.plannedAttempt.baseSha,
    operation.integrationTarget.repository === occurrence.failure.target.repository,
    operation.integrationTarget.ref === occurrence.failure.target.ref
  ].every(Boolean)
}

const exactGitReadForRestartFailure = (
  occurrences: ReadonlyArray<WorkflowOccurrence>,
  occurrence: AttemptRestartAuthorityReadFailed
): boolean => {
  if (occurrence.failure._tag === "AttemptRestartTaskFactsReadFailure") return false
  const actions = occurrences.filter(isExactEarlierGitReadForRestartFailure(occurrence))
  if (actions.length !== 1) return false
  const operation = actions[0]?.operation
  if (operation === undefined) return false
  return gitOperationMatchesRestartFailure(operation, occurrence)
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
  IntegrationCandidateAgentReported: true,
  IntegrationCandidateConstructed: true,
  IntegrationCandidateConstructionIntended: true,
  IntegrationCandidateGitObserved: true,
  IntegrationCandidateGitValidationFailed: true,
  IntegrationCandidateCorrectionLimitReached: true,
  IntegrationCandidateContinuationLimitReached: true,
  TargetVerificationCorrelationContradicted: true,
  TargetVerificationEvidenceSealed: true,
  TargetVerificationIntended: true,
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
  CompletionTaskIntended: true,
  CompletionTaskAttemptIntended: true,
  CompletionTaskAcknowledged: true,
  CompletionTaskResponseLost: true,
  CompletionTaskRejected: true,
  CompletionTaskCandidateAncestryReadIntended: true,
  CompletionTaskCandidateAncestryObserved: true,
  CompletionTaskRequestLookupIntended: true,
  CompletionTaskRequestLookupObserved: true,
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

/**
 * Projects immutable journal records in one pass. Missing relationships fail
 * before any partial semantic projection becomes visible.
 */
// eslint-disable-next-line complexity -- One pass validates relationships while exhaustively projecting the closed event vocabulary.
export const projectWorkflowOccurrences = Effect.fn("WorkflowOccurrence.project")(function* (
  records: ReadonlyArray<JournalRecord>
) {
  const occurrences: Array<WorkflowOccurrence> = []
  const trackerReadIntents = new Map<
    string,
    Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerReadIntentRecorded" }>
  >()
  const gitReadIntents = new Map<string, Extract<WorkflowJournalEvent, { readonly _tag: "GitReadIntentRecorded" }>>()
  const executorResponsibilities = new Set<string>()

  for (const record of records) {
    const event = record.event
    if (isDirectlyProjectedJournalEvent(event)) {
      projectDirectOccurrence(record, event, executorResponsibilities, occurrences)
      continue
    }
    if (event._tag === "TaskTrackerReadIntentRecorded") {
      trackerReadIntents.set(relationshipKey(record.runId, event.operation.operationId), event)
      occurrences.push(
        TaskTrackerReadInitiated.make({
          initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
          occurrenceClassification: "InitiatedAction",
          operation: event.operation,
          recordedAt: record.position,
          runId: record.runId
        })
      )
      continue
    }
    if (event._tag === "GitReadIntentRecorded") {
      gitReadIntents.set(relationshipKey(record.runId, event.operation.operationId), event)
      occurrences.push(
        GitReadInitiated.make({
          initiatedBy: event.initiatedBy,
          occurrenceClassification: event.occurrenceClassification,
          operation: event.operation,
          recordedAt: record.position,
          runId: record.runId
        })
      )
      continue
    }
    if (event._tag === "PlannedAttemptWorktreeObserved") {
      const intent = gitReadIntents.get(relationshipKey(record.runId, event.operationId))
      if (intent?.operation._tag !== "ReadTaskWorktree") {
        return yield* new GitOutcomeWithoutReadIntent({
          operationId: event.operationId,
          position: record.position,
          runId: record.runId
        })
      }
      occurrences.push(
        PlannedAttemptWorktreeObserved.make({
          observation: event.observation,
          occurrenceClassification: event.occurrenceClassification,
          originatingActionOperationId: event.operationId,
          recordedAt: record.position,
          runId: record.runId
        })
      )
      continue
    }
    if (event._tag === "TargetLineageObserved") {
      const intent = gitReadIntents.get(relationshipKey(record.runId, event.operationId))
      if (intent?.operation._tag !== "ReadTargetLineage") {
        return yield* new GitOutcomeWithoutReadIntent({
          operationId: event.operationId,
          position: record.position,
          runId: record.runId
        })
      }
      occurrences.push(
        TargetLineageObserved.make({
          observation: event.observation,
          occurrenceClassification: event.occurrenceClassification,
          originatingActionOperationId: event.operationId,
          plannedAttempt: event.plannedAttempt,
          recordedAt: record.position,
          runId: record.runId
        })
      )
      continue
    }
    if (event._tag === "AttemptRestartAuthorityReadFailed") {
      const relationship = relationshipKey(record.runId, event.operationId)
      const exactTaskFactsIntent = () => {
        const intent = trackerReadIntents.get(relationship)
        if (intent === undefined) return false
        const operation = intent.operation
        return (
          event.failure._tag === "AttemptRestartTaskFactsReadFailure" &&
          ((operation._tag === "ReadTrackerGraph" &&
            operation.readShape.explicitlyCoveredTaskIds.includes(event.subject.plannedAttempt.taskId)) ||
            (operation._tag === "ReadTaskWorkSpecification" &&
              operation.taskId === event.subject.plannedAttempt.taskId)) &&
          taskTrackerTargetKey(operation.target) === taskTrackerTargetKey(event.failure.target)
        )
      }
      const exactGitIntent = () => {
        const intent = gitReadIntents.get(relationship)
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
      if (!exactTaskFactsIntent() && !exactGitIntent()) {
        const Failure =
          event.failure._tag === "AttemptRestartTaskFactsReadFailure"
            ? TrackerOutcomeWithoutReadIntent
            : GitOutcomeWithoutReadIntent
        return yield* new Failure({ operationId: event.operationId, position: record.position, runId: record.runId })
      }
      occurrences.push(
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
      continue
    }
    if (event._tag === "TaskTrackerFactsObserved") {
      const intent = trackerReadIntents.get(relationshipKey(record.runId, event.operationId))
      if (intent === undefined) {
        return yield* new TrackerOutcomeWithoutReadIntent({
          operationId: event.operationId,
          position: record.position,
          runId: record.runId
        })
      }
      occurrences.push(
        TaskTrackerFactsObserved.make({
          evidence: event.observation,
          occurrenceClassification: "NonActionOccurrence",
          originatingActionOperationId: event.operationId,
          recordedAt: record.position,
          runId: record.runId
        })
      )
      continue
    }
    if (event._tag === "PlannedAttemptExecutorWorkReported") {
      if (!executorResponsibilities.has(relationshipKey(record.runId, event.report.correlation.attemptId))) {
        return yield* new ExecutorReportWithoutResponsibilityBegan({
          attemptId: event.report.correlation.attemptId,
          position: record.position,
          runId: record.runId
        })
      }
      occurrences.push(
        PlannedAttemptExecutorWorkReported.make({
          occurrenceClassification: "NonActionOccurrence",
          ordinal: event.ordinal,
          recordedAt: record.position,
          report: event.report,
          runId: record.runId
        })
      )
      continue
    }
    void noOccurrence(event)
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
