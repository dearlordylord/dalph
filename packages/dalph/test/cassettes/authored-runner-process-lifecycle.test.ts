import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { AcceptedJournalReader } from "@dalph/orchestrator"
import { maintainedAuthoredCassetteCatalog, useAuthoredScenarioCassette } from "../../src/cassettes/index.js"

it.effect(
  "reopens the application process after a durable append loses its live-Journal acknowledgement",
  () =>
    Effect.gen(function* () {
      const run = yield* useAuthoredScenarioCassette(
        maintainedAuthoredCassetteCatalog.deliveryStoryDs14ThroughDs17,
        (currentRun) =>
          Effect.gen(function* () {
            const accepted = yield* (yield* AcceptedJournalReader).readAccepted(currentRun.runId)
            expect(accepted.lastPosition).toBe(currentRun.records.at(-1)?.position)
            return currentRun
          })
      ).pipe(Effect.provide(NodeCrypto.layer))

      expect(run.activationOrdinals).toEqual([1, 2])
      expect(run.records.map(({ position }) => Number(position))).toEqual(
        Array.from({ length: run.records.length }, (_, index) => index + 1)
      )
      expect(run.records.slice(18, 22).map(({ event, position }) => [Number(position), event._tag])).toEqual([
        [19, "PlannedAttemptExecutorStateObserved"],
        [20, "PlannedAttemptExecutorWorkReported"],
        [21, "TaskTrackerReadIntentRecorded"],
        [22, "TaskTrackerFactsObserved"]
      ])
    }),
  120_000
)
