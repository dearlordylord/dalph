import type * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator"
import { Cause, Effect, Schema } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { JournalSchemaVersion } from "../identity.js"
import { JournalDataCorruption, JournalSchemaIncompatible } from "../store.js"
import { classifyJournalStorageFailure, decodeBoundary } from "./sqlite-store-errors.js"

const currentJournalSchemaVersionValue = 4
const currentJournalSchemaVersion = JournalSchemaVersion.make(currentJournalSchemaVersionValue)
const completionMigrationId = 3
const journalMigrationId = 2
const MigrationVersionRows = Schema.Tuple([Schema.Struct({ schema_version: JournalSchemaVersion })])

export const migrateJournal = Effect.fn("JournalStore.Sqlite.migrate")(function* (
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
    yield* migrationSql`PRAGMA user_version = ${migrationSql.literal(String(journalMigrationId))}`
  })
  const createCompletions = Effect.gen(function* () {
    const migrationSql = yield* SqlClient.SqlClient
    yield* migrationSql`CREATE TABLE run_completions (
      run_id TEXT PRIMARY KEY NOT NULL,
      completion_json TEXT NOT NULL,
      integrity_json TEXT NOT NULL,
      checksum TEXT NOT NULL
    ) STRICT`
    yield* migrationSql`CREATE INDEX journal_terminal_runs ON journal_records(event_kind, run_id)`
    yield* migrationSql`CREATE INDEX journal_cold_terminal_runs ON journal_records_cold(event_kind, run_id)`
    yield* migrationSql`PRAGMA user_version = ${migrationSql.literal(String(completionMigrationId))}`
  })
  yield* SqliteMigrator.run({
    loader: Effect.succeed([
      [1, "create_current_journal_records", Effect.succeed(createCurrentJournal)],
      [journalMigrationId, "create_cold_journal_records", Effect.succeed(createColdJournal)],
      [completionMigrationId, "create_run_completions", Effect.succeed(createCompletions)],
      [
        currentJournalSchemaVersionValue,
        "archive_retention",
        Effect.succeed(
          Effect.gen(function* () {
            const migrationSql = yield* SqlClient.SqlClient
            yield* migrationSql`ALTER TABLE run_completions ADD COLUMN deletion_json TEXT`
            yield* migrationSql`CREATE TABLE archive_histories (run_id TEXT PRIMARY KEY NOT NULL, saved_bytes INTEGER NOT NULL CHECK(saved_bytes >= 0), baseline INTEGER) STRICT`
            yield* migrationSql`CREATE INDEX archive_history_age ON archive_histories(baseline, run_id)`
            yield* migrationSql`PRAGMA user_version = 4`
          })
        )
      ]
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
  if (version > currentJournalSchemaVersion) {
    return yield* new JournalSchemaIncompatible({ found: version, supported: currentJournalSchemaVersion })
  }
})

export const acquireExclusiveJournalWriter = Effect.fn("JournalStore.Sqlite.acquireExclusiveWriter")(function* (
  sql: SqliteClient.SqliteClient
) {
  yield* sql`UPDATE effect_sql_migrations SET name = name WHERE migration_id = ${currentJournalSchemaVersion}`.pipe(
    sql.withTransaction,
    Effect.mapError(classifyJournalStorageFailure.bind(undefined, "JournalStore.open"))
  )
})
