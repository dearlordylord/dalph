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
  it.effect("keeps warm append work constant when an active Run grows from N to 2N records", () =>
    Effect.gen(function* () {
      const partitionRowQueries = yield* Ref.make<ReadonlyArray<{ readonly rowCount: number; readonly runId: RunId }>>(
        []
      )
      const inserted = yield* Ref.make(0)
      const keyLookups = yield* Ref.make(0)
      const layer = sqliteJournalTestLayer({
        filename: JournalDatabaseLocator.make(":memory:"),
        onAppendInserted: () => Ref.update(inserted, (count) => count + 1),
        onAppendKeyLookup: () => Ref.update(keyLookups, (count) => count + 1),
        onPartitionRowsQueried: (_partition, runId, rowCount) =>
          Ref.update(partitionRowQueries, (queries) => [...queries, { rowCount, runId }])
      })
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        const measureWarmSuccessors = Effect.fn("SqliteWarmAppendTest.measureWarmSuccessors")(function* (
          prefixSize: number
        ) {
          const runId = RunId.make(`warm-prefix-${prefixSize}`)
          yield* journal.beginRun(
            runId,
            FixtureTarget.make(`warm-prefix-${prefixSize}-target`),
            InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
          )
          for (let index = 1; index <= prefixSize; index++) {
            yield* journal.append(
              runId,
              JournalRecordKey.make(`record-${prefixSize}-${index}`),
              intent(`seed-${prefixSize}-${index}`)
            )
          }
          yield* journal.read(runId)
          const queriesBefore = yield* Ref.get(partitionRowQueries)
          const insertsBefore = yield* Ref.get(inserted)
          const lookupsBefore = yield* Ref.get(keyLookups)
          for (let index = 1; index <= 16; index++) {
            yield* journal.append(
              runId,
              JournalRecordKey.make(`successor-${prefixSize}-${index}`),
              intent(`successor-${prefixSize}-${index}`)
            )
          }
          const queriesAfter = yield* Ref.get(partitionRowQueries)
          expect(queriesAfter).toEqual(queriesBefore)
          expect(queriesBefore.filter((query) => query.runId === runId).map(({ rowCount }) => rowCount)).toEqual([
            0,
            1,
            prefixSize + 1
          ])
          expect((yield* journal.read(runId)).map(({ position }) => position)).toEqual(
            Array.from({ length: prefixSize + 17 }, (_, index) => index + 1)
          )
          return {
            inserted: (yield* Ref.get(inserted)) - insertsBefore,
            keyLookups: (yield* Ref.get(keyLookups)) - lookupsBefore,
            partitionLoads: queriesAfter.length - queriesBefore.length
          }
        })

        const n = yield* measureWarmSuccessors(64)
        const twiceN = yield* measureWarmSuccessors(128)

        expect(n).toEqual({ inserted: 16, keyLookups: 16, partitionLoads: 0 })
        expect(twiceN).toEqual(n)
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
          onPartitionRowsQueried: (_partition, _runId, rowCount) => Ref.update(loads, (counts) => [...counts, rowCount])
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
        // forkChild queues the append on this fiber's public dispatcher; flush drains it synchronously.
        // Append encoding is synchronous before serialization.withPermit registers the blocked acquisition.
        const currentFiber = Fiber.getCurrent()
        if (currentFiber === undefined) {
          return yield* Effect.die("expected the Effect test fiber while flushing the second append")
        }
        currentFiber.currentDispatcher.flush()

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
