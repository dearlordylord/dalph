/* eslint-disable functional/immutable-data -- Scan accumulation is private adapter scratch and never becomes journal authority. */
/* eslint-disable max-lines -- SQLite transaction, decoding, and failure classification stay in one adapter boundary. */
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator"
import { Cause, Config, Effect, Layer, Match, Result, Schema } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import * as SqlError from "effect/unstable/sql/SqlError"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { RunId } from "@dalph/contracts"
import { JournalDatabaseLocator, JournalPosition, JournalRecordKey, JournalSchemaVersion } from "../identity.js"
import type { JournalPartition } from "../identity.js"
import { JournalEventKind, JournalEventVersion } from "../../workflow/kernel/event.js"
import { decodeJournalEvent, encodeJournalEvent, equalJournalEvents } from "../event-codec.js"
import { JournalBoundaryDecodeIssue, JournalSemanticIssue, type JournalAudit } from "../recovery-model.js"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import {
  decideWorkflowRunBeginning,
  decideWorkflowRunTermination,
  readRecoverableRunBeginning
} from "../run-lifecycle.js"
import { workflowJournalHistoryIssueDetail } from "../../coordination/reconstruction/history-result.js"
import { reduceWorkflowJournalHistory } from "../../coordination/reconstruction/history.js"
import {
  journalStoreCapabilities,
  unpublishedInRunJournalTestLayer,
  JournalDataCorruption,
  JournalHistoryNotTerminal,
  JournalPartitionContradiction,
  JournalSchemaIncompatible,
  JournalStorageAccessDenied,
  JournalStorageCapacityExhausted,
  JournalStorageLocked,
  JournalStorageUnavailable,
  JournalStore,
  JournalStoreContradiction,
  WorkflowRunAlreadyBegan,
  WorkflowRunAlreadyTerminated,
  WorkflowRunIdentityAlreadyUsed,
  WorkflowRunNotBegan,
  WorkflowRunTargetMismatch,
  WorkflowRunTerminationEvidenceInvalid
} from "../store.js"
import type { AppendableWorkflowJournalEvent, JournalRecord, JournalStoreError } from "../store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import type { InitialControlPolicy } from "../../control/policy.js"
import type { RunFinalityEvidence, RunTerminationDisposition } from "../../coordination/frontier/run-finality.js"

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
const MigrationVersionRows = Schema.Tuple([Schema.Struct({ schema_version: JournalSchemaVersion })])
const RetirementVerificationRows = Schema.Tuple([
  Schema.Struct({ cold_count: Schema.Int, extra_count: Schema.Int, hot_count: Schema.Int, missing_count: Schema.Int })
])

const currentJournalSchemaVersionValue = 2
const journalSchemaVersion = JournalSchemaVersion.make(currentJournalSchemaVersionValue)
const journalMigrationId = 2
const lastRecordIndex = -1
const sqliteResultCodeModulus = 256
const sqliteResultCode = {
  accessDenied: 3,
  busy: 5,
  capacityExhausted: 13,
  corrupt: 11,
  locked: 6,
  notADatabase: 26,
  readonly: 8,
  unauthorized: 23
} as const

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
}

type StoreOperation =
  | "JournalStore.append"
  | "JournalStore.beginRun"
  | "JournalStore.read"
  | "JournalStore.readRunForRecovery"
  | "JournalStore.terminateRun"
  | "JournalStore.scanHot"
  | "JournalStore.auditAll"
  | "JournalStore.retireTerminalRun"

const failureDetail = (cause: unknown): string => (Cause.isCause(cause) ? Cause.pretty(cause) : String(cause))

const sqliteCause = (failure: unknown): unknown => {
  const squashed = Cause.isCause(failure) ? Cause.squash(failure) : failure
  return SqlError.isSqlError(squashed) ? squashed.reason.cause : squashed
}

const sqlitePrimaryResultCode = (failure: unknown): number | undefined => {
  const cause = sqliteCause(failure)
  if (typeof cause !== "object" || cause === null) return undefined
  if ("errcode" in cause && typeof cause.errcode === "number") {
    return cause.errcode % sqliteResultCodeModulus
  }
  if ("errno" in cause && typeof cause.errno === "number") {
    return cause.errno % sqliteResultCodeModulus
  }
  return undefined
}

/** Classifies SQLite result codes into recovery-relevant journal failures. */
export const classifyJournalStorageFailure = (
  operation: JournalStorageUnavailable["operation"],
  failure: unknown
): JournalStoreError => {
  const fields = { detail: failureDetail(failure), operation }
  return Match.value(sqlitePrimaryResultCode(failure)).pipe(
    Match.whenOr(sqliteResultCode.busy, sqliteResultCode.locked, () => new JournalStorageLocked(fields)),
    Match.whenOr(
      sqliteResultCode.accessDenied,
      sqliteResultCode.readonly,
      sqliteResultCode.unauthorized,
      () => new JournalStorageAccessDenied(fields)
    ),
    Match.when(sqliteResultCode.capacityExhausted, () => new JournalStorageCapacityExhausted(fields)),
    Match.whenOr(sqliteResultCode.corrupt, sqliteResultCode.notADatabase, () => new JournalDataCorruption(fields)),
    Match.orElse(() => new JournalStorageUnavailable(fields))
  )
}

function classifyJournalMethodFailure(
  operation: "JournalStore.beginRun",
  cause: unknown
): JournalStoreError | WorkflowRunAlreadyBegan | WorkflowRunIdentityAlreadyUsed
function classifyJournalMethodFailure(
  operation: "JournalStore.append",
  cause: unknown
): JournalStoreContradiction | JournalStoreError | WorkflowRunAlreadyTerminated | JournalPartitionContradiction
function classifyJournalMethodFailure(operation: "JournalStore.read", cause: unknown): JournalStoreError
function classifyJournalMethodFailure(
  operation: "JournalStore.readRunForRecovery",
  cause: unknown
): JournalStoreError | WorkflowRunAlreadyTerminated | WorkflowRunNotBegan | WorkflowRunTargetMismatch
function classifyJournalMethodFailure(
  operation: "JournalStore.scanHot" | "JournalStore.auditAll",
  cause: unknown
): JournalStoreError | JournalPartitionContradiction
function classifyJournalMethodFailure(
  operation: "JournalStore.terminateRun",
  cause: unknown
): JournalStoreError | WorkflowRunAlreadyTerminated | WorkflowRunNotBegan | WorkflowRunTerminationEvidenceInvalid
function classifyJournalMethodFailure(
  operation: "JournalStore.retireTerminalRun",
  cause: unknown
): JournalStoreError | WorkflowRunNotBegan | JournalHistoryNotTerminal | JournalPartitionContradiction
function classifyJournalMethodFailure(operation: JournalStorageUnavailable["operation"], cause: unknown) {
  return Match.value(cause).pipe(
    Match.whenOr(
      Match.instanceOf(JournalStoreContradiction),
      Match.instanceOf(WorkflowRunAlreadyBegan),
      Match.instanceOf(WorkflowRunAlreadyTerminated),
      Match.instanceOf(WorkflowRunIdentityAlreadyUsed),
      Match.instanceOf(WorkflowRunNotBegan),
      Match.instanceOf(WorkflowRunTargetMismatch),
      Match.instanceOf(WorkflowRunTerminationEvidenceInvalid),
      Match.instanceOf(JournalHistoryNotTerminal),
      Match.instanceOf(JournalPartitionContradiction),
      Match.instanceOf(JournalDataCorruption),
      Match.instanceOf(JournalSchemaIncompatible),
      Match.instanceOf(JournalStorageAccessDenied),
      Match.instanceOf(JournalStorageCapacityExhausted),
      Match.instanceOf(JournalStorageLocked),
      Match.instanceOf(JournalStorageUnavailable),
      (failure) => failure
    ),
    Match.orElse((failure) => classifyJournalStorageFailure(operation, failure))
  )
}

const decodeBoundary = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: JournalDataCorruption["operation"]
): Effect.Effect<A, JournalDataCorruption> =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((cause) => new JournalDataCorruption({ detail: String(cause), operation }))
  )

const parseEvent = (
  row: Pick<PersistedJournalRow, "event_kind" | "event_version" | "payload_json">,
  operation: JournalDataCorruption["operation"]
): Effect.Effect<WorkflowJournalEvent, JournalDataCorruption> =>
  decodeJournalEvent({ kind: row.event_kind, payloadJson: row.payload_json, version: row.event_version }).pipe(
    Effect.mapError((cause) => new JournalDataCorruption({ detail: cause.detail, operation }))
  )

const fromPersistedRow = Effect.fn("JournalStore.Sqlite.fromPersistedRow")(function* (row: PersistedJournalRow) {
  // Effect Schema proves that one physical row and event payload decode. It
  // does not prove that the ordered log is semantically recoverable. Issue
  // #50 owns the total history fold that must return a valid recovery state
  // or typed, accumulated issues for illegal transitions and contradictions.
  // https://github.com/dearlordylord/dalph/issues/50
  return {
    event: yield* parseEvent(row, "JournalStore.read"),
    key: row.record_key,
    position: row.position,
    runId: row.run_id
  } satisfies JournalRecord
})

const validateColdHistory = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  operation: StoreOperation
): Effect.Effect<ReadonlyArray<JournalRecord>, JournalDataCorruption> => {
  const reduction = reduceWorkflowJournalHistory(runId, records)
  if (reduction._tag === "InvalidWorkflowJournalHistory") {
    return Effect.fail(
      new JournalDataCorruption({
        detail: reduction.issues.map(workflowJournalHistoryIssueDetail).join("; "),
        operation
      })
    )
  }
  if (reduction.records.at(lastRecordIndex)?.event._tag !== "WorkflowRunTerminated") {
    return Effect.fail(new JournalDataCorruption({ detail: "Cold history is not terminal", operation }))
  }
  return Effect.succeed(records)
}

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

const addSemanticScanIssues = (
  partition: JournalPartition,
  recordsByRun: ReadonlyMap<RunId, ReadonlyArray<JournalRecord>>,
  issues: Array<JournalAudit["issues"][number]>
) => {
  for (const [runId, records] of recordsByRun) {
    const reduction = reduceWorkflowJournalHistory(runId, records)
    if (reduction._tag === "InvalidWorkflowJournalHistory") {
      issues.push(
        new JournalSemanticIssue({
          detail: reduction.issues.map(workflowJournalHistoryIssueDetail).join("; "),
          partition,
          runId
        })
      )
    } else if (partition === "Cold" && reduction.records.at(lastRecordIndex)?.event._tag !== "WorkflowRunTerminated") {
      issues.push(new JournalSemanticIssue({ detail: "Cold history is not terminal", partition, runId }))
    }
  }
}

const migrate = Effect.fn("JournalStore.Sqlite.migrate")(function* (
  sql: SqliteClient.SqliteClient,
  afterColdTableCreated: (() => Effect.Effect<void, string>) | undefined
) {
  yield* sql`PRAGMA locking_mode = EXCLUSIVE`.pipe(
    Effect.mapError(classifyJournalStorageFailure.bind(undefined, "JournalStore.migrate"))
  )
  const createCurrentJournal = Effect.gen(function* () {
    const migrationSql = yield* SqlClient.SqlClient
    yield* migrationSql`
      CREATE TABLE IF NOT EXISTS journal_records (
        run_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 1),
        record_key TEXT NOT NULL,
        event_kind TEXT NOT NULL,
        event_version INTEGER NOT NULL CHECK (event_version >= 1),
        payload_json TEXT NOT NULL,
        PRIMARY KEY (run_id, position),
        UNIQUE (run_id, record_key)
      ) STRICT
    `
    yield* migrationSql`PRAGMA user_version = ${migrationSql.literal("1")}`
  })
  const createColdJournal = Effect.gen(function* () {
    const migrationSql = yield* SqlClient.SqlClient
    yield* migrationSql`
      CREATE TABLE IF NOT EXISTS journal_records_cold (
        run_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 1),
        record_key TEXT NOT NULL,
        event_kind TEXT NOT NULL,
        event_version INTEGER NOT NULL CHECK (event_version >= 1),
        payload_json TEXT NOT NULL,
        PRIMARY KEY (run_id, position),
        UNIQUE (run_id, record_key)
      ) STRICT
    `
    if (afterColdTableCreated !== undefined) yield* afterColdTableCreated()
    yield* migrationSql`PRAGMA user_version = ${migrationSql.literal(String(currentJournalSchemaVersionValue))}`
  })
  yield* SqliteMigrator.run({
    loader: Effect.succeed([
      [1, "create_current_journal_records", Effect.succeed(createCurrentJournal)],
      [journalMigrationId, "create_cold_journal_records", Effect.succeed(createColdJournal)]
    ]),
    table: "effect_sql_migrations"
  }).pipe(
    Effect.provideService(SqlClient.SqlClient, sql),
    Effect.catchCause((cause) => {
      const failure = Cause.squash(cause)
      return Effect.fail(
        /* v8 ignore next -- @preserve SqliteMigrator wraps every loader/migration failure in MigrationError; this fallback only protects a future driver contract change. */
        failure instanceof SqliteMigrator.MigrationError
          ? new JournalDataCorruption({ detail: failure.message, operation: "JournalStore.migrate" })
          : classifyJournalStorageFailure("JournalStore.migrate", cause)
      )
    })
  )
  const versions = yield* sql`
    SELECT COALESCE(MAX(migration_id), 0) AS schema_version
    FROM effect_sql_migrations
  `.pipe(
    Effect.mapError(classifyJournalStorageFailure.bind(undefined, "JournalStore.migrate")),
    Effect.flatMap((rows) => decodeBoundary(MigrationVersionRows, rows, "JournalStore.migrate"))
  )
  const version = versions[0].schema_version
  if (version > journalSchemaVersion) {
    return yield* new JournalSchemaIncompatible({ found: version, supported: journalSchemaVersion })
  }
})

const acquireExclusiveWriter = Effect.fn("JournalStore.Sqlite.acquireExclusiveWriter")(function* (
  sql: SqliteClient.SqliteClient
) {
  yield* sql`UPDATE effect_sql_migrations SET name = name WHERE migration_id = ${journalSchemaVersion}`.pipe(
    sql.withTransaction,
    Effect.mapError(classifyJournalStorageFailure.bind(undefined, "JournalStore.open"))
  )
})

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
        yield* migrate(sql, testConfig?.afterColdTableCreated)
        yield* acquireExclusiveWriter(sql)

        const loadPartitionRecords = Effect.fn("JournalStore.Sqlite.loadPartitionRecords")(function* (
          partition: JournalPartition,
          runId: RunId,
          operation: StoreOperation
        ) {
          const rows = yield* (
            partition === "Hot"
              ? sql`
              SELECT run_id, position, record_key, event_kind, event_version, payload_json
              FROM journal_records WHERE run_id = ${runId} ORDER BY position ASC
            `
              : sql`
              SELECT run_id, position, record_key, event_kind, event_version, payload_json
              FROM journal_records_cold WHERE run_id = ${runId} ORDER BY position ASC
            `
          ).pipe(
            Effect.mapError(classifyJournalStorageFailure.bind(undefined, operation)),
            Effect.flatMap((input) => decodeBoundary(PersistedJournalRows, input, operation))
          )
          return yield* Effect.forEach(rows, (row) =>
            fromPersistedRow(row).pipe(
              Effect.mapError((cause) => new JournalDataCorruption({ detail: cause.detail, operation }))
            )
          )
        })

        const hasPartitionRows = Effect.fn("JournalStore.Sqlite.hasPartitionRows")(function* (
          partition: JournalPartition,
          runId: RunId,
          operation: StoreOperation
        ) {
          const rows = yield* (
            partition === "Hot"
              ? sql`SELECT run_id FROM journal_records WHERE run_id = ${runId} LIMIT 1`
              : sql`SELECT run_id FROM journal_records_cold WHERE run_id = ${runId} LIMIT 1`
          ).pipe(
            Effect.mapError(classifyJournalStorageFailure.bind(undefined, operation)),
            Effect.flatMap((input) => decodeBoundary(Schema.Array(PersistedRunIdentity), input, operation))
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
          if (operation === "JournalStore.read" && testConfig?.beforeReadLoad !== undefined) {
            yield* testConfig.beforeReadLoad()
          }
          const records = yield* loadPartitionRecords(cold ? "Cold" : "Hot", runId, operation)
          return cold ? yield* validateColdHistory(runId, records, operation) : records
        })

        const insertLifecycleRecord = Effect.fn("JournalStore.Sqlite.insertLifecycleRecord")(function* (
          record: JournalRecord
        ) {
          const encoded = encodeJournalEvent(record.event)
          yield* sql`
          INSERT INTO journal_records (
            run_id, position, record_key, event_kind, event_version, payload_json
          ) VALUES (
            ${record.runId}, ${record.position}, ${record.key}, ${encoded.kind}, ${encoded.version},
            ${encoded.payloadJson}
          )
        `
        })

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
              return yield* new JournalDataCorruption({
                detail: "cold partition contains nonterminal history",
                operation: "JournalStore.append"
              })
            }
            const existingRows = yield* sql`
            SELECT position, event_kind, event_version, payload_json
            FROM journal_records
            WHERE run_id = ${runId} AND record_key = ${key}
          `.pipe(Effect.flatMap((rows) => decodeBoundary(ExistingRecordRows, rows, "JournalStore.append")))
            const existing = existingRows[0]
            if (existing !== undefined) {
              const existingEvent = yield* parseEvent(existing, "JournalStore.append")
              if (equalJournalEvents(existingEvent, event)) {
                return { event, key, position: existing.position, runId } satisfies JournalRecord
              }
              return yield* new JournalStoreContradiction({ existingPosition: existing.position, key, runId })
            }

            const positions = yield* sql`
            SELECT COALESCE(MAX(position), 0) + 1 AS next_position
            FROM journal_records
            WHERE run_id = ${runId}
          `.pipe(Effect.flatMap((rows) => decodeBoundary(NextPositionRows, rows, "JournalStore.append")))
            const position = positions[0].next_position
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
          addSemanticScanIssues(partition, collections.recordsByRun, collections.issues)
          return {
            issues: collections.issues,
            partition,
            rowRunIds: collections.rowRunIds,
            runs: [...collections.recordsByRun].map(([runId, records]) => ({ partition, records, runId }))
          }
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

        const retireCold = (runId: RunId) =>
          Effect.gen(function* () {
            const records = yield* loadPartitionRecords("Cold", runId, "JournalStore.retireTerminalRun")
            yield* validateColdHistory(runId, records, "JournalStore.retireTerminalRun")
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
          `.pipe(
            Effect.flatMap((rows) => decodeBoundary(RetirementVerificationRows, rows, "JournalStore.retireTerminalRun"))
          )

        const retirementCopyPreservesBytes = (check: (typeof RetirementVerificationRows.Type)[number]) =>
          check.hot_count === check.cold_count &&
          check.hot_count !== 0 &&
          check.missing_count === 0 &&
          check.extra_count === 0

        const retireHot = (runId: RunId) =>
          Effect.gen(function* () {
            const records = yield* loadPartitionRecords("Hot", runId, "JournalStore.retireTerminalRun")
            const reduction = reduceWorkflowJournalHistory(runId, records)
            if (reduction._tag === "InvalidWorkflowJournalHistory") {
              return yield* new JournalDataCorruption({
                detail: reduction.issues.map(workflowJournalHistoryIssueDetail).join("; "),
                operation: "JournalStore.retireTerminalRun"
              })
            }
            if (reduction.records.at(lastRecordIndex)?.event._tag !== "WorkflowRunTerminated") {
              return yield* new JournalHistoryNotTerminal({ runId })
            }
            yield* sql`
              INSERT INTO journal_records_cold (
                run_id, position, record_key, event_kind, event_version, payload_json
              )
              SELECT run_id, position, record_key, event_kind, event_version, payload_json
              FROM journal_records WHERE run_id = ${runId}
            `
            const verification = yield* retirementCopyVerification(runId)
            const check = verification[0]
            if (!retirementCopyPreservesBytes(check)) {
              return yield* new JournalDataCorruption({
                detail: "terminal history copy did not preserve every persisted byte",
                operation: "JournalStore.retireTerminalRun"
              })
            }
            if (testConfig?.afterRetirementCopy !== undefined) yield* testConfig.afterRetirementCopy()
            yield* sql`DELETE FROM journal_records WHERE run_id = ${runId}`
            return { _tag: "Retired", from: "Hot", runId, to: "Cold" } as const
          })

        const retireSqlite = (runId: RunId) =>
          Effect.gen(function* () {
            const hot = yield* hasPartitionRows("Hot", runId, "JournalStore.retireTerminalRun")
            const cold = yield* hasPartitionRows("Cold", runId, "JournalStore.retireTerminalRun")
            if (hot && cold) return yield* new JournalPartitionContradiction({ runId })
            if (cold) return yield* retireCold(runId)
            if (!hot) return yield* new WorkflowRunNotBegan({ runId })
            return yield* retireHot(runId)
          })

        const retireTerminalRun = Effect.fn("JournalStore.Sqlite.retireTerminalRun")(function* (runId: RunId) {
          return yield* retireSqlite(runId).pipe(
            sql.withTransaction,
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
              return yield* new JournalDataCorruption({
                detail: "cold partition contains nonterminal history",
                operation: "JournalStore.terminateRun"
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
