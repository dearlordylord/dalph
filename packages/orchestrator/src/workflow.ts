import { Effect, Schema } from "effect"
import { FixtureTarget, TaskId, TrackerRevision, type TrackerSnapshot } from "./domain.js"
import { TrackerGraphReader } from "./tracker-graph-reader.js"

export const WorkflowOperation = Schema.TaggedUnion({
  ReadTrackerGraph: { target: FixtureTarget }
})
export type WorkflowOperation = typeof WorkflowOperation.Type

export const WorkflowOutcome = Schema.TaggedUnion({
  TrackerGraphObserved: {
    revision: TrackerRevision,
    taskIds: Schema.Array(TaskId)
  }
})
export type WorkflowOutcome = typeof WorkflowOutcome.Type

export const TraceItem = Schema.TaggedUnion({
  OperationSelected: { operation: WorkflowOperation },
  OperationOutcomeObserved: {
    operation: WorkflowOperation,
    outcome: WorkflowOutcome
  },
  RunCompleted: {}
})
export type TraceItem = typeof TraceItem.Type

const observedTaskIds = (snapshot: TrackerSnapshot): ReadonlyArray<TaskId> => snapshot.tasks.map((task) => task.id)

export const runDryWorkflow = Effect.fn("Workflow.runDry")(function*(
  target: FixtureTarget
) {
  const reader = yield* TrackerGraphReader
  const operation = WorkflowOperation.cases.ReadTrackerGraph.make({ target })
  const selected = TraceItem.cases.OperationSelected.make({ operation })
  const snapshot = yield* reader.read(target)
  const taskIds = observedTaskIds(snapshot)
  const outcome = WorkflowOutcome.cases.TrackerGraphObserved.make({
    revision: snapshot.revision,
    taskIds
  })
  const observed = TraceItem.cases.OperationOutcomeObserved.make({
    operation,
    outcome
  })
  const completed = TraceItem.cases.RunCompleted.make({})

  return [selected, observed, completed] as const
})

export const encodeTraceItem = (item: TraceItem): string => JSON.stringify(Schema.encodeUnknownSync(TraceItem)(item))
