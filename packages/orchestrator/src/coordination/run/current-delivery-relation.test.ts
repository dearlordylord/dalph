import { it } from "@effect/vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { Effect, Option } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { InitialControlPolicy, initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeAcceptedFactPublicationGateway } from "../delivery/accepted-fact-gateway.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { OperationId } from "../../workflow/identity.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { JournalStore } from "../../workflow-journal/store.js"
import {
  CurrentDeliveryGraphUnavailable,
  makeJournaledCurrentDeliveryRelation,
  makeLegacyJournaledCurrentDeliveryRelation,
  makeLegacySchedulerCurrentDeliveryCompatibility
} from "./current-delivery-relation.js"

const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
const currentPolicy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: policy.taskExecutionCapacity
})
const target = FixtureTarget.make("current-delivery-relation-target")

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

const appendAcceptedGraph = Effect.fn("CurrentDeliveryRelationTest.appendAcceptedGraph")(function* (
  gateway: Effect.Success<ReturnType<typeof makeAcceptedFactPublicationGateway>>,
  runId: RunId,
  operationId: OperationId,
  snapshot: ReturnType<typeof graph>
) {
  const operation = makeTrackerGraphObservationOperation(operationId, target)
  yield* gateway.journal.append(runId, intentRecordKey(operationId), taskTrackerReadIntent(operation))
  yield* gateway.journal.append(
    runId,
    outcomeRecordKey(operationId),
    taskTrackerFactsObservedEvent(operationId, makeCompleteTaskTrackerFactsObserved(operation, snapshot))
  )
})

const installGateway = Effect.fn("CurrentDeliveryRelationTest.installGateway")(function* (runId: RunId) {
  const storage = yield* JournalStore
  const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
  if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
  return yield* makeAcceptedFactPublicationGateway(runId, target, initial, storage)
})

it.effect("reads only complete graph knowledge published through the gateway", () =>
  Effect.gen(function* () {
    const runId = RunId.make("current-delivery-unaccepted")
    const storage = yield* JournalStore
    yield* storage.beginRun(runId, target, policy)
    const gateway = yield* installGateway(runId)
    const relation = makeJournaledCurrentDeliveryRelation(gateway)
    expect(yield* relation.read.pipe(Effect.flip)).toBeInstanceOf(CurrentDeliveryGraphUnavailable)

    const operation = makeTrackerGraphObservationOperation(OperationId.make("incomplete-read"), target)
    yield* gateway.journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
    expect(yield* relation.read.pipe(Effect.flip)).toBeInstanceOf(CurrentDeliveryGraphUnavailable)

    yield* gateway.journal.append(
      runId,
      outcomeRecordKey(operation.operationId),
      taskTrackerFactsObservedEvent(
        operation.operationId,
        makeCompleteTaskTrackerFactsObserved(operation, graph("accepted", ["A"]))
      )
    )
    const accepted = yield* relation.read
    expect(accepted.currentGraph.taskIds()).toEqual(["A"])
    expect(accepted.currentGraphOperationId).toBe("incomplete-read")
    expect(accepted.runControlPolicy).toEqual(currentPolicy)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("reports unavailable and invalid prefixes through the temporary journal compatibility relation", () =>
  Effect.gen(function* () {
    const runId = RunId.make("current-delivery-compatibility-errors")
    const storage = yield* JournalStore
    yield* storage.beginRun(runId, target, policy)
    const begun = yield* storage.read(runId)
    const journal = { read: () => Effect.succeed(begun) }
    const unavailable = makeLegacyJournaledCurrentDeliveryRelation(runId, Effect.succeed(currentPolicy), journal)
    expect(yield* unavailable.read.pipe(Effect.flip)).toBeInstanceOf(CurrentDeliveryGraphUnavailable)

    const first = Option.getOrThrow(Option.fromUndefinedOr(begun[0]))
    const invalid = makeLegacyJournaledCurrentDeliveryRelation(runId, Effect.succeed(currentPolicy), {
      read: () => Effect.succeed([...begun, { ...first, position: JournalPosition.make(2) }])
    })
    expect(yield* invalid.read.pipe(Effect.flip)).toMatchObject({ _tag: "InvalidWorkflowJournalHistory" })
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("hides reconstructed old graph knowledge until restart accepts a fresh complete graph", () =>
  Effect.gen(function* () {
    const runId = RunId.make("current-delivery-restarted")
    const storage = yield* JournalStore
    yield* storage.beginRun(runId, target, policy)
    const beforeCrash = makeTrackerGraphObservationOperation(OperationId.make("accepted-before-crash"), target)
    yield* storage.append(runId, intentRecordKey(beforeCrash.operationId), taskTrackerReadIntent(beforeCrash))
    yield* storage.append(
      runId,
      outcomeRecordKey(beforeCrash.operationId),
      taskTrackerFactsObservedEvent(
        beforeCrash.operationId,
        makeCompleteTaskTrackerFactsObserved(beforeCrash, graph("one", ["old"]))
      )
    )

    const restarted = yield* installGateway(runId)
    const relation = makeJournaledCurrentDeliveryRelation(restarted)
    const reconstructed = yield* restarted.readCurrent
    expect(reconstructed.records).toHaveLength(3)
    expect(reconstructed.reconstructed.graphKnowledge.taskTrackerFacts).toHaveLength(1)
    expect(yield* relation.read.pipe(Effect.flip)).toBeInstanceOf(CurrentDeliveryGraphUnavailable)

    yield* appendAcceptedGraph(restarted, runId, OperationId.make("accepted-after-restart"), graph("two", ["current"]))
    const current = yield* relation.read
    expect(current.currentGraph.taskIds()).toEqual(["current"])
    expect(current.currentGraphOperationId).toBe("accepted-after-restart")
    expect(current.responsibility.entries).toEqual([])
    expect(Object.keys(current)).not.toContain("ownership")
    expect(Object.keys(current)).not.toContain("positions")
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("keeps the gateway live while the legacy scheduler samples accepted operation boundaries", () =>
  Effect.gen(function* () {
    const runId = RunId.make("current-delivery-compatibility-epoch")
    const storage = yield* JournalStore
    yield* storage.beginRun(runId, target, policy)
    const gateway = yield* installGateway(runId)
    const compatibility = yield* makeLegacySchedulerCurrentDeliveryCompatibility(gateway, Effect.succeed(currentPolicy))

    yield* appendAcceptedGraph(gateway, runId, OperationId.make("initial"), graph("one", ["A"]))
    expect(yield* compatibility.relation.read.pipe(Effect.flip)).toBeInstanceOf(CurrentDeliveryGraphUnavailable)

    yield* compatibility.afterGraphAccepted
    expect((yield* compatibility.relation.read).currentGraph.taskIds()).toEqual(["A"])

    yield* appendAcceptedGraph(gateway, runId, OperationId.make("later"), graph("two", ["B"]))
    expect((yield* makeJournaledCurrentDeliveryRelation(gateway).read).currentGraph.taskIds()).toEqual(["B"])
    expect((yield* compatibility.relation.read).currentGraph.taskIds()).toEqual(["A"])

    yield* compatibility.afterOperationSucceeded
    expect((yield* compatibility.relation.read).currentGraph.taskIds()).toEqual(["B"])
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)
