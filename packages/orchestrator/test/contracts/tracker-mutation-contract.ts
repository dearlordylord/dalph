import { it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { expect } from "vitest"
import type { TaskId } from "@dalph/contracts"
import { ClaimOwner, ClaimToken } from "../../src/authorities/task-tracker/claim.js"
import {
  TaskClaimAcquisition,
  TaskClaimRelease,
  TrackerMutation,
  UnclaimedTask
} from "../../src/authorities/task-tracker/claim-mutation.js"
import { OperationId } from "../../src/workflow/identity.js"

interface TrackerMutationContractInput<E> {
  readonly acquisition: TaskClaimAcquisition
  readonly layer: Layer.Layer<TrackerMutation, E, never>
  readonly name: string
  readonly releaseOperationId: OperationId
  readonly taskId: TaskId
}

/** Shared black-box task-claim contract used by controlled and GitHub adapters. */
export const trackerMutationContract = <E>({
  acquisition,
  layer,
  name,
  releaseOperationId,
  taskId
}: TrackerMutationContractInput<E>): void => {
  it.effect(`${name} TrackerMutation acquires, rereads, and releases one exact claim`, () =>
    Effect.gen(function* () {
      const tracker = yield* TrackerMutation
      expect(yield* tracker.readTaskClaim(taskId)).toEqual(UnclaimedTask.make({ taskId }))
      const claim = yield* tracker.acquireTaskClaim(acquisition)
      expect(yield* tracker.readTaskClaim(taskId)).toEqual(claim)
      expect(yield* tracker.acquireTaskClaim(acquisition)).toEqual(claim)
      yield* tracker.releaseTaskClaim(TaskClaimRelease.make({ claim, operationId: releaseOperationId }))
      expect(yield* tracker.readTaskClaim(taskId)).toEqual(UnclaimedTask.make({ taskId }))
    }).pipe(Effect.provide(layer))
  )
}

export const trackerMutationContractFixture = (taskId: TaskId, name: string) => ({
  acquisition: TaskClaimAcquisition.make({
    operationId: OperationId.make(`contract:${name}:acquire`),
    owner: ClaimOwner.make(`contract:${name}`),
    taskId,
    token: ClaimToken.make(`contract:${name}:token`)
  }),
  name,
  releaseOperationId: OperationId.make(`contract:${name}:release`),
  taskId
})
