import { Schema } from "effect"
import { expect, it } from "vitest"
import { AuthoredScenarioCassette } from "../../src/cassettes/authored-domain.js"
import { renderAuthoredCassetteDeliveryScope } from "../../src/cassettes/authored-presentation.js"
import { deliveryFinalitySpineAuthoredCassette } from "../../src/cassettes/catalog.js"

it("renders focused and complete delivery provenance in maintainer language", () => {
  expect(
    renderAuthoredCassetteDeliveryScope({ _tag: "FocusedWorkflowSlice", externallyCompletedTaskIds: [] })
  ).toContain("no externally completed tracker task")
  expect(renderAuthoredCassetteDeliveryScope(deliveryFinalitySpineAuthoredCassette.deliveryScope)).toContain(
    "External tracker-completion corner case: B, C, D, E, F, G"
  )
  expect(renderAuthoredCassetteDeliveryScope({ _tag: "CompleteGraphDelivery" })).toContain("every observed graph task")
})

it("rejects treating a partially finalized accepted result as external completion", () => {
  const withoutDeletion = {
    ...deliveryFinalitySpineAuthoredCassette,
    story: deliveryFinalitySpineAuthoredCassette.story.filter((item) => item._tag !== "CompletionClaimDeletionApplied")
  }

  expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(withoutDeletion)).toThrow(
    /task A reached tracker success before its accepted result completed Dalph integration and finality/u
  )
})
