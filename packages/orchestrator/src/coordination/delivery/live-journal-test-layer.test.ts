import { it } from "@effect/vitest"
import { RunId } from "@dalph/contracts"
import { Context, Effect, Layer, Exit, Option } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy, RunPolicyRevision } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { observeWorkflowJournalValidationSteps } from "../reconstruction/history.js"
import { TaskWorkCapacityChangedEvent } from "../../workflow/registry/event.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { AcceptedJournalReader } from "../../workflow-journal/accepted-reader.js"
import { makeWorkflowRunBeganRecord } from "../../workflow-journal/run-lifecycle.js"
import { taskWorkCapacityPolicyRecordKey } from "../../workflow-journal/record-key.js"
import { InRunJournal, JournalStore } from "../../workflow-journal/store.js"
import { observeJournalRecordSequenceOperations } from "../../workflow-journal/record-sequence.js"
import { Journal } from "./journal.js"
import { liveJournalTestLayer } from "./live-journal-test-layer.js"
import { memoryJournalTestLayerFromPartitionRecords } from "../../workflow-journal/adapters/memory-store.js"

const runId = RunId.make("live-journal-test-layer")
const target = FixtureTarget.make("live-journal-test-layer")
const began = makeWorkflowRunBeganRecord(
  runId,
  target,
  InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
)

it.effect("imports once and shares warm append publication with every accepted reader", () =>
  Effect.gen(function* () {
    let steps = 0
    const stop = observeWorkflowJournalValidationSteps(() => {
      steps += 1
    })
    yield* Effect.addFinalizer(() => Effect.sync(stop))
    const context = yield* Layer.build(liveJournalTestLayer({ runId, target, records: [began] }))
    expect(steps).toBe(1)
    yield* Effect.gen(function* () {
      const journal = yield* Journal
      const reader = yield* AcceptedJournalReader
      const writer = yield* InRunJournal
      const storage = yield* JournalStore
      let materializations = 0
      const stopSequence = observeJournalRecordSequenceOperations((operation) => {
        if (operation._tag === "HistoricalMaterialization") materializations += 1
      })
      yield* Effect.addFinalizer(() => Effect.sync(stopSequence))
      const before = yield* reader.readAccepted(runId)
      expect(yield* reader.readAccepted(runId)).toBe(before)
      expect(steps).toBe(1)
      const revision = RunPolicyRevision.make(2)
      yield* writer.append(
        runId,
        taskWorkCapacityPolicyRecordKey(revision),
        TaskWorkCapacityChangedEvent.make({
          capacity: TaskWorkCapacity.make(2),
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          previousRevision: RunPolicyRevision.make(1),
          revision,
          version: workflowJournalEventVersion
        })
      )
      const after = yield* reader.readAccepted(runId)
      expect(after).toBe((yield* journal.state.get).prefix)
      expect(after).not.toBe(before)
      expect(yield* reader.readAccepted(runId)).toBe(after)
      expect(steps).toBe(2)
      expect(materializations).toBe(0)
      expect((yield* storage.read(runId)).length).toBe(2)
    }).pipe(Effect.provide(context))
  })
)

it.effect("rejects invalid initial chronology before exposing live services", () =>
  Effect.gen(function* () {
    const result = yield* Layer.build(liveJournalTestLayer({ runId, target, records: [began, began] })).pipe(
      Effect.exit
    )
    expect(Exit.isFailure(result)).toBe(true)
  })
)

it.effect("does not establish an accepted live Run from empty storage", () =>
  Effect.gen(function* () {
    const result = yield* Layer.build(liveJournalTestLayer({ runId, target, records: [] })).pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
  })
)

it.effect("raw malformed-history fixtures expose storage without accepted authority", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(memoryJournalTestLayerFromPartitionRecords({ hot: [began, began] }))
    expect(Context.getOption(context, AcceptedJournalReader)).toSatisfy(Option.isNone)
    expect(Context.getOption(context, Journal)).toSatisfy(Option.isNone)
    expect(yield* Context.get(context, JournalStore).read(runId)).toEqual([began, began])
  })
)
