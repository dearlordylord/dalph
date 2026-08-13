import { EvidenceReference, evidenceReferenceEquals } from "@dalph/contracts"
import { Effect, Schema } from "effect"

const emptyChainIndex = -1

/** Links one sealed manifest to the immutable object sealed immediately before it. */
export const EvidenceManifestChainLink = Schema.Struct({
  predecessor: Schema.NullOr(EvidenceReference),
  reference: EvidenceReference
})
export type EvidenceManifestChainLink = typeof EvidenceManifestChainLink.Type

/** Explains why a reread chain cannot authorize the task-local next boundary. */
export const EvidenceManifestChainFailureReason = Schema.Literals([
  "EmptyChain",
  "RootHasPredecessor",
  "PredecessorMismatch"
])
export type EvidenceManifestChainFailureReason = typeof EvidenceManifestChainFailureReason.Type

/** A sealed evidence chain is missing its exact immutable predecessor relationship. */
export class EvidenceManifestChainFailure extends Schema.TaggedError<EvidenceManifestChainFailure>()(
  "EvidenceManifestChainFailure",
  { detail: Schema.String, index: Schema.Int, reason: EvidenceManifestChainFailureReason }
) {}

const chainFailure = (
  index: number,
  reason: EvidenceManifestChainFailureReason,
  detail: string
): Effect.Effect<never, EvidenceManifestChainFailure> =>
  Effect.fail(new EvidenceManifestChainFailure({ detail, index, reason }))

/**
 * Checks only the immutable predecessor relationship. Workflow protocols own
 * whether a qualified chain authorizes acceptance, promotion, or completion.
 */
export const validateEvidenceManifestChain = Effect.fn("EvidenceManifestChain.validate")(function* (
  links: ReadonlyArray<EvidenceManifestChainLink>
) {
  const first = links[0]
  if (first === undefined) {
    return yield* chainFailure(emptyChainIndex, "EmptyChain", "no sealed evidence manifests were supplied")
  }
  if (first.predecessor !== null) {
    return yield* chainFailure(0, "RootHasPredecessor", "the first sealed manifest must have no predecessor")
  }
  let index = 1
  let previous = first
  for (const current of links.slice(1)) {
    if (current.predecessor === null || !evidenceReferenceEquals(current.predecessor, previous.reference)) {
      return yield* chainFailure(
        index,
        "PredecessorMismatch",
        `sealed manifest ${index} does not name the immediately preceding manifest`
      )
    }
    previous = current
    index += 1
  }
})
