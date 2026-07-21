import { NodeFileSystem, NodePath } from "@effect/platform-node"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { it } from "@effect/vitest"
import { Cause, Effect, FileSystem, Layer, Path } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as SqlError from "effect/unstable/sql/SqlError"
import { describe, expect } from "vitest"
import {
  FixtureTarget,
  JournalDatabaseLocator,
  journaledWorkflowInterpreterLayer,
  JournalReconciliationRequired,
  JournalRecordKey,
  JournalStorageAccessDenied,
  JournalStorageCapacityExhausted,
  JournalStorageLocked,
  JournalStorageUnavailable,
  JournalStore,
  JournalStoreContradiction,
  liveFakeWorkflowInterpreterLayer,
  managedWorkflowIntent,
  memoryJournalStoreLayer,
  OperationId,
  RunId,
  runWorkflow,
  sqliteJournalStoreLayer,
  TaskExecutionCapacity,
  TaskId,
  TaskWorkStart,
  trackerGraphReaderFileLayer,
  WorkflowInterpreter,
  WorkflowOperation,
  WorkflowOutcome,
  WorkflowTrace
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
  managedWorkflowIntent(
    WorkflowOperation.cases.ExecuteTask.make({
      operationId: OperationId.make(operationId),
      predecessorOperationIds: [],
      taskId: TaskId.make(taskId)
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
    it.effect(
      "restarts one planned fixture workflow from its managed SQLite history",
      () =>
        Effect.scoped(
          withTemporaryDatabase((filename) => {
            const runId = RunId.make("restart-run")
            const target = FixtureTarget.make(
              new URL("../fixtures/singleton.json", import.meta.url).pathname
            )
            return Effect.gen(function*() {
              let executions = 0
              const workflow = runWorkflow(target, TaskExecutionCapacity.make(1)).pipe(
                Effect.provide(
                  journaledWorkflowInterpreterLayer(
                    runId,
                    liveFakeWorkflowInterpreterLayer
                  )
                ),
                Effect.provide(trackerGraphReaderFileLayer),
                Effect.provide(
                  Layer.succeed(
                    TaskWorkStart,
                    TaskWorkStart.of({
                      request: () => Effect.sync(() => executions += 1)
                    })
                  )
                ),
                Effect.provide(
                  Layer.succeed(
                    WorkflowTrace,
                    WorkflowTrace.of({ emit: () => Effect.void })
                  )
                ),
                Effect.provide(sqliteJournalStoreLayer({ filename }))
              )
              yield* workflow
              yield* workflow
              expect(executions).toBe(1)

              const reopened = yield* Effect.gen(function*() {
                const journal = yield* JournalStore
                return yield* journal.read(runId)
              }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

              expect(reopened.map(({ event }) => event._tag)).toEqual([
                "ManagedWorkflowIntent",
                "ManagedTrackerGraphOutcomeObserved",
                "ManagedWorkflowIntent",
                "ManagedTaskExecutionOutcomeObserved"
              ])
              expect(reopened.map(({ position }) => position)).toEqual([1, 2, 3, 4])
            })
          })
        )
    )

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
            expect(schemaVersion).toEqual([{ user_version: 1 }])
          }).pipe(Effect.provide(Reactivity.layer))
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
            yield* withSqliteClient(filename, (sql) => Effect.asVoid(sql`PRAGMA user_version = 2`))
            const failure = yield* Effect.flip(
              Effect.gen(function*() {
                yield* JournalStore
              }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
            )

            expect(failure).toMatchObject({
              _tag: "JournalSchemaIncompatible",
              found: 2,
              supported: 1
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
              (sql) => Effect.asVoid(sql`PRAGMA user_version = -1`)
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
            yield* withSqliteClient(filename, (sql) => Effect.asVoid(sql`UPDATE journal_records SET event_json = '{'`))

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

it.effect("fails closed instead of repeating an execution with an unresolved intent", () =>
  Effect.gen(function*() {
    const runId = RunId.make("ambiguous-run")
    const taskId = TaskId.make("ambiguous-task")
    const operation = WorkflowOperation.cases.ExecuteTask.make({
      operationId: OperationId.make("task-execution:ambiguous-task"),
      predecessorOperationIds: [OperationId.make("observe-tracker-graph")],
      taskId
    })
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      JournalRecordKey.make(`operation:${operation.operationId}:intent`),
      managedWorkflowIntent(operation)
    )
    let executions = 0
    const interpreterLayer = Layer.succeed(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        executeTask: () => {
          executions += 1
          return Effect.succeed(WorkflowOutcome.cases.TaskExecuted.make({}))
        },
        readTrackerGraph: () => Effect.die("unused")
      })
    )
    const failure = yield* Effect.flip(
      Effect.gen(function*() {
        const interpreter = yield* WorkflowInterpreter
        return yield* interpreter.executeTask(operation)
      }).pipe(
        Effect.provide(journaledWorkflowInterpreterLayer(runId, interpreterLayer))
      )
    )

    expect(failure).toBeInstanceOf(JournalReconciliationRequired)
    expect(executions).toBe(0)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))
