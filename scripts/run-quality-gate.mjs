import { execFileSync } from "node:child_process"
import { executeResumableQualityGate } from "./gate-quality-run.mjs"
import { inheritedCustody } from "./gate-custody-records.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"
import { addSuccessfulOutputLines } from "./quality-output-budget.mjs"
import {
  boundedQualityGateCommand,
  preflightQualityGates,
  qualityGateTestEnvironment,
  fullQualityGateManifest
} from "./quality-gate-stage-policy.mjs"
import { runPreflightCensus } from "./preflight-census.mjs"
import { resolveQualityGateBase } from "./resolve-quality-gate-base.mjs"

const maximumSuccessfulOutputLines = 550
// Admitted structural checks always inspect formatter inputs without incremental result reuse.
process.env.DALPH_DPRINT_INCREMENTAL = "disabled"

const pnpmEntryPoint = process.env.npm_execpath
const candidateArgument = process.argv.find((argument) => argument.startsWith("--candidate="))
// The full gate rebuilds the whole program several times and runs every suite, so it belongs to a frozen candidate and
// to hosted verification. Development uses the focused tiers instead, which is why local runs state their intent.
const acknowledgedFullGate =
  candidateArgument !== undefined || process.env["DALPH_FULL_GATE"] === "1" || process.env["CI"] !== undefined

if (pnpmEntryPoint === undefined) {
  throw new Error("Run the quality gate through pnpm so its executable can be resolved safely")
}

if (!acknowledgedFullGate) {
  console.error(
    [
      "The full quality gate runs once per frozen candidate.",
      "Development loop: pnpm check:fast",
      "Before freezing: pnpm check:preflight --candidate=<base sha> && pnpm test",
      "Frozen candidate: pnpm check:all --candidate=<base sha>"
    ].join("\n")
  )
  process.exit(2)
}

const explicitCandidateBase = candidateArgument?.slice("--candidate=".length)
const qualityBaseSha = resolveQualityGateBase({
  candidateBase: explicitCandidateBase,
  hostedBase: process.env.DALPH_COVERAGE_BASE_SHA
})
const testEnvironment = qualityGateTestEnvironment(qualityBaseSha)

const context = inheritedCustody()
const resumable = context !== undefined && process.env.npm_lifecycle_event === "check:all"
const candidateHistory = resumable && process.env.CI === undefined
const candidateHeadSha = candidateHistory
  ? execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], { encoding: "utf8" }).trim()
  : undefined
if (candidateHistory) process.env.DALPH_GATE_GIT_HISTORY = "candidate-ancestry"
const stageManifest = fullQualityGateManifest(qualityBaseSha, {
  nodeExecutable: process.execPath,
  pnpmEntryPoint,
  candidateHeadSha,
  worktree: context?.run.worktree ?? process.cwd()
})
const gates = stageManifest
  .filter((stage) => stage.boundary === "qualification")
  .map((stage) =>
    stage.environmentPolicy === "coverage-base-warning" ? { ...stage, environment: testEnvironment } : stage
  )
const resumeArguments = process.argv.filter((argument) => argument.startsWith("--resume="))
if (resumeArguments.length > 1) throw new Error("Name at most one prior run for resume")
if (resumeArguments.length > 0 && !resumable) throw new Error("Resume is supported only through pnpm check:all")
if (resumable) {
  const logicalInvocation = {
    mode: "check:all",
    ...(candidateHeadSha === undefined
      ? {}
      : { gitHistory: { mode: "candidate-ancestry", headSha: candidateHeadSha } }),
    baseSha: qualityBaseSha,
    commandArguments: context.run.commandArguments
      .filter((argument) => !argument.startsWith("--resume="))
      .map((argument) => (argument.startsWith("--candidate=") ? `--candidate=${qualityBaseSha}` : argument)),
    stageManifest,
    maximumSuccessfulOutputLines,
    toolExecutables: [
      "git",
      "bash",
      "flock",
      "gitleaks",
      ...(process.env.DALPH_OXLINT_BIN ? [process.env.DALPH_OXLINT_BIN] : [])
    ]
  }
  const result = await executeResumableQualityGate({
    stageManifest,
    logicalInvocation,
    resumeRunId: resumeArguments[0]?.slice("--resume=".length),
    pnpmEntryPoint
  })
  console.log(
    `Quality gate emitted ${result.successfulOutputLines}/${maximumSuccessfulOutputLines} successful output lines.`
  )
} else {
  const preflight = await runPreflightCensus({
    gates: preflightQualityGates(qualityBaseSha),
    runStage: (gate) =>
      runBoundedCommand(boundedQualityGateCommand({ gate, nodeExecutable: process.execPath, pnpmEntryPoint }))
  })
  if (!preflight.succeeded) {
    console.error("Preflight failed; qualification stages did not start.")
    process.exit(1)
  }
  let successfulOutputLines = preflight.successfulOutputLines

  for (const gate of gates) {
    const result = await runBoundedCommand(
      boundedQualityGateCommand({ gate, nodeExecutable: process.execPath, pnpmEntryPoint })
    )
    successfulOutputLines = addSuccessfulOutputLines({
      currentOutputLines: successfulOutputLines,
      maximumOutputLines: maximumSuccessfulOutputLines,
      stageName: gate.name,
      stageOutputLines: result.outputLineCount
    })
  }

  console.log(`Quality gate emitted ${successfulOutputLines}/${maximumSuccessfulOutputLines} successful output lines.`)
}
