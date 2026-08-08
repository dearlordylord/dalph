import { Schema } from "effect"
import { AcceptedResult, IntegrationTarget, PlannedTaskAttempt } from "@dalph/contracts"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"

/**
 * Records exact integration responsibility after the accepted executor result
 * is durable. Its journal envelope position is the responsibility's FIFO
 * position; no queue ordinal is stored.
 */
export const IntegrationResponsibilityBeganEvent = Schema.TaggedStruct("IntegrationResponsibilityBegan", {
  acceptedResult: AcceptedResult,
  integrationTarget: IntegrationTarget,
  plannedAttempt: PlannedTaskAttempt,
  version: Schema.Literal(workflowJournalEventVersion)
})

/**
 * Records the non-cancellable cutoff for one exact queued responsibility.
 * The referenced journal position binds this action to its unique origin.
 */
export const IntegrationStartedEvent = Schema.TaggedStruct("IntegrationStarted", {
  acceptedResult: AcceptedResult,
  integrationTarget: IntegrationTarget,
  plannedAttempt: PlannedTaskAttempt,
  responsibilityBeganAt: JournalPosition,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const IntegrationAdmissionJournalEvent = Schema.Union([
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
])
export type IntegrationAdmissionJournalEvent = typeof IntegrationAdmissionJournalEvent.Type
