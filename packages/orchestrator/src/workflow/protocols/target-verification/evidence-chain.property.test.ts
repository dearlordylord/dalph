import { it } from "@effect/vitest"
import { Effect } from "effect"
import fc from "fast-check"
import { expect } from "vitest"
import { EvidenceDigest, EvidenceReference } from "@dalph/contracts"
import { EvidenceManifestChainLink, validateEvidenceManifestChain } from "./evidence-chain.js"

const reference = (digest: string, byteLength: number): EvidenceReference =>
  EvidenceReference.make({ byteLength, digest: EvidenceDigest.make(digest.repeat(64 / digest.length)) })

it("accepts every generated immutable chain with its exact adjacent predecessor", () => {
  const references = fc
    .uniqueArray(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 8, selector: (value) => value })
    .map((values) => values.map((value) => reference(value.toString(16).padStart(64, "0"), value)))
  fc.assert(
    fc.property(references, (chainReferences) => {
      const links = chainReferences.map((chainReference, index) =>
        EvidenceManifestChainLink.make({
          predecessor: index === 0 ? null : (chainReferences[index - 1] as EvidenceReference),
          reference: chainReference
        })
      )
      expect(Effect.runSync(validateEvidenceManifestChain(links))).toBeUndefined()
    })
  )
})
