import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { memoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalStore } from "../../../workflow-journal/store.js"
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
  }).pipe(Effect.provide(taskClaimReacquisitionControlLayer), Effect.provide(memoryJournalStoreLayer))
)

it.effect("coalesces exact request redelivery and rejects identity reuse for another task", () =>
  Effect.gen(function* () {
    const runId = RunId.make("claim-reacquisition-redelivery-run")
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("claim-reacquisition-redelivery-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const control = yield* TaskClaimReacquisitionControl
    const requestId = TaskClaimReacquisitionRequestId.make("stable-reacquisition-request")
    const request = { requestId, subject: { runId, taskId: TaskId.make("task-A") } }

    const first = yield* control.apply(request)
    const redelivered = yield* control.apply(request)
    expect(redelivered).toEqual(first)
    expect(yield* journal.read(runId)).toHaveLength(2)

    const contradiction = yield* Effect.flip(
      control.apply({ requestId, subject: { runId, taskId: TaskId.make("task-B") } })
    )
    expect(contradiction).toEqual(
      new TaskClaimReacquisitionRequestIdentityContradiction({ existingPosition: first.position, requestId, runId })
    )
  }).pipe(Effect.provide(taskClaimReacquisitionControlLayer), Effect.provide(memoryJournalStoreLayer))
)
