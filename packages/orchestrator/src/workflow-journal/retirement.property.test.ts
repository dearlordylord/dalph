import * as fc from "fast-check"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Path } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import { expect } from "vitest"
import { RunId } from "@dalph/contracts"
import { completedRunFinalityFixture } from "../../test/run-finality.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { reduceWorkflowJournalHistory } from "../coordination/reconstruction/history.js"
import { encodeJournalEvent } from "./event-codec.js"
import { memoryJournalTestLayer } from "./adapters/memory-store.js"
import { sqliteJournalTestLayer } from "./adapters/sqlite-store.js"
import { intentRecordKey, outcomeRecordKey } from "./record-key.js"
import { JournalDatabaseLocator } from "./identity.js"
import { JournalStore } from "./store.js"
import { makeTraceReader } from "../presentation/trace-reader.js"
import { makeWorkflowRunBeganRecord } from "./run-lifecycle.js"
import type { JournalRecord } from "./store.js"

const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
const nodePathAndFileSystemLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer)

const withTemporaryDatabase = <A, E, R>(use: (filename: JournalDatabaseLocator) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-journal-property-" })
    return yield* use(JournalDatabaseLocator.make(path.join(directory, "journal.sqlite")))
  }).pipe(Effect.provide(nodePathAndFileSystemLayer))

const withSqliteClient = <A, E, R>(
  filename: JournalDatabaseLocator,
  use: (sql: SqliteClient.SqliteClient) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      return yield* use(yield* SqliteClient.make({ filename }))
    }).pipe(Effect.provide(Reactivity.layer))
  )

const seedSchemaV1 = (filename: JournalDatabaseLocator, records: ReadonlyArray<JournalRecord>) =>
  withSqliteClient(filename, (sql) =>
    Effect.gen(function* () {
      yield* sql`
        CREATE TABLE effect_sql_migrations (
          migration_id INTEGER PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (1, 'create_current_journal_records')`
      yield* sql`PRAGMA user_version = 1`
      yield* sql`
        CREATE TABLE journal_records (
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
      for (const record of records) {
        const encoded = encodeJournalEvent(record.event)
        yield* sql`
          INSERT INTO journal_records
            (run_id, position, record_key, event_kind, event_version, payload_json)
          VALUES (${record.runId}, ${record.position}, ${record.key}, ${encoded.kind}, ${encoded.version}, ${encoded.payloadJson})
        `
      }
    })
  )

const terminalHistoryFor = (runId: RunId) => {
  const target = FixtureTarget.make(`retirement-property-${runId}`)
  const fixture = completedRunFinalityFixture({ runId, target })
  return Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target, initialPolicy)
    yield* journal.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
    yield* journal.append(runId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
    yield* journal.terminateRun(runId, "Completed", fixture.evidence)
    return journal
  })
}

const runMemory = <A, E>(effect: Effect.Effect<A, E, JournalStore>) =>
  Effect.runPromise(effect.pipe(Effect.provide(memoryJournalTestLayer)))

it("preserves exact order and encoded event bytes for arbitrary terminal Run identities", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string({ minLength: 1, maxLength: 24 }), async (suffix) => {
      const runId = RunId.make(`retirement-property-${suffix}`)
      const result = await runMemory(
        Effect.gen(function* () {
          const journal = yield* terminalHistoryFor(runId)
          const before = yield* journal.read(runId)
          const retired = yield* journal.retireTerminalRun(runId)
          const after = yield* journal.read(runId)
          return { after, before, retired }
        })
      )
      expect(result.retired._tag).toBe("Retired")
      expect(result.before.map(({ position }) => position)).toEqual(result.before.map((_, index) => index + 1))
      expect(result.after).toEqual(result.before)
      expect(result.after.map(({ event }) => encodeJournalEvent(event))).toEqual(
        result.before.map(({ event }) => encodeJournalEvent(event))
      )
    })
  )
})

it("never treats a valid nonterminal prefix as eligible for retirement", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 24 }),
      fc.integer({ min: 1, max: 3 }),
      async (suffix, prefixLength) => {
        const runId = RunId.make(`retirement-nonterminal-prefix-${suffix}`)
        const failure = await runMemory(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            const target = FixtureTarget.make(`retirement-nonterminal-target-${suffix}`)
            yield* journal.beginRun(runId, target, initialPolicy)
            const fixture = completedRunFinalityFixture({ runId, target })
            if (prefixLength >= 2) {
              yield* journal.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
            }
            if (prefixLength >= 3) {
              yield* journal.append(runId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
            }
            const before = yield* journal.read(runId)
            const retirementFailure = yield* Effect.flip(journal.retireTerminalRun(runId))
            return {
              before,
              failure: retirementFailure,
              hot: yield* journal.scanHot(),
              after: yield* journal.read(runId)
            }
          })
        )
        expect(failure.failure._tag).toBe("JournalHistoryNotTerminal")
        expect(failure.after).toEqual(failure.before)
        expect(failure.hot.runs).toContainEqual(expect.objectContaining({ runId }))
      }
    ),
    { numRuns: 40 }
  )
})

it("keeps the canonical reducer and read-only trace projection equivalent across retirement", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string({ minLength: 1, maxLength: 24 }), async (suffix) => {
      const runId = RunId.make(`retirement-trace-${suffix}`)
      const result = await runMemory(
        Effect.gen(function* () {
          const journal = yield* terminalHistoryFor(runId)
          const before = yield* journal.read(runId)
          yield* journal.retireTerminalRun(runId)
          const after = yield* journal.read(runId)
          return { after, before }
        })
      )
      const reduced = reduceWorkflowJournalHistory(runId, result.after)
      expect(reduced._tag).toBe("ValidWorkflowJournalHistory")
      const beforeTrace = await Effect.runPromise(
        makeTraceReader({ read: () => Effect.succeed(result.before) }).read(runId)
      )
      const afterTrace = await Effect.runPromise(
        makeTraceReader({ read: () => Effect.succeed(result.after) }).read(runId)
      )
      expect(afterTrace).toEqual(beforeTrace)
    }),
    { numRuns: 20 }
  )
})

it("makes an overlapping in-memory TraceReader read observe one complete partition state", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string({ minLength: 1, maxLength: 24 }), async (suffix) => {
      const runId = RunId.make(`retirement-crash-cut-${suffix}`)
      const result = await runMemory(
        Effect.gen(function* () {
          const journal = yield* terminalHistoryFor(runId)
          const reader = makeTraceReader({ read: journal.read })
          const before = yield* reader.read(runId)
          const [, observed] = yield* Effect.all([journal.retireTerminalRun(runId), reader.read(runId)], {
            concurrency: "unbounded"
          })
          const audit = yield* journal.auditAll()
          return { audit, before, observed }
        })
      )
      expect(result.observed).toEqual(result.before)
      expect(result.audit.runs.filter(({ runId: candidate }) => candidate === runId)).toHaveLength(1)
    }),
    { numRuns: 20 }
  )
})

it("makes terminal-history retirement idempotent and keeps one exclusive partition", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string({ minLength: 1, maxLength: 24 }), async (suffix) => {
      const runId = RunId.make(`retirement-idempotence-${suffix}`)
      const result = await runMemory(
        Effect.gen(function* () {
          const journal = yield* terminalHistoryFor(runId)
          yield* journal.retireTerminalRun(runId)
          const repeated = yield* journal.retireTerminalRun(runId)
          const audit = yield* journal.auditAll()
          const hot = yield* journal.scanHot()
          return { audit, hot, repeated }
        })
      )
      expect(result.repeated._tag).toBe("AlreadyRetired")
      expect(result.hot.runs).toEqual([])
      expect(result.audit.runs.filter(({ runId: candidate }) => candidate === runId)).toHaveLength(1)
      expect(result.audit.runs[0]?.partition).toBe("Cold")
    })
  )
})

it("keeps one complete partition across generated SQLite retirement crash cuts", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 24 }),
      fc.constantFrom("BeforeMove", "BeforeCommit", "AfterCommit"),
      async (suffix, cut) => {
        const runId = RunId.make(`retirement-sqlite-crash-cut-${cut}-${suffix}`)
        const result = await Effect.runPromise(
          Effect.scoped(
            withTemporaryDatabase((filename) =>
              Effect.gen(function* () {
                const before = yield* terminalHistoryFor(runId).pipe(
                  Effect.flatMap((journal) => journal.read(runId)),
                  Effect.provide(sqliteJournalTestLayer({ filename }))
                )
                if (cut !== "BeforeMove") {
                  yield* Effect.flip(
                    Effect.gen(function* () {
                      return yield* (yield* JournalStore).retireTerminalRun(runId)
                    }).pipe(
                      Effect.provide(
                        sqliteJournalTestLayer({
                          filename,
                          ...(cut === "BeforeCommit"
                            ? { afterRetirementCopy: () => Effect.fail("generated pre-commit cut") }
                            : { afterRetirementCommit: () => Effect.fail("generated post-commit cut") })
                        })
                      )
                    )
                  )
                }
                const reopened = yield* Effect.gen(function* () {
                  const journal = yield* JournalStore
                  const repeated = yield* journal.retireTerminalRun(runId)
                  return {
                    after: yield* journal.read(runId),
                    audit: yield* journal.auditAll(),
                    hot: yield* journal.scanHot(),
                    repeated
                  }
                }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
                return { ...reopened, before }
              })
            )
          )
        )
        expect(result.after).toEqual(result.before)
        expect(result.after).toEqual(result.audit.runs[0]?.records)
        expect(result.after).toHaveLength(4)
        expect(result.audit.runs).toHaveLength(1)
        expect(result.audit.runs[0]?.partition).toBe("Cold")
        expect(result.hot.runs).toEqual([])
        expect(result.repeated._tag).toBe(cut === "AfterCommit" ? "AlreadyRetired" : "Retired")
      }
    ),
    { numRuns: 15 }
  )
})

it("preserves generated schema-v1 Run-begin rows and leaves Cold empty through migration", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (runCount) => {
      const records = Array.from({ length: runCount }, (_, index) =>
        makeWorkflowRunBeganRecord(
          RunId.make(`migration-property-run-${index}`),
          FixtureTarget.make(`migration-property-target-${index}`),
          initialPolicy
        )
      )
      await Effect.runPromise(
        Effect.scoped(
          withTemporaryDatabase((filename) =>
            Effect.gen(function* () {
              yield* seedSchemaV1(filename, records)
              const before = records.map((record) => {
                const encoded = encodeJournalEvent(record.event)
                return {
                  event_kind: encoded.kind,
                  event_version: encoded.version,
                  payload_json: encoded.payloadJson,
                  position: record.position,
                  record_key: record.key,
                  run_id: record.runId
                }
              })
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const journal = yield* JournalStore
                  for (const record of records) expect(yield* journal.read(record.runId)).toEqual([record])
                }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
              )
              const after = yield* withSqliteClient(
                filename,
                (sql) =>
                  sql`
                  SELECT run_id, position, record_key, event_kind, event_version, payload_json
                  FROM journal_records ORDER BY run_id ASC, position ASC
                `
              )
              const cold = yield* withSqliteClient(
                filename,
                (sql) => sql`SELECT COUNT(*) AS count FROM journal_records_cold`
              )
              expect(after).toEqual(before.toSorted((left, right) => left.run_id.localeCompare(right.run_id)))
              expect(cold).toEqual([{ count: 0 }])
            })
          )
        )
      )
    }),
    { numRuns: 10 }
  )
})
