import { Option, Schema } from "effect"
import { OperationId, RunId, TaskId } from "./domain.js"
import type { JournalRecord, WorkflowJournalEvent } from "./journal-store.js"
import { WorkflowOperation } from "./workflow-operation.js"
import { WorkflowOutcome } from "./workflow-outcome.js"

/**
 * An actor variant is present only after an accepted production action earns
 * it. V1 has one human Operator and the Dalph coordinator.
 */
export const WorkflowActor = Schema.TaggedUnion({ DalphCoordinator: {}, Operator: {} })
export type WorkflowActor = typeof WorkflowActor.Type

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
export const TrackerGraphReadInitiated = Schema.TaggedStruct("TrackerGraphReadInitiated", {
  ...initiatedActionFields,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  operation: WorkflowOperation.cases.ReadTrackerGraph,
  runId: RunId
})
export type TrackerGraphReadInitiated = typeof TrackerGraphReadInitiated.Type

/**
 * Dalph observed exact tracker facts through the named read action. The
 * observation does not claim that the read caused those tracker facts.
 */
export const TaskTrackerFactsObserved = Schema.TaggedStruct("TaskTrackerFactsObserved", {
  ...nonActionOccurrenceFields,
  originatingActionOperationId: OperationId,
  outcome: WorkflowOutcome.cases.TrackerGraphObserved,
  runId: RunId
})
export type TaskTrackerFactsObserved = typeof TaskTrackerFactsObserved.Type

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

export const WorkflowOccurrence = Schema.Union([
  AppliedControlDirection,
  TrackerGraphReadInitiated,
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

export const workflowOccurrenceProjectionVersion = 1 as const // eslint-disable-line no-magic-numbers

const isOriginatingActionFor =
  (observation: TaskTrackerFactsObserved) =>
  (occurrence: WorkflowOccurrence): occurrence is TrackerGraphReadInitiated =>
    occurrence._tag === "TrackerGraphReadInitiated" &&
    occurrence.runId === observation.runId &&
    occurrence.operation.operationId === observation.originatingActionOperationId

const missingOriginatingAction = (projection: { readonly occurrences: ReadonlyArray<WorkflowOccurrence> }) => {
  for (const [index, occurrence] of projection.occurrences.entries()) {
    if (occurrence._tag !== "TaskTrackerFactsObserved") continue
    const hasExactAction = projection.occurrences.some(isOriginatingActionFor(occurrence))
    if (!hasExactAction) {
      return {
        issue: `tracker observation has no exact initiating read action ${occurrence.originatingActionOperationId}`,
        path: ["occurrences", index, "originatingActionOperationId"]
      }
    }
  }
  return undefined
}

/** Schema-versioned semantic values intended for production trace consumers. */
export const WorkflowOccurrenceProjection = Schema.Struct({
  occurrences: Schema.Array(WorkflowOccurrence),
  version: Schema.Literal(workflowOccurrenceProjectionVersion)
}).check(Schema.makeFilter(missingOriginatingAction))
export type WorkflowOccurrenceProjection = typeof WorkflowOccurrenceProjection.Type

type ProjectedJournalEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "TrackerGraphObservationIntentRecorded" | "TrackerGraphOutcomeObserved" }
>
type NonProjectedJournalEvent = Exclude<WorkflowJournalEvent, ProjectedJournalEvent>

const nonProjectedJournalEventKinds = {
  ControlCommandRecorded: true,
  PlannedAttemptExecutorWorkReported: true,
  PlannedAttemptExecutorWorkStarted: true,
  TaskAttemptPlanned: true,
  TaskClaimAcquired: true,
  TaskClaimAcquisitionIntended: true,
  TaskWorktreeReady: true,
  TaskWorktreeReconciliationIntended: true
} satisfies Record<NonProjectedJournalEvent["_tag"], true>

const noOccurrence = (event: NonProjectedJournalEvent): ReadonlyArray<WorkflowOccurrence> => {
  void nonProjectedJournalEventKinds[event._tag]
  return []
}

const projectRecord = (record: JournalRecord): ReadonlyArray<WorkflowOccurrence> => {
  const event = record.event
  if (event._tag === "TrackerGraphObservationIntentRecorded") {
    return [
      TrackerGraphReadInitiated.make({
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operation: event.operation,
        runId: record.runId
      })
    ]
  }
  if (event._tag === "TrackerGraphOutcomeObserved") {
    return [
      TaskTrackerFactsObserved.make({
        occurrenceClassification: "NonActionOccurrence",
        originatingActionOperationId: event.operationId,
        outcome: event.outcome,
        runId: record.runId
      })
    ]
  }
  return noOccurrence(event)
}

export const projectWorkflowOccurrences = (records: ReadonlyArray<JournalRecord>): WorkflowOccurrenceProjection =>
  WorkflowOccurrenceProjection.make({
    occurrences: records.flatMap(projectRecord),
    version: workflowOccurrenceProjectionVersion
  })

/** Follows only the exact operation relationship carried by the observation. */
export const originatingActionForTrackerObservation = (
  projection: WorkflowOccurrenceProjection,
  observation: TaskTrackerFactsObserved
): Option.Option<TrackerGraphReadInitiated> =>
  Option.fromUndefinedOr(projection.occurrences.find(isOriginatingActionFor(observation)))
