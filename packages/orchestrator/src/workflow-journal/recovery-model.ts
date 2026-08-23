import { Schema } from "effect"
import { RunId } from "@dalph/contracts"
import type { JournalRecord } from "./store.js"
import { JournalPartition } from "./identity.js"

/** One physical journal row or versioned payload failed boundary decoding. */
export class JournalBoundaryDecodeIssue extends Schema.TaggedError<JournalBoundaryDecodeIssue>()(
  "JournalBoundaryDecodeIssue",
  {
    detail: Schema.String,
    partition: JournalPartition,
    rowOrdinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    runId: Schema.NullOr(RunId)
  }
) {}

/** A decoded partition history failed canonical semantic reduction. */
export class JournalSemanticIssue extends Schema.TaggedError<JournalSemanticIssue>()("JournalSemanticIssue", {
  detail: Schema.String,
  partition: JournalPartition,
  runId: RunId
}) {}

export const JournalAuditIssue = Schema.Union([JournalBoundaryDecodeIssue, JournalSemanticIssue])
export type JournalAuditIssue = typeof JournalAuditIssue.Type

export interface JournalRunRecords {
  readonly records: ReadonlyArray<JournalRecord>
  readonly runId: RunId
}

/** Complete age-independent journal discovery; invalid rows remain stored and reported. */
export interface JournalScan {
  readonly issues: ReadonlyArray<JournalAuditIssue>
  readonly runs: ReadonlyArray<JournalRunRecords>
}

/** Reports every valid or malformed history in both physical Journal partitions. */
export interface JournalAudit {
  readonly issues: ReadonlyArray<JournalAuditIssue>
  readonly runs: ReadonlyArray<JournalRunRecords & { readonly partition: JournalPartition }>
}
