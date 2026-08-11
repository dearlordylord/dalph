import { Schema } from "effect"

/** Identifies immutable evidence bytes by their lowercase SHA-256 content digest. */
export const EvidenceDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(
  Schema.brand("EvidenceDigest")
)
export type EvidenceDigest = typeof EvidenceDigest.Type

/** Locates one complete immutable object in the configured evidence store. */
export const EvidenceReference = Schema.Struct({
  byteLength: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  digest: EvidenceDigest
})
export type EvidenceReference = typeof EvidenceReference.Type

/** Compares the complete content-addressed identity of two immutable evidence objects. */
export const evidenceReferenceEquals = (left: EvidenceReference, right: EvidenceReference): boolean =>
  left.byteLength === right.byteLength && left.digest === right.digest
