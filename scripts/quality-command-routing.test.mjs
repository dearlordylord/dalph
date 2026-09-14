import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { withoutInheritedCustody } from "./gate-custody-records.mjs"
import { parseQualityCommandArguments } from "./quality-command-policy.mjs"

const repository = fileURLToPath(new URL("../", import.meta.url))
const base = execFileSync("git", ["rev-parse", "HEAD^"], { cwd: repository, encoding: "utf8" }).trim()
const resume = "12345678-1234-1234-1234-123456789012"

/** Execute the unchanged command source against controlled process/stage boundaries.
 * Full admitted formal execution is covered by quality/formal integration fixtures. */
const dispatch = ({
  admitted = true,
  arguments: args,
  argvZeroTool,
  classificationFailure = false,
  environment = {},
  failLocal = false,
  pinJavaHome = false,
  throughWrapper = false
}) => {
  const root = mkdtempSync(join(tmpdir(), "dalph-quality-routing-"))
  const log = join(root, "dispatch.jsonl")
  const pnpmRoot = join(root, "pnpm")
  const pnpmEntryPoint = join(pnpmRoot, "bin", "pnpm.cjs")
  const identityWorktree = join(root, "identity-worktree")
  const append = `import {appendFileSync} from 'node:fs';const record=value=>appendFileSync(${JSON.stringify(log)},JSON.stringify(value)+'\\n');\n`
  try {
    mkdirSync(join(pnpmRoot, "bin"), { recursive: true })
    writeFileSync(join(pnpmRoot, "package.json"), JSON.stringify({ name: "pnpm" }))
    writeFileSync(pnpmEntryPoint, "#!/usr/bin/env node\n")
    chmodSync(pnpmEntryPoint, 0o755)
    mkdirSync(identityWorktree)
    execFileSync("git", ["init", "-q"], { cwd: identityWorktree })
    execFileSync("git", ["config", "user.name", "Quality Identity"], { cwd: identityWorktree })
    execFileSync("git", ["config", "user.email", "identity@example.invalid"], { cwd: identityWorktree })
    writeFileSync(join(identityWorktree, "source.js"), "export const identity = true\n")
    execFileSync("git", ["add", "."], { cwd: identityWorktree })
    execFileSync("git", ["commit", "-qm", "identity fixture"], { cwd: identityWorktree })
    for (const file of [
      "run-quality-gate.mjs",
      "quality-command-policy.mjs",
      "quality-output-budget.mjs",
      "stabilize-verification-path.mjs"
    ])
      copyFileSync(new URL(file, import.meta.url), join(root, file))
    writeFileSync(
      join(root, "classify-docs-only-change.mjs"),
      classificationFailure
        ? "export const classifyFormalChangeBetween=()=>{throw new Error('controlled unavailable projection')}"
        : "export const classifyFormalChangeBetween=({baseSha,headSha})=>({version:1,status:'affected',baseSha,headSha,changedPaths:['controlled-formal-input'],affectedPaths:['controlled-formal-input']})"
    )
    writeFileSync(
      join(root, "gate-quality-run.mjs"),
      `${append}import {execFileSync} from 'node:child_process';export const executeResumableQualityGate=async options=>{let identity={environmentPath:process.env.PATH};let environment=process.env;let guard;if(process.env.DALPH_TEST_CAPTURE_IDENTITY==='1'){environment={...process.env,GIT_OPTIONAL_LOCKS:'0'};delete environment.DALPH_GATE_GIT_HISTORY;const {startInputGuard}=await import(${JSON.stringify(new URL("gate-resume-inputs.mjs", import.meta.url).href)});guard=await startInputGuard({worktree:${JSON.stringify(identityWorktree)},logicalInvocation:{mode:'controlled check:all identity',baseSha:options.logicalInvocation.baseSha,dprintIncremental:'disabled',toolExecutables:[]},effectiveEnvironment:environment,generatedOutputRoots:[]});identity=guard.identity;}try{const childPath=execFileSync(process.execPath,['-e','process.stdout.write(process.env.PATH)'],{env:environment,encoding:'utf8'});record({boundary:'local-handoff',options,effectivePath:environment.PATH,childPath,identity});${failLocal ? "throw Error('controlled required formal verification failed');" : "return {successfulOutputLines:0};"}}finally{if(guard){await guard.finish();await guard.close();}}};`
    )
    writeFileSync(
      join(root, "gate-custody-records.mjs"),
      `export const inheritedCustody=()=>(${admitted ? JSON.stringify({ run: { worktree: repository, commandArguments: [process.execPath, "scripts/run-quality-gate.mjs", ...args] } }) : "undefined"});`
    )
    writeFileSync(
      join(root, "run-bounded-command.mjs"),
      `${append}export const runBoundedCommand=async command=>{record({boundary:'hosted-stage',command});return {exitCode:0,outputLineCount:0};};`
    )
    for (const file of ["quality-gate-stage-policy.mjs", "preflight-census.mjs", "resolve-quality-gate-base.mjs"])
      writeFileSync(join(root, file), `export * from ${JSON.stringify(new URL(file, import.meta.url).href)};`)
    if (throughWrapper) {
      writeFileSync(join(root, ".gitignore"), ".scratch/\ndispatch.jsonl\nhome/\nidentity-worktree/\npnpm/\n")
      execFileSync("git", ["init", "-q"], { cwd: root })
      execFileSync("git", ["config", "user.name", "Wrapped Quality"], { cwd: root })
      execFileSync("git", ["config", "user.email", "wrapped@example.invalid"], { cwd: root })
      execFileSync("git", ["add", "."], { cwd: root })
      execFileSync("git", ["commit", "-qm", "wrapped base"], { cwd: root })
      execFileSync("git", ["commit", "--allow-empty", "-qm", "wrapped candidate"], { cwd: root })
    }
    const clean = withoutInheritedCustody(process.env)
    for (const key of [
      "CI",
      "DALPH_FULL_GATE",
      "DALPH_GATE_GIT_HISTORY",
      "DALPH_COVERAGE_BASE_SHA",
      "npm_lifecycle_event"
    ])
      delete clean[key]
    if (argvZeroTool !== undefined) {
      const home = join(root, "home")
      const shim = join(home, ".codex", "tmp", "arg0", "codex-arg0Ab12Cd")
      mkdirSync(shim, { recursive: true })
      writeFileSync(join(shim, ".lock"), "controlled shim\n")
      if (argvZeroTool !== false) {
        writeFileSync(join(shim, argvZeroTool), "#!/bin/sh\nexit 0\n")
        chmodSync(join(shim, argvZeroTool), 0o755)
      }
      clean.HOME = home
      clean.PATH = `${shim}:/usr/local/bin:/usr/bin:/bin`
      if (argvZeroTool === false) clean.DALPH_TEST_CAPTURE_IDENTITY = "1"
    }
    if (pinJavaHome) {
      const javaHome = join(root, "java-home")
      const javaExecutable = join(javaHome, "bin", "java")
      mkdirSync(join(javaHome, "bin"), { recursive: true })
      writeFileSync(javaExecutable, "#!/bin/sh\nexit 0\n")
      chmodSync(javaExecutable, 0o755)
      clean.JAVA_HOME = javaHome
    }
    const qualityCommand = [process.execPath, join(root, "run-quality-gate.mjs"), ...args]
    const invocation = throughWrapper
      ? [fileURLToPath(new URL("with-gate-slot.mjs", import.meta.url)), "--", ...qualityCommand]
      : qualityCommand.slice(1)
    const childEnvironment = { ...clean, npm_execpath: pnpmEntryPoint, ...environment }
    // The Java-shim rejection scenario must exercise PATH-selected Java even
    // on hosted runners that provide an ambient JAVA_HOME.
    if (argvZeroTool === "java" && !pinJavaHome) delete childEnvironment.JAVA_HOME
    const result = spawnSync(process.execPath, invocation, {
      cwd: throughWrapper ? root : repository,
      env: childEnvironment,
      encoding: "utf8",
      timeout: 30000
    })
    let calls = []
    try {
      calls = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    const runs = join(root, ".git", "dalph-gates", "runs")
    return { calls, custodyRuns: existsSync(runs) ? readdirSync(runs).length : 0, result }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("full quality entry gives its identity and real child one stabilized PATH", () => {
  const { calls, result } = dispatch({ arguments: ["--local-handoff", `--candidate=${base}`], argvZeroTool: false })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].effectivePath.includes("/.codex/tmp/arg0/"), false)
  assert.equal(calls[0].identity.environmentDigests.PATH, createHash("sha256").update(calls[0].childPath).digest("hex"))
  assert.equal(calls[0].childPath, calls[0].effectivePath)
})

test("full quality entry refuses a shim-supplied nested Java before any child boundary", () => {
  const { calls, result } = dispatch({ arguments: ["--local-handoff", `--candidate=${base}`], argvZeroTool: "java" })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /declared tool resolution changes: java/u)
  assert.deepEqual(calls, [])
})

/**
 * Scenario mapping for the admission PATH fixture:
 * - PATH-selected Java plus a Codex shim refuses before any child boundary;
 * - JAVA_HOME-pinned Java ignores an unrelated PATH shim and admits normally.
 * These are test-only environment controls; Dalph's production tool inventory
 * and Java launch behavior remain unchanged.
 */
test("full quality entry accepts an unrelated PATH Java shim when JAVA_HOME pins Java", () => {
  const { calls, result } = dispatch({
    arguments: ["--local-handoff", `--candidate=${base}`],
    argvZeroTool: "java",
    pinJavaHome: true
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].effectivePath.includes("/.codex/tmp/arg0/"), false)
  assert.equal(calls[0].childPath, calls[0].effectivePath)
})

test("quality admission wrapper stabilizes PATH before its custody child", () => {
  const { calls, custodyRuns, result } = dispatch({
    arguments: ["--local-handoff", "--candidate=HEAD^"],
    argvZeroTool: false,
    throughWrapper: true
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(custodyRuns, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].effectivePath.includes("/.codex/tmp/arg0/"), false)
  assert.equal(calls[0].childPath, calls[0].effectivePath)
})

for (const tool of ["java", "node", "pnpm"]) {
  test(`quality admission wrapper refuses shim-supplied ${tool} before custody or executor launch`, () => {
    const { calls, custodyRuns, result } = dispatch({
      arguments: ["--local-handoff", "--candidate=HEAD^"],
      argvZeroTool: tool,
      throughWrapper: true
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, new RegExp(`declared tool resolution changes: ${tool}`))
    assert.equal(custodyRuns, 0)
    assert.deepEqual(calls, [])
  })
}

test("quality purposes reject omitted duplicate conflicting and unsupported bypass arguments", () => {
  for (const args of [
    [],
    ["--local-handoff", "--local-handoff"],
    ["--local-handoff", "--hosted-quality"],
    ["--local-handoff", "--without-quint"],
    ["--local-handoff", "--candidate=a", "--candidate=b"],
    ["--local-handoff", "--resume=a", "--resume=b"],
    ["--hosted-quality", `--resume=${resume}`]
  ])
    assert.throws(() => parseQualityCommandArguments(args))
})

test("quality parser retains candidate base and resume identity for local handoff", () => {
  assert.deepEqual(parseQualityCommandArguments(["--local-handoff", `--candidate=${base}`, `--resume=${resume}`]), {
    purpose: "local-handoff",
    candidateArgument: `--candidate=${base}`,
    resumeRunId: resume
  })
})

test("local handoff dispatch cannot be changed by CI or lifecycle metadata", () => {
  for (const environment of [
    {},
    { CI: "true" },
    { CI: "", npm_lifecycle_event: "check:ci:quality" },
    { npm_lifecycle_event: "unrelated-command" }
  ]) {
    const { calls, result } = dispatch({ arguments: ["--local-handoff", `--candidate=${base}`], environment })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].boundary, "local-handoff")
    assert.equal(calls[0].options.logicalInvocation.baseSha, base)
    assert.ok(!calls[0].options.stageManifest.some((stage) => stage.id === "model-based-tests"))
    assert.ok(calls[0].options.stageManifest.some((stage) => stage.id === "coverage"))
  }
})

test("resumed local handoff retains candidate base and invokes required integration boundary", () => {
  const { calls, result } = dispatch({
    arguments: ["--local-handoff", `--candidate=${base}`, `--resume=${resume}`],
    environment: { CI: "true", npm_lifecycle_event: "check:ci:quality" }
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(calls[0].boundary, "local-handoff")
  assert.equal(calls[0].options.resumeRunId, resume)
  assert.equal(calls[0].options.logicalInvocation.baseSha, base)
  assert.ok(!calls[0].options.logicalInvocation.commandArguments.some((argument) => argument.startsWith("--resume=")))
})

test("required local formal failure propagates through the actual quality command", () => {
  const { calls, result } = dispatch({ arguments: ["--local-handoff", `--candidate=${base}`], failLocal: true })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /required formal verification failed/u)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].boundary, "local-handoff")
})

test("unavailable local formal classification fails before the resumable quality boundary", () => {
  const { calls, result } = dispatch({
    arguments: ["--local-handoff", `--candidate=${base}`],
    classificationFailure: true
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Unable to classify local formal relevance: controlled unavailable projection/u)
  assert.deepEqual(calls, [])
})

test("hosted quality dispatch excludes local formal integration and MBT regardless lifecycle", () => {
  const { calls, result } = dispatch({
    arguments: ["--hosted-quality"],
    environment: { CI: "true", DALPH_COVERAGE_BASE_SHA: base, npm_lifecycle_event: "check:all" }
  })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(calls.length > 0)
  assert.ok(calls.every((call) => call.boundary === "hosted-stage"))
  const commands = calls.map((call) => call.command.args[2])
  assert.ok(commands.includes("test:coverage"))
  assert.ok(!commands.includes("test:mbt"))
  assert.ok(!commands.includes("check:quint"))
  assert.ok(!commands.includes("check:ci:formal"))
})

test("local commands without inherited admission refuse dispatch despite CI metadata", () => {
  const { calls, result } = dispatch({
    admitted: false,
    arguments: ["--local-handoff", `--candidate=${base}`],
    environment: { CI: "true", npm_lifecycle_event: "check:ci:quality" }
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /admitted pnpm check:all entry point/u)
  assert.deepEqual(calls, [])
})

test("unacknowledged local full gate retains the frozen candidate refusal", () => {
  const { calls, result } = dispatch({ arguments: ["--local-handoff"] })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /runs once per frozen candidate/u)
  assert.deepEqual(calls, [])
})

test("local public omission flag is rejected before any dispatch", () => {
  const { calls, result } = dispatch({
    arguments: ["--local-handoff", `--candidate=${base}`, "--without-quint"],
    environment: { CI: "true" }
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Unsupported quality argument: --without-quint/u)
  assert.deepEqual(calls, [])
})

test("candidate base equal to HEAD cannot be accepted by route metadata", () => {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim()
  const { calls, result } = dispatch({
    arguments: ["--local-handoff", `--candidate=${head}`],
    environment: { CI: "true" }
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /earlier commit is required/u)
  assert.deepEqual(calls, [])
})

test("full gate acknowledgement retains local integration when candidate uses hosted base", () => {
  const { calls, result } = dispatch({
    arguments: ["--local-handoff"],
    environment: { DALPH_FULL_GATE: "1", DALPH_COVERAGE_BASE_SHA: base, npm_lifecycle_event: "check:ci:quality" }
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(calls[0].boundary, "local-handoff")
  assert.equal(calls[0].options.logicalInvocation.baseSha, base)
})
