import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import { OperationId } from "../../workflow/identity.js"
import { InterruptibleWorkflowBoundaryIntent } from "../../workflow/interpretation/interpreter.js"
import { interruptibleBoundaryOf, runAtomicDeliveryBoundary } from "./delivery-action-executor.js"
import { integrationExitBoundaryFamilyFor } from "./integration-exit-boundary.js"

describe("application Exit integration boundary classification", () => {
  it.each([
    ["RunIntegrator", "IntegratorPreparation"],
    ["RunTargetPromotion", "TargetPromotion"]
  ] as const)("classifies %s as the admitted %s atomic section", (tag, family) => {
    expect(integrationExitBoundaryFamilyFor({ _tag: tag })).toBe(family)
  })

  it.each([
    "ContinueStartedIntegrationCandidate",
    "RunTargetVerification",
    "ReplacePromotedTaskClaim",
    "CompletePromotedTask",
    "ObserveFocusedTaskCompletion",
    "DeleteCompletedTaskCompletionClaim"
  ] as const)("does not absorb %s from later finality or cleanup tickets", (tag) => {
    expect(integrationExitBoundaryFamilyFor({ _tag: tag })).toBeNull()
  })
})

it.effect("defects when an atomic owner reaches an interruptible route while Serving", () =>
  Effect.gen(function* () {
    const defect = yield* interruptibleBoundaryOf({
      forwardBoundary: { _tag: "AtomicBoundary", execution: { run: (effect) => effect } }
    })
      .run(
        InterruptibleWorkflowBoundaryIntent.AuthorityRequest({
          family: "Git",
          operationId: OperationId.make("boundary-mismatch")
        }),
        Effect.succeed("outside-result"),
        Effect.succeed
      )
      .pipe(Effect.catchDefect(Effect.succeed))

    expect(defect).toEqual({
      _tag: "DeliveryActionForwardBoundaryMismatch",
      actual: "AtomicBoundary",
      expected: "InterruptibleBoundary"
    })
  })
)

it.effect("defects when an interruptible owner reaches an atomic route while Serving", () =>
  Effect.gen(function* () {
    const defect = yield* runAtomicDeliveryBoundary(
      {
        forwardBoundary: {
          _tag: "InterruptibleBoundary",
          execution: { run: (_intent, call, recordResult) => Effect.flatMap(call, recordResult) }
        }
      },
      Effect.succeed("atomic-result")
    ).pipe(Effect.catchDefect(Effect.succeed))

    expect(defect).toEqual({
      _tag: "DeliveryActionForwardBoundaryMismatch",
      actual: "InterruptibleBoundary",
      expected: "AtomicBoundary"
    })
  })
)
