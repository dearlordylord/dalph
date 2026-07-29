import { Deferred, Effect, Exit, Option, Queue, Ref, Semaphore } from "effect"
import { ActivationCause, makeActivationCoordinator } from "./activation-coordinator.js"
import {
  type OperationId,
  type PlannedTaskAttempt,
  RunId,
  type TaskId,
  type TaskWorkCapacity,
  type TrackerTarget
} from "./domain.js"
import { makeFreshTaskAttemptStage } from "./fresh-task-attempt-stages.js"
import type { FreshWorkflowStage, FreshWorkflowStageError } from "./fresh-workflow-stage.js"
import { RunRecoveryActivation, type RunRecoveryActivationError } from "./run-recovery-activation.js"
import {
  type RunnableFrontier,
  type RunnableFrontierTransition,
  RunnableFrontierTransition as FrontierTransition,
  runnableTransitionTaskId
} from "./runnable-frontier.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"
import { TaskClaimAcquisitionPlanner } from "./task-claim-planning.js"
import { taskRevisionFor } from "./task-dag.js"
import { makeCompleteTaskTrackerFactsObserved, type TaskWorkSpecification } from "./task-tracker-facts.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "./task-work-planning.js"
import type { ActiveTaskClaim } from "./tracker-mutation.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation,
  OperationSelected,
  TaskClaimAcquiredTrace,
  TaskClaimAcquisitionIntended,
  type TraceItem,
  TrackerExecutionAdmitted,
  TaskTrackerFactsObservedTrace,
  WorkflowInterpreter,
  WorkflowTrace
} from "./workflow.js"

const explanationTaskIds = (explanation: RunnableFrontier["explanations"][number]): ReadonlyArray<TaskId> =>
  Option.toArray(Option.fromUndefinedOr<TaskId>(Reflect.get(explanation, "taskId")))

/** Journal reconstruction exclusively owns every task it has rediscovered. */
export const discardFreshStagesOwnedByRecovery = (
  stages: ReadonlyArray<FreshWorkflowStage>,
  recoveredTaskIds: ReadonlySet<TaskId>
): ReadonlyArray<FreshWorkflowStage> =>
  stages.filter(({ transition }) => !recoveredTaskIds.has(runnableTransitionTaskId(transition)))

export const runWorkflow = Effect.fn("Workflow.run")(function* (target: TrackerTarget, capacity: TaskWorkCapacity) {
  const allocator = yield* OperationIdAllocator
  const interpreter = yield* WorkflowInterpreter
  const claimPlanner = yield* TaskClaimAcquisitionPlanner
  const planner = yield* PlannedTaskAttemptPlanner
  const trace = yield* WorkflowTrace
  const recovery = yield* RunRecoveryActivation
  const graphOperation = makeTrackerGraphObservationOperation(yield* allocator.allocate(), target)
  yield* trace.emit(OperationSelected.make({ operation: graphOperation }))
  const snapshot = yield* interpreter.readTrackerGraph(graphOperation)
  yield* trace.emit(
    TaskTrackerFactsObservedTrace.make({
      operation: graphOperation,
      observation: makeCompleteTaskTrackerFactsObserved(graphOperation, snapshot)
    })
  )

  const traceEmission = yield* Semaphore.make(1)
  const emit = (item: TraceItem) => traceEmission.withPermit(trace.emit(item))
  const admissionController = yield* makeTaskAdmissionController({
    capacity,
    reconstructedPlannedAttemptPositions: recovery.reconstructedPlannedAttemptPositions
  })
  type Task = ReturnType<typeof snapshot.eligibleTasks>[number]
  type WorkflowStage = FreshWorkflowStage
  const continuePlannedExecutorWork = (plannedAttempt: PlannedTaskAttempt) =>
    recovery.continuePlannedAttemptExecutorWork(plannedAttempt)

  const continued = (operationId: OperationId, task: Task): RunnableFrontierTransition =>
    FrontierTransition.ContinueFreshWorkflowOperation({ operationId, taskId: task.id })

  const makeAttemptStage = (
    task: Task,
    specification: TaskWorkSpecification,
    activeClaim: ActiveTaskClaim | undefined,
    predecessorOperationId: OperationId
  ) =>
    makeFreshTaskAttemptStage(
      { allocator, continuePlannedAttemptExecutorWork: continuePlannedExecutorWork, emit, interpreter, planner },
      task,
      specification,
      activeClaim,
      predecessorOperationId
    )

  const makeTaskWorkSpecificationStage = Effect.fn("Workflow.makeTaskWorkSpecificationStage")(function* (
    task: Task,
    activeClaim: ActiveTaskClaim | undefined,
    predecessorOperationId: OperationId
  ): Effect.fn.Return<WorkflowStage> {
    const operation = makeTaskWorkSpecificationObservationOperation(yield* allocator.allocate(), target, task.id, [
      predecessorOperationId
    ])
    return {
      transition: continued(operation.operationId, task),
      run: () =>
        Effect.gen(function* () {
          yield* emit(OperationSelected.make({ operation }))
          const specification = yield* interpreter.readTaskWorkSpecification(operation)
          return yield* makeAttemptStage(task, specification, activeClaim, operation.operationId)
        })
    }
  })

  const makeAdmissionObservationStage = Effect.fn("Workflow.makeAdmissionObservationStage")(function* (
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
        Effect.gen(function* () {
          yield* emit(OperationSelected.make({ operation }))
          const admissionSnapshot = yield* interpreter.readTrackerGraph(operation)
          yield* emit(
            TaskTrackerFactsObservedTrace.make({
              operation,
              observation: makeCompleteTaskTrackerFactsObserved(operation, admissionSnapshot)
            })
          )
          const admittedTask = admissionSnapshot.eligibleTasks().find((candidate) => candidate.id === task.id)
          if (admittedTask === undefined) return
          yield* emit(TrackerExecutionAdmitted.make({ claimOperation, observationOperation: operation }))
          return yield* makeTaskWorkSpecificationStage(admittedTask, claim, operation.operationId)
        })
    }
  })

  const makeClaimStage = Effect.fn("Workflow.makeClaimStage")(function* (
    task: Task,
    predecessorOperationId: OperationId
  ): Effect.fn.Return<WorkflowStage, Effect.Error<ReturnType<typeof claimPlanner.plan>>> {
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
      run: (execution) =>
        Effect.gen(function* () {
          yield* emit(OperationSelected.make({ operation }))
          yield* emit(TaskClaimAcquisitionIntended.make({ operation }))
          const result = yield* interpreter.acquireTaskClaim(
            operation,
            execution.recordIntent(operation.acquisition.operationId)
          )
          if (result._tag === "AuthoritativeTaskClaimAcquired") {
            yield* emit(TaskClaimAcquiredTrace.make({ claim: result.claim, operation }))
            return yield* makeAdmissionObservationStage(task, result.claim, operation)
          }
          return yield* makeTaskWorkSpecificationStage(task, undefined, operation.acquisition.operationId)
        })
    }
  })

  const makeCurrentGraphStage = Effect.fn("Workflow.makeCurrentGraphStage")(function* (
    task: Task
  ): Effect.fn.Return<WorkflowStage> {
    const operation = makeTrackerGraphObservationOperation(yield* allocator.allocate(), target)
    return {
      transition: continued(operation.operationId, task),
      run: () =>
        Effect.gen(function* () {
          yield* emit(OperationSelected.make({ operation }))
          const currentSnapshot = yield* interpreter.readTrackerGraph(operation)
          yield* emit(
            TaskTrackerFactsObservedTrace.make({
              operation,
              observation: makeCompleteTaskTrackerFactsObserved(operation, currentSnapshot)
            })
          )
          const currentTask = currentSnapshot.eligibleTasks().find((candidate) => candidate.id === task.id)
          return currentTask === undefined ? undefined : yield* makeClaimStage(currentTask, operation.operationId)
        })
    }
  })

  interface WorkflowOperationCompletion {
    readonly acknowledged: Deferred.Deferred<void>
    readonly exit: Exit.Exit<FreshWorkflowStage | undefined, FreshWorkflowStageError | RunRecoveryActivationError>
    readonly stage: FreshWorkflowStage | undefined
  }
  const completions = yield* Queue.unbounded<WorkflowOperationCompletion>()

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const initialRecoveredFrontier = yield* recovery.readFrontier
      const recoveredTaskIds = new Set([
        ...initialRecoveredFrontier.explanations.flatMap(explanationTaskIds),
        ...initialRecoveredFrontier.transitions.map(runnableTransitionTaskId)
      ])
      const initialTasks = snapshot.eligibleTasks().filter(({ id }) => !recoveredTaskIds.has(id))
      const initialStages = yield* Effect.forEach(initialTasks, makeCurrentGraphStage)
      const stages = yield* Ref.make<ReadonlyArray<WorkflowStage>>(initialStages)
      const scheduledFreshTaskIds = yield* Ref.make<ReadonlySet<Task["id"]>>(new Set(initialTasks.map(({ id }) => id)))
      const readFrontier = Effect.fn("Workflow.readActivationFrontier")(function* () {
        const recovered = yield* recovery.readFrontier
        const recoveredTaskIds = new Set([
          ...recovered.explanations.flatMap(explanationTaskIds),
          ...recovered.transitions.map(runnableTransitionTaskId)
        ])
        const alreadyScheduled = yield* Ref.get(scheduledFreshTaskIds)
        const newlyFresh = snapshot
          .eligibleTasks()
          .filter(({ id }) => !alreadyScheduled.has(id) && !recoveredTaskIds.has(id))
        if (newlyFresh.length > 0) {
          const added = yield* Effect.forEach(newlyFresh, makeCurrentGraphStage)
          yield* Ref.update(stages, (current) => [...current, ...added])
          yield* Ref.update(
            scheduledFreshTaskIds,
            (current) => new Set([...current, ...newlyFresh.map(({ id }) => id)])
          )
        }
        if (recoveredTaskIds.size > 0) {
          yield* Ref.update(stages, (current) => discardFreshStagesOwnedByRecovery(current, recoveredTaskIds))
        }
        const current = yield* Ref.get(stages)
        return {
          explanations: recovered.explanations,
          transitions: [...recovered.transitions, ...current.map(({ transition }) => transition)]
        }
      })
      const coordinator = yield* makeActivationCoordinator({
        admissionController,
        readFrontier: readFrontier(),
        runId:
          recovery._tag === "AuthoritativeRunRecoveryActivation" ? recovery.runId : RunId.make(`workflow:${target}`),
        runTransition: (transition, execution) =>
          Effect.gen(function* () {
            const stage = (yield* Ref.get(stages)).find((candidate) => candidate.transition === transition)
            const operation: Effect.Effect<
              FreshWorkflowStage | undefined,
              FreshWorkflowStageError | RunRecoveryActivationError
            > = Option.match(Option.fromUndefinedOr(stage), {
              onNone: () =>
                recovery._tag === "AuthoritativeRunRecoveryActivation"
                  ? recovery
                      .runTransition(transition, execution)
                      .pipe(Effect.as<FreshWorkflowStage | undefined>(undefined))
                  : Effect.die("synthetic activation cannot derive a recovered transition"),
              onSome: (fresh) => fresh.run(execution)
            })
            const exit = yield* Effect.exit(operation)
            const acknowledged = yield* Deferred.make<void>()
            yield* Queue.offer(completions, { acknowledged, exit, stage })
            yield* Deferred.await(acknowledged)
            return yield* Exit.isFailure(exit) ? Effect.failCause(exit.cause) : Effect.void
          })
      })
      const applyCompletion = Effect.fn("Workflow.applyOperationCompletion")(function* (
        completion: WorkflowOperationCompletion
      ) {
        const { exit, stage } = completion
        if (stage !== undefined) {
          yield* Ref.update(stages, (current) =>
            current.flatMap((candidate) =>
              candidate !== stage ? [candidate] : Exit.isFailure(exit) || exit.value === undefined ? [] : [exit.value]
            )
          )
        }
        yield* Deferred.succeed(completion.acknowledged, undefined)
        if (Exit.isFailure(exit)) {
          return yield* Effect.failCause(exit.cause)
        }
      })

      for (;;) {
        yield* coordinator.signal(ActivationCause.Startup())
        const pendingCompletion = yield* Queue.poll(completions)
        if (Option.isSome(pendingCompletion)) {
          yield* applyCompletion(pendingCompletion.value)
          continue
        }
        const currentFrontier = yield* readFrontier()
        if (currentFrontier.transitions.length === 0) return
        const awaitedCompletion = yield* Queue.take(completions)
        yield* applyCompletion(awaitedCompletion)
      }
    })
  )
})
