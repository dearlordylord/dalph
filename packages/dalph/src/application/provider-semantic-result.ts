import type { EvidenceReference, WorktreeLocator } from "@dalph/contracts"
import {
  AcceptedResultEvidenceManifest,
  EvidenceDigest,
  GitCommitSha,
  PlannedAttemptResultRejectionReason,
  PlannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import type { EvidenceStore, GitCommand } from "@dalph/orchestrator"
import { type Crypto, Effect, Option, Schema } from "effect"

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

/** A proven answer defect permits a fresh response; missing authority never does. */
export const ProviderResultRejectionReason = PlannedAttemptResultRejectionReason
export type ProviderResultRejectionReason = typeof ProviderResultRejectionReason.Type

export class ProviderResultRejected extends Schema.TaggedError<ProviderResultRejected>()("ProviderResultRejected", {
  reason: ProviderResultRejectionReason,
  observedHead: Schema.optionalKey(GitCommitSha)
}) {}

/** The adapter could not establish an authoritative fact required for validation. */
export class ProviderResultAuthorityUnavailable extends Schema.TaggedError<ProviderResultAuthorityUnavailable>()(
  "ProviderResultAuthorityUnavailable",
  { boundary: Schema.Literals(["Ownership", "Head", "Lineage", "Evidence"]), detail: Schema.String }
) {}

/** Adapter operations retain exact provider ownership and native Git/evidence authority. */
export interface ProviderResultValidationBoundary {
  readonly proveOwnership: Effect.Effect<void, ProviderResultAuthorityUnavailable>
  readonly readHead: Effect.Effect<GitCommitSha, ProviderResultAuthorityUnavailable>
  readonly isBaseAncestor: (commit: GitCommitSha) => Effect.Effect<boolean, ProviderResultAuthorityUnavailable>
  readonly publishAndVerifyEvidence: (
    commit: GitCommitSha,
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<EvidenceReference, ProviderResultAuthorityUnavailable>
}

/**
 * Validate one newly observed response. This grants no terminal seal or writer
 * release: the executor must separately reconcile exact activity before sealing.
 */
export const validateOwnedSemanticCandidate = Effect.fn("ProviderResult.validateOwnedSemanticCandidate")(function* (
  text: string,
  correlation: PlannedAttemptExecutorCorrelation,
  boundary: ProviderResultValidationBoundary
) {
  yield* boundary.proveOwnership
  const candidate = decodeOwnedSemanticCandidate(text, correlation)
  if (Option.isNone(candidate))
    return yield* Effect.fail(new ProviderResultRejected({ reason: "ResultEnvelopeInvalid" }))
  const head = yield* boundary.readHead
  if (head !== candidate.value.commit)
    return yield* Effect.fail(new ProviderResultRejected({ reason: "CandidateHeadMismatch", observedHead: head }))
  if (!(yield* boundary.isBaseAncestor(candidate.value.commit)))
    return yield* Effect.fail(new ProviderResultRejected({ reason: "CandidateLineageInvalid", observedHead: head }))
  const evidenceManifest = yield* boundary.publishAndVerifyEvidence(candidate.value.commit, correlation)
  const finalHead = yield* boundary.readHead
  if (finalHead !== candidate.value.commit)
    return yield* Effect.fail(
      new ProviderResultAuthorityUnavailable({ boundary: "Head", detail: "HEAD changed during evidence validation" })
    )
  return { commit: candidate.value.commit, evidenceManifest }
})

/** Native Git exit 1 proves missing ancestry; other unsuccessful exits prove no answer defect. */
export const providerResultGitBoundary = (
  git: Pick<GitCommand["Service"], "runInWorktree">,
  worktree: WorktreeLocator,
  base: GitCommitSha
): Pick<ProviderResultValidationBoundary, "readHead" | "isBaseAncestor"> => ({
  readHead: Effect.gen(function* () {
    const unavailable = () =>
      new ProviderResultAuthorityUnavailable({ boundary: "Head", detail: "exact worktree HEAD is unavailable" })
    const result = yield* git.runInWorktree(worktree, ["rev-parse", "HEAD"]).pipe(Effect.mapError(unavailable))
    if (result.exitCode !== 0) return yield* unavailable()
    return yield* Schema.decodeUnknownEffect(GitCommitSha)(result.stdout.trim()).pipe(Effect.mapError(unavailable))
  }),
  isBaseAncestor: Effect.fn("ProviderResult.isBaseAncestor")(function* (commit) {
    const unavailable = () =>
      new ProviderResultAuthorityUnavailable({ boundary: "Lineage", detail: "candidate lineage is unavailable" })
    const result = yield* git
      .runInWorktree(worktree, ["merge-base", "--is-ancestor", base, commit])
      .pipe(Effect.mapError(unavailable))
    if (result.exitCode === 0) return true
    if (result.exitCode === 1) return false
    return yield* unavailable()
  })
})

const hexadecimalRadix = 16
const hexadecimalByteWidth = 2

/** Publish the application-bound manifest and verify exact bytes and digest before returning its locator. */
export const publishProviderResultEvidence = Effect.fn("ProviderResult.publishEvidence")(function* (
  evidence: EvidenceStore["Service"],
  crypto: Crypto.Crypto,
  commit: GitCommitSha,
  correlation: PlannedAttemptExecutorCorrelation
) {
  const unavailable = () =>
    new ProviderResultAuthorityUnavailable({ boundary: "Evidence", detail: "accepted-result evidence is unverified" })
  const manifest = AcceptedResultEvidenceManifest.make({
    commit,
    correlation,
    formatVersion: 1,
    outcome: "Accepted",
    predecessor: null
  })
  const bytes = new TextEncoder().encode(JSON.stringify(manifest))
  const reference = yield* evidence.put(bytes).pipe(Effect.mapError(unavailable))
  const reread = yield* evidence.read(reference).pipe(Effect.mapError(unavailable))
  const hash = yield* crypto.digest("SHA-256", reread).pipe(Effect.mapError(unavailable))
  const digest = EvidenceDigest.make(
    [...hash].map((byte) => byte.toString(hexadecimalRadix).padStart(hexadecimalByteWidth, "0")).join("")
  )
  if (
    reference.byteLength !== bytes.byteLength ||
    reread.byteLength !== bytes.byteLength ||
    !bytes.every((byte, index) => byte === reread[index]) ||
    digest !== reference.digest
  )
    return yield* unavailable()
  return reference
})
