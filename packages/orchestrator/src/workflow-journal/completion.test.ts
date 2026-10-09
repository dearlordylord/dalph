import { NodeFileSystem, NodePath } from "@effect/platform-node"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { it } from "@effect/vitest"
import { Clock, Context, Effect, FileSystem, Layer, Path, Ref } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { RunId } from "@dalph/contracts"
import { completedRunFinalityFixture } from "../../test/run-finality.js"
import { remotePublicationTargetForTest } from "../../test/support/direct-publication.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { JournalDatabaseLocator, JournalRecordKey } from "./identity.js"
import { intentRecordKey, outcomeRecordKey } from "./record-key.js"
import { JournalStore } from "./store.js"
import { memoryJournalStoreLayer, memoryJournalStoreLayerFromPartitionRecords } from "./adapters/memory-store.js"
import { sqliteJournalTestLayer } from "./adapters/sqlite-store.js"

const runId = RunId.make("compact-result")
const target = FixtureTarget.make("compact-result-target")
const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
const prepare = Effect.gen(function* () {
  const store = yield* JournalStore
  const fixture = completedRunFinalityFixture({ runId, target })
  yield* store.beginRun(runId, target, policy, remotePublicationTargetForTest)
  yield* store.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
  yield* store.append(runId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
  return fixture
})
const finish = prepare.pipe(
  Effect.flatMap((fixture) =>
    JournalStore.pipe(Effect.flatMap((store) => store.terminateRun(runId, "Completed", fixture.evidence)))
  )
)

for (const [name, layer] of [
  ["memory", memoryJournalStoreLayer],
  ["SQLite", sqliteJournalTestLayer({ filename: JournalDatabaseLocator.make(":memory:") })]
] as const) {
  it.effect(`${name} keeps the same compact terminal result before and after archive retirement`, () =>
    Effect.gen(function* () {
      const store = yield* JournalStore
      expect(yield* store.readCompletion(runId)).toEqual({ _tag: "NoCompletion", runId })
      const fixture = yield* prepare
      expect(yield* store.readCompletion(runId)).toEqual({ _tag: "NoCompletion", runId })
      const terminal = yield* store.terminateRun(runId, "Completed", fixture.evidence)
      const result = yield* store.readCompletion(runId)
      expect(result).toMatchObject({
        _tag: "CompletedRun",
        history: "Available",
        completion: {
          runId,
          target,
          disposition: "Completed",
          terminatedAt: terminal.position,
          timing: { _tag: "Known", completedAt: yield* Clock.currentTimeMillis },
          publication: { _tag: "NoRecordedPublication" }
        }
      })
      const before = yield* store.read(runId)
      yield* store.retireTerminalRun(runId)
      expect(yield* store.readCompletion(runId)).toEqual(result)
      expect(yield* store.read(runId)).toEqual(before)
      expect(
        yield* store.beginRun(runId, target, policy, remotePublicationTargetForTest).pipe(Effect.flip)
      ).toMatchObject({ _tag: "WorkflowRunAlreadyBegan" })
      expect(yield* store.append(runId, JournalRecordKey.make("late"), fixture.intent).pipe(Effect.flip)).toMatchObject(
        { _tag: "WorkflowRunAlreadyTerminated" }
      )
      expect(yield* store.terminateRun(runId, "Completed", fixture.evidence).pipe(Effect.flip)).toMatchObject({
        _tag: "WorkflowRunAlreadyTerminated"
      })
      expect(yield* store.readRunForRecovery(runId, target).pipe(Effect.flip)).toMatchObject({
        _tag: "WorkflowRunAlreadyTerminated"
      })
      expect(yield* store.readRunForRecovery(runId, FixtureTarget.make("foreign")).pipe(Effect.flip)).toMatchObject({
        _tag: "WorkflowRunTargetMismatch"
      })
      expect(yield* store.readCompletion(RunId.make("unknown"))).toEqual({ _tag: "NoCompletion", runId: "unknown" })
    }).pipe(Effect.provide(layer))
  )
}

const withDatabase = <A, E, R>(use: (filename: JournalDatabaseLocator) => Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-completion-" })
      return yield* use(JournalDatabaseLocator.make(path.join(directory, "journal.sqlite")))
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
  )
const withSql = <A, E, R>(
  filename: JournalDatabaseLocator,
  use: (sql: SqliteClient.SqliteClient) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqliteClient.make({ filename })
      return yield* use(sql)
    }).pipe(Effect.provide(Reactivity.layer))
  )

for (const cut of ["before", "after"] as const) {
  it.effect(
    `SQLite reconciles completion ${cut === "before" ? "rollback before commit" : "lost acknowledgement after commit"} on reopen`,
    () =>
      withDatabase((filename) =>
        Effect.gen(function* () {
          const fixture = yield* Effect.scoped(
            Effect.gen(function* () {
              const fixture = yield* prepare
              const store = yield* JournalStore
              const failure = yield* store.terminateRun(runId, "Completed", fixture.evidence).pipe(Effect.flip)
              expect(failure).toMatchObject({ _tag: "JournalStorageUnavailable" })
              expect((yield* store.readCompletion(runId))._tag).toBe(cut === "before" ? "NoCompletion" : "CompletedRun")
              return fixture
            }).pipe(
              Effect.provide(
                sqliteJournalTestLayer({
                  filename,
                  ...(cut === "before"
                    ? { beforeCompletionCommit: () => Effect.fail("cut before COMMIT") }
                    : { afterCompletionCommit: () => Effect.fail("lost response") })
                })
              )
            )
          )
          yield* Effect.scoped(
            Effect.gen(function* () {
              const store = yield* JournalStore
              if (cut === "before") {
                expect(yield* store.readCompletion(runId)).toMatchObject({ _tag: "NoCompletion" })
                yield* store.terminateRun(runId, "Completed", fixture.evidence)
              } else {
                expect(yield* store.terminateRun(runId, "Completed", fixture.evidence).pipe(Effect.flip)).toMatchObject(
                  { _tag: "WorkflowRunAlreadyTerminated" }
                )
              }
              expect(yield* store.readCompletion(runId)).toMatchObject({
                _tag: "CompletedRun",
                completion: { timing: { _tag: "Known" } }
              })
              expect(
                (yield* store.read(runId)).filter(({ event }) => event._tag === "WorkflowRunTerminated")
              ).toHaveLength(1)
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
          )
        })
      )
  )
}

it.effect("backfills legacy completion receipts without inventing dates or losing histories", () =>
  withDatabase((filename) =>
    Effect.gen(function* () {
      const original = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* finish
          yield* (yield* JournalStore).retireTerminalRun(runId)
          return yield* (yield* JournalStore).read(runId)
        }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
      )
      yield* withSql(filename, (sql) =>
        Effect.gen(function* () {
          yield* sql`DROP TABLE archive_histories`
          yield* sql`DROP TABLE run_completions`
          yield* sql`DROP INDEX journal_terminal_runs`
          yield* sql`DROP INDEX journal_cold_terminal_runs`
          yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 3`
          yield* sql`PRAGMA user_version = 2`
        })
      )
      const baseline = yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* JournalStore
          const result = yield* store.readCompletion(runId)
          expect(result).toMatchObject({
            _tag: "CompletedRun",
            history: "Available",
            completion: {
              timing: { _tag: "LegacyBaseline", originalTime: "Unknown", verifiedAt: yield* Clock.currentTimeMillis }
            }
          })
          expect(yield* store.read(runId)).toEqual(original)
          return result
        }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
      )
      yield* TestClock.adjust("1 day")
      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* JournalStore
          expect(yield* store.readCompletion(runId)).toEqual(baseline)
          expect(yield* store.read(runId)).toEqual(original)
          expect((yield* store.scanHot()).runs).toEqual([])
          yield* TestClock.adjust("29 days")
          yield* store.maintainArchive()
          expect(yield* store.readCompletion(runId)).toMatchObject({
            ...baseline,
            history: "Deleted",
            deletion: { reason: "Age" }
          })
        }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
      )
    })
  )
)

it.effect("independent SQLite completion reads do not load any complete partition", () =>
  withDatabase((filename) =>
    Effect.gen(function* () {
      yield* Effect.scoped(finish.pipe(Effect.provide(sqliteJournalTestLayer({ filename }))))
      const loads = yield* Ref.make(0)
      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* JournalStore
          yield* Ref.set(loads, 0)
          expect(yield* store.readCompletion(runId)).toMatchObject({ _tag: "CompletedRun" })
          expect(yield* Ref.get(loads)).toBe(0)
        }).pipe(
          Effect.provide(
            sqliteJournalTestLayer({ filename, onPartitionRowsQueried: () => Ref.update(loads, (n) => n + 1) })
          )
        )
      )
    })
  )
)

it.effect("reports contradictory completion metadata without rewriting it", () =>
  withDatabase((filename) =>
    Effect.gen(function* () {
      yield* Effect.scoped(finish.pipe(Effect.provide(sqliteJournalTestLayer({ filename }))))
      yield* withSql(filename, (sql) =>
        Effect.asVoid(
          sql`UPDATE run_completions SET completion_json = REPLACE(completion_json, 'Completed', 'Cancelled')`
        )
      )
      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* JournalStore
          expect(yield* store.readCompletion(runId).pipe(Effect.flip)).toMatchObject({ _tag: "JournalDataCorruption" })
          expect(
            yield* store.beginRun(runId, target, policy, remotePublicationTargetForTest).pipe(Effect.flip)
          ).toMatchObject({ _tag: "JournalDataCorruption" })
          expect(yield* store.auditAll().pipe(Effect.flip)).toMatchObject({ _tag: "JournalDataCorruption" })
        }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
      )
      const rows = yield* withSql(filename, (sql) => sql`SELECT completion_json FROM run_completions`)
      expect(rows).toEqual([expect.objectContaining({ completion_json: expect.stringContaining('"Cancelled"') })])
    })
  )
)

it.effect("memory adopts valid legacy histories and reports invalid terminal histories unchanged", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(memoryJournalStoreLayer)
    const store = Context.get(context, JournalStore)
    yield* finish.pipe(Effect.provideService(JournalStore, store))
    const records = yield* store.read(runId)
    yield* Effect.gen(function* () {
      const adopted = yield* JournalStore
      expect(yield* adopted.readCompletion(runId)).toMatchObject({
        _tag: "CompletedRun",
        completion: { timing: { _tag: "LegacyBaseline", originalTime: "Unknown" } }
      })
      expect(yield* adopted.read(runId)).toEqual(records)
    }).pipe(Effect.provide(memoryJournalStoreLayerFromPartitionRecords({ cold: records })))
    const broken = records.filter((_, index) => index !== 1)
    yield* Effect.gen(function* () {
      const invalid = yield* JournalStore
      expect(yield* invalid.readCompletion(runId).pipe(Effect.flip)).toMatchObject({ _tag: "JournalHistoryCorruption" })
      expect((yield* invalid.auditAll()).issues.length).toBeGreaterThan(0)
    }).pipe(Effect.provide(memoryJournalStoreLayerFromPartitionRecords({ cold: broken })))
  })
)

for (const cut of ["before", "after"] as const) {
  it.effect(`SQLite preserves legacy backfill across ${cut} commit`, () =>
    withDatabase((filename) =>
      Effect.gen(function* () {
        const original = yield* Effect.scoped(
          Effect.gen(function* () {
            yield* finish
            return yield* (yield* JournalStore).read(runId)
          }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
        )
        yield* withSql(filename, (sql) => Effect.asVoid(sql`DELETE FROM run_completions`))
        const failure = yield* Effect.scoped(
          Effect.gen(function* () {
            yield* JournalStore
          }).pipe(
            Effect.provide(
              sqliteJournalTestLayer({
                filename,
                ...(cut === "before"
                  ? { beforeBackfillCommit: () => Effect.fail("backfill transaction cut") }
                  : { afterBackfillCommit: () => Effect.fail("backfill acknowledgement lost") })
              })
            ),
            Effect.flip
          )
        )
        expect(failure).toMatchObject({ _tag: "JournalStorageUnavailable" })
        const committed = yield* withSql(filename, (sql) => sql`SELECT completion_json FROM run_completions`)
        expect(committed).toHaveLength(cut === "before" ? 0 : 1)
        yield* TestClock.adjust("1 day")
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const store = yield* JournalStore
            expect(yield* store.read(runId)).toEqual(original)
            const result = yield* store.readCompletion(runId)
            expect(result).toMatchObject({
              _tag: "CompletedRun",
              completion: { timing: { _tag: "LegacyBaseline", originalTime: "Unknown" } }
            })
            return result
          }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
        )
        if (cut === "after") {
          const persisted = yield* withSql(filename, (sql) => sql`SELECT completion_json FROM run_completions`)
          expect(persisted).toEqual(committed)
        }
        yield* TestClock.adjust("1 day")
        yield* Effect.scoped(
          Effect.gen(function* () {
            expect(yield* (yield* JournalStore).readCompletion(runId)).toEqual(result)
          }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
        )
      })
    )
  )
}

it.effect("SQLite refuses invalid legacy terminal history without creating a receipt", () =>
  withDatabase((filename) =>
    Effect.gen(function* () {
      yield* Effect.scoped(finish.pipe(Effect.provide(sqliteJournalTestLayer({ filename }))))
      yield* withSql(filename, (sql) =>
        Effect.gen(function* () {
          yield* sql`DELETE FROM run_completions`
          yield* sql`UPDATE journal_records SET payload_json = 'invalid legacy bytes' WHERE event_kind = 'WorkflowRunTerminated'`
        })
      )
      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* JournalStore
          expect(yield* store.readCompletion(runId).pipe(Effect.flip)).toMatchObject({
            _tag: "JournalHistoryCorruption"
          })
          expect((yield* store.auditAll()).issues.length).toBeGreaterThan(0)
        }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
      )
      const receipts = yield* withSql(filename, (sql) => sql`SELECT run_id FROM run_completions`)
      expect(receipts).toEqual([])
      const terminal = yield* withSql(
        filename,
        (sql) => sql`SELECT payload_json FROM journal_records WHERE event_kind = 'WorkflowRunTerminated'`
      )
      expect(terminal).toEqual([{ payload_json: "invalid legacy bytes" }])
    })
  )
)

it.effect("memory fails contradictory receipt/history closed without adopting another outcome", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(memoryJournalStoreLayer)
    const store = Context.get(context, JournalStore)
    yield* finish.pipe(Effect.provideService(JournalStore, store))
    const result = yield* store.readCompletion(runId)
    if (result._tag !== "CompletedRun") return yield* Effect.die("fixture must be terminal")
    const records = yield* store.read(runId)
    const contradictory = { ...result.completion, disposition: "Cancelled" as const }
    yield* Effect.gen(function* () {
      const invalid = yield* JournalStore
      expect(yield* invalid.readCompletion(runId).pipe(Effect.flip)).toMatchObject({ _tag: "JournalDataCorruption" })
      expect(
        yield* invalid.beginRun(runId, target, policy, remotePublicationTargetForTest).pipe(Effect.flip)
      ).toMatchObject({ _tag: "JournalDataCorruption" })
      expect(yield* invalid.auditAll().pipe(Effect.flip)).toMatchObject({ _tag: "JournalDataCorruption" })
      expect(yield* invalid.read(runId)).toEqual(records)
    }).pipe(
      Effect.provide(memoryJournalStoreLayerFromPartitionRecords({ cold: records, completions: [contradictory] }))
    )
  })
)
