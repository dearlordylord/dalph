import { Schema } from "effect"
import { PlannedTaskAttempt, PlannedAttemptExecutorReport } from "@dalph/contracts"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"

/** Orders durable executor commands for one immutable planned attempt. */
export const PlannedAttemptExecutorCommandOrdinal = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThan(0)),
  Schema.brand("PlannedAttemptExecutorCommandOrdinal")
)
export type PlannedAttemptExecutorCommandOrdinal = typeof PlannedAttemptExecutorCommandOrdinal.Type

/** Orders repeated read-only projections used to reconcile one unmatched command intent. */
export const PlannedAttemptExecutorCommandProjectionOrdinal = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThan(0)),
  Schema.brand("PlannedAttemptExecutorCommandProjectionOrdinal")
)
export type PlannedAttemptExecutorCommandProjectionOrdinal = typeof PlannedAttemptExecutorCommandProjectionOrdinal.Type

/** Durable intent recorded before an executor begin, resume, or suspension request crosses its boundary. */
export const PlannedAttemptExecutorCommandIntendedEvent = Schema.TaggedStruct("PlannedAttemptExecutorCommandIntended", {
  command: Schema.Literals(["Begin", "Resume", "Suspend"]),
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  ordinal: PlannedAttemptExecutorCommandOrdinal,
  plannedAttempt: PlannedTaskAttempt,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type PlannedAttemptExecutorCommandIntendedEvent = typeof PlannedAttemptExecutorCommandIntendedEvent.Type

export const PlannedAttemptExecutorCommandProjectionObservation = Schema.TaggedUnion({
  ExactExecutorReport: { report: PlannedAttemptExecutorReport },
  ExecutorStateNoCurrentReport: {},
  ExecutorStateTemporarilyUnavailable: {},
  ExecutorStateUnreadable: {},
  ExecutorReportContradiction: { observed: PlannedAttemptExecutorReport }
})
export type PlannedAttemptExecutorCommandProjectionObservation =
  typeof PlannedAttemptExecutorCommandProjectionObservation.Type

/** Read-only reconciliation could not yet settle one exact unmatched executor command. */
export const PlannedAttemptExecutorCommandProjectionObservedEvent = Schema.TaggedStruct(
  "PlannedAttemptExecutorCommandProjectionObserved",
  {
    commandOrdinal: PlannedAttemptExecutorCommandOrdinal,
    observation: PlannedAttemptExecutorCommandProjectionObservation,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    plannedAttempt: PlannedTaskAttempt,
    projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type PlannedAttemptExecutorCommandProjectionObservedEvent =
  typeof PlannedAttemptExecutorCommandProjectionObservedEvent.Type

/**
 * Settles one exact command with its direct, correlated boundary response.
 * This is command-response evidence, not acceptance of a lifecycle transition.
 */
export const PlannedAttemptExecutorCommandResponseObservedEvent = Schema.TaggedStruct(
  "PlannedAttemptExecutorCommandResponseObserved",
  {
    commandOrdinal: PlannedAttemptExecutorCommandOrdinal,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    plannedAttempt: PlannedTaskAttempt,
    report: PlannedAttemptExecutorReport,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type PlannedAttemptExecutorCommandResponseObservedEvent =
  typeof PlannedAttemptExecutorCommandResponseObservedEvent.Type

/** The direct response to one exact executor command named another Run or attempt. */
export const PlannedAttemptExecutorCommandResponseContradictedEvent = Schema.TaggedStruct(
  "PlannedAttemptExecutorCommandResponseContradicted",
  {
    commandOrdinal: PlannedAttemptExecutorCommandOrdinal,
    observed: PlannedAttemptExecutorReport,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    plannedAttempt: PlannedTaskAttempt,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type PlannedAttemptExecutorCommandResponseContradictedEvent =
  typeof PlannedAttemptExecutorCommandResponseContradictedEvent.Type

/** Orders durable executor reports for one planned attempt without identifying executor work. */
export const PlannedAttemptExecutorReportOrdinal = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThan(0)),
  Schema.brand("PlannedAttemptExecutorReportOrdinal")
)
export type PlannedAttemptExecutorReportOrdinal = typeof PlannedAttemptExecutorReportOrdinal.Type

/** Orders read-only executor authority observations not owned by an unmatched command. */
export const PlannedAttemptExecutorStateObservationOrdinal = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThan(0)),
  Schema.brand("PlannedAttemptExecutorStateObservationOrdinal")
)
export type PlannedAttemptExecutorStateObservationOrdinal = typeof PlannedAttemptExecutorStateObservationOrdinal.Type

export const PlannedAttemptExecutorStateObservation = Schema.TaggedUnion({
  ExactExecutorReport: { report: PlannedAttemptExecutorReport },
  ExecutorStateNoCurrentReport: {},
  ExecutorStateTemporarilyUnavailable: {},
  ExecutorStateUnreadable: {},
  ExecutorReportContradiction: { observed: PlannedAttemptExecutorReport },
  ExecutorInitialReportCausalityContradiction: { observed: PlannedAttemptExecutorReport },
  ExecutorLifecycleTransitionContradiction: {
    accepted: PlannedAttemptExecutorReport,
    observed: PlannedAttemptExecutorReport
  }
})
export type PlannedAttemptExecutorStateObservation = typeof PlannedAttemptExecutorStateObservation.Type

/** A read-only current-state projection failed to produce an exact correlated executor report. */
export const PlannedAttemptExecutorStateObservedEvent = Schema.TaggedStruct("PlannedAttemptExecutorStateObserved", {
  observation: PlannedAttemptExecutorStateObservation,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  ordinal: PlannedAttemptExecutorStateObservationOrdinal,
  plannedAttempt: PlannedTaskAttempt,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type PlannedAttemptExecutorStateObservedEvent = typeof PlannedAttemptExecutorStateObservedEvent.Type

/** Maximum executor suspension commands Dalph may durably issue for one exact attempt. */
export const PlannedAttemptExecutorSuspensionLimit = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThan(0)),
  Schema.brand("PlannedAttemptExecutorSuspensionLimit")
)
export type PlannedAttemptExecutorSuspensionLimit = typeof PlannedAttemptExecutorSuspensionLimit.Type

const defaultPlannedAttemptExecutorSuspensionLimitValue = 3
export const defaultPlannedAttemptExecutorSuspensionLimit = PlannedAttemptExecutorSuspensionLimit.make(
  defaultPlannedAttemptExecutorSuspensionLimitValue
)

/**
 * Records that Dalph assumed responsibility for the exact attempt before it
 * first asks the executor to work. It does not prove executor activity.
 */
export const PlannedAttemptExecutorWorkResponsibilityBeganEvent = Schema.TaggedStruct(
  "PlannedAttemptExecutorWorkResponsibilityBegan",
  { plannedAttempt: PlannedTaskAttempt, version: Schema.Literal(workflowJournalEventVersion) }
)

/** Accepts one distinct lifecycle transition reported for the exact executor work. */
export const PlannedAttemptExecutorWorkReportedEvent = Schema.TaggedStruct("PlannedAttemptExecutorWorkReported", {
  ordinal: PlannedAttemptExecutorReportOrdinal,
  report: PlannedAttemptExecutorReport,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const PlannedAttemptExecutorJournalEvent = Schema.Union([
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorCommandResponseContradictedEvent,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  PlannedAttemptExecutorWorkReportedEvent
])
export type PlannedAttemptExecutorJournalEvent = typeof PlannedAttemptExecutorJournalEvent.Type
