#!/usr/bin/env node

import { Effect, Layer, Schema } from "effect"
import { RunId } from "@dalph/contracts"
import {
  DeliveryStatusSubject,
  FixtureTarget,
  InitialControlPolicy,
  TaskWorkCapacity,
  TaskWorkCapacityControl,
  deliveryStatusOf,
  initialRunPolicyRevision,
  liveJournalTestLayer,
  makeWorkflowRunBeganRecord,
  taskWorkCapacityControlLayer
} from "@dalph/orchestrator"

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const runId = RunId.make("source-seam-probe-run")
const target = FixtureTarget.make("source-seam-probe-target")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
const journalPrefix = makeWorkflowRunBeganRecord(runId, target, initialPolicy)
const layer = taskWorkCapacityControlLayer.pipe(
  Layer.provide(liveJournalTestLayer({ runId, target, records: [journalPrefix] }))
)

const result = await Effect.runPromise(
  Effect.gen(function* () {
    const control = yield* TaskWorkCapacityControl
    const initial = yield* control.read(runId)
    const applied = yield* control.apply({
      capacity: TaskWorkCapacity.make(2),
      expectedRevision: initialRunPolicyRevision,
      runId
    })
    const stale = yield* control
      .apply({ capacity: TaskWorkCapacity.make(3), expectedRevision: initialRunPolicyRevision, runId })
      .pipe(Effect.flip)
    return { applied, initial, stale }
  }).pipe(Effect.provide(layer))
)

assert(result.initial.revision === 1 && result.initial.taskExecutionCapacity === 1, "initial policy seam changed")
assert(result.applied.revision === 2 && result.applied.taskExecutionCapacity === 2, "capacity seam did not apply")
assert(result.stale._tag === "TaskWorkCapacityPolicyRevisionConflict", "stale capacity was accepted")
assert(result.stale.current.revision === 2 && result.stale.current.taskExecutionCapacity === 2, "conflict lost current policy")
assert(Schema.decodeUnknownSync(TaskWorkCapacity)(1) === 1, "capacity lower bound changed")
assert(Schema.decodeUnknownSync(TaskWorkCapacity)(8) === 8, "capacity upper bound changed")
let rejected = false
try {
  Schema.decodeUnknownSync(TaskWorkCapacity)(9)
} catch {
  rejected = true
}
assert(rejected, "capacity above eight was accepted")

const passive = deliveryStatusOf(DeliveryStatusSubject.cases.Run.make({ runId }), { _tag: "NotReady" })
assert(passive._tag === "DeliveryStatusNotReady", "passive status seam changed")

process.stdout.write(
  `${JSON.stringify({
    _tag: "SourceSeamsPassed",
    capacity: { initial: result.initial, applied: result.applied, stale: result.stale._tag },
    passiveStatus: passive._tag,
    reused: [
      "TaskWorkCapacityControl.read",
      "TaskWorkCapacityControl.apply",
      "deliveryStatusOf",
      "makeWorkflowRunBeganRecord"
    ]
  })}\n`
)
