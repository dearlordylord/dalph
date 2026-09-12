import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { TraceOutputError } from "@dalph/orchestrator"
import { maintainedAuthoredCassetteCatalog, runAuthoredScenarioCassette } from "../../src/cassettes/index.js"
import { AuthoredCassetteInteractionMismatch } from "../../src/cassettes/authored-cursor.js"

const cassette = maintainedAuthoredCassetteCatalog.deliveryStoryDs14ThroughDs17
const unsettledReturnAt = cassette.story.findIndex(
  (item) =>
    item._tag === "CoordinatorActivationReturned" &&
    item.decision._tag === "RunMustRemainActive" &&
    item.decision.reason === "TrackerTargetUnsettled"
)

it.effect("settles A's FullRerun and reads both next-activation graphs before the Run terminates", () =>
  Effect.gen(function* () {
    expect(unsettledReturnAt).toBeGreaterThan(0)
    const run = yield* runAuthoredScenarioCassette(cassette)
    expect(run.activationOrdinals).toEqual([1, 2, 3])
    const thirdActivation = run.observationCaptures.flatMap((capture) =>
      capture._tag === "AuthoredStoryOccurrenceCaptured" && capture.activationOrdinal === 3 ? [capture.occurrence] : []
    )
    expect(thirdActivation.map(({ _tag }) => _tag)).toEqual([
      "DalphSelects",
      "TrackerGraphReadReturned",
      "DalphSelects",
      "TrackerGraphReadReturned",
      "CoordinatorActivationReturned",
      "ExpectedBehavior"
    ])
    expect(thirdActivation[1]).toEqual(thirdActivation[3])
    expect(
      run.observationCaptures.filter((capture) => capture._tag === "AuthoredStoryOccurrenceCaptured")
    ).toHaveLength(cassette.story.length)
    expect(run.traceHistories).toHaveLength(run.records.length)
    expect(run.traceHistories.map(({ cursor }) => cursor.position)).toEqual(run.records.map(({ position }) => position))
    for (const tag of [
      "IntegratorSuccessorSessionFixed",
      "TargetPromotionObservedSuccess",
      "IntegrationFinalitySettled"
    ]) {
      expect(run.records.filter(({ event }) => event._tag === tag)).toHaveLength(1)
    }
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects omitting A's settled activation return before the next tracker read", () =>
  Effect.gen(function* () {
    expect(unsettledReturnAt).toBeGreaterThan(0)
    const failure = yield* runAuthoredScenarioCassette({
      ...cassette,
      story: cassette.story.filter((_, index) => index !== unsettledReturnAt)
    }).pipe(Effect.flip)
    if (!Schema.is(AuthoredCassetteInteractionMismatch)(failure)) {
      return yield* Effect.die("omitted activation boundary must fail as a cassette interaction mismatch")
    }
    expect(failure).toMatchObject({
      actual: "CoordinatorActivationReturned",
      expected: "DalphSelects",
      storyPosition: unsettledReturnAt
    })
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects omitting the post-quiescence graph before A's declared terminal activation return", () =>
  Effect.gen(function* () {
    const secondGraphAt = unsettledReturnAt + 3
    expect(cassette.story[secondGraphAt]).toMatchObject({
      _tag: "DalphSelects",
      operation: { _tag: "ReadTrackerGraph" }
    })
    expect(cassette.story[secondGraphAt + 1]?._tag).toBe("TrackerGraphReadReturned")
    const failure = yield* runAuthoredScenarioCassette({
      ...cassette,
      story: cassette.story.filter((_, index) => index !== secondGraphAt && index !== secondGraphAt + 1)
    }).pipe(Effect.flip)
    if (!Schema.is(TraceOutputError)(failure)) return yield* Effect.die("omitted graph must fail at trace selection")
    expect(failure.detail).toBe(
      `AuthoredCassetteInteractionMismatch at story position ${secondGraphAt}: expected CoordinatorActivationReturned, received {"_tag":"ReadTrackerGraph","target":"cassette-target"} while emitting {"_tag":"ReadTrackerGraph","target":"cassette-target"}`
    )
  }).pipe(Effect.provide(NodeCrypto.layer))
)
