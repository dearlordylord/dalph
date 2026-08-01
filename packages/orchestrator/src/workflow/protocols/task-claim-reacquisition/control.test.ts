import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { memoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { TaskClaimReacquisitionControl, taskClaimReacquisitionControlLayer } from "./control.js"

it.effect("rejects an operator claim-reacquisition direction before the Run begins", () =>
  Effect.gen(function* () {
    const runId = RunId.make("claim-reacquisition-missing-run")
    const failure = yield* Effect.flip(
      (yield* TaskClaimReacquisitionControl).apply({ runId, taskId: TaskId.make("task-A") })
    )
    expect(failure).toMatchObject({ _tag: "WorkflowRunNotBegan", runId })
    expect(yield* (yield* JournalStore).read(runId)).toEqual([])
  }).pipe(Effect.provide(taskClaimReacquisitionControlLayer), Effect.provide(memoryJournalStoreLayer))
)
