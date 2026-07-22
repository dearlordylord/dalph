import { Schema } from "effect"
import { OperationId, TaskId, TaskWorkSessionId, TaskWorkSessionLocator, TrackerRevision } from "./domain.js"
import type { TaskDagSnapshot } from "./task-dag.js"

export const WorkflowOutcome = Schema.TaggedUnion({
  TrackerGraphObserved: {
    revision: TrackerRevision,
    taskIds: Schema.Array(TaskId)
  },
  TaskWorkSessionEstablished: {
    operationId: OperationId,
    sessionId: TaskWorkSessionId
  },
  /** A pure plan projection that makes no claim about provider state. */
  TaskWorkSessionEstablishmentSimulated: {
    operationId: OperationId,
    session: TaskWorkSessionLocator
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
