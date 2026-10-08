import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import { RunId } from "@dalph/contracts"
import { remotePublicationTargetForTest } from "../../test/support/direct-publication.js"
import { completedRunFinalityFixture } from "../../test/run-finality.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { OperationId } from "../workflow/identity.js"
import { taskTrackerReadIntent } from "../workflow/registry/event.js"
import { makeTrackerGraphObservationOperation } from "../workflow/registry/operation.js"
import { sqliteJournalTestLayer } from "./adapters/sqlite-store.js"
import { JournalDatabaseLocator, JournalRecordKey } from "./identity.js"
import { makeTraceReader } from "../presentation/trace-reader.js"
import { JournalStore } from "./store.js"
import { intentRecordKey, outcomeRecordKey } from "./record-key.js"

const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
const runId = RunId.make("sqlite-read-cache")
const target = FixtureTarget.make("sqlite-read-cache-target")
const intent = (name: string) =>
  taskTrackerReadIntent(
    makeTrackerGraphObservationOperation({ _tag: "WorkflowEstablishment" }, OperationId.make(name), target, [], [])
  )

it.effect("shares selected startup scan events with the first append checkpoint", () =>
  Effect.gen(function* () {
    const queries = yield* Ref.make(0)
    yield* Effect.gen(function* () {
      const journal = yield* JournalStore
      yield* journal.beginRun(runId, target, policy, remotePublicationTargetForTest)
      yield* Ref.set(queries, 0)
      const scan = yield* journal.scanHot(runId)
      const selected = scan.runs.find((run) => run.runId === runId)
      expect(selected?.records).toHaveLength(1)
      yield* journal.append(runId, JournalRecordKey.make("startup-first-append"), intent("startup-first-append"))
      const current = yield* journal.read(runId)
      expect(current).toHaveLength(2)
      expect(selected?.records).toHaveLength(1)
      expect(current[0]?.event).toBe(selected?.records[0]?.event)
      expect(yield* Ref.get(queries)).toBe(0)
    }).pipe(
      Effect.provide(
        sqliteJournalTestLayer({
          filename: JournalDatabaseLocator.make(":memory:"),
          onPartitionRowsQueried: () => Ref.update(queries, (n) => n + 1)
        })
      )
    )
  })
)

it.effect("retains only the requested startup Run and does not invent a missing Run", () =>
  Effect.gen(function* () {
    const queries = yield* Ref.make(0)
    yield* Effect.gen(function* () {
      const journal = yield* JournalStore
      const other = RunId.make("other-startup-run")
      yield* journal.beginRun(runId, target, policy, remotePublicationTargetForTest)
      yield* journal.beginRun(other, target, policy, remotePublicationTargetForTest)
      yield* Ref.set(queries, 0)
      const scan = yield* journal.scanHot(runId)
      expect(scan.runs).toHaveLength(2)
      yield* journal.read(runId)
      expect(yield* Ref.get(queries)).toBe(0)
      yield* journal.read(other)
      expect(yield* Ref.get(queries)).toBe(1)
      const missing = RunId.make("missing-startup-run")
      const next = yield* journal.scanHot(missing)
      expect(next.runs.some((run) => run.runId === missing)).toBe(false)
      yield* journal.read(runId)
      expect(yield* Ref.get(queries)).toBe(2)
    }).pipe(
      Effect.provide(
        sqliteJournalTestLayer({
          filename: JournalDatabaseLocator.make(":memory:"),
          onPartitionRowsQueried: () => Ref.update(queries, (n) => n + 1)
        })
      )
    )
  })
)

it.effect("loads unchanged Hot history once, reuses the array, and invalidates on append and scans", () =>
  Effect.gen(function* () {
    const queries = yield* Ref.make(0)
    yield* Effect.gen(function* () {
      const journal = yield* JournalStore
      yield* journal.beginRun(runId, target, policy, remotePublicationTargetForTest)
      yield* Ref.set(queries, 0)
      const first = yield* journal.read(runId)
      expect(yield* journal.read(runId)).toBe(first)
      expect(yield* Ref.get(queries)).toBe(1)
      const event = intent("cache-append")
      yield* journal.append(runId, JournalRecordKey.make("cache-append"), event)
      const next = yield* journal.read(runId)
      expect(next).not.toBe(first)
      expect(next).toHaveLength(2)
      expect(first).toHaveLength(1)
      // The exclusive store already proved this immutable event; decoding it
      // again retains another complete payload beside the active Journal.
      expect(next[0]?.event).toBe(first[0]?.event)
      expect(yield* journal.read(runId)).toBe(next)
      expect(yield* Ref.get(queries)).toBe(1)
      yield* journal.scanHot()
      expect(yield* journal.read(runId)).not.toBe(next)
      const beforeAudit = yield* journal.read(runId)
      yield* journal.auditAll()
      expect(yield* journal.read(runId)).not.toBe(beforeAudit)
      const beforeRecovery = yield* journal.read(runId)
      yield* journal.readRunForRecovery(runId, target)
      expect(yield* journal.read(runId)).not.toBe(beforeRecovery)
    }).pipe(
      Effect.provide(
        sqliteJournalTestLayer({
          filename: JournalDatabaseLocator.make(":memory:"),
          onPartitionRowsQueried: () => Ref.update(queries, (n) => n + 1)
        })
      )
    )
  })
)

it.effect("invalidates a cached array after lost append acknowledgement without duplicating the row", () =>
  Effect.gen(function* () {
    const failNext = yield* Ref.make(false)
    yield* Effect.gen(function* () {
      const journal = yield* JournalStore
      yield* journal.beginRun(runId, target, policy, remotePublicationTargetForTest)
      const first = yield* journal.read(runId)
      yield* Ref.set(failNext, true)
      const event = intent("cache-ambiguous")
      const key = JournalRecordKey.make("cache-ambiguous")
      expect((yield* journal.append(runId, key, event).pipe(Effect.result))._tag).toBe("Failure")
      const committed = yield* journal.read(runId)
      expect(committed).not.toBe(first)
      expect(committed).toHaveLength(2)
      const replay = yield* journal.append(runId, key, event)
      expect(replay.position).toBe(2)
      expect(yield* journal.read(runId)).toEqual(committed)
    }).pipe(
      Effect.provide(
        sqliteJournalTestLayer({
          filename: JournalDatabaseLocator.make(":memory:"),
          afterAppendCommit: () =>
            Ref.getAndSet(failNext, false).pipe(
              Effect.flatMap((fail) => (fail ? Effect.fail("lost response") : Effect.void))
            )
        })
      )
    )
  })
)

it.effect("invalidates on termination and retirement, then loads unchanged Cold history once", () =>
  Effect.gen(function* () {
    const queries = yield* Ref.make(0)
    yield* Effect.gen(function* () {
      const journal = yield* JournalStore
      yield* journal.beginRun(runId, target, policy, remotePublicationTargetForTest)
      const fixture = completedRunFinalityFixture({ runId, target })
      yield* journal.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
      yield* journal.append(runId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
      const prefix = yield* journal.read(runId)
      yield* journal.terminateRun(runId, "Completed", fixture.evidence)
      const terminal = yield* journal.read(runId)
      expect(terminal).not.toBe(prefix)
      expect(terminal).toHaveLength(prefix.length + 1)
      yield* journal.retireTerminalRun(runId)
      yield* Ref.set(queries, 0)
      const cold = yield* journal.read(runId)
      expect(cold).not.toBe(terminal)
      expect(cold).toEqual(terminal)
      expect(yield* journal.read(runId)).toBe(cold)
      const reader = makeTraceReader(journal)
      const prepared = yield* reader.prepare(runId)
      expect(yield* reader.prepare(runId)).toBe(prepared)
      expect(yield* Ref.get(queries)).toBe(1)
    }).pipe(
      Effect.provide(
        sqliteJournalTestLayer({
          filename: JournalDatabaseLocator.make(":memory:"),
          onPartitionRowsQueried: () => Ref.update(queries, (n) => n + 1)
        })
      )
    )
  })
)

it.effect("discards the ordinary read snapshot after a failed read boundary", () =>
  Effect.gen(function* () {
    const failNext = yield* Ref.make(false)
    yield* Effect.gen(function* () {
      const journal = yield* JournalStore
      yield* journal.beginRun(runId, target, policy, remotePublicationTargetForTest)
      const first = yield* journal.read(runId)
      yield* Ref.set(failNext, true)
      expect((yield* journal.read(runId).pipe(Effect.exit))._tag).toBe("Failure")
      const reloaded = yield* journal.read(runId)
      expect(reloaded).not.toBe(first)
      expect(reloaded).toEqual(first)
    }).pipe(
      Effect.provide(
        sqliteJournalTestLayer({
          filename: JournalDatabaseLocator.make(":memory:"),
          beforeReadLoad: () =>
            Ref.getAndSet(failNext, false).pipe(
              Effect.flatMap((fail) => (fail ? Effect.die("controlled read failure") : Effect.void))
            )
        })
      )
    )
  })
)
