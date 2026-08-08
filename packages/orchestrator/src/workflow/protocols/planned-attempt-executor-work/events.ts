import { Schema } from "effect"
import { PlannedTaskAttempt, PlannedAttemptExecutorReport } from "@dalph/contracts"
import { workflowJournalEventVersion } from "../../kernel/event.js"

/** Orders durable executor reports for one planned attempt without identifying executor work. */
export const PlannedAttemptExecutorReportOrdinal = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThan(0)),
  Schema.brand("PlannedAttemptExecutorReportOrdinal")
)
export type PlannedAttemptExecutorReportOrdinal = typeof PlannedAttemptExecutorReportOrdinal.Type

/** Maximum accepted executor reports that may authorize start-or-continue calls for one exact attempt. */
export const PlannedAttemptExecutorContinuationLimit = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThan(0)),
  Schema.brand("PlannedAttemptExecutorContinuationLimit")
)
export type PlannedAttemptExecutorContinuationLimit = typeof PlannedAttemptExecutorContinuationLimit.Type

const defaultPlannedAttemptExecutorContinuationLimitValue = 3
export const defaultPlannedAttemptExecutorContinuationLimit = PlannedAttemptExecutorContinuationLimit.make(
  defaultPlannedAttemptExecutorContinuationLimitValue
)

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
