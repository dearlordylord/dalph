#!/usr/bin/env node

// THROWAWAY: demonstrates the existing durable control replay semantics only.
import assert from "node:assert/strict"
import { RunId } from "@dalph/contracts"
import { Effect, Layer, ManagedRuntime } from "effect"
import {
  ControlDirectionApplication,
  FixtureTarget,
  InitialControlPolicy,
  InRunJournal,
  TaskWorkCapacity,
  controlDirectionApplicationLayer,
  liveJournalTestLayer,
  makeWorkflowRunBeganRecord,
  reduceWorkflowJournalHistory
} from "@dalph/orchestrator"

const runId = RunId.make("invokee-control-replay-run")
const target = FixtureTarget.make("invokee-control-replay-target")
const initial = makeWorkflowRunBeganRecord(
  runId,
  target,
  InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
)

const runtime = ManagedRuntime.make(
  controlDirectionApplicationLayer.pipe(
    Layer.provideMerge(liveJournalTestLayer({ records: [initial], runId, target }))
  )
)

const unpause = { direction: "Unpause", subject: { _tag: "Run", runId } }
const pause = { direction: "Pause", subject: { _tag: "Run", runId } }

try {
  const result = await runtime.runPromise(
    Effect.gen(function* () {
      const control = yield* ControlDirectionApplication
      const journal = yield* InRunJournal

      const clientAFirst = yield* control.apply(unpause)
      // The harness retains this for evidence; simulated client A never receives it.
      const clientB = yield* control.apply(pause)
      const afterClientBRecords = yield* journal.read(runId)
      const afterClientB = reduceWorkflowJournalHistory(runId, afterClientBRecords)
      const clientAReplay = yield* control.apply(unpause)

      const records = yield* journal.read(runId)
      return { afterClientB, clientAFirst, clientB, clientAReplay, records }
    })
  )

  const controlRecords = result.records.filter(({ event }) => event._tag === "ControlDirectionApplied")
  const reduction = reduceWorkflowJournalHistory(runId, result.records)
  assert.equal(result.afterClientB._tag, "ValidWorkflowJournalHistory")
  assert.deepEqual(result.afterClientB.runState.pause.run, { _tag: "RunPaused" })
  assert.equal(reduction._tag, "ValidWorkflowJournalHistory")
  assert.deepEqual(
    controlRecords.map(({ event }) => ({ direction: event.direction, ordinal: event.ordinal })),
    [
      { direction: "Unpause", ordinal: 1 },
      { direction: "Pause", ordinal: 2 },
      { direction: "Unpause", ordinal: 3 }
    ]
  )
  assert.deepEqual(reduction.runState.pause.run, { _tag: "RunUnpaused" })

  console.log(
    JSON.stringify(
      {
        chronology: [
          { actor: "client A", result: "response lost after return", returnedRecord: result.clientAFirst },
          { actor: "client B", result: "response received", returnedRecord: result.clientB },
          { actor: "client A", result: "exact request replayed", returnedRecord: result.clientAReplay }
        ],
        durableControlRecords: controlRecords,
        effectiveStateAfterClientBPause: result.afterClientB.runState.pause,
        effectivePauseState: reduction.runState.pause,
        finding: "The blind replay appends ordinal 3 and overrides client B's intervening Pause."
      },
      null,
      2
    )
  )
} finally {
  await runtime.dispose()
}
