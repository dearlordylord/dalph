import { Effect, Schedule, Schema } from "effect"
import type { CoordinatorOwnershipError } from "../../../authorities/coordinator-ownership/ownership.js"
import {
  ActiveTaskClaim,
  type ActiveTaskClaim as ActiveTaskClaimValue,
  isExactTaskClaim,
  TaskClaimAcquisition,
  TaskClaimConflict,
  type TaskClaimReadFailure,
  TaskClaimRequestFailure,
  type TrackerMutationService
} from "../../../authorities/task-tracker/claim-mutation.js"

/** A bounded claim acquisition never reached an authoritative owned claim. */
export class TaskClaimAcquisitionDidNotConverge extends Schema.TaggedError<TaskClaimAcquisitionDidNotConverge>()(
  "TaskClaimAcquisitionDidNotConverge",
  { acquisition: TaskClaimAcquisition, attempts: Schema.Int }
) {}

class RepeatTaskClaimObservation extends Schema.TaggedError<RepeatTaskClaimObservation>()(
  "RepeatTaskClaimObservation",
  {}
) {}

const maximumTaskClaimRequestCount = 3
const taskClaimAcquisitionSchedule = Schedule.recurs(maximumTaskClaimRequestCount - 1).pipe(
  Schedule.while(({ input }) => input instanceof RepeatTaskClaimObservation)
)

const acceptObservedActiveClaim = (
  observation: ActiveTaskClaimValue,
  attemptedClaim: ActiveTaskClaimValue,
  acquisition: TaskClaimAcquisition
): Effect.Effect<ActiveTaskClaimValue, TaskClaimConflict> =>
  isExactTaskClaim(observation, attemptedClaim)
    ? Effect.succeed(observation)
    : Effect.fail(new TaskClaimConflict({ attempted: acquisition, observed: observation }))

/**
 * Acquires one exact claim through fresh tracker observations. Every request,
 * including a repeat after an unknown outcome, is preceded and followed by a
 * tracker read.
 */
export const runTaskClaimAcquisitionProtocol = Effect.fn("TrackerMutation.runTaskClaimAcquisitionProtocol")(function* (
  tracker: TrackerMutationService,
  acquisition: TaskClaimAcquisition
) {
  const attemptedClaim = ActiveTaskClaim.make(acquisition)
  const pass = Effect.gen(function* () {
    const observation = yield* tracker.readTaskClaim(acquisition.taskId)
    if (observation._tag === "ActiveTaskClaim") {
      return yield* acceptObservedActiveClaim(observation, attemptedClaim, acquisition)
    }

    // A fresh unclaimed observation authorizes either the first request or a
    // repeat of an earlier request whose outcome was uncertain.
    const result = yield* tracker.acquireTaskClaim(acquisition).pipe(Effect.result)
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
      (
        failure
      ): Effect.Effect<
        ActiveTaskClaim,
        | TaskClaimAcquisitionDidNotConverge
        | CoordinatorOwnershipError
        | TaskClaimConflict
        | TaskClaimReadFailure
        | TaskClaimRequestFailure
      > =>
        failure instanceof RepeatTaskClaimObservation
          ? Effect.gen(function* () {
              // The final allowed request is ambiguous just like every other
              // request, so reconcile it with one last authoritative read.
              const observation = yield* tracker.readTaskClaim(acquisition.taskId)
              if (observation._tag === "ActiveTaskClaim") {
                return yield* acceptObservedActiveClaim(observation, attemptedClaim, acquisition)
              }
              return yield* new TaskClaimAcquisitionDidNotConverge({
                acquisition,
                attempts: maximumTaskClaimRequestCount
              })
            })
          : Effect.fail(failure)
    )
  )
})
