import { NodeCrypto } from "@effect/platform-node"
import { Effect } from "effect"
import { expect, it } from "vitest"
import {
  maintainedAuthoredCassetteCatalog,
  runAuthoredScenarioCassette
} from "../../src/cassettes/index.js"

it("captures delivery publications and live runtime owners in one authored observation order", async () => {
  const run = await Effect.runPromise(
    runAuthoredScenarioCassette(
      maintainedAuthoredCassetteCatalog.acceptedResultRestartsIntoIntegration
    ).pipe(Effect.provide(NodeCrypto.layer))
  )

  expect(run.observationMoments.map(({ captureOrder }) => captureOrder)).toEqual(
    run.observationMoments.map((_, index) => index + 1)
  )
  expect(run.observationMoments.map(({ activationOrdinal, captureOrder, storyPosition }) => ({
    activationOrdinal,
    captureOrder,
    storyPosition
  }))).toEqual(run.observationCaptures.map(({ activationOrdinal, captureOrder, storyPosition }) => ({
    activationOrdinal,
    captureOrder,
    storyPosition
  })))
  for (const moment of run.observationMoments) {
    expect(moment.activationOrdinal).toBeGreaterThan(0)
    expect(moment.storyPosition).toBeGreaterThanOrEqual(0)
    expect(moment.storyPosition).toBeLessThanOrEqual(run.cassette.story.length)
    if (moment._tag === "AuthoredStoryOccurrenceMoment") {
      expect(moment.occurrence).toEqual(run.cassette.story[moment.storyPosition - 1])
    }
  }
  expect(run.observationMoments.some(({ _tag }) => _tag === "AuthoredStoryOccurrenceMoment")).toBe(true)
  expect(run.observationMoments.some(({ _tag }) => _tag === "DeliveryPublicationMoment")).toBe(true)
  expect(
    run.observationMoments.some((moment) =>
      moment._tag === "DeliveryRuntimeOwnersMoment"
      && moment.liveOwners.some(({ _tag }) => _tag === "AdmittedDeliveryAction")
    )
  ).toBe(true)
  expect(
    run.observationMoments.some((moment) =>
      moment._tag === "DeliveryRuntimeOwnersMoment"
      && moment.liveOwners.some(({ _tag }) =>
        _tag === "MaterializedDeliveryAction" && moment.liveOwners.some((owner) =>
          owner._tag === "MaterializedDeliveryAction" && owner.intent === "IntentRecorded"
        )
      )
    )
  ).toBe(true)
  expect(
    run.observationMoments.some((moment) =>
      moment._tag === "DeliveryRuntimeOwnersMoment"
      && moment.liveOwners.some(({ _tag }) => _tag.startsWith("Settled"))
    )
  ).toBe(true)

  const runtimeOwners = run.observationMoments.flatMap((moment, index) =>
    moment._tag === "DeliveryRuntimeOwnersMoment"
      ? moment.liveOwners.map((owner) => ({ index, owner }))
      : []
  )
  const admitted = runtimeOwners.find(({ owner }) => owner._tag === "AdmittedDeliveryAction")
  const materialized = runtimeOwners.find(({ owner }) =>
    owner._tag === "MaterializedDeliveryAction" && owner.intent === "IntentNotRecorded"
  )
  const intentRecorded = runtimeOwners.find(({ owner }) =>
    owner._tag === "MaterializedDeliveryAction" && owner.intent === "IntentRecorded"
  )
  const settled = runtimeOwners.find(({ owner }) => owner._tag.startsWith("Settled"))
  expect(admitted).toBeDefined()
  expect(materialized).toBeDefined()
  expect(intentRecorded).toBeDefined()
  expect(settled).toBeDefined()
  if (admitted === undefined || materialized === undefined || intentRecorded === undefined || settled === undefined) return
  expect(admitted.index).toBeLessThan(materialized.index)
  expect(materialized.index).toBeLessThan(intentRecorded.index)
  expect(intentRecorded.index).toBeLessThan(settled.index)
  expect(materialized.owner.proposal).toEqual(admitted.owner.proposal)
  expect(intentRecorded.owner.proposal).toEqual(admitted.owner.proposal)
  expect(settled.owner.proposal).toEqual(admitted.owner.proposal)
  if (materialized.owner._tag !== "MaterializedDeliveryAction") return
  if (intentRecorded.owner._tag !== "MaterializedDeliveryAction") return
  if (settled.owner._tag !== "SettledMaterializedDeliveryAction") return
  expect(intentRecorded.owner.operationId).toBe(materialized.owner.operationId)
  expect(settled.owner.operationId).toBe(materialized.owner.operationId)
})
