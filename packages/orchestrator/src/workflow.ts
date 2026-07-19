import { Context, Effect, Layer, Schema } from "effect"
import type { TaskExecutionCapacity } from "./domain.js"
import { FixtureTarget, TaskId, TrackerRevision } from "./domain.js"
import { type GraphProjectionError, type TaskDagSnapshot } from "./task-dag.js"
import { TaskExecution } from "./task-execution.js"
import { TrackerGraphReader, type TrackerReadError } from "./tracker-graph-reader.js"

export const WorkflowOperation = Schema.TaggedUnion({
  ReadTrackerGraph: { target: FixtureTarget },
  ExecuteTask: { taskId: TaskId }
})
export type WorkflowOperation = typeof WorkflowOperation.Type

export const WorkflowOutcome = Schema.TaggedUnion({
  TrackerGraphObserved: {
    revision: TrackerRevision,
    taskIds: Schema.Array(TaskId),
    runnableTaskIds: Schema.Array(TaskId)
  },
  TaskExecuted: { taskId: TaskId }
})
export type WorkflowOutcome = typeof WorkflowOutcome.Type

const observedTaskIds = (
  snapshot: TaskDagSnapshot
): ReadonlyArray<TaskId> => snapshot.topologicalOrder()

interface WorkflowInterpreterService {
  readonly readTrackerGraph: (
    target: FixtureTarget
  ) => Effect.Effect<
    typeof WorkflowOutcome.cases.TrackerGraphObserved.Type,
    GraphProjectionError | TrackerReadError
  >
  readonly executeTask: (
    taskId: TaskId
  ) => Effect.Effect<typeof WorkflowOutcome.cases.TaskExecuted.Type>
}

export class WorkflowInterpreter extends Context.Service<WorkflowInterpreter, WorkflowInterpreterService>()(
  "@dalph/WorkflowInterpreter"
) {}

export const trackerWorkflowInterpreterLayer = Layer.effect(
  WorkflowInterpreter,
  Effect.gen(function*() {
    const reader = yield* TrackerGraphReader
    const taskExecution = yield* TaskExecution
    const readTrackerGraph = Effect.fn(
      "WorkflowInterpreter.readTrackerGraph"
    )(function*(target: FixtureTarget) {
      const snapshot = yield* reader.read(target)
      return WorkflowOutcome.cases.TrackerGraphObserved.make({
        revision: snapshot.revision,
        taskIds: observedTaskIds(snapshot),
        runnableTaskIds: snapshot.eligibleTaskIds()
      })
    })
    const executeTask = Effect.fn("WorkflowInterpreter.executeTask")(function*(
      taskId: TaskId
    ) {
      yield* taskExecution.execute(taskId)
      return WorkflowOutcome.cases.TaskExecuted.make({ taskId })
    })

    return WorkflowInterpreter.of({ executeTask, readTrackerGraph })
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
  target: FixtureTarget,
  capacity: TaskExecutionCapacity
) {
  const interpreter = yield* WorkflowInterpreter
  const operation = WorkflowOperation.cases.ReadTrackerGraph.make({ target })
  const selected = TraceItem.cases.OperationSelected.make({ operation })
  const outcome = yield* interpreter.readTrackerGraph(target)
  const observed = TraceItem.cases.OperationOutcomeObserved.make({
    operation,
    outcome
  })
  const executionTraces = yield* Effect.forEach(
    outcome.runnableTaskIds,
    (taskId) => {
      const executeOperation = WorkflowOperation.cases.ExecuteTask.make({ taskId })
      return interpreter.executeTask(taskId).pipe(
        Effect.map((executionOutcome) =>
          [
            TraceItem.cases.OperationSelected.make({ operation: executeOperation }),
            TraceItem.cases.OperationOutcomeObserved.make({
              operation: executeOperation,
              outcome: executionOutcome
            })
          ] as const
        )
      )
    },
    { concurrency: capacity }
  )
  const completed = TraceItem.cases.RunCompleted.make({})

  return [selected, observed, ...executionTraces.flat(), completed] as const
})

export const encodeTraceItem = (item: TraceItem): string => JSON.stringify(Schema.encodeUnknownSync(TraceItem)(item))
