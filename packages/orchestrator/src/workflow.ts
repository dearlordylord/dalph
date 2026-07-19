import { Context, Effect, Layer, Schema } from "effect"
import { CapabilityAudit } from "./capability-audit.js"
import type { TaskExecutionCapacity } from "./domain.js"
import { FixtureTarget, TaskId, TrackerRevision } from "./domain.js"
import { type GraphProjectionError, type TaskDagSnapshot } from "./task-dag.js"
import { TaskExecution } from "./task-execution.js"
import { TraceOutput, type TraceOutputError } from "./trace-output.js"
import { TrackerGraphReader, type TrackerReadError } from "./tracker-graph-reader.js"

export const WorkflowOperation = Schema.TaggedUnion({
  ReadTrackerGraph: { target: FixtureTarget },
  ExecuteTask: { taskId: TaskId }
})
export type WorkflowOperation = typeof WorkflowOperation.Type

export const WorkflowOutcome = Schema.TaggedUnion({
  TrackerGraphObserved: {
    revision: TrackerRevision,
    taskIds: Schema.Array(TaskId)
  },
  TaskExecuted: {}
})
export type WorkflowOutcome = typeof WorkflowOutcome.Type

const observedTaskIds = (
  snapshot: TaskDagSnapshot
): ReadonlyArray<TaskId> => snapshot.topologicalOrder()

interface WorkflowInterpreterService {
  readonly readTrackerGraph: (
    target: FixtureTarget
  ) => Effect.Effect<TaskDagSnapshot, GraphProjectionError | TrackerReadError>
  readonly executeTask: (
    taskId: TaskId
  ) => Effect.Effect<typeof WorkflowOutcome.cases.TaskExecuted.Type>
}

export class WorkflowInterpreter extends Context.Service<WorkflowInterpreter, WorkflowInterpreterService>()(
  "@dalph/WorkflowInterpreter"
) {}

const taskExecutingWorkflowInterpreterLayer = (
  operationPrefix: "LiveFake" | "DeterministicTest"
) =>
  Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function*() {
      const audit = yield* CapabilityAudit
      const reader = yield* TrackerGraphReader
      const taskExecution = yield* TaskExecution
      const readTrackerGraph = Effect.fn(
        `WorkflowInterpreter.${operationPrefix}.readTrackerGraph`
      )(function*(target: FixtureTarget) {
        yield* audit.trackerGraphRead()
        return yield* reader.read(target)
      })
      const executeTask = Effect.fn(
        `WorkflowInterpreter.${operationPrefix}.executeTask`
      )(function*(taskId: TaskId) {
        yield* audit.writeAttempted("Process")
        yield* taskExecution.execute(taskId)
        return WorkflowOutcome.cases.TaskExecuted.make({})
      })

      return WorkflowInterpreter.of({ executeTask, readTrackerGraph })
    })
  )

export const liveFakeWorkflowInterpreterLayer = taskExecutingWorkflowInterpreterLayer("LiveFake")

export const deterministicTestWorkflowInterpreterLayer = taskExecutingWorkflowInterpreterLayer("DeterministicTest")

export const trackerWorkflowInterpreterLayer = liveFakeWorkflowInterpreterLayer

export const dryRunWorkflowInterpreterLayer: Layer.Layer<
  WorkflowInterpreter,
  never,
  CapabilityAudit | TrackerGraphReader
> = Layer.effect(
  WorkflowInterpreter,
  Effect.gen(function*() {
    const audit = yield* CapabilityAudit
    const reader = yield* TrackerGraphReader
    const readTrackerGraph = Effect.fn(
      "WorkflowInterpreter.DryRun.readTrackerGraph"
    )(function*(target: FixtureTarget) {
      yield* audit.trackerGraphRead()
      return yield* reader.read(target)
    })
    const executeTask = Effect.fn("WorkflowInterpreter.DryRun.executeTask")(function*(
      taskId: TaskId
    ) {
      yield* Effect.succeed(taskId)
      return WorkflowOutcome.cases.TaskExecuted.make({})
    })

    return WorkflowInterpreter.of({ executeTask, readTrackerGraph })
  })
)

export const TraceItem = Schema.TaggedUnion({
  OperationSelected: { operation: WorkflowOperation },
  TrackerGraphOutcomeObserved: {
    operation: WorkflowOperation.cases.ReadTrackerGraph,
    outcome: WorkflowOutcome.cases.TrackerGraphObserved
  },
  TaskExecutionOutcomeObserved: {
    operation: WorkflowOperation.cases.ExecuteTask,
    outcome: WorkflowOutcome.cases.TaskExecuted
  },
  RunCompleted: {}
})
export type TraceItem = typeof TraceItem.Type

const SemanticTrace = Schema.Array(TraceItem)

export const semanticTrace = (
  items: ReadonlyArray<TraceItem>
): ReadonlyArray<TraceItem> =>
  Schema.decodeUnknownSync(SemanticTrace)(
    Schema.encodeUnknownSync(SemanticTrace)(items)
  )

interface WorkflowTraceService {
  readonly emit: (item: TraceItem) => Effect.Effect<void, TraceOutputError>
}

export class WorkflowTrace extends Context.Service<WorkflowTrace, WorkflowTraceService>()(
  "@dalph/WorkflowTrace"
) {}

export const runWorkflow = Effect.fn("Workflow.run")(function*(
  target: FixtureTarget,
  capacity: TaskExecutionCapacity
) {
  const interpreter = yield* WorkflowInterpreter
  const trace = yield* WorkflowTrace
  const operation = WorkflowOperation.cases.ReadTrackerGraph.make({ target })
  const selected = TraceItem.cases.OperationSelected.make({ operation })
  yield* trace.emit(selected)
  const snapshot = yield* interpreter.readTrackerGraph(target)
  const outcome = WorkflowOutcome.cases.TrackerGraphObserved.make({
    revision: snapshot.revision,
    taskIds: observedTaskIds(snapshot)
  })
  const observed = TraceItem.cases.TrackerGraphOutcomeObserved.make({
    operation,
    outcome
  })
  yield* trace.emit(observed)
  const executionObservations = yield* Effect.forEach(
    snapshot.eligibleTaskIds(),
    Effect.fn("Workflow.executeRunnableTask")(function*(taskId) {
      const executeOperation = WorkflowOperation.cases.ExecuteTask.make({ taskId })
      yield* trace.emit(
        TraceItem.cases.OperationSelected.make({ operation: executeOperation })
      )
      const executionOutcome = yield* interpreter.executeTask(taskId)
      return TraceItem.cases.TaskExecutionOutcomeObserved.make({
        operation: executeOperation,
        outcome: executionOutcome
      })
    }),
    { concurrency: capacity }
  )
  yield* Effect.forEach(executionObservations, trace.emit, { discard: true })
  const completed = TraceItem.cases.RunCompleted.make({})
  yield* trace.emit(completed)
})

export const encodeTraceItem = (item: TraceItem): string => JSON.stringify(Schema.encodeUnknownSync(TraceItem)(item))

export const workflowTraceOutputLayer = Layer.effect(
  WorkflowTrace,
  Effect.gen(function*() {
    const output = yield* TraceOutput
    const emit = Effect.fn("WorkflowTrace.Output.emit")(function*(item: TraceItem) {
      yield* output.writeLine(encodeTraceItem(item))
    })

    return WorkflowTrace.of({ emit })
  })
)
