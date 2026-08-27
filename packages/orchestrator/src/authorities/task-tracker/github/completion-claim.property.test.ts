import { NodeCrypto } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Crypto, Effect, Schema } from "effect"
import * as fc from "fast-check"
import { ActiveTaskClaim } from "../claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../claim.js"
import { OperationId } from "../../../workflow/identity.js"
import { CompletionTaskClaim } from "../../../workflow/protocols/integration-finality/events.js"
import { integrationFinalityFixture } from "../../../workflow/protocols/integration-finality/fixtures.js"
import { githubCompletionClaimFingerprintFor } from "./completion-claim.js"

it("keeps canonical fingerprints stable across valid generated active-claim evidence", async () => {
  const identityText = fc.stringMatching(/^[A-Za-z0-9:_-]{1,30}$/)
  await fc.assert(
    fc.asyncProperty(identityText, identityText, identityText, async (operationId, owner, token) => {
      const generated = CompletionTaskClaim.make({
        ...integrationFinalityFixture.claim,
        originalClaim: ActiveTaskClaim.make({
          ...integrationFinalityFixture.activeClaim,
          operationId: OperationId.make(operationId),
          owner: ClaimOwner.make(owner),
          token: ClaimToken.make(token)
        })
      })
      const canonicalJson = await Effect.runPromise(
        Schema.encodeUnknownEffect(Schema.toCodecJson(CompletionTaskClaim))(generated)
      )
      const decoded = await Effect.runPromise(
        Schema.decodeUnknownEffect(Schema.toCodecJson(CompletionTaskClaim))(canonicalJson)
      )
      const [fingerprint, decodedFingerprint] = await Effect.runPromise(
        Effect.all([
          Effect.gen(function* () {
            return yield* githubCompletionClaimFingerprintFor(yield* Crypto.Crypto, generated)
          }),
          Effect.gen(function* () {
            return yield* githubCompletionClaimFingerprintFor(yield* Crypto.Crypto, decoded)
          })
        ]).pipe(Effect.provide(NodeCrypto.layer))
      )
      expect(decoded).toEqual(generated)
      expect(decodedFingerprint).toBe(fingerprint)
      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    })
  )
})
