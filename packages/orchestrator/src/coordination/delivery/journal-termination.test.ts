import { it } from "@effect/vitest"
import { RunId } from "@dalph/contracts"
import { Deferred, Effect, Fiber, Ref } from "effect"
import { expect } from "vitest"
import { completedRunFinalityFixture } from "../../../test/run-finality.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { observeJournalRecordSequenceOperations } from "../../workflow-journal/record-sequence.js"
import { JournalStorageUnavailable, JournalStore } from "../../workflow-journal/store.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { makeJournal } from "./journal.js"

const runId = RunId.make("journal-terminal-publication")
const target = FixtureTarget.make("journal-terminal-publication")
const setup = Effect.gen(function* () {
  const storage = yield* JournalStore
  yield* storage.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }))
  const fixture = completedRunFinalityFixture({ runId, target })
  yield* storage.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
  yield* storage.append(runId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
  const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
  if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
  return { fixture, initial, storage }
})
const lostAcknowledgement = new JournalStorageUnavailable({
  detail: "terminal write acknowledgement lost",
  operation: "JournalStore.terminateRun"
})

it.effect("keeps an append outside the terminal commit and publication critical section", () =>
  Effect.gen(function* () {
    const { fixture, initial, storage } = yield* setup
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const appendAttempted = yield* Deferred.make<void>()
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const journal = yield* makeJournal(
      runId,
      target,
      initial,
      {
        ...storage,
        append: (...args) =>
          Ref.update(chronology, (events) => [...events, "append-storage"]).pipe(
            Effect.andThen(storage.append(...args))
          ),
        terminateRun: (...args) =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(storage.terminateRun(...args)),
            Effect.tap(() => Ref.update(chronology, (events) => [...events, "terminal-commit"]))
          )
      },
      () => Ref.update(chronology, (events) => [...events, "terminal-publication"])
    )
    const terminating = yield* journal.terminate("Completed", fixture.evidence).pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const appending = yield* Deferred.succeed(appendAttempted, undefined).pipe(
      Effect.andThen(journal.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)),
      Effect.result,
      Effect.forkChild
    )
    yield* Deferred.await(appendAttempted)
    expect(yield* Ref.get(chronology)).toEqual([])
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(terminating)
    yield* Fiber.join(appending)
    expect(yield* Ref.get(chronology)).toEqual(["terminal-commit", "terminal-publication", "append-storage"])
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("publishes acknowledged termination through the same accepted Journal without a storage reread", () =>
  Effect.gen(function* () {
    const { fixture, initial, storage } = yield* setup
    const publications = yield* Ref.make<ReadonlyArray<JournalPosition>>([])
    const journal = yield* makeJournal(
      runId,
      target,
      initial,
      { ...storage, read: () => Effect.die("normal terminal publication must not replay storage") },
      (record) => Ref.update(publications, (positions) => [...positions, record.position])
    )
    const predecessor = yield* journal.readAccepted(runId)
    let materializations = 0
    const stop = observeJournalRecordSequenceOperations((event) => {
      if (event._tag === "HistoricalMaterialization") materializations += 1
    })
    try {
      const record = yield* journal.terminate("Completed", fixture.evidence)
      expect(record.event._tag).toBe("WorkflowRunTerminated")
      expect((yield* journal.state.get).position).toBe(record.position)
      expect((yield* journal.readAccepted(runId)).lastPosition).toBe(record.position)
      expect(predecessor.lastPosition).toBe(initial.prefix.lastPosition)
      expect(yield* Ref.get(publications)).toEqual([record.position])
      expect(materializations).toBe(0)
    } finally {
      stop()
    }
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("reconciles one committed terminal write after lost acknowledgement and publishes it exactly once", () =>
  Effect.gen(function* () {
    const { fixture, initial, storage } = yield* setup
    const reads = yield* Ref.make(0)
    const writes = yield* Ref.make(0)
    const publications = yield* Ref.make(0)
    const journal = yield* makeJournal(
      runId,
      target,
      initial,
      {
        ...storage,
        read: (requested) => Ref.update(reads, (count) => count + 1).pipe(Effect.andThen(storage.read(requested))),
        terminateRun: (...args) =>
          Ref.update(writes, (count) => count + 1).pipe(
            Effect.andThen(storage.terminateRun(...args)),
            Effect.andThen(Effect.fail(lostAcknowledgement))
          )
      },
      () => Ref.update(publications, (count) => count + 1)
    )
    const terminal = yield* journal.terminate("Completed", fixture.evidence)
    expect(terminal.event._tag).toBe("WorkflowRunTerminated")
    expect((yield* journal.state.get).position).toBe(terminal.position)
    expect(yield* Ref.get(reads)).toBe(1)
    expect(yield* Ref.get(writes)).toBe(1)
    expect(yield* Ref.get(publications)).toBe(1)
    expect(yield* journal.terminate("Completed", fixture.evidence)).toEqual(terminal)
    expect(yield* Ref.get(publications)).toBe(1)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("refuses a malformed persisted history during terminal reconciliation without changing the predecessor", () =>
  Effect.gen(function* () {
    const { fixture, initial, storage } = yield* setup
    const journal = yield* makeJournal(runId, target, initial, {
      ...storage,
      terminateRun: (...args) => storage.terminateRun(...args).pipe(Effect.andThen(Effect.fail(lostAcknowledgement))),
      read: (requested) =>
        storage
          .read(requested)
          .pipe(
            Effect.map((records) =>
              records.map((record, index) =>
                index === 0 ? { ...record, runId: RunId.make("foreign-terminal-history") } : record
              )
            )
          )
    })
    expect(yield* journal.terminate("Completed", fixture.evidence).pipe(Effect.flip)).toMatchObject({
      _tag: "JournalHistoryInvalid"
    })
    expect(yield* journal.readAccepted(runId).pipe(Effect.flip)).toMatchObject({ _tag: "JournalHistoryInvalid" })
    expect(initial.prefix.lastPosition).toBe(JournalPosition.make(3))
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("preserves the original termination failure when reconciliation proves no terminal record", () =>
  Effect.gen(function* () {
    const { fixture, initial, storage } = yield* setup
    const journal = yield* makeJournal(runId, target, initial, {
      ...storage,
      terminateRun: () => Effect.fail(lostAcknowledgement)
    })
    expect(yield* journal.terminate("Completed", fixture.evidence).pipe(Effect.flip)).toBe(lostAcknowledgement)
    expect(yield* journal.readAccepted(runId)).toBe(initial.prefix)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect(
  "fails closed without publication when a terminal acknowledgement names a different requested disposition",
  () =>
    Effect.gen(function* () {
      const { fixture, initial, storage } = yield* setup
      const publications = yield* Ref.make(0)
      const journal = yield* makeJournal(
        runId,
        target,
        initial,
        {
          ...storage,
          terminateRun: (...args) =>
            storage
              .terminateRun(...args)
              .pipe(
                Effect.map((record) => ({
                  ...record,
                  event:
                    record.event._tag === "WorkflowRunTerminated"
                      ? { ...record.event, disposition: "Blocked" as const }
                      : record.event
                }))
              )
        },
        () => Ref.update(publications, (count) => count + 1)
      )
      expect(yield* journal.terminate("Completed", fixture.evidence).pipe(Effect.flip)).toMatchObject({
        _tag: "JournalRecordMismatch"
      })
      expect(yield* journal.state.get.pipe(Effect.flip)).toMatchObject({ _tag: "JournalRecordMismatch" })
      expect(yield* Ref.get(publications)).toBe(0)
      expect(initial.prefix.lastPosition).toBe(JournalPosition.make(3))
    }).pipe(Effect.provide(memoryJournalStoreLayer))
)
