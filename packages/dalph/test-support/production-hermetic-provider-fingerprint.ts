import { EvidenceDigest } from "@dalph/contracts"
import { Crypto, Effect, Schema } from "effect"

const hexadecimalRadix = 16
const hexadecimalByteWidth = 2

/** Measures the original receipt content; a later current fingerprint never refreshes creation ownership. */
export const makeHermeticProviderFingerprint = Effect.fn("HermeticProvider.makeFingerprint")(function* () {
  const crypto = yield* Crypto.Crypto
  const fingerprint = (text: string) =>
    crypto
      .digest("SHA-256", new TextEncoder().encode(text))
      .pipe(
        Effect.flatMap((bytes) =>
          Schema.decodeUnknownEffect(EvidenceDigest)(
            Array.from(bytes, (byte) => byte.toString(hexadecimalRadix).padStart(hexadecimalByteWidth, "0")).join("")
          )
        )
      )
  return fingerprint
})
