import { Schema } from "effect"
import { OperationId, ProviderObservationId, TaskId, TechnicalRetryNotBefore } from "./domain.js"

/**
 * Transitional pre-#158 correlation.
 *
 * The accepted v1 boundary correlates the executor's complete work by the
 * planned task attempt's RunId and AttemptId. It does not allocate a separate
 * outer-invocation identity. This OperationId-based shape leaks review-loop
 * internal operations into generic orchestration and must not be treated as
 * the target contract when implementing #158.
 */
export const ExecutorOuterInvocationCorrelation = Schema.Struct({
  invocationId: OperationId,
  taskId: TaskId
})
export type ExecutorOuterInvocationCorrelation = typeof ExecutorOuterInvocationCorrelation.Type

/**
 * Transitional pre-#158 resource-use declaration.
 *
 * The accepted milestone rule keeps one position for the complete planned
 * attempt until terminal outcome or safe suspension. The executor does not
 * declare capacity.
 */
export const ExecutorOuterInvocationResourceUse = Schema.TaggedUnion({
  DoesNotUseTaskWorkCapacity: {},
  UsesTaskWorkCapacity: { positions: Schema.Literal(1) }
})
export type ExecutorOuterInvocationResourceUse = typeof ExecutorOuterInvocationResourceUse.Type

/**
 * Transitional pre-#158 projection subject.
 *
 * The target generic subject is the selected executor's complete work for one
 * planned task attempt, not one evidence, review, handback, or provider
 * operation presented as an outer invocation.
 */
export const ExecutorOuterInvocation = Schema.Struct({
  correlation: ExecutorOuterInvocationCorrelation,
  resourceUse: ExecutorOuterInvocationResourceUse
})
export type ExecutorOuterInvocation = typeof ExecutorOuterInvocation.Type

/** Transitional pre-#158 wait for one leaked internal operation. */
export const ExecutorOuterInvocationWait = Schema.TaggedUnion({
  RetryScheduled: {
    correlation: ExecutorOuterInvocationCorrelation,
    notBefore: TechnicalRetryNotBefore
  }
})
export type ExecutorOuterInvocationWait = typeof ExecutorOuterInvocationWait.Type

/**
 * Transitional pre-#158 interruption shape.
 *
 * The target generic fact is that all executor work for the planned attempt is
 * safely suspended and resumable. One provider observation or interrupted
 * internal operation cannot establish that fact by itself.
 */
export const ExecutorOuterInvocationInterruption = Schema.Struct({
  correlation: ExecutorOuterInvocationCorrelation,
  observationId: ProviderObservationId
})
export type ExecutorOuterInvocationInterruption = typeof ExecutorOuterInvocationInterruption.Type

/** Transitional pre-#158 outcome for one leaked internal operation. */
export const ExecutorOuterInvocationOutcome = Schema.TaggedUnion({
  Completed: {
    correlation: ExecutorOuterInvocationCorrelation
  },
  Failed: {
    correlation: ExecutorOuterInvocationCorrelation
  },
  Interrupted: {
    interruption: ExecutorOuterInvocationInterruption
  },
  NonConvergent: {
    correlation: ExecutorOuterInvocationCorrelation
  }
})
export type ExecutorOuterInvocationOutcome = typeof ExecutorOuterInvocationOutcome.Type

/**
 * Transitional pre-#158 projection. The target projects complete executor
 * work for one planned attempt identified by RunId plus AttemptId.
 */
export const ExecutorOuterInvocationProjection = Schema.TaggedUnion({
  Ready: {},
  Waiting: {
    wait: ExecutorOuterInvocationWait
  },
  Completed: {
    outcome: ExecutorOuterInvocationOutcome
  }
})
export type ExecutorOuterInvocationProjection = typeof ExecutorOuterInvocationProjection.Type

export const noTaskWorkCapacityUse = ExecutorOuterInvocationResourceUse.cases.DoesNotUseTaskWorkCapacity.make({})

export const oneTaskWorkCapacityPosition = ExecutorOuterInvocationResourceUse.cases.UsesTaskWorkCapacity.make({
  positions: 1
})

export const makeExecutorOuterInvocation = (
  invocationId: typeof OperationId.Type,
  taskId: typeof TaskId.Type,
  resourceUse: ExecutorOuterInvocationResourceUse
): ExecutorOuterInvocation =>
  ExecutorOuterInvocation.make({
    correlation: { invocationId, taskId },
    resourceUse
  })
