import { Effect, Semaphore } from "effect"
import type { TaskWorkCapacity, TrackerTarget } from "./domain.js"
import { TaskAttemptPlanAcknowledged, TaskAttemptPlanRecordingSimulated } from "./task-attempt-plan-recording.js"
import { TaskClaimAcquisitionPlanner } from "./task-claim-planning.js"
import { taskRevisionFor } from "./task-dag.js"
import {
  TaskExecutionAdmitted,
  TaskExecutionOutcomeObserved,
  TaskExecutionSimulated,
  TaskWorkSessionEstablishmentSimulatedTrace
} from "./task-execution-trace.js"
import { TaskExecutionRequest, TaskExecutionSessionBinding } from "./task-execution.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "./task-work-planning.js"
import { TaskWorkStartRequest } from "./task-work-start.js"
import { TaskWorktreeExecutionModeContradiction } from "./task-worktree-reconciliation.js"
import {
  ImplementationEvidenceSealingSimulatedTrace,
  makeImplementationEvidenceSealingOperation,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskExecutionOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  makeTrackerGraphObservedOutcome,
  OperationSelected,
  SealedImplementationEvidenceTrace,
  TaskClaimAcquiredTrace,
  TaskClaimAcquisitionIntended,
  TaskWorkSessionEstablishedTrace,
  TaskWorktreeReadyTrace,
  TaskWorktreeReconciliationSimulatedTrace,
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

      const plannedAttempt = yield* planner.plan(
        taskForAttempt,
        taskRevisionFor(taskForAttempt)
      )
      const planOperation = makeTaskAttemptPlanOperation({
        operationId: yield* allocator.allocate(),
        plannedAttempt,
        predecessorOperationIds: [taskPredecessorOperationId]
      })
      yield* emit(OperationSelected.make({ operation: planOperation }))
      const planResult = yield* interpreter.recordTaskAttemptPlan(planOperation)
      yield* emit(
        planResult._tag === "TaskAttemptPlanRecordAcknowledged"
          ? TaskAttemptPlanAcknowledged.make({ operation: planOperation })
          : TaskAttemptPlanRecordingSimulated.make({ operation: planOperation })
      )
      const worktreeOperation = makeTaskWorktreeReconciliationOperation({
        operationId: yield* allocator.allocate(),
        plannedAttempt,
        predecessorOperationIds: [planOperation.operationId]
      })
      yield* emit(OperationSelected.make({ operation: worktreeOperation }))
      const worktreeResult = yield* interpreter.reconcileTaskWorktree(
        worktreeOperation
      )
      yield* emit(
        worktreeResult._tag === "AuthoritativeTaskWorktreeReady"
          ? TaskWorktreeReadyTrace.make({
            operation: worktreeOperation,
            proof: worktreeResult.proof
          })
          : TaskWorktreeReconciliationSimulatedTrace.make({
            operation: worktreeOperation
          })
      )
      const request = TaskWorkStartRequest.make({
        operationId: yield* allocator.allocate(),
        plannedAttempt,
        task: taskForAttempt
      })
      const operation = makeTaskWorkSessionEstablishmentOperation({
        predecessorOperationIds: [
          planOperation.operationId,
          worktreeOperation.operationId
        ],
        request
      })
      yield* emit(OperationSelected.make({ operation }))
      if (
        planResult._tag === "TaskAttemptPlanRecordAcknowledged"
        && worktreeResult._tag === "AuthoritativeTaskWorktreeReady"
      ) {
        const outcome = yield* interpreter.establishTaskWorkSession(operation)
        yield* emit(TaskWorkSessionEstablishedTrace.make({ operation, outcome }))
        const executionOperation = makeTaskExecutionOperation({
          predecessorOperationIds: [operation.request.operationId],
          request: TaskExecutionRequest.make({
            operationId: yield* allocator.allocate(),
            plannedAttempt,
            session: TaskExecutionSessionBinding.cases.EstablishedSession.make({
              sessionId: outcome.sessionId
            }),
            task: taskForAttempt
          })
        })
        yield* emit(OperationSelected.make({ operation: executionOperation }))
        yield* emit(TaskExecutionAdmitted.make({ operation: executionOperation }))
        const executionOutcome = yield* interpreter.executeTaskWork(executionOperation)
        yield* emit(TaskExecutionOutcomeObserved.make({
          operation: executionOperation,
          outcome: executionOutcome
        }))
        if (executionOutcome.outcome._tag === "Succeeded") {
          const evidenceOperation = makeImplementationEvidenceSealingOperation({
            operationId: yield* allocator.allocate(),
            execution: { _tag: "SuccessfulExecution", outcome: executionOutcome.outcome },
            plannedAttempt
          })
          yield* emit(OperationSelected.make({ operation: evidenceOperation }))
          const sealed = yield* interpreter.sealImplementationEvidence(evidenceOperation)
          if (sealed._tag !== "SealedImplementationEvidence") {
            return yield* new TaskWorktreeExecutionModeContradiction({
              operationId: evidenceOperation.operationId
            })
          }
          yield* emit(SealedImplementationEvidenceTrace.make({ operation: evidenceOperation, sealed }))
        }
      } else if (
        planResult._tag === "TaskAttemptPlanRecordingSimulated"
        && worktreeResult._tag === "TaskWorktreeReconciliationSimulated"
      ) {
        const outcome = yield* interpreter.simulateTaskWorkSession(operation)
        yield* emit(
          TaskWorkSessionEstablishmentSimulatedTrace.make({ operation, outcome })
        )
        const executionOperation = makeTaskExecutionOperation({
          predecessorOperationIds: [operation.request.operationId],
          request: TaskExecutionRequest.make({
            operationId: yield* allocator.allocate(),
            plannedAttempt,
            session: TaskExecutionSessionBinding.cases.PlannedSession.make({
              session: outcome.session
            }),
            task: taskForAttempt
          })
        })
        yield* emit(OperationSelected.make({ operation: executionOperation }))
        yield* emit(TaskExecutionAdmitted.make({ operation: executionOperation }))
        const executionOutcome = yield* interpreter.simulateTaskExecution(executionOperation)
        yield* emit(TaskExecutionSimulated.make({
          operation: executionOperation,
          outcome: executionOutcome
        }))
        const evidenceOperation = makeImplementationEvidenceSealingOperation({
          operationId: yield* allocator.allocate(),
          execution: {
            _tag: "SimulatedExecution",
            predecessorOperationId: executionOperation.request.operationId
          },
          plannedAttempt
        })
        yield* emit(OperationSelected.make({ operation: evidenceOperation }))
        const simulation = yield* interpreter.sealImplementationEvidence(evidenceOperation)
        if (simulation._tag === "SealedImplementationEvidence") {
          return yield* new TaskWorktreeExecutionModeContradiction({
            operationId: evidenceOperation.operationId
          })
        }
        yield* emit(ImplementationEvidenceSealingSimulatedTrace.make({
          operation: evidenceOperation,
          simulation
        }))
      } else {
        return yield* new TaskWorktreeExecutionModeContradiction({
          operationId: worktreeOperation.operationId
        })
      }
    }),
    { concurrency: capacity, discard: true }
  )
})
