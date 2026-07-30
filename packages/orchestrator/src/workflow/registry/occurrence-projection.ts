/* eslint-disable functional/immutable-data -- Projection indexes and accumulation are private scratch. */
import { Effect, Option, Schema } from "effect"
import { AttemptId, PlannedTaskAttempt, RunId, TaskId, PlannedAttemptExecutorReport } from "@dalph/contracts"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "./event.js"
import { PlannedAttemptExecutorReportOrdinal } from "../protocols/planned-attempt-executor-work/events.js"
import { TaskTrackerFactsObservation } from "../task-tracker-facts/observation.js"
import { taskTrackerObservationMatchesRead } from "../task-tracker-facts/observation-match.js"
import { WorkflowOperation } from "./operation.js"
import { WorkflowActor } from "./actor.js"
import { TaskWorkCapacity } from "../../coordination/admission/capacity.js"
import { RunPolicyRevision } from "../../control/policy.js"
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

export const ControlDirectionSubject = Schema.TaggedUnion({
  Run: { runId: RunId },
  Task: { runId: RunId, taskId: TaskId }
})
export type ControlDirectionSubject = typeof ControlDirectionSubject.Type

/**
 * Operator applied one Pause or Unpause direction. Receiving the request is
 * not this event, and V1 records no operator identity.
 */
export const AppliedControlDirection = Schema.TaggedStruct("AppliedControlDirection", {
  direction: Schema.Literals(["Pause", "Unpause"]),
  initiatedBy: WorkflowActor.cases.Operator,
  occurrenceClassification: initiatedActionFields.occurrenceClassification,
  subject: ControlDirectionSubject
})
export type AppliedControlDirection = typeof AppliedControlDirection.Type

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
  AppliedControlDirection,
  AppliedTaskWorkCapacity,
  IntegrationResponsibilityBegan,
  IntegrationStarted,
  PlannedAttemptExecutorWorkReported,
  PlannedAttemptExecutorWorkResponsibilityBegan,
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

export const workflowOccurrenceProjectionVersion = 4 as const // eslint-disable-line no-magic-numbers

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
  if (occurrence._tag === "PlannedAttemptExecutorWorkReported") {
    return invalidExecutorRelationship(executorResponsibilities, occurrence, index)
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
      | "TaskWorkCapacityChanged"
      | "TaskTrackerReadIntentRecorded"
      | "TaskTrackerFactsObserved"
  }
>
type NonProjectedJournalEvent = Exclude<WorkflowJournalEvent, ProjectedJournalEvent>

const nonProjectedJournalEventKinds = {
  ControlCommandRecorded: true,
  TaskAttemptPlanned: true,
  TaskClaimAcquired: true,
  TaskClaimAcquisitionIntended: true,
  TaskClaimReleaseIntended: true,
  TaskClaimReleased: true,
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
export class TrackerOutcomeWithoutReadIntent extends Schema.TaggedErrorClass<TrackerOutcomeWithoutReadIntent>()(
  "TrackerOutcomeWithoutReadIntent",
  { operationId: OperationId, position: JournalPosition, runId: RunId }
) {}

/** An executor report cannot prove which Dalph responsibility preceded it. */
export class ExecutorReportWithoutResponsibilityBegan extends Schema.TaggedErrorClass<ExecutorReportWithoutResponsibilityBegan>()(
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
  }
>

const isDirectlyProjectedJournalEvent = (event: WorkflowJournalEvent): event is DirectlyProjectedJournalEvent =>
  event._tag === "IntegrationResponsibilityBegan" ||
  event._tag === "IntegrationStarted" ||
  event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ||
  event._tag === "TaskWorkCapacityChanged"

const projectDirectOccurrence = (
  record: JournalRecord,
  event: DirectlyProjectedJournalEvent,
  executorResponsibilities: Set<string>,
  occurrences: Array<WorkflowOccurrence>
): void => {
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
export const projectWorkflowOccurrences = Effect.fn("WorkflowOccurrence.project")(function* (
  records: ReadonlyArray<JournalRecord>
) {
  const occurrences: Array<WorkflowOccurrence> = []
  const trackerReadIntents = new Map<
    string,
    Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerReadIntentRecorded" }>
  >()
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

/** Follows one report to the exact Dalph responsibility that preceded it. */
export const plannedAttemptExecutorResponsibilityForReport = (
  projection: WorkflowOccurrenceProjection,
  report: PlannedAttemptExecutorWorkReported
): Option.Option<PlannedAttemptExecutorWorkResponsibilityBegan> =>
  Option.fromUndefinedOr(projection.occurrences.find(isExecutorResponsibilityFor(report)))
