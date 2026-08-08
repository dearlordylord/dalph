import { Effect, Schedule, Schema } from "effect"
import { TaskId } from "@dalph/contracts"
import type { TaskClaimObservation, TrackerMutationService } from "../../../authorities/task-tracker/claim-mutation.js"
import { taskClaimObservationAttemptBound } from "./bound.js"

/** Three authoritative reads could not establish the current task claim. */
export class TaskClaimObservationDidNotConverge extends Schema.TaggedErrorClass<TaskClaimObservationDidNotConverge>()(
  "TaskClaimObservationDidNotConverge",
  { attempts: Schema.Literal(taskClaimObservationAttemptBound), detail: Schema.String, taskId: TaskId }
) {}

/**
 * Reads one task's claim up to three times without authorizing a mutation.
 * A successful missing, foreign, or exact observation is returned unchanged.
 */
export const observeTaskClaim = Effect.fn("TrackerMutation.observeTaskClaim")(function* (
  tracker: TrackerMutationService,
  taskId: TaskId
): Effect.fn.Return<TaskClaimObservation, TaskClaimObservationDidNotConverge> {
  const result = yield* tracker
    .readTaskClaim(taskId)
    .pipe(Effect.retry(Schedule.recurs(taskClaimObservationAttemptBound - 1)), Effect.result)
  return result._tag === "Success"
    ? result.success
    : yield* new TaskClaimObservationDidNotConverge({
        attempts: taskClaimObservationAttemptBound,
        detail: result.failure.detail,
        taskId
      })
})
