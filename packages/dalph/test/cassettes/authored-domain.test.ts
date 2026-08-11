import { Schema } from "effect"
import { expect, it } from "vitest"
import { TaskId } from "../../../contracts/src/task-identity.js"
import { AuthoredCassetteStoryItem, AuthoredScenarioCassette } from "../../src/cassettes/authored-domain.js"
import {
  renderAuthoredCassetteDeliveryScope,
  renderAuthoredStoryItemLyric
} from "../../src/cassettes/authored-presentation.js"
import {
  deliveryFinalitySpineAuthoredCassette,
  deliveryInvariantStoryAuthoredCassette
} from "../../src/cassettes/catalog.js"

const deliveryFinalityTrackerSuccessIntents = (() => {
  if (deliveryFinalitySpineAuthoredCassette.deliveryScope._tag !== "FocusedWorkflowSlice") {
    throw new Error("the maintained finality spine must remain a focused workflow slice")
  }
  return deliveryFinalitySpineAuthoredCassette.deliveryScope.trackerSuccessIntents
})()

it("renders every tracker-success intent in maintainer language", () => {
  expect(renderAuthoredCassetteDeliveryScope({ _tag: "FocusedWorkflowSlice", trackerSuccessIntents: [] })).toContain(
    "no task reaches tracker success"
  )
  expect(renderAuthoredCassetteDeliveryScope(deliveryFinalitySpineAuthoredCassette.deliveryScope)).toContain(
    "Dalph delivery demonstrated: A"
  )
  expect(renderAuthoredCassetteDeliveryScope(deliveryFinalitySpineAuthoredCassette.deliveryScope)).toContain(
    "Tracker success intentionally supplied outside Dalph: C, D, E, F, G"
  )
  expect(renderAuthoredCassetteDeliveryScope(deliveryInvariantStoryAuthoredCassette.deliveryScope)).toContain(
    "Normal Dalph delivery target not yet demonstrated: A (blocked by #167)"
  )
  expect(
    renderAuthoredCassetteDeliveryScope({
      _tag: "FocusedWorkflowSlice",
      trackerSuccessIntents: [{ _tag: "DalphDeliveryInProgress", taskId: TaskId.make("A") }]
    })
  ).toContain("Dalph delivery in progress: A")
  expect(renderAuthoredCassetteDeliveryScope({ _tag: "CompleteGraphDelivery" })).toContain("every observed graph task")
})

it("renders an exact completion-request lookup in maintainer language", () => {
  expect(
    renderAuthoredStoryItemLyric(
      AuthoredCassetteStoryItem.cases.CompletionTaskRequestLookupReturned.make({
        outcome: "NotApplied",
        taskId: TaskId.make("A")
      })
    )
  ).toBe("The task tracker classifies the exact completion request for task A as NotApplied.")
})

it("accepts an exact in-flight prefix of the completion-finality boundary chronology", () => {
  const withoutDeletion = {
    ...deliveryFinalitySpineAuthoredCassette,
    deliveryScope: {
      _tag: "FocusedWorkflowSlice" as const,
      trackerSuccessIntents: deliveryFinalityTrackerSuccessIntents.map((intent) =>
        intent._tag === "DalphDeliveryDemonstrated"
          ? { _tag: "DalphDeliveryInProgress" as const, taskId: intent.taskId }
          : intent
      )
    },
    story: deliveryFinalitySpineAuthoredCassette.story
      .filter((item) => item._tag !== "CompletionClaimReadReturned" || item.claim !== "Completion")
      .filter((item) => item._tag !== "CompletionClaimDeletionApplied")
  }

  expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(withoutDeletion)).not.toThrow()
})

it("rejects a skipped step in the authored completion-finality boundary chronology", () => {
  const withoutReplacement = {
    ...deliveryFinalitySpineAuthoredCassette,
    deliveryScope: {
      _tag: "FocusedWorkflowSlice" as const,
      trackerSuccessIntents: deliveryFinalityTrackerSuccessIntents.map((intent) =>
        intent._tag === "DalphDeliveryDemonstrated"
          ? { _tag: "DalphDeliveryInProgress" as const, taskId: intent.taskId }
          : intent
      )
    },
    story: deliveryFinalitySpineAuthoredCassette.story.filter(
      (item) => item._tag !== "CompletionClaimReplacementApplied"
    )
  }

  expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(withoutReplacement)).toThrow(
    /must be an exact prefix of read Active, replace, read Completion, and delete/u
  )
})
