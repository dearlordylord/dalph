import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { preparePnpmWorkspaceState } from "./gate-quality-run.mjs"
import { startInputGuard } from "./gate-resume-inputs.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"
import { repositoryLocation, withoutInheritedCustody } from "./gate-custody-records.mjs"
import { readRunEvidence } from "./gate-run-evidence.mjs"

const pnpmEntryPoint = process.env.npm_execpath
if (pnpmEntryPoint === undefined) throw new Error("Run pnpm workspace-state controls through pnpm")
const wrapper = fileURLToPath(new URL("./with-gate-slot.mjs", import.meta.url))
const execute = new URL("./gate-quality-run.mjs", import.meta.url).href
const bounded = new URL("./run-bounded-command.mjs", import.meta.url).href
const fixture = () => {
  const outer = mkdtempSync(join(tmpdir(), "dalph-pnpm-state-"))
  const root = join(outer, "repo")
  mkdirSync(root)
  const environment = withoutInheritedCustody({
    ...process.env,
    HOME: outer,
    npm_config_userconfig: join(outer, "empty.npmrc")
  })
  for (const key of [
    "DALPH_COVERAGE_BASE_SHA",
    "DALPH_DPRINT_INCREMENTAL",
    "DALPH_GATE_GIT_HISTORY",
    "DALPH_QUALIFICATION_ENV_CAPTURE",
    "DALPH_RUN_REAL_CODEX_QUALIFICATION"
  ])
    delete environment[key]
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - '.'\n")
  const manifest = {
    name: "pnpm-state-fixture",
    private: true,
    scripts: { noop: 'node -e ""', inner: "pnpm run noop", nested: "pnpm run inner" }
  }
  const manifestPath = join(root, "package.json")
  writeFileSync(manifestPath, JSON.stringify(manifest))
  execFileSync(
    process.execPath,
    [pnpmEntryPoint, "--silent", "install", "--offline", "--ignore-scripts", "--store-dir", join(outer, "store")],
    { cwd: root, env: environment, timeout: 15_000 }
  )
  const state = join(root, "node_modules", ".pnpm-workspace-state-v1.json")
  const changeScripts = () => {
    manifest.scripts.additional = 'node -e ""'
    writeFileSync(manifestPath, JSON.stringify(manifest))
  }
  return {
    root,
    outer,
    environment,
    manifest,
    manifestPath,
    state,
    changeScripts,
    cleanup: () => rmSync(outer, { recursive: true, force: true })
  }
}
const nested = (f) =>
  runBoundedCommand({
    executable: process.execPath,
    args: [pnpmEntryPoint, "--silent", "run", "nested"],
    cwd: f.root,
    environment: f.environment,
    name: "real three-boundary pnpm scripts",
    timeoutMilliseconds: 15_000,
    captureOutput: true,
    forwardOutput: false
  })

test("actual nested pnpm refreshes script-edited workspace state; fresh preparation leaves later verifier calls unchanged under guard", async () => {
  const f = fixture()
  let guard
  try {
    f.changeScripts()
    const initial = readFileSync(f.state, "utf8")
    await nested(f)
    assert.notEqual(readFileSync(f.state, "utf8"), initial)
    f.manifest.scripts.another = 'node -e ""'
    writeFileSync(f.manifestPath, JSON.stringify(f.manifest))
    const stale = readFileSync(f.state, "utf8")
    await preparePnpmWorkspaceState({ worktree: f.root, pnpmEntryPoint, environment: f.environment })
    assert.notEqual(readFileSync(f.state, "utf8"), stale)
    const git = (...args) => execFileSync("git", args, { cwd: f.root, encoding: "utf8" }).trim()
    git("init", "-q")
    git("config", "user.name", "Fixture")
    git("config", "user.email", "fixture@example.invalid")
    writeFileSync(join(f.root, ".gitignore"), "node_modules/\n")
    git("add", ".")
    git("commit", "-qm", "fixture")
    guard = await startInputGuard({
      worktree: f.root,
      logicalInvocation: { mode: "pnpm fixture", baseSha: git("rev-parse", "HEAD"), toolExecutables: [] },
      effectiveEnvironment: { ...f.environment, npm_execpath: pnpmEntryPoint },
      generatedOutputRoots: []
    })
    const ready = readFileSync(f.state, "utf8")
    await nested(f)
    await nested(f)
    assert.equal(readFileSync(f.state, "utf8"), ready)
    assert.equal((await guard.finish()).unchanged, true)
    writeFileSync(f.state, `${ready}\n`)
    writeFileSync(f.state, ready)
    await assert.rejects(guard.assertUnchanged(), /dirty|changed/u)
  } catch (error) {
    if (error.output !== undefined) console.error(error.output)
    throw error
  } finally {
    await guard?.close()
    f.cleanup()
  }
})

test("fresh pnpm preparation rejects dependency mismatch without installing or rewriting consumed state", async () => {
  const f = fixture()
  try {
    const state = readFileSync(f.state, "utf8")
    const lock = readFileSync(join(f.root, "pnpm-lock.yaml"), "utf8")
    f.manifest.dependencies = { "private-never-installed-fixture": "1.0.0" }
    writeFileSync(f.manifestPath, JSON.stringify(f.manifest))
    await assert.rejects(
      preparePnpmWorkspaceState({ worktree: f.root, pnpmEntryPoint, environment: f.environment }),
      /failed with exit/u
    )
    assert.equal(readFileSync(f.state, "utf8"), state)
    assert.equal(readFileSync(join(f.root, "pnpm-lock.yaml"), "utf8"), lock)
    assert.equal(readdirSync(join(f.root, "node_modules")).includes("private-never-installed-fixture"), false)
  } finally {
    f.cleanup()
  }
})

test("actual admitted resume does not refresh altered pnpm workspace-state input", () => {
  const f = fixture()
  try {
    const git = (...args) => execFileSync("git", args, { cwd: f.root, encoding: "utf8" }).trim()
    git("init", "-q")
    git("config", "user.name", "Fixture")
    git("config", "user.email", "fixture@example.invalid")
    writeFileSync(join(f.root, ".gitignore"), "node_modules/\n.scratch/\n")
    git("add", ".")
    git("commit", "-qm", "base")
    git("commit", "--allow-empty", "-qm", "candidate")
    mkdirSync(join(f.root, ".scratch"))
    const script = join(f.root, ".scratch", "quality.mjs")
    writeFileSync(
      script,
      `import {executeResumableQualityGate} from ${JSON.stringify(execute)};import {runBoundedCommand} from ${JSON.stringify(bounded)};
const manifest=[{id:'nested',name:'nested',boundary:'qualification',args:[${JSON.stringify(pnpmEntryPoint)},'--silent','run','nested'],timeout:15000,artifactRoots:[],execution:{executable:process.execPath,args:[${JSON.stringify(pnpmEntryPoint)},'--silent','run','nested'],cwd:process.cwd(),name:'nested',timeoutMilliseconds:15000,acceptedExitCodes:[0],relayParentSignals:false,terminationGraceMilliseconds:5000,processGroupAbsenceTimeoutMilliseconds:2000}},{id:'late',name:'late',boundary:'qualification',args:['-e','process.exit(23)'],timeout:15000,artifactRoots:[],execution:{executable:process.execPath,args:['-e','process.exit(23)'],cwd:process.cwd(),name:'late',timeoutMilliseconds:15000,acceptedExitCodes:[0],relayParentSignals:false,terminationGraceMilliseconds:5000,processGroupAbsenceTimeoutMilliseconds:2000}}];
await executeResumableQualityGate({pnpmEntryPoint:${JSON.stringify(pnpmEntryPoint)},prepareFreshInputs:()=>{},logicalInvocation:{mode:'check:all',commandArguments:[process.execPath,process.argv[1]],baseSha:${JSON.stringify(git("rev-parse", "HEAD^"))},stageManifest:manifest,toolExecutables:[]},stageManifest:manifest,resumeRunId:process.argv[2]?.slice('--resume='.length),runStage:stage=>runBoundedCommand({executable:process.execPath,args:stage.args,name:stage.name,timeoutMilliseconds:15000})});`
    )
    f.changeScripts()
    const launch = (resume) =>
      spawnSync(
        process.execPath,
        [wrapper, "--", process.execPath, script, ...(resume ? [`--resume=${resume}`] : [])],
        { cwd: f.root, env: f.environment, encoding: "utf8", timeout: 20_000 }
      )
    const fresh = launch()
    assert.equal(fresh.status, 1, fresh.stderr)
    const runsDirectory = join(repositoryLocation(f.root).custodyRoot, "runs")
    const runId = readdirSync(runsDirectory)[0]
    const prior = readRunEvidence({ runId, runDirectory: join(runsDirectory, runId) })
    const late = prior.stages.find((stage) => stage.command.name === "late")
    assert.ok(late, `Expected intentional late child failure, not admission refusal: ${fresh.stderr}`)
    assert.equal(late.outcome, "exit:23")
    assert.equal(late.stopped, true)
    const preparation = prior.stages.find((stage) => stage.command.name === "fresh pnpm workspace-state validation")
    assert.equal(preparation.command.relayParentSignals, true)
    assert.equal(preparation.outcome, "passed")
    assert.equal(preparation.stopped, true)
    assert.equal(prior.resume.stages[0].outcome, "passed")
    const changed = `${readFileSync(f.state, "utf8")}\n`
    writeFileSync(f.state, changed)
    const resumed = launch(runId)
    assert.equal(resumed.status, 1, resumed.stderr)
    assert.match(resumed.stderr, /Resume refused/u)
    assert.equal(readFileSync(f.state, "utf8"), changed)
  } finally {
    f.cleanup()
  }
})
