import { Schema } from "effect"
import {
  ExecutorOuterInvocationId,
  type OperationId,
  ProviderObservationId,
  TaskId,
  TechnicalRetryNotBefore
} from "./domain.js"

/**
 * Transitional #158 adapter for the current colocated review-loop executor.
 * New generic code must receive an independently allocated outer identity.
 */
export const executorOuterInvocationIdForOperation = (
  operationId: OperationId
): typeof ExecutorOuterInvocationId.Type => ExecutorOuterInvocationId.make(operationId)

/**
 * The exact Dalph identity used to correlate one executor-declared outer
 * invocation across intent, normalized executor reports, interruption, and
 * outcome.
 */
export const ExecutorOuterInvocationCorrelation = Schema.Struct({
  invocationId: ExecutorOuterInvocationId,
  taskId: TaskId
})
export type ExecutorOuterInvocationCorrelation = typeof ExecutorOuterInvocationCorrelation.Type

/** One opaque outer invocation reported by the selected Dalph executor. */
export const ExecutorOuterInvocation = Schema.Struct({
  correlation: ExecutorOuterInvocationCorrelation
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

export const makeExecutorOuterInvocation = (
  invocationId: typeof ExecutorOuterInvocationId.Type,
  taskId: typeof TaskId.Type
): ExecutorOuterInvocation =>
  ExecutorOuterInvocation.make({
    correlation: { invocationId, taskId }
  })
