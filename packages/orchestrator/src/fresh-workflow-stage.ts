import type { Effect, PlatformError } from "effect"
import type { OperationId } from "./domain.js"
import type { FreshImplementationConvergenceStageError } from "./fresh-implementation-convergence-stages.js"
import type { RunnableFrontierTransition } from "./runnable-frontier.js"
import type { SimulatedImplementationConvergenceStageError } from "./simulated-implementation-convergence-stages.js"
import type { PlannedTaskAttemptError } from "./task-work-planning.js"
import type { TaskWorktreeExecutionModeContradiction } from "./task-worktree-reconciliation.js"
import type { TraceOutputError } from "./trace-output.js"
import type { WorkflowInterpreterService } from "./workflow.js"

type InterpreterOperation = WorkflowInterpreterService[keyof WorkflowInterpreterService]

export type FreshWorkflowStageError =
  | Effect.Error<ReturnType<InterpreterOperation>>
  | FreshImplementationConvergenceStageError
  | PlannedTaskAttemptError
  | PlatformError.PlatformError
  | SimulatedImplementationConvergenceStageError
  | TaskWorktreeExecutionModeContradiction
  | TraceOutputError

/** One process-local selector result paired with the sole workflow operation its owner may invoke. */
// eslint-disable-next-line functional/no-mixed-types -- Selection and its sole executable operation form one capability.
export interface FreshWorkflowStage {
  readonly transition: RunnableFrontierTransition

  readonly run: (
    recordActivationIntent: (operationId: OperationId) => Effect.Effect<void>
  ) => Effect.Effect<FreshWorkflowStage | undefined, FreshWorkflowStageError>
}
