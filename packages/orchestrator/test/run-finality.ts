import { TaskId, type RunId } from "@dalph/contracts"
import { validSnapshot } from "./task-dag.js"
import type { TrackerTarget } from "../src/authorities/task-tracker/target.js"
import { makeRunFinalityEvidence } from "../src/coordination/frontier/run-finality.js"
import { OperationId } from "../src/workflow/identity.js"
import { taskTrackerReadIntent } from "../src/workflow/registry/event.js"
import { makeTrackerGraphObservationOperation } from "../src/workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../src/workflow/task-tracker-facts/observation.js"
import { JournalPosition } from "../src/workflow-journal/identity.js"

/** One schema-valid completed graph read and the exact evidence derived from it. */
export const completedRunFinalityFixture = (input: {
  readonly runId: RunId
  readonly target: TrackerTarget
  readonly observedAt?: JournalPosition
}) => {
  const observedJournalPosition = 3
  const operation = makeTrackerGraphObservationOperation(
    OperationId.make(`completed-finality:${input.runId}`),
    input.target
  )
  const snapshot = validSnapshot({
    revision: `completed-finality:${input.runId}`,
    rootTaskId: "root",
    tasks: [{ id: "root", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  const observedAt = input.observedAt ?? JournalPosition.make(observedJournalPosition)
  return {
    evidence: makeRunFinalityEvidence({
      observedAt,
      operationId: operation.operationId,
      readShape: operation.readShape,
      rootTaskId: TaskId.make("root"),
      runId: input.runId,
      snapshot,
      target: input.target
    }),
    intent: taskTrackerReadIntent(operation),
    observation: taskTrackerFactsObservedEvent(
      operation.operationId,
      makeCompleteTaskTrackerFactsObserved(operation, snapshot)
    ),
    operation
  }
}
