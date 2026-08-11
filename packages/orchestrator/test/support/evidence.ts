import { AcceptedResult, EvidenceDigest, EvidenceReference, type GitCommitSha } from "@dalph/contracts"

const evidenceDigestLength = 64

/** Stable sealed-evidence identity for tests whose subject is not evidence contents. */
export const evidenceReferenceFixture = EvidenceReference.make({
  byteLength: 1,
  digest: EvidenceDigest.make("e".repeat(evidenceDigestLength))
})

/** Accepted-result fixture that keeps the required sealed-evidence boundary explicit. */
export const acceptedResultFixture = (commit: GitCommitSha): AcceptedResult =>
  AcceptedResult.make({ commit, evidenceManifest: evidenceReferenceFixture })
