import { Schema } from "effect"
import { expect, it } from "vitest"
import { AuthoredScenarioCassette } from "../../src/cassettes/authored-domain.js"
import { deliveryInvariantStoryAuthoredCassette } from "../../src/cassettes/catalog.js"

it("rejects a partial authored completion-finality boundary chronology", () => {
  const withoutDeletion = {
    ...deliveryInvariantStoryAuthoredCassette,
    story: deliveryInvariantStoryAuthoredCassette.story.filter((item) => item._tag !== "CompletionClaimDeletionApplied")
  }

  expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(withoutDeletion)).toThrow(
    /must read Active, replace, read Completion, and delete exactly once in order/u
  )
})
