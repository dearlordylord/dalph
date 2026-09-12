import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, test } from "node:test"
import {
  coverageArtifactFreshness,
  coverageExplanationFromFiles,
  explainCoverageArtifact,
  validateCoverageArtifact
} from "./explain-coverage.mjs"

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const loc = (line) => ({ start: { line, column: 0 }, end: { line, column: null } })
const file = (path, covered = false) => ({
  path,
  statementMap: { 0: loc(1), 1: loc(2) },
  s: { 0: 1, 1: covered ? 1 : 0 },
  fnMap: { 0: { name: "work", loc: loc(2) } },
  f: { 0: covered ? 1 : 0 },
  branchMap: { 0: { loc: loc(2), locations: [loc(2), loc(3)] } },
  b: { 0: [1, covered ? 1 : 0] }
})
const production = "packages/dalph/src/work.ts"
const evaluation = "packages/dalph/src/cassettes/work.ts"
const explain = (coverage, baselineCoverage) =>
  explainCoverageArtifact({
    coverage,
    baselineCoverage,
    repositoryRoot: "/repo",
    baseSha: "a".repeat(40),
    changedFiles: [production],
    changedLines: new Map([[production, new Set([2])]])
  })

test("maintainer sees actual uncovered locations, line counts and unchanged independent floors", () => {
  const result = explain({ [production]: file(production), [evaluation]: file(evaluation, true) })
  assert.equal(result.brackets.production.total.statements.total, 2)
  assert.equal(result.brackets.production.total.statements.covered, 1)
  assert.equal(result.brackets["maintained-evaluation"].total.statements.covered, 2)
  assert.deepEqual(
    result.uncovered.map(({ arm, id, line, location, metric }) => ({ metric, line, id, arm, location })),
    [
      { metric: "lines", line: 2, id: undefined, arm: undefined, location: undefined },
      { metric: "statements", line: undefined, id: "1", arm: undefined, location: loc(2) },
      { metric: "functions", line: undefined, id: "0", arm: undefined, location: loc(2) },
      { metric: "branches", line: undefined, id: "0", arm: 1, location: loc(3) }
    ]
  )
  assert.ok(result.thresholdFailures.some((failure) => failure.includes("expected at least 99%")))
  assert.ok(result.thresholdFailures.every((failure) => !failure.startsWith("maintained-evaluation")))
  assert.deepEqual(result.changed.production.uncoveredLines, [{ path: production, line: 2 }])
  assert.equal(result.freshness.status, "unproven")
  assert.equal(result.denominatorComparison.status, "unavailable")
})

test("supplied baseline reports actual denominator difference without inferring newly executable behavior", () => {
  const baseline = file(production, true)
  delete baseline.statementMap["1"]
  delete baseline.s["1"]
  const result = explain({ [production]: file(production) }, { [production]: baseline })
  assert.deepEqual(result.denominatorComparison.brackets.production.statements, { current: 2, baseline: 1, delta: 1 })
})

for (const mutation of [
  (value) => {
    delete value.s["1"]
  },
  (value) => {
    delete value.statementMap
  },
  (value) => {
    delete value.fnMap
  },
  (value) => {
    value.f["0"] = -1
  },
  (value) => {
    value.b["0"].pop()
  },
  (value) => {
    value.branchMap["0"].locations[1].start.line = 0
  },
  (value) => {
    value.l = { 2: -1 }
  }
]) {
  test(`maintainer receives incomplete artifact failure for ${mutation.toString()}`, () => {
    const value = file(production)
    mutation(value)
    assert.throws(() => explain({ [production]: value }))
  })
}

test("missing changed coverage entry is explicit and cannot look covered", () => {
  const result = explain({ [evaluation]: file(evaluation, true) })
  assert.equal(result.incomplete[0].path, production)
  assert.equal(result.changed.production.coveredLines, 0)
  assert.equal(result.changed.production.uncoveredLines[0].reason, "coverage entry missing")
})

test("outside-worktree paths and duplicate path aliases cannot become current source evidence", () => {
  assert.throws(
    () => validateCoverageArtifact({ wrong: file("/other/packages/dalph/src/work.ts") }, "/repo"),
    /outside/u
  )
  assert.throws(() => validateCoverageArtifact({ one: file(production), two: file(production) }, "/repo"), /Duplicate/u)
})

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-coverage-explain-"))
  roots.push(root)
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
  git("init", "-q", "-b", "master")
  git("config", "user.email", "coverage@example.test")
  git("config", "user.name", "Coverage Fixture")
  const put = (path, contents) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), contents)
  }
  put(production, "export const first = 1\nexport const second = 2\n")
  git("add", ".")
  git("commit", "-qm", "base")
  const baseSha = git("rev-parse", "HEAD")
  put(production, "export const first = 1\nexport const second = 3\n")
  put(".gitignore", "coverage/\n")
  put("coverage/coverage-final.json", JSON.stringify({ [production]: file(production) }))
  return { root, baseSha, put, git }
}

test("actual raw-artifact CLI explains source changes without ever launching pnpm or a test runner", () => {
  const f = fixture()
  const trap = join(f.root, "trap")
  const counter = join(f.root, "test-launches")
  mkdirSync(trap)
  for (const tool of ["pnpm", "vitest", "npm"]) {
    writeFileSync(join(trap, tool), `#!/bin/sh\nprintf launched >> '${counter}'\nexit 99\n`, { mode: 0o755 })
  }
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./explain-coverage.mjs", import.meta.url)), `--candidate=${f.baseSha}`],
    {
      cwd: f.root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${trap}:${process.env.PATH}`, npm_execpath: join(trap, "pnpm") }
    }
  )
  assert.equal(result.status, 1, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.freshness.status, "unproven")
  assert.ok(output.changedFiles.includes(production))
  assert.deepEqual(output.changed.production.uncoveredLines, [{ path: production, line: 2 }])
  assert.equal(existsSync(counter), false)
})

test("untracked source receives exact changed-line evidence and unusual paths remain visible", () => {
  const f = fixture()
  const path = "packages/dalph/src/new-source.ts"
  f.put(path, "export const newSource = 1\n")
  const unusualPath = "packages/dalph/src/new\nsource.ts"
  f.put(unusualPath, "export const other = 1\n")
  const result = coverageExplanationFromFiles({ baseSha: f.baseSha, cwd: f.root })
  assert.ok(result.changedFiles.includes(path))
  assert.ok(result.changedFiles.includes(unusualPath))
  assert.ok(result.pathsOutsideCoveragePolicy.includes(unusualPath))
  assert.ok(
    result.changed.production.uncoveredLines.some(
      (entry) => entry.path === path && entry.reason === "coverage entry missing"
    )
  )
})

test("invalid base, malformed JSON and absent artifact are diagnosed without model or test execution", () => {
  const f = fixture()
  assert.throws(() => coverageExplanationFromFiles({ baseSha: "HEAD", cwd: f.root }), /exact/u)
  assert.throws(
    () => coverageExplanationFromFiles({ baseSha: f.baseSha, coveragePath: "absent.json", cwd: f.root }),
    /ENOENT/u
  )
  f.put("coverage/coverage-final.json", "{")
  assert.throws(() => coverageExplanationFromFiles({ baseSha: f.baseSha, cwd: f.root }), SyntaxError)
})

test("an unchanged current source missing from the artifact is explicitly incomplete", () => {
  const f = fixture()
  const extra = "packages/dalph/src/unchanged.ts"
  f.put(extra, "export const value = 1\n")
  f.git("add", extra)
  f.git("commit", "-qm", "extra source")
  const result = coverageExplanationFromFiles({ baseSha: f.git("rev-parse", "HEAD"), cwd: f.root })
  assert.ok(result.incomplete.some((entry) => entry.path === extra))
})

test("incomplete optional line keys cannot hide an uncovered executable line", () => {
  const value = file(production)
  value.l = { 1: 1 }
  assert.throws(() => explain({ [production]: value }), /executable statement-start lines/u)
})

test("Git presentation settings cannot erase changed-line attribution", () => {
  const f = fixture()
  f.git("config", "diff.noprefix", "true")
  f.git("config", "color.ui", "always")
  const result = coverageExplanationFromFiles({ baseSha: f.baseSha, cwd: f.root })
  assert.deepEqual(result.changed.production.uncoveredLines, [{ path: production, line: 2 }])
  assert.equal(result.changed.production.executableLines, 1)
})

test("complete optional line keys cannot contradict uncovered statement-start hits", () => {
  const value = file(production)
  value.l = { 1: 1, 2: 1 }
  assert.throws(() => explain({ [production]: value }), /disagree/u)
})

test("valid complete optional line evidence preserves the uncovered line", () => {
  const value = file(production)
  value.l = { 1: 1, 2: 0 }
  const result = explain({ [production]: value })
  assert.equal(result.brackets.production.total.lines.covered, 1)
  assert.equal(result.brackets.production.total.lines.total, 2)
  assert.ok(result.uncovered.some((entry) => entry.metric === "lines" && entry.line === 2))
})

test("Istanbul implicit-else arm with no range is counted and reported without fabricating its location", () => {
  const value = file(production)
  value.branchMap["0"].type = "if"
  value.branchMap["0"].locations[1] = { start: {}, end: {} }
  const result = explain({ [production]: value })
  const arm = result.uncovered.find((entry) => entry.metric === "branches")
  assert.equal(arm.arm, 1)
  assert.equal(arm.location, undefined)
  assert.match(arm.locationUnavailable, /no source range/u)
  assert.deepEqual(arm.containingBranchLocation, loc(2))
  assert.equal(result.brackets.production.total.branches.total, 2)
  assert.equal(result.brackets.production.total.branches.covered, 1)
})

test("negative branch counts from a historical V8 report are rejected as invalid evidence", () => {
  const value = file(production)
  value.b["0"][1] = -363
  assert.throws(() => explain({ [production]: value }), /branch locations\/counts/u)
})

const provenance = () => {
  const artifactBytes = Buffer.from("fixture artifact")
  const artifactPath = "/repo/.scratch/quality-gates/run/coverage/coverage-final.json"
  const artifact = {
    path: artifactPath,
    sha256: createHash("sha256").update(artifactBytes).digest("hex"),
    bytes: artifactBytes.length
  }
  const evidence = {
    version: 1,
    runId: "recorded-run",
    worktree: "/repo",
    baseSha: "a".repeat(40),
    sourceInputDigest: "source-digest",
    coverage: { final: artifact },
    stages: [{ coverage: { final: artifact }, outcome: "failed", exitCode: 1, groupAbsent: true }],
    registration: "closed",
    custody: "stopped",
    terminal: { sourceUnchanged: true },
    qualification: "UNPROVEN"
  }
  return {
    artifactBytes,
    artifactPath,
    baseSha: evidence.baseSha,
    currentSourceDigest: "source-digest",
    evidence,
    repositoryRoot: "/repo"
  }
}

test("completed failed coverage stage can establish artifact freshness without inventing gate qualification", () => {
  const result = coverageArtifactFreshness(provenance())
  assert.equal(result.status, "fresh")
  assert.equal(result.stageOutcome, "failed")
  assert.equal(result.gateQualification, "UNPROVEN")
})

for (const [name, mutation, status] of [
  [
    "source changed",
    (input) => {
      input.currentSourceDigest = "changed"
    },
    "stale"
  ],
  [
    "wrong base",
    (input) => {
      input.baseSha = "b".repeat(40)
    },
    "stale"
  ],
  [
    "wrong worktree",
    (input) => {
      input.repositoryRoot = "/other"
    },
    "stale"
  ],
  [
    "wrong version",
    (input) => {
      input.evidence.version = 2
    },
    "unproven"
  ],
  [
    "wrong hash",
    (input) => {
      input.artifactBytes = Buffer.from("changed bytes")
    },
    "stale"
  ],
  [
    "wrong path",
    (input) => {
      input.artifactPath = "/other/final.json"
    },
    "stale"
  ],
  [
    "missing receipt",
    (input) => {
      input.evidence.stages = [{ outcome: "UNPROVEN" }]
    },
    "unproven"
  ],
  [
    "unfinished stage",
    (input) => {
      input.evidence.stages[0].groupAbsent = false
    },
    "unproven"
  ],
  [
    "missing terminal",
    (input) => {
      delete input.evidence.terminal
    },
    "unproven"
  ],
  [
    "run still open",
    (input) => {
      input.evidence.registration = "open"
    },
    "unproven"
  ],
  [
    "source changed during run",
    (input) => {
      input.evidence.terminal.sourceUnchanged = false
    },
    "unproven"
  ]
]) {
  test(`${String(name)} cannot establish artifact freshness`, () => {
    const input = provenance()
    mutation(input)
    assert.equal(coverageArtifactFreshness(input).status, status)
  })
}

const capturedFixture = (exit = 1, missingSource = false) => {
  const f = fixture()
  f.put(".gitignore", "coverage/\n.scratch/\n")
  f.git("commit", "--allow-empty", "-qm", "candidate")
  if (missingSource) f.put("packages/dalph/src/not-in-report.ts", "export const missing = 1\n")
  const writer = `const fs=require('node:fs'),path=require('node:path');fs.mkdirSync(process.env.DALPH_COVERAGE_DIRECTORY,{recursive:true});fs.writeFileSync(path.join(process.env.DALPH_COVERAGE_DIRECTORY,'coverage-final.json'),${JSON.stringify(JSON.stringify({ [production]: file(production) }))});process.exit(${exit})`
  const wrapper = fileURLToPath(new URL("./with-gate-slot.mjs", import.meta.url))
  const environment = { ...process.env, DALPH_COVERAGE_BASE_SHA: f.baseSha }
  for (const key of [
    "DALPH_GATE_RUN_DIRECTORY",
    "DALPH_GATE_RUN_ID",
    "DALPH_GATE_OBLIGATION",
    "DALPH_GATE_SLOT",
    "DALPH_GATE_GIT_HISTORY",
    "npm_execpath",
    "DALPH_QUALIFICATION_ENV_CAPTURE",
    "DALPH_RUN_REAL_CODEX_QUALIFICATION"
  ])
    delete environment[key]
  const result = spawnSync(process.execPath, [wrapper, "--", process.execPath, "-e", writer, "coverage:body"], {
    cwd: f.root,
    env: environment,
    encoding: "utf8"
  })
  assert.equal(result.status, exit, result.stderr)
  const runs = join(f.root, ".git", "dalph-gates", "runs")
  const runId = readdirSync(runs)[0]
  return { ...f, runId, runDirectory: join(runs, runId) }
}

test("actual captured failed-stage artifact is fresh diagnostic evidence without a test rerun", () => {
  const f = capturedFixture()
  const result = coverageExplanationFromFiles({ baseSha: f.baseSha, runId: f.runId, cwd: f.root })
  assert.equal(result.freshness.status, "fresh", JSON.stringify(result.freshness))
  assert.equal(result.freshness.gateQualification, "UNPROVEN")
  assert.ok(result.thresholdFailures.some((failure) => failure.includes("99%")))
})

test("actual missing or wrong-version receipt cannot make captured artifact fresh", () => {
  const f = capturedFixture()
  const receiptDirectory = join(f.runDirectory, "receipts")
  const receiptPath = join(receiptDirectory, readdirSync(receiptDirectory)[0])
  const original = JSON.parse(readFileSync(receiptPath, "utf8"))
  writeFileSync(receiptPath, JSON.stringify({ ...original, version: 2 }))
  assert.equal(
    coverageExplanationFromFiles({ baseSha: f.baseSha, runId: f.runId, cwd: f.root }).freshness.status,
    "unproven"
  )
  rmSync(receiptPath)
  assert.equal(
    coverageExplanationFromFiles({ baseSha: f.baseSha, runId: f.runId, cwd: f.root }).freshness.status,
    "unproven"
  )
})

test("actual source or artifact edits invalidate captured artifact freshness", () => {
  const f = capturedFixture()
  f.put(production, "export const edited = 1\n")
  assert.equal(
    coverageExplanationFromFiles({ baseSha: f.baseSha, runId: f.runId, cwd: f.root }).freshness.status,
    "stale"
  )
  f.put(production, "export const first = 1\nexport const second = 3\n")
  f.put(
    `.scratch/quality-gates/${f.runId}/coverage/coverage-final.json`,
    JSON.stringify({ [production]: file(production, true) })
  )
  assert.equal(
    coverageExplanationFromFiles({ baseSha: f.baseSha, runId: f.runId, cwd: f.root }).freshness.status,
    "stale"
  )
})

test("captured but incomplete coverage cannot be reported fresh", () => {
  const f = capturedFixture(1, true)
  const result = coverageExplanationFromFiles({ baseSha: f.baseSha, runId: f.runId, cwd: f.root })
  assert.equal(result.freshness.status, "unproven")
  assert.ok(result.incomplete.some((entry) => entry.path.endsWith("not-in-report.ts")))
})

test("actual provenance CLI diagnoses a failed coverage stage with zero pnpm or test-runner launches", () => {
  const f = capturedFixture()
  const trap = join(f.root, ".scratch", "trap")
  const counter = join(trap, "launches")
  mkdirSync(trap)
  for (const tool of ["pnpm", "vitest", "npm"]) {
    writeFileSync(join(trap, tool), `#!/bin/sh\nprintf launched >> '${counter}'\nexit 99\n`, { mode: 0o755 })
  }
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./explain-coverage.mjs", import.meta.url)), `--candidate=${f.baseSha}`, `--run=${f.runId}`],
    {
      cwd: f.root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${trap}:${process.env.PATH}`, npm_execpath: join(trap, "pnpm") }
    }
  )
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.freshness.status, "fresh")
  assert.equal(output.freshness.gateQualification, "UNPROVEN")
  assert.ok(output.thresholdFailures.length > 0)
  assert.equal(existsSync(counter), false)
})

test("relative coverage aliases cannot inflate report denominators", () => {
  const alias = "packages/dalph/src/./work.ts"
  assert.throws(
    () => validateCoverageArtifact({ original: file(production), alias: file(alias) }, "/repo"),
    /Duplicate coverage path/u
  )
})

test("relative coverage traversal is resolved before repository containment", () => {
  assert.throws(
    () => validateCoverageArtifact({ traversal: file("packages/../../outside.ts") }, "/repo"),
    /outside the repository/u
  )
})

const resumedCoverageFixture = () => {
  const f = fixture()
  f.put(".gitignore", "coverage/\n.scratch/\n")
  f.git("commit", "--allow-empty", "-qm", "candidate")
  const counter = join(f.root, ".scratch", "counters")
  const release = join(f.root, ".scratch", "release")
  const script = join(f.root, ".scratch", "quality.mjs")
  const coverageSource = `import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(counter)},'coverage\\n');fs.mkdirSync(process.env.DALPH_COVERAGE_DIRECTORY,{recursive:true});fs.writeFileSync(process.env.DALPH_COVERAGE_DIRECTORY+'/coverage-final.json',${JSON.stringify(JSON.stringify({ [production]: file(production) }))});fs.writeFileSync(process.env.DALPH_COVERAGE_DIRECTORY+'/coverage-summary.json','{}');`
  const lateSource = `import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(counter)},'late\\n');if(!fs.existsSync(${JSON.stringify(release)}))process.exit(24);`
  f.put(
    ".scratch/quality.mjs",
    `import {executeResumableQualityGate} from ${JSON.stringify(new URL("./gate-quality-run.mjs", import.meta.url).href)};import {runBoundedCommand} from ${JSON.stringify(new URL("./run-bounded-command.mjs", import.meta.url).href)};
const sources=${JSON.stringify([coverageSource, lateSource])};
const manifest=sources.map((source,ordinal)=>({id:['coverage','late'][ordinal],name:'fixture '+ordinal,boundary:'qualification',args:[source],timeout:10000,artifactRoots:ordinal===0?['@coverage']:[],execution:{executable:process.execPath,args:['--input-type=module','-e',source],cwd:process.cwd(),name:'fixture '+ordinal,timeoutMilliseconds:10000,acceptedExitCodes:[0],relayParentSignals:false,terminationGraceMilliseconds:5000,processGroupAbsenceTimeoutMilliseconds:2000}}));
const logicalInvocation={mode:'check:all',commandArguments:[process.execPath,process.argv[1]],baseSha:${JSON.stringify(f.baseSha)},stageManifest:manifest,toolExecutables:[]};
await executeResumableQualityGate({stageManifest:manifest,logicalInvocation,resumeRunId:process.argv[2]?.slice('--resume='.length),runStage:stage=>runBoundedCommand(stage.execution)});`
  )
  const wrapper = fileURLToPath(new URL("./with-gate-slot.mjs", import.meta.url))
  const environment = { ...process.env, DALPH_COVERAGE_BASE_SHA: f.baseSha }
  for (const key of [
    "DALPH_GATE_RUN_DIRECTORY",
    "DALPH_GATE_RUN_ID",
    "DALPH_GATE_OBLIGATION",
    "DALPH_GATE_SLOT",
    "DALPH_GATE_GIT_HISTORY",
    "npm_execpath",
    "DALPH_QUALIFICATION_ENV_CAPTURE",
    "DALPH_RUN_REAL_CODEX_QUALIFICATION"
  ])
    delete environment[key]
  const launch = (resumeId) =>
    spawnSync(
      process.execPath,
      [wrapper, "--", process.execPath, script, ...(resumeId === undefined ? [] : [`--resume=${resumeId}`])],
      { cwd: f.root, env: environment, encoding: "utf8", timeout: 20000 }
    )
  const first = launch()
  assert.equal(first.status, 1, first.stderr)
  const runRoot = join(f.root, ".git", "dalph-gates", "runs")
  const originalRunId = readdirSync(runRoot)[0]
  writeFileSync(release, "released")
  const resumed = launch(originalRunId)
  assert.equal(resumed.status, 0, resumed.stderr)
  const runId = readdirSync(runRoot).find((id) => id !== originalRunId)
  return {
    ...f,
    runId,
    originalRunId,
    runDirectory: join(runRoot, runId),
    originalDirectory: join(runRoot, originalRunId),
    counter
  }
}

test("actual resumed copied coverage is fresh through explicit original provenance without an invented execution", () => {
  const f = resumedCoverageFixture()
  const result = coverageExplanationFromFiles({ baseSha: f.baseSha, runId: f.runId, cwd: f.root })
  assert.equal(result.freshness.status, "fresh", JSON.stringify(result.freshness))
  assert.equal(result.freshness.provenance.kind, "reused")
  assert.equal(result.freshness.provenance.originRunId, f.originalRunId)
  const beforeExplanation = readFileSync(f.counter, "utf8")
  const cli = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./explain-coverage.mjs", import.meta.url)), `--candidate=${f.baseSha}`, `--run=${f.runId}`],
    { cwd: f.root, encoding: "utf8" }
  )
  assert.equal(cli.status, 0, cli.stderr)
  assert.equal(JSON.parse(cli.stdout).freshness.provenance.kind, "reused")
  assert.equal(readFileSync(f.counter, "utf8"), beforeExplanation, "explanation launches no coverage or suffix stage")
  assert.equal(existsSync(join(f.runDirectory, "quality-stages", "0.json")), false)
  assert.deepEqual(readFileSync(f.counter, "utf8").trim().split("\n"), ["coverage", "late", "late"])
})

test("missing original receipt, changed original artifact and corrupt composite refuse reused coverage freshness", () => {
  const f = resumedCoverageFixture()
  const input = { baseSha: f.baseSha, runId: f.runId, cwd: f.root }
  const originalStage = JSON.parse(readFileSync(join(f.originalDirectory, "quality-stages", "0.json"), "utf8"))
  const receipt = join(f.originalDirectory, "receipts", `${originalStage.obligationId}.json`)
  const receiptBytes = readFileSync(receipt)
  rmSync(receipt)
  assert.equal(coverageExplanationFromFiles(input).freshness.status, "unproven")
  writeFileSync(receipt, "{")
  assert.equal(coverageExplanationFromFiles(input).freshness.status, "unproven")
  writeFileSync(receipt, receiptBytes)
  const originFinal = join(f.root, ".scratch", "quality-gates", f.originalRunId, "coverage", "coverage-final.json")
  const artifactBytes = readFileSync(originFinal)
  writeFileSync(originFinal, JSON.stringify({ [production]: file(production, true) }))
  assert.notEqual(coverageExplanationFromFiles(input).freshness.status, "fresh")
  rmSync(originFinal)
  assert.equal(coverageExplanationFromFiles(input).freshness.status, "unproven")
  writeFileSync(originFinal, artifactBytes)
  const composite = join(f.runDirectory, "composite.json")
  const compositeBytes = readFileSync(composite)
  writeFileSync(composite, "{")
  assert.equal(coverageExplanationFromFiles(input).freshness.status, "unproven")
  writeFileSync(composite, compositeBytes)
  rmSync(composite)
  assert.equal(coverageExplanationFromFiles(input).freshness.status, "unproven")
})
