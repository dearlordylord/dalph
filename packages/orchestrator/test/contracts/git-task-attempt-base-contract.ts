import { GitCommitSha } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { expect } from "vitest"
import { GitTaskAttemptBase } from "../../src/authorities/git/task-attempt-base.js"

const gitCommitHexLength = 40

/** Provider-neutral fixed-policy contract; current-head Git boundaries have separate property tests. */
export const gitTaskAttemptBaseContract = <E>({
  layer,
  name
}: {
  readonly layer: Layer.Layer<GitTaskAttemptBase, E, never>
  readonly name: string
}) => {
  it.effect(`${name} preserves the explicit Base across repeated reads`, () =>
    Effect.gen(function* () {
      const reader = yield* GitTaskAttemptBase
      for (const digit of ["1", "2"]) {
        const baseSha = GitCommitSha.make(digit.repeat(gitCommitHexLength))
        const policy = { _tag: "ExplicitFixedBase" as const, baseSha }
        expect(yield* reader.read(policy)).toEqual({ _tag: "Qualified", baseSha })
        expect(yield* reader.read(policy)).toEqual({ _tag: "Qualified", baseSha })
      }
    }).pipe(Effect.provide(layer))
  )
}
