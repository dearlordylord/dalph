/* eslint-disable functional/immutable-data -- Scan accumulation is private adapter scratch and never becomes journal authority. */
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator"
import { Cause, Config, Effect, Layer, Result, Schema } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import * as SqlError from "effect/unstable/sql/SqlError"
import { CoordinatorOwnership } from "./coordinator-lock.js"
import {
  JournalDatabaseLocator,
  JournalEventKind,
  JournalEventVersion,
  JournalPosition,
  JournalRecordKey,
  JournalSchemaVersion,
  RunId
} from "./domain.js"
import {
  decodeAndUpcastJournalEvent,
  encodeJournalEvent,
  semanticallyEqualJournalEvents
} from "./journal-event-codec.js"
import { JournalBoundaryDecodeIssue } from "./journal-recovery-model.js"
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Effect service tags and typed errors require runtime identities.
import {
  JournalDataCorruption,
  JournalSchemaIncompatible,
  JournalStorageAccessDenied,
  JournalStorageCapacityExhausted,
  JournalStorageLocked,
  JournalStorageUnavailable,
  JournalStore,
  JournalStoreContradiction,
  WorkflowJournalEvent
} from "./journal-store.js"
import type { JournalRecord, JournalStoreError } from "./journal-store.js"

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
const NextPositionRows = Schema.Tuple([
  Schema.Struct({ next_position: JournalPosition })
])
const MigrationVersionRows = Schema.Tuple([
  Schema.Struct({ schema_version: JournalSchemaVersion })
])

const currentJournalSchemaVersionValue = 2
const journalSchemaVersion = JournalSchemaVersion.make(currentJournalSchemaVersionValue)
const initialJournalMigrationId = 1
const normalizedJournalMigrationId = 2
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

const failureDetail = (cause: unknown): string => Cause.isCause(cause) ? Cause.pretty(cause) : String(cause)

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
  switch (sqlitePrimaryResultCode(failure)) {
    case sqliteResultCode.busy:
    case sqliteResultCode.locked:
      return new JournalStorageLocked(fields)
    case sqliteResultCode.accessDenied:
    case sqliteResultCode.readonly:
    case sqliteResultCode.unauthorized:
      return new JournalStorageAccessDenied(fields)
    case sqliteResultCode.capacityExhausted:
      return new JournalStorageCapacityExhausted(fields)
    case sqliteResultCode.corrupt:
    case sqliteResultCode.notADatabase:
      return new JournalDataCorruption(fields)
    case undefined:
    default:
      return new JournalStorageUnavailable(fields)
  }
}

const decodeBoundary = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: JournalDataCorruption["operation"]
): Effect.Effect<A, JournalDataCorruption> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(input),
    catch: (cause) => new JournalDataCorruption({ detail: String(cause), operation })
  })

const parseEvent = (
  row: Pick<PersistedJournalRow, "event_kind" | "event_version" | "payload_json">,
  operation: JournalDataCorruption["operation"]
): Effect.Effect<WorkflowJournalEvent, JournalDataCorruption> =>
  decodeAndUpcastJournalEvent({
    kind: row.event_kind,
    payloadJson: row.payload_json,
    version: row.event_version
  }).pipe(
    Effect.mapError((cause) => new JournalDataCorruption({ detail: cause.detail, operation }))
  )

const fromPersistedRow = Effect.fn("JournalStore.Sqlite.fromPersistedRow")(
  function*(row: PersistedJournalRow) {
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
  }
)

const migrate = Effect.fn("JournalStore.Sqlite.migrate")(function*(
  sql: SqliteClient.SqliteClient
) {
  yield* sql`PRAGMA locking_mode = EXCLUSIVE`.pipe(
    Effect.mapError(classifyJournalStorageFailure.bind(undefined, "JournalStore.migrate"))
  )
  const migrationOne = Effect.gen(function*() {
    const migrationSql = yield* SqlClient.SqlClient
    yield* migrationSql`
      CREATE TABLE IF NOT EXISTS journal_records (
        run_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 1),
        record_key TEXT NOT NULL,
        event_json TEXT NOT NULL,
        PRIMARY KEY (run_id, position),
        UNIQUE (run_id, record_key)
      ) STRICT
    `
  })
  const migrationTwo = Effect.gen(function*() {
    const migrationSql = yield* SqlClient.SqlClient
    yield* migrationSql`
      CREATE TABLE journal_records_v2 (
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
    yield* migrationSql`
      INSERT INTO journal_records_v2 (
        run_id, position, record_key, event_kind, event_version, payload_json
      )
      SELECT
        run_id,
        position,
        record_key,
        CASE WHEN json_valid(event_json)
          THEN COALESCE(json_extract(event_json, '$._tag'), '__invalid_event_kind__')
          ELSE '__invalid_event_kind__'
        END,
        CASE WHEN json_valid(event_json)
          AND json_type(event_json, '$.version') = 'integer'
          AND json_extract(event_json, '$.version') >= 1
          THEN json_extract(event_json, '$.version')
          ELSE 1
        END,
        CASE WHEN json_valid(event_json)
          THEN json_remove(event_json, '$._tag', '$.version')
          ELSE event_json
        END
      FROM journal_records
    `
    yield* migrationSql`DROP TABLE journal_records`
    yield* migrationSql`ALTER TABLE journal_records_v2 RENAME TO journal_records`
    yield* migrationSql`PRAGMA user_version = ${migrationSql.literal(String(currentJournalSchemaVersionValue))}`
  })
  yield* SqliteMigrator.run({
    loader: Effect.succeed([
      [initialJournalMigrationId, "create_journal_records", Effect.succeed(migrationOne)],
      [normalizedJournalMigrationId, "normalize_versioned_journal_envelopes", Effect.succeed(migrationTwo)]
    ]),
    table: "effect_sql_migrations"
  }).pipe(
    Effect.provideService(SqlClient.SqlClient, sql),
    Effect.catchCause((cause) => {
      const failure = Cause.squash(cause)
      return Effect.fail(
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

const acquireExclusiveWriter = Effect.fn(
  "JournalStore.Sqlite.acquireExclusiveWriter"
)(function*(sql: SqliteClient.SqliteClient) {
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
export const sqliteJournalStoreLayer = (
  config: SqliteJournalStoreConfig
): Layer.Layer<JournalStore, JournalStoreError> =>
  Layer.effect(
    JournalStore,
    Effect.gen(function*() {
      const sql = yield* SqliteClient.make({
        disableWAL: false,
        filename: config.filename
      }).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterrupts(cause),
          (cause) => Effect.fail(classifyJournalStorageFailure("JournalStore.open", cause))
        )
      )
      yield* migrate(sql)
      yield* acquireExclusiveWriter(sql)

      const append = Effect.fn("JournalStore.Sqlite.append")(function*(
        runId: RunId,
        key: JournalRecordKey,
        event: WorkflowJournalEvent
      ) {
        const encoded = encodeJournalEvent(event)
        return yield* Effect.gen(function*() {
          const existingRows = yield* sql`
            SELECT position, event_kind, event_version, payload_json
            FROM journal_records
            WHERE run_id = ${runId} AND record_key = ${key}
          `.pipe(
            Effect.flatMap((rows) =>
              decodeBoundary(
                ExistingRecordRows,
                rows,
                "JournalStore.append"
              )
            )
          )
          const existing = existingRows[0]
          if (existing !== undefined) {
            const existingEvent = yield* parseEvent(existing, "JournalStore.append")
            if (semanticallyEqualJournalEvents(existingEvent, event)) {
              return {
                event,
                key,
                position: existing.position,
                runId
              } satisfies JournalRecord
            }
            return yield* new JournalStoreContradiction({
              existingPosition: existing.position,
              key,
              runId
            })
          }

          const positions = yield* sql`
            SELECT COALESCE(MAX(position), 0) + 1 AS next_position
            FROM journal_records
            WHERE run_id = ${runId}
          `.pipe(
            Effect.flatMap((rows) =>
              decodeBoundary(
                NextPositionRows,
                rows,
                "JournalStore.append"
              )
            )
          )
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
          Effect.mapError((cause) =>
            cause instanceof JournalStoreContradiction
              || cause instanceof JournalDataCorruption
              || cause instanceof JournalSchemaIncompatible
              || cause instanceof JournalStorageUnavailable
              ? cause
              : classifyJournalStorageFailure("JournalStore.append", cause)
          )
        )
      })

      const read = Effect.fn("JournalStore.Sqlite.read")(function*(runId: RunId) {
        const rows = yield* sql`
          SELECT run_id, position, record_key, event_kind, event_version, payload_json
          FROM journal_records
          WHERE run_id = ${runId}
          ORDER BY position ASC
        `.pipe(
          Effect.mapError(classifyJournalStorageFailure.bind(undefined, "JournalStore.read")),
          Effect.flatMap((input) => decodeBoundary(PersistedJournalRows, input, "JournalStore.read"))
        )
        return yield* Effect.forEach(rows, fromPersistedRow)
      })

      const scan = Effect.fn("JournalStore.Sqlite.scan")(function*() {
        const rows = yield* sql`
          SELECT run_id, position, record_key, event_kind, event_version, payload_json
          FROM journal_records
          ORDER BY run_id ASC, position ASC
        `.pipe(Effect.mapError(classifyJournalStorageFailure.bind(undefined, "JournalStore.read")))
        const issues = new Array<JournalBoundaryDecodeIssue>()
        const recordsByRun = new Map<RunId, Array<JournalRecord>>()
        for (const [index, input] of rows.entries()) {
          const rowOrdinal = index + 1
          const identity = yield* decodeBoundary(PersistedRunIdentity, input, "JournalStore.read").pipe(Effect.result)
          const decoded = yield* decodeBoundary(PersistedJournalRow, input, "JournalStore.read").pipe(Effect.result)
          if (Result.isFailure(decoded)) {
            issues.push(
              new JournalBoundaryDecodeIssue({
                detail: decoded.failure.detail,
                rowOrdinal,
                runId: Result.isSuccess(identity) ? identity.success.run_id : null
              })
            )
            continue
          }
          const event = yield* parseEvent(decoded.success, "JournalStore.read").pipe(Effect.result)
          if (Result.isFailure(event)) {
            issues.push(
              new JournalBoundaryDecodeIssue({
                detail: event.failure.detail,
                rowOrdinal,
                runId: decoded.success.run_id
              })
            )
            continue
          }
          const record: JournalRecord = {
            event: event.success,
            key: decoded.success.record_key,
            position: decoded.success.position,
            runId: decoded.success.run_id
          }
          const current = recordsByRun.get(record.runId) ?? []
          current.push(record)
          recordsByRun.set(record.runId, current)
        }
        return {
          issues,
          runs: [...recordsByRun].map(([runId, records]) => ({ records, runId }))
        }
      })

      return JournalStore.of({ append, read, scan })
    })
  ).pipe(Layer.provide(Reactivity.layer))

export const journalDatabaseLocatorConfig = Config.schema(
  JournalDatabaseLocator,
  "DALPH_JOURNAL_DATABASE"
)

/** Opens production SQLite only after the coordinator holds the Git-directory lock. */
export const productionJournalStoreLayer = Layer.unwrap(
  Effect.gen(function*() {
    yield* CoordinatorOwnership
    const filename = yield* journalDatabaseLocatorConfig
    return sqliteJournalStoreLayer({ filename })
  })
)
