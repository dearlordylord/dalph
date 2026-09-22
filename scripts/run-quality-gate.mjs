import { execFileSync } from "node:child_process"
import { classifyFormalChangeBetween } from "./classify-docs-only-change.mjs"
import { executeResumableQualityGate } from "./gate-quality-run.mjs"
import { inheritedCustody } from "./gate-custody-records.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"
import { parseQualityCommandArguments } from "./quality-command-policy.mjs"
import { addSuccessfulOutputLines, outputPresentationPolicy } from "./quality-output-budget.mjs"
import {
  boundedQualityGateCommand,
  localQualificationConcurrency,
  preflightQualityGates,
  qualityGateTestEnvironment,
  fullQualityGateManifest
} from "./quality-gate-stage-policy.mjs"
import { runPreflightCensus } from "./preflight-census.mjs"
import { resolveQualityGateBase } from "./resolve-quality-gate-base.mjs"
import { qualityVerificationExecutables, stabilizeVerificationEnvironment } from "./stabilize-verification-path.mjs"

// Admitted structural checks always inspect formatter inputs without incremental result reuse.
process.env.DALPH_DPRINT_INCREMENTAL = "disabled"
if (process.env.DALPH_GATE_RECOVERY_MODE !== undefined)
  throw new Error("A focused gate recovery action cannot launch the full quality gate")

const pnpmEntryPoint = process.env.npm_execpath
const { candidateArgument, purpose, resumeRunId } = parseQualityCommandArguments(process.argv.slice(2))
// The full gate rebuilds the whole program several times and runs every suite, so it belongs to a frozen candidate and
// to hosted verification. Development uses the focused tiers instead, which is why local runs state their intent.
const acknowledgedFullGate =
  candidateArgument !== undefined || process.env["DALPH_FULL_GATE"] === "1" || process.env["CI"] !== undefined

if (pnpmEntryPoint === undefined) {
  throw new Error("Run the quality gate through pnpm so its executable can be resolved safely")
}

const declaredGateTools = qualityVerificationExecutables(process.env)
const effectiveEnvironment = stabilizeVerificationEnvironment({
  environment: process.env,
  requiredExecutables: declaredGateTools
})
process.env.PATH = effectiveEnvironment.PATH

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
const resumable = purpose === "local-handoff"
if (resumable && context === undefined) throw new Error("Use the admitted pnpm check:all entry point")
const candidateHistory = resumable
const candidateHeadSha = candidateHistory
  ? execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
      cwd: context.run.worktree,
      encoding: "utf8",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
    }).trim()
  : undefined
if (candidateHistory) process.env.DALPH_GATE_GIT_HISTORY = "candidate-ancestry"
let formalClassification
if (resumable) {
  try {
    formalClassification = classifyFormalChangeBetween({
      baseSha: qualityBaseSha,
      headSha: candidateHeadSha,
      cwd: context.run.worktree
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to classify local formal relevance: ${detail}`, { cause: error })
  }
}
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
if (resumable) {
  const logicalInvocation = {
    mode: "check:all",
    ...(candidateHeadSha === undefined
      ? {}
      : { gitHistory: { mode: "candidate-ancestry", headSha: candidateHeadSha } }),
    baseSha: qualityBaseSha,
    formalClassification,
    qualificationConcurrency: localQualificationConcurrency,
    commandArguments: context.run.commandArguments
      .filter((argument) => !argument.startsWith("--resume="))
      .map((argument) => (argument.startsWith("--candidate=") ? `--candidate=${qualityBaseSha}` : argument)),
    stageManifest,
    outputPresentationPolicy,
    toolExecutables: [
      "git",
      "bash",
      "flock",
      "gitleaks",
      ...(process.env.DALPH_OXLINT_BIN ? [process.env.DALPH_OXLINT_BIN] : [])
    ]
  }
  const result = await executeResumableQualityGate({ stageManifest, logicalInvocation, resumeRunId, pnpmEntryPoint })
  console.log(
    `Quality gate emitted ${result.successfulOutputLines} successful output lines (full counts; console presentation is bounded per command).`
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
      stageName: gate.name,
      stageOutputLines: result.outputLineCount
    })
  }

  console.log(
    `Quality gate emitted ${successfulOutputLines} successful output lines (full counts; console presentation is bounded per command).`
  )
}
