import type { JournalAudit } from "../recovery-model.js"
/* eslint-disable import/no-nodejs-modules -- This physical SQLite adapter fingerprints persisted endpoint bytes without decoding their finality trees. */
import { createHash } from "node:crypto"
import type * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Clock, Effect, Result, Schema } from "effect"
import { RunId } from "@dalph/contracts"
import {
  RunHistoryDeletion,
  RunCompletion,
  RunCompletionTime,
  sameRunCompletion,
  verifiedRunCompletion,
  type RunCompletionTiming
} from "../completion.js"
import { JournalHistoryDeleted, JournalDataCorruption, JournalHistoryCorruption, type JournalRecord } from "../store.js"
import { decodeBoundary, classifyJournalMethodFailure, classifyJournalStorageFailure } from "./sqlite-store-errors.js"
import type { makeSqliteJournalQueries } from "./sqlite-store-queries.js"

const ReceiptRows = Schema.Array(
  Schema.Struct({
    completion_json: Schema.String,
    integrity_json: Schema.String,
    checksum: Schema.String,
    deletion_json: Schema.NullOr(Schema.String)
  })
)
const IntegrityRows = Schema.Array(
  Schema.Struct({
    position: Schema.Int,
    event_kind: Schema.String,
    event_version: Schema.Int,
    record_key_hex: Schema.String,
    payload_json: Schema.String
  })
)
const digest = (value: string): string => createHash("sha256").update(value).digest("hex")

/** Completion metadata has its own durable row. Fingerprints detect endpoint/receipt contradictions without decoding finality or replaying history. */
export const makeSqliteCompletions = (
  sql: SqliteClient.SqliteClient,
  queries: ReturnType<typeof makeSqliteJournalQueries>
) => {
  // Completion reads may run inside a whole-history audit/read span. Cached
  // prepare fibers retain that span's eventual result, so use the same uncached
  // preparation boundary as complete-history queries, including native throws.
  const containPreparationFailure = Effect.catchDefect((cause) =>
    Effect.fail(classifyJournalStorageFailure("JournalStore.readCompletion", cause))
  )
  const integrity = Effect.fn("RunCompletion.Sqlite.integrity")(function* (runId: RunId) {
    const partition = yield* queries.locateRunPartition(runId, "JournalStore.readCompletion")
    const table = partition === "Cold" ? "journal_records_cold" : "journal_records"
    const rows = yield* sql`
      SELECT position, event_kind, event_version, hex(record_key) AS record_key_hex, payload_json FROM ${sql(table)} WHERE run_id = ${runId}
      AND (position = 1 OR position = (SELECT MAX(position) FROM ${sql(table)} WHERE run_id = ${runId})
        OR position = (SELECT MAX(position) FROM ${sql(table)} WHERE run_id = ${runId} AND event_kind = 'RemotePublicationSucceeded'))
      ORDER BY position
    `.unprepared.pipe(
      containPreparationFailure,
      Effect.flatMap((rows) => decodeBoundary(IntegrityRows, rows, "JournalStore.readCompletion"))
    )
    return JSON.stringify(
      rows.map((row) => ({
        position: row.position,
        kind: row.event_kind,
        version: row.event_version,
        key: row.record_key_hex,
        digest: digest(row.payload_json)
      }))
    )
  })

  const read = Effect.fn("JournalStore.Sqlite.readCompletion")(function* (runId: RunId) {
    const rows =
      yield* sql`SELECT completion_json, integrity_json, checksum, deletion_json FROM run_completions WHERE run_id = ${runId}`.unprepared.pipe(
        containPreparationFailure,
        Effect.flatMap((rows) => decodeBoundary(ReceiptRows, rows, "JournalStore.readCompletion"))
      )
    const row = rows[0]
    if (row === undefined) {
      const partition = yield* queries.locateRunPartition(runId, "JournalStore.readCompletion")
      const table = partition === "Cold" ? "journal_records_cold" : "journal_records"
      const terminalRows =
        yield* sql`SELECT run_id FROM ${sql(table)} WHERE run_id = ${runId} AND event_kind = 'WorkflowRunTerminated' LIMIT 1`.unprepared.pipe(
          containPreparationFailure
        )
      if (terminalRows.length > 0) {
        const records = yield* queries.loadRunRecords(runId, "JournalStore.readCompletion")
        yield* verifiedRunCompletion(runId, records, {
          _tag: "LegacyBaseline",
          originalTime: "Unknown",
          verifiedAt: RunCompletionTime.make(yield* Clock.currentTimeMillis)
        })
      }
      return { _tag: "NoCompletion" as const, runId }
    }
    const completion = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RunCompletion))(
      row.completion_json
    ).pipe(
      Effect.mapError(
        (error) => new JournalDataCorruption({ operation: "JournalStore.readCompletion", detail: String(error) })
      )
    )
    if (
      completion.runId !== runId ||
      digest(row.completion_json + row.integrity_json + (row.deletion_json ?? "")) !== row.checksum
    ) {
      return yield* new JournalDataCorruption({
        operation: "JournalStore.readCompletion",
        detail: `completion/history contradiction for ${runId}`
      })
    }
    if (row.deletion_json !== null) {
      const deletion = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RunHistoryDeletion))(
        row.deletion_json
      ).pipe(
        Effect.mapError(
          (error) => new JournalDataCorruption({ operation: "JournalStore.readCompletion", detail: String(error) })
        )
      )
      if (
        (yield* queries.hasPartitionRows("Hot", runId, "JournalStore.readCompletion")) ||
        (yield* queries.hasPartitionRows("Cold", runId, "JournalStore.readCompletion"))
      )
        return yield* new JournalDataCorruption({
          operation: "JournalStore.readCompletion",
          detail: `deleted history has rows for ${runId}`
        })
      return { _tag: "CompletedRun" as const, completion, history: "Deleted" as const, deletion }
    }
    if ((yield* integrity(runId)) !== row.integrity_json) {
      const partition = yield* queries.locateRunPartition(runId, "JournalStore.readCompletion")
      return yield* new JournalHistoryCorruption({
        operation: "JournalStore.readCompletion",
        partition: partition === "Cold" ? "Cold" : "Hot",
        runId,
        detail: "completion/history endpoints contradict recorded fingerprints"
      })
    }
    return { _tag: "CompletedRun" as const, completion, history: "Available" as const }
  })

  const verify = Effect.fn("RunCompletion.Sqlite.verifyStored")(function* (
    runId: RunId,
    records: ReadonlyArray<JournalRecord>,
    completion: RunCompletion
  ) {
    const expected = yield* verifiedRunCompletion(runId, records, completion.timing)
    if (expected === undefined || !sameRunCompletion(completion, expected))
      return yield* new JournalDataCorruption({
        operation: "JournalStore.readCompletion",
        detail: `completion/history contradiction for ${runId}`
      })
  })
  const save = Effect.fn("RunCompletion.Sqlite.save")(function* (
    runId: RunId,
    records: ReadonlyArray<JournalRecord>,
    timing: RunCompletionTiming
  ) {
    const completion = yield* verifiedRunCompletion(runId, records, timing)
    if (completion === undefined) return
    const existing = yield* read(runId)
    if (existing._tag === "CompletedRun") {
      if (!sameRunCompletion(existing.completion, { ...completion, timing: existing.completion.timing })) {
        return yield* new JournalDataCorruption({
          operation: "JournalStore.readCompletion",
          detail: `completion/history contradiction for ${runId}`
        })
      }
      return
    }
    const completionJson = Schema.encodeSync(Schema.fromJsonString(RunCompletion))(completion)
    const integrityJson = yield* integrity(runId)
    yield* sql`INSERT INTO run_completions (run_id, completion_json, integrity_json, checksum) VALUES (${runId}, ${completionJson}, ${integrityJson}, ${digest(completionJson + integrityJson)})`
  })

  const reconcile = Effect.fn("RunCompletion.Sqlite.reconcile")(function* () {
    // Select terminal candidates from indexed event metadata; never replay active histories.
    const candidateResult =
      yield* sql`SELECT DISTINCT run_id FROM journal_records WHERE event_kind = 'WorkflowRunTerminated'
      UNION SELECT DISTINCT run_id FROM journal_records_cold WHERE event_kind = 'WorkflowRunTerminated'`.unprepared.pipe(
        containPreparationFailure,
        Effect.flatMap((rows) =>
          decodeBoundary(Schema.Array(Schema.Struct({ run_id: RunId })), rows, "JournalStore.readCompletion")
        ),
        Effect.result
      )
    if (Result.isFailure(candidateResult)) return
    const candidates = candidateResult.success
    const verifiedAt = RunCompletionTime.make(yield* Clock.currentTimeMillis)
    for (const { run_id: runId } of candidates) {
      // Bad legacy history remains untouched and is reported by exact reads/audit.
      // Existing receipts must still pass their independent integrity read.
      const existingResult = yield* read(runId).pipe(Effect.result)
      if (Result.isFailure(existingResult)) continue
      const existing = existingResult.success
      if (existing._tag === "CompletedRun") continue
      const records = yield* queries.loadRunRecords(runId, "JournalStore.readCompletion").pipe(Effect.result)
      if (Result.isFailure(records)) continue
      const verified = yield* verifiedRunCompletion(runId, records.success, {
        _tag: "LegacyBaseline",
        originalTime: "Unknown",
        verifiedAt
      }).pipe(Effect.result)
      if (Result.isFailure(verified)) continue
      yield* save(runId, records.success, { _tag: "LegacyBaseline", originalTime: "Unknown", verifiedAt })
    }
  })
  const identities = () =>
    sql`SELECT run_id FROM run_completions`.unprepared.pipe(
      containPreparationFailure,
      Effect.flatMap((rows) =>
        decodeBoundary(Schema.Array(Schema.Struct({ run_id: RunId })), rows, "JournalStore.auditAll")
      )
    )
  const audit = Effect.fn("RunCompletion.Sqlite.audit")(function* (audit: JournalAudit) {
    const receipts = []
    const invalidRunIds = new Set(audit.issues.map((issue) => issue.runId))
    for (const { run_id: runId } of yield* identities()) {
      if (!invalidRunIds.has(runId)) {
        const receipt = yield* read(runId)
        if (receipt._tag === "CompletedRun") receipts.push(receipt)
      }
    }
    for (const run of audit.runs) {
      if (invalidRunIds.has(run.runId)) continue
      const completion = yield* read(run.runId)
      if (completion._tag === "CompletedRun") yield* verify(run.runId, run.records, completion.completion)
    }
    return receipts
  })
  const markDeleted = Effect.fn("RunCompletion.Sqlite.markDeleted")(function* (
    runId: RunId,
    deletion: RunHistoryDeletion
  ) {
    const rows =
      yield* sql`SELECT completion_json, integrity_json, checksum, deletion_json FROM run_completions WHERE run_id = ${runId}`.unprepared.pipe(
        containPreparationFailure,
        Effect.flatMap((rows) => decodeBoundary(ReceiptRows, rows, "JournalStore.maintainArchive"))
      )
    const row = rows[0]
    if (row === undefined)
      return yield* new JournalDataCorruption({
        operation: "JournalStore.maintainArchive",
        detail: "missing established completion"
      })
    const json = Schema.encodeSync(Schema.fromJsonString(RunHistoryDeletion))(deletion)
    yield* sql`UPDATE run_completions SET deletion_json = ${json}, checksum = ${digest(row.completion_json + row.integrity_json + json)} WHERE run_id = ${runId}`
  })
  const requireAvailable = Effect.fn("RunCompletion.Sqlite.requireAvailable")(function* (runId: RunId) {
    const marker =
      yield* sql`SELECT run_id FROM run_completions WHERE run_id = ${runId} AND deletion_json IS NOT NULL`.unprepared.pipe(
        containPreparationFailure
      )
    if (marker.length === 0) return
    const receipt = yield* read(runId)
    if (receipt._tag === "CompletedRun" && receipt.history === "Deleted")
      return yield* new JournalHistoryDeleted({ completion: receipt.completion, deletion: receipt.deletion })
  })
  return {
    readIndependent: (runId: RunId) =>
      read(runId).pipe(
        sql.withTransaction,
        Effect.mapError((failure) => classifyJournalMethodFailure("JournalStore.readCompletion", failure))
      ),
    requireAvailable,
    markDeleted,
    audit,
    read: (runId: RunId) =>
      read(runId).pipe(
        Effect.mapError((failure) => classifyJournalMethodFailure("JournalStore.readCompletion", failure))
      ),
    save,
    reconcile
  }
}
