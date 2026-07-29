import { Effect } from "effect"
import type { OperationId, PlannedTaskAttempt, Task } from "./domain.js"
import type { FreshWorkflowStage } from "./fresh-workflow-stage.js"
import type { RunRecoveryActivationError } from "./run-recovery-activation.js"
import { plannedAttemptExecutorCorrelation } from "./planned-attempt-executor.js"
import type { PlannedAttemptExecutorReport } from "./planned-attempt-executor.js"
import { RunnableFrontierTransition } from "./runnable-frontier.js"
import { TaskAttemptPlanAcknowledged, TaskAttemptPlanRecordingSimulated } from "./task-attempt-plan-recording.js"
import type { OperationIdAllocatorService, PlannedTaskAttemptPlannerService } from "./task-work-planning.js"
import type { TraceOutputError } from "./trace-output.js"
import type { ActiveTaskClaim } from "./tracker-mutation.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskWorktreeReconciliationOperation,
  OperationSelected,
  TaskWorktreeReadyTrace,
  TaskWorktreeReconciliationSimulatedTrace,
  type TraceItem,
  type WorkflowInterpreterService
} from "./workflow.js"

// eslint-disable-next-line functional/no-mixed-types -- Dependencies and the serialized trace emitter form one stage factory input.
interface FreshTaskAttemptStageOptions {
  readonly allocator: OperationIdAllocatorService
  readonly emit: (item: TraceItem) => Effect.Effect<void, TraceOutputError>
  readonly interpreter: WorkflowInterpreterService
  readonly planner: PlannedTaskAttemptPlannerService
  readonly continuePlannedAttemptExecutorWork: (
    plannedAttempt: PlannedTaskAttempt
  ) => Effect.Effect<PlannedAttemptExecutorReport, RunRecoveryActivationError>
}

const freshWorkflowTransition = (operationId: OperationId, task: Task) =>
  RunnableFrontierTransition.ContinueFreshWorkflowOperation({ operationId, taskId: task.id })

const makeExecutorStage = (
  plannedAttempt: PlannedTaskAttempt,
  resumed: boolean,
  services: Pick<FreshTaskAttemptStageOptions, "continuePlannedAttemptExecutorWork">
): FreshWorkflowStage => {
  const transition = resumed
    ? RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({ plannedAttempt })
    : RunnableFrontierTransition.StartPlannedAttemptExecutorWork({ plannedAttempt })
  return {
    transition,
    run: (execution) =>
      Effect.gen(function* () {
        const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
        yield* execution.bindPlannedAttemptExecutorPosition(correlation)
        const report = yield* services.continuePlannedAttemptExecutorWork(plannedAttempt)
        if (report._tag === "SafelySuspended" || report._tag === "Terminal") {
          yield* execution.releasePlannedAttemptExecutorWorkPosition(correlation)
          return undefined
        }
        return makeExecutorStage(plannedAttempt, true, services)
      })
  }
}

/** Plans the attempt, proves its worktree ready, then hands the whole attempt to the executor. */
export const makeFreshTaskAttemptStage = Effect.fn("Workflow.makeFreshTaskAttemptStage")(function* (
  options: FreshTaskAttemptStageOptions,
  task: Task,
  _activeClaim: ActiveTaskClaim | undefined,
  predecessorOperationId: OperationId
): Effect.fn.Return<FreshWorkflowStage, Effect.Error<ReturnType<PlannedTaskAttemptPlannerService["plan"]>>> {
  const plannedAttempt = yield* options.planner.plan(task)
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: yield* options.allocator.allocate(),
    plannedAttempt,
    predecessorOperationIds: [predecessorOperationId]
  })
  return {
    transition: freshWorkflowTransition(planOperation.operationId, task),
    run: () =>
      Effect.gen(function* () {
        yield* options.emit(OperationSelected.make({ operation: planOperation }))
        const planResult = yield* options.interpreter.recordTaskAttemptPlan(planOperation)
        yield* options.emit(
          planResult._tag === "TaskAttemptPlanRecordAcknowledged"
            ? TaskAttemptPlanAcknowledged.make({ operation: planOperation })
            : TaskAttemptPlanRecordingSimulated.make({ operation: planOperation })
        )

        const worktreeOperation = makeTaskWorktreeReconciliationOperation({
          operationId: yield* options.allocator.allocate(),
          plannedAttempt,
          predecessorOperationIds: [planOperation.operationId]
        })
        return {
          transition: freshWorkflowTransition(worktreeOperation.operationId, task),
          run: () =>
            Effect.gen(function* () {
              yield* options.emit(OperationSelected.make({ operation: worktreeOperation }))
              const worktreeResult = yield* options.interpreter.reconcileTaskWorktree(worktreeOperation)
              yield* options.emit(
                worktreeResult._tag === "AuthoritativeTaskWorktreeReady"
                  ? TaskWorktreeReadyTrace.make({ operation: worktreeOperation, proof: worktreeResult.proof })
                  : TaskWorktreeReconciliationSimulatedTrace.make({ operation: worktreeOperation })
              )
              return makeExecutorStage(plannedAttempt, false, options)
            })
        } satisfies FreshWorkflowStage
      })
  }
})
