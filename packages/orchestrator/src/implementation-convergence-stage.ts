import type { Effect } from "effect"
import { type ImplementationReviewRoundLimit, type OperationId, type Task } from "./domain.js"
import {
  type ImplementationConvergenceSubject,
  PriorImplementationReviewEvidence
} from "./implementation-convergence.js"
import type { SealedImplementationEvidence } from "./implementation-evidence.js"
import type { SealedImplementationReview } from "./implementation-review.js"
import {
  type RunnableFrontierTransition,
  RunnableFrontierTransition as FrontierTransition
} from "./runnable-frontier.js"
import type { OperationIdAllocatorService } from "./task-work-planning.js"
import type { TaskWorktreeExecutionModeContradiction } from "./task-worktree-reconciliation.js"
import type { TraceOutputError } from "./trace-output.js"
import type { makeImplementationReviewOperation, makeReviewFindingsHandbackOperation } from "./workflow-operation.js"
import type { TraceItem, WorkflowInterpreterService } from "./workflow.js"

type InterpreterOperation = WorkflowInterpreterService[keyof WorkflowInterpreterService]

export type AuthoritativeImplementationConvergenceResult = Extract<
  Effect.Success<
    ReturnType<WorkflowInterpreterService["recordImplementationDisposition"]>
  >,
  { readonly _tag: "AuthoritativeImplementationConvergenceDisposition" }
>

export type FreshImplementationConvergenceStageError =
  | Effect.Error<ReturnType<InterpreterOperation>>
  | TaskWorktreeExecutionModeContradiction
  | TraceOutputError

// eslint-disable-next-line functional/no-mixed-types -- A process-local stage deliberately pairs immutable selection with its sole executable operation.
export interface FreshImplementationConvergenceStage {
  readonly transition: RunnableFrontierTransition
  readonly run: (
    recordActivationIntent: (operationId: OperationId) => Effect.Effect<void>
  ) => Effect.Effect<
    FreshImplementationConvergenceStage | undefined,
    FreshImplementationConvergenceStageError
  >
}

// eslint-disable-next-line functional/no-mixed-types -- Dependencies and the serialized trace emitter form one stage factory input.
export interface FreshImplementationConvergenceOptions {
  readonly allocator: OperationIdAllocatorService
  readonly emit: (item: TraceItem) => Effect.Effect<void, TraceOutputError>
  readonly initialCompletedHandbackOperationId?: OperationId
  readonly initialHandbackOperation?: ReturnType<
    typeof makeReviewFindingsHandbackOperation
  >
  readonly initialPreviousReview?: SealedImplementationReview
  readonly initialReview?: SealedImplementationReview
  readonly initialReviewOperation?: ReturnType<
    typeof makeImplementationReviewOperation
  >
  readonly initialRound?: number
  readonly initialSealedEvidence?: {
    readonly operationId: OperationId
    readonly sealed: SealedImplementationEvidence
  }
  readonly interpreter: WorkflowInterpreterService
  readonly onCompleted?: (
    result: AuthoritativeImplementationConvergenceResult
  ) => Effect.Effect<void>
  readonly roundLimit: ImplementationReviewRoundLimit
  readonly subject: ImplementationConvergenceSubject
  readonly task: Task
}

export const freshImplementationTransition = (
  operationId: OperationId,
  task: Task,
  requiresTaskAdmission: boolean
): RunnableFrontierTransition =>
  FrontierTransition.ContinueFreshWorkflowOperation({
    operationId,
    requiresTaskAdmission,
    taskId: task.id
  })

export const priorImplementationReviewEvidence = (
  review: SealedImplementationReview | undefined
): PriorImplementationReviewEvidence =>
  review === undefined
    ? PriorImplementationReviewEvidence.cases.NoPriorReviewEvidence.make({})
    : PriorImplementationReviewEvidence.cases.PriorReviewEvidence.make({
      review
    })
