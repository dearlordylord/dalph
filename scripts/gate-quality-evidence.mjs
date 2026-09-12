import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { digest, readRecord } from "./gate-custody-records.mjs"
import { inputGuardProven } from "./gate-resume-policy.mjs"
import { captureResumeArtifacts } from "./gate-resume-artifacts.mjs"
import { addSuccessfulOutputLines } from "./quality-output-budget.mjs"

export const qualitySubtreeProven = (stages, obligationId) => {
  const descendants = new Set([obligationId])
  for (let size = -1; size !== descendants.size;) {
    size = descendants.size
    for (const stage of stages) if (descendants.has(stage.parentId)) descendants.add(stage.obligationId)
  }
  return (
    stages.some((stage) => stage.obligationId === obligationId) &&
    stages
      .filter((stage) => descendants.has(stage.obligationId))
      .every((stage) => stage.outcome !== "UNPROVEN" && (stage.stopped === true || stage.groupAbsent === true))
  )
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
/** A composite proves skipped stage references without inventing new child executions. */
export const readQualityEvidence = ({ baseSha, readPrior, run, runDirectory, runId, stages }) => {
  const contractPath = join(runDirectory, "resume-contract.json")
  if (!existsSync(contractPath)) {
    if (
      run.requiresQualityComposite === true ||
      run.commandArguments.some((argument) => argument.startsWith("--resume="))
    )
      throw new Error("Missing required resumable gate contract and composite evidence")
    return undefined
  }
  const contract = readRecord(contractPath)
  if (
    contract.runId !== runId ||
    !Array.isArray(contract.manifest) ||
    contract.maximumSuccessfulOutputLines !== 550 ||
    contract.logicalInvocation?.mode !== "check:all" ||
    contract.logicalInvocation.baseSha !== baseSha ||
    !same(contract.logicalInvocation.stageManifest, contract.manifest) ||
    !same(
      contract.logicalInvocation.commandArguments,
      run.commandArguments
        .filter((argument) => !argument.startsWith("--resume="))
        .map((argument) => (argument.startsWith("--candidate=") ? `--candidate=${baseSha}` : argument))
    )
  )
    throw new Error("Invalid resumable gate contract")
  const identityPath = join(runDirectory, "resume-inputs.json")
  const identity = existsSync(identityPath) ? readRecord(identityPath).identity : undefined
  if (
    identity !== undefined &&
    (identity.version !== 2 ||
      identity.observerVersion !== 1 ||
      !same(identity.logicalInvocation, contract.logicalInvocation) ||
      digest(JSON.stringify(identity)) !== contract.identityReceiptDigest)
  )
    throw new Error("Invalid stronger input identity receipt")
  const guardPath = join(runDirectory, "input-guard.json")
  const guard = existsSync(guardPath) ? readRecord(guardPath) : undefined
  const stageDirectory = join(runDirectory, "quality-stages")
  const names = existsSync(stageDirectory) ? readdirSync(stageDirectory) : []
  if (names.some((name) => !/^\d+\.json$/u.test(name) || Number(name.slice(0, -5)) >= contract.manifest.length))
    throw new Error("Invalid designated stage inventory")
  const compositePath = join(runDirectory, "composite.json")
  const composite = existsSync(compositePath) ? readRecord(compositePath) : undefined
  if (
    composite !== undefined &&
    (composite.runId !== runId ||
      !same(composite.manifest, contract.manifest) ||
      !same(composite.logicalInvocation, contract.logicalInvocation) ||
      !Array.isArray(composite.entries) ||
      composite.entries.length !== contract.manifest.length)
  )
    throw new Error("Invalid composite inventory")
  let executedSuffix = false
  const effectiveStages = contract.manifest.map((stage, ordinal) => {
    const entry = composite?.entries[ordinal]
    if (entry?.kind === "reused") {
      if (executedSuffix || entry.ordinal !== ordinal || existsSync(join(stageDirectory, `${ordinal}.json`)))
        throw new Error("Invalid noncontiguous or fabricated reused stage")
      const prior = readPrior(entry.runId)
      const original = prior.resume?.stages?.[entry.ordinal]
      if (
        prior.custody !== "stopped" ||
        prior.registration !== "closed" ||
        !inputGuardProven(prior.resume?.identity, prior.resume?.guard) ||
        prior.resume.identity?.inputDigest !== identity?.inputDigest ||
        original?.outcome !== "passed" ||
        original.subtreeProven !== true ||
        original.stageId !== stage.id ||
        !same(original.contract, stage) ||
        original.obligationId !== entry.obligationId ||
        original.outputLineCount !== entry.outputLineCount ||
        !same(original.artifacts, entry.artifacts)
      )
        throw new Error("Invalid reused stage provenance")
      if (Object.hasOwn(original.artifacts, "@coverage")) {
        if (
          entry.copiedCoverage?.directory !== join(run.reportDirectory, "coverage") ||
          !same(entry.copiedCoverage.artifact, original.artifacts["@coverage"])
        )
          throw new Error("Invalid copied coverage provenance")
        const current = captureResumeArtifacts({
          worktree: run.worktree,
          roots: ["@coverage"],
          coverageDirectory: entry.copiedCoverage.directory
        })
        if (!same(current["@coverage"], original.artifacts["@coverage"]))
          throw new Error("Copied coverage bytes changed")
      }
      return { ...original, runId: entry.runId }
    }
    if (entry !== undefined) executedSuffix = true
    if (entry !== undefined && !["executed", "pending"].includes(entry.kind))
      throw new Error("Invalid composite stage kind")
    const path = join(stageDirectory, `${ordinal}.json`)
    if (!existsSync(path)) {
      if (entry?.kind === "executed") throw new Error("Missing designated suffix stage receipt")
      return { stageId: stage.id, ordinal, contract: stage, outcome: "UNPROVEN" }
    }
    const record = readRecord(path)
    if (
      entry?.kind === "pending" ||
      record.runId !== runId ||
      record.stageId !== stage.id ||
      record.ordinal !== ordinal ||
      !same(record.contract, stage) ||
      !["passed", "failed", "started"].includes(record.outcome)
    )
      throw new Error("Invalid designated stage receipt")
    const child = stages.find((result) => result.obligationId === record.obligationId)
    const subtreeProven = qualitySubtreeProven(stages, record.obligationId)
    if (
      record.outcome === "passed" &&
      (child?.outcome !== "passed" ||
        !subtreeProven ||
        !same(child.command, stage.execution) ||
        child.outputLineCount !== record.outputLineCount ||
        !Number.isSafeInteger(record.outputLineCount))
    )
      throw new Error("Invalid passing quality stage verdict")
    if (
      record.outcome !== "started" &&
      (!record.artifacts ||
        !same(
          Object.keys(record.artifacts).sort((left, right) => left.localeCompare(right)),
          [...stage.artifactRoots].sort((left, right) => left.localeCompare(right))
        ))
    )
      throw new Error("Incomplete designated artifact inventory")
    return { ...record, subtreeProven }
  })
  let outputLines = 0
  for (const stage of effectiveStages)
    if (stage.outcome === "passed")
      outputLines = addSuccessfulOutputLines({
        currentOutputLines: outputLines,
        maximumOutputLines: 550,
        stageName: stage.stageId,
        stageOutputLines: stage.outputLineCount
      })
  if (composite !== undefined && composite.successfulOutputLines !== outputLines)
    throw new Error("Composite output accounting does not match stage evidence")
  const complete =
    composite !== undefined &&
    inputGuardProven(identity, guard) &&
    effectiveStages.every((stage) => stage.outcome === "passed" && stage.subtreeProven === true)
  let coverageProvenance
  if (complete) {
    const ordinal = contract.manifest.findIndex((stage) => stage.artifactRoots.includes("@coverage"))
    const entry = composite.entries[ordinal]
    if (entry?.kind === "reused") {
      const prior = readPrior(entry.runId)
      const artifact = prior.resume.stages[entry.ordinal].artifacts["@coverage"]
      const snapshot = (directory) =>
        Object.fromEntries(
          ["final", "summary"].flatMap((kind) => {
            const file = artifact.entries.find(
              (value) => value.kind === "file" && value.path === `coverage-${kind}.json`
            )
            return file === undefined
              ? []
              : [[kind, { path: join(directory, file.path), sha256: file.sha256, bytes: file.bytes }]]
          })
        )
      coverageProvenance = {
        kind: "reused",
        compositeValidated: true,
        stageId: contract.manifest[ordinal].id,
        origin: {
          runId: entry.runId,
          obligationId: entry.obligationId,
          outcome: "passed",
          subtreeProven: true,
          coverage: snapshot(join(prior.reportDirectory, "coverage"))
        },
        copy: { directory: entry.copiedCoverage.directory, coverage: snapshot(entry.copiedCoverage.directory) }
      }
    }
  }
  return {
    version: 1,
    identity,
    guard,
    manifest: contract.manifest,
    logicalInvocation: contract.logicalInvocation,
    maximumSuccessfulOutputLines: 550,
    stages: effectiveStages,
    composite,
    complete,
    ...(coverageProvenance === undefined ? {} : { coverageProvenance })
  }
}
