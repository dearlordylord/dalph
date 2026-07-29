import { Schema } from "effect"

/** Selects one immutable journal payload decoder. */
export const JournalEventVersion = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("JournalEventVersion")
)
export type JournalEventVersion = typeof JournalEventVersion.Type

/** Names the decoded workflow-event variant duplicated in the physical row. */
export const JournalEventKind = Schema.NonEmptyString.pipe(Schema.brand("JournalEventKind"))
export type JournalEventKind = typeof JournalEventKind.Type

/** Current immutable semantic version shared by every workflow journal event. */
export const workflowJournalEventVersion = 6 as const // eslint-disable-line no-magic-numbers
