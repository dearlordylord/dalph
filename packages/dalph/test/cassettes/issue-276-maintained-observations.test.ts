import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect } from "effect"
import { expect } from "vitest"
import { maintainedAuthoredCassetteCatalog, runAuthoredScenarioCassette } from "../../src/cassettes/index.js"

for (const key of [
  "dependentTasksCompleteInOneRun",
  "productionShapedFiveTaskDiamond",
  "deliveryInvariantStory"
] as const) {
  it.effect(
    `preserves maintained authored moments after fresh-claim integration progress in ${key}`,
    () =>
      Effect.gen(function* () {
        const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog[key]).pipe(
          Effect.mapError((failure) => ({ key, failure }))
        )
        expect(run.observationMoments.map(({ captureOrder }) => captureOrder)).toEqual(
          run.observationCaptures.map(({ captureOrder }) => captureOrder)
        )
        expect(run.observationMoments.some(({ _tag }) => _tag === "AuthoredStoryOccurrenceMoment")).toBe(true)
        expect(run.observationMoments.some(({ _tag }) => _tag === "DeliveryRuntimeOwnersMoment")).toBe(true)
        expect(
          run.observationMoments
            .filter(({ _tag }) => _tag === "DeliveryPublicationMoment")
            .map((moment) => moment.deliveryFrame)
        ).toEqual(run.deliveryFrames)
        const acquired = run.records.find(
          ({ event }) => event._tag === "TaskClaimAcquired" && event.claim.taskId === "A"
        )
        const lineage = run.records.find(
          ({ event }) => event._tag === "TargetLineageObserved" && event.plannedAttempt.taskId === "A"
        )
        const intended = run.records.find(
          ({ event }) => event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.taskId === "A"
        )
        if (
          acquired?.event._tag !== "TaskClaimAcquired" ||
          lineage?.event._tag !== "TargetLineageObserved" ||
          intended?.event._tag !== "TaskClaimAcquisitionIntended"
        ) {
          return yield* Effect.die(`${key}: A requires acquisition intent, acquired claim, and target lineage records`)
        }
        expect(acquired.event.claim).toMatchObject(intended.event.operation.acquisition)
        expect(lineage.event.plannedAttempt).toMatchObject({
          attemptId: "attempt:A:0",
          runId: acquired.runId,
          taskId: acquired.event.claim.taskId
        })
        expect(acquired.position).toBeGreaterThan(intended.position)
        expect(lineage.position).toBeGreaterThan(acquired.position)
        if (key === "productionShapedFiveTaskDiamond") {
          const beganE = run.records.find(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.taskId === "E"
          )
          const settledB = run.records.find(
            ({ event }) => event._tag === "IntegrationFinalitySettled" && event.claim.plannedAttempt.taskId === "B"
          )
          expect(beganE?.position).toBeLessThan(settledB?.position ?? 0)
        }
      }).pipe(Effect.provide(NodeCrypto.layer)),
    60_000
  )
}
