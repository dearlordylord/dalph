import { Effect, Semaphore } from "effect"
import type { TaskWorkCapacity, TrackerTarget } from "./domain.js"
import { TaskClaimAcquisitionPlanner } from "./task-claim-planning.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "./task-work-planning.js"
import { TaskWorkStartRequest } from "./task-work-start.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTrackerGraphObservationOperation,
  makeTrackerGraphObservedOutcome,
  OperationSelected,
  TaskClaimAcquiredTrace,
  TaskClaimAcquisitionIntended,
  TaskExecutionAdmitted,
  TaskWorkSessionEstablishedTrace,
  type TraceItem,
  TrackerExecutionAdmitted,
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
  const claimPlanner = yield* TaskClaimAcquisitionPlanner
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

      const claimOperationId = yield* allocator.allocate()
      const claimOperation = makeTaskClaimAcquisitionOperation({
        acquisition: yield* claimPlanner.plan(claimOperationId, currentTask.id),
        predecessorOperationIds: [currentGraphOperation.operationId]
      })
      yield* emit(OperationSelected.make({ operation: claimOperation }))
      yield* emit(TaskClaimAcquisitionIntended.make({ operation: claimOperation }))
      const claimResult = yield* interpreter.acquireTaskClaim(claimOperation)
      let taskForAttempt = currentTask
      let taskPredecessorOperationId = currentGraphOperation.operationId
      if (claimResult._tag === "AuthoritativeTaskClaimAcquired") {
        yield* emit(TaskClaimAcquiredTrace.make({
          claim: claimResult.claim,
          operation: claimOperation
        }))
        const admissionObservation = makeTrackerGraphObservationOperation(
          yield* allocator.allocate(),
          target,
          [claimOperation.acquisition.operationId]
        )
        yield* emit(OperationSelected.make({ operation: admissionObservation }))
        const admissionSnapshot = yield* interpreter.readTrackerGraph(
          admissionObservation
        )
        yield* emit(TrackerGraphOutcomeObserved.make({
          operation: admissionObservation,
          outcome: makeTrackerGraphObservedOutcome(admissionSnapshot)
        }))
        const admittedTask = admissionSnapshot.eligibleTasks().find(
          (candidate) => candidate.id === currentTask.id
        )
        if (admittedTask === undefined) return
        yield* emit(TrackerExecutionAdmitted.make({
          claimOperation,
          observationOperation: admissionObservation
        }))
        taskForAttempt = admittedTask
        taskPredecessorOperationId = admissionObservation.operationId
      }

      const plannedAttempt = yield* planner.plan(taskForAttempt)
      const request = TaskWorkStartRequest.make({
        operationId: yield* allocator.allocate(),
        plannedAttempt,
        task: taskForAttempt
      })
      const operation = makeTaskWorkSessionEstablishmentOperation({
        predecessorOperationIds: [taskPredecessorOperationId],
        request
      })
      yield* emit(TaskExecutionAdmitted.make({ operation }))
      yield* emit(OperationSelected.make({ operation }))
      const outcome = yield* interpreter.establishTaskWorkSession(operation)
      yield* emit(TaskWorkSessionEstablishedTrace.make({ operation, outcome }))
    }),
    { concurrency: capacity, discard: true }
  )
})
