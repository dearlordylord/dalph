import type { Effect, PlatformError } from "effect"
import type { OwnedTransitionExecution } from "./activation-coordinator.js"
import type { ManagedRecoveryActivationError } from "./managed-activation.js"
import type { RunnableFrontierTransition } from "./runnable-frontier.js"
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
  | ManagedRecoveryActivationError
  | PlannedTaskAttemptError
  | PlatformError.PlatformError
  | TaskWorktreeExecutionModeContradiction
  | TraceOutputError

/** One process-local selector result paired with the sole workflow operation its owner may invoke. */
// eslint-disable-next-line functional/no-mixed-types -- Selection and its sole executable operation form one capability.
export interface FreshWorkflowStage {
  readonly transition: RunnableFrontierTransition

  readonly run: (
    execution: OwnedTransitionExecution
  ) => Effect.Effect<FreshWorkflowStage | undefined, FreshWorkflowStageError>
}
