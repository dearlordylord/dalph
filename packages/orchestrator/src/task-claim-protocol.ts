import { Effect, Schedule, Schema } from "effect"
import type { CoordinatorOwnershipError } from "./coordinator-lock.js"
import {
  ActiveTaskClaim,
  isExactTaskClaim,
  TaskClaimAcquisition,
  TaskClaimConflict,
  type TaskClaimReadFailure,
  TaskClaimRequestFailure,
  type TrackerMutationService
} from "./tracker-mutation.js"

/** A bounded claim acquisition never reached an authoritative owned claim. */
export class TaskClaimAcquisitionDidNotConverge extends Schema.TaggedErrorClass<TaskClaimAcquisitionDidNotConverge>()(
  "TaskClaimAcquisitionDidNotConverge",
  {
    acquisition: TaskClaimAcquisition,
    attempts: Schema.Int
  }
) {}

class RepeatTaskClaimObservation extends Schema.TaggedErrorClass<RepeatTaskClaimObservation>()(
  "RepeatTaskClaimObservation",
  {}
) {}

const taskClaimObservationBound = 3
const taskClaimAcquisitionSchedule = Schedule.recurs(
  taskClaimObservationBound - 1
).pipe(
  Schedule.while(({ input }) => input instanceof RepeatTaskClaimObservation)
)

/**
 * Acquires one exact claim through fresh tracker observations. Every request,
 * including a repeat after an unknown outcome, is preceded and followed by a
 * tracker read.
 */
export const runTaskClaimAcquisitionProtocol = Effect.fn(
  "TrackerMutation.runTaskClaimAcquisitionProtocol"
)(function*(
  tracker: TrackerMutationService,
  acquisition: TaskClaimAcquisition
) {
  const attemptedClaim = ActiveTaskClaim.make(acquisition)
  const pass = Effect.gen(function*() {
    const observation = yield* tracker.readTaskClaim(acquisition.taskId)
    if (observation._tag === "ActiveTaskClaim") {
      return isExactTaskClaim(observation, attemptedClaim)
        ? observation
        : yield* new TaskClaimConflict({
          attempted: acquisition,
          observed: observation
        })
    }

    // A fresh unclaimed observation authorizes either the first request or a
    // repeat of an earlier request whose outcome was uncertain.
    const result = yield* tracker.acquireTaskClaim(acquisition).pipe(
      Effect.result
    )
    if (result._tag === "Failure") {
      if (result.failure instanceof TaskClaimConflict) {
        return yield* result.failure
      }
      if (!(result.failure instanceof TaskClaimRequestFailure)) {
        return yield* result.failure
      }
    }
    return yield* new RepeatTaskClaimObservation()
  })

  return yield* pass.pipe(
    Effect.retryOrElse(
      taskClaimAcquisitionSchedule,
      (failure): Effect.Effect<
        ActiveTaskClaim,
        | TaskClaimAcquisitionDidNotConverge
        | CoordinatorOwnershipError
        | TaskClaimConflict
        | TaskClaimReadFailure
        | TaskClaimRequestFailure
      > =>
        failure instanceof RepeatTaskClaimObservation
          ? Effect.fail(
            new TaskClaimAcquisitionDidNotConverge({
              acquisition,
              attempts: taskClaimObservationBound
            })
          )
          : Effect.fail(failure)
    )
  )
})
