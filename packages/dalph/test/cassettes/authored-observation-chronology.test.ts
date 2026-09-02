import { NodeCrypto } from "@effect/platform-node"
import { Deferred, Effect, Fiber } from "effect"
import { expect, it } from "vitest"
import type * as PublicCassettes from "../../src/cassettes/index.js"
import {
  type AuthoredObservationCapture,
  type AuthoredObservationMoment,
  maintainedAuthoredCassetteCatalog,
  runAuthoredScenarioCassette
} from "../../src/cassettes/index.js"
import { runAuthoredScenarioCassetteWithRuntimeEvaluations } from "../../src/cassettes/authored-runner.js"
import { makeAuthoredRuntimeObservationCaptureObserver } from "../../src/cassettes/authored-runtime-observation-capture.js"

type PublicRuntimeEvaluationCapture = Extract<
  AuthoredObservationCapture,
  { readonly _tag: "DeliveryRuntimeEvaluationCaptured" }
>
type PublicRuntimeEvaluationMoment = Extract<
  AuthoredObservationMoment,
  { readonly _tag: "DeliveryRuntimeEvaluationMoment" }
>

const publicCaptureShapePreserved: PublicRuntimeEvaluationCapture extends never ? true : false = true
const publicMomentShapePreserved: PublicRuntimeEvaluationMoment extends never ? true : false = true
const internalEvaluationRunnerNotPublic: "runAuthoredScenarioCassetteWithRuntimeEvaluations" extends keyof typeof PublicCassettes
  ? false
  : true = true

it("captures delivery publications and live runtime owners in one authored observation order", async () => {
  expect(publicCaptureShapePreserved).toBe(true)
  expect(publicMomentShapePreserved).toBe(true)
  expect(internalEvaluationRunnerNotPublic).toBe(true)
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
  expect(
    run.observationCaptures.some(
      (capture) => (capture as { readonly _tag: string })._tag === "DeliveryRuntimeEvaluationCaptured"
    )
  ).toBe(false)
  expect(
    run.observationMoments.some(
      (moment) => (moment as { readonly _tag: string })._tag === "DeliveryRuntimeEvaluationMoment"
    )
  ).toBe(false)

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

it("keeps every runtime evaluation callback in the source-local evidence seam", async () => {
  const run = await Effect.runPromise(
    runAuthoredScenarioCassetteWithRuntimeEvaluations(
      maintainedAuthoredCassetteCatalog.acceptedResultRestartsIntoIntegration
    ).pipe(Effect.provide(NodeCrypto.layer))
  )
  const evaluation = run.runtimeEvaluationCaptures[0]?.evaluation
  expect(evaluation).toBeDefined()
  if (evaluation === undefined) return
  for (const capture of run.runtimeEvaluationCaptures) {
    expect("liveOwners" in capture).toBe(false)
    expect(capture.activationOrdinal).toBeGreaterThan(0)
    expect(capture.storyPosition).toBeGreaterThanOrEqual(0)
    expect(capture.storyPosition).toBeLessThanOrEqual(run.cassette.story.length)
  }

  let nextCorrelation = 0
  const explicitlyCaptured: Array<{ readonly correlation: number; readonly evaluation: typeof evaluation }> = []
  const explicitlyCapturedOwners: Array<unknown> = []
  const observer = await Effect.runPromise(
    makeAuthoredRuntimeObservationCaptureObserver(
      {
        captureOwners: (liveOwners) => Effect.sync(() => explicitlyCapturedOwners.push(liveOwners)),
        correlateOwners: () => Effect.void
      },
      {
        captureEvaluation: (captured, correlation) =>
          Effect.sync(() => explicitlyCaptured.push({ correlation, evaluation: captured })),
        correlateEvaluation: () =>
          Effect.sync(() => {
            nextCorrelation += 1
            return nextCorrelation
          })
      }
    )
  )
  for (let index = 0; index < 3; index += 1) {
    await Effect.runPromise(observer.observe({ _tag: "Ready", evaluation, liveOwners: [] }))
  }
  expect(explicitlyCaptured.map(({ correlation }) => correlation)).toEqual([1, 2, 3])
  expect(explicitlyCaptured.map(({ evaluation }) => evaluation)).toEqual([evaluation, evaluation, evaluation])
  expect(explicitlyCapturedOwners).toEqual([])
})

it("samples owner correlation before evaluation capture can advance the authored cursor", async () => {
  const run = await Effect.runPromise(
    runAuthoredScenarioCassetteWithRuntimeEvaluations(
      maintainedAuthoredCassetteCatalog.acceptedResultRestartsIntoIntegration
    ).pipe(Effect.provide(NodeCrypto.layer))
  )
  const evaluation = run.runtimeEvaluationCaptures[0]?.evaluation
  const owners = run.observationCaptures.find(
    (capture) => capture._tag === "DeliveryRuntimeOwnersCaptured" && capture.liveOwners.length > 0
  )
  if (evaluation === undefined || owners?._tag !== "DeliveryRuntimeOwnersCaptured") {
    return expect.fail("expected one evaluation and one non-empty owner snapshot")
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const evaluationCaptureStarted = yield* Deferred.make<void>()
      const releaseEvaluationCapture = yield* Deferred.make<void>()
      const ownerCorrelations: Array<number> = []
      const ownerSamples: Array<number> = []
      const evaluationCorrelations: Array<number> = []
      let cursorPosition = 11
      const observer = yield* makeAuthoredRuntimeObservationCaptureObserver(
        {
          captureOwners: (_liveOwners, correlation) =>
            Effect.sync(() => {
              ownerCorrelations.push(correlation)
            }),
          correlateOwners: () =>
            Effect.sync(() => {
              ownerSamples.push(cursorPosition)
              return cursorPosition
            })
        },
        {
          captureEvaluation: (_evaluation, correlation) =>
            Effect.gen(function* () {
              evaluationCorrelations.push(correlation)
              if (evaluationCorrelations.length !== 1) return
              yield* Deferred.succeed(evaluationCaptureStarted, undefined)
              yield* Deferred.await(releaseEvaluationCapture)
            }),
          correlateEvaluation: () => Effect.sync(() => cursorPosition)
        }
      )
      const firstCallback = yield* observer
        .observe({ _tag: "Ready", evaluation, liveOwners: owners.liveOwners })
        .pipe(Effect.forkChild)
      yield* Deferred.await(evaluationCaptureStarted)
      cursorPosition = 12
      yield* Deferred.succeed(releaseEvaluationCapture, undefined)
      yield* Fiber.join(firstCallback)
      cursorPosition = 13
      yield* observer.observe({ _tag: "Ready", evaluation, liveOwners: owners.liveOwners })
      return { evaluationCorrelations, ownerCorrelations, ownerSamples }
    })
  )

  expect(result).toEqual({ evaluationCorrelations: [11, 13], ownerCorrelations: [11], ownerSamples: [11, 13] })
})
