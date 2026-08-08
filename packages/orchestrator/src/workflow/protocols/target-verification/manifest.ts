import { Effect, Schema } from "effect"
import { EvidenceReference } from "./evidence-store.js"
import {
  TargetVerificationArtifactName,
  TargetVerificationCorrelation,
  TargetVerificationOutcome,
  TargetVerificationRequestId
} from "./events.js"

/** Links one wrapper-produced object name to its immutable evidence object. */
export const TargetVerificationManifestArtifact = Schema.Struct({
  name: TargetVerificationArtifactName,
  reference: EvidenceReference
})
export type TargetVerificationManifestArtifact = typeof TargetVerificationManifestArtifact.Type

/** Deterministic evidence envelope for one exact candidate-linked verification result. */
export const TargetVerificationManifest = Schema.Struct({
  artifacts: Schema.Array(TargetVerificationManifestArtifact),
  correlation: TargetVerificationCorrelation,
  formatVersion: Schema.Literal(1),
  outcome: TargetVerificationOutcome
})
export type TargetVerificationManifest = typeof TargetVerificationManifest.Type

/** Wrapper evidence could not form or reproduce one complete deterministic manifest. */
export class TargetVerificationManifestInvalid extends Schema.TaggedErrorClass<TargetVerificationManifestInvalid>()(
  "TargetVerificationManifestInvalid",
  { detail: Schema.String, requestId: TargetVerificationRequestId }
) {}

const invalid = (requestId: TargetVerificationRequestId, cause: unknown): TargetVerificationManifestInvalid =>
  new TargetVerificationManifestInvalid({ detail: String(cause), requestId })

/** Encodes the schema-shaped manifest with stable field and artifact ordering. */
export const encodeTargetVerificationManifest = (
  manifest: TargetVerificationManifest
): Effect.Effect<Uint8Array, TargetVerificationManifestInvalid> =>
  Effect.try({
    try: () => new TextEncoder().encode(JSON.stringify(manifest)),
    catch: (cause) => invalid(manifest.correlation.requestId, cause)
  })

/** Decodes bytes through the closed manifest schema. */
export const decodeTargetVerificationManifest = (
  bytes: Uint8Array,
  requestId: TargetVerificationRequestId
): Effect.Effect<TargetVerificationManifest, TargetVerificationManifestInvalid> =>
  Effect.try({
    try: (): unknown => JSON.parse(new TextDecoder().decode(bytes)),
    catch: (cause) => invalid(requestId, cause)
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(TargetVerificationManifest)),
    Effect.mapError((cause) => invalid(requestId, cause))
  )
