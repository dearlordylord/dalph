import { strict as assert } from "node:assert"
import { parseHTML } from "linkedom"
import { Effect, Result } from "effect"
import { RunId, TaskId } from "@dalph/contracts"
import {
  FixtureTarget,
  InitialControlPolicy,
  JournalPosition,
  JournalStore,
  makeCompleteTaskTrackerFactsObserved,
  makeTraceReader,
  makeTrackerGraphObservationOperation,
  memoryJournalStoreLayer,
  OperationId,
  projectTrackerSnapshot,
  taskTrackerFactsObservedEvent,
  taskTrackerReadIntent,
  TaskWorkCapacity,
  TraceCursor,
  describeJournalEvent
} from "@dalph/orchestrator"
import { renderProductionTraceHistory } from "./cassette-lab-workbench.ts"

const runId = RunId.make("run:lab-selected-history")
const taskId = TaskId.make("selected-history-task")
const prepared = await Effect.runPromise(
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const target = FixtureTarget.make("fixture:lab-selected-history")
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const graph = projectTrackerSnapshot({
      revision: "selected-history-r1",
      tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
    })
    if (graph._tag === "Invalid") return yield* Effect.die(graph.issues)
    const operation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make("selected-history-read"),
      target,
      []
    )
    const intent = taskTrackerReadIntent(operation)
    const observation = taskTrackerFactsObservedEvent(
      operation.operationId,
      makeCompleteTaskTrackerFactsObserved(operation, graph.snapshot)
    )
    for (const event of [intent, observation])
      yield* journal.append(runId, describeJournalEvent(event).expectedKey, event)
    return yield* makeTraceReader({ read: journal.read }).prepare(runId)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)
const presentCursor = TraceCursor.make({ position: JournalPosition.make(3), runId })
const absentCursor = TraceCursor.make({ position: JournalPosition.make(1), runId })
const present = Result.getOrThrow(prepared.select(presentCursor))
const absent = Result.getOrThrow(prepared.select(absentCursor))
assert.deepEqual(present.cursor, presentCursor)
assert.equal(
  present.graph?.snapshot.tasks.some(({ id }) => id === taskId),
  true
)
assert.deepEqual(absent.cursor, absentCursor)
assert.equal(absent.graph, null)

const { document, window } = parseHTML("<!doctype html><html><body></body></html>")
Object.assign(globalThis, {
  customElements: window.customElements,
  CustomEvent: window.CustomEvent,
  document,
  Event: window.Event,
  HTMLElement: window.HTMLElement
})
const host = document.createElement("div")
renderProductionTraceHistory(host, prepared, [], { _tag: "NotRun" })
host
  .querySelector("[data-role='trace-production-graph']")
  ?.dispatchEvent(new CustomEvent("task-selected", { detail: { taskId } }))
const selector = host.querySelector<HTMLSelectElement>("[data-role='trace-cursor-selector']")
assert.ok(selector)
const select = (index: string): void => {
  for (const option of selector.options) {
    if (option.value === index) option.setAttribute("selected", "")
    else option.removeAttribute("selected")
  }
  selector.dispatchEvent(new Event("change"))
}
select("2")
assert.equal(host.querySelector<HTMLElement>("[data-role='trace-cursor']")?.dataset.journalPosition, "3")
assert.ok(host.querySelector("[data-role='trace-selection-inspector']")?.textContent?.includes(`Task: ${taskId}`))
select("0")
assert.equal(host.querySelector<HTMLElement>("[data-role='trace-cursor']")?.dataset.journalPosition, "1")
assert.ok(host.querySelector("[data-role='trace-selection-inspector']")?.textContent?.includes("Task: none"))
assert.deepEqual(present.cursor, presentCursor)
assert.equal(
  present.graph?.snapshot.tasks.some(({ id }) => id === taskId),
  true
)
console.log("✓ keeps task selection only when the exact requested production history contains that task")
