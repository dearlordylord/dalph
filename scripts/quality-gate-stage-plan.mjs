import { createHash } from "node:crypto"
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  fullQualityGateManifest,
  qualityGateCleanRunnerPreparation,
  qualityGatePolicyIdentity,
  qualityGateQualificationStageIds
} from "./quality-gate-stage-policy.mjs"

const canonicalShaPattern = /^[0-9a-f]{40}$/u
const nodeVersionPattern = /^\d+\.\d+\.\d+$/u
const defaultTerminationGraceMilliseconds = 5_000
const defaultProcessGroupAbsenceTimeoutMilliseconds = 2_000

const freeze = (value) => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex")

const requireCanonicalSha = (name, value) => {
  if (typeof value !== "string" || !canonicalShaPattern.test(value)) {
    throw new Error(`${name} must be a canonical lowercase 40-character Git SHA`)
  }
  return value
}

const requireNodeVersions = (value) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Quality stage plan requires at least one Node version")
  }
  if (
    value.some((version) => typeof version !== "string" || !nodeVersionPattern.test(version)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("Quality stage plan requires distinct supported Node semver versions")
  }
  return [...value]
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

const requirePolicyIdentity = (value) => {
  if (!same(value, qualityGatePolicyIdentity)) throw new Error("Unsupported quality stage policy identity")
  return qualityGatePolicyIdentity
}

const requireStageIds = (value) => {
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length) {
    throw new Error("Quality stage plan requires one or more distinct qualification stage IDs")
  }
  for (const id of value) {
    if (!qualityGateQualificationStageIds.includes(id))
      throw new Error(`Unsupported qualification stage ID: ${String(id)}`)
  }
  return qualityGateQualificationStageIds.filter((id) => value.includes(id))
}

const stableStageContract = (stage) => ({
  artifactObligations: stage.artifactObligations ?? [],
  artifactRoots: stage.artifactRoots ?? [],
  args: stage.args,
  boundary: stage.boundary,
  cleanRunnerPreparation: stage.cleanRunnerPreparation ?? qualityGateCleanRunnerPreparation,
  environmentPolicy: stage.environmentPolicy ?? null,
  id: stage.id,
  name: stage.name,
  terminationGraceMilliseconds: stage.terminationGrace ?? defaultTerminationGraceMilliseconds,
  timeoutMilliseconds: stage.timeout,
  processGroupAbsenceTimeoutMilliseconds:
    stage.processGroupAbsenceTimeout ?? defaultProcessGroupAbsenceTimeoutMilliseconds
})

const policyDigestFor = (stages) =>
  digest({
    policy: qualityGatePolicyIdentity,
    preparation: qualityGateCleanRunnerPreparation,
    stages: stages.map(stableStageContract)
  })

/**
 * Generate the expected hosted Node×stage matrix from the checked-in local
 * manifest.  Every entry carries the candidate/Base and policy identity that
 * an aggregate must match before it can credit a result.
 */
export const createQualityGateStagePlan = ({
  baseSha,
  candidateSha,
  nodeExecutable = process.execPath,
  nodeVersions,
  pnpmEntryPoint = "pnpm",
  policyIdentity = qualityGatePolicyIdentity,
  stageIds = qualityGateQualificationStageIds,
  worktree
} = {}) => {
  requireCanonicalSha("Quality stage plan Base SHA", baseSha)
  requireCanonicalSha("Quality stage plan candidate SHA", candidateSha)
  const versions = requireNodeVersions(nodeVersions)
  const policy = requirePolicyIdentity(policyIdentity)
  const selectedStageIds = requireStageIds(stageIds)
  if (typeof nodeExecutable !== "string" || nodeExecutable.trim() === "") {
    throw new Error("Quality stage plan requires a Node executable")
  }
  if (typeof pnpmEntryPoint !== "string" || pnpmEntryPoint.trim() === "") {
    throw new Error("Quality stage plan requires a pnpm entry point")
  }
  if (worktree !== undefined && (typeof worktree !== "string" || worktree.trim() === "")) {
    throw new Error("Quality stage plan worktree must be a nonempty path when supplied")
  }

  const manifest = fullQualityGateManifest(baseSha, {
    candidateHeadSha: candidateSha,
    nodeExecutable,
    pnpmEntryPoint,
    ...(worktree === undefined ? {} : { worktree })
  })
  const qualificationStages = manifest.filter(({ boundary }) => boundary === "qualification")
  const byId = new Map(qualificationStages.map((stage) => [stage.id, stage]))
  const selectedStages = selectedStageIds.map((id) => {
    const stage = byId.get(id)
    if (stage === undefined) throw new Error(`Manifest has no qualification stage ID: ${id}`)
    return stage
  })
  const policyDigest = policyDigestFor(qualificationStages)
  const stageCells = versions.flatMap((nodeVersion) =>
    selectedStages.map((stage) => {
      const contract = stableStageContract(stage)
      const identity = { baseSha, candidateSha, nodeVersion, policy, policyDigest, stageId: stage.id, version: 1 }
      return freeze({
        ...identity,
        artifactObligations: contract.artifactObligations,
        artifactRoots: contract.artifactRoots,
        bounds: {
          processGroupAbsenceTimeoutMilliseconds: contract.processGroupAbsenceTimeoutMilliseconds,
          terminationGraceMilliseconds: contract.terminationGraceMilliseconds,
          timeoutMilliseconds: contract.timeoutMilliseconds
        },
        cleanRunnerPreparation: contract.cleanRunnerPreparation,
        command: {
          args: [pnpmEntryPoint, "--silent", ...contract.args],
          executable: nodeExecutable,
          name: `Quality gate '${contract.name}'`
        },
        identity,
        name: contract.name
      })
    })
  )
  const configurationDigest = digest({
    baseSha,
    candidateSha,
    nodeVersions: versions,
    policyDigest,
    stageIds: selectedStageIds
  })
  const stages = stageCells.map((stage) =>
    freeze({ ...stage, configurationDigest, identity: freeze({ ...stage.identity, configurationDigest }) })
  )
  return freeze({
    baseSha,
    candidateSha,
    cleanRunnerPreparation: qualityGateCleanRunnerPreparation,
    configurationDigest,
    configDigest: configurationDigest,
    expectedCells: stages.map(({ nodeVersion, stageId }) => ({ nodeVersion, stageId })),
    expectedStageIds: selectedStageIds,
    nodeVersions: versions,
    policyIdentity: policy,
    policyDigest,
    stages,
    version: 1,
    ...(worktree === undefined ? {} : { worktree })
  })
}

export const qualityGateStagePlanPolicyDigest = policyDigestFor(
  fullQualityGateManifest("0".repeat(40)).filter(({ boundary }) => boundary === "qualification")
)

/** Resolve the exact Node matrix from the repository's declared engine ranges. */
export const supportedNodeVersionsFromPackage = (packagePath = new URL("../package.json", import.meta.url)) => {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"))
  const ranges = packageJson?.engines?.node?.split(" || ")
  if (
    !Array.isArray(ranges) ||
    ranges.length === 0 ||
    ranges.some((range) => typeof range !== "string" || !/^\^\d+\.\d+\.\d+$/u.test(range))
  ) {
    throw new Error("package engines.node must contain caret Node versions separated by ` || `")
  }
  return requireNodeVersions(ranges.map((range) => range.slice(1)))
}

/** Write the matrix values needed by a hosted workflow without another inventory in YAML. */
export const writeQualityGateStagePlanOutputs = (plan, outputPath) => {
  if (typeof outputPath !== "string" || outputPath.trim() === "") throw new Error("GitHub output path is required")
  const outputs = {
    "configuration-digest": plan.configurationDigest,
    "expected-cells": JSON.stringify(plan.expectedCells),
    "node-versions": JSON.stringify(plan.nodeVersions),
    "policy-digest": plan.policyDigest,
    "stage-ids": JSON.stringify(plan.expectedStageIds)
  }
  appendFileSync(
    outputPath,
    Object.entries(outputs)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n") + "\n"
  )
  return outputs
}

const parseCommandLine = (args) => {
  const values = new Map()
  const allowed = new Set(["--base", "--candidate", "--github-output", "--output", "--package"])
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (!name?.startsWith("--") || value === undefined || values.has(name)) {
      throw new Error("Quality stage plan arguments must be unique --name value pairs")
    }
    if (!allowed.has(name)) throw new Error(`Unsupported quality stage plan argument: ${name}`)
    values.set(name, value)
  }
  const required = ["--base", "--candidate"]
  if (required.some((name) => !values.has(name))) throw new Error(`Quality stage plan requires ${required.join(", ")}`)
  return values
}

const runCommandLine = () => {
  const values = parseCommandLine(process.argv.slice(2))
  const plan = createQualityGateStagePlan({
    baseSha: values.get("--base"),
    candidateSha: values.get("--candidate"),
    nodeVersions: supportedNodeVersionsFromPackage(
      values.has("--package") ? resolve(values.get("--package")) : new URL("../package.json", import.meta.url)
    )
  })
  const outputPath = values.get("--output")
  if (outputPath !== undefined)
    writeFileSync(resolve(outputPath), `${JSON.stringify(plan, undefined, 2)}\n`, { flag: "wx" })
  else process.stdout.write(`${JSON.stringify(plan)}\n`)
  const githubOutput = values.get("--github-output")
  if (githubOutput !== undefined) writeQualityGateStagePlanOutputs(plan, resolve(githubOutput))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) runCommandLine()
