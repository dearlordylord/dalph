import { it } from "@effect/vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Ref, Stream } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import { makeTaskWorkSpecification } from "../../authorities/task-tracker/task-work-specification.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { OperationId } from "../../workflow/identity.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import {
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import { makeTaskTrackerFactsObservedFromRead } from "../../workflow/protocols/task-tracker-read/protocol.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import {
  JournalHistoryInvalid,
  JournalPositionGap,
  JournalRecordMismatch,
  InRunJournalRunMismatch,
  JournalStore
} from "../../workflow-journal/store.js"
import { JournalInitialHistoryInvalid, makeJournal } from "./journal.js"
import type { JournalState } from "./journal.js"

const runId = RunId.make("journal")
const target = FixtureTarget.make("journal-target")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })

const graph = (revision: string, taskIds: ReadonlyArray<string>) => {
  const projected = projectTrackerSnapshot({
    revision,
    tasks: taskIds.map((id) => ({
      id: TaskId.make(id),
      lifecycle: { _tag: "Open" as const },
      parentTaskId: null,
      prerequisiteIds: []
    }))
  })
  return Option.getOrThrow(Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined))
}

type JournalInstance = Effect.Success<ReturnType<typeof makeJournal>>

/** Test-only projection of journal.state to graph values recorded at this position. */
const journaledGraphChanges = (journal: JournalInstance) =>
  journal.state.changes.pipe(
    Stream.filter(
      ({ graph, position }: JournalState) =>
        graph._tag === "GraphNotEstablished" || graph.observation.recordedAt === position
    ),
    Stream.map(({ graph }) => graph)
  )

it.effect("state.get equals the current-first state.changes value", () =>
  Effect.gen(function* () {
    const storage = yield* JournalStore
    yield* storage.beginRun(runId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const journal = yield* makeJournal(runId, target, initial, storage)

    const observed = Option.getOrThrow(yield* journal.state.changes.pipe(Stream.runHead))
    expect(yield* journal.state.get).toEqual(observed)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("state.get equals the latest publication observed after an accepted append", () =>
  Effect.gen(function* () {
    const storage = yield* JournalStore
    yield* storage.beginRun(runId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const journal = yield* makeJournal(runId, target, initial, storage)
    const operation = makeTrackerGraphObservationOperation(OperationId.make("current-value-law"), target)
    const attached = yield* Deferred.make<void>()
    const observed = yield* journal.state.changes.pipe(
      Stream.tap(() => Deferred.succeed(attached, undefined)),
      Stream.take(3),
      Stream.runCollect,
      Effect.forkChild
    )

    yield* Deferred.await(attached)
    yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
    yield* journal.append(
      runId,
      outcomeRecordKey(operation.operationId),
      taskTrackerFactsObservedEvent(
        operation.operationId,
        makeCompleteTaskTrackerFactsObserved(operation, graph("current-value-law", ["A"]))
      )
    )

    const values = Array.from(yield* Fiber.join(observed))
    expect(yield* journal.state.get).toEqual(values.at(-1))
    expect(values.at(-1)?.position).toBe(JournalPosition.make(3))
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("publishes GraphNotEstablished first and an accepted complete graph at its journal position", () =>
  Effect.gen(function* () {
    const storage = yield* JournalStore
    yield* storage.beginRun(runId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const journal = yield* makeJournal(runId, target, initial, storage)
    const operation = makeTrackerGraphObservationOperation(OperationId.make("journal-read"), target)
    const subscriberAttached = yield* Deferred.make<void>()
    const observed = yield* journaledGraphChanges(journal).pipe(
      Stream.tap(() => Deferred.succeed(subscriberAttached, undefined)),
      Stream.take(3),
      Stream.runCollect,
      Effect.forkChild
    )

    yield* Deferred.await(subscriberAttached)
    yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
    yield* journal.append(
      runId,
      outcomeRecordKey(operation.operationId),
      taskTrackerFactsObservedEvent(
        operation.operationId,
        makeCompleteTaskTrackerFactsObserved(operation, graph("g1", ["A"]))
      )
    )

    const values = Array.from(yield* Fiber.join(observed))
    expect(values.map(({ _tag }) => _tag)).toEqual(["GraphNotEstablished", "GraphNotEstablished", "GraphEstablished"])
    const currentGraph = (yield* journal.state.get).graph
    expect(currentGraph._tag).toBe("GraphEstablished")
    if (currentGraph._tag === "GraphEstablished") {
      expect(currentGraph.observation.snapshot.toWire()).toMatchObject({ revision: "g1", tasks: [{ id: "A" }] })
      expect(currentGraph.observation.operationId).toBe(operation.operationId)
      expect(currentGraph.observation.recordedAt).toBe(JournalPosition.make(3))
      expect(currentGraph.observation.contentIdentity).toBe(currentGraph.observation.snapshot.revision)
    }
    expect((yield* journal.state.get).position).toBe(3)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("does not publish complete graph facts for another tracker target", () =>
  Effect.gen(function* () {
    const foreignRunId = RunId.make("journal-foreign-target")
    const storage = yield* JournalStore
    yield* storage.beginRun(foreignRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(foreignRunId, yield* storage.read(foreignRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const journal = yield* makeJournal(foreignRunId, target, initial, storage)

    const localOperation = makeTrackerGraphObservationOperation(OperationId.make("foreign-target-local-read"), target)
    yield* journal.append(
      foreignRunId,
      intentRecordKey(localOperation.operationId),
      taskTrackerReadIntent(localOperation)
    )
    yield* journal.append(
      foreignRunId,
      outcomeRecordKey(localOperation.operationId),
      taskTrackerFactsObservedEvent(
        localOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(localOperation, graph("local-target", ["A"]))
      )
    )
    const beforeForeign = yield* journal.state.get

    const foreignTarget = FixtureTarget.make("journal-foreign-target-source")
    const foreignOperation = makeTrackerGraphObservationOperation(
      OperationId.make("foreign-target-read"),
      foreignTarget
    )
    yield* journal.append(
      foreignRunId,
      intentRecordKey(foreignOperation.operationId),
      taskTrackerReadIntent(foreignOperation)
    )
    yield* journal.append(
      foreignRunId,
      outcomeRecordKey(foreignOperation.operationId),
      taskTrackerFactsObservedEvent(
        foreignOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(foreignOperation, graph("foreign-target", ["B"]))
      )
    )

    const afterForeign = yield* journal.state.get
    expect(afterForeign.position).toBe(JournalPosition.make(5))
    expect(afterForeign.graph).toEqual(beforeForeign.graph)
    expect(afterForeign.graph._tag).toBe("GraphEstablished")
    if (afterForeign.graph._tag === "GraphEstablished") {
      expect(afterForeign.graph.observation.snapshot.revision).toBe(TrackerRevision.make("local-target"))
      expect(afterForeign.graph.observation.operationId).toBe(localOperation.operationId)
      expect(afterForeign.graph.observation.recordedAt).toBe(JournalPosition.make(3))
    }
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("publishes an equal-content reconfirmation as a later journaled graph observation", () =>
  Effect.gen(function* () {
    const fixedRunId = RunId.make("journal-equal-reconfirmation")
    const storage = yield* JournalStore
    yield* storage.beginRun(fixedRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(fixedRunId, yield* storage.read(fixedRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const journal = yield* makeJournal(fixedRunId, target, initial, storage)
    const firstOperation = makeTrackerGraphObservationOperation(OperationId.make("equal-content-G1"), target)
    const secondOperation = makeTrackerGraphObservationOperation(OperationId.make("equal-content-G2"), target)
    const snapshot = graph("equal-content", ["A"])
    const attached = yield* Deferred.make<void>()
    const firstSeen = yield* Deferred.make<void>()
    const observed = yield* journaledGraphChanges(journal).pipe(
      Stream.tap(() => Deferred.succeed(attached, undefined)),
      Stream.tap((state) =>
        state._tag === "GraphEstablished" && state.observation.operationId === firstOperation.operationId
          ? Deferred.succeed(firstSeen, undefined)
          : Effect.void
      ),
      Stream.filter((state) => state._tag === "GraphEstablished"),
      Stream.take(2),
      Stream.runCollect,
      Effect.forkChild
    )
    yield* Deferred.await(attached)
    yield* journal.append(
      fixedRunId,
      intentRecordKey(firstOperation.operationId),
      taskTrackerReadIntent(firstOperation)
    )
    yield* journal.append(
      fixedRunId,
      outcomeRecordKey(firstOperation.operationId),
      taskTrackerFactsObservedEvent(
        firstOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(firstOperation, snapshot)
      )
    )
    yield* Deferred.await(firstSeen)

    yield* journal.append(
      fixedRunId,
      intentRecordKey(secondOperation.operationId),
      taskTrackerReadIntent(secondOperation)
    )
    const records = yield* journal.read(fixedRunId)
    yield* journal.append(
      fixedRunId,
      outcomeRecordKey(secondOperation.operationId),
      makeTaskTrackerFactsObservedFromRead(
        records.map(({ event }) => ({ event })),
        secondOperation,
        snapshot
      )
    )
    const values = Array.from(yield* Fiber.join(observed))
    const first = values[0]
    const second = values[values.length - 1]
    if (first?._tag !== "GraphEstablished" || second?._tag !== "GraphEstablished") {
      return yield* Effect.die("expected G1 and G2 graph observations")
    }

    expect(first.observation.operationId).toBe(firstOperation.operationId)
    expect(second.observation.operationId).toBe(secondOperation.operationId)
    expect(first.observation.contentIdentity).toBe(second.observation.contentIdentity)
    expect(first.observation.recordedAt).toBe(JournalPosition.make(3))
    expect(second.observation.recordedAt).toBe(JournalPosition.make(5))
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("skips accepted focused facts while retaining the latest graph observation metadata", () =>
  Effect.gen(function* () {
    const focusedRunId = RunId.make("journal-focused-before-graph")
    const storage = yield* JournalStore
    yield* storage.beginRun(focusedRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(focusedRunId, yield* storage.read(focusedRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const journal = yield* makeJournal(focusedRunId, target, initial, storage)
    const focused = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("focused-before-graph"),
      target,
      TaskId.make("A")
    )
    yield* journal.append(focusedRunId, intentRecordKey(focused.operationId), taskTrackerReadIntent(focused))
    yield* journal.append(
      focusedRunId,
      outcomeRecordKey(focused.operationId),
      taskTrackerFactsObservedEvent(
        focused.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(
          focused,
          makeTaskWorkSpecification({ body: "focused body", taskId: TaskId.make("A"), title: "Focused task" })
        )
      )
    )
    const graphOperation = makeTrackerGraphObservationOperation(OperationId.make("graph-after-focused"), target)
    yield* journal.append(
      focusedRunId,
      intentRecordKey(graphOperation.operationId),
      taskTrackerReadIntent(graphOperation)
    )
    yield* journal.append(
      focusedRunId,
      outcomeRecordKey(graphOperation.operationId),
      taskTrackerFactsObservedEvent(
        graphOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(graphOperation, graph("focused-then-graph", ["A"]))
      )
    )

    const current = yield* journal.state.get
    expect(current.graph._tag).toBe("GraphEstablished")
    expect(current.graph._tag === "GraphEstablished" ? current.graph.observation.operationId : undefined).toBe(
      graphOperation.operationId
    )
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("rejects an empty, unbegun, or different-Run initial history at the journal seam", () =>
  Effect.gen(function* () {
    const storage = yield* JournalStore
    const empty = reduceWorkflowJournalHistory(runId, [])
    if (empty._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(empty)
    const emptyFailure = yield* makeJournal(runId, target, empty, storage).pipe(Effect.flip)
    expect(emptyFailure).toMatchObject({ _tag: "JournalInitialHistoryInvalid", reason: "EmptyHistory" })

    yield* storage.beginRun(runId, target, initialPolicy)
    const begun = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
    if (begun._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(begun)
    const [runBeginning] = begun.records
    if (runBeginning === undefined) return yield* Effect.die("begun history must contain its run beginning")
    const unbegunFailure = yield* makeJournal(
      runId,
      target,
      {
        ...begun,
        records: [
          {
            ...runBeginning,
            event: taskTrackerReadIntent(
              makeTrackerGraphObservationOperation(OperationId.make("not-a-beginning"), target)
            )
          }
        ]
      },
      storage
    ).pipe(Effect.flip)
    expect(unbegunFailure).toMatchObject({ _tag: "JournalInitialHistoryInvalid", reason: "MissingRunBeginning" })

    const otherRunId = RunId.make("journal-other-initial-run")
    const identityFailure = yield* makeJournal(otherRunId, target, begun, storage).pipe(Effect.flip)
    expect(identityFailure).toEqual(
      new JournalInitialHistoryInvalid({
        historyRunId: runId,
        reason: "RunIdentityMismatch",
        requestedRunId: otherRunId
      })
    )

    const began = Option.getOrThrow(Option.fromUndefinedOr(begun.records[0]))
    const invalidFailure = yield* makeJournal(
      runId,
      target,
      { ...begun, records: [...begun.records, { ...began, position: JournalPosition.make(2), runId: otherRunId }] },
      storage
    ).pipe(Effect.flip)
    expect(invalidFailure).toMatchObject({ _tag: "JournalInitialHistoryInvalid", reason: "InvalidHistory" })
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("serializes concurrent accepted appends and publishes every position in order", () =>
  Effect.gen(function* () {
    const concurrentRunId = RunId.make("journal-concurrent")
    const storage = yield* JournalStore
    yield* storage.beginRun(concurrentRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(concurrentRunId, yield* storage.read(concurrentRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const journal = yield* makeJournal(concurrentRunId, target, initial, storage)
    const attached = yield* Deferred.make<void>()
    const positions = yield* journal.state.changes.pipe(
      Stream.tap(() => Deferred.succeed(attached, undefined)),
      Stream.map(({ position }) => position),
      Stream.take(3),
      Stream.runCollect,
      Effect.forkChild
    )
    yield* Deferred.await(attached)
    const first = makeTrackerGraphObservationOperation(OperationId.make("concurrent-one"), target)
    const second = makeTrackerGraphObservationOperation(OperationId.make("concurrent-two"), target)

    yield* Effect.all([
      journal.append(concurrentRunId, intentRecordKey(first.operationId), taskTrackerReadIntent(first)),
      journal.append(concurrentRunId, intentRecordKey(second.operationId), taskTrackerReadIntent(second))
    ])

    expect(Array.from(yield* Fiber.join(positions))).toEqual([1, 2, 3])
    expect((yield* journal.read(concurrentRunId)).map(({ position }) => position)).toEqual([1, 2, 3])
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("accepts concurrently completed tracker outcomes in the order they reach the journal", () =>
  Effect.gen(function* () {
    const outcomeRunId = RunId.make("journal-outcome-order")
    const storage = yield* JournalStore
    yield* storage.beginRun(outcomeRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(outcomeRunId, yield* storage.read(outcomeRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const journal = yield* makeJournal(outcomeRunId, target, initial, storage)
    const first = makeTrackerGraphObservationOperation(OperationId.make("outcome-started-first"), target)
    const second = makeTrackerGraphObservationOperation(OperationId.make("outcome-finished-first"), target)
    yield* journal.append(outcomeRunId, intentRecordKey(first.operationId), taskTrackerReadIntent(first))
    yield* journal.append(outcomeRunId, intentRecordKey(second.operationId), taskTrackerReadIntent(second))
    const firstStarted = yield* Deferred.make<void>()
    const releaseFirst = yield* Deferred.make<void>()
    const firstOutcome = yield* Deferred.succeed(firstStarted, undefined).pipe(
      Effect.andThen(Deferred.await(releaseFirst)),
      Effect.andThen(
        journal.append(
          outcomeRunId,
          outcomeRecordKey(first.operationId),
          taskTrackerFactsObservedEvent(
            first.operationId,
            makeCompleteTaskTrackerFactsObserved(first, graph("first-completed-later", ["A"]))
          )
        )
      ),
      Effect.forkChild
    )
    yield* Deferred.await(firstStarted)
    const secondRecord = yield* journal.append(
      outcomeRunId,
      outcomeRecordKey(second.operationId),
      taskTrackerFactsObservedEvent(
        second.operationId,
        makeCompleteTaskTrackerFactsObserved(second, graph("second-completed-first", ["B"]))
      )
    )
    yield* Deferred.succeed(releaseFirst, undefined)
    const firstRecord = yield* Fiber.join(firstOutcome)

    expect([secondRecord.position, firstRecord.position]).toEqual([4, 5])
    expect(
      (yield* journal.state.get).reconstructed.graphKnowledge.taskTrackerFacts.map(({ operationId }) => operationId)
    ).toEqual(["outcome-finished-first", "outcome-started-first"])
    const currentGraph = (yield* journal.state.get).graph
    expect(currentGraph._tag).toBe("GraphEstablished")
    if (currentGraph._tag === "GraphEstablished") {
      expect(currentGraph.observation.snapshot.toWire()).toMatchObject({
        revision: "first-completed-later",
        tasks: [{ id: "A" }]
      })
    }
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("never loses the latest journaled graph when subscription and publication begin together", () =>
  Effect.gen(function* () {
    const raceRunId = RunId.make("journal-attachment-race")
    const storage = yield* JournalStore
    yield* storage.beginRun(raceRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(raceRunId, yield* storage.read(raceRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const journal = yield* makeJournal(raceRunId, target, initial, storage)

    for (let index = 0; index < 12; index += 1) {
      const start = yield* Deferred.make<void>()
      const revision = `attachment-race-${index}`
      const operation = makeTrackerGraphObservationOperation(OperationId.make(revision), target)
      const observed = Deferred.await(start).pipe(
        Effect.andThen(
          journaledGraphChanges(journal).pipe(
            Stream.filter(
              (state) => state._tag === "GraphEstablished" && state.observation.snapshot.revision === revision
            ),
            Stream.runHead
          )
        )
      )
      const accepted = Deferred.await(start).pipe(
        Effect.andThen(
          journal.append(raceRunId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
        ),
        Effect.andThen(
          journal.append(
            raceRunId,
            outcomeRecordKey(operation.operationId),
            taskTrackerFactsObservedEvent(
              operation.operationId,
              makeCompleteTaskTrackerFactsObserved(operation, graph(revision, [`T-${index}`]))
            )
          )
        )
      )
      const raced = yield* Effect.all([observed, accepted], { concurrency: "unbounded" }).pipe(Effect.forkChild)
      yield* Deferred.succeed(start, undefined)
      const [current] = yield* Fiber.join(raced)
      expect(Option.getOrThrow(current)).toMatchObject({
        _tag: "GraphEstablished",
        observation: { snapshot: { revision } }
      })
    }
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("reconstructs an append accepted before the process could publish it", () =>
  Effect.gen(function* () {
    const crashRunId = RunId.make("journal-crash-after-append")
    const storage = yield* JournalStore
    yield* storage.beginRun(crashRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(crashRunId, yield* storage.read(crashRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const operation = makeTrackerGraphObservationOperation(OperationId.make("accepted-before-publication"), target)
    const stoppedProcess = yield* Effect.scoped(
      Effect.gen(function* () {
        const failAfterDurableAppend = yield* Ref.make(false)
        const crashingJournal = yield* makeJournal(crashRunId, target, initial, {
          append: (...args) =>
            storage
              .append(...args)
              .pipe(
                Effect.flatMap((record) =>
                  Ref.get(failAfterDurableAppend).pipe(
                    Effect.flatMap((fail) =>
                      fail ? Effect.die("process stopped after durable append") : Effect.succeed(record)
                    )
                  )
                )
              )
        })
        const subscriberAttached = yield* Deferred.make<void>()
        const discardedSubscriber = yield* crashingJournal.state.changes.pipe(
          Stream.tap(() => Deferred.succeed(subscriberAttached, undefined)),
          Stream.runDrain,
          Effect.forkScoped
        )
        yield* Deferred.await(subscriberAttached)
        yield* crashingJournal.append(
          crashRunId,
          intentRecordKey(operation.operationId),
          taskTrackerReadIntent(operation)
        )
        yield* Ref.set(failAfterDurableAppend, true)
        const interruptedPublication = yield* crashingJournal
          .append(
            crashRunId,
            outcomeRecordKey(operation.operationId),
            taskTrackerFactsObservedEvent(
              operation.operationId,
              makeCompleteTaskTrackerFactsObserved(operation, graph("accepted-before-publication", ["A"]))
            )
          )
          .pipe(Effect.exit)
        const position = (yield* crashingJournal.state.get).position
        return { position, discardedSubscriber, interruptedPublication }
      })
    )
    expect(Exit.isFailure(stoppedProcess.interruptedPublication)).toBe(true)
    expect(stoppedProcess.position).toBe(2)
    const discardedSubscriberExit = yield* Fiber.await(stoppedProcess.discardedSubscriber)
    expect(Exit.isFailure(discardedSubscriberExit) && Cause.hasInterruptsOnly(discardedSubscriberExit.cause)).toBe(true)

    const recoveredHistory = reduceWorkflowJournalHistory(crashRunId, yield* storage.read(crashRunId))
    if (recoveredHistory._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(recoveredHistory)
    const restarted = yield* makeJournal(crashRunId, target, recoveredHistory, storage)
    expect((yield* restarted.state.get).records).toHaveLength(3)
    expect((yield* restarted.state.get).reconstructed.graphKnowledge.taskTrackerFacts).toHaveLength(1)
    expect((yield* restarted.state.get).graph._tag).toBe("GraphNotEstablished")
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("lets multiple graph subscribers observe one accepted read without performing another boundary action", () =>
  Effect.gen(function* () {
    const subscriberRunId = RunId.make("journal-multiple-subscribers")
    const storage = yield* JournalStore
    yield* storage.beginRun(subscriberRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(subscriberRunId, yield* storage.read(subscriberRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const appendCalls = yield* Ref.make(0)
    const journal = yield* makeJournal(subscriberRunId, target, initial, {
      append: (...args) => Ref.update(appendCalls, (count) => count + 1).pipe(Effect.andThen(storage.append(...args)))
    })
    const firstAttached = yield* Deferred.make<void>()
    const secondAttached = yield* Deferred.make<void>()
    const observe = (attached: Deferred.Deferred<void>) =>
      journaledGraphChanges(journal).pipe(
        Stream.tap(() => Deferred.succeed(attached, undefined)),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild
      )
    const firstSubscriber = yield* observe(firstAttached)
    const secondSubscriber = yield* observe(secondAttached)
    yield* Deferred.await(firstAttached)
    yield* Deferred.await(secondAttached)

    const operation = makeTrackerGraphObservationOperation(OperationId.make("one-read-two-subscribers"), target)
    yield* journal.append(subscriberRunId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
    yield* journal.append(
      subscriberRunId,
      outcomeRecordKey(operation.operationId),
      taskTrackerFactsObservedEvent(
        operation.operationId,
        makeCompleteTaskTrackerFactsObserved(operation, graph("shared", ["A"]))
      )
    )

    expect(Array.from(yield* Fiber.join(firstSubscriber)).map(({ _tag }) => _tag)).toEqual([
      "GraphNotEstablished",
      "GraphNotEstablished",
      "GraphEstablished"
    ])
    expect(Array.from(yield* Fiber.join(secondSubscriber)).map(({ _tag }) => _tag)).toEqual([
      "GraphNotEstablished",
      "GraphNotEstablished",
      "GraphEstablished"
    ])
    expect(yield* Ref.get(appendCalls)).toBe(2)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("does not republish an idempotent append and rejects a different Run", () =>
  Effect.gen(function* () {
    const fixedRunId = RunId.make("journal-fixed-run")
    const storage = yield* JournalStore
    yield* storage.beginRun(fixedRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(fixedRunId, yield* storage.read(fixedRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const journal = yield* makeJournal(fixedRunId, target, initial, storage)
    const publications = yield* Ref.make(0)
    const subscriber = yield* journal.state.changes.pipe(
      Stream.runForEach(() => Ref.update(publications, (count) => count + 1)),
      Effect.forkChild
    )
    yield* Effect.yieldNow
    const operation = makeTrackerGraphObservationOperation(OperationId.make("idempotent-intent"), target)
    const append = journal.append(fixedRunId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
    yield* append
    yield* append
    yield* Effect.yieldNow
    expect(yield* Ref.get(publications)).toBe(2)

    const mismatch = yield* Effect.flip(journal.read(RunId.make("another-run")))
    expect(mismatch).toBeInstanceOf(InRunJournalRunMismatch)
    expect(
      yield* journal
        .append(RunId.make("another-run"), intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
        .pipe(Effect.flip)
    ).toBeInstanceOf(InRunJournalRunMismatch)
    yield* Fiber.interrupt(subscriber)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("does not replay queued open values to a subscriber after publication fails", () =>
  Effect.gen(function* () {
    const slowRunId = RunId.make("journal-slow-subscriber")
    const storage = yield* JournalStore
    yield* storage.beginRun(slowRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(slowRunId, yield* storage.read(slowRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const journal = yield* makeJournal(slowRunId, target, initial, storage)
    const firstConsumed = yield* Deferred.make<void>()
    const releaseSlowConsumer = yield* Deferred.make<void>()
    const consumed = yield* Ref.make<ReadonlyArray<string>>([])
    const subscriber = yield* journal.state.changes.pipe(
      Stream.tap((value) =>
        Ref.modify(consumed, (values) => {
          const next = [...values, value.graph._tag]
          return [values.length === 0, next] as const
        }).pipe(
          Effect.flatMap((first) =>
            first
              ? Deferred.succeed(firstConsumed, undefined).pipe(Effect.andThen(Deferred.await(releaseSlowConsumer)))
              : Effect.void
          )
        )
      ),
      Stream.runDrain,
      Effect.forkChild
    )
    yield* Deferred.await(firstConsumed)

    const accepted = makeTrackerGraphObservationOperation(OperationId.make("queued-open"), target)
    yield* journal.append(slowRunId, intentRecordKey(accepted.operationId), taskTrackerReadIntent(accepted))
    yield* journal.append(
      slowRunId,
      outcomeRecordKey(accepted.operationId),
      taskTrackerFactsObservedEvent(
        accepted.operationId,
        makeCompleteTaskTrackerFactsObserved(accepted, graph("queued-open", ["A"]))
      )
    )
    const missingIntent = makeTrackerGraphObservationOperation(OperationId.make("queued-failure"), target)
    const failure = yield* journal
      .append(
        slowRunId,
        outcomeRecordKey(missingIntent.operationId),
        taskTrackerFactsObservedEvent(
          missingIntent.operationId,
          makeCompleteTaskTrackerFactsObserved(missingIntent, graph("queued-failure", []))
        )
      )
      .pipe(Effect.flip)

    yield* Deferred.succeed(releaseSlowConsumer, undefined)
    expect(yield* Fiber.join(subscriber).pipe(Effect.flip)).toEqual(failure)
    expect(yield* Ref.get(consumed)).toEqual(["GraphNotEstablished"])
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("fails closed when storage returns different content for an already published position", () =>
  Effect.gen(function* () {
    const mismatchRunId = RunId.make("journal-record-mismatch")
    const storage = yield* JournalStore
    yield* storage.beginRun(mismatchRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(mismatchRunId, yield* storage.read(mismatchRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const appendCalls = yield* Ref.make(0)
    const replacement = makeTrackerGraphObservationOperation(OperationId.make("replacement-content"), target)
    const journal = yield* makeJournal(mismatchRunId, target, initial, {
      append: (...args) =>
        Ref.getAndUpdate(appendCalls, (count) => count + 1).pipe(
          Effect.flatMap((call) => storage.append(...args).pipe(Effect.map((record) => ({ call, record })))),
          Effect.map(({ call, record }) =>
            call === 0 ? record : { ...record, event: taskTrackerReadIntent(replacement) }
          )
        )
    })
    const operation = makeTrackerGraphObservationOperation(OperationId.make("published-content"), target)
    const append = journal.append(
      mismatchRunId,
      intentRecordKey(operation.operationId),
      taskTrackerReadIntent(operation)
    )
    yield* append
    const failure = yield* append.pipe(Effect.flip)
    expect(failure).toBeInstanceOf(JournalRecordMismatch)

    const later = makeTrackerGraphObservationOperation(OperationId.make("after-record-mismatch"), target)
    expect(
      yield* journal
        .append(mismatchRunId, intentRecordKey(later.operationId), taskTrackerReadIntent(later))
        .pipe(Effect.flip)
    ).toEqual(failure)
    expect(yield* Ref.get(appendCalls)).toBe(2)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("state.get and changes fail with the same typed error after the prefix becomes invalid", () =>
  Effect.gen(function* () {
    const invalidRunId = RunId.make("journal-invalid-prefix")
    const storage = yield* JournalStore
    yield* storage.beginRun(invalidRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(invalidRunId, yield* storage.read(invalidRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const journal = yield* makeJournal(invalidRunId, target, initial, storage)
    const subscriberAttached = yield* Deferred.make<void>()
    const existingSubscriber = yield* journal.state.changes.pipe(
      Stream.tap(() => Deferred.succeed(subscriberAttached, undefined)),
      Stream.runDrain,
      Effect.forkChild
    )
    yield* Deferred.await(subscriberAttached)
    const missingIntent = makeTrackerGraphObservationOperation(OperationId.make("missing-intent"), target)
    const failure = yield* journal
      .append(
        invalidRunId,
        outcomeRecordKey(missingIntent.operationId),
        taskTrackerFactsObservedEvent(
          missingIntent.operationId,
          makeCompleteTaskTrackerFactsObserved(missingIntent, graph("invalid", []))
        )
      )
      .pipe(Effect.flip)
    expect(failure).toBeInstanceOf(JournalHistoryInvalid)
    expect(yield* Fiber.join(existingSubscriber).pipe(Effect.flip)).toEqual(failure)
    expect(yield* journal.state.get.pipe(Effect.flip)).toEqual(failure)
    expect(yield* Effect.flip(journal.read(invalidRunId))).toEqual(failure)
    const later = makeTrackerGraphObservationOperation(OperationId.make("after-invalid"), target)
    const repeated = yield* journal
      .append(invalidRunId, intentRecordKey(later.operationId), taskTrackerReadIntent(later))
      .pipe(Effect.flip)
    expect(repeated).toEqual(failure)
    expect(yield* storage.read(invalidRunId)).toHaveLength(2)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("attempts no later storage append after an accepted position contradicts the published prefix", () =>
  Effect.gen(function* () {
    const gapRunId = RunId.make("journal-position-gap")
    const storage = yield* JournalStore
    yield* storage.beginRun(gapRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(gapRunId, yield* storage.read(gapRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const appendCalls = yield* Ref.make(0)
    const journal = yield* makeJournal(gapRunId, target, initial, {
      append: (...args) =>
        Ref.update(appendCalls, (count) => count + 1).pipe(
          Effect.andThen(storage.append(...args)),
          Effect.map((record) => ({ ...record, position: JournalPosition.make(record.position + 1) }))
        )
    })
    const first = makeTrackerGraphObservationOperation(OperationId.make("gap-first"), target)
    const failure = yield* journal
      .append(gapRunId, intentRecordKey(first.operationId), taskTrackerReadIntent(first))
      .pipe(Effect.flip)
    expect(failure).toBeInstanceOf(JournalPositionGap)

    const later = makeTrackerGraphObservationOperation(OperationId.make("gap-later"), target)
    expect(
      yield* journal
        .append(gapRunId, intentRecordKey(later.operationId), taskTrackerReadIntent(later))
        .pipe(Effect.flip)
    ).toEqual(failure)
    expect(yield* Ref.get(appendCalls)).toBe(1)
    expect(yield* storage.read(gapRunId)).toHaveLength(2)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)
