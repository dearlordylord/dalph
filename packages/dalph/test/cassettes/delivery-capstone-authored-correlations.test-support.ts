import { NodeCrypto } from "@effect/platform-node"
import { expect } from "vitest"
import {
  AcceptedResultEvidenceManifest,
  EvidenceDigest,
  EvidenceReference,
  type GitCommitSha,
  type PlannedAttemptExecutorCorrelation,
  type RunId
} from "@dalph/contracts"
import { Crypto, Effect, Schema } from "effect"
import { IntegratorSessionCorrelation } from "@dalph/orchestrator"

const authoredRunPlaceholder = "$authored-run"
const digestHexWidth = 64
const hexRadix = 16
const hexByteWidth = 2
const authoredAcceptanceManifestDigest = "1".repeat(digestHexWidth)

export const resolveDeclaredAuthoredIdentity = (value: string, actualRunId: RunId): string =>
  value.replaceAll(authoredRunPlaceholder, String(actualRunId))

/** Recomputes the reference from exact sealed acceptance bytes, never from a Journal descriptor. */
export const acceptedManifestReferenceFor = (
  correlation: PlannedAttemptExecutorCorrelation,
  commit: GitCommitSha
): EvidenceReference => {
  const bytes = new TextEncoder().encode(
    JSON.stringify(
      AcceptedResultEvidenceManifest.make({
        commit,
        correlation,
        formatVersion: 1,
        outcome: "Accepted",
        predecessor: null
      })
    )
  )
  const hashed = Effect.runSync(
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      return yield* crypto.digest("SHA-256", bytes)
    }).pipe(Effect.provide(NodeCrypto.layer))
  )
  const digest = EvidenceDigest.make(
    Array.from(hashed, (byte) => byte.toString(hexRadix).padStart(hexByteWidth, "0")).join("")
  )
  return EvidenceReference.make({ byteLength: bytes.byteLength, digest })
}

/**
 * Resolves the authored Run atom in one declared Integrator session while
 * independently materializing the sealed accepted-result evidence reference.
 */
export const normalizeDeclaredIntegratorSession = (
  declared: IntegratorSessionCorrelation,
  actualRunId: RunId
): IntegratorSessionCorrelation => {
  if (declared.plannedAttempt.runId !== authoredRunPlaceholder)
    return expect.fail("authored Integrator session must declare the exact Run placeholder")
  const resolved = Schema.decodeUnknownSync(IntegratorSessionCorrelation)(
    JSON.parse(resolveDeclaredAuthoredIdentity(JSON.stringify(declared), actualRunId))
  )
  const reference = acceptedManifestReferenceFor(
    { attemptId: resolved.plannedAttempt.attemptId, runId: actualRunId },
    resolved.acceptedResult.commit
  )
  const declaredEvidence = declared.acceptedResult.evidenceManifest
  if (declaredEvidence.digest !== authoredAcceptanceManifestDigest) {
    return expect.fail("authored Integrator session must declare the sentinel accepted-evidence digest")
  }
  if (declaredEvidence.byteLength !== reference.byteLength) {
    return expect.fail("authored Integrator session accepted-evidence byte length is not canonical")
  }
  return { ...resolved, acceptedResult: { ...resolved.acceptedResult, evidenceManifest: reference } }
}
