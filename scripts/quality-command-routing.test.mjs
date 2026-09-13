import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
const dispatch = ({ admitted = true, arguments: args, environment = {}, failLocal = false }) => {
  const root = mkdtempSync(join(tmpdir(), "dalph-quality-routing-"))
  const log = join(root, "dispatch.jsonl")
  const append = `import {appendFileSync} from 'node:fs';const record=value=>appendFileSync(${JSON.stringify(log)},JSON.stringify(value)+'\\n');\n`
  try {
    for (const file of ["run-quality-gate.mjs", "quality-command-policy.mjs", "quality-output-budget.mjs"])
      copyFileSync(new URL(file, import.meta.url), join(root, file))
    writeFileSync(
      join(root, "gate-quality-run.mjs"),
      `${append}export const executeResumableQualityGate=async options=>{record({boundary:'local-handoff',options});${failLocal ? "throw Error('controlled required formal verification failed');" : "return {successfulOutputLines:0};"}};`
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
    const clean = withoutInheritedCustody(process.env)
    for (const key of [
      "CI",
      "DALPH_FULL_GATE",
      "DALPH_GATE_GIT_HISTORY",
      "DALPH_COVERAGE_BASE_SHA",
      "npm_lifecycle_event"
    ])
      delete clean[key]
    const result = spawnSync(process.execPath, [join(root, "run-quality-gate.mjs"), ...args], {
      cwd: repository,
      env: { ...clean, npm_execpath: "/controlled/pnpm.cjs", ...environment },
      encoding: "utf8",
      timeout: 10000
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
    return { calls, result }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
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
