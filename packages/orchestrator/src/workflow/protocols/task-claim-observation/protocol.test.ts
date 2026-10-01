import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import { TaskId } from "@dalph/contracts"
import { OperationId } from "../../identity.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import {
  ActiveTaskClaim,
  TaskClaimReadFailure,
  type TrackerClaimReadCausalContext,
  type TrackerMutationService
} from "../../../authorities/task-tracker/claim-mutation.js"
import { observeTaskClaim, TaskClaimObservationDidNotConverge } from "./protocol.js"

const taskId = TaskId.make("claim-observation-task")
const exactClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("claim-observation-operation"),
  owner: ClaimOwner.make("dalph"),
  taskId,
  token: ClaimToken.make("claim-observation-token")
})

const unusedMutation = () => Effect.die("claim observation must not mutate the tracker")

it.effect("accepts the exact claim after two unreadable observations", () =>
  Effect.gen(function* () {
    const reads = yield* Ref.make(0)
    const tracker: TrackerMutationService = {
      acquireTaskClaim: unusedMutation,
      readTaskClaim: () =>
        Ref.getAndUpdate(reads, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            count < 2
              ? new TaskClaimReadFailure({ detail: `unreadable-${count + 1}`, taskId })
              : Effect.succeed(exactClaim)
          )
        ),
      releaseTaskClaim: unusedMutation
    }

    expect(yield* observeTaskClaim(tracker, taskId)).toEqual(exactClaim)
    expect(yield* Ref.get(reads)).toBe(3)
  })
)

it.effect("stops after three unreadable observations without mutating the tracker", () =>
  Effect.gen(function* () {
    const reads = yield* Ref.make(0)
    const tracker: TrackerMutationService = {
      acquireTaskClaim: unusedMutation,
      readTaskClaim: () =>
        Ref.update(reads, (count) => count + 1).pipe(
          Effect.andThen(new TaskClaimReadFailure({ detail: "still unreadable", taskId }))
        ),
      releaseTaskClaim: unusedMutation
    }

    const failure = yield* observeTaskClaim(tracker, taskId).pipe(Effect.flip)
    expect(failure).toEqual(new TaskClaimObservationDidNotConverge({ attempts: 3, detail: "still unreadable", taskId }))
    expect(yield* Ref.get(reads)).toBe(3)
  })
)

it.effect("passes the same exact read identity through every bounded retry", () =>
  Effect.gen(function* () {
    const context = {
      operationId: OperationId.make("claim-read-identity"),
      predecessorOperationIds: [OperationId.make("claim-read-predecessor")]
    }
    const received = yield* Ref.make<ReadonlyArray<TrackerClaimReadCausalContext>>([])
    const tracker: TrackerMutationService = {
      acquireTaskClaim: unusedMutation,
      readTaskClaim: (_taskId, actual) =>
        Effect.gen(function* () {
          if (actual !== undefined) yield* Ref.update(received, (prior) => [...prior, actual])
          return (yield* Ref.get(received)).length === 1
            ? yield* new TaskClaimReadFailure({ detail: "first read unavailable", taskId })
            : exactClaim
        }),
      releaseTaskClaim: unusedMutation
    }
    expect(yield* observeTaskClaim(tracker, taskId, context)).toEqual(exactClaim)
    expect(yield* Ref.get(received)).toEqual([context, context])
  })
)
