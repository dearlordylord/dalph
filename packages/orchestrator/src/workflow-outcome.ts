import { Schema } from "effect"
import { TaskId, TrackerRevision } from "./domain.js"
import type { TaskDagSnapshot } from "./task-dag.js"

export const WorkflowOutcome = Schema.TaggedUnion({
  TrackerGraphObserved: {
    revision: TrackerRevision,
    taskIds: Schema.Array(TaskId)
  }
})
export type WorkflowOutcome = typeof WorkflowOutcome.Type

export const makeTrackerGraphObservedOutcome = (
  snapshot: TaskDagSnapshot
): typeof WorkflowOutcome.cases.TrackerGraphObserved.Type =>
  WorkflowOutcome.cases.TrackerGraphObserved.make({
    revision: snapshot.revision,
    taskIds: snapshot.topologicalOrder()
  })
