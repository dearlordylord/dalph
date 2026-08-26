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

const withExecutorReportRendezvous = (members: ReadonlyArray<unknown>) => ({
  ...deliveryFinalitySpineAuthoredCassette,
  story: [
    ...deliveryFinalitySpineAuthoredCassette.story.slice(0, 2),
    { _tag: "CassetteRendezvousesExecutorReportsBeforeJournalAppend", members },
    ...deliveryFinalitySpineAuthoredCassette.story.slice(2)
  ]
})

it("rejects an empty executor-report rendezvous", () => {
  expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(withExecutorReportRendezvous([]))).toThrow()
})

it("rejects duplicate exact members in an executor-report rendezvous", () => {
  const member = { attemptId: "attempt:A:0", request: "StartOrContinue", taskId: "A" }
  expect(() =>
    Schema.decodeUnknownSync(AuthoredScenarioCassette)(withExecutorReportRendezvous([member, member]))
  ).toThrow(/must name unique exact task, attempt, and request identities/u)
})

it("keeps structurally distinct rendezvous members distinct when IDs contain colons", () => {
  const formerlyColliding = [
    { attemptId: "c", request: "StartOrContinue", taskId: "a:b" },
    { attemptId: "b:c", request: "StartOrContinue", taskId: "a" }
  ]
  expect(() =>
    Schema.decodeUnknownSync(AuthoredScenarioCassette)(withExecutorReportRendezvous(formerlyColliding))
  ).not.toThrow()
})

it("rejects an executor-report progress rendezvous without a Running-capable report", () => {
  expect(() =>
    Schema.decodeUnknownSync(AuthoredScenarioCassette)(
      withExecutorReportRendezvous([{ attemptId: "attempt:A:0", request: "Suspend", taskId: "A" }])
    )
  ).toThrow(/must name at least one StartOrContinue report/u)
})

const withSuspensionItems = (items: ReadonlyArray<unknown>) => ({
  ...deliveryFinalitySpineAuthoredCassette,
  story: [
    ...deliveryFinalitySpineAuthoredCassette.story.slice(0, -1),
    ...items,
    deliveryFinalitySpineAuthoredCassette.story.at(-1)
  ]
})

const suspensionHold = {
  _tag: "CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary",
  attemptId: "attempt:A:0",
  taskId: "A"
}
const suspensionRelease = {
  _tag: "CassetteReleasesHeldPlannedAttemptSuspension",
  attemptId: "attempt:A:0",
  taskId: "A"
}

it("accepts independently paired exact suspension gates", () => {
  expect(() =>
    Schema.decodeUnknownSync(AuthoredScenarioCassette)(
      withSuspensionItems([
        suspensionHold,
        { ...suspensionHold, attemptId: "attempt:D:0", taskId: "D" },
        suspensionRelease,
        { ...suspensionRelease, attemptId: "attempt:D:0", taskId: "D" }
      ])
    )
  ).not.toThrow()
})

it("rejects duplicate exact suspension holds", () => {
  expect(() =>
    Schema.decodeUnknownSync(AuthoredScenarioCassette)(
      withSuspensionItems([suspensionHold, suspensionHold, suspensionRelease])
    )
  ).toThrow(/must configure one unique exact task, attempt, and Suspend identity/u)
})

it("rejects a suspension release for a foreign exact gate", () => {
  expect(() =>
    Schema.decodeUnknownSync(AuthoredScenarioCassette)(
      withSuspensionItems([
        suspensionHold,
        { ...suspensionRelease, attemptId: "attempt:D:0", taskId: "D" },
        suspensionRelease
      ])
    )
  ).toThrow(/must match one earlier unreleased exact hold/u)
})

it("rejects a suspension hold without its exact release", () => {
  expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(withSuspensionItems([suspensionHold]))).toThrow(
    /must have one later exact release/u
  )
})
