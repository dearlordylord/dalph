import { Schema } from "effect"

/** Identifies one durable workflow-journal-history fact within a run. */
export const JournalRecordKey = Schema.NonEmptyString.pipe(Schema.brand("JournalRecordKey"))
export type JournalRecordKey = typeof JournalRecordKey.Type

/** Orders committed journal facts within one run, starting at one. */
export const JournalPosition = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(Schema.brand("JournalPosition"))
export type JournalPosition = typeof JournalPosition.Type

/** Locates Dalph's SQLite workflow journal, not a worktree or fixture. */
export const JournalDatabaseLocator = Schema.NonEmptyString.pipe(Schema.brand("JournalDatabaseLocator"))
export type JournalDatabaseLocator = typeof JournalDatabaseLocator.Type

/** Identifies an on-disk journal schema generation; zero means uninitialized. */
export const JournalSchemaVersion = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("JournalSchemaVersion")
)
export type JournalSchemaVersion = typeof JournalSchemaVersion.Type

/**
 * Records the physical storage provenance of one durable workflow-journal
 * history. It is not workflow state and does not prove that Hot history owns
 * live recovery work or that Cold history is complete.
 */
export const JournalPartition = Schema.Literals(["Hot", "Cold"])
export type JournalPartition = typeof JournalPartition.Type
