import { Context, Effect, Layer, Schema } from "effect"
import { FixtureTarget, TaskId, TrackerRevision } from "./domain.js"
import { type GraphProjectionError, type TaskDagSnapshot } from "./task-dag.js"
import { TrackerGraphReader, type TrackerReadError } from "./tracker-graph-reader.js"

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

const observedTaskIds = (
  snapshot: TaskDagSnapshot
): ReadonlyArray<TaskId> => snapshot.topologicalOrder()

interface WorkflowInterpreterService {
  readonly execute: (
    operation: WorkflowOperation
  ) => Effect.Effect<WorkflowOutcome, GraphProjectionError | TrackerReadError>
}

export class WorkflowInterpreter extends Context.Service<WorkflowInterpreter, WorkflowInterpreterService>()(
  "@dalph/WorkflowInterpreter"
) {}

export const trackerWorkflowInterpreterLayer = Layer.effect(
  WorkflowInterpreter,
  Effect.gen(function*() {
    const reader = yield* TrackerGraphReader
    const execute = Effect.fn("WorkflowInterpreter.execute")((operation: WorkflowOperation) =>
      WorkflowOperation.match(operation, {
        ReadTrackerGraph: ({ target }) =>
          reader.read(target).pipe(
            Effect.map((snapshot) =>
              WorkflowOutcome.cases.TrackerGraphObserved.make({
                revision: snapshot.revision,
                taskIds: observedTaskIds(snapshot)
              })
            )
          )
      })
    )

    return WorkflowInterpreter.of({ execute })
  })
)

export const TraceItem = Schema.TaggedUnion({
  OperationSelected: { operation: WorkflowOperation },
  OperationOutcomeObserved: {
    operation: WorkflowOperation,
    outcome: WorkflowOutcome
  },
  RunCompleted: {}
})
export type TraceItem = typeof TraceItem.Type

export const runWorkflow = Effect.fn("Workflow.run")(function*(
  target: FixtureTarget
) {
  const interpreter = yield* WorkflowInterpreter
  const operation = WorkflowOperation.cases.ReadTrackerGraph.make({ target })
  const selected = TraceItem.cases.OperationSelected.make({ operation })
  const outcome = yield* interpreter.execute(operation)
  const observed = TraceItem.cases.OperationOutcomeObserved.make({
    operation,
    outcome
  })
  const completed = TraceItem.cases.RunCompleted.make({})

  return [selected, observed, completed] as const
})

export const encodeTraceItem = (item: TraceItem): string => JSON.stringify(Schema.encodeUnknownSync(TraceItem)(item))
