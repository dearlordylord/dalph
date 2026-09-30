import { ensureEffectTsgoPlatformBinaryExecutable } from "./effect-tsgo-platform-binary.mjs"
import { existsSync, lstatSync, rmSync } from "node:fs"
import { startInputGuard } from "./gate-resume-inputs.mjs"
import { execFileSync } from "node:child_process"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { completeFormalChangedPaths } from "./changed-files.mjs"
import { classifyFormalChangeBetween } from "./classify-docs-only-change.mjs"
import { atomicRecord, inheritedCustody } from "./gate-custody-records.mjs"
import {
  fullQualityGateManifest,
  boundedQualityGateCommand,
  qualityGateTestEnvironment
} from "./quality-gate-stage-policy.mjs"
import { resolveQualityGateBase } from "./resolve-quality-gate-base.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"

/** Resolve commands only after selection so sampling changes cannot retain stale execution fields. */
export const materializeCandidateManifest = (stages, pnpmEntryPoint, worktree) =>
  stages.map((stage) => ({
    id: stage.id,
    artifactRoots: (stage.artifactRoots ?? []).map((root) =>
      root === "@coverage"
        ? (process.env.DALPH_COVERAGE_DIRECTORY ?? resolve(worktree, "coverage"))
        : resolve(worktree, root)
    ),
    execution: {
      ...boundedQualityGateCommand({ gate: stage, nodeExecutable: process.execPath, pnpmEntryPoint }),
      cwd: worktree
    }
  }))

/** Local candidate qualification executes only its application stages. */
export const localCandidateStages = (stages) => [
  ...stages.filter((stage) => stage.boundary === "preflight"),
  ...stages.filter((stage) => stage.boundary === "qualification")
]

/** Preserve the exact relevance classification while leaving proof opt-in. */
export const localCandidateCheckPlan = (formal, stages) => ({
  identity: { formal, formalDisposition: "not-requested" },
  stages: localCandidateStages(stages)
})

/** Persist every report state with the same immutable candidate identity. */
export const writeCandidateCheckReport = (reportPath, identity, state) =>
  atomicRecord(reportPath, { ...identity, ...state })

/** This same input contract is used for every fresh candidate; it never grants reuse credit. */
export const candidateInputContract = (identity) => ({
  ...identity,
  dprintIncremental: "disabled",
  gitHistory: { mode: "candidate-ancestry", headSha: identity.candidateHeadSha },
  stageManifest: identity.manifest.map((stage) => ({ ...stage, args: stage.execution.args.slice(2) })),
  toolExecutables: ["git", "bash", "flock", "gitleaks"]
})

/** Execute this candidate's recorded commands; no other checkout interprets a profile or grants credit. */
export const executeCandidateChecks = async ({ guard, manifest, record, runStage }) => {
  const results = []
  record({ manifest, results, status: "running" })
  try {
    for (const stage of manifest) {
      await guard.assertUnchanged()
      const result = await runStage(stage)
      if (result.exitCode !== 0) throw new Error(`Stage ${stage.id} exited ${result.exitCode}`)
      if (stage.artifactRoots?.length > 0) await guard.protectArtifacts(stage.artifactRoots)
      await guard.assertUnchanged()
      results.push({ id: stage.id, status: "passed" })
      record({ manifest, results, status: "running" })
    }
    await guard.finish()
    record({ manifest, results, status: "passed" })
  } catch (error) {
    record({ manifest, results, status: "failed", message: error.message })
    throw error
  }
}

const main = async () => {
  const args = process.argv.slice(2)
  if (args.length !== 1 || !/^--candidate=[0-9a-f]{40}$/u.test(args[0]))
    throw new Error("Use pnpm check:all --candidate=<exact base SHA>; resume is retired")
  const context = inheritedCustody()
  if (context === undefined || context.run.worktree !== process.cwd())
    throw new Error("Candidate checks require exact-worktree admission")
  const pnpmEntryPoint = process.env.npm_execpath
  if (pnpmEntryPoint === undefined) throw new Error("Run candidate checks through pnpm")
  // pnpm may refresh its derived workspace metadata after a package manifest edit.
  // Prepare that cache before freezing inputs; stale dependencies fail without installing.
  const preparation = {
    executable: process.execPath,
    args: [pnpmEntryPoint, "--config.verify-deps-before-run=error", "exec", "node", "--eval", "void 0"],
    cwd: process.cwd(),
    name: "Validate installed dependencies before input observation",
    relayParentSignals: true,
    timeoutMilliseconds: 30_000,
    acceptedExitCodes: [0]
  }
  await runBoundedCommand(preparation)
  // Clean installs need this executable mode before diagnostics enter the frozen candidate.
  ensureEffectTsgoPlatformBinaryExecutable()
  const git = (...gitArgs) =>
    execFileSync("git", gitArgs, { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim()
  if (git("status", "--porcelain") !== "") throw new Error("Freeze a clean candidate checkout before qualification")
  const candidateHeadSha = git("rev-parse", "HEAD")
  const baseSha = resolveQualityGateBase({ candidateBase: args[0].slice("--candidate=".length) })
  const changedPaths = completeFormalChangedPaths(baseSha).changedFiles
  const formal = classifyFormalChangeBetween({ baseSha, headSha: candidateHeadSha, cwd: process.cwd() })
  const stages = fullQualityGateManifest(baseSha, {
    candidateHeadSha,
    changedPaths,
    nodeExecutable: process.execPath,
    pnpmEntryPoint,
    worktree: process.cwd()
  })
  // Local qualification records relevance without running the formal proof.
  const plan = localCandidateCheckPlan(formal, stages)
  const manifest = materializeCandidateManifest(plan.stages, pnpmEntryPoint, process.cwd())
  const identity = {
    version: 1,
    worktree: process.cwd(),
    baseSha,
    candidateHeadSha,
    ...plan.identity,
    gitIndexObservation: "semantic",
    changedPaths,
    preparation
  }
  const report = join(context.run.reportDirectory, "candidate-checks.json")
  const environment = {
    ...qualityGateTestEnvironment(baseSha),
    DALPH_DPRINT_INCREMENTAL: "disabled",
    DALPH_GATE_GIT_HISTORY: "candidate-ancestry",
    GIT_OPTIONAL_LOCKS: "0"
  }
  const cacheRoots = [
    "",
    "packages/contracts",
    "packages/orchestrator",
    "packages/dalph",
    "prototypes/reducer-lab"
  ].flatMap((root) =>
    [".cache", ".vite", ".vite-temp", ".experimental-vitest-cache"].map((cache) => resolve(root, "node_modules", cache))
  )
  for (const root of cacheRoots) {
    if (existsSync(root) && !lstatSync(root).isDirectory()) throw new Error(`Unsupported disposable cache: ${root}`)
    rmSync(root, { recursive: true, force: true })
  }
  writeCandidateCheckReport(report, identity, { manifest, results: [], status: "preparing" })
  console.error("Local formal proof not requested; run pnpm check:quint explicitly or use CI formal verification.")
  const guard = await startInputGuard({
    worktree: process.cwd(),
    logicalInvocation: candidateInputContract({ ...identity, manifest }),
    effectiveEnvironment: environment,
    generatedOutputRoots: [
      ".scratch",
      "tmp",
      "_apalache-out",
      "coverage",
      "dist",
      "packages/contracts/dist",
      "packages/orchestrator/dist",
      "packages/dalph/dist",
      "prototypes/reducer-lab/dist",
      "node_modules/.cache",
      "node_modules/.vite",
      "node_modules/.vite-temp",
      "node_modules/.experimental-vitest-cache"
    ]
      .map((path) => resolve(path))
      .concat(cacheRoots)
  })
  try {
    await executeCandidateChecks({
      guard,
      manifest,
      record: (result) => writeCandidateCheckReport(report, identity, result),
      runStage: (stage) => runBoundedCommand({ ...stage.execution, environment })
    })
  } finally {
    await guard.close()
  }
  console.log(`Candidate checks passed: ${report}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main()
