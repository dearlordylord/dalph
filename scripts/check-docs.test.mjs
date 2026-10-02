import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, test } from "node:test"
import { fileURLToPath } from "node:url"
import { documentationPaths } from "./check-docs.mjs"
import { ensureLychee } from "./install-lychee.mjs"

const roots = []
const binary = await ensureLychee()
const runner = fileURLToPath(new URL("./check-docs.mjs", import.meta.url))
const config = fileURLToPath(new URL("../lychee.toml", import.meta.url))

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-doc-links-test-"))
  roots.push(root)
  execFileSync("git", ["init", "--quiet"], { cwd: root })
  copyFileSync(config, join(root, "lychee.toml"))
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const check = () => spawnSync(process.execPath, [runner], { cwd: root, encoding: "utf8", timeout: 15_000 })
  return { root, write, check }
}

void test("offline checker resolves cross-document duplicate headings, encoded spaces, and source targets", () => {
  const f = fixture()
  f.write(
    "README.md",
    "[one](docs/guide.md#same) [two](docs/guide.md#same-1) [space](docs/a%20b.md#heading) [code](packages/demo/src/main.ts) [remote](https://does-not-exist.invalid/)\n"
  )
  f.write("docs/guide.md", "# Same\n\n# Same\n")
  f.write("docs/a b.md", "# Heading\n")
  f.write("packages/demo/src/main.ts", "export const value = 1\n")
  const result = f.check()
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr + result.stdout)
})

void test("unchanged documentation rejects a deleted tracked source target", () => {
  const f = fixture()
  f.write("README.md", "[code](packages/demo/src/main.ts)\n")
  f.write("packages/demo/src/main.ts", "export const value = 1\n")
  execFileSync("git", ["add", "."], { cwd: f.root })
  assert.equal(f.check().status, 0)
  rmSync(join(f.root, "packages/demo/src/main.ts"))
  const result = f.check()
  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /File not found/u)
})

void test("removed cross-document heading and nonexistent duplicate suffix fail", () => {
  const f = fixture()
  f.write("README.md", "[missing](docs/guide.md#removed) [duplicate](docs/guide.md#same-2)\n")
  f.write("docs/guide.md", "# Same\n\n# Same\n")
  const result = f.check()
  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /Cannot find fragment/u)
})

void test("selection includes new docs and templates but excludes fixtures, ignored files, and deleted inputs", () => {
  const f = fixture()
  for (const path of [
    "AGENTS.md",
    "docs/new.md",
    "research/note.md",
    "packages/demo/README.md",
    "prototypes/lab/AGENTS.md",
    ".github/ISSUE_TEMPLATE/bug.md",
    "packages/demo/test/fixtures/report.md",
    "vendor/README.md",
    "docs/ignored.md",
    "docs/deleted.md"
  ])
    f.write(path, "# Heading\n")
  f.write(".gitignore", "docs/ignored.md\n")
  execFileSync("git", ["add", "docs/deleted.md"], { cwd: f.root })
  rmSync(join(f.root, "docs/deleted.md"))
  assert.deepEqual(documentationPaths(f.root), [
    ".github/ISSUE_TEMPLATE/bug.md",
    "AGENTS.md",
    "docs/new.md",
    "packages/demo/README.md",
    "prototypes/lab/AGENTS.md",
    "research/note.md"
  ])
})

void test("empty documentation selection fails visibly instead of supplying a green verdict", () => {
  const f = fixture()
  const result = f.check()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /refusing an empty/u)
})

void test("hidden templates and tracked ignored documents are actually checked", () => {
  const f = fixture()
  f.write("README.md", "# Valid\n")
  f.write(".github/ISSUE_TEMPLATE/bug.md", "[missing](../../missing-template.md)\n")
  f.write("docs/tracked.md", "[missing](missing-tracked.md)\n")
  execFileSync("git", ["add", "."], { cwd: f.root })
  f.write(".gitignore", "docs/tracked.md\n")
  const result = f.check()
  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /missing-template\.md/u)
  assert.match(result.stdout + result.stderr, /missing-tracked\.md/u)
})

void test("the provisioned binary is the pinned release", () => {
  assert.equal(execFileSync(binary, ["--version"], { encoding: "utf8" }).trim(), "lychee 0.24.2")
})
