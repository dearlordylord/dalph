import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const summaryCommand = new URL("./verify-coverage-summary.mjs", import.meta.url)
const changedCommand = new URL("./verify-changed-coverage.mjs", import.meta.url)
const invoke = (script, args, cwd) =>
  spawnSync(process.execPath, [script.pathname, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, DALPH_COVERAGE_BASE_SHA: "HEAD^" }
  })

void test("coverage commands report uncovered production without vetoing delivery", () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-coverage-advisory-"))
  try {
    const git = (...args) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
      assert.equal(result.status, 0, result.stderr)
    }
    git("init", "--quiet")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "base")
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "candidate"
    )
    const summary = join(root, "coverage-summary.json")
    const final = join(root, "coverage-final.json")
    writeFileSync(
      summary,
      JSON.stringify({
        total: Object.fromEntries(
          ["statements", "branches", "functions", "lines"].map((metric) => [metric, { pct: 0 }])
        )
      })
    )
    writeFileSync(
      final,
      JSON.stringify({
        "src/example.ts": {
          s: { 0: 0 },
          f: { 0: 0 },
          b: { 0: [0] },
          statementMap: { 0: { start: { line: 1 }, end: { line: 1 } } }
        }
      })
    )
    const aggregate = invoke(summaryCommand, [summary, final], root)
    assert.equal(aggregate.status, 0, aggregate.stderr)
    assert.match(aggregate.stderr, /Coverage advisory/)
    assert.match(aggregate.stderr, /production statements: expected at least 95%, observed 0/)
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "src/example.ts"), "export const uncovered = true\n")
    const changed = invoke(changedCommand, [final], root)
    assert.equal(changed.status, 0, changed.stderr)
    assert.match(changed.stdout, /Changed production lines: 0.00%/)
    assert.match(changed.stderr, /src\/example.ts:1/)
    writeFileSync(final, "invalid JSON")
    assert.notEqual(invoke(summaryCommand, [summary, final], root).status, 0)
    assert.notEqual(invoke(changedCommand, [final], root).status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("Vitest keeps coverage reporting without a numeric veto", () => {
  const configuration = readFileSync(new URL("../vitest.config.ts", import.meta.url), "utf8")
  assert.doesNotMatch(configuration, /thresholds:/)
  assert.match(configuration, /provider: "v8"/)
})
