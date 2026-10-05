import { quintGateCommandManifest } from "./quint-gate-command-manifest.mjs"
import assert from "node:assert/strict"
import { test } from "node:test"

import { aggregateHostedFormalShards } from "./aggregate-hosted-formal-shards.mjs"
import { createQuintEffectiveProfile } from "./quint-effective-profile.mjs"
import {
  assertCompleteQuintHostedPartition,
  createQuintHostedShard,
  quintHostedProfileDigest
} from "./quint-hosted-shards.mjs"

// Custody fixtures follow the executable inventory. Independent command/range
// oracles qualify that inventory in their own contract tests.
const formalCommandCount = quintGateCommandManifest.length

const binding = Object.freeze({ runId: "run-1", runAttempt: "2", commitSha: "candidate", nodeVersion: "24.20.0" })

const capturedOutput = (command) => {
  const lines = command.verdict.witnesses.map(
    (witness) => `${witness} was witnessed in 1 trace(s) out of 1 explored (100.00%)`
  )
  if (command.verdict.collectedReplacementTest) {
    lines.push("ok safeSuspensionAndExactFreshFactsAtomicallyRecordCleanP2Test passed 1 test(s)")
  }
  if (command.verdict.temporal === "clean") lines.push("[ok] No violation found")
  if (command.verdict.temporal === "violation") lines.push("[violation] Found an issue")
  return `${lines.join("\n")}\n`
}

const fixture = (affectedFamilies) => {
  const profile = createQuintEffectiveProfile()
  return assertCompleteQuintHostedPartition(profile)
    .map(({ shard }) => createQuintHostedShard(profile, shard, affectedFamilies))
    .map((shard) => {
      const commands = shard.positions.map((position) => {
        const command = profile.commands[position]
        return {
          position,
          name: command.name,
          kind: command.kind,
          executable: "/opt/bin/node",
          obligationId: `00000000-0000-4000-8000-${String(position + 1).padStart(12, "0")}`,
          args: command.args,
          exitCode: command.verdict.acceptedExitCodes[0],
          output: capturedOutput(command),
          verdict: command.verdict
        }
      })
      return {
        version: 1,
        binding,
        profileDigest: quintHostedProfileDigest(profile),
        shard: shard.shard,
        shardCount: shard.shardCount,
        report: {
          version: 1,
          entryPoint: "/workspace/node_modules/@informalsystems/quint/dist/src/cli.js",
          profile,
          shard,
          serverEndpoint: null,
          commands,
          timing: {
            records: commands.map(({ exitCode, kind, name }) => ({
              kind,
              name,
              durationMilliseconds: 1,
              result: `exit:${exitCode}`
            })),
            aggregates: Object.fromEntries(
              ["typecheck", "test", "sampled-run", "verify"].map((kind) => [
                kind,
                {
                  count: commands.filter((command) => command.kind === kind).length,
                  durationMilliseconds: commands.filter((command) => command.kind === kind).length
                }
              ])
            )
          },
          provenance: {
            architecture: "arm64",
            bytes: 1,
            evaluatorPath: "/home/runner/.quint/evaluator",
            evaluatorVersion: "v0.6.0",
            platform: "linux",
            quintPackageVersion: "0.32.0",
            sha256: "a".repeat(64)
          },
          elapsedMilliseconds: 100
        }
      }
    })
}

void test("accepts two out-of-order reports only as one exact canonical command profile", () => {
  const envelopes = fixture().reverse()
  const aggregate = aggregateHostedFormalShards({ binding, envelopes })
  assert.equal(aggregate.version, 1)
  assert.deepEqual(aggregate.binding, binding)
  assert.equal(aggregate.profileDigest, envelopes[0].profileDigest)
  assert.equal(aggregate.commands, formalCommandCount)
  assert.deepEqual(
    aggregate.commandEvidence.map(({ position }) => position),
    Array.from({ length: formalCommandCount }, (_value, position) => position)
  )
  const first = aggregate.commandEvidence[0]
  assert.deepEqual(first.args, envelopes[1].report.commands[0].args)
  assert.deepEqual(first.verdict, envelopes[1].report.commands[0].verdict)
  assert.equal(first.result, "exit:0")
  assert.equal(first.obligationId, envelopes[1].report.commands[0].obligationId)
  assert.equal(first.durationMilliseconds, 1)
  assert.ok(aggregate.negativeControls.some((name) => name.includes("temporal mutant")))
  assert.equal(JSON.stringify(aggregate).includes("/opt/bin/node"), false)
  assert.equal(JSON.stringify(aggregate).includes("witnessed in"), false)
})

void test("fails closed on missing duplicate mixed and altered shard evidence", () => {
  const mutations = [
    (reports) => reports.pop(),
    (reports) => {
      reports[1] = structuredClone(reports[0])
    },
    (reports) => {
      reports[1].binding.runAttempt = "3"
    },
    (reports) => {
      reports[1].binding.runId = "run-2"
    },
    (reports) => {
      reports[1].binding.commitSha = "other-candidate"
    },
    (reports) => {
      reports[1].binding.nodeVersion = "24.21.0"
    },
    (reports) => {
      reports[1].profileDigest = "other-profile"
    },
    (reports) => {
      reports[1].shardCount = 3
    },
    (reports) => {
      reports[1].report.shard.shardCount = 3
    },
    (reports) => {
      reports[1].report.profile.commands[0].args = ["typecheck", "specs/substituted.qnt"]
    },
    (reports) => {
      reports[1].report.commands.pop()
    },
    (reports) => {
      reports[1].report.commands[1].position = reports[1].report.commands[0].position
    },
    (reports) => {
      reports[1].report.commands[0].args = ["typecheck", "specs/substituted.qnt"]
    },
    (reports) => {
      reports[1].report.commands[0].exitCode = 99
    },
    (reports) => {
      delete reports[1].report.commands[0].obligationId
    },
    (reports) => {
      reports[1].report.commands[0].obligationId = "fabricated-obligation"
    },
    (reports) => {
      reports[1].report.commands[1].obligationId = reports[1].report.commands[0].obligationId
    },
    (reports) => {
      const sampled = reports[1].report.commands.find(({ kind }) => kind === "sampled-run")
      sampled.output = ""
    },
    (reports) => {
      reports[1].report.timing.records[0].result = "exit:99"
    },
    (reports) => {
      reports[1].report.provenance.sha256 = "b".repeat(64)
    }
  ]
  for (const mutate of mutations) {
    const reports = structuredClone(fixture())
    mutate(reports)
    assert.throws(() => aggregateHostedFormalShards({ binding, envelopes: reports }), /Hosted Quint|witness/)
  }
})

void test("affected aggregate requires the exact family selection including an empty shard", () => {
  const affectedFamilies = ["Run activation"]
  const envelopes = fixture(affectedFamilies)
  const result = aggregateHostedFormalShards({ affectedFamilies, binding, envelopes })
  assert.equal(result.commands, 5)
  assert.throws(() => aggregateHostedFormalShards({ binding, envelopes }), /structure/)
  assert.throws(
    () => aggregateHostedFormalShards({ affectedFamilies: ["Git reconciliation"], binding, envelopes }),
    /structure/
  )
  assert.throws(
    () => aggregateHostedFormalShards({ affectedFamilies, binding, envelopes: envelopes.slice(0, 1) }),
    /exactly/
  )
  const missing = structuredClone(envelopes)
  missing[0].report.commands.pop()
  assert.throws(() => aggregateHostedFormalShards({ affectedFamilies, binding, envelopes: missing }), /structure/)
  const missingOutput = structuredClone(envelopes)
  const witness = missingOutput[0].report.commands.find((command) => command.verdict.witnesses.length > 0)
  witness.output = ""
  assert.throws(() => aggregateHostedFormalShards({ affectedFamilies, binding, envelopes: missingOutput }), /witness/)
})
