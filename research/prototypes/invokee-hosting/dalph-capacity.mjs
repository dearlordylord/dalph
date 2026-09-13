// THROWAWAY: existing Dalph capacity protocol hosted in one process-owned runtime.
import { Effect, Layer, ManagedRuntime } from "effect"
import { RunId } from "@dalph/contracts"
import {
  FixtureTarget,
  InitialControlPolicy,
  InRunJournal,
  TaskWorkCapacity,
  TaskWorkCapacityControl,
  liveJournalTestLayer,
  makeWorkflowRunBeganRecord,
  taskWorkCapacityControlLayer
} from "@dalph/orchestrator"

export const makeDalphCapacity = async (id = "prototype-run") => {
  const runId = RunId.make(id)
  const target = FixtureTarget.make("prototype-capacity-target")
  const initial = makeWorkflowRunBeganRecord(
    runId,
    target,
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  const runtime = ManagedRuntime.make(taskWorkCapacityControlLayer.pipe(
    Layer.provideMerge(liveJournalTestLayer({ runId, target, records: [initial] }))
  ))
  const control = await runtime.runPromise(TaskWorkCapacityControl)
  return {
    read: () => runtime.runPromise(control.read(runId)),
    apply: (input) => runtime.runPromise(control.apply(input).pipe(Effect.match({
      onSuccess: (policy) => ({ ok: true, policy }),
      onFailure: (error) => ({ ok: false, error })
    }))),
    records: () => runtime.runPromise(Effect.flatMap(InRunJournal, (journal) => journal.read(runId))),
    close: () => runtime.dispose()
  }
}
