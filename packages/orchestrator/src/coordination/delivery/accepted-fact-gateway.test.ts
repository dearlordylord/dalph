import { it } from "@effect/vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Ref, Stream } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { OperationId } from "../../workflow/identity.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import {
  AcceptedJournalHistoryInvalid,
  AcceptedJournalPositionGap,
  AcceptedJournalRecordMismatch,
  InRunJournalRunMismatch,
  JournalStore
} from "../../workflow-journal/store.js"
import {
  AcceptedFactGatewayInitialHistoryInvalid,
  makeAcceptedFactPublicationGateway
} from "./accepted-fact-gateway.js"
import { TrackerGraphRelationError } from "./relations.js"

const runId = RunId.make("accepted-fact-gateway")
const target = FixtureTarget.make("accepted-fact-gateway-target")
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

it.effect("publishes GraphNotEstablished first and an accepted complete graph at its journal position", () =>
  Effect.gen(function* () {
    const storage = yield* JournalStore
    yield* storage.beginRun(runId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const gateway = yield* makeAcceptedFactPublicationGateway(runId, target, initial, storage)
    const initialProposal = Option.getOrThrow(yield* gateway.trackerGraph.proposedActions.changes.pipe(Stream.runHead))
    const repeatedSubscription = Option.getOrThrow(
      yield* gateway.trackerGraph.proposedActions.changes.pipe(Stream.runHead)
    )
    expect(repeatedSubscription).toEqual(initialProposal)
    expect(initialProposal).toHaveLength(1)
    expect(initialProposal[0]).toMatchObject({
      actionIdentity: { _tag: "FreshOperationIdRequired" },
      owner: "TrackerGraph",
      route: { _tag: "TrackerGraphReadRoute", purpose: "EstablishCurrentGraph", target }
    })
    const operation = makeTrackerGraphObservationOperation(OperationId.make("gateway-read"), target)
    const subscriberAttached = yield* Deferred.make<void>()
    const observed = yield* gateway.trackerGraph.signal.changes.pipe(
      Stream.tap(() => Deferred.succeed(subscriberAttached, undefined)),
      Stream.take(3),
      Stream.runCollect,
      Effect.forkChild
    )

    yield* Deferred.await(subscriberAttached)
    yield* gateway.journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
    yield* gateway.journal.append(
      runId,
      outcomeRecordKey(operation.operationId),
      taskTrackerFactsObservedEvent(
        operation.operationId,
        makeCompleteTaskTrackerFactsObserved(operation, graph("g1", ["A"]))
      )
    )

    const values = Array.from(yield* Fiber.join(observed))
    expect(values.map(({ _tag }) => _tag)).toEqual(["GraphNotEstablished", "GraphNotEstablished", "GraphEstablished"])
    const currentGraph = (yield* gateway.readCurrent).graph
    expect(currentGraph._tag).toBe("GraphEstablished")
    if (currentGraph._tag === "GraphEstablished") {
      expect(currentGraph.snapshot.toWire()).toMatchObject({ revision: "g1", tasks: [{ id: "A" }] })
    }
    expect((yield* gateway.readCurrent).appliedPosition).toBe(3)
    expect(Option.getOrThrow(yield* gateway.trackerGraph.proposedActions.changes.pipe(Stream.runHead))).toEqual([])
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("rejects an empty, unbegun, or different-Run initial history at the gateway seam", () =>
  Effect.gen(function* () {
    const storage = yield* JournalStore
    const empty = reduceWorkflowJournalHistory(runId, [])
    if (empty._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(empty)
    const emptyFailure = yield* makeAcceptedFactPublicationGateway(runId, target, empty, storage).pipe(Effect.flip)
    expect(emptyFailure).toMatchObject({ _tag: "AcceptedFactGatewayInitialHistoryInvalid", reason: "EmptyHistory" })

    yield* storage.beginRun(runId, target, initialPolicy)
    const begun = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
    if (begun._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(begun)
    const [runBeginning] = begun.records
    if (runBeginning === undefined) return yield* Effect.die("begun history must contain its run beginning")
    const unbegunFailure = yield* makeAcceptedFactPublicationGateway(
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
    expect(unbegunFailure).toMatchObject({
      _tag: "AcceptedFactGatewayInitialHistoryInvalid",
      reason: "MissingRunBeginning"
    })

    const otherRunId = RunId.make("accepted-fact-other-initial-run")
    const identityFailure = yield* makeAcceptedFactPublicationGateway(otherRunId, target, begun, storage).pipe(
      Effect.flip
    )
    expect(identityFailure).toEqual(
      new AcceptedFactGatewayInitialHistoryInvalid({
        historyRunId: runId,
        reason: "RunIdentityMismatch",
        requestedRunId: otherRunId
      })
    )

    const began = Option.getOrThrow(Option.fromUndefinedOr(begun.records[0]))
    const invalidFailure = yield* makeAcceptedFactPublicationGateway(
      runId,
      target,
      { ...begun, records: [...begun.records, { ...began, position: JournalPosition.make(2), runId: otherRunId }] },
      storage
    ).pipe(Effect.flip)
    expect(invalidFailure).toMatchObject({ _tag: "AcceptedFactGatewayInitialHistoryInvalid", reason: "InvalidHistory" })
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("serializes concurrent accepted appends and publishes every position in order", () =>
  Effect.gen(function* () {
    const concurrentRunId = RunId.make("accepted-fact-concurrent")
    const storage = yield* JournalStore
    yield* storage.beginRun(concurrentRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(concurrentRunId, yield* storage.read(concurrentRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const gateway = yield* makeAcceptedFactPublicationGateway(concurrentRunId, target, initial, storage)
    const attached = yield* Deferred.make<void>()
    const positions = yield* gateway.current.changes.pipe(
      Stream.tap(() => Deferred.succeed(attached, undefined)),
      Stream.map(({ appliedPosition }) => appliedPosition),
      Stream.take(3),
      Stream.runCollect,
      Effect.forkChild
    )
    yield* Deferred.await(attached)
    const first = makeTrackerGraphObservationOperation(OperationId.make("concurrent-one"), target)
    const second = makeTrackerGraphObservationOperation(OperationId.make("concurrent-two"), target)

    yield* Effect.all([
      gateway.journal.append(concurrentRunId, intentRecordKey(first.operationId), taskTrackerReadIntent(first)),
      gateway.journal.append(concurrentRunId, intentRecordKey(second.operationId), taskTrackerReadIntent(second))
    ])

    expect(Array.from(yield* Fiber.join(positions))).toEqual([1, 2, 3])
    expect((yield* gateway.journal.read(concurrentRunId)).map(({ position }) => position)).toEqual([1, 2, 3])
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("accepts concurrently completed tracker outcomes in the order they reach the gateway", () =>
  Effect.gen(function* () {
    const outcomeRunId = RunId.make("accepted-fact-outcome-order")
    const storage = yield* JournalStore
    yield* storage.beginRun(outcomeRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(outcomeRunId, yield* storage.read(outcomeRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const gateway = yield* makeAcceptedFactPublicationGateway(outcomeRunId, target, initial, storage)
    const first = makeTrackerGraphObservationOperation(OperationId.make("outcome-started-first"), target)
    const second = makeTrackerGraphObservationOperation(OperationId.make("outcome-finished-first"), target)
    yield* gateway.journal.append(outcomeRunId, intentRecordKey(first.operationId), taskTrackerReadIntent(first))
    yield* gateway.journal.append(outcomeRunId, intentRecordKey(second.operationId), taskTrackerReadIntent(second))
    const firstStarted = yield* Deferred.make<void>()
    const releaseFirst = yield* Deferred.make<void>()
    const firstOutcome = yield* Deferred.succeed(firstStarted, undefined).pipe(
      Effect.andThen(Deferred.await(releaseFirst)),
      Effect.andThen(
        gateway.journal.append(
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
    const secondRecord = yield* gateway.journal.append(
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
      (yield* gateway.readCurrent).reconstructed.graphKnowledge.taskTrackerFacts.map(({ operationId }) => operationId)
    ).toEqual(["outcome-finished-first", "outcome-started-first"])
    const currentGraph = (yield* gateway.readCurrent).graph
    expect(currentGraph._tag).toBe("GraphEstablished")
    if (currentGraph._tag === "GraphEstablished") {
      expect(currentGraph.snapshot.toWire()).toMatchObject({ revision: "first-completed-later", tasks: [{ id: "A" }] })
    }
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("never loses the latest accepted graph when subscription and publication begin together", () =>
  Effect.gen(function* () {
    const raceRunId = RunId.make("accepted-fact-attachment-race")
    const storage = yield* JournalStore
    yield* storage.beginRun(raceRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(raceRunId, yield* storage.read(raceRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const gateway = yield* makeAcceptedFactPublicationGateway(raceRunId, target, initial, storage)

    for (let index = 0; index < 12; index += 1) {
      const start = yield* Deferred.make<void>()
      const revision = `attachment-race-${index}`
      const operation = makeTrackerGraphObservationOperation(OperationId.make(revision), target)
      const observed = Deferred.await(start).pipe(
        Effect.andThen(
          gateway.trackerGraph.signal.changes.pipe(
            Stream.filter((state) => state._tag === "GraphEstablished" && state.snapshot.revision === revision),
            Stream.runHead
          )
        )
      )
      const accepted = Deferred.await(start).pipe(
        Effect.andThen(
          gateway.journal.append(raceRunId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
        ),
        Effect.andThen(
          gateway.journal.append(
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
      expect(Option.getOrThrow(current)).toMatchObject({ _tag: "GraphEstablished", snapshot: { revision } })
    }
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("reconstructs an append accepted before the process could publish it", () =>
  Effect.gen(function* () {
    const crashRunId = RunId.make("accepted-fact-crash-after-append")
    const storage = yield* JournalStore
    yield* storage.beginRun(crashRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(crashRunId, yield* storage.read(crashRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const operation = makeTrackerGraphObservationOperation(OperationId.make("accepted-before-publication"), target)
    const stoppedProcess = yield* Effect.scoped(
      Effect.gen(function* () {
        const failAfterDurableAppend = yield* Ref.make(false)
        const crashingGateway = yield* makeAcceptedFactPublicationGateway(crashRunId, target, initial, {
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
        const discardedSubscriber = yield* crashingGateway.current.changes.pipe(
          Stream.tap(() => Deferred.succeed(subscriberAttached, undefined)),
          Stream.runDrain,
          Effect.forkScoped
        )
        yield* Deferred.await(subscriberAttached)
        yield* crashingGateway.journal.append(
          crashRunId,
          intentRecordKey(operation.operationId),
          taskTrackerReadIntent(operation)
        )
        yield* Ref.set(failAfterDurableAppend, true)
        const interruptedPublication = yield* crashingGateway.journal
          .append(
            crashRunId,
            outcomeRecordKey(operation.operationId),
            taskTrackerFactsObservedEvent(
              operation.operationId,
              makeCompleteTaskTrackerFactsObserved(operation, graph("accepted-before-publication", ["A"]))
            )
          )
          .pipe(Effect.exit)
        const appliedPosition = (yield* crashingGateway.readCurrent).appliedPosition
        return { appliedPosition, discardedSubscriber, interruptedPublication }
      })
    )
    expect(Exit.isFailure(stoppedProcess.interruptedPublication)).toBe(true)
    expect(stoppedProcess.appliedPosition).toBe(2)
    const discardedSubscriberExit = yield* Fiber.await(stoppedProcess.discardedSubscriber)
    expect(Exit.isFailure(discardedSubscriberExit) && Cause.hasInterruptsOnly(discardedSubscriberExit.cause)).toBe(true)

    const recoveredHistory = reduceWorkflowJournalHistory(crashRunId, yield* storage.read(crashRunId))
    if (recoveredHistory._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(recoveredHistory)
    const restarted = yield* makeAcceptedFactPublicationGateway(crashRunId, target, recoveredHistory, storage)
    expect((yield* restarted.readCurrent).records).toHaveLength(3)
    expect((yield* restarted.readCurrent).reconstructed.graphKnowledge.taskTrackerFacts).toHaveLength(1)
    expect((yield* restarted.readCurrent).graph._tag).toBe("GraphNotEstablished")
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("lets multiple graph subscribers observe one accepted read without performing another boundary action", () =>
  Effect.gen(function* () {
    const subscriberRunId = RunId.make("accepted-fact-multiple-subscribers")
    const storage = yield* JournalStore
    yield* storage.beginRun(subscriberRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(subscriberRunId, yield* storage.read(subscriberRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const appendCalls = yield* Ref.make(0)
    const gateway = yield* makeAcceptedFactPublicationGateway(subscriberRunId, target, initial, {
      append: (...args) => Ref.update(appendCalls, (count) => count + 1).pipe(Effect.andThen(storage.append(...args)))
    })
    const firstAttached = yield* Deferred.make<void>()
    const secondAttached = yield* Deferred.make<void>()
    const observe = (attached: Deferred.Deferred<void>) =>
      gateway.trackerGraph.signal.changes.pipe(
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
    yield* gateway.journal.append(
      subscriberRunId,
      intentRecordKey(operation.operationId),
      taskTrackerReadIntent(operation)
    )
    yield* gateway.journal.append(
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
    const fixedRunId = RunId.make("accepted-fact-fixed-run")
    const storage = yield* JournalStore
    yield* storage.beginRun(fixedRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(fixedRunId, yield* storage.read(fixedRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const gateway = yield* makeAcceptedFactPublicationGateway(fixedRunId, target, initial, storage)
    const publications = yield* Ref.make(0)
    const subscriber = yield* gateway.current.changes.pipe(
      Stream.runForEach(() => Ref.update(publications, (count) => count + 1)),
      Effect.forkChild
    )
    yield* Effect.yieldNow
    const operation = makeTrackerGraphObservationOperation(OperationId.make("idempotent-intent"), target)
    const append = gateway.journal.append(
      fixedRunId,
      intentRecordKey(operation.operationId),
      taskTrackerReadIntent(operation)
    )
    yield* append
    yield* append
    yield* Effect.yieldNow
    expect(yield* Ref.get(publications)).toBe(2)

    const mismatch = yield* gateway.journal.read(RunId.make("another-run")).pipe(Effect.flip)
    expect(mismatch).toBeInstanceOf(InRunJournalRunMismatch)
    expect(
      yield* gateway.journal
        .append(RunId.make("another-run"), intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
        .pipe(Effect.flip)
    ).toBeInstanceOf(InRunJournalRunMismatch)
    yield* Fiber.interrupt(subscriber)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("does not replay queued open values to a subscriber after publication fails", () =>
  Effect.gen(function* () {
    const slowRunId = RunId.make("accepted-fact-slow-subscriber")
    const storage = yield* JournalStore
    yield* storage.beginRun(slowRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(slowRunId, yield* storage.read(slowRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const gateway = yield* makeAcceptedFactPublicationGateway(slowRunId, target, initial, storage)
    const firstConsumed = yield* Deferred.make<void>()
    const releaseSlowConsumer = yield* Deferred.make<void>()
    const consumed = yield* Ref.make<ReadonlyArray<string>>([])
    const subscriber = yield* gateway.current.changes.pipe(
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
    yield* gateway.journal.append(slowRunId, intentRecordKey(accepted.operationId), taskTrackerReadIntent(accepted))
    yield* gateway.journal.append(
      slowRunId,
      outcomeRecordKey(accepted.operationId),
      taskTrackerFactsObservedEvent(
        accepted.operationId,
        makeCompleteTaskTrackerFactsObserved(accepted, graph("queued-open", ["A"]))
      )
    )
    const missingIntent = makeTrackerGraphObservationOperation(OperationId.make("queued-failure"), target)
    const failure = yield* gateway.journal
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
    const mismatchRunId = RunId.make("accepted-fact-record-mismatch")
    const storage = yield* JournalStore
    yield* storage.beginRun(mismatchRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(mismatchRunId, yield* storage.read(mismatchRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const appendCalls = yield* Ref.make(0)
    const replacement = makeTrackerGraphObservationOperation(OperationId.make("replacement-content"), target)
    const gateway = yield* makeAcceptedFactPublicationGateway(mismatchRunId, target, initial, {
      append: (...args) =>
        Ref.getAndUpdate(appendCalls, (count) => count + 1).pipe(
          Effect.flatMap((call) => storage.append(...args).pipe(Effect.map((record) => ({ call, record })))),
          Effect.map(({ call, record }) =>
            call === 0 ? record : { ...record, event: taskTrackerReadIntent(replacement) }
          )
        )
    })
    const operation = makeTrackerGraphObservationOperation(OperationId.make("published-content"), target)
    const append = gateway.journal.append(
      mismatchRunId,
      intentRecordKey(operation.operationId),
      taskTrackerReadIntent(operation)
    )
    yield* append
    const failure = yield* append.pipe(Effect.flip)
    expect(failure).toBeInstanceOf(AcceptedJournalRecordMismatch)

    const later = makeTrackerGraphObservationOperation(OperationId.make("after-record-mismatch"), target)
    expect(
      yield* gateway.journal
        .append(mismatchRunId, intentRecordKey(later.operationId), taskTrackerReadIntent(later))
        .pipe(Effect.flip)
    ).toEqual(failure)
    expect(yield* Ref.get(appendCalls)).toBe(2)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("fails every current reader and subscriber after an accepted event makes the prefix invalid", () =>
  Effect.gen(function* () {
    const invalidRunId = RunId.make("accepted-fact-invalid-prefix")
    const storage = yield* JournalStore
    yield* storage.beginRun(invalidRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(invalidRunId, yield* storage.read(invalidRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const gateway = yield* makeAcceptedFactPublicationGateway(invalidRunId, target, initial, storage)
    const subscriberAttached = yield* Deferred.make<void>()
    const existingSubscriber = yield* gateway.current.changes.pipe(
      Stream.tap(() => Deferred.succeed(subscriberAttached, undefined)),
      Stream.runDrain,
      Effect.forkChild
    )
    yield* Deferred.await(subscriberAttached)
    const missingIntent = makeTrackerGraphObservationOperation(OperationId.make("missing-intent"), target)
    const failure = yield* gateway.journal
      .append(
        invalidRunId,
        outcomeRecordKey(missingIntent.operationId),
        taskTrackerFactsObservedEvent(
          missingIntent.operationId,
          makeCompleteTaskTrackerFactsObserved(missingIntent, graph("invalid", []))
        )
      )
      .pipe(Effect.flip)
    expect(failure).toBeInstanceOf(AcceptedJournalHistoryInvalid)
    expect(yield* Fiber.join(existingSubscriber).pipe(Effect.flip)).toEqual(failure)
    expect(yield* gateway.readCurrent.pipe(Effect.flip)).toEqual(failure)
    expect(yield* gateway.journal.read(invalidRunId).pipe(Effect.flip)).toEqual(failure)
    expect(yield* gateway.trackerGraph.signal.changes.pipe(Stream.runHead, Effect.flip)).toBeInstanceOf(
      TrackerGraphRelationError
    )

    const later = makeTrackerGraphObservationOperation(OperationId.make("after-invalid"), target)
    const repeated = yield* gateway.journal
      .append(invalidRunId, intentRecordKey(later.operationId), taskTrackerReadIntent(later))
      .pipe(Effect.flip)
    expect(repeated).toEqual(failure)
    expect(yield* storage.read(invalidRunId)).toHaveLength(2)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("attempts no later storage append after an accepted position contradicts the published prefix", () =>
  Effect.gen(function* () {
    const gapRunId = RunId.make("accepted-fact-position-gap")
    const storage = yield* JournalStore
    yield* storage.beginRun(gapRunId, target, initialPolicy)
    const initial = reduceWorkflowJournalHistory(gapRunId, yield* storage.read(gapRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const appendCalls = yield* Ref.make(0)
    const gateway = yield* makeAcceptedFactPublicationGateway(gapRunId, target, initial, {
      append: (...args) =>
        Ref.update(appendCalls, (count) => count + 1).pipe(
          Effect.andThen(storage.append(...args)),
          Effect.map((record) => ({ ...record, position: JournalPosition.make(record.position + 1) }))
        )
    })
    const first = makeTrackerGraphObservationOperation(OperationId.make("gap-first"), target)
    const failure = yield* gateway.journal
      .append(gapRunId, intentRecordKey(first.operationId), taskTrackerReadIntent(first))
      .pipe(Effect.flip)
    expect(failure).toBeInstanceOf(AcceptedJournalPositionGap)

    const later = makeTrackerGraphObservationOperation(OperationId.make("gap-later"), target)
    expect(
      yield* gateway.journal
        .append(gapRunId, intentRecordKey(later.operationId), taskTrackerReadIntent(later))
        .pipe(Effect.flip)
    ).toEqual(failure)
    expect(yield* Ref.get(appendCalls)).toBe(1)
    expect(yield* storage.read(gapRunId)).toHaveLength(2)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)
