import { it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { expect } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { InitialControlPolicy, initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { OperationId } from "../../workflow/identity.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { JournalStore } from "../../workflow-journal/store.js"
import { CurrentDeliveryGraphUnavailable, makeJournaledCurrentDeliveryRelation } from "./current-delivery-relation.js"

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
  runId: RunId,
  operationId: OperationId,
  snapshot: ReturnType<typeof graph>
) {
  const journal = yield* JournalStore
  const operation = makeTrackerGraphObservationOperation(operationId, target)
  yield* journal.append(runId, intentRecordKey(operationId), taskTrackerReadIntent(operation))
  yield* journal.append(
    runId,
    outcomeRecordKey(operationId),
    taskTrackerFactsObservedEvent(operationId, makeCompleteTaskTrackerFactsObserved(operation, snapshot))
  )
})

it.effect("rejects raw and incomplete graph knowledge before frontier derivation", () =>
  Effect.gen(function* () {
    const runId = RunId.make("current-delivery-unaccepted")
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target, policy)
    const relation = yield* makeJournaledCurrentDeliveryRelation(runId, Effect.succeed(currentPolicy), journal)
    const acceptedGraph = graph("accepted", ["A"])
    expect(yield* relation.read.pipe(Effect.flip)).toBeInstanceOf(CurrentDeliveryGraphUnavailable)
    yield* relation.refreshAcceptedHistory
    expect(yield* relation.read.pipe(Effect.flip)).toBeInstanceOf(CurrentDeliveryGraphUnavailable)

    const incompleteOperation = makeTrackerGraphObservationOperation(OperationId.make("incomplete-read"), target)
    yield* journal.append(
      runId,
      intentRecordKey(incompleteOperation.operationId),
      taskTrackerReadIntent(incompleteOperation)
    )
    yield* relation.refreshAcceptedHistory
    expect(yield* relation.read.pipe(Effect.flip)).toBeInstanceOf(CurrentDeliveryGraphUnavailable)

    yield* appendAcceptedGraph(runId, incompleteOperation.operationId, acceptedGraph)
    const accepted = yield* journal.read(runId)
    const last = Option.getOrThrow(Option.fromUndefinedOr(accepted.at(-1)))
    const invalid = yield* makeJournaledCurrentDeliveryRelation(runId, Effect.succeed(currentPolicy), {
      read: () => Effect.succeed([...accepted, { ...last, position: JournalPosition.make(accepted.length + 1) }])
    }).pipe(Effect.flip)
    expect(invalid._tag).toBe("InvalidWorkflowJournalHistory")
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("coalesces accepted observations to the latest frame and reconstructs it after restart", () =>
  Effect.gen(function* () {
    const runId = RunId.make("current-delivery-coalesced")
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target, policy)
    const relation = yield* makeJournaledCurrentDeliveryRelation(runId, Effect.succeed(currentPolicy), journal)
    yield* appendAcceptedGraph(runId, OperationId.make("accepted-one"), graph("one", ["A", "removed"]))
    yield* appendAcceptedGraph(runId, OperationId.make("accepted-two"), graph("two", ["A", "newly-eligible"]))

    yield* relation.refreshAcceptedHistory
    const current = yield* relation.read
    expect(current.currentGraph.taskIds()).toEqual(["A", "newly-eligible"])
    expect(current.currentGraphOperationId).toBe("accepted-two")
    expect(current.responsibility.entries).toEqual([])
    expect(current.runControlPolicy).toEqual(currentPolicy)
    expect(Object.keys(current)).not.toContain("ownership")
    expect(Object.keys(current)).not.toContain("positions")

    const restarted = yield* makeJournaledCurrentDeliveryRelation(runId, Effect.succeed(currentPolicy), journal)
    expect((yield* restarted.read).currentGraph.taskIds()).toEqual(["A", "newly-eligible"])
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)
