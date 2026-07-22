import { Schema } from "effect"
import { RunId } from "./domain.js"
import type { JournalRecord } from "./journal-store.js"

/** One physical journal row or versioned payload failed boundary decoding. */
export class JournalBoundaryDecodeIssue extends Schema.TaggedErrorClass<JournalBoundaryDecodeIssue>()(
  "JournalBoundaryDecodeIssue",
  {
    detail: Schema.String,
    rowOrdinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    runId: Schema.NullOr(RunId)
  }
) {}

export interface JournalRunRecords {
  readonly records: ReadonlyArray<JournalRecord>
  readonly runId: RunId
}

/** Complete age-independent journal discovery; invalid rows remain stored and reported. */
export interface JournalScan {
  readonly issues: ReadonlyArray<JournalBoundaryDecodeIssue>
  readonly runs: ReadonlyArray<JournalRunRecords>
}
