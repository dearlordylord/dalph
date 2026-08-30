import { it } from "@effect/vitest"
import { RunId, TaskId, makeTaskWorkSpecification } from "@dalph/contracts"
import { Effect } from "effect"
import { expect } from "vitest"
import type { JournalState } from "../delivery/journal.js"
import { TrackerGraphState } from "../delivery/relations.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { OperationId } from "../../workflow/identity.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import {
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { JournalStore } from "../../workflow-journal/store.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { makeJournal } from "../delivery/journal.js"
import { journaledCurrentDeliveryFrameOf } from "./current-delivery-frame.js"
import { deriveFreshWorkflowDecisions } from "./fresh-workflow.js"

it.effect("rejects an accepted prefix before its current tracker graph exists", () =>
  Effect.gen(function* () {
    const accepted = { graph: TrackerGraphState.cases.GraphNotEstablished.make({}) } as JournalState
    const failure = yield* journaledCurrentDeliveryFrameOf(accepted).pipe(Effect.flip)

    expect(failure._tag).toBe("CurrentDeliveryGraphUnavailable")
  })
)

it.effect("keeps the immutable run target graph in the public delivery frame", () =>
  Effect.gen(function* () {
    const runId = RunId.make("current-delivery-frame-target-isolation")
    const target = FixtureTarget.make("current-delivery-frame-target-A")
    const foreignTarget = FixtureTarget.make("current-delivery-frame-target-B")
    const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    const storage = yield* JournalStore
    yield* storage.beginRun(runId, target, policy)
    const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const journal = yield* makeJournal(runId, target, initial, storage)
    const graph = (operationId: OperationId, operationTarget: typeof target, revision: string, taskId: string) => {
      const operation = makeTrackerGraphObservationOperation(operationId, operationTarget)
      const projected = projectTrackerSnapshot({
        revision,
        tasks: [
          { id: TaskId.make(taskId), lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }
        ]
      })
      if (projected._tag === "Invalid") return Effect.die(projected)
      return journal
        .append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
        .pipe(
          Effect.andThen(
            journal.append(
              runId,
              outcomeRecordKey(operation.operationId),
              taskTrackerFactsObservedEvent(
                operation.operationId,
                makeCompleteTaskTrackerFactsObserved(operation, projected.snapshot)
              )
            )
          )
        )
    }

    yield* graph(OperationId.make("current-delivery-frame-A"), target, "target-A", "A")
    yield* graph(OperationId.make("current-delivery-frame-B"), foreignTarget, "target-B", "B")
    const foreignSpecification = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("current-delivery-frame-foreign-specification"),
      foreignTarget,
      TaskId.make("A"),
      [OperationId.make("current-delivery-frame-B")]
    )
    yield* journal.append(
      runId,
      intentRecordKey(foreignSpecification.operationId),
      taskTrackerReadIntent(foreignSpecification)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(foreignSpecification.operationId),
      taskTrackerFactsObservedEvent(
        foreignSpecification.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(
          foreignSpecification,
          makeTaskWorkSpecification({
            body: "foreign specification",
            taskId: TaskId.make("A"),
            title: "foreign specification"
          })
        )
      )
    )

    const frame = yield* journaledCurrentDeliveryFrameOf(yield* journal.state.get)
    expect(frame.currentGraph.revision).toBe("target-A")
    expect(frame.currentGraphOperationId).toBe(OperationId.make("current-delivery-frame-A"))
    expect(deriveFreshWorkflowDecisions(frame, new Set(), target)).toMatchObject([
      {
        step: {
          _tag: "ReadCurrentTaskGraph",
          predecessorOperationId: OperationId.make("current-delivery-frame-A"),
          task: { id: TaskId.make("A") }
        }
      }
    ])
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)
