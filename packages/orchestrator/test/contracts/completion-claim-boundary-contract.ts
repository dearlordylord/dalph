import { it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { expect } from "vitest"
import { UnclaimedTask } from "../../src/authorities/task-tracker/claim-mutation.js"
import {
  CompletionClaimBoundary,
  CompletionClaimMarkerAbsent,
  type CompletionSuccessObservation,
  type CompletionTaskClaim,
  completionClaimDeletionRequestFor,
  completionClaimReadRequestFor,
  completionClaimReplacementRequestFor,
  completionOriginalTaskClaimReleaseFor
} from "../../src/workflow/protocols/integration-finality/events.js"

interface CompletionClaimBoundaryContractInput<E> {
  readonly claim: CompletionTaskClaim
  readonly layer: Layer.Layer<CompletionClaimBoundary, E, never>
  readonly name: string
  readonly successObservation: CompletionSuccessObservation
}

/** Shared completion-claim contract used by controlled and GitHub boundaries. */
export const completionClaimBoundaryContract = <E>({
  claim,
  layer,
  name,
  successObservation
}: CompletionClaimBoundaryContractInput<E>): void => {
  it.effect(`${name} CompletionClaimBoundary creates, rereads, and cleans the active claim before its marker`, () =>
    Effect.gen(function* () {
      const boundary = yield* CompletionClaimBoundary
      const readRequest = completionClaimReadRequestFor(claim)

      expect(yield* boundary.readTaskClaim(readRequest)).toEqual(claim.originalClaim)
      expect(yield* boundary.replaceTaskClaim(completionClaimReplacementRequestFor(claim))).toEqual(claim)
      expect(yield* boundary.readTaskClaim(readRequest)).toEqual(claim)

      yield* boundary.releaseOriginalTaskClaim(completionOriginalTaskClaimReleaseFor(claim))
      expect(yield* boundary.readCompletionClaimMarker(readRequest)).toEqual(claim)
      expect(yield* boundary.readOriginalTaskClaim(claim.plannedAttempt.taskId)).toEqual(
        UnclaimedTask.make({ taskId: claim.plannedAttempt.taskId })
      )

      yield* boundary.deleteTaskClaim(completionClaimDeletionRequestFor(claim, successObservation))
      expect(yield* boundary.readCompletionClaimMarker(readRequest)).toEqual(
        CompletionClaimMarkerAbsent.make({ taskId: claim.plannedAttempt.taskId })
      )
      expect(yield* boundary.readOriginalTaskClaim(claim.plannedAttempt.taskId)).toEqual(
        UnclaimedTask.make({ taskId: claim.plannedAttempt.taskId })
      )
    }).pipe(Effect.provide(layer))
  )
}
