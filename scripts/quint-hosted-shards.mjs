import { createHash } from "node:crypto"

export const quintHostedShardCount = 2

const obligationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export const quintHostedModelFamilies = Object.freeze([
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

const shardForPosition = (position) =>
  quintHostedModelFamilies.find(({ first, last }) => position >= first && position <= last)?.shard

export const quintHostedProfileDigest = (profile) => createHash("sha256").update(JSON.stringify(profile)).digest("hex")

/** Keep every scheduling step inside the model family assigned to one shard. */
export const createQuintHostedShard = (profile, shard) => {
  if (!Number.isInteger(shard) || shard < 0 || shard >= quintHostedShardCount) {
    throw new Error(`Hosted Quint shard must be an integer from 0 to ${quintHostedShardCount - 1}`)
  }
  const positions = profile.commands
    .filter(({ position }) => shardForPosition(position) === shard)
    .map(({ position }) => position)
  if (positions.length === 0) throw new Error(`Hosted Quint shard ${shard} has no commands`)
  const selected = new Set(positions)
  const steps = []
  let provenancePlaced = false
  for (const step of profile.steps) {
    if (step.kind !== "commands") continue
    const retained = step.positions.filter((position) => selected.has(position))
    if (retained.length === 0) continue
    if (retained.length !== step.positions.length) {
      throw new Error(`Hosted Quint shard ${shard} splits command family ${step.positions.join(",")}`)
    }
    const usesEvaluator = retained.some((position) => ["test", "sampled-run"].includes(profile.commands[position].kind))
    const serializedPrefix =
      !provenancePlaced && usesEvaluator ? Math.max(1, step.serializedPrefix) : step.serializedPrefix
    steps.push({ ...step, positions: Object.freeze(retained), serializedPrefix })
    if (!provenancePlaced && usesEvaluator) {
      steps.push({ kind: "evaluator-provenance" })
      provenancePlaced = true
    }
  }
  if (!provenancePlaced) throw new Error(`Hosted Quint shard ${shard} has no evaluator preparation family`)
  return Object.freeze({
    version: 1,
    shard,
    shardCount: quintHostedShardCount,
    profileDigest: quintHostedProfileDigest(profile),
    positions: Object.freeze(positions),
    steps: Object.freeze(steps.map((step) => Object.freeze(step)))
  })
}

/** Prove the checked-in partition covers the canonical profile exactly once. */
export const assertCompleteQuintHostedPartition = (profile) => {
  const canonicalPositions = quintHostedModelFamilies.flatMap(({ first, last }) =>
    Array.from({ length: last - first + 1 }, (_value, offset) => first + offset)
  )
  if (JSON.stringify(profile.commands.map(({ position }) => position)) !== JSON.stringify(canonicalPositions)) {
    throw new Error("Hosted Quint shards do not partition every canonical command exactly once")
  }
  const shards = Array.from({ length: quintHostedShardCount }, (_value, shard) =>
    createQuintHostedShard(profile, shard)
  )
  const positions = shards.flatMap(({ positions }) => positions).sort((left, right) => left - right)
  if (JSON.stringify(positions) !== JSON.stringify(canonicalPositions)) {
    throw new Error("Hosted Quint shards do not partition every canonical command exactly once")
  }
  return shards
}

export const readQuintHostedShardBinding = (environment = process.env, runtimeNodeVersion = process.versions.node) => {
  const binding = {
    runId: environment.GITHUB_RUN_ID,
    runAttempt: environment.GITHUB_RUN_ATTEMPT,
    commitSha: environment.DALPH_FORMAL_COMMIT_SHA,
    nodeVersion: runtimeNodeVersion
  }
  if (!/^[1-9]\d*$/u.test(binding.runId ?? "") || !/^[1-9]\d*$/u.test(binding.runAttempt ?? "")) {
    throw new Error("Hosted Quint shard requires positive decimal runId and runAttempt")
  }
  if (!/^[0-9a-f]{40}$/u.test(binding.commitSha ?? "") || binding.commitSha !== environment.GITHUB_SHA) {
    throw new Error("Hosted Quint shard requires the exact checked-out GitHub commit SHA")
  }
  if (environment.DALPH_FORMAL_NODE_VERSION !== runtimeNodeVersion) {
    throw new Error("Hosted Quint shard requires the exact selected Node runtime")
  }
  return Object.freeze(binding)
}

/** Require each hosted checker result to retain its admitted gate custody. */
export const assertQuintHostedCommandCustody = (report) => {
  if (!Array.isArray(report?.commands) || report.commands.length === 0) {
    throw new Error("Hosted Quint shard requires command custody evidence")
  }
  const obligationIds = report.commands.map(({ obligationId }) => obligationId)
  if (
    obligationIds.some((obligationId) => !obligationIdPattern.test(obligationId ?? "")) ||
    new Set(obligationIds).size !== obligationIds.length
  ) {
    throw new Error("Hosted Quint shard requires distinct admitted command custody IDs")
  }
  return obligationIds
}
