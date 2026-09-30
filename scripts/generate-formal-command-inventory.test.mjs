import assert from "node:assert/strict"
import { test } from "node:test"
import { checkFormalCommandInventory, renderFormalCommandInventory } from "./generate-formal-command-inventory.mjs"
import { quintGateCommandManifest } from "./quint-gate-command-manifest.mjs"
import { quintHostedModelFamilies, quintHostedShardCount } from "./quint-hosted-shards.mjs"

void test("checked-in formal inventory matches the executable commands and hosted partition", async () => {
  await checkFormalCommandInventory()
})

void test("formal inventory generation rejects an uncovered appended command", () => {
  assert.throws(
    () =>
      renderFormalCommandInventory(
        [...quintGateCommandManifest, { kind: "test", name: "new unassigned command" }],
        quintHostedModelFamilies,
        quintHostedShardCount
      ),
    /do not cover every command/u
  )
})

void test("formal inventory generation rejects overlapping shard ranges", () => {
  assert.throws(
    () =>
      renderFormalCommandInventory(
        quintGateCommandManifest,
        [...quintHostedModelFamilies, quintHostedModelFamilies[0]],
        quintHostedShardCount
      ),
    /duplicated or outside/u
  )
})
