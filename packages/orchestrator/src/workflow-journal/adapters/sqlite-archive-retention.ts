import type * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Clock, Effect, Schema, type Semaphore } from "effect"
import { RunId } from "@dalph/contracts"
import {
  archiveRetentionPass,
  archiveAgeMillis,
  SavedArchiveBytes,
  retentionBaseline,
  retentionReason
} from "../archive-retention.js"
import { RunCompletionTime } from "../completion.js"
import { JournalDataCorruption, JournalHistoryCorruption } from "../store.js"
import { decideJournalPartitionHistory } from "../partition-history.js"
import { classifyJournalMethodFailure, decodeBoundary } from "./sqlite-store-errors.js"
import type { makeSqliteCompletions } from "./sqlite-completion.js"
import type { SqliteJournalQueries } from "./sqlite-store-queries.js"

/** SQLite lengths are bytes of the actual saved UTF-8 representation, never expanded payloads. */
export const refreshSqliteArchiveAccounting = (sql: SqliteClient.SqliteClient, runId?: RunId) => sql`
  INSERT INTO archive_histories(run_id, saved_bytes, baseline)
  SELECT c.run_id, SUM(length(CAST(c.run_id AS BLOB)) + length(CAST(c.record_key AS BLOB)) +
    length(CAST(c.event_kind AS BLOB)) + length(CAST(c.payload_json AS BLOB)) + 16),
    COALESCE(json_extract(r.completion_json, '$.timing.completedAt'), json_extract(r.completion_json, '$.timing.verifiedAt'))
  FROM journal_records_cold c LEFT JOIN run_completions r ON r.run_id = c.run_id
  WHERE (${runId ?? null} IS NULL OR c.run_id = ${runId ?? null})
    AND (${runId ?? null} IS NOT NULL OR NOT EXISTS (SELECT 1 FROM archive_histories a WHERE a.run_id = c.run_id AND (a.baseline IS NOT NULL OR r.run_id IS NULL)))
  GROUP BY c.run_id
  ON CONFLICT(run_id) DO UPDATE SET saved_bytes = excluded.saved_bytes, baseline = excluded.baseline
`

/** Controlled cuts at the real deletion boundary; production never installs them. */
export interface SqliteArchiveRetentionCuts {
  readonly beforeArchiveDelete?: () => Effect.Effect<void, string>
  readonly beforeArchiveCommit?: () => Effect.Effect<void, string>
  readonly afterArchiveCommit?: () => Effect.Effect<void, string>
}

export const makeSqliteArchiveRetention = (
  sql: SqliteClient.SqliteClient,
  queries: SqliteJournalQueries,
  completions: ReturnType<typeof makeSqliteCompletions>,
  invalidate: (id: RunId) => Effect.Effect<void>,
  cuts: SqliteArchiveRetentionCuts,
  serialization: Semaphore.Semaphore
) => {
  const snapshot = (now: number) =>
    Effect.gen(function* () {
      const totals =
        yield* sql`SELECT COALESCE(SUM(saved_bytes), 0) AS bytes, (SELECT COUNT(*) FROM archive_histories a JOIN run_completions r ON r.run_id = a.run_id WHERE a.baseline <= ${now - archiveAgeMillis} AND r.deletion_json IS NULL) AS expired FROM archive_histories`.pipe(
          Effect.flatMap((rows) =>
            decodeBoundary(
              Schema.Tuple([Schema.Struct({ bytes: SavedArchiveBytes, expired: Schema.Int })]),
              rows,
              "JournalStore.maintainArchive"
            )
          )
        )
      const rows =
        yield* sql`SELECT a.run_id, a.saved_bytes, a.baseline FROM archive_histories a JOIN run_completions r ON r.run_id = a.run_id WHERE a.baseline IS NOT NULL AND r.deletion_json IS NULL ORDER BY a.baseline, a.run_id LIMIT 33`.pipe(
          Effect.flatMap((rows) =>
            decodeBoundary(
              Schema.Array(
                Schema.Struct({ run_id: RunId, saved_bytes: SavedArchiveBytes, baseline: RunCompletionTime })
              ),
              rows,
              "JournalStore.maintainArchive"
            )
          )
        )
      return {
        expiredBacklog: totals[0].expired,
        savedBytes: totals[0].bytes,
        candidates: rows.map((row) => ({ runId: row.run_id, bytes: row.saved_bytes, baseline: row.baseline }))
      }
    }).pipe(Effect.mapError((error) => classifyJournalMethodFailure("JournalStore.maintainArchive", error)))
  return () =>
    archiveRetentionPass({
      now: Clock.currentTimeMillis,
      snapshot: (now) => serialization.withPermit(snapshot(now)),
      remove: (candidate, now) =>
        serialization.withPermit(
          Effect.gen(function* () {
            const deletion = Effect.gen(function* () {
              const receipt = yield* completions.read(candidate.runId)
              if (receipt._tag !== "CompletedRun")
                return yield* new JournalDataCorruption({
                  operation: "JournalStore.maintainArchive",
                  detail: "archive candidate lacks completion"
                })
              if (receipt.history === "Deleted") return
              const records = yield* queries.loadPartitionRecords(
                "Cold",
                candidate.runId,
                "JournalStore.maintainArchive"
              )
              const decision = decideJournalPartitionHistory("Cold", candidate.runId, records)
              if (decision._tag === "InvalidPartitionHistory")
                return yield* new JournalHistoryCorruption({
                  operation: "JournalStore.maintainArchive",
                  runId: candidate.runId,
                  partition: "Cold",
                  detail: decision.issue.detail
                })
              const current = yield* snapshot(now)
              const reason = retentionReason(
                { ...candidate, baseline: retentionBaseline(receipt.completion) },
                now,
                current.savedBytes
              )
              if (reason === undefined) return
              yield* cuts.beforeArchiveDelete?.() ?? Effect.void
              yield* sql`DELETE FROM journal_records_cold WHERE run_id = ${candidate.runId}`
              yield* completions.markDeleted(candidate.runId, { reason, observedAt: RunCompletionTime.make(now) })
              yield* sql`DELETE FROM archive_histories WHERE run_id = ${candidate.runId}`
              yield* cuts.beforeArchiveCommit?.() ?? Effect.void
            }).pipe(
              sql.withTransaction,
              Effect.tap(() => cuts.afterArchiveCommit?.() ?? Effect.void),
              Effect.ensuring(invalidate(candidate.runId)),
              Effect.mapError((error) => classifyJournalMethodFailure("JournalStore.maintainArchive", error))
            )
            const result = yield* deletion.pipe(Effect.result)
            if (result._tag === "Failure") {
              // Lost acknowledgement is not permission to repeat deletion. Reconcile the exact committed availability.
              const observed = yield* completions.read(candidate.runId).pipe(Effect.result)
              if (
                observed._tag === "Success" &&
                observed.success._tag === "CompletedRun" &&
                observed.success.history === "Deleted"
              )
                return
              return yield* result.failure
            }
          })
        )
    })
}
