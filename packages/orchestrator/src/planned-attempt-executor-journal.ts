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

/** Records Dalph's intent before it first asks the executor to work on the attempt. */
export const PlannedAttemptExecutorWorkStartedEvent = Schema.TaggedStruct(
  "PlannedAttemptExecutorWorkStarted",
  {
    plannedAttempt: PlannedTaskAttempt,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** Records the executor's latest complete-attempt report after the boundary returns. */
export const PlannedAttemptExecutorWorkReportedEvent = Schema.TaggedStruct(
  "PlannedAttemptExecutorWorkReported",
  {
    ordinal: PlannedAttemptExecutorReportOrdinal,
    report: PlannedAttemptExecutorReport,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

export const PlannedAttemptExecutorJournalEvent = Schema.Union([
  PlannedAttemptExecutorWorkStartedEvent,
  PlannedAttemptExecutorWorkReportedEvent
])
export type PlannedAttemptExecutorJournalEvent = typeof PlannedAttemptExecutorJournalEvent.Type
