import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { atomicRecord, inheritedCustody, wallClockTimestamp } from "./gate-custody-records.mjs"
import {
  assertHostedQualityEnvironmentBinding,
  exportHostedQualityStageEvidence,
  hostedQualityRunDirectory,
  readHostedQualityRunReference,
  selectedHostedQualityStage
} from "./hosted-quality-evidence.mjs"
import { qualityGateTestEnvironment } from "./quality-gate-stage-policy.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const parse = (args) => {
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    if (!name?.startsWith("--") || args[index + 1] === undefined || values.has(name))
      throw new Error("Hosted quality stage arguments must be unique --name value pairs")
    values.set(name, args[index + 1])
  }
  return values
}

const executeOwnedStage = async (values) => {
  const context = inheritedCustody()
  if (context === undefined) throw new Error("Hosted quality stage execution requires owner gate custody")
  const baseSha = values.get("--base")
  const candidateSha = values.get("--candidate")
  const pnpmEntryPoint = process.env.npm_execpath
  if (pnpmEntryPoint === undefined) throw new Error("Hosted quality stage must run through pnpm")
  const selected = selectedHostedQualityStage({
    baseSha,
    candidateSha,
    nodeExecutable: process.execPath,
    nodeVersion: values.get("--node-version"),
    pnpmEntryPoint,
    stageId: values.get("--stage"),
    worktree: context.run.worktree
  })
  if (process.version.replace(/^v/u, "") !== values.get("--node-version"))
    throw new Error("Hosted quality Node matrix argument differs from the executing runtime")
  atomicRecord(values.get("--reference"), { version: 1, runId: context.run.runId })
  try {
    await runBoundedCommand({
      ...selected.stage.execution,
      ...(selected.stage.environmentPolicy === "coverage-base-warning"
        ? { environment: qualityGateTestEnvironment(baseSha) }
        : {})
    })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

const waitForClose = (child) =>
  new Promise((resolve) => {
    let launchError
    child.once("error", (error) => {
      launchError = error
    })
    child.once("close", (code, signal) => resolve({ code, launchError, signal }))
  })

export const runHostedQualityStage = async ({ binding, nodeVersion, outputDirectory, stageId }) => {
  binding = assertHostedQualityEnvironmentBinding(binding)
  if (process.version.replace(/^v/u, "") !== nodeVersion)
    throw new Error("Hosted quality Node matrix argument differs from the executing runtime")
  if (
    process.env.GITHUB_ACTIONS === "true" &&
    (process.env.DALPH_HOSTED_QUALITY_NODE_VERSION !== nodeVersion ||
      process.env.DALPH_HOSTED_QUALITY_STAGE_ID !== stageId)
  )
    throw new Error("Hosted quality matrix arguments differ from the workflow cell identity")
  const scratch = mkdtempSync(join(resolve(".scratch"), "hosted-quality-stage-"))
  const reference = join(scratch, "owner-run.json")
  const cellStartedAt = process.env.DALPH_HOSTED_QUALITY_CELL_STARTED_AT ?? wallClockTimestamp()
  try {
    const wrapper = fileURLToPath(new URL("./with-gate-slot.mjs", import.meta.url))
    const self = fileURLToPath(import.meta.url)
    const child = spawn(
      process.execPath,
      [
        wrapper,
        "--",
        process.execPath,
        self,
        "--execute",
        "owned",
        "--stage",
        stageId,
        "--base",
        binding.baseSha,
        "--candidate",
        binding.candidateSha,
        "--node-version",
        nodeVersion,
        "--reference",
        reference
      ],
      { stdio: "inherit", env: process.env }
    )
    const listeners = new Map(
      ["SIGINT", "SIGTERM"].map((signal) => [
        signal,
        () => {
          try {
            child.kill(signal)
          } catch {
            // The close event below remains authoritative when the child has already exited.
          }
        }
      ])
    )
    for (const [signal, listener] of listeners) process.on(signal, listener)
    const result = await waitForClose(child)
    for (const [signal, listener] of listeners) process.removeListener(signal, listener)
    if (result.launchError !== undefined) throw result.launchError
    const runId = readHostedQualityRunReference(reference)
    const envelope = exportHostedQualityStageEvidence({
      binding,
      cellStartedAt,
      nodeVersion,
      outputDirectory,
      runDirectory: hostedQualityRunDirectory(runId),
      runId,
      stageId
    })
    process.stdout.write(
      `Hosted quality stage ${stageId}: ${envelope.outcome}; evidence=${join(outputDirectory, "envelope.json")}\n`
    )
    // An ordinary stage failure is a complete diagnostic result. The aggregate owns the required verdict.
    return envelope
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  mkdirSync(resolve(".scratch"), { recursive: true })
  const values = parse(process.argv.slice(2))
  if (values.get("--execute") === "owned") await executeOwnedStage(values)
  else {
    const required = ["--stage", "--base", "--candidate", "--node-version", "--run-id", "--run-attempt", "--output"]
    if (required.some((name) => !values.has(name)) || values.size !== required.length)
      throw new Error(`Hosted quality stage requires ${required.join(", ")}`)
    await runHostedQualityStage({
      binding: {
        baseSha: values.get("--base"),
        candidateSha: values.get("--candidate"),
        runId: values.get("--run-id"),
        runAttempt: values.get("--run-attempt")
      },
      nodeVersion: values.get("--node-version"),
      outputDirectory: resolve(values.get("--output")),
      stageId: values.get("--stage")
    })
  }
}
