import type { TaskId } from "@dalph/contracts"
import { Effect, Schema, type Crypto } from "effect"

/** Bounded digest shared by the active and completion repository-label names for one exact task. */
const GithubTaskClaimLabelDigest = Schema.String.check(
  Schema.makeFilter((value) =>
    /^[0-9a-f]{32}$/.test(value) ? undefined : "GitHub task claim label digest must be 128-bit hexadecimal"
  )
).pipe(Schema.brand("GithubTaskClaimLabelDigest"))
type GithubTaskClaimLabelDigest = typeof GithubTaskClaimLabelDigest.Type

const hexadecimalRadix = 16
const hexadecimalByteLength = 2
const claimLabelDigestLength = 32

/** Derives the one repository-label name digest shared by both claim record kinds. */
export const githubTaskClaimLabelDigestFor = Effect.fn("GithubTaskClaimLabel.digestFor")(function* (
  crypto: Crypto.Crypto,
  taskId: TaskId
) {
  const digest = yield* crypto.digest("SHA-256", new TextEncoder().encode(taskId))
  const hash = [...digest].map((byte) => byte.toString(hexadecimalRadix).padStart(hexadecimalByteLength, "0")).join("")
  return yield* Schema.decodeUnknownEffect(GithubTaskClaimLabelDigest)(hash.slice(0, claimLabelDigestLength))
})
