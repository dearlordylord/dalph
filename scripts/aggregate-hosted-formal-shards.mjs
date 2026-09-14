import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

import { createQuintEffectiveProfile, assertQuintEffectiveProfile } from "./quint-effective-profile.mjs"
import { assertQuintGateCommandContract } from "./quint-gate-command-contract.mjs"
import { assertCleanTemporalVerdict, assertViolatedTemporalVerdict } from "./quint-temporal-gate.mjs"
import {
  assertCompleteQuintHostedPartition,
  assertQuintHostedCommandCustody,
  quintHostedProfileDigest,
  quintHostedShardCount,
  readQuintHostedShardBinding
} from "./quint-hosted-shards.mjs"
import { validateQuintCommandOutput } from "./quint-witness-coverage.mjs"

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const commandKinds = ["typecheck", "test", "sampled-run", "verify"]

const publicCommandEvidence = (command, timing) =>
  Object.freeze({
    position: command.position,
    name: command.name,
    kind: command.kind,
    args: Object.freeze([...command.args]),
    verdict: Object.freeze(structuredClone(command.verdict)),
    result: `exit:${command.exitCode}`,
    obligationId: command.obligationId,
    durationMilliseconds: timing.durationMilliseconds
  })

const shardForCommandPosition = (shards, position) => {
  const shard = shards.find(({ positions }) => positions.includes(position))?.shard
  if (shard === undefined) throw new Error(`Hosted Quint aggregate has no shard for command ${position}`)
  return shard
}

const provenanceIdentity = (provenance) => {
  const identity = {
    architecture: provenance?.architecture,
    bytes: provenance?.bytes,
    evaluatorVersion: provenance?.evaluatorVersion,
    platform: provenance?.platform,
    quintPackageVersion: provenance?.quintPackageVersion,
    sha256: provenance?.sha256
  }
  if (
    typeof identity.architecture !== "string" ||
    !Number.isSafeInteger(identity.bytes) ||
    identity.bytes <= 0 ||
    typeof identity.evaluatorVersion !== "string" ||
    typeof identity.platform !== "string" ||
    typeof identity.quintPackageVersion !== "string" ||
    !/^[0-9a-f]{64}$/u.test(identity.sha256 ?? "") ||
    typeof provenance?.evaluatorPath !== "string" ||
    !provenance.evaluatorPath.startsWith("/")
  ) {
    throw new Error("Hosted Quint aggregate rejected evaluator provenance")
  }
  return identity
}

const validateCommand = (actual, expected) => {
  if (
    actual.position !== expected.position ||
    actual.name !== expected.name ||
    actual.kind !== expected.kind ||
    !same(actual.args, expected.args) ||
    !same(actual.verdict, expected.verdict) ||
    !expected.verdict.acceptedExitCodes.includes(actual.exitCode) ||
    typeof actual.output !== "string"
  ) {
    throw new Error(`Hosted Quint aggregate command ${expected.position} differs from its canonical evidence`)
  }
  validateQuintCommandOutput({ args: expected.args, name: expected.name, output: actual.output })
  const property = expected.args[expected.args.indexOf("--temporal") + 1]
  if (expected.verdict.temporal === "clean") assertCleanTemporalVerdict(actual, property)
  if (expected.verdict.temporal === "violation") assertViolatedTemporalVerdict(actual, property)
}

/** Validate complete successful evidence from one exact GitHub matrix cell. */
export const aggregateHostedFormalShards = ({ binding, envelopes }) => {
  const profile = createQuintEffectiveProfile()
  assertQuintEffectiveProfile(profile)
  const shards = assertCompleteQuintHostedPartition(profile)
  if (!Array.isArray(envelopes) || envelopes.length !== quintHostedShardCount) {
    throw new Error(`Hosted Quint aggregate requires exactly ${quintHostedShardCount} shard reports`)
  }
  const byShard = new Map()
  let commonProvenance
  for (const envelope of envelopes) {
    if (
      envelope?.version !== 1 ||
      envelope.shardCount !== quintHostedShardCount ||
      !same(envelope.binding, binding) ||
      envelope.profileDigest !== quintHostedProfileDigest(profile) ||
      !Number.isInteger(envelope.shard) ||
      byShard.has(envelope.shard)
    ) {
      throw new Error("Hosted Quint aggregate received missing, duplicate, mixed, or malformed shard evidence")
    }
    const expectedShard = shards[envelope.shard]
    const report = envelope.report
    if (
      report?.version !== 1 ||
      !same(report.profile, profile) ||
      !same(report.shard, expectedShard) ||
      report.serverEndpoint !== null ||
      typeof report.entryPoint !== "string" ||
      !report.entryPoint.endsWith("/node_modules/@informalsystems/quint/dist/src/cli.js") ||
      !Array.isArray(report.commands) ||
      !Array.isArray(report.timing?.records) ||
      report.commands.length !== expectedShard.positions.length ||
      report.timing.records.length !== expectedShard.positions.length ||
      !Number.isFinite(report.elapsedMilliseconds) ||
      report.elapsedMilliseconds < 0 ||
      report.elapsedMilliseconds > profile.policy.regressionBudgetMilliseconds
    ) {
      throw new Error(`Hosted Quint aggregate rejected shard ${String(envelope.shard)} report structure`)
    }
    const evaluator = provenanceIdentity(report.provenance)
    assertQuintHostedCommandCustody(report)
    if (commonProvenance !== undefined && !same(commonProvenance, evaluator)) {
      throw new Error("Hosted Quint aggregate received mixed evaluator provenance")
    }
    commonProvenance = evaluator
    for (const [index, position] of expectedShard.positions.entries()) {
      const expected = profile.commands[position]
      validateCommand(report.commands[index], expected)
      if (
        typeof report.commands[index].executable !== "string" ||
        !report.commands[index].executable.endsWith("/bin/node")
      ) {
        throw new Error(`Hosted Quint aggregate rejected runtime for command ${position}`)
      }
      const timing = report.timing.records[index]
      if (
        timing.name !== expected.name ||
        timing.kind !== expected.kind ||
        timing.result !== `exit:${report.commands[index].exitCode}` ||
        !Number.isFinite(timing.durationMilliseconds) ||
        timing.durationMilliseconds < 0
      ) {
        throw new Error(`Hosted Quint aggregate rejected shard timing for command ${position}`)
      }
    }
    const recomputedAggregates = Object.fromEntries(
      commandKinds.map((kind) => {
        const records = report.timing.records.filter((record) => record.kind === kind)
        return [
          kind,
          {
            count: records.length,
            durationMilliseconds: records.reduce((total, record) => total + record.durationMilliseconds, 0)
          }
        ]
      })
    )
    if (!same(report.timing.aggregates, recomputedAggregates)) {
      throw new Error(`Hosted Quint aggregate rejected shard ${envelope.shard} timing aggregates`)
    }
    byShard.set(envelope.shard, envelope)
  }
  for (let shard = 0; shard < quintHostedShardCount; shard += 1) {
    if (!byShard.has(shard)) throw new Error(`Hosted Quint aggregate is missing shard ${shard}`)
  }
  const commands = [...byShard.values()]
    .flatMap(({ report }) => report.commands)
    .sort((left, right) => left.position - right.position)
  if (new Set(commands.map(({ obligationId }) => obligationId)).size !== commands.length) {
    throw new Error("Hosted Quint aggregate rejected duplicate command custody")
  }
  for (const [position, command] of commands.entries()) validateCommand(command, profile.commands[position])
  assertQuintGateCommandContract({
    manifest: profile.commands,
    executed: {
      total: commands.length,
      typecheck: commands.filter(({ kind }) => kind === "typecheck").length,
      test: commands.filter(({ kind }) => kind === "test").length,
      "sampled-run": commands.filter(({ kind }) => kind === "sampled-run").length,
      verify: commands.filter(({ kind }) => kind === "verify").length
    }
  })
  const commandEvidence = commands.map((command) => {
    const envelope = byShard.get(shardForCommandPosition(shards, command.position))
    const index = envelope.report.commands.findIndex(({ position }) => position === command.position)
    return publicCommandEvidence(command, envelope.report.timing.records[index])
  })
  return Object.freeze({
    version: 1,
    binding,
    profileDigest: quintHostedProfileDigest(profile),
    commands: commands.length,
    commandEvidence: Object.freeze(commandEvidence),
    negativeControls: Object.freeze(
      commandEvidence
        .filter(({ name }) => name.includes("negative mutation profile") || name.includes("temporal mutant"))
        .map(({ name }) => name)
    )
  })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error("Hosted Quint aggregate requires two shard report paths")
  const envelopes = await Promise.all(
    process.argv.slice(2).map(async (path) => JSON.parse(await readFile(path, "utf8")))
  )
  const result = aggregateHostedFormalShards({ binding: readQuintHostedShardBinding(), envelopes })
  process.stdout.write(
    `Complete hosted Quint evidence: ${result.commands} commands across ${quintHostedShardCount} shards\n`
  )
}
