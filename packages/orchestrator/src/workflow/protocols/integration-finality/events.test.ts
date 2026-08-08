import { it as effectIt } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect, it } from "vitest"
import {
  CompletionClaimBoundary,
  CompletionClaimDeletionFailure,
  CompletionClaimDeletionRequest,
  CompletionClaimReplacementFailure,
  CompletionTaskClaim,
  completionClaimDeletionRequestFor,
  completionClaimReplacementRequestFor,
  controlledCompletionClaimBoundaryLayerFrom
} from "./events.js"
import { integrationFinalityFixture as fixture } from "./fixtures.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { OperationId } from "../../identity.js"
import { TaskId } from "@dalph/contracts"

const useBoundary = <A, E>(
  initial: ReadonlyArray<
    Parameters<typeof controlledCompletionClaimBoundaryLayerFrom>[0] extends ReadonlyArray<infer C> ? C : never
  >,
  effect: Effect.Effect<A, E, CompletionClaimBoundary>
) => effect.pipe(Effect.provide(controlledCompletionClaimBoundaryLayerFrom(initial)))

it("uses stable default operation identities for replacement and deletion requests", () => {
  const replacement = completionClaimReplacementRequestFor(fixture.claim)
  const deletion = completionClaimDeletionRequestFor(fixture.claim, fixture.successObservation)
  expect(String(replacement.operationId)).toBe(`completion-claim-replacement:${fixture.promotionCorrelation.requestId}`)
  expect(String(deletion.operationId)).toBe(`completion-claim-deletion:${fixture.promotionCorrelation.requestId}`)
  expect(completionClaimReplacementRequestFor(fixture.claim, OperationId.make("custom-replacement")).operationId).toBe(
    "custom-replacement"
  )
  expect(
    completionClaimDeletionRequestFor(fixture.claim, fixture.successObservation, OperationId.make("custom-deletion"))
      .operationId
  ).toBe("custom-deletion")
})

it("rejects completion claims and deletion proofs that bind a different task", () => {
  const foreignTaskId = TaskId.make("foreign-finality-schema-task")
  expect(
    Schema.is(CompletionTaskClaim)({
      ...fixture.claim,
      originalClaim: { ...fixture.activeClaim, taskId: foreignTaskId }
    })
  ).toBe(false)
  expect(
    Schema.is(CompletionClaimDeletionRequest)({
      ...completionClaimDeletionRequestFor(fixture.claim, fixture.successObservation),
      successObservation: { ...fixture.successObservation, taskId: foreignTaskId }
    })
  ).toBe(false)
})

effectIt.effect("fails closed for absent or foreign claims and preserves exact boundary ownership", () =>
  Effect.gen(function* () {
    const replacement = completionClaimReplacementRequestFor(fixture.claim)
    const absentReplacement = yield* Effect.flip(
      useBoundary(
        [],
        Effect.gen(function* () {
          const boundary = yield* CompletionClaimBoundary
          return yield* boundary.replaceTaskClaim(replacement)
        })
      )
    )
    expect(absentReplacement).toBeInstanceOf(CompletionClaimReplacementFailure)

    const foreignActive = ActiveTaskClaim.make({
      operationId: OperationId.make("foreign-events-active"),
      owner: ClaimOwner.make("dalph:foreign-events"),
      taskId: fixture.taskId,
      token: ClaimToken.make("foreign-events-token")
    })
    const foreignReplacement = yield* Effect.flip(
      useBoundary(
        [foreignActive],
        Effect.gen(function* () {
          const boundary = yield* CompletionClaimBoundary
          return yield* boundary.replaceTaskClaim(replacement)
        })
      )
    )
    expect(foreignReplacement).toBeInstanceOf(CompletionClaimReplacementFailure)

    const foreignClaim = CompletionTaskClaim.make({
      originalClaim: foreignActive,
      plannedAttempt: fixture.plannedAttempt,
      promotionCorrelation: fixture.promotionCorrelation
    })
    const deletion = completionClaimDeletionRequestFor(fixture.claim, fixture.successObservation)
    const foreignDeletion = yield* Effect.flip(
      useBoundary(
        [foreignClaim],
        Effect.gen(function* () {
          const boundary = yield* CompletionClaimBoundary
          return yield* boundary.deleteTaskClaim(deletion)
        })
      )
    )
    expect(foreignDeletion).toBeInstanceOf(CompletionClaimDeletionFailure)
  })
)

effectIt.effect("recognizes an exact completion claim, deletes it, and makes repeated absence harmless", () =>
  Effect.gen(function* () {
    const replacement = completionClaimReplacementRequestFor(fixture.claim)
    const deletion = completionClaimDeletionRequestFor(fixture.claim, fixture.successObservation)
    const observations = yield* useBoundary(
      [fixture.activeClaim],
      Effect.gen(function* () {
        const boundary = yield* CompletionClaimBoundary
        const replaced = yield* boundary.replaceTaskClaim(replacement)
        const replayed = yield* boundary.replaceTaskClaim(replacement)
        yield* boundary.deleteTaskClaim(deletion)
        yield* boundary.deleteTaskClaim(deletion)
        const absent = yield* boundary.readTaskClaim(fixture.taskId)
        return { absent, replaced, replayed }
      })
    )
    expect(observations.replaced).toEqual(fixture.claim)
    expect(observations.replayed).toEqual(fixture.claim)
    expect(observations.absent._tag).toBe("UnclaimedTask")
  })
)
