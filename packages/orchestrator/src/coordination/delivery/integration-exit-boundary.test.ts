import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Ref } from "effect"
import { describe, expect } from "vitest"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import { integrationExitBoundaryFamilyFor } from "./integration-exit-boundary.js"

const boundaryFamilies = [
  "IntegrationCandidateConstruction",
  "TargetVerificationAndEvidence",
  "TargetPromotion"
] as const

type BoundaryFamily = (typeof boundaryFamilies)[number]
type IntegrationExitCassetteEntry =
  | { readonly _tag: "BoundaryEntered"; readonly family: BoundaryFamily }
  | { readonly _tag: "BoundaryResultProduced"; readonly family: BoundaryFamily }
  | { readonly _tag: "ExitCutoffClosed" }
  | { readonly _tag: "OwnerReleasedWithoutSuccessor"; readonly family: BoundaryFamily }

describe("application Exit integration boundary classification", () => {
  it.each([
    ["ContinueStartedIntegrationCandidate", "IntegrationCandidateConstruction"],
    ["RunTargetVerification", "TargetVerificationAndEvidence"],
    ["RunTargetPromotion", "TargetPromotion"]
  ] as const)("classifies %s as the admitted %s atomic section", (tag, family) => {
    expect(integrationExitBoundaryFamilyFor({ _tag: tag })).toBe(family)
  })

  it.each([
    "ReplacePromotedTaskClaim",
    "CompletePromotedTask",
    "ObserveFocusedTaskCompletion",
    "DeleteCompletedTaskCompletionClaim"
  ] as const)("does not absorb %s from later finality or cleanup tickets", (tag) => {
    expect(integrationExitBoundaryFamilyFor({ _tag: tag })).toBeNull()
  })
})

it.effect(
  "preserves candidate verification promotion and evidence chronologies in authored and recorded cassettes",
  () =>
    Effect.forEach(boundaryFamilies, (family) =>
      Effect.gen(function* () {
        const authored: ReadonlyArray<IntegrationExitCassetteEntry> = [
          { _tag: "BoundaryEntered", family },
          { _tag: "BoundaryResultProduced", family },
          { _tag: "ExitCutoffClosed" },
          { _tag: "OwnerReleasedWithoutSuccessor", family }
        ]
        const recorded = yield* Ref.make<ReadonlyArray<IntegrationExitCassetteEntry>>([])
        const record = (entry: IntegrationExitCassetteEntry) => Ref.update(recorded, (entries) => [...entries, entry])
        const lifecycle = yield* makeApplicationExitLifecycle()
        const owner = yield* lifecycle.admission.acquireForwardOwner("AtomicBoundary")
        if (owner.kind !== "AtomicBoundary") return yield* Effect.die("wrong integration boundary owner")
        const produced = yield* Deferred.make<void>()
        const mayReturn = yield* Deferred.make<void>()
        const running = yield* owner
          .run(
            record({ _tag: "BoundaryEntered", family }).pipe(
              Effect.andThen(record({ _tag: "BoundaryResultProduced", family })),
              Effect.andThen(Deferred.succeed(produced, undefined)),
              Effect.andThen(Deferred.await(mayReturn))
            )
          )
          .pipe(
            Effect.ensuring(owner.release),
            Effect.ensuring(record({ _tag: "OwnerReleasedWithoutSuccessor", family })),
            Effect.forkChild
          )

        yield* Deferred.await(produced)
        yield* lifecycle.requestExit
        yield* record({ _tag: "ExitCutoffClosed" })
        yield* Deferred.succeed(mayReturn, undefined)

        expect((yield* Fiber.await(running))._tag).toBe("Failure")
        expect(yield* Ref.get(recorded)).toEqual(authored)
      })
    )
)
