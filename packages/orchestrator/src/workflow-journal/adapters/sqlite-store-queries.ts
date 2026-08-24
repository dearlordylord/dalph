/* eslint-disable functional/immutable-data -- Scan accumulation is private adapter scratch and never becomes journal authority. */
import type * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Effect, Result, Schema } from "effect"
import type * as SqlError from "effect/unstable/sql/SqlError"
import { RunId } from "@dalph/contracts"
import { JournalEventKind, JournalEventVersion } from "../../workflow/kernel/event.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import { decodeJournalEvent, encodeJournalEvent } from "../event-codec.js"
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

const PersistedJournalRow = Schema.Struct({
  event_kind: JournalEventKind,
  event_version: JournalEventVersion,
  payload_json: Schema.String,
  run_id: RunId,
  position: JournalPosition,
  record_key: JournalRecordKey
})
type PersistedJournalRow = typeof PersistedJournalRow.Type

const PersistedJournalRows = Schema.Array(PersistedJournalRow)
const PersistedRunIdentity = Schema.Struct({ run_id: RunId })
const ExistingRecordRows = Schema.Array(
  Schema.Struct({
    position: JournalPosition,
    event_kind: JournalEventKind,
    event_version: JournalEventVersion,
    payload_json: Schema.String
  })
)
const NextPositionRows = Schema.Tuple([Schema.Struct({ next_position: JournalPosition })])

const historyCorruption = (partition: JournalPartition, runId: RunId, operation: StoreOperation, detail: string) =>
  new JournalHistoryCorruption({ detail, operation, partition, runId })

const parseEvent = (
  row: Pick<PersistedJournalRow, "event_kind" | "event_version" | "payload_json">,
  operation: StoreOperation
) =>
  decodeJournalEvent({ kind: row.event_kind, payloadJson: row.payload_json, version: row.event_version }).pipe(
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
  input: unknown
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
    const event = yield* parseEvent(decoded.success, operation).pipe(Effect.result)
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
      record: {
        event: event.success,
        key: decoded.success.record_key,
        position: decoded.success.position,
        runId: decoded.success.run_id
      }
    }
  })

const collectScannedRows = Effect.fn("JournalStore.Sqlite.collectScannedRows")(function* (
  partition: JournalPartition,
  operation: "JournalStore.scanHot" | "JournalStore.auditAll",
  rows: ReadonlyArray<unknown>
) {
  const issues = new Array<JournalAudit["issues"][number]>()
  const recordsByRun = new Map<RunId, Array<JournalRecord>>()
  const rowRunIds = new Set<RunId>()
  for (const [index, input] of rows.entries()) {
    const decoded = yield* decodeScannedRow(partition, operation, index + 1, input)
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
  readonly findExistingRecord: (
    runId: RunId,
    key: JournalRecordKey
  ) => Effect.Effect<
    { readonly event: WorkflowJournalEvent; readonly position: JournalPosition } | undefined,
    JournalHistoryCorruption | SqlError.SqlError
  >
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
  readonly loadRunRecords: (
    runId: RunId,
    operation: StoreOperation
  ) => Effect.Effect<ReadonlyArray<JournalRecord>, JournalStoreError>
  readonly nextPosition: (runId: RunId) => Effect.Effect<JournalPosition, JournalHistoryCorruption | SqlError.SqlError>
  readonly scanPartition: (
    partition: JournalPartition,
    operation: "JournalStore.scanHot" | "JournalStore.auditAll"
  ) => Effect.Effect<SqlitePartitionScan, JournalStoreError>
}

export const makeSqliteJournalQueries = (
  sql: SqliteClient.SqliteClient,
  beforeReadLoad: (() => Effect.Effect<void>) | undefined
): SqliteJournalQueries => {
  const loadPartitionRecords = Effect.fn("JournalStore.Sqlite.loadPartitionRecords")(function* (
    partition: JournalPartition,
    runId: RunId,
    operation: StoreOperation
  ) {
    const input = yield* (
      partition === "Hot"
        ? sql`
          SELECT run_id, position, record_key, event_kind, event_version, payload_json
          FROM journal_records WHERE run_id = ${runId} ORDER BY position ASC
        `
        : sql`
          SELECT run_id, position, record_key, event_kind, event_version, payload_json
          FROM journal_records_cold WHERE run_id = ${runId} ORDER BY position ASC
        `
    ).pipe(Effect.mapError(classifyJournalStorageFailure.bind(undefined, operation)))
    const rows = yield* decodeBoundary(PersistedJournalRows, input, operation).pipe(
      Effect.mapError((cause) => historyCorruption(partition, runId, operation, cause.detail))
    )
    return yield* Effect.forEach(rows, (row) =>
      parseEvent(row, operation).pipe(
        Effect.map(
          (event): JournalRecord => ({ event, key: row.record_key, position: row.position, runId: row.run_id })
        ),
        Effect.mapError((cause) => historyCorruption(partition, runId, operation, cause.detail))
      )
    )
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
    ).pipe(Effect.mapError(classifyJournalStorageFailure.bind(undefined, operation)))
    const rows = yield* decodeBoundary(Schema.Array(PersistedRunIdentity), input, operation).pipe(
      Effect.mapError((cause) => historyCorruption(partition, runId, operation, cause.detail))
    )
    return rows.length > 0
  })

  const loadRunRecords = Effect.fn("JournalStore.Sqlite.loadRunRecords")(function* (
    runId: RunId,
    operation: StoreOperation
  ) {
    const hot = yield* hasPartitionRows("Hot", runId, operation)
    const cold = yield* hasPartitionRows("Cold", runId, operation)
    if (hot && cold) return yield* new JournalPartitionContradiction({ runId })
    if (operation === "JournalStore.read" && beforeReadLoad !== undefined) yield* beforeReadLoad()
    const partition = cold ? "Cold" : "Hot"
    const records = yield* loadPartitionRecords(partition, runId, operation)
    if (!cold) return records
    const decision = decideJournalPartitionHistory("Cold", runId, records)
    if (decision._tag === "InvalidPartitionHistory") {
      return yield* historyCorruption(partition, runId, operation, decision.issue.detail)
    }
    return records
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

  const findExistingRecord = Effect.fn("JournalStore.Sqlite.findExistingRecord")(function* (
    runId: RunId,
    key: JournalRecordKey
  ) {
    const input = yield* sql`
      SELECT position, event_kind, event_version, payload_json
      FROM journal_records
      WHERE run_id = ${runId} AND record_key = ${key}
    `
    const rows = yield* decodeBoundary(ExistingRecordRows, input, "JournalStore.append").pipe(
      Effect.mapError((cause) => historyCorruption("Hot", runId, "JournalStore.append", cause.detail))
    )
    const existing = rows[0]
    if (existing === undefined) return undefined
    const event = yield* parseEvent(existing, "JournalStore.append").pipe(
      Effect.mapError((cause) => historyCorruption("Hot", runId, "JournalStore.append", cause.detail))
    )
    return { event, position: existing.position }
  })

  const nextPosition = Effect.fn("JournalStore.Sqlite.nextPosition")(function* (runId: RunId) {
    const input = yield* sql`
      SELECT COALESCE(MAX(position), 0) + 1 AS next_position
      FROM journal_records
      WHERE run_id = ${runId}
    `
    const positions = yield* decodeBoundary(NextPositionRows, input, "JournalStore.append").pipe(
      Effect.mapError((cause) => historyCorruption("Hot", runId, "JournalStore.append", cause.detail))
    )
    return positions[0].next_position
  })

  const scanPartition = Effect.fn("JournalStore.Sqlite.scanPartition")(function* (
    partition: JournalPartition,
    operation: "JournalStore.scanHot" | "JournalStore.auditAll"
  ) {
    const rows = yield* (
      partition === "Hot"
        ? sql`
          SELECT run_id, position, record_key, event_kind, event_version, payload_json
          FROM journal_records ORDER BY run_id ASC, position ASC
        `
        : sql`
          SELECT run_id, position, record_key, event_kind, event_version, payload_json
          FROM journal_records_cold ORDER BY run_id ASC, position ASC
        `
    ).pipe(Effect.mapError(classifyJournalStorageFailure.bind(undefined, operation)))
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
    findExistingRecord,
    hasPartitionRows,
    insertLifecycleRecord,
    loadPartitionRecords,
    loadRunRecords,
    nextPosition,
    scanPartition
  }
}
