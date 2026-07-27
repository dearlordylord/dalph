import { Effect, Exit, Queue, Ref, Semaphore } from "effect"
import { ActivationCause, makeActivationCoordinator } from "./activation-coordinator.js"
import { type OperationId, RunId, type TaskWorkCapacity, type TrackerTarget } from "./domain.js"
import { makeFreshTaskAttemptStage } from "./fresh-task-attempt-stages.js"
import { type FreshWorkflowStage, type FreshWorkflowStageError } from "./fresh-workflow-stage.js"
import {
  type RunnableFrontierTransition,
  RunnableFrontierTransition as FrontierTransition
} from "./runnable-frontier.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"
import { TaskClaimAcquisitionPlanner } from "./task-claim-planning.js"
import { taskRevisionFor } from "./task-dag.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "./task-work-planning.js"
import type { ActiveTaskClaim } from "./tracker-mutation.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTrackerGraphObservationOperation,
  makeTrackerGraphObservedOutcome,
  OperationSelected,
  TaskClaimAcquiredTrace,
  TaskClaimAcquisitionIntended,
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
  const admissionController = yield* makeTaskAdmissionController({
    capacity,
    freshOccupiedInvocations: [],
    reconstructedReservedPositions: []
  })
  type Task = ReturnType<typeof snapshot.eligibleTasks>[number]
  type WorkflowStage = FreshWorkflowStage
  type WorkflowStageError = FreshWorkflowStageError

  const continued = (
    operationId: OperationId,
    task: Task
  ): RunnableFrontierTransition =>
    FrontierTransition.ContinueFreshWorkflowOperation({
      operationId,
      taskId: task.id
    })

  const makeAttemptStage = (
    task: Task,
    activeClaim: ActiveTaskClaim | undefined,
    predecessorOperationId: OperationId
  ) =>
    makeFreshTaskAttemptStage(
      { allocator, emit, interpreter, planner },
      task,
      activeClaim,
      predecessorOperationId
    )

  const makeAdmissionObservationStage = Effect.fn(
    "Workflow.makeAdmissionObservationStage"
  )(function*(
    task: Task,
    claim: ActiveTaskClaim,
    claimOperation: ReturnType<typeof makeTaskClaimAcquisitionOperation>
  ): Effect.fn.Return<WorkflowStage> {
    const operation = makeTrackerGraphObservationOperation(
      yield* allocator.allocate(),
      target,
      [claimOperation.acquisition.operationId],
      [task.id]
    )
    return {
      transition: continued(operation.operationId, task),
      run: () =>
        Effect.gen(function*() {
          yield* emit(OperationSelected.make({ operation }))
          const admissionSnapshot = yield* interpreter.readTrackerGraph(operation)
          yield* emit(TrackerGraphOutcomeObserved.make({
            operation,
            outcome: makeTrackerGraphObservedOutcome(admissionSnapshot)
          }))
          const admittedTask = admissionSnapshot.eligibleTasks().find(
            (candidate) => candidate.id === task.id
          )
          if (admittedTask === undefined) return
          yield* emit(TrackerExecutionAdmitted.make({
            claimOperation,
            observationOperation: operation
          }))
          return yield* makeAttemptStage(
            admittedTask,
            claim,
            operation.operationId
          )
        })
    }
  })

  const makeClaimStage = Effect.fn("Workflow.makeClaimStage")(
    function*(task: Task, predecessorOperationId: OperationId): Effect.fn.Return<
      WorkflowStage,
      Effect.Error<ReturnType<typeof claimPlanner.plan>>
    > {
      const operationId = yield* allocator.allocate()
      const operation = makeTaskClaimAcquisitionOperation({
        acquisition: yield* claimPlanner.plan(operationId, task.id),
        predecessorOperationIds: [predecessorOperationId]
      })
      return {
        transition: FrontierTransition.CommitFreshTaskClaimIntent({
          taskId: task.id,
          taskRevision: taskRevisionFor(task)
        }),
        run: (recordActivationIntent) =>
          Effect.gen(function*() {
            yield* emit(OperationSelected.make({ operation }))
            yield* emit(TaskClaimAcquisitionIntended.make({ operation }))
            yield* recordActivationIntent(operation.acquisition.operationId)
            const result = yield* interpreter.acquireTaskClaim(operation)
            if (result._tag === "AuthoritativeTaskClaimAcquired") {
              yield* emit(TaskClaimAcquiredTrace.make({
                claim: result.claim,
                operation
              }))
              return yield* makeAdmissionObservationStage(
                task,
                result.claim,
                operation
              )
            }
            return yield* makeAttemptStage(
              task,
              undefined,
              operation.acquisition.operationId
            )
          })
      }
    }
  )

  const makeCurrentGraphStage = Effect.fn("Workflow.makeCurrentGraphStage")(
    function*(task: Task): Effect.fn.Return<WorkflowStage> {
      const operation = makeTrackerGraphObservationOperation(
        yield* allocator.allocate(),
        target
      )
      return {
        transition: continued(operation.operationId, task),
        run: () =>
          Effect.gen(function*() {
            yield* emit(OperationSelected.make({ operation }))
            const currentSnapshot = yield* interpreter.readTrackerGraph(operation)
            yield* emit(TrackerGraphOutcomeObserved.make({
              operation,
              outcome: makeTrackerGraphObservedOutcome(currentSnapshot)
            }))
            const currentTask = currentSnapshot.eligibleTasks().find(
              (candidate) => candidate.id === task.id
            )
            return currentTask === undefined
              ? undefined
              : yield* makeClaimStage(currentTask, operation.operationId)
          })
      }
    }
  )

  const completions = yield* Queue.unbounded<Exit.Exit<void, WorkflowStageError>>()

  return yield* Effect.scoped(Effect.gen(function*() {
    const initialTasks = snapshot.eligibleTasks()
    const initialStages = yield* Effect.forEach(initialTasks, makeCurrentGraphStage)
    const stages = yield* Ref.make<ReadonlyArray<WorkflowStage>>(initialStages)
    const coordinator = yield* makeActivationCoordinator({
      admissionController,
      readFrontier: Ref.get(stages).pipe(
        Effect.map((current) => ({
          explanations: [],
          transitions: current.map(({ transition }) => transition)
        }))
      ),
      runId: RunId.make(`workflow:${target}`),
      runTransition: (transition, execution) =>
        Effect.gen(function*() {
          const stage = (yield* Ref.get(stages)).find(
            (candidate) => candidate.transition === transition
          )
          if (stage === undefined) return
          const exit = yield* stage.run(execution.recordIntent).pipe(Effect.exit)
          if (Exit.isSuccess(exit)) {
            yield* Ref.update(stages, (current) =>
              current.flatMap((candidate) =>
                candidate !== stage
                  ? [candidate]
                  : exit.value === undefined
                  ? []
                  : [exit.value]
              ))
            if (exit.value === undefined) {
              yield* Queue.offer(completions, Exit.succeed(undefined))
            }
          } else {
            yield* Ref.update(stages, (current) => current.filter((candidate) => candidate !== stage))
            yield* Queue.offer(completions, exit)
          }
          return yield* Exit.isFailure(exit)
            ? Effect.failCause(exit.cause)
            : Effect.void
        })
    })

    yield* coordinator.signal(ActivationCause.Startup())
    for (let completed = 0; completed < initialTasks.length; completed += 1) {
      const completion = yield* Queue.take(completions)
      if (Exit.isFailure(completion)) {
        return yield* Effect.failCause(completion.cause)
      }
    }
  }))
})
