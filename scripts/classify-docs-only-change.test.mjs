import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, test } from "node:test"

import {
  changedPathsBetween,
  classifyFormalChangeBetween,
  classifyFormalChangedPaths,
  classifyChangedPaths,
  hostedFormalInputPathsBetween,
  isDocsOnlyPath,
  planCiChange,
  resolveComparisonBase
} from "./classify-docs-only-change.mjs"
import {
  createHostedFormalInputManifest,
  hostedFormalInputManifestPath,
  parseHostedFormalInputManifest,
  serializeHostedFormalInputManifest
} from "./hosted-formal-input-manifest.mjs"

const baseSha = "1".repeat(40)
const headSha = "2".repeat(40)

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
  const failures = []
  const plan = planCiChange(
    { eventName: "pull_request", headSha, pullRequestBaseSha: baseSha },
    () => {
      throw new Error("unreadable comparison")
    },
    () => ["specs/selected.qnt"],
    (detail) => failures.push(detail)
  )
  assert.equal(plan.formalRequired, true)
  assert.equal(plan.formalClassification.status, "unavailable")
  assert.equal(plan.formalClassification.reason, "unreadable comparison")
  assert.deepEqual(failures, ["unreadable comparison"])
})

test("one exact classifier accepts an unchanged candidate and rejects unavailable identities", () => {
  assert.deepEqual(
    classifyFormalChangeBetween({
      baseSha,
      headSha,
      listChangedPaths: () => [],
      listFormalInputPaths: () => ["specs/selected.qnt"]
    }),
    { version: 1, status: "unaffected", baseSha, headSha, changedPaths: [], affectedPaths: [] }
  )
  assert.throws(
    () => classifyFormalChangeBetween({ baseSha: "HEAD^", headSha, listChangedPaths: () => [] }),
    /exact nonzero commit SHAs/u
  )
  assert.throws(
    () =>
      classifyFormalChangeBetween({
        baseSha,
        headSha,
        listChangedPaths: () => [],
        listFormalInputPaths: () => ["specs/selected.qnt"],
        requireChangedPaths: true
      }),
    /path set is empty/u
  )
})

test("fails closed for missing identities, unsupported events, empty diffs, and unavailable projections", () => {
  const paths = () => ["packages/dalph/src/index.ts"]
  const formal = () => ["specs/selected.qnt"]
  for (const input of [
    { eventName: "workflow_dispatch", headSha },
    { eventName: "push", headSha, pushBeforeSha: "0".repeat(40) },
    { eventName: "pull_request", headSha: "", pullRequestBaseSha: baseSha },
    { eventName: "pull_request", headSha: "not-a-sha", pullRequestBaseSha: baseSha }
  ]) {
    const plan = planCiChange(input, paths, formal)
    assert.equal(plan.formalRequired, true)
    assert.equal(plan.formalClassification.status, "unavailable")
  }
  assert.equal(
    planCiChange({ eventName: "pull_request", headSha, pullRequestBaseSha: baseSha }, () => [], formal)
      .formalClassification.status,
    "unavailable"
  )
  assert.equal(
    planCiChange({ eventName: "pull_request", headSha, pullRequestBaseSha: baseSha }, paths, () => [])
      .formalClassification.status,
    "unavailable"
  )
})

test("rejects malformed hosted formal projections instead of hiding missing inputs", () => {
  for (const text of [
    "not-json",
    JSON.stringify({ version: 1, digest: "wrong", paths: ["specs/model.qnt"] }),
    JSON.stringify({ version: 2, digest: "wrong", paths: ["specs/model.qnt"] }),
    JSON.stringify({ version: 1, digest: "wrong", paths: ["../outside.qnt"] })
  ])
    assert.throws(() => parseHostedFormalInputManifest(text))
})

test("requires formal verification for model, helper, command, workflow, and toolchain inputs only", () => {
  const manifest = parseHostedFormalInputManifest(readFileSync(hostedFormalInputManifestPath, "utf8"))
  for (const path of [
    "specs/plannedAttemptExecutor.qnt",
    "scripts/quint-effective-profile.mjs",
    "scripts/run-hosted-formal-shard.mjs",
    ".github/workflows/ci.yml",
    "package.json",
    "packages/contracts/package.json",
    "packages/dalph/package.json",
    "packages/orchestrator/package.json",
    "prototypes/reducer-lab/package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".npmrc",
    "patches/@informalsystems__quint@0.32.0.patch",
    "scripts/generate-hosted-formal-input-manifest.mjs",
    "scripts/hosted-formal-input-manifest.json",
    "scripts/hosted-formal-input-manifest.mjs",
    "scripts/classify-docs-only-change.mjs",
    "packages/dalph/test/conformance/planned-attempt-executor.mbt.test.ts"
  ])
    assert.deepEqual(classifyFormalChangedPaths([path], manifest.paths), [path], path)

  for (const path of [
    "packages/dalph/src/application/node-main.ts",
    "packages/dalph/src/application/node-main.test.ts",
    "packages/dalph/src/index.ts",
    "packages/dalph/src/index.test.ts",
    "scripts/classify-docs-only-change.test.mjs",
    "specs/unselected-experiment.qnt",
    "docs/DEVELOPMENT.md",
    "README.md"
  ])
    assert.deepEqual(classifyFormalChangedPaths([path], manifest.paths), [], path)
})

test("marks an adapter helper and governed source affected while leaving the non-model resolution control unaffected", () => {
  const manifest = parseHostedFormalInputManifest(readFileSync(hostedFormalInputManifestPath, "utf8"))
  for (const path of [
    "packages/dalph/test/conformance/planned-attempt-executor-resume-fixture.ts",
    "packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/resume-redelivery.ts"
  ])
    assert.deepEqual(classifyFormalChangedPaths([path], manifest.paths), [path], path)
  assert.deepEqual(
    classifyFormalChangedPaths(
      ["packages/dalph/test/conformance/workspace-source-resolution.mbt.test.ts"],
      manifest.paths
    ),
    []
  )
})

test("classifies exact affected and unaffected plans with visible path evidence", () => {
  const affected = planCiChange(
    { eventName: "pull_request", headSha, pullRequestBaseSha: baseSha },
    () => ["packages/dalph/src/index.ts", "specs/plannedAttemptExecutor.qnt"],
    () => ["specs/plannedAttemptExecutor.qnt"]
  )
  assert.equal(affected.formalRequired, true)
  assert.deepEqual(affected.formalClassification, {
    version: 1,
    status: "affected",
    baseSha,
    headSha,
    changedPaths: ["packages/dalph/src/index.ts", "specs/plannedAttemptExecutor.qnt"],
    affectedPaths: ["specs/plannedAttemptExecutor.qnt"]
  })
  const unaffected = planCiChange(
    { eventName: "push", headSha, pushBeforeSha: baseSha },
    () => ["packages/dalph/src/index.ts", "scripts/classify-docs-only-change.test.mjs"],
    () => ["specs/plannedAttemptExecutor.qnt"]
  )
  assert.equal(unaffected.formalRequired, false)
  assert.equal(unaffected.formalClassification.status, "unaffected")
  assert.deepEqual(unaffected.formalClassification.affectedPaths, [])
})

test("reads NUL-delimited Git paths and rejects executable changes and renames", () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-docs-ci-"))
  temporaryRoots.push(root)
  execFileSync("git", ["init", "-q", "-b", "master"], { cwd: root })
  execFileSync("git", ["config", "user.email", "docs-ci@example.test"], { cwd: root })
  execFileSync("git", ["config", "user.name", "Docs CI"], { cwd: root })
  writeFileSync(join(root, "README.md"), "base\n")
  mkdirSync(join(root, "scripts"))
  const manifestText = serializeHostedFormalInputManifest(
    createHostedFormalInputManifest([hostedFormalInputManifestPath, "scripts/tool.mjs"])
  )
  writeFileSync(join(root, hostedFormalInputManifestPath), manifestText)
  execFileSync("git", ["add", "README.md"], { cwd: root })
  execFileSync("git", ["add", hostedFormalInputManifestPath], { cwd: root })
  execFileSync("git", ["commit", "-qm", "base"], { cwd: root })
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()

  mkdirSync(join(root, "docs"))
  writeFileSync(join(root, "docs", "line\nbreak.md"), "documentation\n")
  execFileSync("git", ["add", "docs"], { cwd: root })
  execFileSync("git", ["commit", "-qm", "docs"], { cwd: root })
  const docsHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  assert.deepEqual(changedPathsBetween(base, docsHead, root), ["docs/line\nbreak.md"])
  assert.equal(classifyChangedPaths(changedPathsBetween(base, docsHead, root)), true)

  writeFileSync(join(root, "scripts", "tool.mjs"), "export {}\n")
  execFileSync("git", ["add", "scripts"], { cwd: root })
  execFileSync("git", ["commit", "-qm", "tool"], { cwd: root })
  const mixedHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  assert.equal(classifyChangedPaths(changedPathsBetween(base, mixedHead, root)), false)
  assert.deepEqual(
    hostedFormalInputPathsBetween(base, mixedHead, root).sort((left, right) => left.localeCompare(right)),
    ["scripts/hosted-formal-input-manifest.json", "scripts/tool.mjs"]
  )
  assert.deepEqual(
    classifyFormalChangedPaths(
      changedPathsBetween(docsHead, mixedHead, root),
      hostedFormalInputPathsBetween(docsHead, mixedHead, root)
    ),
    ["scripts/tool.mjs"]
  )

  mkdirSync(join(root, "docs", "moved"))
  execFileSync("git", ["mv", "scripts/tool.mjs", "docs/moved/tool.md"], { cwd: root })
  writeFileSync(
    join(root, hostedFormalInputManifestPath),
    serializeHostedFormalInputManifest(createHostedFormalInputManifest([hostedFormalInputManifestPath]))
  )
  execFileSync("git", ["add", hostedFormalInputManifestPath], { cwd: root })
  execFileSync("git", ["commit", "-qm", "move executable source into docs"], { cwd: root })
  const renamedHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  assert.equal(classifyChangedPaths(changedPathsBetween(mixedHead, renamedHead, root)), false)
  assert.deepEqual(changedPathsBetween(mixedHead, renamedHead, root), [
    "docs/moved/tool.md",
    "scripts/hosted-formal-input-manifest.json",
    "scripts/tool.mjs"
  ])
  assert.equal(hostedFormalInputPathsBetween(mixedHead, renamedHead, root).includes("scripts/tool.mjs"), true)
  assert.deepEqual(
    classifyFormalChangedPaths(["scripts/tool.mjs"], hostedFormalInputPathsBetween(mixedHead, renamedHead, root)),
    ["scripts/tool.mjs"]
  )
})
