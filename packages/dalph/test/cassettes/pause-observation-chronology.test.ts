import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Cause, Effect, Exit, Schema } from "effect"
import { expect } from "vitest"
import { TrackerAdapterReadError } from "@dalph/orchestrator"
import { maintainedAuthoredCassetteCatalog, runAuthoredScenarioCassette } from "../../src/cassettes/index.js"

const boundaries = maintainedAuthoredCassetteCatalog.taskPauseExecutorAndPromotionBoundaries

it.effect("rejects a wrong declared earlier activation result before Alice consumes buffered Pause views", () =>
  Effect.gen(function* () {
    const returnAt = boundaries.story.findLastIndex((item) => item._tag === "CoordinatorActivationReturned")
    expect(returnAt).toBeGreaterThan(0)
    const wrongReturn = {
      ...boundaries,
      story: boundaries.story.map((item, index) =>
        index === returnAt ? { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMayTerminate" } } : item
      )
    }
    const result = yield* runAuthoredScenarioCassette(wrongReturn).pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isSuccess(result)) return yield* Effect.die("wrong declared activation result was accepted")
    const diagnostic = Cause.pretty(result.cause)
    expect(diagnostic).toContain('authored coordinator activation expected {"_tag":"RunMayTerminate"}, received ')
    expect(diagnostic).toContain('"reason":"UnsettledResponsibility"')
    expect(diagnostic).toContain('"_tag":"RunMustRemainActive"')
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects an omitted final authored tracker response before Alice's expected Pause behavior", () =>
  Effect.gen(function* () {
    const expectedAt = boundaries.story.findLastIndex((item) => item._tag === "ExpectedBehavior")
    expect(expectedAt).toBe(boundaries.story.length - 1)
    const responseAt = expectedAt - 1
    expect(boundaries.story[responseAt]).toEqual({
      _tag: "TrackerGraphReadReturned",
      graph: {
        revision: "pause-executor-promotion-G1",
        tasks: [
          { id: "P", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] },
          { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: ["P"] },
          { id: "B", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: ["A"] },
          { id: "C", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
          { id: "D", lifecycle: { _tag: "Open" }, parentTaskId: "A", prerequisiteIds: [] }
        ]
      }
    })
    expect(boundaries.story[responseAt - 1]).toEqual({
      _tag: "DalphSelects",
      operation: { _tag: "ReadTrackerGraph", target: "cassette-target" }
    })
    const missingResponse = { ...boundaries, story: boundaries.story.filter((_, index) => index !== responseAt) }
    expect(missingResponse.story[responseAt]).toEqual(boundaries.story[expectedAt])
    const failure = yield* runAuthoredScenarioCassette(missingResponse).pipe(Effect.flip)
    expect(failure).toMatchObject({
      _tag: "TrackerGraphReader.AdapterReadError",
      context: { _tag: "Fixture", operation: "TrackerGraphReader.selectAdapter" },
      reason: { _tag: "BoundaryDecode" }
    })
    if (!Schema.is(TrackerAdapterReadError)(failure)) return yield* Effect.die("unexpected tracker adapter failure")
    expect(failure.detail).toBe(
      `AuthoredCassetteInteractionMismatch at story position ${responseAt}: expected ExpectedBehavior, received TrackerGraphReadFailed | TrackerGraphReadReturned | RunActivationFinalTrackerGraphReadReturned`
    )
  }).pipe(Effect.provide(NodeCrypto.layer))
)
