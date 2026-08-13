import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { EvidenceDigest, EvidenceReference } from "@dalph/contracts"
import {
  EvidenceManifestChainFailure,
  EvidenceManifestChainLink,
  validateEvidenceManifestChain
} from "./evidence-chain.js"

const reference = (digest: string, byteLength: number): EvidenceReference =>
  EvidenceReference.make({ byteLength, digest: EvidenceDigest.make(digest.repeat(64 / digest.length)) })

it.effect("validates the exact predecessor for every reopened sealed manifest", () =>
  Effect.gen(function* () {
    const first = reference("a", 1)
    const second = reference("b", 2)
    const third = reference("c", 3)
    const links = [
      EvidenceManifestChainLink.make({ predecessor: null, reference: first }),
      EvidenceManifestChainLink.make({ predecessor: first, reference: second }),
      EvidenceManifestChainLink.make({ predecessor: second, reference: third })
    ]
    expect(yield* validateEvidenceManifestChain(links)).toBeUndefined()
  })
)

it.effect("rejects a missing, foreign, or root predecessor before downstream work", () =>
  Effect.gen(function* () {
    const first = reference("a", 1)
    const second = reference("b", 2)
    const foreign = reference("c", 3)
    const missing = yield* validateEvidenceManifestChain([
      EvidenceManifestChainLink.make({ predecessor: null, reference: first }),
      EvidenceManifestChainLink.make({ predecessor: null, reference: second })
    ]).pipe(Effect.flip)
    const foreignFailure = yield* validateEvidenceManifestChain([
      EvidenceManifestChainLink.make({ predecessor: null, reference: first }),
      EvidenceManifestChainLink.make({ predecessor: foreign, reference: second })
    ]).pipe(Effect.flip)
    const rootFailure = yield* validateEvidenceManifestChain([
      EvidenceManifestChainLink.make({ predecessor: first, reference: second })
    ]).pipe(Effect.flip)
    expect(missing).toBeInstanceOf(EvidenceManifestChainFailure)
    expect(foreignFailure).toBeInstanceOf(EvidenceManifestChainFailure)
    expect(rootFailure).toBeInstanceOf(EvidenceManifestChainFailure)
    if (missing instanceof EvidenceManifestChainFailure) expect(missing.reason).toBe("PredecessorMismatch")
    if (foreignFailure instanceof EvidenceManifestChainFailure)
      expect(foreignFailure.reason).toBe("PredecessorMismatch")
    if (rootFailure instanceof EvidenceManifestChainFailure) expect(rootFailure.reason).toBe("RootHasPredecessor")
  })
)

it.effect("rejects an empty reopened chain", () =>
  validateEvidenceManifestChain([]).pipe(
    Effect.flip,
    Effect.tap((failure) => Effect.sync(() => expect(failure.reason).toBe("EmptyChain")))
  )
)
