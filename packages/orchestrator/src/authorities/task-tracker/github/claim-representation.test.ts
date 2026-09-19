import { ClaimOwner, ClaimToken } from "../claim.js"
import { OperationId } from "../../../workflow/identity.js"
import { Schema } from "effect"
import { expect, it } from "vitest"
import {
  GithubClaimOwner,
  githubClaimDescriptionFits,
  githubClaimDescriptionFor,
  githubClaimDescriptionMaximumLength,
  githubClaimOwnerConstraint,
  githubClaimOwnerMaximumLength
} from "./claim-representation.js"

it("accepts the largest production owner that fits the GitHub claim description", () => {
  const owner = "o".repeat(githubClaimOwnerMaximumLength)
  const parts = { operationId: "0".repeat(36), owner, token: "1".repeat(36) }

  expect(githubClaimDescriptionFor(parts)).toHaveLength(githubClaimDescriptionMaximumLength)
  expect(githubClaimDescriptionFits(parts)).toBe(true)
  expect(Schema.decodeUnknownSync(GithubClaimOwner)(owner)).toBe(ClaimOwner.make(owner))
})

it("rejects the same owner representations the GitHub adapter must reject", () => {
  const tooLongOwner = "o".repeat(githubClaimOwnerMaximumLength + 1)
  const validIdentities = { operationId: OperationId.make("0".repeat(36)), token: ClaimToken.make("1".repeat(36)) }

  expect(githubClaimDescriptionFits({ ...validIdentities, owner: tooLongOwner })).toBe(false)
  expect(githubClaimDescriptionFits({ ...validIdentities, owner: "owner|foreign" })).toBe(false)
  expect(() => Schema.decodeUnknownSync(GithubClaimOwner)(tooLongOwner)).toThrow(githubClaimOwnerConstraint)
  expect(() => Schema.decodeUnknownSync(GithubClaimOwner)("owner|foreign")).toThrow(githubClaimOwnerConstraint)
})
