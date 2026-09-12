import { ensureEffectTsgoPlatformBinaryExecutable } from "./effect-tsgo-platform-binary.mjs"
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { atomicRecord, digest, inheritedCustody } from "./gate-custody-records.mjs"
import { captureResumeArtifacts } from "./gate-resume-artifacts.mjs"
import { selectResumePrefix } from "./gate-resume-policy.mjs"
import { readRunEvidence } from "./gate-run-evidence.mjs"
import { qualitySubtreeProven } from "./gate-quality-evidence.mjs"
import { addSuccessfulOutputLines } from "./quality-output-budget.mjs"
import { runPreflightCensus } from "./preflight-census.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"
import { boundedQualityGateCommand, qualityGateTestEnvironment } from "./quality-gate-stage-policy.mjs"

/** Vite/Vitest results, transforms and newly bundled config modules are disposable, never credited stages. */
export const resetQualityCaches = (worktree) => {
  const packageRoots = [worktree]
  for (const directory of ["packages", "prototypes"]) {
    const parent = join(worktree, directory)
    if (existsSync(parent))
      for (const name of readdirSync(parent).sort((left, right) => left.localeCompare(right))) {
        const path = join(parent, name)
        if (lstatSync(path).isDirectory()) packageRoots.push(path)
      }
  }
  const roots = packageRoots.flatMap((root) =>
    [".vite", ".vite-temp"].map((cache) => join(root, "node_modules", cache))
  )
  for (const root of roots) {
    if (existsSync(root) && !lstatSync(root).isDirectory())
      throw new Error(`Unsupported disposable Vite cache: ${root}`)
    rmSync(root, { recursive: true, force: true })
  }
  return roots
}

/** Validate pnpm's consumed workspace state before observing fresh inputs; never install dependencies. */
export const preparePnpmWorkspaceState = ({ environment = process.env, pnpmEntryPoint, worktree }) =>
  runBoundedCommand({
    executable: process.execPath,
    args: [pnpmEntryPoint, "--silent", "exec", process.execPath, "-e", ""],
    cwd: worktree,
    environment: {
      ...environment,
      npm_config_verify_deps_before_run: "error",
      pnpm_config_verify_deps_before_run: "error"
    },
    name: "fresh pnpm workspace-state validation",
    relayParentSignals: true,
    timeoutMilliseconds: 60_000
  })

/** Execute designated stages; skipped commands retain original provenance rather than fresh receipts. */
export const executeResumableQualityGate = async ({
  logicalInvocation,
  pnpmEntryPoint,
  prepareFreshInputs = ensureEffectTsgoPlatformBinaryExecutable,
  report = console.error,
  resumeRunId,
  runStage,
  stageManifest,
  startGuard
}) => {
  const context = inheritedCustody()
  if (context === undefined) throw new Error("Resumable quality stages require admitted gate custody")
  const { run, runDirectory } = context
  logicalInvocation = { ...logicalInvocation, dprintIncremental: "disabled" }
  process.env.DALPH_DPRINT_INCREMENTAL = "disabled"
  // Read-only Git observations must not refresh the watched index; required Git locks remain enabled.
  process.env.GIT_OPTIONAL_LOCKS = "0"
  atomicRecord(join(runDirectory, "run.json"), { ...run, requiresQualityComposite: true })
  // Fresh installation setup precedes identity observation; resume must retain changed input modes.
  if (resumeRunId === undefined) {
    prepareFreshInputs()
    if (pnpmEntryPoint !== undefined) await preparePnpmWorkspaceState({ worktree: run.worktree, pnpmEntryPoint })
  }
  const disposableCacheRoots = resetQualityCaches(run.worktree)
  const generatedOutputRoots = [
    ".scratch",
    "coverage",
    "dist",
    "packages/contracts/dist",
    "packages/orchestrator/dist",
    "packages/dalph/dist",
    "prototypes/reducer-lab/dist"
  ]
    .map((root) => resolve(run.worktree, root))
    .concat(disposableCacheRoots)
  const guardFactory = startGuard ?? (await import("./gate-resume-inputs.mjs")).startInputGuard
  const guard = await guardFactory({
    worktree: run.worktree,
    logicalInvocation,
    effectiveEnvironment: process.env,
    generatedOutputRoots
  })
  const identity = { ...guard.identity, worktree: run.worktree }
  const contract = {
    version: 1,
    runId: run.runId,
    logicalInvocation,
    manifest: stageManifest,
    maximumSuccessfulOutputLines: 550,
    disposableCacheRoots,
    identityReceiptDigest: digest(JSON.stringify(identity))
  }
  atomicRecord(join(runDirectory, "resume-contract.json"), contract)
  atomicRecord(join(runDirectory, "resume-inputs.json"), { version: 1, identity })
  mkdirSync(join(runDirectory, "quality-stages"), { recursive: true })
  let successfulOutputLines = 0
  const entries = stageManifest.map(() => ({ kind: "pending" }))
  try {
    let prefix = []
    if (resumeRunId !== undefined) {
      if (!/^[0-9a-f-]{36}$/u.test(resumeRunId) || resumeRunId === run.runId)
        throw new Error("Invalid resume run reference")
      const priorEvidence = readRunEvidence({
        runDirectory: join(run.commonDirectory, "dalph-gates", "runs", resumeRunId),
        runId: resumeRunId
      })
      const roots = [...new Set(stageManifest.flatMap((stage) => stage.artifactRoots))]
      let currentArtifacts = captureResumeArtifacts({
        worktree: run.worktree,
        roots,
        coverageDirectory: join(priorEvidence.reportDirectory, "coverage")
      })
      const selected = selectResumePrefix({ priorEvidence, currentIdentity: identity, stageManifest, currentArtifacts })
      if (selected.status !== "selected") throw new Error(`Resume refused: ${selected.cause}`)
      prefix = selected.prefix
      const creditedRoots = [...new Set(prefix.flatMap((stage) => Object.keys(stage.artifacts)))].map((root) =>
        root === "@coverage" ? join(priorEvidence.reportDirectory, "coverage") : resolve(run.worktree, root)
      )
      if (creditedRoots.length > 0) {
        await guard.protectArtifacts(creditedRoots)
        currentArtifacts = captureResumeArtifacts({
          worktree: run.worktree,
          roots,
          coverageDirectory: join(priorEvidence.reportDirectory, "coverage")
        })
        const protectedSelection = selectResumePrefix({
          priorEvidence,
          currentIdentity: identity,
          stageManifest,
          currentArtifacts
        })
        if (protectedSelection.status !== "selected") throw new Error(`Resume refused: ${protectedSelection.cause}`)
      }
      for (const stage of prefix) {
        successfulOutputLines = addSuccessfulOutputLines({
          currentOutputLines: successfulOutputLines,
          maximumOutputLines: 550,
          stageName: stage.stageId,
          stageOutputLines: stage.outputLineCount
        })
        entries[stage.ordinal] = { kind: "reused", ...stage }
        if (Object.hasOwn(stage.artifacts, "@coverage")) {
          const coverageDirectory = join(run.reportDirectory, "coverage")
          cpSync(join(priorEvidence.reportDirectory, "coverage"), coverageDirectory, {
            recursive: true,
            errorOnExist: true,
            force: false
          })
          const copied = captureResumeArtifacts({ worktree: run.worktree, roots: ["@coverage"], coverageDirectory })
          if (JSON.stringify(copied["@coverage"]) !== JSON.stringify(stage.artifacts["@coverage"]))
            throw new Error("Copied coverage artifact does not match original proved bytes")
          entries[stage.ordinal].copiedCoverage = { directory: coverageDirectory, artifact: copied["@coverage"] }
        }
        report(`Reused quality stage ${stage.stageId} from ${stage.runId}`)
      }
    }
    const executeStage = async (stage) => {
      await guard.assertUnchanged()
      const ordinal = stageManifest.indexOf(stage)
      const path = join(runDirectory, "quality-stages", `${ordinal}.json`)
      const started = { version: 1, runId: run.runId, ordinal, stageId: stage.id, contract: stage, outcome: "started" }
      atomicRecord(path, started)
      entries[ordinal] = { kind: "executed" }
      let result
      try {
        const gate =
          stage.environmentPolicy === "coverage-base-warning"
            ? { ...stage, environment: qualityGateTestEnvironment(logicalInvocation.baseSha) }
            : stage
        result = await (
          runStage ??
          ((selectedGate) =>
            runBoundedCommand(
              boundedQualityGateCommand({ gate: selectedGate, nodeExecutable: process.execPath, pnpmEntryPoint })
            ))
        )(gate)
        await guard.assertUnchanged()
        const evidence = readRunEvidence({ runDirectory, runId: run.runId })
        if (
          JSON.stringify(
            evidence.stages.find((receipt) => receipt.obligationId === result.gateObligationId)?.command
          ) !== JSON.stringify(stage.execution)
        )
          throw new Error("Quality stage command differs from its bounded manifest")
        if (!qualitySubtreeProven(evidence.stages, result.gateObligationId))
          throw new Error("Quality stage has incomplete terminal subtree")
        const completedRoots = stage.artifactRoots.map((root) =>
          root === "@coverage" ? join(run.reportDirectory, "coverage") : resolve(run.worktree, root)
        )
        if (completedRoots.length > 0) await guard.protectArtifacts(completedRoots)
        await guard.assertUnchanged()
        successfulOutputLines = addSuccessfulOutputLines({
          currentOutputLines: successfulOutputLines,
          maximumOutputLines: 550,
          stageName: stage.id,
          stageOutputLines: result.outputLineCount
        })
        atomicRecord(path, {
          ...started,
          outcome: "passed",
          obligationId: result.gateObligationId,
          outputLineCount: result.outputLineCount,
          artifacts: captureResumeArtifacts({
            worktree: run.worktree,
            roots: stage.artifactRoots,
            coverageDirectory: join(run.reportDirectory, "coverage")
          })
        })
        return { ...result, outputLineCount: 0 }
      } catch (error) {
        atomicRecord(path, {
          ...started,
          outcome: "failed",
          obligationId: result?.gateObligationId ?? error.gateObligationId,
          outputLineCount: result?.outputLineCount ?? 0,
          artifacts: captureResumeArtifacts({
            worktree: run.worktree,
            roots: stage.artifactRoots,
            coverageDirectory: join(run.reportDirectory, "coverage")
          })
        })
        throw error
      }
    }
    let failure
    try {
      const suffix = stageManifest.slice(prefix.length)
      const preflight = await runPreflightCensus({
        gates: suffix.filter((stage) => stage.boundary === "preflight"),
        runStage: executeStage,
        report
      })
      if (!preflight.succeeded) throw new Error("Preflight failed; qualification stages did not start")
      for (const stage of suffix.filter((stage) => stage.boundary === "qualification")) await executeStage(stage)
    } catch (error) {
      failure = error
    }
    const finalGuard = await guard.finish()
    atomicRecord(join(runDirectory, "input-guard.json"), finalGuard)
    atomicRecord(join(runDirectory, "composite.json"), {
      version: 1,
      runId: run.runId,
      logicalInvocation,
      manifest: stageManifest,
      entries,
      successfulOutputLines
    })
    if (failure !== undefined) throw failure
    return { successfulOutputLines }
  } finally {
    await guard.close()
  }
}
