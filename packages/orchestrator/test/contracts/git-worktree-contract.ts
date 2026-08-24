import { it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { expect } from "vitest"
import type { PlannedTaskAttempt } from "@dalph/contracts"
import { GitWorktree, PlannedWorktreeAbsent } from "../../src/authorities/git/worktree.js"

interface GitWorktreeContractInput<E> {
  readonly layer: Layer.Layer<GitWorktree, E, never>
  readonly name: string
  readonly plan: PlannedTaskAttempt
}

/** Shared observation contract used by controlled and command-backed Git worktree adapters. */
export const gitWorktreeContract = <E>({ layer, name, plan }: GitWorktreeContractInput<E>): void => {
  it.effect(`${name} GitWorktree reports an absent planned worktree exactly`, () =>
    Effect.gen(function* () {
      const worktree = yield* GitWorktree
      expect(yield* worktree.readPlannedWorktree(plan)).toEqual(PlannedWorktreeAbsent.make({}))
    }).pipe(Effect.provide(layer))
  )
}
