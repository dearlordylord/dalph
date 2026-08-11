import { Schema } from "effect"
import { expect, it } from "vitest"
import { AuthoredScenarioCassette } from "../../src/cassettes/authored-domain.js"
import { renderAuthoredCassetteDeliveryScope } from "../../src/cassettes/authored-presentation.js"
import {
  deliveryFinalitySpineAuthoredCassette,
  deliveryInvariantStoryAuthoredCassette
} from "../../src/cassettes/catalog.js"

it("renders every tracker-success intent in maintainer language", () => {
  expect(renderAuthoredCassetteDeliveryScope({ _tag: "FocusedWorkflowSlice", trackerSuccessIntents: [] })).toContain(
    "no task reaches tracker success"
  )
  expect(renderAuthoredCassetteDeliveryScope(deliveryFinalitySpineAuthoredCassette.deliveryScope)).toContain(
    "Dalph delivery demonstrated: A"
  )
  expect(renderAuthoredCassetteDeliveryScope(deliveryFinalitySpineAuthoredCassette.deliveryScope)).toContain(
    "Tracker success intentionally supplied outside Dalph: B, C, D, E, F, G"
  )
  expect(renderAuthoredCassetteDeliveryScope(deliveryInvariantStoryAuthoredCassette.deliveryScope)).toContain(
    "Normal Dalph delivery target not yet demonstrated: A (blocked by #167)"
  )
  expect(renderAuthoredCassetteDeliveryScope({ _tag: "CompleteGraphDelivery" })).toContain("every observed graph task")
})

it("rejects treating a partially finalized accepted result as outside completion", () => {
  const withoutDeletion = {
    ...deliveryFinalitySpineAuthoredCassette,
    story: deliveryFinalitySpineAuthoredCassette.story.filter((item) => item._tag !== "CompletionClaimDeletionApplied")
  }

  expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(withoutDeletion)).toThrow(
    /task A claims Dalph delivery without its exact integration and finality chain/u
  )
})
