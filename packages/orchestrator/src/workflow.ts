import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import type { CoordinatorOwnershipError } from "./coordinator-lock.js"
import type { TaskExecutionCapacity, TrackerTarget } from "./domain.js"
import { OperationId, TaskId, TrackerRevision, TrackerTarget as TrackerTargetSchema } from "./domain.js"
import type { JournalReconciliationRequired, JournalStoreContradiction, JournalStoreError } from "./journal-store.js"
import { type GraphProjectionError, type TaskDagSnapshot } from "./task-dag.js"
import { TaskWorkStart } from "./task-work-start.js"
import { TraceOutput, type TraceOutputError } from "./trace-output.js"
import {
  type FixtureReadError,
  type TrackerAdapterReadError,
  TrackerGraphReader,
  type TrackerReadError
} from "./tracker-graph-reader.js"

export const WorkflowOperation = Schema.TaggedUnion({
  ReadTrackerGraph: {
    operationId: OperationId,
    predecessorOperationIds: Schema.Array(OperationId),
    target: TrackerTargetSchema
  },
  ExecuteTask: {
    operationId: OperationId,
    predecessorOperationIds: Schema.Array(OperationId),
    taskId: TaskId
  }
})
export type WorkflowOperation = typeof WorkflowOperation.Type

// These deterministic fixture identities are only the issue #39 seam. Before
// controlled mutations are implemented, issue #41 must use Wayfinder to
// specify allocation and lifetime: an unresolved operation keeps its identity,
// while a genuinely new operation receives a distinct one.
// https://github.com/dearlordylord/dalph/issues/39
// https://github.com/dearlordylord/dalph/issues/41
const trackerGraphObservationOperationId = OperationId.make(
  "observe-tracker-graph"
)

export const makeTrackerGraphObservationOperation = (
  target: TrackerTarget
): typeof WorkflowOperation.cases.ReadTrackerGraph.Type =>
  WorkflowOperation.cases.ReadTrackerGraph.make({
    operationId: trackerGraphObservationOperationId,
    predecessorOperationIds: [],
    target
  })

export const makeTaskExecutionOperation = (
  taskId: TaskId,
  predecessorOperationId: OperationId
): typeof WorkflowOperation.cases.ExecuteTask.Type =>
  WorkflowOperation.cases.ExecuteTask.make({
    operationId: OperationId.make(`task-execution:${taskId}`),
    predecessorOperationIds: [predecessorOperationId],
    taskId
  })

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

export const makeTrackerGraphObservedOutcome = (
  snapshot: TaskDagSnapshot
): typeof WorkflowOutcome.cases.TrackerGraphObserved.Type =>
  WorkflowOutcome.cases.TrackerGraphObserved.make({
    revision: snapshot.revision,
    taskIds: observedTaskIds(snapshot)
  })

interface WorkflowInterpreterService {
  readonly readTrackerGraph: (
    operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type
  ) => Effect.Effect<
    TaskDagSnapshot,
    | FixtureReadError
    | GraphProjectionError
    | JournalStoreContradiction
    | JournalReconciliationRequired
    | JournalStoreError
    | TrackerAdapterReadError
    | TrackerReadError
  >
  readonly executeTask: (
    operation: typeof WorkflowOperation.cases.ExecuteTask.Type
  ) => Effect.Effect<
    typeof WorkflowOutcome.cases.TaskExecuted.Type,
    | JournalReconciliationRequired
    | JournalStoreContradiction
    | JournalStoreError
    | CoordinatorOwnershipError
  >
}

export class WorkflowInterpreter extends Context.Service<WorkflowInterpreter, WorkflowInterpreterService>()(
  "@dalph/WorkflowInterpreter"
) {}

type TrackerGraphReadError =
  | FixtureReadError
  | GraphProjectionError
  | TrackerAdapterReadError
  | TrackerReadError

const makeTaskWorkStartingWorkflowInterpreter = (
  operationPrefix: "LiveFake" | "DeterministicTest",
  read: (
    target: TrackerTarget
  ) => Effect.Effect<TaskDagSnapshot, TrackerGraphReadError>,
  request: (
    taskId: TaskId
  ) => Effect.Effect<void, CoordinatorOwnershipError>
) => {
  const readTrackerGraph = Effect.fn(
    `WorkflowInterpreter.${operationPrefix}.readTrackerGraph`
  )(function*(operation) {
    return yield* read(operation.target)
  })
  const executeTask = Effect.fn(
    `WorkflowInterpreter.${operationPrefix}.executeTask`
  )(function*(operation) {
    yield* request(operation.taskId)
    return WorkflowOutcome.cases.TaskExecuted.make({})
  })

  return WorkflowInterpreter.of({ executeTask, readTrackerGraph })
}

const taskWorkStartingWorkflowInterpreterLayer = (
  operationPrefix: "LiveFake" | "DeterministicTest"
) =>
  Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function*() {
      const reader = yield* TrackerGraphReader
      const taskWorkStart = yield* TaskWorkStart
      return makeTaskWorkStartingWorkflowInterpreter(
        operationPrefix,
        reader.read,
        taskWorkStart.request
      )
    })
  )

export const liveFakeWorkflowInterpreterLayer = taskWorkStartingWorkflowInterpreterLayer("LiveFake")

export const deterministicTestWorkflowInterpreterLayer = taskWorkStartingWorkflowInterpreterLayer("DeterministicTest")

/** Records intent to invoke a workflow operation; it is not execution admission. */
export const OperationSelected = Schema.TaggedStruct("OperationSelected", {
  operation: WorkflowOperation
})
export type OperationSelected = typeof OperationSelected.Type

/**
 * Records the graph result after the tracker-read capability is observed. It
 * is not tracker execution admission, task admission, or deterministic graph
 * presentation order.
 */
export const TrackerGraphOutcomeObserved = Schema.TaggedStruct(
  "TrackerGraphOutcomeObserved",
  {
    operation: WorkflowOperation.cases.ReadTrackerGraph,
    outcome: WorkflowOutcome.cases.TrackerGraphObserved
  }
)
export type TrackerGraphOutcomeObserved = typeof TrackerGraphOutcomeObserved.Type

/**
 * Records the tracker-owned admission of a task into execution scope. This is
 * neither coordinator capacity admission nor execution-substrate start.
 */
export const TrackerExecutionAdmitted = Schema.TaggedStruct(
  "TrackerExecutionAdmitted",
  { operation: WorkflowOperation.cases.ExecuteTask }
)
export type TrackerExecutionAdmitted = typeof TrackerExecutionAdmitted.Type

/**
 * Records that bounded coordinator capacity admitted a task execution. It is
 * neither tracker admission nor evidence that an execution substrate started.
 */
export const TaskExecutionAdmitted = Schema.TaggedStruct(
  "TaskExecutionAdmitted",
  { operation: WorkflowOperation.cases.ExecuteTask }
)
export type TaskExecutionAdmitted = typeof TaskExecutionAdmitted.Type

/**
 * Records an execution-substrate observation that execution began. Invocation
 * of the controlled fixture capability alone cannot establish this fact.
 */
export const TaskExecutionStarted = Schema.TaggedStruct(
  "TaskExecutionStarted",
  { operation: WorkflowOperation.cases.ExecuteTask }
)
export type TaskExecutionStarted = typeof TaskExecutionStarted.Type

/**
 * Records a task capability outcome when it is actually observed. Its position
 * is observation order, not deterministic task presentation order.
 */
export const TaskExecutionOutcomeObserved = Schema.TaggedStruct(
  "TaskExecutionOutcomeObserved",
  {
    operation: WorkflowOperation.cases.ExecuteTask,
    outcome: WorkflowOutcome.cases.TaskExecuted
  }
)
export type TaskExecutionOutcomeObserved = typeof TaskExecutionOutcomeObserved.Type

export const TraceItem = Schema.Union([
  OperationSelected,
  TrackerGraphOutcomeObserved,
  TrackerExecutionAdmitted,
  TaskExecutionAdmitted,
  TaskExecutionStarted,
  TaskExecutionOutcomeObserved
])
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
  target: TrackerTarget,
  capacity: TaskExecutionCapacity
) {
  const interpreter = yield* WorkflowInterpreter
  const trace = yield* WorkflowTrace
  const operation = makeTrackerGraphObservationOperation(target)
  const selected = OperationSelected.make({ operation })
  yield* trace.emit(selected)
  const snapshot = yield* interpreter.readTrackerGraph(operation)
  const outcome = makeTrackerGraphObservedOutcome(snapshot)
  const observed = TrackerGraphOutcomeObserved.make({
    operation,
    outcome
  })
  yield* trace.emit(observed)
  // Eligibility owns a deterministic comparison projection; trace emission
  // continues to preserve the independent order in which outcomes are observed.
  const taskAdmissionOrder = snapshot.eligibleTaskIds()
  // This process-local semaphore is presentation backpressure, not durable
  // workflow history. A future live projector reconstructs order from committed
  // journal positions rather than persisting this coordination state.
  const traceEmission = yield* Semaphore.make(1)
  const emitTaskTrace = Effect.fn("Workflow.emitTaskTrace")((item: TraceItem) =>
    traceEmission.withPermit(trace.emit(item))
  )
  yield* Effect.forEach(
    taskAdmissionOrder,
    Effect.fn("Workflow.executeRunnableTask")(function*(taskId) {
      // Entering this capacity-bounded callback is task-execution admission:
      // one slot is already held, the event is acknowledged next, and only
      // then may the injected execution capability begin.
      const executeOperation = makeTaskExecutionOperation(
        taskId,
        operation.operationId
      )
      yield* emitTaskTrace(
        TaskExecutionAdmitted.make({ operation: executeOperation })
      )
      const executionOutcome = yield* interpreter.executeTask(executeOperation)
      yield* emitTaskTrace(
        TaskExecutionOutcomeObserved.make({
          operation: executeOperation,
          outcome: executionOutcome
        })
      )
    }),
    { concurrency: capacity, discard: true }
  )
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
