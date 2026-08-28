import { Schema } from "effect"
import { OperationId } from "../../workflow/identity.js"

/** Seconds a provider asked Dalph to wait before another request; this is diagnostic evidence, not retry authority. */
export const TaskTrackerThrottleRetryAfterSeconds = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("TaskTrackerThrottleRetryAfterSeconds")
)
export type TaskTrackerThrottleRetryAfterSeconds = typeof TaskTrackerThrottleRetryAfterSeconds.Type

/** UTC epoch second when a provider's current rate-limit window resets; this is diagnostic evidence, not retry authority. */
export const TaskTrackerThrottleResetEpochSeconds = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("TaskTrackerThrottleResetEpochSeconds")
)
export type TaskTrackerThrottleResetEpochSeconds = typeof TaskTrackerThrottleResetEpochSeconds.Type

/** Safe provider timing evidence retained without scheduling or authorizing another tracker request. */
export const TaskTrackerThrottleTimingEvidence = Schema.TaggedUnion({
  ResetAt: { epochSeconds: TaskTrackerThrottleResetEpochSeconds },
  RetryAfter: { seconds: TaskTrackerThrottleRetryAfterSeconds }
})
export type TaskTrackerThrottleTimingEvidence = typeof TaskTrackerThrottleTimingEvidence.Type

/** The closed tracker-mutation families that can be stopped by one provider throttle. */
export const taskTrackerMutationOperations = [
  "AcquireTaskClaim",
  "ReleaseTaskClaim",
  "ReplaceCompletionClaim",
  "DeleteCompletionClaim",
  "CompleteTask"
] as const
export const TaskTrackerMutationOperation = Schema.Literals(taskTrackerMutationOperations)
export type TaskTrackerMutationOperation = typeof TaskTrackerMutationOperation.Type

/**
 * The task tracker conclusively refused one acknowledged mutation because of
 * provider throttling. The existing intent remains the only recovery authority.
 */
export class TaskTrackerMutationThrottled extends Schema.TaggedError<TaskTrackerMutationThrottled>()(
  "TaskTrackerMutationThrottled",
  {
    detail: Schema.String,
    operation: TaskTrackerMutationOperation,
    operationId: OperationId,
    timingEvidence: Schema.NullOr(TaskTrackerThrottleTimingEvidence)
  }
) {}
