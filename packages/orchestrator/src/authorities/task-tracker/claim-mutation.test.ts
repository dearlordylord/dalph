import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import { TaskId } from "@dalph/contracts"
import {
  ClaimOwner,
  ClaimToken,
  controlledTrackerMutationLayer,
  controlledTrackerMutationLayerFrom,
  OperationId,
  TaskClaimAcquisition,
  TaskClaimConflict,
  TaskClaimOwnershipConflict,
  TaskClaimRelease,
  TrackerMutation
} from "../../index.js"
import type { ActiveTaskClaim } from "../../index.js"
import {
  trackerMutationContract,
  trackerMutationContractFixture
} from "../../../test/contracts/tracker-mutation-contract.js"

const taskId = TaskId.make("tracker-task")

const acquisition = (operation: string, owner: string, token: string) =>
  TaskClaimAcquisition.make({
    operationId: OperationId.make(operation),
    owner: ClaimOwner.make(owner),
    taskId,
    token: ClaimToken.make(token)
  })

const release = (claim: ActiveTaskClaim, operation: string) =>
  TaskClaimRelease.make({ claim, operationId: OperationId.make(operation) })

trackerMutationContract({
  ...trackerMutationContractFixture(taskId, "controlled"),
  layer: controlledTrackerMutationLayer
})

describe("controlled TrackerMutation contract", () => {
  it.effect("starts from the exact claims supplied by reconstruction", () => {
    const initial = { _tag: "ActiveTaskClaim" as const, ...acquisition("preloaded", "owner", "token") }
    return Effect.gen(function* () {
      expect(yield* (yield* TrackerMutation).readTaskClaim(taskId)).toEqual(initial)
    }).pipe(Effect.provide(controlledTrackerMutationLayerFrom([initial])))
  })

  it.effect("gives exactly one of two competing acquisitions ownership", () =>
    Effect.gen(function* () {
      const tracker = yield* TrackerMutation
      const attempts = yield* Effect.all(
        [
          tracker.acquireTaskClaim(acquisition("acquire-a", "owner-a", "token-a")),
          tracker.acquireTaskClaim(acquisition("acquire-b", "owner-b", "token-b"))
        ].map(Effect.result),
        { concurrency: "unbounded" }
      )

      const successes = attempts.filter((attempt) => attempt._tag === "Success")
      const failures = attempts.filter((attempt) => attempt._tag === "Failure")
      expect(successes).toHaveLength(1)
      expect(failures).toHaveLength(1)
      expect(failures[0]?.failure).toBeInstanceOf(TaskClaimConflict)

      const observation = yield* tracker.readTaskClaim(taskId)
      expect(observation._tag).toBe("ActiveTaskClaim")
      if (observation._tag !== "ActiveTaskClaim") return
      expect(successes[0]?.success).toEqual(observation)
    }).pipe(Effect.provide(controlledTrackerMutationLayer))
  )

  it.effect("rejects foreign and stale release capabilities", () =>
    Effect.gen(function* () {
      const tracker = yield* TrackerMutation
      const first = yield* tracker.acquireTaskClaim(acquisition("acquire-first", "owner-first", "token-first"))
      const foreignFailure = yield* tracker
        .releaseTaskClaim(release({ ...first, owner: ClaimOwner.make("foreign-owner") }, "release-foreign"))
        .pipe(Effect.flip)
      expect(foreignFailure).toBeInstanceOf(TaskClaimOwnershipConflict)

      yield* tracker.releaseTaskClaim(release(first, "release-first"))
      const second = yield* tracker.acquireTaskClaim(acquisition("acquire-second", "owner-second", "token-second"))
      const staleFailure = yield* tracker.releaseTaskClaim(release(first, "release-stale")).pipe(Effect.flip)

      expect(staleFailure).toBeInstanceOf(TaskClaimOwnershipConflict)
      expect(yield* tracker.readTaskClaim(taskId)).toEqual(second)
    }).pipe(Effect.provide(controlledTrackerMutationLayer))
  )

  it.effect("makes exact acquisition idempotent and rejects release after deletion", () =>
    Effect.gen(function* () {
      const tracker = yield* TrackerMutation
      const requested = acquisition("idempotent", "owner", "token")
      const first = yield* tracker.acquireTaskClaim(requested)
      expect(yield* tracker.acquireTaskClaim(requested)).toEqual(first)
      yield* tracker.releaseTaskClaim(release(first, "release-idempotent"))

      const failure = yield* tracker.releaseTaskClaim(release(first, "release-after-deletion")).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(TaskClaimOwnershipConflict)
    }).pipe(Effect.provide(controlledTrackerMutationLayer))
  )
})
