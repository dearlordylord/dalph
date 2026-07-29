import { Option } from "effect"
import { TaskLifecycle, type TaskId, type TrackerRevision } from "../src/domain.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent,
  type TaskTrackerFactsObservedEvent
} from "../src/task-tracker-facts.js"
import { projectTrackerSnapshot } from "../src/task-dag.js"
import type { WorkflowOperation } from "../src/workflow-operation.js"

/** Builds complete canonical facts for flat history fixtures. */
export const taskTrackerGraphFactsObserved = (
  operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type,
  outcome: { readonly revision: TrackerRevision; readonly taskIds: ReadonlyArray<TaskId> }
): TaskTrackerFactsObservedEvent => {
  const projection = projectTrackerSnapshot({
    revision: outcome.revision,
    tasks: [...new Set(outcome.taskIds)].map((id) => ({
      id,
      lifecycle: TaskLifecycle.cases.Open.make({}),
      parentTaskId: null,
      prerequisiteIds: []
    }))
  })
  const snapshot = Option.getOrThrow(projection._tag === "Valid" ? Option.some(projection.snapshot) : Option.none())
  return taskTrackerFactsObservedEvent(operation.operationId, makeCompleteTaskTrackerFactsObserved(operation, snapshot))
}
