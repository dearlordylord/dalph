import assert from "node:assert/strict"
import { test } from "node:test"

import { createQuintEffectiveProfile } from "./quint-effective-profile.mjs"
import {
  assertCompleteQuintHostedPartition,
  createQuintHostedShard,
  quintHostedProfileDigest,
  quintHostedModelFamilies,
  readQuintHostedShardBinding
} from "./quint-hosted-shards.mjs"

void test("partitions every canonical command exactly once without splitting a family", () => {
  const profile = createQuintEffectiveProfile()
  const shards = assertCompleteQuintHostedPartition(profile)
  assert.deepEqual(
    shards.flatMap(({ positions }) => positions).sort((left, right) => left - right),
    profile.commands.map(({ position }) => position)
  )
  for (const shard of shards) {
    assert.equal(shard.profileDigest, quintHostedProfileDigest(profile))
    assert.ok(Object.isFrozen(shard.positions))
    assert.ok(
      shard.steps.every(
        (step) => Object.isFrozen(step) && (step.kind !== "commands" || Object.isFrozen(step.positions))
      )
    )
    assert.equal(shard.steps.filter(({ kind }) => kind === "evaluator-provenance").length, 1)
    const firstFamily = shard.steps.find(
      (step) => step.kind === "commands" && positionsUseEvaluator(profile, kindPositions(step))
    )
    assert.ok(firstFamily)
    assert.ok(firstFamily.serializedPrefix >= 1)
  }
})

void test("retains the independently reviewed model-family range oracle", () => {
  assert.deepEqual(quintHostedModelFamilies, [
    { name: "planned-attempt executor", first: 0, last: 15, shard: 0 },
    { name: "application Exit", first: 16, last: 36, shard: 0 },
    { name: "control-direction application", first: 37, last: 41, shard: 1 },
    { name: "Run activation", first: 42, last: 46, shard: 0 },
    { name: "fresh-task admission", first: 47, last: 59, shard: 1 },
    { name: "Run cancellation", first: 60, last: 64, shard: 0 },
    { name: "task-fact reconciliation", first: 65, last: 85, shard: 1 },
    { name: "Git reconciliation", first: 86, last: 90, shard: 0 },
    { name: "accepted-result integration", first: 91, last: 99, shard: 1 },
    { name: "integration finality", first: 100, last: 104, shard: 0 }
  ])
})

const kindPositions = (step) => step.positions
const positionsUseEvaluator = (profile, positions) =>
  positions.some((position) => ["test", "sampled-run"].includes(profile.commands[position].kind))

void test("rejects unsupported shards and incomplete canonical profiles", () => {
  const profile = createQuintEffectiveProfile()
  assert.throws(() => createQuintHostedShard(profile, -1), /integer/)
  assert.throws(() => createQuintHostedShard(profile, 2), /integer/)
  const incomplete = structuredClone(profile)
  incomplete.commands.pop()
  assert.throws(() => assertCompleteQuintHostedPartition(incomplete), /partition/)
})

void test("requires the exact GitHub workflow binding fields", () => {
  const environment = {
    GITHUB_RUN_ID: "1",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
    DALPH_FORMAL_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
    DALPH_FORMAL_NODE_VERSION: "24.20.0"
  }
  assert.deepEqual(readQuintHostedShardBinding(environment, "24.20.0"), {
    runId: "1",
    runAttempt: "2",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    nodeVersion: "24.20.0"
  })
  for (const name of Object.keys(environment)) {
    assert.throws(() => readQuintHostedShardBinding({ ...environment, [name]: "" }, "24.20.0"), /requires/)
  }
  assert.throws(() => readQuintHostedShardBinding(environment, "24.21.0"), /runtime/)
})
