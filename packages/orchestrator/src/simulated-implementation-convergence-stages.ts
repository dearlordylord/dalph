import { Effect } from "effect"
import { type OperationId, type PlannedTaskAttempt, SemanticReviewRound, type Task } from "./domain.js"
import { executorOuterInvocationIdForOperation, makeExecutorOuterInvocation } from "./executor-boundary.js"
import { ImplementationConvergenceSimulatedTrace } from "./implementation-convergence-trace.js"
import { defaultImplementationReviewRoundLimit } from "./implementation-convergence.js"
import { ImplementationReviewRequest } from "./implementation-review.js"
import {
  type RunnableFrontierTransition,
  RunnableFrontierTransition as FrontierTransition
} from "./runnable-frontier.js"
import {
  type SelectedExecutorCapacityActivity,
  selectedExecutorCapacityRequirementFor
} from "./selected-executor-capacity.js"
import type { OperationIdAllocatorService } from "./task-work-planning.js"
import { TaskWorktreeExecutionModeContradiction } from "./task-worktree-reconciliation.js"
import type { TraceOutputError } from "./trace-output.js"
import {
  ImplementationEvidenceSealingSimulatedTrace,
  ImplementationReviewSimulatedTrace,
  makeImplementationDispositionOperation,
  makeImplementationEvidenceSealingOperation,
  makeImplementationReviewOperation,
  OperationSelected,
  type TraceItem,
  type WorkflowInterpreterService
} from "./workflow.js"

type InterpreterOperation = WorkflowInterpreterService[keyof WorkflowInterpreterService]

export type SimulatedImplementationConvergenceStageError =
  | Effect.Error<ReturnType<InterpreterOperation>>
  | TaskWorktreeExecutionModeContradiction
  | TraceOutputError

// eslint-disable-next-line functional/no-mixed-types -- A process-local stage deliberately pairs immutable selection with its sole executable operation.
export interface SimulatedImplementationConvergenceStage {
  readonly transition: RunnableFrontierTransition

  readonly run: () => Effect.Effect<
    SimulatedImplementationConvergenceStage | undefined,
    SimulatedImplementationConvergenceStageError
  >
}

// eslint-disable-next-line functional/no-mixed-types -- Dependencies and the serialized trace emitter form one stage factory input.
interface SimulatedImplementationConvergenceOptions {
  readonly allocator: OperationIdAllocatorService
  readonly emit: (item: TraceItem) => Effect.Effect<void, TraceOutputError>
  readonly interpreter: WorkflowInterpreterService
  readonly plannedAttempt: PlannedTaskAttempt
  readonly predecessorOperationId: OperationId
  readonly task: Task
}

/**
 * Transitional #158 simulation adapter. Production generic code must receive
 * an independently allocated outer invocation identity.
 */
const freshTransition = (
  operationId: OperationId,
  task: Task,
  activity: SelectedExecutorCapacityActivity
) =>
  FrontierTransition.StartExecutorInvocation({
    capacityRequirement: selectedExecutorCapacityRequirementFor(activity),
    invocation: makeExecutorOuterInvocation(
      executorOuterInvocationIdForOperation(operationId),
      task.id
    )
  })

/** Builds the three exact simulated convergence operations as separate selector stages. */
export const makeSimulatedImplementationConvergenceStage = Effect.fn(
  "Workflow.makeSimulatedImplementationConvergenceStage"
)(function*(
  options: SimulatedImplementationConvergenceOptions
): Effect.fn.Return<SimulatedImplementationConvergenceStage> {
  const makeDispositionStage = Effect.fn(
    "Workflow.makeSimulatedDispositionStage"
  )(function*(
    predecessorOperationId: OperationId
  ): Effect.fn.Return<SimulatedImplementationConvergenceStage> {
    const operation = makeImplementationDispositionOperation(
      {
        _tag: "SimulatedImplementationConvergenceDisposition",
        operationId: yield* options.allocator.allocate(),
        plannedAttempt: options.plannedAttempt,
        roundLimit: defaultImplementationReviewRoundLimit
      },
      predecessorOperationId
    )
    return {
      transition: freshTransition(
        operation.request.operationId,
        options.task,
        "ImplementationDisposition"
      ),
      run: () =>
        Effect.gen(function*() {
          yield* options.emit(OperationSelected.make({ operation }))
          const result = yield* options.interpreter.recordImplementationDisposition(
            operation
          )
          if (result._tag !== "ImplementationConvergenceSimulated") {
            return yield* new TaskWorktreeExecutionModeContradiction({
              operationId: operation.request.operationId
            })
          }
          yield* options.emit(ImplementationConvergenceSimulatedTrace.make({
            operation,
            result
          }))
        })
    }
  })

  const makeReviewStage = Effect.fn("Workflow.makeSimulatedReviewStage")(
    function*(
      evidenceOperationId: OperationId
    ): Effect.fn.Return<SimulatedImplementationConvergenceStage> {
      const operationId = yield* options.allocator.allocate()
      const operation = makeImplementationReviewOperation(
        ImplementationReviewRequest.make({
          _tag: "SimulatedImplementationReview",
          evidenceSealingOperationId: evidenceOperationId,
          operationId,
          round: SemanticReviewRound.make(1),
          roundLimit: defaultImplementationReviewRoundLimit
        })
      )
      return {
        transition: freshTransition(
          operationId,
          options.task,
          "ImplementationReview"
        ),
        run: () =>
          Effect.gen(function*() {
            yield* options.emit(OperationSelected.make({ operation }))
            const simulation = yield* options.interpreter.reviewImplementation(
              operation
            )
            if (simulation._tag !== "ImplementationReviewSimulated") {
              return yield* new TaskWorktreeExecutionModeContradiction({
                operationId
              })
            }
            yield* options.emit(ImplementationReviewSimulatedTrace.make({
              operation,
              simulation
            }))
            return yield* makeDispositionStage(operationId)
          })
      }
    }
  )

  const operation = makeImplementationEvidenceSealingOperation({
    operationId: yield* options.allocator.allocate(),
    execution: {
      _tag: "SimulatedExecution",
      predecessorOperationId: options.predecessorOperationId
    },
    plannedAttempt: options.plannedAttempt
  })
  return {
    transition: freshTransition(
      operation.operationId,
      options.task,
      "ImplementationEvidenceSealing"
    ),
    run: () =>
      Effect.gen(function*() {
        yield* options.emit(OperationSelected.make({ operation }))
        const simulation = yield* options.interpreter.sealImplementationEvidence(
          operation
        )
        if (simulation._tag === "SealedImplementationEvidence") {
          return yield* new TaskWorktreeExecutionModeContradiction({
            operationId: operation.operationId
          })
        }
        yield* options.emit(ImplementationEvidenceSealingSimulatedTrace.make({
          operation,
          simulation
        }))
        return yield* makeReviewStage(operation.operationId)
      })
  }
})
