import { ClaimOwner } from "../claim.js"
import { Schema } from "effect"

/** GitHub encodes one task claim in a versioned repository-label description. */
export const githubClaimDescriptionVersion = "1" as const
export const githubClaimDescriptionSeparator = "|" as const
export const githubClaimDescriptionMaximumLength = 100

/** Production allocates both identities with Crypto.randomUUIDv7. */
export const githubClaimGeneratedIdentityMaximumLength = 36

const githubClaimDescriptionSeparatorCount = 3
const githubClaimGeneratedIdentityCount = 2

/**
 * The owner budget reserves the version, separators, and both UUIDv7
 * identities in `1|operationId|claimOwner|claimToken`.
 */
export const githubClaimOwnerMaximumLength =
  githubClaimDescriptionMaximumLength -
  githubClaimDescriptionVersion.length -
  githubClaimDescriptionSeparator.length * githubClaimDescriptionSeparatorCount -
  githubClaimGeneratedIdentityMaximumLength * githubClaimGeneratedIdentityCount

export const githubClaimOwnerConstraint = `claimOwner must not contain '${githubClaimDescriptionSeparator}' and must be at most ${githubClaimOwnerMaximumLength} characters so the GitHub claim description stays within its ${githubClaimDescriptionMaximumLength}-character limit`

/** The configuration constraint and the adapter use the same owner boundary. */
export const GithubClaimOwner = ClaimOwner.check(
  Schema.makeFilter((owner) => {
    if (owner.includes(githubClaimDescriptionSeparator) || owner.length > githubClaimOwnerMaximumLength) {
      return githubClaimOwnerConstraint
    }
    return undefined
  })
)

export interface GithubClaimDescriptionParts {
  readonly operationId: string
  readonly owner: string
  readonly token: string
}

/** Encodes the exact description sent in a GitHub create-label request. */
export const githubClaimDescriptionFor = ({ operationId, owner, token }: GithubClaimDescriptionParts): string =>
  [githubClaimDescriptionVersion, operationId, owner, token].join(githubClaimDescriptionSeparator)

/**
 * Checks the provider boundary independently of configuration admission. The
 * adapter must keep this guard because non-production callers can supply
 * arbitrary operation and token identities.
 */
export const githubClaimDescriptionFits = (parts: GithubClaimDescriptionParts): boolean => {
  const components = [parts.operationId, parts.owner, parts.token]
  return (
    components.every((component) => !component.includes(githubClaimDescriptionSeparator)) &&
    githubClaimDescriptionFor(parts).length <= githubClaimDescriptionMaximumLength
  )
}
