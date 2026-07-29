import { Schema } from "effect"
import { PlannedTaskAttempt } from "./domain.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import { PlannedAttemptExecutorReport } from "./planned-attempt-executor.js"

/** Orders durable executor reports for one planned attempt without identifying executor work. */
export const PlannedAttemptExecutorReportOrdinal = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThan(0)),
  Schema.brand("PlannedAttemptExecutorReportOrdinal")
)
export type PlannedAttemptExecutorReportOrdinal = typeof PlannedAttemptExecutorReportOrdinal.Type

/**
 * Records that Dalph assumed responsibility for the exact attempt before it
 * first asks the executor to work. It does not prove executor activity.
 */
export const PlannedAttemptExecutorWorkResponsibilityBeganEvent = Schema.TaggedStruct(
  "PlannedAttemptExecutorWorkResponsibilityBegan",
  { plannedAttempt: PlannedTaskAttempt, version: Schema.Literal(workflowJournalEventVersion) }
)

/** Records the executor's latest complete-attempt report after the boundary returns. */
export const PlannedAttemptExecutorWorkReportedEvent = Schema.TaggedStruct("PlannedAttemptExecutorWorkReported", {
  ordinal: PlannedAttemptExecutorReportOrdinal,
  report: PlannedAttemptExecutorReport,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const PlannedAttemptExecutorJournalEvent = Schema.Union([
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  PlannedAttemptExecutorWorkReportedEvent
])
export type PlannedAttemptExecutorJournalEvent = typeof PlannedAttemptExecutorJournalEvent.Type
