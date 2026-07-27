import type { Effect, PlatformError } from "effect"
import type { OperationId } from "./domain.js"
import type { FreshImplementationConvergenceStageError } from "./implementation-convergence-stage.js"
import type { RunnableFrontierTransition } from "./runnable-frontier.js"
import type { SimulatedImplementationConvergenceStageError } from "./simulated-implementation-convergence-stages.js"
import type { PlannedTaskAttemptError } from "./task-work-planning.js"
import type { TaskWorktreeExecutionModeContradiction } from "./task-worktree-reconciliation.js"
import type { TraceOutputError } from "./trace-output.js"
import type { WorkflowInterpreterService } from "./workflow.js"

type InterpreterError = {
  [Key in keyof WorkflowInterpreterService]: Effect.Error<
    ReturnType<WorkflowInterpreterService[Key]>
  >
}[keyof WorkflowInterpreterService]

export type FreshWorkflowStageError =
  | InterpreterError
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
