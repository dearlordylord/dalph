import { completedRunRecoveryFailure, RunCompletionTime } from "../completion.js"
import { makeSqliteCompletions } from "./sqlite-completion.js"
import type { AttemptBasePolicy } from "../../workflow/protocols/task-attempt-planning/base.js"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Cause, Clock, Config, Effect, Exit, HashMap, Layer, Option, Ref, Semaphore } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import type { RemotePublicationTarget, RunId } from "@dalph/contracts"
import { JournalDatabaseLocator, JournalPosition, type JournalRecordKey } from "../identity.js"
import { equalJournalEvents } from "../event-codec.js"
import { encodeSqliteJournalEvent as encodeJournalEvent } from "./sqlite-event-codec.js"
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
  WorkflowRunAlreadyBegan,
  WorkflowRunAlreadyTerminated
} from "../store.js"
import type { AppendableWorkflowJournalEvent, JournalRecord } from "../store.js"
import type { InitialControlPolicy } from "../../control/policy.js"
import type { RunFinalityEvidence, RunTerminationDisposition } from "../../coordination/frontier/run-finality.js"
import { classifyJournalMethodFailure, classifyJournalStorageFailure } from "./sqlite-store-errors.js"
import { acquireExclusiveJournalWriter, migrateJournal } from "./sqlite-store-migration.js"
import { makeSqliteDecodedHistoryEvidence, makeSqliteJournalQueries } from "./sqlite-store-queries.js"
import { makeSqliteTerminalHistoryRetirement } from "./sqlite-store-retirement.js"
import {
  appendSqliteStorageCheckpoint,
  snapshotFromSqliteStorageCheckpoint,
  type SqliteHotStorageCheckpoint,
  type SqliteStorageCheckpoint,
  type SqlitePartitionSnapshot
} from "./sqlite-storage-checkpoint.js"

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
  readonly onPartitionRowsQueried?: (partition: "Hot" | "Cold", runId: RunId, rowCount: number) => Effect.Effect<void>
  /** Deterministic lost-response or concurrency cut after append COMMIT and before checkpoint publication. */
  readonly beforeBackfillCommit?: () => Effect.Effect<void, string>
  readonly afterBackfillCommit?: () => Effect.Effect<void, string>
  readonly beforeCompletionCommit?: () => Effect.Effect<void, string>
  readonly afterCompletionCommit?: () => Effect.Effect<void, string>
  readonly afterAppendCommit?: () => Effect.Effect<void, string>
  /** Counts rows inserted through the append path. */
  readonly onAppendInserted?: (runId: RunId) => Effect.Effect<void>
  /** Counts process-local exact key lookups through the append path. */
  readonly onAppendKeyLookup?: (runId: RunId, key: JournalRecordKey) => Effect.Effect<void>
}

type SqliteAppendCheckpointDecision =
  | { readonly _tag: "Appendable"; readonly checkpoint: SqliteHotStorageCheckpoint }
  | { readonly _tag: "Rejected"; readonly error: WorkflowRunAlreadyTerminated }

const decideSqliteAppendCheckpoint = (
  checkpoint: SqliteStorageCheckpoint,
  runId: RunId
): SqliteAppendCheckpointDecision => {
  if (checkpoint.partition === "Cold") {
    return {
      _tag: "Rejected",
      error: new WorkflowRunAlreadyTerminated({ runId, terminatedAt: checkpoint.terminalPosition })
    }
  }
  if (checkpoint.terminalPosition !== undefined) {
    return {
      _tag: "Rejected",
      error: new WorkflowRunAlreadyTerminated({ runId, terminatedAt: checkpoint.terminalPosition })
    }
  }
  return { _tag: "Appendable", checkpoint }
}

/** The append transaction's typed outcome before it crosses the SQLite insert boundary. */
type SqliteAppendDecision =
  | { readonly _tag: "Replay"; readonly record: JournalRecord }
  | { readonly _tag: "Contradiction"; readonly error: JournalStoreContradiction }
  | { readonly _tag: "Insert"; readonly position: JournalPosition }

const decideSqliteAppend = (
  checkpoint: SqliteStorageCheckpoint,
  runId: RunId,
  key: JournalRecordKey,
  event: AppendableWorkflowJournalEvent
): SqliteAppendDecision => {
  const existing = HashMap.get(checkpoint.recordsByKey, key)
  if (Option.isNone(existing)) {
    return { _tag: "Insert", position: JournalPosition.make((checkpoint.decodedThrough ?? 0) + 1) }
  }
  const evidence = existing.value
  if (equalJournalEvents(evidence.event, event)) {
    return { _tag: "Replay", record: { event, key, position: evidence.position, runId } satisfies JournalRecord }
  }
  return {
    _tag: "Contradiction",
    error: new JournalStoreContradiction({ existingPosition: evidence.position, key, runId })
  }
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
        const queries = makeSqliteJournalQueries(sql, testConfig?.beforeReadLoad, testConfig?.onPartitionRowsQueried)
        const {
          hasPartitionRows,
          insertLifecycleRecord,
          loadRunRecords,
          loadRunSnapshot,
          loadRunSnapshotForPartition,
          locateRunPartition,
          scanPartition
        } = queries
        const completions = makeSqliteCompletions(sql, queries)
        yield* completions.reconcile().pipe(
          Effect.tap(() => testConfig?.beforeBackfillCommit?.() ?? Effect.void),
          sql.withTransaction,
          Effect.tap(() => testConfig?.afterBackfillCommit?.() ?? Effect.void),
          Effect.mapError((failure) => classifyJournalMethodFailure("JournalStore.readCompletion", failure))
        )
        const serialization = yield* Semaphore.make(1)
        const readCompletion = (runId: RunId) =>
          serialization.withPermit(
            completions.read(runId).pipe(
              sql.withTransaction,
              Effect.mapError((failure) => classifyJournalMethodFailure("JournalStore.readCompletion", failure))
            )
          )
        const checkpoints = yield* Ref.make(HashMap.empty<RunId, SqliteStorageCheckpoint>())
        const readSnapshots = yield* Ref.make(HashMap.empty<RunId, SqlitePartitionSnapshot>())
        const invalidateRead = (runId: RunId) => Ref.update(readSnapshots, HashMap.remove(runId))
        const invalidate = (runId: RunId) =>
          Ref.update(checkpoints, HashMap.remove(runId)).pipe(Effect.andThen(invalidateRead(runId)))
        const invalidateAll = Ref.set(checkpoints, HashMap.empty()).pipe(
          Effect.andThen(Ref.set(readSnapshots, HashMap.empty()))
        )
        const publish = (checkpoint: SqliteStorageCheckpoint) =>
          Ref.update(checkpoints, HashMap.set(checkpoint.runId, checkpoint))

        const loadCurrentSnapshot = Effect.fn("JournalStore.Sqlite.loadCurrentSnapshot")(function* (
          runId: RunId,
          operation: Parameters<typeof loadRunSnapshot>[1]
        ) {
          const partition = yield* locateRunPartition(runId, operation)
          const current = HashMap.get(yield* Ref.get(checkpoints), runId)
          if (Option.isSome(current) && current.value.partition === partition) return current.value
          return (yield* loadRunSnapshotForPartition(partition, runId, operation)).checkpoint
        })

        const beginRun = Effect.fn("JournalStore.Sqlite.beginRun")(function* (
          runId: RunId,
          target: TrackerTarget,
          initialControlPolicy: InitialControlPolicy,
          remotePublicationTarget: RemotePublicationTarget,
          attemptBasePolicy?: AttemptBasePolicy
        ) {
          return yield* serialization.withPermit(
            Effect.gen(function* () {
              const completion = yield* completions.read(runId)
              if (completion._tag === "CompletedRun")
                return yield* new WorkflowRunAlreadyBegan({ runId, beganAt: JournalPosition.make(1) })
              const existing = yield* loadRunRecords(runId, "JournalStore.beginRun")
              const decision = decideWorkflowRunBeginning(
                existing,
                runId,
                target,
                initialControlPolicy,
                remotePublicationTarget,
                attemptBasePolicy
              )
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
              const completion = yield* completions.read(runId)
              if (completion._tag === "CompletedRun")
                return yield* new WorkflowRunAlreadyTerminated({
                  runId,
                  terminatedAt: completion.completion.terminatedAt
                })
              const checkpoint = yield* loadCurrentSnapshot(runId, "JournalStore.append")
              const checkpointDecision = decideSqliteAppendCheckpoint(checkpoint, runId)
              if (checkpointDecision._tag === "Rejected") return yield* checkpointDecision.error
              const appendableCheckpoint = checkpointDecision.checkpoint
              if (testConfig?.onAppendKeyLookup !== undefined) yield* testConfig.onAppendKeyLookup(runId, key)
              const decision = decideSqliteAppend(appendableCheckpoint, runId, key, event)
              if (decision._tag === "Contradiction") return yield* decision.error
              if (decision._tag === "Replay") return { checkpoint: appendableCheckpoint, record: decision.record }
              const { position } = decision
              yield* sql`
            INSERT INTO journal_records (
              run_id, position, record_key, event_kind, event_version, payload_json
            ) VALUES (
              ${runId}, ${position}, ${key}, ${encoded.kind}, ${encoded.version}, ${encoded.payloadJson}
            )
          `
              if (testConfig?.onAppendInserted !== undefined) yield* testConfig.onAppendInserted(runId)
              const record = { event, key, position, runId } satisfies JournalRecord
              return { checkpoint: appendSqliteStorageCheckpoint(appendableCheckpoint, record), record }
            }).pipe(
              sql.withTransaction,
              Effect.tap(() => testConfig?.afterAppendCommit?.() ?? Effect.void),
              Effect.tap(({ checkpoint }) => publish(checkpoint)),
              Effect.ensuring(invalidateRead(runId)),
              Effect.map(({ record }) => record),
              Effect.onExit((exit) => (Exit.isFailure(exit) ? invalidate(runId) : Effect.void)),
              Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.append", cause))
            )
          )
        })

        const read = Effect.fn("JournalStore.Sqlite.read")(function* (runId: RunId) {
          return yield* serialization.withPermit(
            Effect.gen(function* () {
              const partition = yield* locateRunPartition(runId, "JournalStore.read")
              const cached = HashMap.get(yield* Ref.get(readSnapshots), runId)
              if (Option.isSome(cached) && cached.value.checkpoint.partition === partition) return cached.value
              const checkpoint = HashMap.get(yield* Ref.get(checkpoints), runId)
              return Option.isSome(checkpoint) && checkpoint.value.partition === partition
                ? snapshotFromSqliteStorageCheckpoint(checkpoint.value)
                : yield* loadRunSnapshotForPartition(partition, runId, "JournalStore.read")
            }).pipe(
              sql.withTransaction,
              Effect.tap((snapshot) =>
                publish(snapshot.checkpoint).pipe(
                  Effect.andThen(Ref.update(readSnapshots, HashMap.set(runId, snapshot)))
                )
              ),
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
              const completion = yield* completions.read(runId)
              const failure = completedRunRecoveryFailure(runId, target, completion)
              if (failure !== undefined) return yield* failure
              const snapshot = yield* loadRunSnapshot(runId, "JournalStore.readRunForRecovery").pipe(
                sql.withTransaction,
                Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.readRunForRecovery", cause))
              )
              yield* publish(snapshot.checkpoint)
              return yield* readRecoverableRunBeginning(snapshot.records, runId, target)
            }).pipe(
              Effect.ensuring(invalidateRead(runId)),
              Effect.onExit((exit) => (Exit.isFailure(exit) ? invalidate(runId) : Effect.void)),
              Effect.mapError((failure) => classifyJournalMethodFailure("JournalStore.readRunForRecovery", failure))
            )
          )
        })

        const scanHot = Effect.fn("JournalStore.Sqlite.scanHot")(function* (retainRunId?: RunId) {
          return yield* serialization.withPermit(
            Effect.gen(function* () {
              yield* invalidateAll
              const result = yield* scanPartition("Hot", "JournalStore.scanHot")
              const invalidRunIds = new Set(
                result.issues.flatMap((issue) => (issue.runId === null ? [] : [issue.runId]))
              )
              const selected = result.runs.find(({ runId }) => runId === retainRunId && !invalidRunIds.has(runId))
              if (selected !== undefined) {
                if (yield* hasPartitionRows("Cold", selected.runId, "JournalStore.scanHot")) {
                  return yield* new JournalPartitionContradiction({ runId: selected.runId })
                }
                const evidence = yield* makeSqliteDecodedHistoryEvidence(
                  selected.records,
                  "Hot",
                  selected.runId,
                  "JournalStore.scanHot"
                )
                yield* publish({
                  decodedThrough: evidence.decodedThrough,
                  partition: "Hot",
                  recordsByKey: evidence.recordsByKey,
                  runId: selected.runId,
                  terminalPosition: evidence.terminalPosition
                })
              }
              return {
                issues: result.issues,
                runs: result.runs
                  .filter(({ runId }) => !invalidRunIds.has(runId))
                  .map(({ records, runId }) => ({ records, runId }))
              }
            }).pipe(
              Effect.onExit((exit) => (Exit.isFailure(exit) ? invalidateAll : Effect.void)),
              Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.scanHot", cause))
            )
          )
        })

        const auditAll = Effect.fn("JournalStore.Sqlite.auditAll")(function* () {
          return yield* serialization.withPermit(
            Effect.gen(function* () {
              const hot = yield* scanPartition("Hot", "JournalStore.auditAll")
              const cold = yield* scanPartition("Cold", "JournalStore.auditAll")
              const contradictoryRunId = [...hot.rowRunIds].find((candidate) => cold.rowRunIds.has(candidate))
              if (contradictoryRunId !== undefined)
                return yield* new JournalPartitionContradiction({ runId: contradictoryRunId })
              const audit = { issues: [...hot.issues, ...cold.issues], runs: [...hot.runs, ...cold.runs] }
              yield* completions.audit(audit)
              return audit
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
              Effect.tap(() => completions.read(runId)),
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
              const completion = yield* completions.read(runId)
              if (completion._tag === "CompletedRun")
                return yield* new WorkflowRunAlreadyTerminated({
                  runId,
                  terminatedAt: completion.completion.terminatedAt
                })
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
              yield* completions.save(runId, [...records, record], {
                _tag: "Known",
                completedAt: RunCompletionTime.make(yield* Clock.currentTimeMillis)
              })
              yield* testConfig?.beforeCompletionCommit?.() ?? Effect.void
              return record
            }).pipe(
              sql.withTransaction,
              Effect.ensuring(invalidate(runId)),
              Effect.tap(() => testConfig?.afterCompletionCommit?.() ?? Effect.void),
              Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.terminateRun", cause))
            )
          )
        })

        return JournalStore.of({
          readCompletion,
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
