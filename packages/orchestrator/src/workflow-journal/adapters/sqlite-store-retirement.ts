import type * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Effect, Schema } from "effect"
import type { RunId } from "@dalph/contracts"
import { decideJournalPartitionHistory } from "../partition-history.js"
import {
  JournalDataCorruption,
  JournalHistoryCorruption,
  JournalHistoryNotTerminal,
  JournalPartitionContradiction,
  WorkflowRunNotBegan
} from "../store.js"
import { decodeBoundary } from "./sqlite-store-errors.js"
import type { SqliteJournalQueries } from "./sqlite-store-queries.js"

const RetirementVerificationRows = Schema.Tuple([
  Schema.Struct({ cold_count: Schema.Int, extra_count: Schema.Int, hot_count: Schema.Int, missing_count: Schema.Int })
])

const retirementCopyPreservesBytes = (check: (typeof RetirementVerificationRows.Type)[number]) =>
  check.hot_count === check.cold_count && check.hot_count !== 0 && check.missing_count === 0 && check.extra_count === 0

export const makeSqliteTerminalHistoryRetirement = (
  sql: SqliteClient.SqliteClient,
  queries: SqliteJournalQueries,
  afterRetirementCopy: (() => Effect.Effect<void, string>) | undefined
) => {
  const retireCold = (runId: RunId) =>
    Effect.gen(function* () {
      const records = yield* queries.loadPartitionRecords("Cold", runId, "JournalStore.retireTerminalRun")
      const decision = decideJournalPartitionHistory("Cold", runId, records)
      if (decision._tag === "InvalidPartitionHistory") {
        return yield* new JournalHistoryCorruption({
          detail: decision.issue.detail,
          operation: "JournalStore.retireTerminalRun",
          partition: "Cold",
          runId
        })
      }
      return { _tag: "AlreadyRetired", partition: "Cold", runId } as const
    })

  const retirementCopyVerification = (runId: RunId) =>
    sql`
      SELECT
        (SELECT COUNT(*) FROM journal_records WHERE run_id = ${runId}) AS hot_count,
        (SELECT COUNT(*) FROM journal_records_cold WHERE run_id = ${runId}) AS cold_count,
        (SELECT COUNT(*) FROM journal_records h
          LEFT JOIN journal_records_cold c ON
            c.run_id = h.run_id AND c.position = h.position AND c.record_key = h.record_key
            AND c.event_kind = h.event_kind AND c.event_version = h.event_version
            AND c.payload_json = h.payload_json
          WHERE h.run_id = ${runId} AND c.run_id IS NULL) AS missing_count,
        (SELECT COUNT(*) FROM journal_records_cold c
          LEFT JOIN journal_records h ON
            h.run_id = c.run_id AND h.position = c.position AND h.record_key = c.record_key
            AND h.event_kind = c.event_kind AND h.event_version = c.event_version
            AND h.payload_json = c.payload_json
          WHERE c.run_id = ${runId} AND h.run_id IS NULL) AS extra_count
    `.pipe(Effect.flatMap((rows) => decodeBoundary(RetirementVerificationRows, rows, "JournalStore.retireTerminalRun")))

  const retireHot = (runId: RunId) =>
    Effect.gen(function* () {
      const records = yield* queries.loadPartitionRecords("Hot", runId, "JournalStore.retireTerminalRun")
      const decision = decideJournalPartitionHistory("Hot", runId, records)
      if (decision._tag === "InvalidPartitionHistory") {
        return yield* new JournalHistoryCorruption({
          detail: decision.issue.detail,
          operation: "JournalStore.retireTerminalRun",
          partition: "Hot",
          runId
        })
      }
      if (!decision.isTerminal) return yield* new JournalHistoryNotTerminal({ runId })
      yield* sql`
        INSERT INTO journal_records_cold (
          run_id, position, record_key, event_kind, event_version, payload_json
        )
        SELECT run_id, position, record_key, event_kind, event_version, payload_json
        FROM journal_records WHERE run_id = ${runId}
      `
      const verification = yield* retirementCopyVerification(runId)
      if (!retirementCopyPreservesBytes(verification[0])) {
        return yield* new JournalDataCorruption({
          detail: "terminal history copy did not preserve every persisted byte",
          operation: "JournalStore.retireTerminalRun"
        })
      }
      if (afterRetirementCopy !== undefined) yield* afterRetirementCopy()
      yield* sql`DELETE FROM journal_records WHERE run_id = ${runId}`
      return { _tag: "Retired", from: "Hot", runId, to: "Cold" } as const
    })

  return (runId: RunId) =>
    Effect.gen(function* () {
      const hot = yield* queries.hasPartitionRows("Hot", runId, "JournalStore.retireTerminalRun")
      const cold = yield* queries.hasPartitionRows("Cold", runId, "JournalStore.retireTerminalRun")
      if (hot && cold) return yield* new JournalPartitionContradiction({ runId })
      if (cold) return yield* retireCold(runId)
      if (!hot) return yield* new WorkflowRunNotBegan({ runId })
      return yield* retireHot(runId)
    })
}
