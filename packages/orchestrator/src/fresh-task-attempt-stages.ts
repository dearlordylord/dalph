import { Effect } from "effect"
import type { OperationId, Task } from "./domain.js"
import {
  type FreshImplementationConvergenceStage,
  makeFreshImplementationConvergenceStage
} from "./fresh-implementation-convergence-stages.js"
import type { FreshWorkflowStage } from "./fresh-workflow-stage.js"
import type { runLiveImplementationConvergence } from "./implementation-convergence-workflow.js"
import { defaultImplementationReviewRoundLimit } from "./implementation-convergence.js"
import { RunnableFrontierTransition as FrontierTransition } from "./runnable-frontier.js"
import {
  makeSimulatedImplementationConvergenceStage,
  type SimulatedImplementationConvergenceStage
} from "./simulated-implementation-convergence-stages.js"
import { TaskAttemptPlanAcknowledged, TaskAttemptPlanRecordingSimulated } from "./task-attempt-plan-recording.js"
import {
  TaskExecutionAdmitted,
  TaskExecutionOutcomeObserved,
  TaskExecutionSimulated,
  TaskWorkSessionEstablishmentSimulatedTrace
} from "./task-execution-trace.js"
import { TaskExecutionRequest, TaskExecutionSessionBinding } from "./task-execution.js"
import type { OperationIdAllocatorService, PlannedTaskAttemptPlannerService } from "./task-work-planning.js"
import { TaskWorkStartRequest } from "./task-work-start.js"
import { TaskWorktreeExecutionModeContradiction } from "./task-worktree-reconciliation.js"
import type { TraceOutputError } from "./trace-output.js"
import type { ActiveTaskClaim } from "./tracker-mutation.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskExecutionOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTaskWorktreeReconciliationOperation,
  OperationSelected,
  TaskWorkSessionEstablishedTrace,
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
}

const adaptLiveStage = (
  stage: FreshImplementationConvergenceStage
): FreshWorkflowStage => ({
  transition: stage.transition,
  run: () =>
    stage.run().pipe(
      Effect.map((next) => next === undefined ? undefined : adaptLiveStage(next))
    )
})

const adaptSimulatedStage = (
  stage: SimulatedImplementationConvergenceStage
): FreshWorkflowStage => ({
  transition: stage.transition,
  run: () =>
    stage.run().pipe(
      Effect.map((next) => next === undefined ? undefined : adaptSimulatedStage(next))
    )
})

/** Selects the plan operation that begins one staged fresh task attempt. */
export const makeFreshTaskAttemptStage = Effect.fn(
  "Workflow.makeFreshTaskAttemptStage"
)(function*(
  options: FreshTaskAttemptStageOptions,
  task: Task,
  activeClaim: ActiveTaskClaim | undefined,
  predecessorOperationId: OperationId
): Effect.fn.Return<
  FreshWorkflowStage,
  Effect.Error<ReturnType<PlannedTaskAttemptPlannerService["plan"]>>
> {
  const makeExecutionStage = Effect.fn("Workflow.makeExecutionStage")(
    function*(
      operation: ReturnType<typeof makeTaskExecutionOperation>,
      liveOptions:
        | Omit<Parameters<typeof runLiveImplementationConvergence>[0], "initialExecutionOutcome">
        | undefined
    ): Effect.fn.Return<FreshWorkflowStage> {
      return {
        transition: FrontierTransition.ContinueTaskExecution({
          operationId: operation.request.operationId,
          taskId: task.id
        }),
        run: () =>
          Effect.gen(function*() {
            yield* options.emit(OperationSelected.make({ operation }))
            yield* options.emit(TaskExecutionAdmitted.make({ operation }))
            if (liveOptions === undefined) {
              const outcome = yield* options.interpreter.simulateTaskExecution(
                operation
              )
              yield* options.emit(TaskExecutionSimulated.make({
                operation,
                outcome
              }))
              return adaptSimulatedStage(
                yield* makeSimulatedImplementationConvergenceStage({
                  allocator: options.allocator,
                  emit: options.emit,
                  interpreter: options.interpreter,
                  plannedAttempt: operation.request.plannedAttempt,
                  predecessorOperationId: operation.request.operationId,
                  task
                })
              )
            }
            const outcome = yield* options.interpreter.executeTaskWork(operation)
            yield* options.emit(TaskExecutionOutcomeObserved.make({
              operation,
              outcome
            }))
            return adaptLiveStage(
              yield* makeFreshImplementationConvergenceStage(
                liveOptions,
                outcome.outcome
              )
            )
          })
      }
    }
  )

  const makeSessionStage = Effect.fn("Workflow.makeSessionStage")(
    function*(
      plannedAttempt: Parameters<typeof makeTaskAttemptPlanOperation>[0]["plannedAttempt"],
      planOperationId: OperationId,
      planResult: Effect.Success<
        ReturnType<WorkflowInterpreterService["recordTaskAttemptPlan"]>
      >,
      worktreeOperation: ReturnType<typeof makeTaskWorktreeReconciliationOperation>,
      worktreeResult: Effect.Success<
        ReturnType<WorkflowInterpreterService["reconcileTaskWorktree"]>
      >
    ): Effect.fn.Return<FreshWorkflowStage> {
      const operation = makeTaskWorkSessionEstablishmentOperation({
        predecessorOperationIds: [
          planOperationId,
          worktreeOperation.operationId
        ],
        request: TaskWorkStartRequest.make({
          operationId: yield* options.allocator.allocate(),
          plannedAttempt,
          task
        })
      })
      return {
        transition: FrontierTransition.CheckTaskWorkSession({
          operationId: operation.request.operationId,
          taskId: task.id
        }),
        run: () =>
          Effect.gen(function*() {
            yield* options.emit(OperationSelected.make({ operation }))
            if (
              planResult._tag === "TaskAttemptPlanRecordAcknowledged"
              && worktreeResult._tag === "AuthoritativeTaskWorktreeReady"
            ) {
              if (activeClaim === undefined) {
                return yield* new TaskWorktreeExecutionModeContradiction({
                  operationId: operation.request.operationId
                })
              }
              const outcome = yield* options.interpreter.establishTaskWorkSession(
                operation
              )
              yield* options.emit(TaskWorkSessionEstablishedTrace.make({
                operation,
                outcome
              }))
              return yield* makeExecutionStage(
                makeTaskExecutionOperation({
                  predecessorOperationIds: [operation.request.operationId],
                  request: TaskExecutionRequest.make({
                    operationId: yield* options.allocator.allocate(),
                    plannedAttempt,
                    session: TaskExecutionSessionBinding.cases.EstablishedSession.make({
                      sessionId: outcome.sessionId
                    }),
                    task
                  })
                }),
                {
                  allocator: options.allocator,
                  emit: options.emit,
                  interpreter: options.interpreter,
                  roundLimit: defaultImplementationReviewRoundLimit,
                  subject: {
                    claim: activeClaim,
                    plannedAttempt,
                    sessionEstablishmentOperationId: operation.request.operationId,
                    sessionId: outcome.sessionId,
                    worktreeOperationId: worktreeOperation.operationId,
                    worktreeProof: worktreeResult.proof
                  },
                  task
                }
              )
            }
            if (
              planResult._tag === "TaskAttemptPlanRecordingSimulated"
              && worktreeResult._tag === "TaskWorktreeReconciliationSimulated"
            ) {
              const outcome = yield* options.interpreter.simulateTaskWorkSession(
                operation
              )
              yield* options.emit(
                TaskWorkSessionEstablishmentSimulatedTrace.make({
                  operation,
                  outcome
                })
              )
              return yield* makeExecutionStage(
                makeTaskExecutionOperation({
                  predecessorOperationIds: [operation.request.operationId],
                  request: TaskExecutionRequest.make({
                    operationId: yield* options.allocator.allocate(),
                    plannedAttempt,
                    session: TaskExecutionSessionBinding.cases.PlannedSession.make({
                      session: outcome.session
                    }),
                    task
                  })
                }),
                undefined
              )
            }
            return yield* new TaskWorktreeExecutionModeContradiction({
              operationId: worktreeOperation.operationId
            })
          })
      }
    }
  )

  const makeWorktreeStage = Effect.fn("Workflow.makeWorktreeStage")(
    function*(
      plannedAttempt: Parameters<typeof makeTaskAttemptPlanOperation>[0]["plannedAttempt"],
      planOperationId: OperationId,
      planResult: Effect.Success<
        ReturnType<WorkflowInterpreterService["recordTaskAttemptPlan"]>
      >
    ): Effect.fn.Return<FreshWorkflowStage> {
      const operation = makeTaskWorktreeReconciliationOperation({
        operationId: yield* options.allocator.allocate(),
        plannedAttempt,
        predecessorOperationIds: [planOperationId]
      })
      return {
        transition: FrontierTransition.ReconcileTaskWorktree({
          operationId: operation.operationId,
          taskId: task.id
        }),
        run: () =>
          Effect.gen(function*() {
            yield* options.emit(OperationSelected.make({ operation }))
            const result = yield* options.interpreter.reconcileTaskWorktree(
              operation
            )
            yield* options.emit(
              result._tag === "AuthoritativeTaskWorktreeReady"
                ? TaskWorktreeReadyTrace.make({
                  operation,
                  proof: result.proof
                })
                : TaskWorktreeReconciliationSimulatedTrace.make({ operation })
            )
            return yield* makeSessionStage(
              plannedAttempt,
              planOperationId,
              planResult,
              operation,
              result
            )
          })
      }
    }
  )

  const plannedAttempt = yield* options.planner.plan(task)
  const operation = makeTaskAttemptPlanOperation({
    operationId: yield* options.allocator.allocate(),
    plannedAttempt,
    predecessorOperationIds: [predecessorOperationId]
  })
  return {
    transition: FrontierTransition.ContinueFreshWorkflowOperation({
      operationId: operation.operationId,
      taskId: task.id
    }),
    run: () =>
      Effect.gen(function*() {
        yield* options.emit(OperationSelected.make({ operation }))
        const result = yield* options.interpreter.recordTaskAttemptPlan(operation)
        yield* options.emit(
          result._tag === "TaskAttemptPlanRecordAcknowledged"
            ? TaskAttemptPlanAcknowledged.make({ operation })
            : TaskAttemptPlanRecordingSimulated.make({ operation })
        )
        return yield* makeWorktreeStage(
          plannedAttempt,
          operation.operationId,
          result
        )
      })
  }
})
