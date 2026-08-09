import { Effect, Schema } from "effect"
import {
  isExactTaskClaim,
  TaskClaimOwnershipConflict,
  type TaskClaimReadFailure,
  TaskClaimRelease,
  TaskClaimReleaseFailure,
  type TrackerMutationService
} from "../../../authorities/task-tracker/claim-mutation.js"
import type { CoordinatorOwnershipError } from "../../../authorities/coordinator-ownership/ownership.js"

const taskClaimReleaseRequestBound = 3

/** Three exact release requests completed without authoritative absence. */
export class TaskClaimReleaseDidNotConverge extends Schema.TaggedError<TaskClaimReleaseDidNotConverge>()(
  "TaskClaimReleaseDidNotConverge",
  { attempts: Schema.Int, release: TaskClaimRelease }
) {}

/** The tracker freshly proved that the exact release capability is absent. */
export const AuthoritativeTaskClaimReleased = Schema.TaggedStruct("AuthoritativeTaskClaimReleased", {
  release: TaskClaimRelease
})

/**
 * Checks the current claim before every release request and checks again after
 * every acknowledgement or ambiguous failure. A foreign replacement is never
 * edited.
 */
export const runTaskClaimReleaseProtocol = Effect.fn("TrackerMutation.runTaskClaimReleaseProtocol")(function* (
  tracker: TrackerMutationService,
  release: TaskClaimRelease
): Effect.fn.Return<
  typeof AuthoritativeTaskClaimReleased.Type,
  | CoordinatorOwnershipError
  | TaskClaimOwnershipConflict
  | TaskClaimReadFailure
  | TaskClaimReleaseDidNotConverge
  | TaskClaimReleaseFailure
> {
  for (let attempts = 0; attempts <= taskClaimReleaseRequestBound; attempts += 1) {
    const observed = yield* tracker.readTaskClaim(release.claim.taskId)
    if (observed._tag === "UnclaimedTask") {
      return AuthoritativeTaskClaimReleased.make({ release })
    }
    if (!isExactTaskClaim(observed, release.claim)) {
      return yield* new TaskClaimOwnershipConflict({ attempted: release.claim, observed })
    }
    if (attempts === taskClaimReleaseRequestBound) {
      return yield* new TaskClaimReleaseDidNotConverge({ attempts, release })
    }
    const request = yield* Effect.result(tracker.releaseTaskClaim(release))
    if (request._tag === "Failure" && !(request.failure instanceof TaskClaimReleaseFailure)) {
      return yield* request.failure
    }
  }
  return yield* new TaskClaimReleaseDidNotConverge({ attempts: taskClaimReleaseRequestBound, release })
})
