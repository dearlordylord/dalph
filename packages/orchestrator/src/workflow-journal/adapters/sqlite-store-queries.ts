/* eslint-disable functional/immutable-data -- Scan accumulation is private adapter scratch and never becomes journal authority. */
import type * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Effect, HashMap, Result, Schema } from "effect"
import type * as SqlError from "effect/unstable/sql/SqlError"
import { RunId } from "@dalph/contracts"
import { JournalEventKind, JournalEventVersion } from "../../workflow/kernel/event.js"
import {
  decodeSqliteJournalEvent as decodeJournalEvent,
  encodeSqliteJournalEvent as encodeJournalEvent
} from "./sqlite-event-codec.js"
import { type JournalPartition, JournalPosition, JournalRecordKey } from "../identity.js"
import { decideJournalPartitionHistory } from "../partition-history.js"
import { JournalBoundaryDecodeIssue, type JournalAudit } from "../recovery-model.js"
import {
  JournalHistoryCorruption,
  JournalPartitionContradiction,
  type JournalRecord,
  type JournalStoreError
} from "../store.js"
import { classifyJournalStorageFailure, decodeBoundary, type StoreOperation } from "./sqlite-store-errors.js"
import type { SqliteHotStorageCheckpoint, SqlitePartitionSnapshot } from "./sqlite-storage-checkpoint.js"
import { type JournalPayloadStringPool, withJournalPayloadStringPool } from "../payload-string-pool.js"

const PersistedJournalRow = Schema.Struct({
  event_kind: JournalEventKind,
  event_version: JournalEventVersion,
  payload_json: Schema.String,
  run_id: RunId,
  position: JournalPosition,
  record_key_hex: Schema.String
})
type PersistedJournalRow = typeof PersistedJournalRow.Type

const PersistedJournalRows = Schema.Array(PersistedJournalRow)
const PersistedRunIdentity = Schema.Struct({ run_id: RunId })
const lastRecordIndex = -1

const historyCorruption = (partition: JournalPartition, runId: RunId, operation: StoreOperation, detail: string) =>
  new JournalHistoryCorruption({ detail, operation, partition, runId })

/** Proves append positions and key uniqueness for already decoded immutable rows. */
interface SqliteDecodedHistoryEvidence extends Pick<
  SqliteHotStorageCheckpoint,
  "decodedThrough" | "recordsByKey" | "terminalPosition"
> {
  readonly records: ReadonlyArray<JournalRecord>
}

export const makeSqliteDecodedHistoryEvidence = (
  records: ReadonlyArray<JournalRecord>,
  partition: JournalPartition,
  runId: RunId,
  operation: StoreOperation
): Effect.Effect<SqliteDecodedHistoryEvidence, JournalHistoryCorruption> =>
  Effect.gen(function* () {
    const observedKeys = new Set<JournalRecordKey>()
    for (const [index, record] of records.entries()) {
      if (record.position !== index + 1) {
        return yield* historyCorruption(
          partition,
          runId,
          operation,
          `expected contiguous position ${index + 1}, found ${record.position}`
        )
      }
      if (observedKeys.has(record.key)) {
        return yield* historyCorruption(partition, runId, operation, `duplicate record key ${record.key}`)
      }
      observedKeys.add(record.key)
    }
    return {
      decodedThrough: records.at(lastRecordIndex)?.position,
      records,
      recordsByKey: HashMap.fromIterable(
        records.map((record) => [record.key, { event: record.event, position: record.position }] as const)
      ),
      terminalPosition: records.find(({ event }) => event._tag === "WorkflowRunTerminated")?.position
    }
  })

/** Node's SQLite TEXT reader stops at NUL; hex carries the complete stored UTF-8 key. */
const recordKeyFromSqliteHex = (hex: string): JournalRecordKey | undefined => {
  const bytes = Buffer.from(hex, "hex")
  if (bytes.length === 0 || bytes.toString("hex").toUpperCase() !== hex.toUpperCase()) return undefined
  const key = bytes.toString("utf8")
  return Buffer.from(key, "utf8").equals(bytes) ? JournalRecordKey.make(key) : undefined
}

const parseEvent = (
  row: Pick<PersistedJournalRow, "event_kind" | "event_version" | "payload_json">,
  operation: StoreOperation,
  strings: JournalPayloadStringPool
) =>
  decodeJournalEvent({ kind: row.event_kind, payloadJson: row.payload_json, version: row.event_version }, strings).pipe(
    Effect.mapError((cause) => cause.detail),
    Effect.mapError((detail) => ({ detail, operation }))
  )

type ScannedRow =
  | { readonly _tag: "BoundaryIssue"; readonly issue: JournalBoundaryDecodeIssue; readonly runId: RunId | undefined }
  | { readonly _tag: "Record"; readonly record: JournalRecord }

const decodeScannedRow = (
  partition: JournalPartition,
  operation: "JournalStore.scanHot" | "JournalStore.auditAll",
  rowOrdinal: number,
  input: unknown,
  strings: JournalPayloadStringPool
): Effect.Effect<ScannedRow> =>
  Effect.gen(function* () {
    const identity = yield* decodeBoundary(PersistedRunIdentity, input, operation).pipe(Effect.result)
    const identityRunId = Result.isSuccess(identity) ? identity.success.run_id : undefined
    const decoded = yield* decodeBoundary(PersistedJournalRow, input, operation).pipe(Effect.result)
    if (Result.isFailure(decoded)) {
      return {
        _tag: "BoundaryIssue",
        issue: new JournalBoundaryDecodeIssue({
          detail: decoded.failure.detail,
          partition,
          rowOrdinal,
          runId: identityRunId ?? null
        }),
        runId: identityRunId
      }
    }
    const key = recordKeyFromSqliteHex(decoded.success.record_key_hex)
    if (key === undefined) {
      return {
        _tag: "BoundaryIssue",
        issue: new JournalBoundaryDecodeIssue({
          detail: "stored journal record key is not valid UTF-8 hex",
          partition,
          rowOrdinal,
          runId: decoded.success.run_id
        }),
        runId: decoded.success.run_id
      }
    }
    const event = yield* parseEvent(decoded.success, operation, strings).pipe(Effect.result)
    if (Result.isFailure(event)) {
      return {
        _tag: "BoundaryIssue",
        issue: new JournalBoundaryDecodeIssue({
          detail: event.failure.detail,
          partition,
          rowOrdinal,
          runId: decoded.success.run_id
        }),
        runId: decoded.success.run_id
      }
    }
    return {
      _tag: "Record",
      record: { event: event.success, key, position: decoded.success.position, runId: decoded.success.run_id }
    }
  })

const collectScannedRows = Effect.fn("JournalStore.Sqlite.collectScannedRows")(
  (
    partition: JournalPartition,
    operation: "JournalStore.scanHot" | "JournalStore.auditAll",
    rows: ReadonlyArray<unknown>
  ) =>
    withJournalPayloadStringPool((strings) =>
      Effect.gen(function* () {
        const issues = new Array<JournalAudit["issues"][number]>()
        const recordsByRun = new Map<RunId, Array<JournalRecord>>()
        const rowRunIds = new Set<RunId>()
        for (const [index, input] of rows.entries()) {
          const decoded = yield* decodeScannedRow(partition, operation, index + 1, input, strings)
          if (decoded._tag === "BoundaryIssue") {
            if (decoded.runId !== undefined) rowRunIds.add(decoded.runId)
            issues.push(decoded.issue)
            continue
          }
          rowRunIds.add(decoded.record.runId)
          const current = recordsByRun.get(decoded.record.runId) ?? []
          current.push(decoded.record)
          recordsByRun.set(decoded.record.runId, current)
        }
        return { issues, recordsByRun, rowRunIds }
      })
    )
)

interface SqlitePartitionScan {
  readonly issues: JournalAudit["issues"]
  readonly partition: JournalPartition
  readonly rowRunIds: ReadonlySet<RunId>
  readonly runs: ReadonlyArray<{
    readonly partition: JournalPartition
    readonly records: ReadonlyArray<JournalRecord>
    readonly runId: RunId
  }>
}

export interface SqliteJournalQueries {
  readonly hasPartitionRows: (
    partition: JournalPartition,
    runId: RunId,
    operation: StoreOperation
  ) => Effect.Effect<boolean, JournalStoreError>
  readonly insertLifecycleRecord: (record: JournalRecord) => Effect.Effect<void, SqlError.SqlError>
  readonly loadPartitionRecords: (
    partition: JournalPartition,
    runId: RunId,
    operation: StoreOperation
  ) => Effect.Effect<ReadonlyArray<JournalRecord>, JournalStoreError>
  readonly locateRunPartition: (
    runId: RunId,
    operation: StoreOperation
  ) => Effect.Effect<JournalPartition, JournalStoreError>
  readonly loadRunRecords: (
    runId: RunId,
    operation: StoreOperation
  ) => Effect.Effect<ReadonlyArray<JournalRecord>, JournalStoreError>
  readonly loadRunSnapshot: (
    runId: RunId,
    operation: StoreOperation
  ) => Effect.Effect<SqlitePartitionSnapshot, JournalStoreError>
  readonly loadRunSnapshotForPartition: (
    partition: JournalPartition,
    runId: RunId,
    operation: StoreOperation
  ) => Effect.Effect<SqlitePartitionSnapshot, JournalStoreError>
  readonly scanPartition: (
    partition: JournalPartition,
    operation: "JournalStore.scanHot" | "JournalStore.auditAll"
  ) => Effect.Effect<SqlitePartitionScan, JournalStoreError>
}

export const makeSqliteJournalQueries = (
  sql: SqliteClient.SqliteClient,
  beforeReadLoad: (() => Effect.Effect<void>) | undefined,
  onPartitionRowsQueried?: (partition: JournalPartition, runId: RunId, rowCount: number) => Effect.Effect<void>
): SqliteJournalQueries => {
  const loadPartitionEvidence = Effect.fn("JournalStore.Sqlite.loadPartitionEvidence")(function* (
    partition: JournalPartition,
    runId: RunId,
    operation: StoreOperation
  ) {
    const statement =
      partition === "Hot"
        ? sql`
          SELECT run_id, position, hex(record_key) AS record_key_hex, event_kind, event_version, payload_json
          FROM journal_records WHERE run_id = ${runId} ORDER BY position ASC
        `
        : sql`
          SELECT run_id, position, hex(record_key) AS record_key_hex, event_kind, event_version, payload_json
          FROM journal_records_cold WHERE run_id = ${runId} ORDER BY position ASC
        `
    // A first read after reopening must not pin its obsolete decoded history
    // through the native driver's completed prepare fiber and parent span.
    const input = yield* statement.unprepared.pipe(
      Effect.mapError(classifyJournalStorageFailure.bind(undefined, operation)),
      Effect.catchDefect((cause) => Effect.fail(classifyJournalStorageFailure(operation, cause)))
    )
    const rows = yield* decodeBoundary(PersistedJournalRows, input, operation).pipe(
      Effect.mapError((cause) => historyCorruption(partition, runId, operation, cause.detail))
    )
    if (onPartitionRowsQueried !== undefined) yield* onPartitionRowsQueried(partition, runId, rows.length)
    const decodedRows = yield* withJournalPayloadStringPool((strings) =>
      Effect.forEach(rows, (row) =>
        Effect.gen(function* () {
          const key = recordKeyFromSqliteHex(row.record_key_hex)
          if (key === undefined) {
            return yield* historyCorruption(
              partition,
              runId,
              operation,
              "stored journal record key is not valid UTF-8 hex"
            )
          }
          const event = yield* parseEvent(row, operation, strings).pipe(
            Effect.mapError((cause) => historyCorruption(partition, runId, operation, cause.detail))
          )
          return {
            evidence: { event, position: row.position },
            record: { event, key, position: row.position, runId: row.run_id } satisfies JournalRecord
          }
        })
      )
    )
    const records = decodedRows.map(({ record }) => record)
    return yield* makeSqliteDecodedHistoryEvidence(records, partition, runId, operation)
  })

  const loadPartitionRecords = Effect.fn("JournalStore.Sqlite.loadPartitionRecords")(function* (
    partition: JournalPartition,
    runId: RunId,
    operation: StoreOperation
  ) {
    return (yield* loadPartitionEvidence(partition, runId, operation)).records
  })

  const hasPartitionRows = Effect.fn("JournalStore.Sqlite.hasPartitionRows")(function* (
    partition: JournalPartition,
    runId: RunId,
    operation: StoreOperation
  ) {
    const input = yield* (
      partition === "Hot"
        ? sql`SELECT run_id FROM journal_records WHERE run_id = ${runId} LIMIT 1`
        : sql`SELECT run_id FROM journal_records_cold WHERE run_id = ${runId} LIMIT 1`
    ).unprepared.pipe(
      Effect.mapError(classifyJournalStorageFailure.bind(undefined, operation)),
      Effect.catchDefect((cause) => Effect.fail(classifyJournalStorageFailure(operation, cause)))
    )
    const rows = yield* decodeBoundary(Schema.Array(PersistedRunIdentity), input, operation).pipe(
      Effect.mapError((cause) => historyCorruption(partition, runId, operation, cause.detail))
    )
    return rows.length > 0
  })

  const locateRunPartition = Effect.fn("JournalStore.Sqlite.locateRunPartition")(function* (
    runId: RunId,
    operation: StoreOperation
  ) {
    const hot = yield* hasPartitionRows("Hot", runId, operation)
    const cold = yield* hasPartitionRows("Cold", runId, operation)
    if (hot && cold) return yield* new JournalPartitionContradiction({ runId })
    if (operation === "JournalStore.read" && beforeReadLoad !== undefined) yield* beforeReadLoad()
    return cold ? "Cold" : "Hot"
  })

  const loadRunSnapshotForPartition = Effect.fn("JournalStore.Sqlite.loadRunSnapshotForPartition")(function* (
    partition: JournalPartition,
    runId: RunId,
    operation: StoreOperation
  ) {
    const evidence = yield* loadPartitionEvidence(partition, runId, operation)
    if (partition === "Hot") {
      return {
        checkpoint: { ...evidence, partition, runId },
        records: evidence.records
      } satisfies SqlitePartitionSnapshot
    }
    const decision = decideJournalPartitionHistory("Cold", runId, evidence.records)
    if (decision._tag === "InvalidPartitionHistory") {
      return yield* historyCorruption(partition, runId, operation, decision.issue.detail)
    }
    if (evidence.decodedThrough === undefined || evidence.terminalPosition === undefined) {
      return yield* historyCorruption(partition, runId, operation, "valid Cold history requires a terminal record")
    }
    return {
      checkpoint: {
        ...evidence,
        decodedThrough: evidence.decodedThrough,
        partition,
        runId,
        terminalPosition: evidence.terminalPosition
      },
      records: evidence.records
    } satisfies SqlitePartitionSnapshot
  })

  const loadRunSnapshot = Effect.fn("JournalStore.Sqlite.loadRunSnapshot")(function* (
    runId: RunId,
    operation: StoreOperation
  ) {
    return yield* loadRunSnapshotForPartition(yield* locateRunPartition(runId, operation), runId, operation)
  })

  const loadRunRecords = Effect.fn("JournalStore.Sqlite.loadRunRecords")(function* (
    runId: RunId,
    operation: StoreOperation
  ) {
    return (yield* loadRunSnapshot(runId, operation)).records
  })

  const insertLifecycleRecord = Effect.fn("JournalStore.Sqlite.insertLifecycleRecord")(function* (
    record: JournalRecord
  ) {
    const encoded = encodeJournalEvent(record.event)
    yield* sql`
      INSERT INTO journal_records (
        run_id, position, record_key, event_kind, event_version, payload_json
      ) VALUES (
        ${record.runId}, ${record.position}, ${record.key}, ${encoded.kind}, ${encoded.version}, ${encoded.payloadJson}
      )
    `
  })

  const scanPartition = Effect.fn("JournalStore.Sqlite.scanPartition")(function* (
    partition: JournalPartition,
    operation: "JournalStore.scanHot" | "JournalStore.auditAll"
  ) {
    const statement =
      partition === "Hot"
        ? sql`
          SELECT run_id, position, hex(record_key) AS record_key_hex, event_kind, event_version, payload_json
          FROM journal_records ORDER BY run_id ASC, position ASC
        `
        : sql`
          SELECT run_id, position, hex(record_key) AS record_key_hex, event_kind, event_version, payload_json
          FROM journal_records_cold ORDER BY run_id ASC, position ASC
        `
    // A cached prepare lookup retains its completed fiber's parent span. That
    // span's exit owns the complete scan result until the statement expires.
    // Scans still read and validate every row, without retaining that history
    // through the driver's prepared-statement cache.
    const rows = yield* statement.unprepared.pipe(
      Effect.mapError(classifyJournalStorageFailure.bind(undefined, operation)),
      // The native driver's unprepared path prepares synchronously; contain
      // its SQLite preparation throws at this storage boundary as well.
      Effect.catchDefect((cause) => Effect.fail(classifyJournalStorageFailure(operation, cause)))
    )
    const collections = yield* collectScannedRows(partition, operation, rows)
    for (const [runId, records] of collections.recordsByRun) {
      const decision = decideJournalPartitionHistory(partition, runId, records)
      if (decision._tag === "InvalidPartitionHistory") collections.issues.push(decision.issue)
    }
    return {
      issues: collections.issues,
      partition,
      rowRunIds: collections.rowRunIds,
      runs: [...collections.recordsByRun].map(([runId, records]) => ({ partition, records, runId }))
    }
  })

  return {
    hasPartitionRows,
    insertLifecycleRecord,
    loadPartitionRecords,
    locateRunPartition,
    loadRunRecords,
    loadRunSnapshot,
    loadRunSnapshotForPartition,
    scanPartition
  }
}
