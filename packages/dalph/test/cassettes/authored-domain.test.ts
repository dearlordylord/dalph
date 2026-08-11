import { Schema } from "effect"
import { expect, it } from "vitest"
import { AuthoredScenarioCassette } from "../../src/cassettes/authored-domain.js"
import { deliveryFinalitySpineAuthoredCassette } from "../../src/cassettes/catalog.js"

it("accepts an exact in-flight prefix of the completion-finality boundary chronology", () => {
  const withoutDeletion = {
    ...deliveryFinalitySpineAuthoredCassette,
    story: deliveryFinalitySpineAuthoredCassette.story
      .filter((item) => item._tag !== "CompletionClaimReadReturned" || item.claim !== "Completion")
      .filter((item) => item._tag !== "CompletionClaimDeletionApplied")
  }

  expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(withoutDeletion)).not.toThrow()
})

it("rejects a skipped step in the authored completion-finality boundary chronology", () => {
  const withoutReplacement = {
    ...deliveryFinalitySpineAuthoredCassette,
    story: deliveryFinalitySpineAuthoredCassette.story.filter(
      (item) => item._tag !== "CompletionClaimReplacementApplied"
    )
  }

  expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(withoutReplacement)).toThrow(
    /must be an exact prefix of read Active, replace, read Completion, and delete/u
  )
})
