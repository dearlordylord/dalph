import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import { TaskId } from "@dalph/contracts"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ClaimToken,
  OperationId,
  TaskClaimOwnershipConflict,
  TaskClaimReadFailure,
  TaskClaimRelease,
  TaskClaimReleaseFailure,
  TaskTrackerMutationThrottled,
  UnclaimedTask
} from "../../../index.js"
import type { TrackerMutationService } from "../../../authorities/task-tracker/claim-mutation.js"
import { runTaskClaimReleaseProtocol, TaskClaimReleaseDidNotConverge } from "./protocol.js"

const taskId = TaskId.make("released-task")
const claim = ActiveTaskClaim.make({
  operationId: OperationId.make("claim-acquisition"),
  owner: ClaimOwner.make("dalph"),
  taskId,
  token: ClaimToken.make("exact-token")
})
const release = TaskClaimRelease.make({ claim, operationId: OperationId.make("claim-release") })

const unusedAcquisition: TrackerMutationService["acquireTaskClaim"] = () => Effect.die("unused")

it.effect("rereads before and after deleting the exact claim", () =>
  Effect.gen(function* () {
    const current = yield* Ref.make<typeof claim | undefined>(claim)
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const tracker: TrackerMutationService = {
      acquireTaskClaim: unusedAcquisition,
      readTaskClaim: () =>
        Ref.updateAndGet(calls, (items) => [...items, "read"]).pipe(
          Effect.andThen(Ref.get(current)),
          Effect.map((observed) => observed ?? UnclaimedTask.make({ taskId }))
        ),
      releaseTaskClaim: (request) =>
        Ref.update(calls, (items) => [...items, `release:${request.operationId}`]).pipe(
          Effect.andThen(Ref.set(current, undefined))
        )
    }

    expect((yield* runTaskClaimReleaseProtocol(tracker, release))._tag).toBe("AuthoritativeTaskClaimReleased")
    expect(yield* Ref.get(calls)).toEqual(["read", "release:claim-release", "read"])
  })
)

it.effect("accepts authoritative absence after an ambiguous release response", () =>
  Effect.gen(function* () {
    const current = yield* Ref.make<typeof claim | undefined>(claim)
    const tracker: TrackerMutationService = {
      acquireTaskClaim: unusedAcquisition,
      readTaskClaim: () => Ref.get(current).pipe(Effect.map((observed) => observed ?? UnclaimedTask.make({ taskId }))),
      releaseTaskClaim: (request) =>
        Ref.set(current, undefined).pipe(
          Effect.andThen(Effect.fail(new TaskClaimReleaseFailure({ detail: "response lost", release: request })))
        )
    }

    expect((yield* runTaskClaimReleaseProtocol(tracker, release))._tag).toBe("AuthoritativeTaskClaimReleased")
  })
)

it.effect("preserves a foreign replacement without sending a release", () =>
  Effect.gen(function* () {
    const releases = yield* Ref.make(0)
    const foreign = ActiveTaskClaim.make({
      ...claim,
      operationId: OperationId.make("foreign-acquisition"),
      owner: ClaimOwner.make("foreign")
    })
    const tracker: TrackerMutationService = {
      acquireTaskClaim: unusedAcquisition,
      readTaskClaim: () => Effect.succeed(foreign),
      releaseTaskClaim: () => Ref.update(releases, (count) => count + 1)
    }

    expect(yield* runTaskClaimReleaseProtocol(tracker, release).pipe(Effect.flip)).toBeInstanceOf(
      TaskClaimOwnershipConflict
    )
    expect(yield* Ref.get(releases)).toBe(0)
  })
)

it.effect("stops without a release when the current claim is unreadable", () =>
  Effect.gen(function* () {
    const releases = yield* Ref.make(0)
    const tracker: TrackerMutationService = {
      acquireTaskClaim: unusedAcquisition,
      readTaskClaim: () => Effect.fail(new TaskClaimReadFailure({ detail: "tracker unavailable", taskId })),
      releaseTaskClaim: () => Ref.update(releases, (count) => count + 1)
    }

    expect(yield* runTaskClaimReleaseProtocol(tracker, release).pipe(Effect.flip)).toBeInstanceOf(TaskClaimReadFailure)
    expect(yield* Ref.get(releases)).toBe(0)
  })
)

it.effect("returns a definite release rejection without retrying", () =>
  Effect.gen(function* () {
    const requests = yield* Ref.make(0)
    const rejection = new TaskClaimOwnershipConflict({ attempted: claim, observed: claim })
    const tracker: TrackerMutationService = {
      acquireTaskClaim: unusedAcquisition,
      readTaskClaim: () => Effect.succeed(claim),
      releaseTaskClaim: () => Ref.update(requests, (count) => count + 1).pipe(Effect.andThen(Effect.fail(rejection)))
    }

    expect(yield* runTaskClaimReleaseProtocol(tracker, release).pipe(Effect.flip)).toBe(rejection)
    expect(yield* Ref.get(requests)).toBe(1)
  })
)

it.effect("tries to delete the exact claim at most three times", () =>
  Effect.gen(function* () {
    const requests = yield* Ref.make(0)
    const tracker: TrackerMutationService = {
      acquireTaskClaim: unusedAcquisition,
      readTaskClaim: () => Effect.succeed(claim),
      releaseTaskClaim: (request) =>
        Ref.update(requests, (count) => count + 1).pipe(
          Effect.andThen(Effect.fail(new TaskClaimReleaseFailure({ detail: "unknown", release: request })))
        )
    }

    const failure = yield* runTaskClaimReleaseProtocol(tracker, release).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(TaskClaimReleaseDidNotConverge)
    expect(yield* Ref.get(requests)).toBe(3)
  })
)

it.effect("claim release throttling sends one mutation and restart reads before using the same intent", () =>
  Effect.gen(function* () {
    const current = yield* Ref.make<typeof claim | undefined>(claim)
    const throttled = yield* Ref.make(true)
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const tracker: TrackerMutationService = {
      acquireTaskClaim: unusedAcquisition,
      readTaskClaim: () =>
        Ref.update(calls, (items) => [...items, "read"]).pipe(
          Effect.andThen(Ref.get(current)),
          Effect.map((observed) => observed ?? UnclaimedTask.make({ taskId }))
        ),
      releaseTaskClaim: (request) =>
        Ref.update(calls, (items) => [...items, `release:${request.operationId}`]).pipe(
          Effect.andThen(Ref.get(throttled)),
          Effect.flatMap((isThrottled) =>
            isThrottled
              ? Effect.fail(
                  new TaskTrackerMutationThrottled({
                    detail: "GitHub secondary rate limit rejected the GraphQL request",
                    operation: "ReleaseTaskClaim",
                    operationId: request.operationId,
                    timingEvidence: null
                  })
                )
              : Ref.set(current, undefined)
          )
        )
    }

    expect(yield* runTaskClaimReleaseProtocol(tracker, release).pipe(Effect.flip)).toBeInstanceOf(
      TaskTrackerMutationThrottled
    )
    expect(yield* Ref.get(calls)).toEqual(["read", "release:claim-release"])

    yield* Ref.set(throttled, false)
    expect((yield* runTaskClaimReleaseProtocol(tracker, release))._tag).toBe("AuthoritativeTaskClaimReleased")
    expect(yield* Ref.get(calls)).toEqual(["read", "release:claim-release", "read", "release:claim-release", "read"])
  })
)
