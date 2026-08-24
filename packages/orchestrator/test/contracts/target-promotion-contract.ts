import { it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { expect } from "vitest"
import type {
  TargetPromotionGitReadObservation,
  TargetPromotionGitRequest
} from "../../src/workflow/protocols/target-promotion/events.js"
import { TargetPromotionGit } from "../../src/workflow/protocols/target-promotion/events.js"

interface TargetPromotionContractInput<E> {
  readonly expected: TargetPromotionGitReadObservation
  readonly layer: Layer.Layer<TargetPromotionGit, E, never>
  readonly name: string
  readonly request: TargetPromotionGitRequest
}

/** Shared exact-head observation contract used by controlled and command-backed promotion adapters. */
export const targetPromotionContract = <E>({ expected, layer, name, request }: TargetPromotionContractInput<E>) => {
  it.effect(`${name} TargetPromotionGit reads the exact current target head`, () =>
    Effect.gen(function* () {
      const git = yield* TargetPromotionGit
      expect(yield* git.read(request)).toEqual(expected)
    }).pipe(Effect.provide(layer))
  )
}
