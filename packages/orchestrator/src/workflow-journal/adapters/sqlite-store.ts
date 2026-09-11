import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Cause, Config, Effect, Layer } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import type { RunId } from "@dalph/contracts"
import { JournalDatabaseLocator, type JournalRecordKey } from "../identity.js"
import { encodeJournalEvent, equalJournalEvents } from "../event-codec.js"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import {
  decideWorkflowRunBeginning,
  decideWorkflowRunTermination,
  readRecoverableRunBeginning
} from "../run-lifecycle.js"
import {
  journalStoreCapabilities,
  unpublishedInRunJournalTestLayer,
  JournalHistoryCorruption,
  JournalPartitionContradiction,
  JournalStore,
  JournalStoreContradiction,
  WorkflowRunAlreadyTerminated
} from "../store.js"
import type { AppendableWorkflowJournalEvent, JournalRecord } from "../store.js"
import type { InitialControlPolicy } from "../../control/policy.js"
import type { RunFinalityEvidence, RunTerminationDisposition } from "../../coordination/frontier/run-finality.js"
import { classifyJournalMethodFailure, classifyJournalStorageFailure } from "./sqlite-store-errors.js"
import { acquireExclusiveJournalWriter, migrateJournal } from "./sqlite-store-migration.js"
import { makeSqliteJournalQueries } from "./sqlite-store-queries.js"
import { makeSqliteTerminalHistoryRetirement } from "./sqlite-store-retirement.js"

interface SqliteJournalStoreConfig {
  readonly filename: JournalDatabaseLocator
}

/** Test-only SQLite seams for controlled migration and retirement cuts. */
interface SqliteJournalTestConfig extends SqliteJournalStoreConfig {
  /** Deterministic test seam executed inside an exact-read transaction after membership is read. */
  readonly beforeReadLoad?: () => Effect.Effect<void>
  /** Deterministic migration cut used only to prove rollback after cold-table creation. */
  readonly afterColdTableCreated?: () => Effect.Effect<void, string>
  /** Deterministic transaction cut after copy verification and before hot deletion. */
  readonly afterRetirementCopy?: () => Effect.Effect<void, string>
  /** Deterministic lost-response seam after the retirement transaction commits. */
  readonly afterRetirementCommit?: () => Effect.Effect<void, string>
}

export { classifyJournalStorageFailure } from "./sqlite-store-errors.js"

/**
 * Production journal storage. The Effect SQLite driver owns one serialized
 * connection; WAL and exclusive locking are configured before the store is
 * exposed, so all acknowledged appends pass through one live writer.
 */
const sqliteJournalStoreLayerInternal = (config: SqliteJournalStoreConfig, testConfig?: SqliteJournalTestConfig) =>
  journalStoreCapabilities(
    Layer.effect(
      JournalStore,
      Effect.gen(function* () {
        const sql = yield* SqliteClient.make({ disableWAL: false, filename: config.filename }).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterrupts(cause),
            (cause) => Effect.fail(classifyJournalStorageFailure("JournalStore.open", cause))
          )
        )
        yield* migrateJournal(sql, testConfig?.afterColdTableCreated)
        yield* acquireExclusiveJournalWriter(sql)
        const queries = makeSqliteJournalQueries(sql, testConfig?.beforeReadLoad)
        const { hasPartitionRows, insertLifecycleRecord, loadRunRecords, scanPartition } = queries

        const beginRun = Effect.fn("JournalStore.Sqlite.beginRun")(function* (
          runId: RunId,
          target: TrackerTarget,
          initialControlPolicy: InitialControlPolicy
        ) {
          return yield* Effect.gen(function* () {
            const existing = yield* loadRunRecords(runId, "JournalStore.beginRun")
            const decision = decideWorkflowRunBeginning(existing, runId, target, initialControlPolicy)
            if (decision._tag === "LifecycleTransitionRejected") {
              return yield* decision.failure
            }
            const record = decision.record
            yield* insertLifecycleRecord(record)
            return record
          }).pipe(
            sql.withTransaction,
            Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.beginRun", cause))
          )
        })

        const append = Effect.fn("JournalStore.Sqlite.append")(function* (
          runId: RunId,
          key: JournalRecordKey,
          event: AppendableWorkflowJournalEvent
        ) {
          const encoded = encodeJournalEvent(event)
          return yield* Effect.gen(function* () {
            const cold = yield* hasPartitionRows("Cold", runId, "JournalStore.append")
            const records = yield* loadRunRecords(runId, "JournalStore.append")
            const terminated = records.find(({ event: recorded }) => recorded._tag === "WorkflowRunTerminated")
            if (terminated !== undefined) {
              return yield* new WorkflowRunAlreadyTerminated({ runId, terminatedAt: terminated.position })
            }
            /* v8 ignore next -- @preserve Cold load validation fails malformed/nonterminal history before this branch; valid terminal Cold history has already matched terminated above. */
            if (cold) {
              return yield* new JournalHistoryCorruption({
                detail: "cold partition contains nonterminal history",
                operation: "JournalStore.append",
                partition: "Cold",
                runId
              })
            }
            const existing = yield* queries.findExistingRecord(runId, key)
            if (existing !== undefined) {
              if (equalJournalEvents(existing.event, event)) {
                return { event, key, position: existing.position, runId } satisfies JournalRecord
              }
              return yield* new JournalStoreContradiction({ existingPosition: existing.position, key, runId })
            }
            const position = yield* queries.nextPosition(runId)
            yield* sql`
            INSERT INTO journal_records (
              run_id, position, record_key, event_kind, event_version, payload_json
            ) VALUES (
              ${runId}, ${position}, ${key}, ${encoded.kind}, ${encoded.version}, ${encoded.payloadJson}
            )
          `
            return { event, key, position, runId } satisfies JournalRecord
          }).pipe(
            sql.withTransaction,
            Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.append", cause))
          )
        })

        const read = Effect.fn("JournalStore.Sqlite.read")(function* (runId: RunId) {
          return yield* loadRunRecords(runId, "JournalStore.read").pipe(
            sql.withTransaction,
            Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.read", cause))
          )
        })

        const readRunForRecovery = Effect.fn("JournalStore.Sqlite.readRunForRecovery")(function* (
          runId: RunId,
          target: TrackerTarget
        ) {
          return yield* readRecoverableRunBeginning(
            yield* loadRunRecords(runId, "JournalStore.readRunForRecovery").pipe(
              sql.withTransaction,
              Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.readRunForRecovery", cause))
            ),
            runId,
            target
          )
        })

        const scanHot = Effect.fn("JournalStore.Sqlite.scanHot")(function* () {
          const result = yield* scanPartition("Hot", "JournalStore.scanHot")
          const invalidRunIds = new Set(result.issues.flatMap((issue) => (issue.runId === null ? [] : [issue.runId])))
          return {
            issues: result.issues,
            runs: result.runs
              .filter(({ runId }) => !invalidRunIds.has(runId))
              .map(({ records, runId }) => ({ records, runId }))
          }
        })

        const auditAll = Effect.fn("JournalStore.Sqlite.auditAll")(function* () {
          return yield* Effect.gen(function* () {
            const hot = yield* scanPartition("Hot", "JournalStore.auditAll")
            const cold = yield* scanPartition("Cold", "JournalStore.auditAll")
            const contradictoryRunId = [...hot.rowRunIds].find((candidate) => cold.rowRunIds.has(candidate))
            if (contradictoryRunId !== undefined)
              return yield* new JournalPartitionContradiction({ runId: contradictoryRunId })
            return { issues: [...hot.issues, ...cold.issues], runs: [...hot.runs, ...cold.runs] }
          }).pipe(
            sql.withTransaction,
            Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.auditAll", cause))
          )
        })

        const retireSqlite = makeSqliteTerminalHistoryRetirement(sql, queries, testConfig?.afterRetirementCopy)
        const retireTerminalRun = Effect.fn("JournalStore.Sqlite.retireTerminalRun")(function* (runId: RunId) {
          return yield* retireSqlite(runId).pipe(
            sql.withTransaction,
            Effect.tap(() => testConfig?.afterRetirementCommit?.() ?? Effect.void),
            Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.retireTerminalRun", cause))
          )
        })

        const terminateRun = Effect.fn("JournalStore.Sqlite.terminateRun")(function* (
          runId: RunId,
          disposition: RunTerminationDisposition,
          evidence: RunFinalityEvidence
        ) {
          return yield* Effect.gen(function* () {
            const cold = yield* hasPartitionRows("Cold", runId, "JournalStore.terminateRun")
            const records = yield* loadRunRecords(runId, "JournalStore.terminateRun")
            const decision = decideWorkflowRunTermination(records, runId, disposition, evidence)
            if (decision._tag === "LifecycleTransitionRejected") {
              return yield* decision.failure
            }
            /* v8 ignore next -- @preserve Cold load validation fails malformed/nonterminal history before this branch; valid terminal Cold history is rejected by the lifecycle decision above. */
            if (cold) {
              return yield* new JournalHistoryCorruption({
                detail: "cold partition contains nonterminal history",
                operation: "JournalStore.terminateRun",
                partition: "Cold",
                runId
              })
            }
            const record = decision.record
            yield* insertLifecycleRecord(record)
            return record
          }).pipe(
            sql.withTransaction,
            Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.terminateRun", cause))
          )
        })

        return JournalStore.of({
          append,
          auditAll,
          beginRun,
          read,
          readRunForRecovery,
          retireTerminalRun,
          scanHot,
          terminateRun
        })
      })
    ).pipe(Layer.provide(Reactivity.layer))
  )

/** Opens production SQLite journal storage without test-only mutation seams. */
export const sqliteJournalStoreLayer = (config: SqliteJournalStoreConfig) => sqliteJournalStoreLayerInternal(config)

/** Complete test-only composition whose appends are not published through Journal. */
export const sqliteJournalTestLayer = (config: SqliteJournalTestConfig) =>
  unpublishedInRunJournalTestLayer.pipe(Layer.provideMerge(sqliteJournalStoreLayerInternal(config, config)))

export const journalDatabaseLocatorConfig = Config.schema(JournalDatabaseLocator, "DALPH_JOURNAL_DATABASE")

/** Opens production SQLite only after the coordinator holds the Git-directory lock. */
export const productionJournalStoreLayer = Layer.unwrap(
  Effect.gen(function* () {
    yield* CoordinatorOwnership
    const filename = yield* journalDatabaseLocatorConfig
    return sqliteJournalStoreLayer({ filename })
  })
)
