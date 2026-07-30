import { Deferred, Effect, Exit, Option, Queue, Ref, Semaphore } from "effect"
import { ActivationCause, makeActivationCoordinator } from "../activation/coordinator.js"
import { type PlannedTaskAttempt, type RunId, type TaskId } from "@dalph/contracts"
import { type OperationId } from "../../workflow/identity.js"
import { type InitialControlPolicy } from "../../control/policy.js"
import { type TrackerTarget } from "../../authorities/task-tracker/target.js"
import { type AllocatedFreshWorkflowRunId } from "./fresh-run-identity.js"
import { makeFreshTaskAttemptStage } from "./fresh-task-attempt-stages.js"
import type { FreshWorkflowStage, FreshWorkflowStageError } from "./fresh-activation.js"
import { RunRecoveryActivation, type RunRecoveryActivationError } from "./recovery-activation.js"
import {
  deriveRunFinalityDecision,
  type RunnableFrontier,
  type RunnableFrontierTransition,
  RunnableFrontierTransition as FrontierTransition,
  runnableTransitionTaskId
} from "../frontier/frontier.js"
import { makeTaskAdmissionController } from "../admission/controller.js"
import { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import { taskRevisionFor } from "../../authorities/task-tracker/graph.js"
import { makeCompleteTaskTrackerFactsObserved } from "../../workflow/task-tracker-facts/observation.js"
import type { TaskWorkSpecification } from "../../authorities/task-tracker/task-work-specification.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "../../workflow/protocols/task-attempt-planning/plan.js"
import type { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import {
  OperationSelected,
  TaskClaimAcquiredTrace,
  TaskClaimAcquisitionIntended,
  TrackerExecutionAdmitted,
  TaskTrackerFactsObservedTrace
} from "../../presentation/tracker-workflow-trace.js"
import { type TraceItem, WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { JournalStore } from "../../workflow-journal/store.js"
import { TaskWorkCapacityControl } from "../../control/task-work-capacity.js"
import { RunControlPolicy, initialRunPolicyRevision } from "../../control/policy.js"

const explanationTaskIds = (explanation: RunnableFrontier["explanations"][number]): ReadonlyArray<TaskId> =>
  Option.toArray(Option.fromUndefinedOr<TaskId>(Reflect.get(explanation, "taskId")))

/** Journal reconstruction exclusively owns every task it has rediscovered. */
export const discardFreshStagesOwnedByRecovery = (
  stages: ReadonlyArray<FreshWorkflowStage>,
  recoveredTaskIds: ReadonlySet<TaskId>
): ReadonlyArray<FreshWorkflowStage> =>
  stages.filter(({ transition }) => !recoveredTaskIds.has(runnableTransitionTaskId(transition)))

/** Startup-recovered work remains authoritative, while this activation owns every live fresh stage it created. */
export const discardRecoveredFrontierOwnedByFreshStages = (
  frontier: RunnableFrontier,
  freshTaskIds: ReadonlySet<TaskId>
): RunnableFrontier => ({
  explanations: frontier.explanations.filter(
    (explanation) => !explanationTaskIds(explanation).some((taskId) => freshTaskIds.has(taskId))
  ),
  transitions: frontier.transitions.filter((transition) => !freshTaskIds.has(runnableTransitionTaskId(transition)))
})

type RunControlPolicyReadError = Effect.Error<ReturnType<TaskWorkCapacityControl["Service"]["read"]>>

const runWorkflowWithStartup = Effect.fn("Workflow.runWithStartup")(function* (
  target: TrackerTarget,
  startup:
    | {
        readonly _tag: "Fresh"
        readonly initialControlPolicy: InitialControlPolicy
        readonly runId: AllocatedFreshWorkflowRunId
      }
    | { readonly _tag: "Recovered" }
    | { readonly _tag: "Synthetic"; readonly initialControlPolicy: InitialControlPolicy; readonly runId: RunId },
  readCurrentControlPolicy: Effect.Effect<RunControlPolicy, RunControlPolicyReadError>
) {
  const allocator = yield* OperationIdAllocator
  const interpreter = yield* WorkflowInterpreter
  const claimPlanner = yield* TaskClaimAcquisitionPlanner
  const planner = yield* PlannedTaskAttemptPlanner
  const trace = yield* WorkflowTrace
  const recovery = yield* RunRecoveryActivation
  const runId =
    recovery._tag === "AuthoritativeRunRecoveryActivation"
      ? recovery.runId
      : /* v8 ignore next -- Recovered entry points require authoritative recovery composition. */
        startup._tag === "Recovered"
        ? yield* Effect.die("a recovered workflow requires authoritative recovered activation")
        : startup.runId
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
    capacity: (yield* readCurrentControlPolicy).taskExecutionCapacity,
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
      const initialRecoveredTaskIds = new Set([
        ...initialRecoveredFrontier.explanations.flatMap(explanationTaskIds),
        ...initialRecoveredFrontier.transitions.map(runnableTransitionTaskId)
      ])
      const initialTasks = snapshot.eligibleTasks().filter(({ id }) => !initialRecoveredTaskIds.has(id))
      const initialStages = yield* Effect.forEach(initialTasks, makeCurrentGraphStage)
      const stages = yield* Ref.make<ReadonlyArray<WorkflowStage>>(initialStages)
      const currentSnapshot = yield* Ref.make(snapshot)
      const scheduledFreshTaskIds = yield* Ref.make<ReadonlySet<Task["id"]>>(new Set(initialTasks.map(({ id }) => id)))
      const readFrontier = Effect.fn("Workflow.readActivationFrontier")(function* () {
        const completeRecovered = yield* recovery.readFrontier
        const recoveredTaskIds = new Set([
          ...completeRecovered.explanations.flatMap(explanationTaskIds),
          ...completeRecovered.transitions.map(runnableTransitionTaskId)
        ])
        const alreadyScheduled = yield* Ref.get(scheduledFreshTaskIds)
        const latestSnapshot = yield* Ref.get(currentSnapshot)
        const newlyFresh = latestSnapshot
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
        if (initialRecoveredTaskIds.size > 0) {
          yield* Ref.update(stages, (current) => discardFreshStagesOwnedByRecovery(current, initialRecoveredTaskIds))
        }
        const current = yield* Ref.get(stages)
        const freshTaskIds = new Set(current.map(({ transition }) => runnableTransitionTaskId(transition)))
        const recovered = discardRecoveredFrontierOwnedByFreshStages(completeRecovered, freshTaskIds)
        return {
          explanations: recovered.explanations,
          transitions: [...recovered.transitions, ...current.map(({ transition }) => transition)]
        }
      })
      const refreshCurrentGraph = Effect.fn("Workflow.refreshCurrentGraph")(function* () {
        const operation = makeTrackerGraphObservationOperation(yield* allocator.allocate(), target)
        yield* emit(OperationSelected.make({ operation }))
        const refreshed = yield* interpreter.readTrackerGraph(operation)
        yield* emit(
          TaskTrackerFactsObservedTrace.make({
            operation,
            observation: makeCompleteTaskTrackerFactsObserved(operation, refreshed)
          })
        )
        yield* Ref.set(currentSnapshot, refreshed)
        return refreshed
      })
      const coordinator = yield* makeActivationCoordinator({
        admissionController,
        readFrontier: readFrontier(),
        runId,
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
        const appliedPolicy = yield* readCurrentControlPolicy
        const admission = yield* admissionController.snapshot()
        if (admission.capacity !== appliedPolicy.taskExecutionCapacity) {
          yield* admissionController.resize(appliedPolicy.taskExecutionCapacity)
        }
        yield* coordinator.signal(ActivationCause.Startup())
        const pendingCompletion = yield* Queue.poll(completions)
        if (Option.isSome(pendingCompletion)) {
          yield* applyCompletion(pendingCompletion.value)
          continue
        }
        const currentFrontier = yield* readFrontier()
        if (currentFrontier.transitions.length === 0) {
          const refreshed = yield* refreshCurrentGraph()
          const refreshedFrontier = yield* readFrontier()
          if (refreshedFrontier.transitions.length === 0) {
            const trackerTargetSettled = refreshed
              .taskIds()
              .every((taskId) => Option.getOrThrow(refreshed.lifecycleOf(taskId))._tag === "CompletedSuccessfully")
            return deriveRunFinalityDecision(
              yield* recovery.readFinalityFrontier,
              yield* recovery.readResponsibility,
              trackerTargetSettled
            )
          }
          continue
        }
        const awaitedCompletion = yield* Queue.take(completions)
        yield* applyCompletion(awaitedCompletion)
      }
    })
  )
})

/** Runs a production fresh workflow only with an identity minted by `freshWorkflowRunId`. */
export const runWorkflow = (
  target: TrackerTarget,
  initialControlPolicy: InitialControlPolicy,
  runId: AllocatedFreshWorkflowRunId
) =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const control = yield* TaskWorkCapacityControl
    yield* journal.beginRun(runId, target, initialControlPolicy)
    const finality = yield* runWorkflowWithStartup(
      target,
      { _tag: "Fresh", initialControlPolicy, runId },
      control.read(runId)
    )
    if (finality._tag === "RunMayTerminate") yield* journal.terminateRun(runId)
    return finality
  })

/** Runs the exact reconstructed identity owned by authoritative recovery. */
export const runRecoveredWorkflow = (target: TrackerTarget) =>
  Effect.gen(function* () {
    const recovery = yield* RunRecoveryActivation
    if (recovery._tag !== "AuthoritativeRunRecoveryActivation") {
      return yield* Effect.die("a recovered workflow requires authoritative recovered activation")
    }
    const journal = yield* JournalStore
    const control = yield* TaskWorkCapacityControl
    yield* journal.readRunForRecovery(recovery.runId, target)
    const finality = yield* runWorkflowWithStartup(target, { _tag: "Recovered" }, control.read(recovery.runId))
    if (finality._tag === "RunMayTerminate") yield* journal.terminateRun(recovery.runId)
    return finality
  })

/** Explicit non-durable path for dry-run and deterministic workflow tests. */
export const runSyntheticWorkflow = (target: TrackerTarget, initialControlPolicy: InitialControlPolicy, runId: RunId) =>
  runWorkflowWithStartup(
    target,
    { _tag: "Synthetic", initialControlPolicy, runId },
    Effect.succeed(
      RunControlPolicy.make({
        revision: initialRunPolicyRevision,
        taskExecutionCapacity: initialControlPolicy.taskExecutionCapacity
      })
    )
  )
