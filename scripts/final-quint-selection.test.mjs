import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, test } from "node:test"
import { completeFormalChangedPaths, selectFinalQuintGate } from "./final-quint-selection.mjs"

const roots = []
const runner = fileURLToPath(new URL("./run-final-quint-gate.mjs", import.meta.url))
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const fixture = () => {
  const outer = mkdtempSync(join(tmpdir(), "dalph-final-quint-"))
  roots.push(outer)
  const root = join(outer, "repo")
  mkdirSync(root)
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
  git("init", "-q", "-b", "master")
  git("config", "user.email", "formal@example.test")
  git("config", "user.name", "Formal Fixture")
  const put = (path, content = "changed\n") => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  for (const path of [
    "README.md",
    "docs/DEVELOPMENT.md",
    "packages/dalph/src/runtime.ts",
    "specs/model.qnt",
    "scripts/classify-docs-only-change.mjs"
  ])
    put(path, "base\n")
  git("add", ".")
  git("commit", "-qm", "base")
  const base = git("rev-parse", "HEAD")
  const inventory = join(outer, "inventory.json")
  const pnpm = join(outer, "pnpm.mjs")
  writeFileSync(
    pnpm,
    'import { writeFileSync } from "node:fs"; writeFileSync(process.env.FORMAL_INVENTORY, JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.FORMAL_EXIT ?? 0))\n'
  )
  const run = (candidate = base, exit = "0") =>
    spawnSync(process.execPath, [runner, `--candidate=${candidate}`], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, npm_execpath: pnpm, FORMAL_INVENTORY: inventory, FORMAL_EXIT: exit }
    })
  return { base, root, git, put, run, inventory }
}

for (const path of [
  "README.md",
  "docs/DEVELOPMENT.md",
  "scripts/quality-output-budget.mjs",
  "scripts/quality-output-budget.test.ts",
  "packages/dalph/README.md",
  "prototypes/example/README.md",
  "research/notes/formal-selection.md",
  ".github/ISSUE_TEMPLATE/tooling.md",
  ".github/PULL_REQUEST_TEMPLATE.md"
]) {
  test(`maintainer sees exact diff and skips exhaustive models for unrelated ${path}`, () => {
    const f = fixture()
    f.put(path)
    const result = f.run()
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Skip exhaustive models: every changed path is allowlisted/u)
    assert.ok(result.stdout.includes(f.base))
    assert.ok(result.stdout.includes(JSON.stringify(path)))
    assert.throws(() => readFileSync(f.inventory), { code: "ENOENT" })
  })
}

for (const path of [
  "packages/dalph/src/runtime.ts",
  "specs/model.qnt",
  "packages/dalph/test/conformance/adapter.mbt.test.ts",
  "scripts/classify-docs-only-change.mjs",
  "scripts/classify-docs-only-change.test.mjs",
  "scripts/check-quint-models.mjs",
  "scripts/run-quality-gate.mjs",
  "scripts/preflight-census.mjs",
  "scripts/quality-gate-stage-policy.mjs",
  "scripts/quality-output-budget.test.mjs",
  "scripts/run-bounded-command.mjs",
  "scripts/final-quint-selection.mjs",
  "scripts/quint-model-scope.mjs",
  "package.json",
  "pnpm-lock.yaml",
  ".node-version",
  ".github/workflows/ci.yml",
  "docs/QUINT-GUIDE.md",
  "docs/scenarios/story.md",
  "docs/DELIVERY-INVARIANTS.md",
  "docs/unrecognized.md",
  "docs/hidden.qnt",
  "unknown.bin"
]) {
  test(`maintainer runs the full formal command for ${path}`, () => {
    const f = fixture()
    f.put(path)
    const result = f.run()
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Full formal gate required by:/u)
    assert.ok(result.stdout.includes(path))
    assert.deepEqual(JSON.parse(readFileSync(f.inventory, "utf8")), ["check:quint"])
  })
}

test("mixed documentation and untracked runtime changes cannot skip models", () => {
  const f = fixture()
  f.put("README.md")
  f.put("packages/dalph/src/new-runtime.ts")
  assert.equal(f.run().status, 0)
  assert.deepEqual(JSON.parse(readFileSync(f.inventory, "utf8")), ["check:quint"])
})

test("committed, staged, unstaged and NUL-delimited untracked changes all appear", () => {
  const f = fixture()
  f.put("README.md")
  f.git("add", "README.md")
  f.git("commit", "-qm", "committed docs")
  f.put("docs/DEVELOPMENT.md")
  f.git("add", "docs/DEVELOPMENT.md")
  f.put("scripts/classify-docs-only-change.mjs")
  f.put("research/line\nbreak.md")
  assert.deepEqual(
    completeFormalChangedPaths(f.base, f.root).changedFiles,
    ["docs/DEVELOPMENT.md", "README.md", "research/line\nbreak.md", "scripts/classify-docs-only-change.mjs"].toSorted(
      (a, b) => a.localeCompare(b)
    )
  )
  const result = f.run()
  assert.match(result.stdout, /Full formal gate required/u)
  assert.deepEqual(JSON.parse(readFileSync(f.inventory, "utf8")), ["check:quint"])
  assert.ok(result.stdout.includes('"research/line\\nbreak.md"'))
})

test("staged runtime edited back to HEAD in working tree still requires formal execution", () => {
  const f = fixture()
  f.put("packages/dalph/src/runtime.ts")
  f.git("add", "packages/dalph/src/runtime.ts")
  f.put("packages/dalph/src/runtime.ts", "base\n")
  assert.equal(f.run().status, 0)
  assert.deepEqual(JSON.parse(readFileSync(f.inventory, "utf8")), ["check:quint"])
})

for (const committed of [false, true]) {
  test(`runtime rename into documentation preserves source obligation (${committed ? "committed" : "staged"})`, () => {
    const f = fixture()
    f.git("mv", "packages/dalph/src/runtime.ts", "docs/runtime.md")
    if (committed) f.git("commit", "-qm", "rename")
    assert.ok(completeFormalChangedPaths(f.base, f.root).changedFiles.includes("packages/dalph/src/runtime.ts"))
    assert.equal(f.run().status, 0)
    assert.deepEqual(JSON.parse(readFileSync(f.inventory, "utf8")), ["check:quint"])
  })
}

test("deleted runtime remains required even though the file no longer exists", () => {
  const f = fixture()
  rmSync(join(f.root, "packages/dalph/src/runtime.ts"))
  assert.equal(f.run().status, 0)
  assert.deepEqual(JSON.parse(readFileSync(f.inventory, "utf8")), ["check:quint"])
})

for (const candidate of ["missing", "0".repeat(40), "f".repeat(40), "HEAD", ""]) {
  test(`unreadable or inexact base ${candidate || "absent"} selects full formal execution`, () => {
    const f = fixture()
    f.put("README.md")
    const result = f.run(candidate)
    assert.equal(result.status, 0)
    assert.match(result.stdout, /Unable to prove an unrelated exact diff/u)
    assert.deepEqual(JSON.parse(readFileSync(f.inventory, "utf8")), ["check:quint"])
  })
}

test("empty exact diff and unreadable Git repository fail closed", () => {
  const f = fixture()
  assert.equal(f.run().status, 0)
  assert.deepEqual(JSON.parse(readFileSync(f.inventory, "utf8")), ["check:quint"])
  assert.equal(selectFinalQuintGate(f.base, join(f.root, "absent")).full, true)
})

test("full formal subprocess failure is the final command failure", () => {
  const f = fixture()
  f.put("specs/model.qnt")
  assert.equal(f.run(f.base, "7").status, 7)
})

test("invoking selection from a subdirectory still includes sibling untracked runtime paths", () => {
  const f = fixture()
  f.put("README.md")
  f.put("packages/dalph/src/new-runtime.ts")
  f.git("config", "diff.relative", "true")
  const selection = selectFinalQuintGate(f.base, join(f.root, "docs"))
  assert.equal(selection.full, true)
  assert.ok(selection.changedFiles.includes("packages/dalph/src/new-runtime.ts"))
  assert.ok(selection.changedFiles.includes("README.md"))
})

test("output-budget helper mixed with a formal runner still executes the full formal command", () => {
  const f = fixture()
  f.put("scripts/quality-output-budget.mjs")
  f.put("scripts/check-quint-models.mjs")
  const result = f.run()
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Full formal gate required by: scripts\/check-quint-models\.mjs/u)
  assert.deepEqual(JSON.parse(readFileSync(f.inventory, "utf8")), ["check:quint"])
})
