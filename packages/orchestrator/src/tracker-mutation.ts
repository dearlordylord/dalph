/* eslint-disable functional/immutable-data -- Atomic test-adapter maps are copied before each private update. */
import { Context, Effect, Layer, Ref, Schema } from "effect"
import type { CoordinatorOwnershipError } from "./coordinator-lock.js"
import { ClaimOwner, ClaimToken, OperationId, TaskId } from "./domain.js"

/** Requests atomic ownership of one tracker task under one stable operation. */
export const TaskClaimAcquisition = Schema.Struct({
  operationId: OperationId,
  owner: ClaimOwner,
  taskId: TaskId,
  token: ClaimToken
})
export type TaskClaimAcquisition = typeof TaskClaimAcquisition.Type

/**
 * The tracker record proving one exact owner/token pair owns a task. It is
 * distinct from task selection, task-work capacity, and coordinator ownership.
 */
export const ActiveTaskClaim = Schema.TaggedStruct("ActiveTaskClaim", {
  operationId: OperationId,
  owner: ClaimOwner,
  taskId: TaskId,
  token: ClaimToken
})
export type ActiveTaskClaim = typeof ActiveTaskClaim.Type

/** Proves that the task tracker currently records no claim for one task. */
export const UnclaimedTask = Schema.TaggedStruct("UnclaimedTask", {
  taskId: TaskId
})
export type UnclaimedTask = typeof UnclaimedTask.Type

/** One authoritative task-claim observation read from the task tracker. */
export const TaskClaimObservation = Schema.Union([
  ActiveTaskClaim,
  UnclaimedTask
])
export type TaskClaimObservation = typeof TaskClaimObservation.Type

/** Atomic acquisition found a different exact tracker-owned claim. */
export class TaskClaimConflict extends Schema.TaggedErrorClass<TaskClaimConflict>()(
  "TrackerMutation.TaskClaimConflict",
  {
    attempted: TaskClaimAcquisition,
    observed: ActiveTaskClaim
  }
) {}

/** Release did not name the exact current owner/token claim capability. */
export class TaskClaimOwnershipConflict extends Schema.TaggedErrorClass<TaskClaimOwnershipConflict>()(
  "TrackerMutation.TaskClaimOwnershipConflict",
  {
    attempted: ActiveTaskClaim,
    observed: TaskClaimObservation
  }
) {}

const TaskClaimRequestOutcome = Schema.Literals([
  "DefinitelyNotApplied",
  "Unknown"
])

/** A task-tracker request failed with an explicit external-outcome classification. */
export class TaskClaimRequestFailure extends Schema.TaggedErrorClass<TaskClaimRequestFailure>()(
  "TrackerMutation.TaskClaimRequestFailure",
  {
    acquisition: TaskClaimAcquisition,
    detail: Schema.String,
    outcome: TaskClaimRequestOutcome
  }
) {}

/** The task tracker could not provide a fresh authoritative claim observation. */
export class TaskClaimReadFailure extends Schema.TaggedErrorClass<TaskClaimReadFailure>()(
  "TrackerMutation.TaskClaimReadFailure",
  {
    detail: Schema.String,
    taskId: TaskId
  }
) {}

/** A release request returned without proving whether the exact claim was deleted. */
export class TaskClaimReleaseFailure extends Schema.TaggedErrorClass<TaskClaimReleaseFailure>()(
  "TrackerMutation.TaskClaimReleaseFailure",
  {
    claim: ActiveTaskClaim,
    detail: Schema.String
  }
) {}

export interface TrackerMutationService {
  readonly acquireTaskClaim: (
    acquisition: TaskClaimAcquisition
  ) => Effect.Effect<
    ActiveTaskClaim,
    | CoordinatorOwnershipError
    | TaskClaimConflict
    | TaskClaimReadFailure
    | TaskClaimRequestFailure
  >
  readonly readTaskClaim: (
    taskId: TaskId
  ) => Effect.Effect<TaskClaimObservation, TaskClaimReadFailure>
  readonly releaseTaskClaim: (
    claim: ActiveTaskClaim
  ) => Effect.Effect<
    void,
    | CoordinatorOwnershipError
    | TaskClaimOwnershipConflict
    | TaskClaimReadFailure
    | TaskClaimReleaseFailure
  >
}

/** Changes and rereads task claims through the configured task tracker. */
export class TrackerMutation extends Context.Service<
  TrackerMutation,
  TrackerMutationService
>()("@dalph/TrackerMutation") {}

const claimFrom = (acquisition: TaskClaimAcquisition): ActiveTaskClaim => ActiveTaskClaim.make(acquisition)

export const isExactTaskClaim = (
  left: ActiveTaskClaim,
  right: ActiveTaskClaim
): boolean =>
  left.operationId === right.operationId
  && left.owner === right.owner
  && left.taskId === right.taskId
  && left.token === right.token

/** In-memory atomic adapter used by shared contracts and live-fake workflows. */
export const controlledTrackerMutationLayer = Layer.effect(
  TrackerMutation,
  Effect.gen(function*() {
    const claims = yield* Ref.make<ReadonlyMap<TaskId, ActiveTaskClaim>>(
      new Map()
    )
    const readTaskClaim = Effect.fn("TrackerMutation.Controlled.readTaskClaim")(
      function*(taskId: TaskId) {
        const current = yield* Ref.get(claims)
        return current.get(taskId) ?? UnclaimedTask.make({ taskId })
      }
    )
    const acquireTaskClaim = Effect.fn(
      "TrackerMutation.Controlled.acquireTaskClaim"
    )(function*(acquisition: TaskClaimAcquisition) {
      const attempted = claimFrom(acquisition)
      const result = yield* Ref.modify(claims, (current) => {
        const observed = current.get(acquisition.taskId)
        if (observed === undefined) {
          const next = new Map(current)
          next.set(acquisition.taskId, attempted)
          return [{ _tag: "Acquired", claim: attempted } as const, next]
        }
        return [
          isExactTaskClaim(observed, attempted)
            ? { _tag: "Acquired", claim: observed } as const
            : { _tag: "Conflict", claim: observed } as const,
          current
        ]
      })
      return result._tag === "Acquired"
        ? result.claim
        : yield* new TaskClaimConflict({
          attempted: acquisition,
          observed: result.claim
        })
    })
    const releaseTaskClaim = Effect.fn(
      "TrackerMutation.Controlled.releaseTaskClaim"
    )(function*(attempted: ActiveTaskClaim) {
      type ReleaseResult =
        | { readonly _tag: "Released" }
        | {
          readonly _tag: "Conflict"
          readonly observed: TaskClaimObservation
        }
      const result: ReleaseResult = yield* Ref.modify(
        claims,
        (current): readonly [ReleaseResult, ReadonlyMap<TaskId, ActiveTaskClaim>] => {
          const observed = current.get(attempted.taskId)
          if (observed !== undefined && isExactTaskClaim(observed, attempted)) {
            const next = new Map(current)
            next.delete(attempted.taskId)
            return [{ _tag: "Released" }, next]
          }
          return [
            {
              _tag: "Conflict",
              observed: observed ?? UnclaimedTask.make({ taskId: attempted.taskId })
            },
            current
          ]
        }
      )
      if (result._tag === "Conflict") {
        return yield* new TaskClaimOwnershipConflict({
          attempted,
          observed: result.observed
        })
      }
    })
    return TrackerMutation.of({
      acquireTaskClaim,
      readTaskClaim,
      releaseTaskClaim
    })
  })
)
