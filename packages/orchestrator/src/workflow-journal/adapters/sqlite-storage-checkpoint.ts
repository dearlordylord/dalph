import type { RunId } from "@dalph/contracts"
import { HashMap } from "effect"
import type { JournalPosition, JournalRecordKey } from "../identity.js"
import type { JournalRecord } from "../store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"

/**
 * Process-local evidence that one SQLite connection decoded every immutable
 * row in one Run partition through an exact position. It is neither durable
 * workflow state nor reusable after that connection's ownership interval.
 */
interface SqliteStorageCheckpointFields {
  readonly decodedThrough: JournalPosition | undefined
  readonly recordsByKey: HashMap.HashMap<JournalRecordKey, SqliteStorageRecordEvidence>
  readonly runId: RunId
}

export interface SqliteHotStorageCheckpoint extends SqliteStorageCheckpointFields {
  readonly partition: "Hot"
  readonly terminalPosition: JournalPosition | undefined
}

interface SqliteColdStorageCheckpoint extends SqliteStorageCheckpointFields {
  readonly decodedThrough: JournalPosition
  readonly partition: "Cold"
  readonly terminalPosition: JournalPosition
}

export type SqliteStorageCheckpoint = SqliteHotStorageCheckpoint | SqliteColdStorageCheckpoint

/** Exact persisted content and position established while building a checkpoint. */
interface SqliteStorageRecordEvidence {
  readonly event: WorkflowJournalEvent
  readonly position: JournalPosition
}

export interface SqlitePartitionSnapshot {
  readonly checkpoint: SqliteStorageCheckpoint
  readonly records: ReadonlyArray<JournalRecord>
}

/** Rebuilds an ordered read view from rows already proved by this exclusive connection. */
export const snapshotFromSqliteStorageCheckpoint = (checkpoint: SqliteStorageCheckpoint): SqlitePartitionSnapshot => ({
  checkpoint,
  records: Array.from(HashMap.entries(checkpoint.recordsByKey), ([key, evidence]) => ({
    event: evidence.event,
    key,
    position: evidence.position,
    runId: checkpoint.runId
  })).toSorted((left, right) => left.position - right.position)
})

export const appendSqliteStorageCheckpoint = (
  checkpoint: SqliteHotStorageCheckpoint,
  record: JournalRecord
): SqliteHotStorageCheckpoint => ({
  decodedThrough: record.position,
  partition: checkpoint.partition,
  recordsByKey: HashMap.set(checkpoint.recordsByKey, record.key, { event: record.event, position: record.position }),
  runId: checkpoint.runId,
  terminalPosition: record.event._tag === "WorkflowRunTerminated" ? record.position : checkpoint.terminalPosition
})
