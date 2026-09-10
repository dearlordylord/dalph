import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Ref } from "effect"
import { describe, expect } from "vitest"
import { RunId } from "@dalph/contracts"
import {
  FixtureTarget,
  InitialControlPolicy,
  JournalDatabaseLocator,
  JournalRecordKey,
  JournalStore,
  JournalStoreContradiction,
  OperationId,
  sqliteJournalTestLayer,
  TaskWorkCapacity,
  taskTrackerReadIntent,
  WorkflowOperation,
  WorkflowRunAlreadyTerminated
} from "../index.js"
import { completedRunFinalityFixture } from "../../test/run-finality.js"
import { intentRecordKey, outcomeRecordKey } from "./record-key.js"

const intent = (operationId: string) =>
  taskTrackerReadIntent(
    WorkflowOperation.cases.ReadTrackerGraph.make({
      cause: { _tag: "WorkflowEstablishment" },
      operationId: OperationId.make(operationId),
      predecessorOperationIds: [],
      readShape: { _tag: "CompleteTargetClosure", explicitlyCoveredTaskIds: [] },
      target: FixtureTarget.make(`target-${operationId}`)
    })
  )

describe("SQLite warm append storage checkpoint", () => {
  it.effect("decodes a long Run once and appends successors without loading its accepted prefix again", () =>
    Effect.gen(function* () {
      const loadedRowCounts = yield* Ref.make<ReadonlyArray<number>>([])
      const inserted = yield* Ref.make(0)
      const keyLookups = yield* Ref.make(0)
      const layer = sqliteJournalTestLayer({
        filename: JournalDatabaseLocator.make(":memory:"),
        onAppendInserted: () => Ref.update(inserted, (count) => count + 1),
        onAppendKeyLookup: () => Ref.update(keyLookups, (count) => count + 1),
        onPartitionLoaded: (_partition, _runId, rowCount) =>
          Ref.update(loadedRowCounts, (counts) => [...counts, rowCount])
      })
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        const runId = RunId.make("warm-long-run")
        for (let index = 1; index <= 64; index++) {
          yield* journal.append(runId, JournalRecordKey.make(`record-${index}`), intent(`seed-${index}`))
        }
        yield* journal.read(runId)
        const beforeWarmAppends = yield* Ref.get(loadedRowCounts)
        for (let index = 65; index <= 80; index++) {
          yield* journal.append(runId, JournalRecordKey.make(`record-${index}`), intent(`successor-${index}`))
        }

        expect(yield* Ref.get(loadedRowCounts)).toEqual(beforeWarmAppends)
        expect(beforeWarmAppends).toEqual([0, 64])
        expect(yield* Ref.get(inserted)).toBe(80)
        expect(yield* Ref.get(keyLookups)).toBe(80)
        expect((yield* journal.read(runId)).map(({ position }) => position)).toEqual(
          Array.from({ length: 80 }, (_, index) => index + 1)
        )
      }).pipe(Effect.provide(layer))
    })
  )

  it.effect(
    "invalidates after a lost COMMIT acknowledgement and returns the committed duplicate without reinserting",
    () =>
      Effect.gen(function* () {
        const failCommitAcknowledgement = yield* Ref.make(true)
        const loads = yield* Ref.make<ReadonlyArray<number>>([])
        const inserts = yield* Ref.make(0)
        const event = intent("lost-commit")
        const runId = RunId.make("lost-commit-run")
        const key = JournalRecordKey.make("lost-commit-key")
        const layer = sqliteJournalTestLayer({
          afterAppendCommit: () =>
            Ref.getAndSet(failCommitAcknowledgement, false).pipe(
              Effect.flatMap((mustFail) =>
                mustFail ? Effect.fail("controlled lost COMMIT acknowledgement") : Effect.void
              )
            ),
          filename: JournalDatabaseLocator.make(":memory:"),
          onAppendInserted: () => Ref.update(inserts, (count) => count + 1),
          onPartitionLoaded: (_partition, _runId, rowCount) => Ref.update(loads, (counts) => [...counts, rowCount])
        })
        yield* Effect.gen(function* () {
          const journal = yield* JournalStore
          expect(yield* Effect.flip(journal.append(runId, key, event))).toMatchObject({
            _tag: "JournalStorageUnavailable",
            operation: "JournalStore.append"
          })

          const reconciled = yield* journal.append(runId, key, event)

          expect(reconciled).toMatchObject({ key, position: 1, runId })
          expect(yield* Ref.get(inserts)).toBe(1)
          expect(yield* Ref.get(loads)).toEqual([0, 1])
        }).pipe(Effect.provide(layer))
      })
  )

  it.effect("keeps the transaction and checkpoint publication serialized across concurrent appends", () =>
    Effect.gen(function* () {
      const firstCommitted = yield* Deferred.make<void>()
      const releaseFirstPublication = yield* Deferred.make<void>()
      const commitOrdinal = yield* Ref.make(0)
      const layer = sqliteJournalTestLayer({
        afterAppendCommit: () =>
          Ref.updateAndGet(commitOrdinal, (ordinal) => ordinal + 1).pipe(
            Effect.flatMap((ordinal) =>
              ordinal === 1
                ? Deferred.succeed(firstCommitted, undefined).pipe(
                    Effect.andThen(Deferred.await(releaseFirstPublication))
                  )
                : Effect.void
            )
          ),
        filename: JournalDatabaseLocator.make(":memory:")
      })
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        const runId = RunId.make("serialized-publication-run")
        const first = yield* Effect.forkChild(journal.append(runId, JournalRecordKey.make("first"), intent("first")))
        yield* Deferred.await(firstCommitted)
        const second = yield* Effect.forkChild(journal.append(runId, JournalRecordKey.make("second"), intent("second")))
        yield* Effect.yieldNow

        expect(yield* Ref.get(commitOrdinal)).toBe(1)
        expect(second.pollUnsafe()).toBeUndefined()

        yield* Deferred.succeed(releaseFirstPublication, undefined)
        const records = [yield* Fiber.join(first), yield* Fiber.join(second)]
        expect(records.map(({ position }) => position)).toEqual([1, 2])
        expect(yield* Ref.get(commitOrdinal)).toBe(2)
      }).pipe(Effect.provide(layer))
    })
  )

  it.effect("rejects a duplicate before inspecting its content once the Run is terminal", () => {
    const runId = RunId.make("terminal-before-duplicate-run")
    const target = FixtureTarget.make("terminal-before-duplicate-target")
    return Effect.gen(function* () {
      const journal = yield* JournalStore
      const fixture = completedRunFinalityFixture({ runId, target })
      yield* journal.beginRun(
        runId,
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      )
      yield* journal.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
      yield* journal.append(runId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
      yield* journal.terminateRun(runId, "Completed", fixture.evidence)

      const equal = yield* Effect.flip(
        journal.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
      )
      const unequal = yield* Effect.flip(
        journal.append(runId, intentRecordKey(fixture.operation.operationId), intent("different-content"))
      )
      expect(equal).toBeInstanceOf(WorkflowRunAlreadyTerminated)
      expect(unequal).toBeInstanceOf(WorkflowRunAlreadyTerminated)
      expect(equal).not.toBeInstanceOf(JournalStoreContradiction)
      expect(unequal).not.toBeInstanceOf(JournalStoreContradiction)
    }).pipe(Effect.provide(sqliteJournalTestLayer({ filename: JournalDatabaseLocator.make(":memory:") })))
  })
})
