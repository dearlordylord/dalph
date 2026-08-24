import { it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { expect } from "vitest"
import type { GitCommitSha, IntegrationTarget } from "@dalph/contracts"
import { GitTargetLineage } from "../../src/authorities/git/target-lineage.js"

interface GitTargetLineageContractInput<E> {
  readonly base: GitCommitSha
  readonly expected: {
    readonly plannedBaseIsAncestorOfTargetHead: boolean
    readonly plannedBaseSha: GitCommitSha
    readonly targetHeadSha: GitCommitSha
  }
  readonly layer: Layer.Layer<GitTargetLineage, E, never>
  readonly name: string
  readonly target: IntegrationTarget
}

/** Shared read-only lineage contract used by controlled and command-backed Git adapters. */
export const gitTargetLineageContract = <E>({
  base,
  expected,
  layer,
  name,
  target
}: GitTargetLineageContractInput<E>) => {
  it.effect(`${name} GitTargetLineage reads one exact target observation`, () =>
    Effect.gen(function* () {
      const lineage = yield* GitTargetLineage
      expect(yield* lineage.read(base, target)).toEqual(expected)
    }).pipe(Effect.provide(layer))
  )
}
