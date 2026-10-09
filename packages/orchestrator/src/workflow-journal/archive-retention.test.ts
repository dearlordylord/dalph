import { RunCompletionTime } from "./completion-model.js"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { it } from "@effect/vitest"
import { Clock, Deferred, Effect, Fiber, FileSystem, Layer, Path, Ref } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { RunId } from "@dalph/contracts"
import { completedRunFinalityFixture } from "../../test/run-finality.js"
import { remotePublicationTargetForTest } from "../../test/support/direct-publication.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { JournalDatabaseLocator, JournalPosition, JournalRecordKey } from "./identity.js"
import { intentRecordKey, outcomeRecordKey } from "./record-key.js"
import { JournalStorageUnavailable, JournalStore } from "./store.js"
import { memoryJournalStoreLayer } from "./adapters/memory-store.js"
import { sqliteJournalTestLayer } from "./adapters/sqlite-store.js"

import {
  archiveAgeMillis,
  archiveByteBudget,
  archivePassMillis,
  archiveRetentionPass,
  SavedArchiveBytes
} from "./archive-retention.js"
import { makeTraceReader, TraceCursor } from "../presentation/trace-reader.js"
import { encodeSqliteJournalEvent } from "./adapters/sqlite-event-codec.js"
import { OperationId } from "../workflow/identity.js"

const target = FixtureTarget.make("expiry-target")
const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
const finish = (runId: RunId) =>
  Effect.gen(function* () {
    const store = yield* JournalStore
    const fixture = completedRunFinalityFixture({ runId, target })
    yield* store.beginRun(runId, target, policy, remotePublicationTargetForTest)
    yield* store.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
    yield* store.append(runId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
    yield* store.terminateRun(runId, "Completed", fixture.evidence)
    yield* store.retireTerminalRun(runId)
    return fixture
  })
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

for (const [name, layer] of [
  ["memory", memoryJournalStoreLayer],
  ["SQLite", sqliteJournalTestLayer({ filename: JournalDatabaseLocator.make(":memory:") })]
] as const) {
  it.effect(
    `${name} expires complete terminal histories at the 30-day boundary and preserves aged unfinished responsibilities`,
    () =>
      Effect.gen(function* () {
        const store = yield* JournalStore
        const runId = RunId.make("expiry-雪")
        const activeId = RunId.make("aged-active")
        yield* store.beginRun(activeId, target, policy, remotePublicationTargetForTest)
        const active = yield* store.read(activeId)
        const fixture = yield* finish(runId)
        const receipt = yield* store.readCompletion(runId)
        const records = yield* store.read(runId)
        const reader = makeTraceReader({ read: store.read })
        const cursor = TraceCursor.make({ runId, position: records.at(-1)?.position ?? JournalPosition.make(1) })
        yield* reader.readAt(cursor)
        const saved = records.reduce((sum, record) => {
          const encoded = encodeSqliteJournalEvent(record.event)
          return (
            sum +
            [record.runId, record.key, encoded.kind, encoded.payloadJson].reduce(
              (bytes, value) => bytes + new TextEncoder().encode(value).byteLength,
              0
            ) +
            16
          )
        }, 0)
        expect((yield* store.maintainArchive()).savedBytes).toBe(saved)
        yield* TestClock.adjust(archiveAgeMillis - 1)
        expect((yield* store.maintainArchive()).deletedRuns).toEqual([])
        expect(yield* store.read(runId)).toEqual(records)
        yield* TestClock.adjust(1)
        const result = yield* store.maintainArchive()
        expect(result).toMatchObject({ savedBytes: 0, excessBytes: 0, deletedRuns: [runId], deferred: "None" })
        const deleted = yield* store.readCompletion(runId)
        expect(deleted).toMatchObject({
          ...receipt,
          history: "Deleted",
          deletion: { reason: "Age", observedAt: yield* Clock.currentTimeMillis }
        })
        for (const read of [
          store.read(runId).pipe(Effect.asVoid),
          reader.read(runId).pipe(Effect.asVoid),
          reader.readAt(cursor).pipe(Effect.asVoid),
          reader.prepare(runId).pipe(Effect.asVoid)
        ])
          expect(yield* read.pipe(Effect.flip)).toMatchObject({
            _tag: "JournalHistoryDeleted",
            completion: receipt._tag === "CompletedRun" ? receipt.completion : undefined
          })
        expect(yield* reader.read(RunId.make("unknown")).pipe(Effect.flip)).toMatchObject({ _tag: "TraceRunNotFound" })
        expect(yield* store.read(activeId)).toEqual(active)
        expect(
          yield* store.beginRun(runId, target, policy, remotePublicationTargetForTest).pipe(Effect.flip)
        ).toMatchObject({ _tag: "WorkflowRunAlreadyBegan" })
        expect(
          yield* store.append(runId, JournalRecordKey.make("late"), fixture.intent).pipe(Effect.flip)
        ).toMatchObject({ _tag: "WorkflowRunAlreadyTerminated" })
        expect(yield* store.terminateRun(runId, "Completed", fixture.evidence).pipe(Effect.flip)).toMatchObject({
          _tag: "WorkflowRunAlreadyTerminated"
        })
        expect(yield* store.readRunForRecovery(runId, target).pipe(Effect.flip)).toMatchObject({
          _tag: "WorkflowRunAlreadyTerminated"
        })
        expect(yield* store.readRunForRecovery(runId, FixtureTarget.make("foreign")).pipe(Effect.flip)).toMatchObject({
          _tag: "WorkflowRunTargetMismatch"
        })
        expect((yield* store.auditAll()).completions).toContainEqual(deleted)
        expect((yield* store.maintainArchive()).deletedRuns).toEqual([])
        yield* TestClock.adjust(0 - archiveAgeMillis)
        expect(yield* store.readCompletion(runId)).toEqual(deleted)
      }).pipe(Effect.provide(layer))
  )
}

for (const cut of ["beforeMutation", "before", "after"] as const) {
  it.effect(`SQLite reconciles archive purge ${cut} commit and acknowledgement loss after physical reopen`, () =>
    withDatabase((filename) =>
      Effect.gen(function* () {
        const runId = RunId.make(`purge-${cut}`)
        const original = yield* Effect.scoped(
          Effect.gen(function* () {
            yield* (yield* JournalStore).beginRun(
              RunId.make("protected-active"),
              target,
              policy,
              remotePublicationTargetForTest
            )
            yield* finish(runId)
            return yield* (yield* JournalStore).readCompletion(runId)
          }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
        )
        yield* TestClock.adjust(archiveAgeMillis)
        const observation = yield* Effect.scoped(
          Effect.gen(function* () {
            const store = yield* JournalStore
            return yield* store.maintainArchive()
          }).pipe(
            Effect.provide(
              sqliteJournalTestLayer({
                filename,
                ...(cut === "beforeMutation"
                  ? { beforeArchiveDelete: () => Effect.fail("before mutation") }
                  : cut === "before"
                    ? { beforeArchiveCommit: () => Effect.fail("before commit") }
                    : { afterArchiveCommit: () => Effect.fail("lost response") })
              })
            )
          )
        )
        expect(observation.deferred).toBe(cut === "after" ? "None" : "StorageFailure")
        yield* Effect.scoped(
          Effect.gen(function* () {
            const store = yield* JournalStore
            expect((yield* store.read(RunId.make("protected-active"))).length).toBe(1)
            const observed = yield* store.readCompletion(runId)
            expect(observed).toMatchObject({ ...original, history: cut === "after" ? "Deleted" : "Available" })
            if (cut !== "after") expect((yield* store.read(runId)).length).toBe(4)
            else expect(yield* store.read(runId).pipe(Effect.flip)).toMatchObject({ _tag: "JournalHistoryDeleted" })
            expect((yield* store.maintainArchive()).deletedRuns).toEqual(cut === "after" ? [] : [runId])
            expect((yield* store.auditAll()).completions).toMatchObject([{ history: "Deleted" }])
          }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
        )
        const stats = yield* withSql(
          filename,
          (sql) =>
            sql`SELECT (SELECT count(*) FROM journal_records_cold) AS details, (SELECT count(*) FROM run_completions) AS receipts, (SELECT count(*) FROM archive_histories) AS archives`
        )
        expect(stats).toEqual([{ details: 0, receipts: 1, archives: 0 }])
      })
    )
  )
}

it.effect("enforces saved archive bytes by whole-Run completion order, equality, and oversized histories", () =>
  Effect.gen(function* () {
    const a = { runId: RunId.make("a"), baseline: RunCompletionTime.make(0), bytes: SavedArchiveBytes.make(1) }
    const b = { runId: RunId.make("b"), baseline: RunCompletionTime.make(0), bytes: archiveByteBudget }
    const state = yield* Ref.make([b, a])
    const owner = {
      now: Effect.succeed(1),
      snapshot: () =>
        Ref.get(state).pipe(
          Effect.map((candidates) => ({
            expiredBacklog: 0,
            candidates,
            savedBytes: SavedArchiveBytes.make(candidates.reduce((sum, item) => sum + item.bytes, 0))
          }))
        ),
      remove: (candidate: typeof a) =>
        Ref.update(state, (current) => current.filter((item) => item.runId !== candidate.runId))
    }
    expect((yield* archiveRetentionPass(owner)).deletedRuns).toEqual([a.runId])
    expect((yield* archiveRetentionPass(owner)).deletedRuns).toEqual([])
    yield* Ref.set(state, [{ ...b, bytes: SavedArchiveBytes.make(archiveByteBudget + 1) }])
    expect((yield* archiveRetentionPass(owner)).deletedRuns).toEqual([b.runId])
    expect(yield* Ref.get(state)).toEqual([])
  })
)

it.effect("stops archive selection at exactly one second and progresses on a later pass", () =>
  Effect.gen(function* () {
    const candidates = ["a", "b"].map((id) => ({
      runId: RunId.make(id),
      baseline: RunCompletionTime.make(0),
      bytes: SavedArchiveBytes.make(archiveByteBudget + 1)
    }))
    const state = yield* Ref.make(candidates)
    const now = yield* Ref.make(Number(archiveAgeMillis))
    const owner = {
      now: Ref.get(now),
      snapshot: () =>
        Ref.get(state).pipe(
          Effect.map((remaining) => ({
            candidates: remaining,
            expiredBacklog: remaining.length,
            savedBytes: SavedArchiveBytes.make(remaining.reduce((sum, item) => sum + item.bytes, 0))
          }))
        ),
      remove: (candidate: (typeof candidates)[number]) =>
        Effect.gen(function* () {
          yield* Ref.update(state, (remaining) => remaining.filter((item) => item.runId !== candidate.runId))
          yield* Ref.update(now, (time) => time + archivePassMillis)
        })
    }
    expect(yield* archiveRetentionPass(owner)).toEqual({
      savedBytes: archiveByteBudget + 1,
      excessBytes: 1,
      expiredBacklog: 1,
      deletedRuns: [RunId.make("a")],
      deferred: "Bound"
    })
    expect((yield* Ref.get(state)).map((candidate) => candidate.runId)).toEqual([RunId.make("b")])
    expect(yield* archiveRetentionPass(owner)).toEqual({
      savedBytes: 0,
      excessBytes: 0,
      expiredBacklog: 0,
      deletedRuns: [RunId.make("b")],
      deferred: "None"
    })
  })
)

it.effect("bounds archive maintenance and honestly reports an expired backlog for later ordinary passes", () =>
  Effect.gen(function* () {
    const store = yield* JournalStore
    for (let index = 0; index < 35; index++) yield* finish(RunId.make(`bounded-${String(index).padStart(2, "0")}`))
    yield* TestClock.adjust(archiveAgeMillis)
    const first = yield* store.maintainArchive()
    expect(first).toMatchObject({ deferred: "Bound", expiredBacklog: 3 })
    expect(first.deletedRuns.length).toBe(32)
    expect((yield* store.maintainArchive()).deletedRuns.length).toBe(3)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

for (const [name, layer] of [
  ["memory", memoryJournalStoreLayer],
  ["SQLite", sqliteJournalTestLayer({ filename: JournalDatabaseLocator.make(":memory:") })]
] as const) {
  it.effect(
    `${name} deletes an oversized eligible Run as one unit using actual saved bytes`,
    () =>
      Effect.gen(function* () {
        const store = yield* JournalStore
        const runId = RunId.make("oversized")
        const fixture = completedRunFinalityFixture({
          runId,
          target,
          operationId: OperationId.make("x".repeat(60 * 1024 * 1024))
        })
        yield* store.beginRun(runId, target, policy, remotePublicationTargetForTest)
        // The large saved observation and termination evidence exceed compression eligibility.
        yield* store.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
        yield* store.append(runId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
        yield* store.terminateRun(runId, "Completed", fixture.evidence)
        yield* store.retireTerminalRun(runId)
        const before = yield* store.readCompletion(runId)
        expect((yield* store.read(runId)).length).toBe(4)
        const result = yield* store.maintainArchive()
        expect(result).toMatchObject({ savedBytes: 0, deletedRuns: [runId] })
        expect(yield* store.readCompletion(runId)).toMatchObject({
          ...before,
          history: "Deleted",
          deletion: { reason: "Budget" }
        })
        expect(yield* store.read(runId).pipe(Effect.flip)).toMatchObject({ _tag: "JournalHistoryDeleted" })
      }).pipe(Effect.provide(layer)),
    { timeout: 60_000 }
  )
}

it.effect("SQLite distinguishes expired details from unknown Run across overlapping reads", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const layer = sqliteJournalTestLayer({
        filename: JournalDatabaseLocator.make(":memory:"),
        beforeReadLoad: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
      })
      yield* Effect.gen(function* () {
        const store = yield* JournalStore
        const runId = RunId.make("overlap")
        yield* finish(runId)
        yield* TestClock.adjust(archiveAgeMillis)
        const reading = yield* store.read(runId).pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        const purging = yield* store.maintainArchive().pipe(Effect.forkChild)
        yield* Deferred.succeed(release, undefined)
        expect((yield* Fiber.join(reading)).length).toBe(4)
        expect((yield* Fiber.join(purging)).deletedRuns).toEqual([runId])
        expect(yield* store.read(runId).pipe(Effect.flip)).toMatchObject({ _tag: "JournalHistoryDeleted" })
        expect(yield* store.read(RunId.make("unknown"))).toEqual([])
      }).pipe(Effect.provide(layer))
    })
  )
)

it.effect("reports deferred excess at a failed storage boundary without immediately retrying", () =>
  Effect.gen(function* () {
    const runId = RunId.make("failure")
    const attempts = yield* Ref.make(0)
    const failure = new JournalStorageUnavailable({
      operation: "JournalStore.maintainArchive",
      detail: "controlled storage failure"
    })
    const result = yield* archiveRetentionPass({
      now: Effect.succeed(1),
      snapshot: () =>
        Effect.succeed({
          expiredBacklog: 0,
          savedBytes: SavedArchiveBytes.make(archiveByteBudget + 1),
          candidates: [
            { runId, baseline: RunCompletionTime.make(0), bytes: SavedArchiveBytes.make(archiveByteBudget + 1) }
          ]
        }),
      remove: () => Ref.update(attempts, (count) => count + 1).pipe(Effect.andThen(Effect.fail(failure)))
    })
    expect(result).toMatchObject({ deferred: "StorageFailure", excessBytes: 1, deletedRuns: [], failure })
    expect(yield* Ref.get(attempts)).toBe(1)
  })
)
