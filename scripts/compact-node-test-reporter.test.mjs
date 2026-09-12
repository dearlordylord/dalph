import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const reporter = fileURLToPath(new URL("./compact-node-test-reporter.mjs", import.meta.url))

function runFixture(body, selectedReporter = reporter) {
  const directory = mkdtempSync(join(tmpdir(), "dalph-node-reporter-"))
  try {
    const fixture = join(directory, "fixture.test.mjs")
    writeFileSync(
      fixture,
      `import { test, describe } from "node:test"\nimport assert from "node:assert/strict"\n${body}`
    )
    const environment = { ...process.env, FORCE_COLOR: "0", NODE_DISABLE_COLORS: "1" }
    // Launch a fresh runner rather than inheriting the enclosing test-file worker context.
    delete environment.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ["--test", `--test-reporter=${selectedReporter}`, fixture], {
      encoding: "utf8",
      timeout: 10_000,
      env: environment
    })
    assert.equal(result.error, undefined)
    assert.equal(result.signal, null)
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function totals(output) {
  return output.split("\n").filter((line) => /ℹ (tests|suites|pass|fail|cancelled|skipped|todo) \d+$/.test(line))
}

test("omits routine passing names while preserving native totals and test stdout/stderr", () => {
  const body = `describe("passing suite", () => {
    for (let index = 0; index < 30; index++) test("routine pass " + index, () => assert.equal(2 + 2, 4))
    test("output pass", (context) => {
      console.log("fixture stdout"); console.error("fixture stderr"); context.diagnostic("fixture diagnostic")
    })
  })`
  const compact = runFixture(body)
  const native = runFixture(body, "spec")
  assert.equal(compact.status, 0)
  assert.equal(native.status, 0)
  assert.deepEqual(totals(compact.output), totals(native.output))
  assert.match(compact.output, /ℹ tests 31/)
  assert.match(compact.output, /fixture stdout/)
  assert.match(compact.output, /fixture stderr/)
  assert.match(compact.output, /fixture diagnostic/)
  assert.doesNotMatch(compact.output, /routine pass|passing suite|output pass/)
  assert.ok(native.output.split("\n").length - compact.output.split("\n").length >= 31)
})

test("retains skipped and todo names, reasons and native counts", () => {
  const body = `test("skipped fixture", { skip: "unavailable fixture boundary" }, () => { throw Error("must not run") })
    test("passing todo fixture", { todo: "passing todo reason" }, () => {})
    test("todo fixture", { todo: "planned fixture boundary" }, () => assert.fail("todo assertion detail"))`
  const compact = runFixture(body)
  const native = runFixture(body, "spec")
  assert.equal(compact.status, native.status)
  assert.equal(compact.status, 0)
  assert.deepEqual(totals(compact.output), totals(native.output))
  for (const text of [
    "skipped fixture",
    "unavailable fixture boundary",
    "passing todo fixture",
    "passing todo reason",
    "todo fixture",
    "planned fixture boundary",
    "todo assertion detail"
  ]) {
    assert.ok(compact.output.includes(text), text)
  }
  assert.match(compact.output, /ℹ skipped 1/)
  assert.match(compact.output, /ℹ todo 2/)
})

test("keeps genuine assertion failures, nested context, locations and the native failing-test appendix", () => {
  const body = `describe("failed suite", () => {
    test("successful sibling", () => {})
    test("failed fixture", () => assert.equal("observed boundary", "required boundary", "boundary mismatch"))
  })`
  const compact = runFixture(body)
  const native = runFixture(body, "spec")
  assert.equal(compact.status, 1)
  assert.equal(compact.status, native.status)
  assert.deepEqual(totals(compact.output), totals(native.output))
  for (const text of [
    "failed suite",
    "failed fixture",
    "boundary mismatch",
    "observed boundary",
    "required boundary",
    "ERR_ASSERTION",
    "failing tests:",
    "test at "
  ]) {
    assert.ok(compact.output.includes(text), text)
  }
  assert.doesNotMatch(compact.output, /successful sibling/)
})

test("retains cancellation diagnostics and a genuine nonzero process exit", () => {
  const body = `const controller = new AbortController()
  test("cancelled fixture", { signal: controller.signal }, () => {
    controller.abort(new Error("fixture cancellation boundary"))
    return new Promise(() => {})
  })`
  const compact = runFixture(body)
  const native = runFixture(body, "spec")
  assert.equal(compact.status, 1)
  assert.equal(compact.status, native.status)
  assert.deepEqual(totals(compact.output), totals(native.output))
  assert.match(compact.output, /cancelled fixture/)
  assert.match(compact.output, /fixture cancellation boundary/)
  assert.match(compact.output, /cancelled/)
  assert.match(compact.output, /ℹ cancelled [1-9]/)
})
