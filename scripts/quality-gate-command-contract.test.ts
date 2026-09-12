import { expect, it } from "vitest"
import { Schema } from "effect"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { qualityGateFixtureTestTimeoutMilliseconds, runQualityGateFixture } from "./quality-gate-test-fixture.js"

const repositoryRoot = new URL("../", import.meta.url)
const removedToolReference = /optmem|project-memory/iu
const readRepositoryFile = (path: string) => readFileSync(new URL(path, repositoryRoot), "utf8")
const git = (...args: ReadonlyArray<string>) => execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" })
const readPackageScripts = () =>
  Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.Struct({ scripts: Schema.Record(Schema.String, Schema.String) }))
  )(readRepositoryFile("package.json")).scripts

it("startup has no hook: Codex configuration cannot invoke the removed tooling", () => {
  for (const path of [".codex/hooks.json", ".codex/PROJECT-MEMORY.md"]) {
    expect(existsSync(new URL(path, repositoryRoot)), path).toBe(false)
  }
  // Git does not track empty directories left behind in an existing worktree.
  expect(git("ls-files", "--", ".codex/memory")).toBe("")
  expect(readRepositoryFile(".codex/config.toml")).not.toMatch(removedToolReference)
  expect(existsSync(new URL(".codex/worktree-ledger.md", repositoryRoot))).toBe(true)
  expect(JSON.stringify(readPackageScripts())).not.toMatch(removedToolReference)
})

it(
  "quality gate has no optmem or submodule: runs declared commands with existing scripts",
  async () => {
    const scripts = readPackageScripts()
    const { invocations, result } = await runQualityGateFixture({ fixtureName: "command-contract" })

    expect(result.exitCode).toBe(0)
    expect(git("ls-files", "--stage", "tools/optmem")).toBe("")
    if (existsSync(new URL(".gitmodules", repositoryRoot))) {
      expect(readRepositoryFile(".gitmodules")).not.toMatch(removedToolReference)
    }
    for (const scriptName of invocations) {
      expect(scripts).toHaveProperty(scriptName)
    }
    for (const [scriptName, scriptBody] of Object.entries(scripts)) {
      expect(scriptName).not.toMatch(/^(?:memory(?::|$)|test:memory$)/u)
      expect(scriptBody).not.toMatch(removedToolReference)
      // Check file arguments independently of the runner and flags, including node --test.
      for (const [scriptPath] of scriptBody.matchAll(/\bscripts\/[\w./-]+\.(?:mjs|cjs|js|ts)\b/gu)) {
        expect(existsSync(new URL(scriptPath, repositoryRoot)), `${scriptName}: ${scriptPath}`).toBe(true)
      }
    }
  },
  qualityGateFixtureTestTimeoutMilliseconds
)

it("clone/search has no active refs and retains unrelated production memory implementations", () => {
  const trackedPaths = git("ls-files", "-z").split("\0").filter(Boolean)
  // This acceptance test names forbidden tooling as test data, never as an active integration.
  const acceptanceTestPath = "scripts/quality-gate-command-contract.test.ts"
  for (const path of trackedPaths) {
    expect(path).not.toMatch(removedToolReference)
    if (path !== acceptanceTestPath) expect(readRepositoryFile(path), path).not.toMatch(removedToolReference)
  }
  for (const path of [
    "packages/orchestrator/src/workflow-journal/adapters/memory-store.ts",
    "packages/orchestrator/src/coordination/delivery/in-memory-relations.ts"
  ]) {
    expect(trackedPaths).toContain(path)
    expect(readRepositoryFile(path).length).toBeGreaterThan(0)
  }
})
