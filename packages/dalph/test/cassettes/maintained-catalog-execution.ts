import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect } from "effect"
import { expect } from "vitest"
import { maintainedAuthoredCassetteCatalog, runAuthoredScenarioCassette } from "../../src/cassettes/index.js"

const catalogEntries = Object.entries(maintainedAuthoredCassetteCatalog)
const dedicatedCapstoneKeys = new Set([
  "deliveryInvariantStory",
  "autonomousExecutorDeliveryCapstone",
  "dependentTasksCompleteInOneRun",
  "productionShapedFiveTaskDiamond"
])
const lastStoryItemIndex = -1
const authoredCassetteExecutionTimeout = 600_000

export const registerMaintainedCatalogExecutionShard = (shard: number, shardCount: number): void => {
  for (const [index, [key, cassette]] of catalogEntries.entries()) {
    if (dedicatedCapstoneKeys.has(key) || index % shardCount !== shard) continue
    it.effect(
      `runs maintained authored cassette ${key} through the composed production coordinator`,
      () =>
        runAuthoredScenarioCassette(cassette).pipe(
          Effect.provide(NodeCrypto.layer),
          Effect.tap((run) =>
            Effect.sync(() => expect(run.cassette.story.at(lastStoryItemIndex)?._tag).toBe("ExpectedBehavior"))
          ),
          Effect.catchCause((cause) =>
            Effect.fail({ _tag: "MaintainedAuthoredCassetteExecutionFailed" as const, cause, key })
          )
        ),
      authoredCassetteExecutionTimeout
    )
  }
}
