import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, test } from "node:test"

import {
  changedPathsBetween,
  classifyChangedPaths,
  isDocsOnlyPath,
  planCiChange,
  resolveComparisonBase
} from "./classify-docs-only-change.mjs"

const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true })
})

test("admits only explicit documentation locations", () => {
  for (const path of [
    "README.md",
    "docs/DEVELOPMENT.md",
    "docs/diagrams/run.svg",
    "packages/orchestrator/README.md",
    "prototypes/reducer-lab/README.md",
    "research/cards/note.md",
    ".github/ISSUE_TEMPLATE/feature.md",
    ".github/PULL_REQUEST_TEMPLATE.md"
  ]) {
    assert.equal(isDocsOnlyPath(path), true, path)
  }

  for (const path of [
    "AGENTS.md",
    "package.json",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
    "scripts/classify-docs-only-change.mjs",
    "packages/orchestrator/src/index.ts",
    "packages/orchestrator/test/fixtures/report.md",
    "research/prototype.ts"
  ]) {
    assert.equal(isDocsOnlyPath(path), false, path)
  }
})

test("requires a non-empty set containing only documentation paths", () => {
  assert.equal(classifyChangedPaths([]), false)
  assert.equal(classifyChangedPaths(["docs/CONTEXT.md", "README.md"]), true)
  assert.equal(classifyChangedPaths(["docs/CONTEXT.md", "packages/orchestrator/src/index.ts"]), false)
})

test("selects the exact event comparison base and fails closed for unsupported events", () => {
  assert.equal(
    resolveComparisonBase({ eventName: "pull_request", pullRequestBaseSha: "base", pushBeforeSha: "before" }),
    "base"
  )
  assert.equal(resolveComparisonBase({ eventName: "push", pullRequestBaseSha: "", pushBeforeSha: "before" }), "before")
  assert.equal(
    resolveComparisonBase({ eventName: "push", pullRequestBaseSha: "", pushBeforeSha: "0".repeat(40) }),
    undefined
  )
  assert.equal(
    resolveComparisonBase({ eventName: "workflow_dispatch", pullRequestBaseSha: "", pushBeforeSha: "" }),
    undefined
  )
})

test("fails closed when Git cannot enumerate the exact change", () => {
  const plan = planCiChange({ eventName: "pull_request", headSha: "head", pullRequestBaseSha: "base" }, () => {
    throw new Error("unreadable comparison")
  })
  assert.deepEqual(plan, { baseSha: "base", docsOnly: false })
})

test("reads NUL-delimited Git paths and rejects executable changes and renames", () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-docs-ci-"))
  temporaryRoots.push(root)
  execFileSync("git", ["init", "-q", "-b", "master"], { cwd: root })
  execFileSync("git", ["config", "user.email", "docs-ci@example.test"], { cwd: root })
  execFileSync("git", ["config", "user.name", "Docs CI"], { cwd: root })
  writeFileSync(join(root, "README.md"), "base\n")
  execFileSync("git", ["add", "README.md"], { cwd: root })
  execFileSync("git", ["commit", "-qm", "base"], { cwd: root })
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()

  mkdirSync(join(root, "docs"))
  writeFileSync(join(root, "docs", "line\nbreak.md"), "documentation\n")
  execFileSync("git", ["add", "docs"], { cwd: root })
  execFileSync("git", ["commit", "-qm", "docs"], { cwd: root })
  const docsHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  assert.equal(classifyChangedPaths(changedPathsBetween(base, docsHead, root)), true)

  mkdirSync(join(root, "scripts"))
  writeFileSync(join(root, "scripts", "tool.mjs"), "export {}\n")
  execFileSync("git", ["add", "scripts"], { cwd: root })
  execFileSync("git", ["commit", "-qm", "tool"], { cwd: root })
  const mixedHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  assert.equal(classifyChangedPaths(changedPathsBetween(base, mixedHead, root)), false)

  mkdirSync(join(root, "docs", "moved"))
  execFileSync("git", ["mv", "scripts/tool.mjs", "docs/moved/tool.md"], { cwd: root })
  execFileSync("git", ["commit", "-qm", "move executable source into docs"], { cwd: root })
  const renamedHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  assert.equal(classifyChangedPaths(changedPathsBetween(mixedHead, renamedHead, root)), false)
})
