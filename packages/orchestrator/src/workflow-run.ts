import { Effect, Semaphore } from "effect"
import type { TaskWorkCapacity, TrackerTarget } from "./domain.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "./task-work-planning.js"
import { TaskWorkStartRequest } from "./task-work-start.js"
import {
  makeTaskWorkSessionEstablishmentOperation,
  makeTrackerGraphObservationOperation,
  makeTrackerGraphObservedOutcome,
  OperationSelected,
  TaskWorkCapacityReserved,
  TaskWorkSessionEstablishedTrace,
  type TraceItem,
  TrackerGraphOutcomeObserved,
  WorkflowInterpreter,
  WorkflowTrace
} from "./workflow.js"

export const runWorkflow = Effect.fn("Workflow.run")(function*(
  target: TrackerTarget,
  capacity: TaskWorkCapacity
) {
  const allocator = yield* OperationIdAllocator
  const interpreter = yield* WorkflowInterpreter
  const planner = yield* PlannedTaskAttemptPlanner
  const trace = yield* WorkflowTrace
  const graphOperation = makeTrackerGraphObservationOperation(
    yield* allocator.allocate(),
    target
  )
  yield* trace.emit(OperationSelected.make({ operation: graphOperation }))
  const snapshot = yield* interpreter.readTrackerGraph(graphOperation)
  yield* trace.emit(TrackerGraphOutcomeObserved.make({
    operation: graphOperation,
    outcome: makeTrackerGraphObservedOutcome(snapshot)
  }))

  const traceEmission = yield* Semaphore.make(1)
  const emit = (item: TraceItem) => traceEmission.withPermit(trace.emit(item))
  yield* Effect.forEach(
    snapshot.eligibleTasks(),
    Effect.fn("Workflow.establishRunnableTaskSession")(function*(task) {
      const currentGraphOperation = makeTrackerGraphObservationOperation(
        yield* allocator.allocate(),
        target
      )
      yield* emit(OperationSelected.make({ operation: currentGraphOperation }))
      const currentSnapshot = yield* interpreter.readTrackerGraph(currentGraphOperation)
      yield* emit(TrackerGraphOutcomeObserved.make({
        operation: currentGraphOperation,
        outcome: makeTrackerGraphObservedOutcome(currentSnapshot)
      }))
      const currentTask = currentSnapshot.eligibleTasks().find(
        (candidate) => candidate.id === task.id
      )
      if (currentTask === undefined) return

      const plannedAttempt = yield* planner.plan(currentTask)
      const request = TaskWorkStartRequest.make({
        operationId: yield* allocator.allocate(),
        plannedAttempt,
        task: currentTask
      })
      const operation = makeTaskWorkSessionEstablishmentOperation({
        predecessorOperationIds: [currentGraphOperation.operationId],
        request
      })
      yield* emit(TaskWorkCapacityReserved.make({ operation }))
      yield* emit(OperationSelected.make({ operation }))
      const outcome = yield* interpreter.establishTaskWorkSession(operation)
      yield* emit(TaskWorkSessionEstablishedTrace.make({ operation, outcome }))
    }),
    { concurrency: capacity, discard: true }
  )
})
