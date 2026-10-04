import { GitCommitSha, PlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Option, Schema } from "effect"

/** Model-authored candidate proposal; application-owned correlation is deliberately absent. */
export const PlannedAttemptSemanticCandidate = Schema.Struct({
  version: Schema.Literal(1),
  outcome: Schema.Literal("Accepted"),
  commit: GitCommitSha
})
export type PlannedAttemptSemanticCandidate = typeof PlannedAttemptSemanticCandidate.Type

/** Shared model-facing instruction for both planned-attempt provider adapters. */
export const semanticCandidateInstructions =
  'Accepted results must be the final JSON object {"version":1,"outcome":"Accepted","commit":"<40-hex>"}. Dalph binds its own identities; do not include correlation identifiers.'

const LegacyCandidate = Schema.Struct({ commit: GitCommitSha, correlation: PlannedAttemptExecutorCorrelation })

/** Call only after the provider adapter independently establishes exact session/turn ownership. */
export const decodeOwnedSemanticCandidate = (
  text: string,
  expected: PlannedAttemptExecutorCorrelation
): Option.Option<PlannedAttemptSemanticCandidate> => {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return Option.none()
  }
  const semantic = Schema.decodeUnknownOption(PlannedAttemptSemanticCandidate)(value, { onExcessProperty: "error" })
  if (Option.isSome(semantic)) return semantic
  const legacy = Schema.decodeUnknownOption(LegacyCandidate)(value, { onExcessProperty: "error" })
  if (
    Option.isNone(legacy) ||
    legacy.value.correlation.runId !== expected.runId ||
    legacy.value.correlation.attemptId !== expected.attemptId
  )
    return Option.none()
  return Option.some({ version: 1, outcome: "Accepted", commit: legacy.value.commit })
}
