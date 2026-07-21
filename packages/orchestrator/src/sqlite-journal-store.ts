import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Cause, Effect, Layer, Schema } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as SqlError from "effect/unstable/sql/SqlError"
import {
  type JournalDatabaseLocator,
  JournalPosition,
  JournalRecordKey,
  JournalSchemaVersion,
  RunId
} from "./domain.js"
import {
  JournalDataCorruption,
  type JournalRecord,
  JournalSchemaIncompatible,
  JournalStorageAccessDenied,
  JournalStorageCapacityExhausted,
  JournalStorageLocked,
  JournalStorageUnavailable,
  JournalStore,
  JournalStoreContradiction,
  type JournalStoreError,
  ManagedWorkflowEvent
} from "./journal-store.js"

const PersistedJournalRow = Schema.Struct({
  run_id: RunId,
  position: JournalPosition,
  record_key: JournalRecordKey,
  event_json: Schema.String
})
type PersistedJournalRow = typeof PersistedJournalRow.Type

const PersistedJournalRows = Schema.Array(PersistedJournalRow)
const ExistingRecordRows = Schema.Array(
  Schema.Struct({
    position: JournalPosition,
    event_json: Schema.String
  })
)
const NextPositionRows = Schema.Tuple([
  Schema.Struct({ next_position: JournalPosition })
])
const SchemaVersionRows = Schema.Tuple([
  Schema.Struct({ user_version: JournalSchemaVersion })
])

// Version 1 is the issue #39 bootstrap. Before version 2, adopt the Effect SQL
// migrator and the envelope/evolution policy recorded in ADR 0001 and issue
// #50; do not extend this one-off PRAGMA migration switch.
// https://github.com/dearlordylord/dalph/issues/50
const journalSchemaVersion = JournalSchemaVersion.make(1)
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
  input: string
): Effect.Effect<ManagedWorkflowEvent, JournalDataCorruption> =>
  Effect.try({
    try: (): unknown => JSON.parse(input),
    catch: (cause) =>
      new JournalDataCorruption({
        detail: String(cause),
        operation: "JournalStore.read"
      })
  }).pipe(
    Effect.flatMap((decoded) => decodeBoundary(ManagedWorkflowEvent, decoded, "JournalStore.read"))
  )

const encodeEvent = (event: ManagedWorkflowEvent): string =>
  JSON.stringify(Schema.encodeUnknownSync(ManagedWorkflowEvent)(event))

const fromPersistedRow = Effect.fn("JournalStore.Sqlite.fromPersistedRow")(
  function*(row: PersistedJournalRow) {
    // Effect Schema proves that one physical row and event payload decode. It
    // does not prove that the ordered log is semantically recoverable. Issue
    // #50 owns the total history fold that must return a valid recovery state
    // or typed, accumulated issues for illegal transitions and contradictions.
    // https://github.com/dearlordylord/dalph/issues/50
    return {
      event: yield* parseEvent(row.event_json),
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
  const versions = yield* sql`PRAGMA user_version`.pipe(
    Effect.mapError(classifyJournalStorageFailure.bind(undefined, "JournalStore.migrate")),
    Effect.flatMap((rows) => decodeBoundary(SchemaVersionRows, rows, "JournalStore.migrate"))
  )
  const version = versions[0].user_version
  if (version > journalSchemaVersion) {
    return yield* new JournalSchemaIncompatible({
      found: version,
      supported: journalSchemaVersion
    })
  }
  if (version === journalSchemaVersion) return

  yield* Effect.gen(function*() {
    yield* sql`
      CREATE TABLE IF NOT EXISTS journal_records (
        run_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 1),
        record_key TEXT NOT NULL,
        event_json TEXT NOT NULL,
        PRIMARY KEY (run_id, position),
        UNIQUE (run_id, record_key)
      ) STRICT
    `
    yield* sql`PRAGMA user_version = ${sql.literal(String(journalSchemaVersion))}`
  }).pipe(
    sql.withTransaction,
    Effect.mapError(classifyJournalStorageFailure.bind(undefined, "JournalStore.migrate"))
  )
})

const acquireExclusiveWriter = Effect.fn(
  "JournalStore.Sqlite.acquireExclusiveWriter"
)(function*(sql: SqliteClient.SqliteClient) {
  yield* sql`PRAGMA user_version = ${sql.literal(String(journalSchemaVersion))}`.pipe(
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
        event: ManagedWorkflowEvent
      ) {
        const eventJson = encodeEvent(event)
        return yield* Effect.gen(function*() {
          const existingRows = yield* sql`
            SELECT position, event_json
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
            if (existing.event_json === eventJson) {
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
            INSERT INTO journal_records (run_id, position, record_key, event_json)
            VALUES (${runId}, ${position}, ${key}, ${eventJson})
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
          SELECT run_id, position, record_key, event_json
          FROM journal_records
          WHERE run_id = ${runId}
          ORDER BY position ASC
        `.pipe(
          Effect.mapError(classifyJournalStorageFailure.bind(undefined, "JournalStore.read")),
          Effect.flatMap((input) => decodeBoundary(PersistedJournalRows, input, "JournalStore.read"))
        )
        return yield* Effect.forEach(rows, fromPersistedRow)
      })

      return JournalStore.of({ append, read })
    })
  ).pipe(Layer.provide(Reactivity.layer))
