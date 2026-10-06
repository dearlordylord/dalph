import type { JournalService } from "../../orchestrator/src/coordination/delivery/journal.js"
import { type RunId } from "@dalph/contracts"
import { Effect } from "effect"
import {
  OperationId,
  makeTrackerGraphObservationOperation,
  taskTrackerReadIntent,
  makeRunFinalityEvidence
} from "@dalph/orchestrator"
import type { TaskDagSnapshot } from "../../orchestrator/src/authorities/task-tracker/graph.js"
import type { TrackerTarget } from "../../orchestrator/src/authorities/task-tracker/target.js"
import { intentRecordKey, outcomeRecordKey } from "../../orchestrator/src/workflow-journal/record-key.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../orchestrator/src/workflow/task-tracker-facts/observation.js"
import { validSnapshot } from "../../orchestrator/test/task-dag.js"

/** Reintroduces the accepted S10 invalid-history input at the journal boundary, without replacing finality validation. */
export const appendIncomparableChangingGraph = Effect.fn("PublicFinalityFixture.appendIncomparableGraph")(function* (
  journal: Pick<JournalService, "append">,
  runId: RunId,
  target: TrackerTarget,
  beforeDelivery: TaskDagSnapshot
) {
  const rootTaskId = beforeDelivery.rootTaskId
  if (rootTaskId === undefined) return yield* Effect.die("S10 requires an exact tracker root")
  const afterDelivery = validSnapshot({
    ...beforeDelivery.toWire(),
    revision: "public-S10-after-delivery",
    rootTaskId,
    tasks: beforeDelivery
      .toWire()
      .tasks.map((task) => (task.id === rootTaskId ? { ...task, lifecycle: { _tag: "CompletedSuccessfully" } } : task))
  })
  const quiescentIndex = 9
  const changedIndex = 10
  const graphIds = Array.from({ length: changedIndex + 1 }, (_, index) => OperationId.make(`g${index + 1}`))
  for (const [index, operationId] of graphIds.entries()) {
    const predecessor = graphIds[index - 1]
    const operation = makeTrackerGraphObservationOperation(
      index === quiescentIndex && predecessor !== undefined
        ? { _tag: "PostQuiescenceReconfirmation", quiescentGraphOperationId: predecessor }
        : { _tag: "WorkflowEstablishment" },
      operationId,
      target,
      index === quiescentIndex ? graphIds.slice(0, quiescentIndex) : []
    )
    yield* journal.append(runId, intentRecordKey(operationId), taskTrackerReadIntent(operation))
    const snapshot = index === changedIndex ? afterDelivery : beforeDelivery
    const observed = yield* journal.append(
      runId,
      outcomeRecordKey(operationId),
      taskTrackerFactsObservedEvent(operationId, makeCompleteTaskTrackerFactsObserved(operation, snapshot))
    )
    if (index === changedIndex)
      return makeRunFinalityEvidence({
        observedAt: observed.position,
        operationId,
        readShape: operation.readShape,
        rootTaskId,
        runId,
        snapshot,
        target
      })
  }
  return yield* Effect.die("S10 requires its changed g11 observation")
})
