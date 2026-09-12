import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import {
  AuthoredCassetteInteractionMismatch,
  maintainedAuthoredCassetteCatalog,
  runAuthoredScenarioCassette
} from "../../src/cassettes/index.js"

const cassette = maintainedAuthoredCassetteCatalog.deliveryInvariantStory
const returnAt = 241
const declaredReturn = {
  _tag: "CoordinatorActivationReturned",
  decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
}

it.effect(
  "returns after the paid G2 and settles F X and the complete double diamond after fresh activation facts",
  () =>
    Effect.gen(function* () {
      expect(cassette.story[returnAt]).toEqual(declaredReturn)
      expect(cassette.story.slice(returnAt + 1, returnAt + 10).map((item) => item._tag)).toEqual([
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
          capture.storyPosition > returnAt &&
          capture.storyPosition <= returnAt + 10
      )
      expect(occurrences).toHaveLength(10)
      expect(occurrences[0]).toMatchObject({ activationOrdinal: 7, occurrence: declaredReturn })
      expect(occurrences.slice(1).map(({ activationOrdinal }) => activationOrdinal)).toEqual(Array(9).fill(8))
      expect(
        run.records.flatMap(({ event }) =>
          event._tag === "IntegrationFinalitySettled" ? [event.claim.plannedAttempt.taskId] : []
        )
      ).toEqual(["A", "B", "C", "D", "E", "F", "X", "H", "I", "G"])
      expect(run.records).toHaveLength(588)
      expect(run.records.every(({ runId }) => runId === run.runId)).toBe(true)
      expect(run.records.at(-1)?.event._tag).toBe("WorkflowRunTerminated")
      expect(run.deliveryFrames.at(-1)?.heldPositions).toEqual([])
      expect(run.cassette.story.at(-1)?._tag).toBe("ExpectedBehavior")
    }).pipe(Effect.provide(NodeCrypto.layer)),
  // The existing maintained ten-task acceptance cases use this same bound.
  600_000
)

it.effect("rejects omission of the actual double-diamond activation return before its owed next graph", () =>
  Effect.gen(function* () {
    expect(cassette.story[returnAt]).toEqual(declaredReturn)
    expect(cassette.story[returnAt + 1]).toEqual({
      _tag: "DalphSelects",
      operation: { _tag: "ReadTrackerGraph", target: "double-diamond-target" }
    })
    const missingReturn = { ...cassette, story: cassette.story.filter((_, index) => index !== returnAt) }
    const failure = yield* runAuthoredScenarioCassette(missingReturn).pipe(Effect.flip)
    if (!Schema.is(AuthoredCassetteInteractionMismatch)(failure)) {
      return yield* Effect.die("omitted activation return did not fail at its exact authored cursor")
    }
    expect(failure).toMatchObject({
      _tag: "AuthoredCassetteInteractionMismatch",
      actual: "CoordinatorActivationReturned",
      expected: "DalphSelects",
      storyPosition: returnAt
    })
  }).pipe(Effect.provide(NodeCrypto.layer))
)
