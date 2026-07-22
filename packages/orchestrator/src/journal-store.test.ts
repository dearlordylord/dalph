import { NodeFileSystem, NodePath } from "@effect/platform-node"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { it } from "@effect/vitest"
import { Cause, Effect, FileSystem, Layer, Path, Schema } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as SqlError from "effect/unstable/sql/SqlError"
import { describe, expect } from "vitest"
import {
  FixtureTarget,
  JournalDatabaseLocator,
  JournalRecordKey,
  JournalStorageAccessDenied,
  JournalStorageCapacityExhausted,
  JournalStorageLocked,
  JournalStorageUnavailable,
  JournalStore,
  JournalStoreContradiction,
  memoryJournalStoreLayer,
  OperationId,
  RunId,
  sqliteJournalStoreLayer,
  trackerGraphObservationIntent,
  WorkflowJournalEvent,
  WorkflowOperation
} from "./index.js"
import { classifyJournalStorageFailure } from "./sqlite-journal-store.js"

const nodePathAndFileSystemLayer = Layer.merge(
  NodeFileSystem.layer,
  NodePath.layer
)

const withTemporaryDatabase = <A, E, R>(
  use: (
    filename: JournalDatabaseLocator,
    directory: string
  ) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "dalph-journal-test-"
    })
    return yield* use(
      JournalDatabaseLocator.make(path.join(directory, "journal.sqlite")),
      directory
    )
  }).pipe(Effect.provide(nodePathAndFileSystemLayer))

const withSqliteClient = <A, E, R>(
  filename: JournalDatabaseLocator,
  use: (sql: SqliteClient.SqliteClient) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(
    Effect.gen(function*() {
      const sql = yield* SqliteClient.make({ filename })
      return yield* use(sql)
    }).pipe(Effect.provide(Reactivity.layer))
  )

const intent = (operationId: string, taskId: string) =>
  trackerGraphObservationIntent(
    WorkflowOperation.cases.ReadTrackerGraph.make({
      operationId: OperationId.make(operationId),
      predecessorOperationIds: [],
      target: FixtureTarget.make(taskId)
    })
  )

const journalAppendContract = (
  name: string,
  makeLayer: () => Layer.Layer<JournalStore, unknown>
) => {
  const runId = RunId.make(`run-contract-${name}`)
  const firstKey = JournalRecordKey.make("operation:one:intent")
  const secondKey = JournalRecordKey.make("operation:two:intent")

  describe(`${name} JournalStore contract`, () => {
    it.effect("returns empty managed history for an unknown run", () =>
      Effect.gen(function*() {
        const journal = yield* JournalStore
        expect(yield* journal.read(RunId.make("unknown-run"))).toEqual([])
      }).pipe(Effect.provide(makeLayer())))

    it.effect("assigns canonical positions and returns ordered managed history", () =>
      Effect.gen(function*() {
        const journal = yield* JournalStore
        const first = yield* journal.append(runId, firstKey, intent("one", "task-1"))
        const second = yield* journal.append(runId, secondKey, intent("two", "task-2"))

        expect(first.position).toBe(1)
        expect(second.position).toBe(2)
        expect(yield* journal.read(runId)).toEqual([first, second])
      }).pipe(Effect.provide(makeLayer())))

    it.effect("returns the original record for an identical re-append", () =>
      Effect.gen(function*() {
        const journal = yield* JournalStore
        const event = intent("one", "task-1")
        const first = yield* journal.append(runId, firstKey, event)
        const repeated = yield* journal.append(runId, firstKey, event)

        expect(repeated).toEqual(first)
        expect(yield* journal.read(runId)).toEqual([first])
      }).pipe(Effect.provide(makeLayer())))

    it.effect("rejects unequal content under the same record key", () =>
      Effect.gen(function*() {
        const journal = yield* JournalStore
        yield* journal.append(runId, firstKey, intent("one", "task-1"))
        const failure = yield* Effect.flip(
          journal.append(runId, firstKey, intent("different", "task-1"))
        )

        expect(failure).toBeInstanceOf(JournalStoreContradiction)
        expect(failure).toMatchObject({
          existingPosition: 1,
          key: firstKey,
          runId
        })
      }).pipe(Effect.provide(makeLayer())))

    it.effect("atomically assigns distinct positions to concurrent appends", () =>
      Effect.gen(function*() {
        const journal = yield* JournalStore
        const records = yield* Effect.all(
          [
            journal.append(runId, firstKey, intent("one", "task-1")),
            journal.append(runId, secondKey, intent("two", "task-2"))
          ],
          { concurrency: "unbounded" }
        )

        expect(new Set(records.map(({ position }) => position))).toEqual(
          new Set([1, 2])
        )
        expect((yield* journal.read(runId)).map(({ position }) => position)).toEqual([
          1,
          2
        ])
      }).pipe(Effect.provide(makeLayer())))

    it.effect("keeps each run's positions independent", () =>
      Effect.gen(function*() {
        const journal = yield* JournalStore
        const first = yield* journal.append(runId, firstKey, intent("one", "task-1"))
        const other = yield* journal.append(
          RunId.make("another-run"),
          firstKey,
          intent("one", "task-1")
        )

        expect(first.position).toBe(1)
        expect(other.position).toBe(1)
      }).pipe(Effect.provide(makeLayer())))

    it.effect("discovers all journal runs without an age cutoff", () =>
      Effect.gen(function*() {
        const journal = yield* JournalStore
        yield* journal.append(runId, firstKey, intent("one", "task-1"))
        const otherRunId = RunId.make(`${runId}-older`)
        yield* journal.append(otherRunId, firstKey, intent("one", "task-1"))
        expect(new Set((yield* journal.scan()).runs.map(({ runId }) => runId))).toEqual(
          new Set([runId, otherRunId])
        )
      }).pipe(Effect.provide(makeLayer())))
  })
}

const durableJournalStoreContract = (
  name: string,
  makeLayer: () => Layer.Layer<JournalStore, unknown>,
  registerLifecycleAndFailureCases: () => void
) => {
  journalAppendContract(name, makeLayer)
  describe(`${name} durable JournalStore contract`, registerLifecycleAndFailureCases)
}

journalAppendContract("memory", () => memoryJournalStoreLayer)
durableJournalStoreContract(
  "sqlite",
  () =>
    sqliteJournalStoreLayer({
      filename: JournalDatabaseLocator.make(":memory:")
    }),
  () => {
    it.effect("migrates the production SQLite journal and enables WAL mode", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function*() {
            yield* Effect.gen(function*() {
              yield* JournalStore
            }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

            const sql = yield* SqliteClient.make({
              disableWAL: true,
              filename,
              readonly: true
            })
            const journalMode = yield* sql`PRAGMA journal_mode`
            const schemaVersion = yield* sql`PRAGMA user_version`
            expect(journalMode).toEqual([{ journal_mode: "wal" }])
            const migrations = yield* sql`
              SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
            `
            expect(schemaVersion).toEqual([{ user_version: 2 }])
            expect(migrations).toEqual([
              { migration_id: 1, name: "create_journal_records" },
              { migration_id: 2, name: "normalize_versioned_journal_envelopes" }
            ])
          }).pipe(Effect.provide(Reactivity.layer))
        )
      ))

    it.effect("adopts immutable version-1 rows and compares re-appends after semantic upcast", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function*() {
            const runId = RunId.make("legacy-run")
            const key = JournalRecordKey.make("operation:legacy:intent")
            const current = intent("legacy", "legacy-task")
            const encoded = Schema.encodeUnknownSync(WorkflowJournalEvent)(current)
            const { version: _version, ...legacy } = encoded
            yield* withSqliteClient(filename, (sql) =>
              Effect.gen(function*() {
                yield* sql`CREATE TABLE journal_records (
                run_id TEXT NOT NULL,
                position INTEGER NOT NULL CHECK (position >= 1),
                record_key TEXT NOT NULL,
                event_json TEXT NOT NULL,
                PRIMARY KEY (run_id, position),
                UNIQUE (run_id, record_key)
              ) STRICT`
                yield* sql`PRAGMA user_version = 1`
                yield* sql`INSERT INTO journal_records (run_id, position, record_key, event_json)
                VALUES (${runId}, 1, ${key}, ${JSON.stringify(legacy)})`
              }))

            yield* Effect.gen(function*() {
              const journal = yield* JournalStore
              expect((yield* journal.read(runId))[0]?.event).toEqual(current)
              expect((yield* journal.append(runId, key, current)).position).toBe(1)
            }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
          })
        )
      ))

    it.effect("rejects a second SQLite writer while the owner is live", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function*() {
            yield* Effect.gen(function*() {
              yield* JournalStore
            }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

            yield* Effect.gen(function*() {
              yield* JournalStore
              const secondWriterFailure = yield* Effect.flip(
                Effect.gen(function*() {
                  yield* JournalStore
                }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
              )

              expect(secondWriterFailure).toBeInstanceOf(JournalStorageLocked)
            }).pipe(
              Effect.provide(sqliteJournalStoreLayer({ filename }))
            )
          })
        )
      ))

    it.effect("reports SQLite open failures as typed storage failures", () =>
      Effect.scoped(
        withTemporaryDatabase((_filename, directory) =>
          Effect.gen(function*() {
            const failure = yield* Effect.flip(
              Effect.gen(function*() {
                yield* JournalStore
              }).pipe(
                Effect.provide(
                  sqliteJournalStoreLayer({
                    filename: JournalDatabaseLocator.make(directory)
                  })
                )
              )
            )

            expect(failure).toMatchObject({
              _tag: "JournalStorageUnavailable",
              operation: "JournalStore.open"
            })
          })
        )
      ))

    it("classifies SQLite recovery categories without parsing error prose", () => {
      const sqliteError = (errcode: number) => Object.assign(new Error("opaque"), { errcode })

      expect(classifyJournalStorageFailure("JournalStore.append", sqliteError(5)))
        .toBeInstanceOf(JournalStorageLocked)
      expect(classifyJournalStorageFailure("JournalStore.append", sqliteError(6)))
        .toBeInstanceOf(JournalStorageLocked)
      expect(classifyJournalStorageFailure("JournalStore.append", sqliteError(3)))
        .toBeInstanceOf(JournalStorageAccessDenied)
      expect(classifyJournalStorageFailure("JournalStore.append", sqliteError(8)))
        .toBeInstanceOf(JournalStorageAccessDenied)
      expect(classifyJournalStorageFailure("JournalStore.append", sqliteError(23)))
        .toBeInstanceOf(JournalStorageAccessDenied)
      expect(classifyJournalStorageFailure("JournalStore.append", sqliteError(13)))
        .toBeInstanceOf(JournalStorageCapacityExhausted)
      expect(classifyJournalStorageFailure("JournalStore.read", sqliteError(11)))
        .toMatchObject({ _tag: "JournalDataCorruption" })
      expect(classifyJournalStorageFailure("JournalStore.read", sqliteError(26)))
        .toMatchObject({ _tag: "JournalDataCorruption" })
      expect(classifyJournalStorageFailure("JournalStore.open", sqliteError(14)))
        .toBeInstanceOf(JournalStorageUnavailable)
      expect(classifyJournalStorageFailure("JournalStore.open", "unknown"))
        .toBeInstanceOf(JournalStorageUnavailable)
      expect(classifyJournalStorageFailure("JournalStore.open", null))
        .toBeInstanceOf(JournalStorageUnavailable)
      expect(classifyJournalStorageFailure("JournalStore.open", {}))
        .toBeInstanceOf(JournalStorageUnavailable)
      expect(
        classifyJournalStorageFailure(
          "JournalStore.open",
          { errcode: "not-numeric", errno: 5 }
        )
      ).toBeInstanceOf(JournalStorageLocked)
      expect(
        classifyJournalStorageFailure(
          "JournalStore.open",
          new SqlError.SqlError({
            reason: new SqlError.LockTimeoutError({
              cause: { errno: 5 }
            })
          })
        )
      ).toBeInstanceOf(JournalStorageLocked)
      expect(
        classifyJournalStorageFailure(
          "JournalStore.open",
          Cause.die(sqliteError(5))
        )
      ).toBeInstanceOf(JournalStorageLocked)
    })

    it.effect("rejects a journal schema from a newer Dalph version", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function*() {
            yield* withSqliteClient(filename, (sql) =>
              Effect.gen(function*() {
                yield* sql`CREATE TABLE effect_sql_migrations (
                migration_id INTEGER PRIMARY KEY NOT NULL,
                created_at DATETIME NOT NULL DEFAULT current_timestamp,
                name VARCHAR(255) NOT NULL
              )`
                yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (3, 'future')`
              }))
            const failure = yield* Effect.flip(
              Effect.gen(function*() {
                yield* JournalStore
              }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
            )

            expect(failure).toMatchObject({
              _tag: "JournalSchemaIncompatible",
              found: 3,
              supported: 2
            })
          })
        )
      ))

    it.effect("reports a failed schema migration through the journal boundary", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function*() {
            yield* withSqliteClient(
              filename,
              (sql) => Effect.asVoid(sql`CREATE TABLE journal_records (wrong TEXT) STRICT`)
            )
            const failure = yield* Effect.flip(
              Effect.gen(function*() {
                yield* JournalStore
              }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
            )

            expect(failure).toMatchObject({
              _tag: "JournalDataCorruption",
              operation: "JournalStore.migrate"
            })
          })
        )
      ))

    it.effect("reports malformed persisted event content as a typed read failure", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function*() {
            const runId = RunId.make("malformed-event-run")
            yield* Effect.gen(function*() {
              const journal = yield* JournalStore
              yield* journal.append(
                runId,
                JournalRecordKey.make("operation:malformed:intent"),
                intent("malformed", "task-malformed")
              )
            }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
            yield* withSqliteClient(
              filename,
              (sql) => Effect.asVoid(sql`UPDATE journal_records SET payload_json = '{'`)
            )

            const failure = yield* Effect.flip(
              Effect.gen(function*() {
                const journal = yield* JournalStore
                return yield* journal.read(runId)
              }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
            )
            expect(failure).toMatchObject({
              _tag: "JournalDataCorruption",
              operation: "JournalStore.read"
            })
          })
        )
      ))

    it.effect("discovers every run and accumulates independent row and payload decode issues", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function*() {
            const firstRun = RunId.make("old-run-without-age-cutoff")
            const secondRun = RunId.make("new-run-without-age-cutoff")
            const thirdRun = RunId.make("row-schema-failure-run")
            const fourthRun = RunId.make("run-identity-schema-failure-run")
            yield* Effect.gen(function*() {
              const journal = yield* JournalStore
              yield* journal.append(
                firstRun,
                JournalRecordKey.make("operation:first:intent"),
                intent("first", "task-first")
              )
              yield* journal.append(
                secondRun,
                JournalRecordKey.make("operation:second:intent"),
                intent("second", "task-second")
              )
              yield* journal.append(
                thirdRun,
                JournalRecordKey.make("operation:third:intent"),
                intent("third", "task-third")
              )
              yield* journal.append(
                fourthRun,
                JournalRecordKey.make("operation:fourth:intent"),
                intent("fourth", "task-fourth")
              )
            }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
            yield* withSqliteClient(filename, (sql) =>
              Effect.gen(function*() {
                yield* sql`UPDATE journal_records SET payload_json = '{' WHERE run_id = ${firstRun}`
                yield* sql`UPDATE journal_records SET event_kind = 'UnknownEvent' WHERE run_id = ${secondRun}`
                yield* sql`UPDATE journal_records SET record_key = '' WHERE run_id = ${thirdRun}`
                yield* sql`UPDATE journal_records SET run_id = '' WHERE run_id = ${fourthRun}`
              }))

            const scan = yield* Effect.gen(function*() {
              return yield* (yield* JournalStore).scan()
            }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
            expect(scan.issues).toHaveLength(4)
            expect(new Set(scan.issues.map(({ runId }) => runId))).toEqual(
              new Set([firstRun, secondRun, thirdRun, null])
            )
            expect(scan.runs).toEqual([])
          })
        )
      ))

    it.effect("classifies malformed SQLite bytes as journal data corruption", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function*() {
            const fileSystem = yield* FileSystem.FileSystem
            yield* fileSystem.writeFileString(filename, "not a SQLite database")

            const failure = yield* Effect.flip(
              Effect.gen(function*() {
                yield* JournalStore
              }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
            )

            expect(failure).toMatchObject({
              _tag: "JournalDataCorruption",
              operation: "JournalStore.open"
            })
          })
        )
      ))

    it.effect("types append and read failures from damaged journal storage", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function*() {
            yield* Effect.gen(function*() {
              yield* JournalStore
            }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
            yield* withSqliteClient(filename, (sql) => Effect.asVoid(sql`DROP TABLE journal_records`))

            yield* Effect.gen(function*() {
              const journal = yield* JournalStore
              const appendError = yield* Effect.flip(
                journal.append(
                  RunId.make("damaged-run"),
                  JournalRecordKey.make("operation:damaged:intent"),
                  intent("damaged", "task-damaged")
                )
              )
              const readError = yield* Effect.flip(
                journal.read(RunId.make("damaged-run"))
              )

              expect(appendError).toMatchObject({
                _tag: "JournalStorageUnavailable",
                operation: "JournalStore.append"
              })
              expect(readError).toMatchObject({
                _tag: "JournalStorageUnavailable",
                operation: "JournalStore.read"
              })
            }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
          })
        )
      ))
  }
)
