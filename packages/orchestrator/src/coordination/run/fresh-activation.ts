import type { Effect, PlatformError } from "effect"
import type { OwnedTransitionExecution } from "../activation/coordinator.js"
import type { RunRecoveryActivationError } from "./recovery-activation.js"
import type { RunnableFrontierTransition } from "../frontier/frontier.js"
import type { PlannedTaskAttemptError } from "../../workflow/protocols/task-attempt-planning/plan.js"
import type { TaskWorktreeExecutionModeContradiction } from "../../workflow/protocols/worktree-reconciliation/protocol.js"
import type { TraceOutputError } from "../../presentation/trace-output.js"
import type { WorkflowInterpreterService } from "../../workflow/interpretation/interpreter.js"

type InterpreterError = {
  [Key in keyof WorkflowInterpreterService]: Effect.Error<ReturnType<WorkflowInterpreterService[Key]>>
}[keyof WorkflowInterpreterService]

export type FreshWorkflowStageError =
  | InterpreterError
  | RunRecoveryActivationError
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
