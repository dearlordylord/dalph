import { Schema } from "effect"
import { OperationId, ProviderObservationId, TaskId, TechnicalRetryNotBefore } from "./domain.js"

/**
 * The exact Dalph identity used to correlate one executor-declared outer
 * invocation across intent, provider observation, interruption, and outcome.
 */
export const ExecutorOuterInvocationCorrelation = Schema.Struct({
  invocationId: OperationId,
  taskId: TaskId
})
export type ExecutorOuterInvocationCorrelation = typeof ExecutorOuterInvocationCorrelation.Type

/**
 * The task-work capacity used by one executor-declared outer invocation.
 * The current admission protocol allocates at most one position per task.
 */
export const ExecutorOuterInvocationResourceUse = Schema.TaggedUnion({
  DoesNotUseTaskWorkCapacity: {},
  UsesTaskWorkCapacity: { positions: Schema.Literal(1) }
})
export type ExecutorOuterInvocationResourceUse = typeof ExecutorOuterInvocationResourceUse.Type

/** One opaque outer invocation declared by the selected Dalph executor. */
export const ExecutorOuterInvocation = Schema.Struct({
  correlation: ExecutorOuterInvocationCorrelation,
  resourceUse: ExecutorOuterInvocationResourceUse
})
export type ExecutorOuterInvocation = typeof ExecutorOuterInvocation.Type

/** A named reason that Dalph cannot yet continue one outer invocation. */
export const ExecutorOuterInvocationWait = Schema.TaggedUnion({
  RetryScheduled: {
    correlation: ExecutorOuterInvocationCorrelation,
    notBefore: TechnicalRetryNotBefore
  }
})
export type ExecutorOuterInvocationWait = typeof ExecutorOuterInvocationWait.Type

/** A provider-confirmed interruption of one exact outer invocation. */
export const ExecutorOuterInvocationInterruption = Schema.Struct({
  correlation: ExecutorOuterInvocationCorrelation,
  observationId: ProviderObservationId
})
export type ExecutorOuterInvocationInterruption = typeof ExecutorOuterInvocationInterruption.Type

/** The normalized result Dalph records for one exact outer invocation. */
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
 * The selected executor's current outer view of one invocation. Generic
 * frontier derivation uses this declaration without inspecting inner events.
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
