import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Cause, Config, Effect, Exit, HashMap, Layer, Option, Ref, Semaphore } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import type { RunId } from "@dalph/contracts"
import { JournalDatabaseLocator, JournalPosition, type JournalRecordKey } from "../identity.js"
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
import { appendSqliteStorageCheckpoint, type SqliteStorageCheckpoint } from "./sqlite-storage-checkpoint.js"

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
  /** Counts complete partition loads without exposing mutable adapter state. */
  readonly onPartitionLoaded?: (partition: "Hot" | "Cold", runId: RunId, rowCount: number) => Effect.Effect<void>
  /** Deterministic lost-response or concurrency cut after append COMMIT and before checkpoint publication. */
  readonly afterAppendCommit?: () => Effect.Effect<void, string>
  /** Counts rows inserted through the append path. */
  readonly onAppendInserted?: (runId: RunId) => Effect.Effect<void>
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
        const queries = makeSqliteJournalQueries(sql, testConfig?.beforeReadLoad, testConfig?.onPartitionLoaded)
        const { hasPartitionRows, insertLifecycleRecord, loadRunRecords, loadRunSnapshot, scanPartition } = queries
        const serialization = yield* Semaphore.make(1)
        const checkpoints = yield* Ref.make(HashMap.empty<RunId, SqliteStorageCheckpoint>())
        const invalidate = (runId: RunId) => Ref.update(checkpoints, HashMap.remove(runId))
        const invalidateAll = Ref.set(checkpoints, HashMap.empty())
        const publish = (checkpoint: SqliteStorageCheckpoint) =>
          Ref.update(checkpoints, HashMap.set(checkpoint.runId, checkpoint))

        const loadCurrentSnapshot = Effect.fn("JournalStore.Sqlite.loadCurrentSnapshot")(function* (
          runId: RunId,
          operation: Parameters<typeof loadRunSnapshot>[1]
        ) {
          const hot = yield* hasPartitionRows("Hot", runId, operation)
          const cold = yield* hasPartitionRows("Cold", runId, operation)
          if (hot && cold) return yield* new JournalPartitionContradiction({ runId })
          const partition = cold ? "Cold" : "Hot"
          const current = HashMap.get(yield* Ref.get(checkpoints), runId)
          if (Option.isSome(current) && current.value.partition === partition) return current.value
          return (yield* loadRunSnapshot(runId, operation)).checkpoint
        })

        const beginRun = Effect.fn("JournalStore.Sqlite.beginRun")(function* (
          runId: RunId,
          target: TrackerTarget,
          initialControlPolicy: InitialControlPolicy
        ) {
          return yield* serialization.withPermit(
            Effect.gen(function* () {
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
              Effect.ensuring(invalidate(runId)),
              Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.beginRun", cause))
            )
          )
        })

        const append = Effect.fn("JournalStore.Sqlite.append")(function* (
          runId: RunId,
          key: JournalRecordKey,
          event: AppendableWorkflowJournalEvent
        ) {
          const encoded = encodeJournalEvent(event)
          return yield* serialization.withPermit(
            Effect.gen(function* () {
              const checkpoint = yield* loadCurrentSnapshot(runId, "JournalStore.append")
              if (checkpoint.terminalPosition !== undefined) {
                return yield* new WorkflowRunAlreadyTerminated({ runId, terminatedAt: checkpoint.terminalPosition })
              }
              /* v8 ignore next -- @preserve a decoded Cold snapshot must contain a terminal record. */
              if (checkpoint.partition === "Cold") {
                return yield* new JournalHistoryCorruption({
                  detail: "cold partition contains nonterminal history",
                  operation: "JournalStore.append",
                  partition: "Cold",
                  runId
                })
              }
              const existing = HashMap.get(checkpoint.recordsByKey, key)
              if (Option.isSome(existing)) {
                const evidence = existing.value
                if (equalJournalEvents(evidence.event, event)) {
                  return {
                    checkpoint,
                    record: { event, key, position: evidence.position, runId } satisfies JournalRecord
                  }
                }
                return yield* new JournalStoreContradiction({ existingPosition: evidence.position, key, runId })
              }
              const position = JournalPosition.make((checkpoint.decodedThrough ?? 0) + 1)
              yield* sql`
            INSERT INTO journal_records (
              run_id, position, record_key, event_kind, event_version, payload_json
            ) VALUES (
              ${runId}, ${position}, ${key}, ${encoded.kind}, ${encoded.version}, ${encoded.payloadJson}
            )
          `
              if (testConfig?.onAppendInserted !== undefined) yield* testConfig.onAppendInserted(runId)
              const record = { event, key, position, runId } satisfies JournalRecord
              return { checkpoint: appendSqliteStorageCheckpoint(checkpoint, record, encoded), record }
            }).pipe(
              sql.withTransaction,
              Effect.tap(() => testConfig?.afterAppendCommit?.() ?? Effect.void),
              Effect.tap(({ checkpoint }) => publish(checkpoint)),
              Effect.map(({ record }) => record),
              Effect.onExit((exit) => (Exit.isFailure(exit) ? invalidate(runId) : Effect.void)),
              Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.append", cause))
            )
          )
        })

        const read = Effect.fn("JournalStore.Sqlite.read")(function* (runId: RunId) {
          return yield* serialization.withPermit(
            loadRunSnapshot(runId, "JournalStore.read").pipe(
              sql.withTransaction,
              Effect.tap(({ checkpoint }) => publish(checkpoint)),
              Effect.map(({ records }) => records),
              Effect.onExit((exit) => (Exit.isFailure(exit) ? invalidate(runId) : Effect.void)),
              Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.read", cause))
            )
          )
        })

        const readRunForRecovery = Effect.fn("JournalStore.Sqlite.readRunForRecovery")(function* (
          runId: RunId,
          target: TrackerTarget
        ) {
          return yield* serialization.withPermit(
            Effect.gen(function* () {
              const snapshot = yield* loadRunSnapshot(runId, "JournalStore.readRunForRecovery").pipe(
                sql.withTransaction,
                Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.readRunForRecovery", cause))
              )
              yield* publish(snapshot.checkpoint)
              return yield* readRecoverableRunBeginning(snapshot.records, runId, target)
            }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? invalidate(runId) : Effect.void)))
          )
        })

        const scanHot = Effect.fn("JournalStore.Sqlite.scanHot")(function* () {
          const result = yield* serialization.withPermit(
            scanPartition("Hot", "JournalStore.scanHot").pipe(Effect.ensuring(invalidateAll))
          )
          const invalidRunIds = new Set(result.issues.flatMap((issue) => (issue.runId === null ? [] : [issue.runId])))
          return {
            issues: result.issues,
            runs: result.runs
              .filter(({ runId }) => !invalidRunIds.has(runId))
              .map(({ records, runId }) => ({ records, runId }))
          }
        })

        const auditAll = Effect.fn("JournalStore.Sqlite.auditAll")(function* () {
          return yield* serialization.withPermit(
            Effect.gen(function* () {
              const hot = yield* scanPartition("Hot", "JournalStore.auditAll")
              const cold = yield* scanPartition("Cold", "JournalStore.auditAll")
              const contradictoryRunId = [...hot.rowRunIds].find((candidate) => cold.rowRunIds.has(candidate))
              if (contradictoryRunId !== undefined)
                return yield* new JournalPartitionContradiction({ runId: contradictoryRunId })
              return { issues: [...hot.issues, ...cold.issues], runs: [...hot.runs, ...cold.runs] }
            }).pipe(
              sql.withTransaction,
              Effect.ensuring(invalidateAll),
              Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.auditAll", cause))
            )
          )
        })

        const retireSqlite = makeSqliteTerminalHistoryRetirement(sql, queries, testConfig?.afterRetirementCopy)
        const retireTerminalRun = Effect.fn("JournalStore.Sqlite.retireTerminalRun")(function* (runId: RunId) {
          return yield* serialization.withPermit(
            retireSqlite(runId).pipe(
              sql.withTransaction,
              Effect.tap(() => testConfig?.afterRetirementCommit?.() ?? Effect.void),
              Effect.ensuring(invalidate(runId)),
              Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.retireTerminalRun", cause))
            )
          )
        })

        const terminateRun = Effect.fn("JournalStore.Sqlite.terminateRun")(function* (
          runId: RunId,
          disposition: RunTerminationDisposition,
          evidence: RunFinalityEvidence
        ) {
          return yield* serialization.withPermit(
            Effect.gen(function* () {
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
              Effect.ensuring(invalidate(runId)),
              Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.terminateRun", cause))
            )
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
