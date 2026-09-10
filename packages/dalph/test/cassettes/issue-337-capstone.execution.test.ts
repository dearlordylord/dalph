import { NodeCrypto } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { runAuthoredScenarioCassette } from "../../src/cassettes/authored-runner.js"
import { deliveryStoryCapstoneAuthoredCassette } from "../../src/cassettes/delivery-story-capstone.js"

it.effect(
  "maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run",
  () =>
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(deliveryStoryCapstoneAuthoredCassette)
      expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
      expect(run.records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
      expect(run.records.filter(({ event }) => event._tag === "WorkflowRunTerminated")).toHaveLength(1)
    }).pipe(Effect.provide(NodeCrypto.layer)),
  600_000
)
