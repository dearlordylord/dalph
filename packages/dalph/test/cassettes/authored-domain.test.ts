import { Schema } from "effect"
import { expect, it } from "vitest"
import { AuthoredScenarioCassette } from "../../src/cassettes/authored-domain.js"
import { deliveryFinalitySpineAuthoredCassette } from "../../src/cassettes/catalog.js"

it("accepts an exact in-flight prefix of the completion-finality boundary chronology", () => {
  const withoutDeletion = {
    ...deliveryFinalitySpineAuthoredCassette,
    story: deliveryFinalitySpineAuthoredCassette.story
      .filter((item) => item._tag !== "CompletionClaimReadReturned" || item.claim === "Active")
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
    /must be an exact prefix of active-record presence, replacement, two completion-marker presence reads, completion-marker deletion, and completion-marker absence/u
  )
})

it("keeps active-record absence distinct from completion-marker absence in authored finality", () => {
  const distinctMarkerReads = deliveryFinalitySpineAuthoredCassette

  expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(distinctMarkerReads)).not.toThrow()
  expect(() =>
    Schema.decodeUnknownSync(AuthoredScenarioCassette)({
      ...distinctMarkerReads,
      story: distinctMarkerReads.story.map((item) =>
        item._tag === "CompletionClaimReadReturned" && item.claim === "CompletionMarkerAbsent"
          ? { ...item, claim: "Unclaimed" }
          : item
      )
    })
  ).toThrow(/completion-marker absence/u)
})
