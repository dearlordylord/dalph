import type { Effect } from "effect"
import { type ImplementationReviewRoundLimit, type OperationId, type SemanticReviewRound, type Task } from "./domain.js"
import {
  type ExecutorOuterInvocationResourceUse,
  makeExecutorOuterInvocation,
  noTaskWorkCapacityUse,
  oneTaskWorkCapacityPosition
} from "./executor-boundary.js"
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

type InterpreterError = {
  [Key in keyof WorkflowInterpreterService]: Effect.Error<
    ReturnType<WorkflowInterpreterService[Key]>
  >
}[keyof WorkflowInterpreterService]

export type AuthoritativeImplementationConvergenceResult = Extract<
  Effect.Success<
    ReturnType<WorkflowInterpreterService["recordImplementationDisposition"]>
  >,
  { readonly _tag: "AuthoritativeImplementationConvergenceDisposition" }
>

export type FreshImplementationConvergenceStageError =
  | InterpreterError
  | TaskWorktreeExecutionModeContradiction
  | TraceOutputError

export { noTaskWorkCapacityUse, oneTaskWorkCapacityPosition }

/** The one durable convergence fact from which the next operation is rebuilt. */
type ImplementationConvergenceStart =
  | {
    readonly _tag: "ExecutionOutcome"
    readonly previousReview?: SealedImplementationReview
    readonly round: SemanticReviewRound
  }
  | {
    readonly _tag: "EvidenceSealed"
    readonly evidence: {
      readonly operationId: OperationId
      readonly sealed: SealedImplementationEvidence
    }
    readonly previousReview?: SealedImplementationReview
    readonly round: SemanticReviewRound
  }
  | {
    readonly _tag: "ReviewIntended"
    readonly operation: ReturnType<typeof makeImplementationReviewOperation>
    readonly previousReview?: SealedImplementationReview
    readonly round: SemanticReviewRound
  }
  | {
    readonly _tag: "ReviewCompleted"
    readonly handbackOperation?: ReturnType<
      typeof makeReviewFindingsHandbackOperation
    >
    readonly review: SealedImplementationReview
    readonly round: SemanticReviewRound
  }
  | {
    readonly _tag: "HandbackCompleted"
    readonly operationId: OperationId
    readonly previousReview: SealedImplementationReview
    readonly round: SemanticReviewRound
  }

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
  readonly interpreter: WorkflowInterpreterService
  readonly onCompleted?: (
    result: AuthoritativeImplementationConvergenceResult
  ) => Effect.Effect<void>
  readonly roundLimit: ImplementationReviewRoundLimit
  readonly start: ImplementationConvergenceStart
  readonly subject: ImplementationConvergenceSubject
  readonly task: Task
}

export const freshImplementationTransition = (
  operationId: OperationId,
  task: Task,
  resourceUse: ExecutorOuterInvocationResourceUse
): RunnableFrontierTransition =>
  FrontierTransition.StartExecutorInvocation({
    invocation: makeExecutorOuterInvocation(
      operationId,
      task.id,
      resourceUse
    )
  })

export const continuedImplementationTransition = (
  operationId: OperationId,
  task: Task,
  resourceUse: ExecutorOuterInvocationResourceUse
): RunnableFrontierTransition =>
  FrontierTransition.ContinueExecutorInvocation({
    invocation: makeExecutorOuterInvocation(
      operationId,
      task.id,
      resourceUse
    )
  })

export const priorImplementationReviewEvidence = (
  review: SealedImplementationReview | undefined
): PriorImplementationReviewEvidence =>
  review === undefined
    ? PriorImplementationReviewEvidence.cases.NoPriorReviewEvidence.make({})
    : PriorImplementationReviewEvidence.cases.PriorReviewEvidence.make({
      review
    })
