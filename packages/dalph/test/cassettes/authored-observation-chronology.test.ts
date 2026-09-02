import { NodeCrypto } from "@effect/platform-node"
import { Effect } from "effect"
import { expect, it } from "vitest"
import { maintainedAuthoredCassetteCatalog, runAuthoredScenarioCassette } from "../../src/cassettes/index.js"
import { makeAuthoredRuntimeObservationCaptureObserver } from "../../src/cassettes/authored-runtime-observation-capture.js"

it("captures runtime evaluations, delivery publications, and live owners in one authored observation order", async () => {
  const run = await Effect.runPromise(
    runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.acceptedResultRestartsIntoIntegration).pipe(
      Effect.provide(NodeCrypto.layer)
    )
  )

  expect(run.observationMoments.map(({ captureOrder }) => captureOrder)).toEqual(
    run.observationMoments.map((_, index) => index + 1)
  )
  expect(
    run.observationMoments.map(({ activationOrdinal, captureOrder, storyPosition }) => ({
      activationOrdinal,
      captureOrder,
      storyPosition
    }))
  ).toEqual(
    run.observationCaptures.map(({ activationOrdinal, captureOrder, storyPosition }) => ({
      activationOrdinal,
      captureOrder,
      storyPosition
    }))
  )
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
  const runtimeEvaluationCaptures = run.observationCaptures.filter(
    (capture) => capture._tag === "DeliveryRuntimeEvaluationCaptured"
  )
  expect(runtimeEvaluationCaptures.length).toBeGreaterThan(0)
  for (const capture of runtimeEvaluationCaptures) {
    expect("liveOwners" in capture).toBe(false)
    const moment = run.observationMoments.find(({ captureOrder }) => captureOrder === capture.captureOrder)
    expect(moment?._tag).toBe("DeliveryRuntimeEvaluationMoment")
    if (moment?._tag === "DeliveryRuntimeEvaluationMoment") expect(moment.evaluation).toBe(capture.evaluation)
  }

  const evaluation = runtimeEvaluationCaptures[0]?.evaluation
  expect(evaluation).toBeDefined()
  if (evaluation === undefined) return
  let nextCorrelation = 0
  const explicitlyCaptured: Array<{ readonly correlation: number; readonly evaluation: typeof evaluation }> = []
  const explicitlyCapturedOwners: Array<unknown> = []
  const observer = await Effect.runPromise(
    makeAuthoredRuntimeObservationCaptureObserver({
      captureEvaluation: (captured, correlation) =>
        Effect.sync(() => explicitlyCaptured.push({ correlation, evaluation: captured })),
      captureOwners: (liveOwners) => Effect.sync(() => explicitlyCapturedOwners.push(liveOwners)),
      correlate: () =>
        Effect.sync(() => {
          nextCorrelation += 1
          return nextCorrelation
        })
    })
  )
  for (let index = 0; index < 3; index += 1) {
    await Effect.runPromise(observer.observe({ _tag: "Ready", evaluation, liveOwners: [] }))
  }
  expect(explicitlyCaptured.map(({ correlation }) => correlation)).toEqual([1, 2, 3])
  expect(explicitlyCaptured.map(({ evaluation }) => evaluation)).toEqual([evaluation, evaluation, evaluation])
  expect(explicitlyCapturedOwners).toEqual([])
  expect(
    run.observationMoments.some(
      (moment) =>
        moment._tag === "DeliveryRuntimeOwnersMoment" &&
        moment.liveOwners.some(({ _tag }) => _tag === "AdmittedDeliveryAction")
    )
  ).toBe(true)
  expect(
    run.observationMoments.some(
      (moment) =>
        moment._tag === "DeliveryRuntimeOwnersMoment" &&
        moment.liveOwners.some(
          ({ _tag }) =>
            _tag === "MaterializedDeliveryAction" &&
            moment.liveOwners.some(
              (owner) => owner._tag === "MaterializedDeliveryAction" && owner.intent === "IntentRecorded"
            )
        )
    )
  ).toBe(true)
  expect(
    run.observationMoments.some(
      (moment) =>
        moment._tag === "DeliveryRuntimeOwnersMoment" &&
        moment.liveOwners.some(({ _tag }) => _tag.startsWith("Settled"))
    )
  ).toBe(true)

  const runtimeOwners = run.observationMoments.flatMap((moment, index) =>
    moment._tag === "DeliveryRuntimeOwnersMoment" ? moment.liveOwners.map((owner) => ({ index, owner })) : []
  )
  const admitted = runtimeOwners.find(({ owner }) => owner._tag === "AdmittedDeliveryAction")
  const materialized = runtimeOwners.find(
    ({ owner }) => owner._tag === "MaterializedDeliveryAction" && owner.intent === "IntentNotRecorded"
  )
  const intentRecorded = runtimeOwners.find(
    ({ owner }) => owner._tag === "MaterializedDeliveryAction" && owner.intent === "IntentRecorded"
  )
  const settled = runtimeOwners.find(({ owner }) => owner._tag.startsWith("Settled"))
  expect(admitted).toBeDefined()
  expect(materialized).toBeDefined()
  expect(intentRecorded).toBeDefined()
  expect(settled).toBeDefined()
  if (admitted === undefined || materialized === undefined || intentRecorded === undefined || settled === undefined)
    return
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
