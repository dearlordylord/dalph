import { it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { expect } from "vitest"
import type { GitCommitSha, IntegrationTarget } from "@dalph/contracts"
import { IntegratorGit } from "../../src/workflow/protocols/integrator/protocol.js"
import type {
  IntegratorCandidateText,
  IntegratorGitObservation
} from "../../src/workflow/protocols/integrator/protocol.js"

interface IntegratorCandidateContractInput<E> {
  readonly candidate: GitCommitSha
  readonly candidateText: IntegratorCandidateText
  readonly expected: IntegratorGitObservation
  readonly layer: Layer.Layer<IntegratorGit, E, never>
  readonly name: string
  readonly target: IntegrationTarget
}

/** Shared candidate-qualification contract used by controlled and command-backed Git services. */
export const integratorCandidateContract = <E>({
  candidate,
  candidateText,
  expected,
  layer,
  name,
  target
}: IntegratorCandidateContractInput<E>): void => {
  it.effect(`${name} IntegratorGit reads the reported candidate object`, () =>
    Effect.gen(function* () {
      const git = yield* IntegratorGit
      expect(yield* git.readCandidate(target, candidateText)).toEqual(expected)
      if (expected._tag === "Commit") expect(expected.commit).toBe(candidate)
    }).pipe(Effect.provide(layer))
  )
}
