import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { expect } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { InRunJournal, JournalStore } from "../../../workflow-journal/store.js"
import { unpublishedAcceptedJournalReaderTestLayer } from "../../../workflow-journal/test-accepted-reader.js"
import { makeWorkflowRunBeganRecord } from "../../../workflow-journal/run-lifecycle.js"
import { liveJournalTestLayer } from "../../../coordination/delivery/live-journal-test-layer.js"
import {
  TaskClaimReacquisitionControl,
  TaskClaimReacquisitionRequestIdentityContradiction,
  taskClaimReacquisitionControlLayer
} from "./control.js"
import { TaskClaimReacquisitionRequestId } from "./events.js"

it.effect("rejects an operator claim-reacquisition direction before the Run begins", () =>
  Effect.gen(function* () {
    const runId = RunId.make("claim-reacquisition-missing-run")
    const failure = yield* Effect.flip(
      (yield* TaskClaimReacquisitionControl).apply({
        requestId: TaskClaimReacquisitionRequestId.make("missing-run-request"),
        subject: { runId, taskId: TaskId.make("task-A") }
      })
    )
    expect(failure).toMatchObject({ _tag: "WorkflowRunNotBegan", runId })
    expect(yield* (yield* JournalStore).read(runId)).toEqual([])
  }).pipe(
    Effect.provide(taskClaimReacquisitionControlLayer),
    // No Run exists to activate; this is the explicit absent cold-storage diagnostic seam.
    Effect.provide(unpublishedAcceptedJournalReaderTestLayer.pipe(Layer.provideMerge(memoryJournalTestLayer)))
  )
)

const redeliveryRunId = RunId.make("claim-reacquisition-redelivery-run")

it.effect("coalesces exact request redelivery and rejects identity reuse for another task", () =>
  Effect.gen(function* () {
    const journal = yield* InRunJournal
    const control = yield* TaskClaimReacquisitionControl
    const requestId = TaskClaimReacquisitionRequestId.make("stable-reacquisition-request")
    const request = { requestId, subject: { runId: redeliveryRunId, taskId: TaskId.make("task-A") } }

    const first = yield* control.apply(request)
    const redelivered = yield* control.apply(request)
    expect(redelivered).toEqual(first)
    expect(yield* journal.read(redeliveryRunId)).toHaveLength(2)

    const contradiction = yield* Effect.flip(
      control.apply({ requestId, subject: { runId: redeliveryRunId, taskId: TaskId.make("task-B") } })
    )
    expect(contradiction).toEqual(
      new TaskClaimReacquisitionRequestIdentityContradiction({
        existingPosition: first.position,
        requestId,
        runId: redeliveryRunId
      })
    )
  }).pipe(
    Effect.provide(taskClaimReacquisitionControlLayer),
    Effect.provide(
      liveJournalTestLayer({
        records: [
          makeWorkflowRunBeganRecord(
            redeliveryRunId,
            FixtureTarget.make("claim-reacquisition-redelivery-target"),
            InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
          )
        ],
        runId: redeliveryRunId,
        target: FixtureTarget.make("claim-reacquisition-redelivery-target")
      })
    )
  )
)
