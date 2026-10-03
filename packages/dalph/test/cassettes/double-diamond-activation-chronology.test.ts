import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Result, Schema } from "effect"
import { expect } from "vitest"
import {
  AuthoredCassetteInteractionMismatch,
  maintainedAuthoredCassetteCatalog,
  runAuthoredScenarioCassette
} from "../../src/cassettes/index.js"
import { shiftAuthoredCausalWindow } from "../../src/cassettes/authored-causal-authoring.js"

// Both cases execute the maintained ten-task coordinator prefix before asserting its return.
const doubleDiamondExecutionTimeout = 600_000

const cassette = maintainedAuthoredCassetteCatalog.deliveryInvariantStory
const declaredReturn = {
  _tag: "CoordinatorActivationReturned",
  decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
}
const finalityOrder = ["A", "B", "C", "D", "E", "F", "X", "H", "I", "G"]

const paidG2BoundaryPositions = () => {
  const anchors = cassette.story.flatMap((item, storyPosition) => {
    if (item._tag !== "DalphSelects" || !("causalAnchor" in item)) return []
    const causalAnchor = item.causalAnchor
    if (causalAnchor.occurrenceRole !== "double-diamond-paid-G2") return []
    return [{ causalAnchor, storyPosition }]
  })
  if (anchors.length !== 1) {
    throw new Error(`expected one double-diamond-paid-G2 anchor, found ${anchors.length}`)
  }
  const anchor = anchors[0]
  if (anchor === undefined) {
    throw new Error("double-diamond-paid-G2 anchor is absent after uniqueness validation")
  }
  if (anchor.causalAnchor.expectedBoundary !== "CoordinatorActivationReturned") {
    throw new Error("double-diamond-paid-G2 anchor has no authored activation-return boundary")
  }
  const returnPosition = cassette.story.findIndex(
    (item, storyPosition) => storyPosition > anchor.storyPosition && item._tag === anchor.causalAnchor.expectedBoundary
  )
  if (returnPosition < 0) {
    throw new Error("double-diamond-paid-G2 anchor has no following activation return")
  }
  return { anchorPosition: anchor.storyPosition, returnPosition }
}

const assertPostPromotionPremises = (taskId: string, replacementIndex: number) => {
  const premises = cassette.story.slice(replacementIndex - 7, replacementIndex)
  expect(premises.map(({ _tag }) => _tag)).toEqual([
    "CompletionClaimReadReturned",
    "DalphSelects",
    "TrackerGraphReadReturned",
    "DalphSelects",
    "TaskWorkSpecificationReadReturned",
    "DalphSelects",
    "TaskClaimCurrentReadReturned"
  ])

  const [activeClaim, , graphRead, , specification, , currentClaim] = premises
  expect(activeClaim).toMatchObject({ _tag: "CompletionClaimReadReturned", claim: "Active", taskId })
  expect(specification).toMatchObject({
    _tag: "TaskWorkSpecificationReadReturned",
    body: `Complete double-diamond task ${taskId}.`,
    taskId,
    title: `Complete ${taskId}`
  })
  expect(currentClaim).toMatchObject({ _tag: "TaskClaimCurrentReadReturned", taskId })

  if (graphRead?._tag !== "TrackerGraphReadReturned") {
    throw new Error(`post-promotion graph was absent for ${taskId}`)
  }
  const graphTask = graphRead.graph.tasks.find((task) => task.id === taskId)
  expect(graphTask?.lifecycle._tag).toBe("Open")
  expect(
    graphTask?.prerequisiteIds.every(
      (prerequisiteId) =>
        graphRead.graph.tasks.find((task) => task.id === prerequisiteId)?.lifecycle._tag === "CompletedSuccessfully"
    )
  ).toBe(true)
}

it.effect(
  "returns after the paid G2 and settles F X and the complete double diamond after fresh activation facts",
  () =>
    Effect.gen(function* () {
      const { anchorPosition, returnPosition } = paidG2BoundaryPositions()
      expect(cassette.story[returnPosition]).toEqual(declaredReturn)
      expect(cassette.story[anchorPosition]).toEqual({
        _tag: "DalphSelects",
        causalAnchor: { occurrenceRole: "double-diamond-paid-G2", expectedBoundary: "CoordinatorActivationReturned" },
        operation: { _tag: "ReadTrackerGraph", target: "double-diamond-target" }
      })
      const replacementBoundaries = cassette.story.flatMap((item, storyPosition) =>
        item._tag === "CompletionClaimReplacementApplied" ? [{ taskId: item.taskId, storyPosition }] : []
      )
      expect(replacementBoundaries.map(({ taskId }) => taskId)).toEqual(finalityOrder)
      for (const { storyPosition, taskId } of replacementBoundaries) {
        assertPostPromotionPremises(taskId, storyPosition)
      }
      expect(cassette.story.slice(returnPosition + 1, returnPosition + 10).map((item) => item._tag)).toEqual([
        "DalphSelects",
        "TrackerGraphReadReturned",
        "DalphSelects",
        "TaskClaimCurrentReadReturned",
        "DalphSelects",
        "TaskClaimCurrentReadReturned",
        "DalphSelects",
        "TrackerGraphReadReturned",
        "DalphSelects"
      ])
      const run = yield* runAuthoredScenarioCassette(cassette)
      expect(run.activationOrdinals).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      const occurrences = run.observationCaptures.filter(
        (capture) =>
          capture._tag === "AuthoredStoryOccurrenceCaptured" &&
          capture.storyPosition > returnPosition &&
          capture.storyPosition <= returnPosition + 10
      )
      expect(occurrences).toHaveLength(10)
      expect(occurrences[0]).toMatchObject({ activationOrdinal: 7, occurrence: declaredReturn })
      expect(occurrences.slice(1).map(({ activationOrdinal }) => activationOrdinal)).toEqual(Array(9).fill(8))
      expect(
        run.records.flatMap(({ event }) =>
          event._tag === "IntegrationFinalitySettled" ? [event.claim.plannedAttempt.taskId] : []
        )
      ).toEqual(finalityOrder)
      expect(run.records).toHaveLength(700)
      expect(run.records.every(({ runId }) => runId === run.runId)).toBe(true)
      expect(run.records.at(-1)?.event._tag).toBe("WorkflowRunTerminated")
      expect(run.deliveryFrames.at(-1)?.heldPositions).toEqual([])
      expect(run.cassette.story.at(-1)?._tag).toBe("ExpectedBehavior")
    }).pipe(Effect.provide(NodeCrypto.layer)),
  doubleDiamondExecutionTimeout
)

it.effect(
  "rejects omission of the actual double-diamond activation return before its owed next graph",
  () =>
    Effect.gen(function* () {
      const { returnPosition } = paidG2BoundaryPositions()
      expect(cassette.story[returnPosition]).toEqual(declaredReturn)
      expect(cassette.story[returnPosition + 1]).toEqual({
        _tag: "DalphSelects",
        operation: { _tag: "ReadTrackerGraph", target: "double-diamond-target" }
      })
      const missingReturn = {
        ...cassette,
        story: cassette.story.filter((_, index) => index !== returnPosition),
        causalWindows: cassette.causalWindows?.map((window) =>
          window.startIndex > returnPosition ? shiftAuthoredCausalWindow(window, -1) : window
        )
      }
      const outcome = yield* runAuthoredScenarioCassette(missingReturn).pipe(Effect.result)
      if (Result.isSuccess(outcome)) {
        return yield* Effect.die("omitted activation return unexpectedly completed the double diamond")
      }
      const failure = outcome.failure
      if (!Schema.is(AuthoredCassetteInteractionMismatch)(failure)) {
        return yield* Effect.die("omitted activation return did not fail at its exact authored cursor")
      }
      expect(failure).toMatchObject({
        _tag: "AuthoredCassetteInteractionMismatch",
        actual: "CoordinatorActivationReturned",
        expected: "DalphSelects",
        storyPosition: returnPosition
      })
    }).pipe(Effect.provide(NodeCrypto.layer)),
  doubleDiamondExecutionTimeout
)
