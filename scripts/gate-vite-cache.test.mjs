import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { resetQualityCaches } from "./gate-quality-run.mjs"
import { startInputGuard } from "./gate-resume-inputs.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const require = createRequire(import.meta.url)

void test("fresh and resumed setup discards only exact Vite caches at root and workspace packages", () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-vite-reset-"))
  try {
    for (const packagePath of ["", "packages/example", "prototypes/example"]) {
      for (const cache of [".vite", ".vite-temp"]) {
        const path = join(root, packagePath, "node_modules", cache)
        mkdirSync(path, { recursive: true })
        writeFileSync(join(path, "stale.mjs"), "throw Error('stale')")
      }
    }
    mkdirSync(join(root, "node_modules", ".experimental-vitest-cache"), { recursive: true })
    writeFileSync(join(root, "node_modules", ".experimental-vitest-cache", "stale.mjs"), "throw Error('stale')")
    const source = join(root, "vitest.config.ts")
    writeFileSync(source, "authored config")
    const unrelated = join(root, "node_modules", ".other-temp")
    mkdirSync(unrelated)
    const roots = resetQualityCaches(root)
    assert.equal(roots.length, 8)
    for (const path of roots) assert.equal(existsSync(path), false)
    assert.equal(readFileSync(source, "utf8"), "authored config")
    assert.equal(existsSync(unrelated), true)
    // Resume takes the same setup path; stale config bundles can never be credited.
    mkdirSync(join(root, "node_modules", ".vite-temp"))
    writeFileSync(join(root, "node_modules", ".vite-temp", "stale.mjs"), "stale again")
    assert.deepEqual(resetQualityCaches(root), roots)
    for (const path of roots) assert.equal(existsSync(path), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("persistent Vitest cache aliases fail closed before deleting outside the worktree", () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-vitest-cache-alias-"))
  try {
    mkdirSync(join(root, "node_modules"))
    mkdirSync(join(root, "outside"))
    const retained = join(root, "outside", "retained")
    writeFileSync(retained, "retained")
    symlinkSync(join(root, "outside"), join(root, "node_modules", ".experimental-vitest-cache"))
    assert.throws(() => resetQualityCaches(root), /Unsupported disposable Vite cache/u)
    assert.equal(readFileSync(retained, "utf8"), "retained")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("Vite config-cache aliases fail closed before deleting outside the worktree", () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-vite-alias-"))
  try {
    mkdirSync(join(root, "node_modules"))
    mkdirSync(join(root, "outside"))
    const retained = join(root, "outside", "retained")
    writeFileSync(retained, "retained")
    symlinkSync(join(root, "outside"), join(root, "node_modules", ".vite-temp"))
    assert.throws(() => resetQualityCaches(root), /Unsupported disposable Vite cache/u)
    assert.equal(readFileSync(retained, "utf8"), "retained")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("installed Vitest creates persistent transforms and changed source/config invalidate them", async () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-vite-guard-"))
  let guard
  try {
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
    git("init", "-q")
    git("config", "user.name", "Vite Fixture")
    git("config", "user.email", "vite@example.invalid")
    writeFileSync(join(root, ".gitignore"), "node_modules/\n")
    const config = join(root, "vitest.config.mts")
    const cachePath = join(root, "node_modules", ".experimental-vitest-cache")
    const authored = `export default {test:{globals:true,include:['fixture.test.ts'],maxWorkers:1,reporters:['dot'],experimental:{fsModuleCache:true,fsModuleCachePath:${JSON.stringify(cachePath)}}}}\n`
    writeFileSync(config, authored)
    writeFileSync(join(root, "fixture.test.ts"), "test('private fixture',()=>expect(1).toBe(1))\n")
    git("add", ".")
    git("commit", "-qm", "fixture")
    mkdirSync(join(root, "node_modules"))
    const outputRoots = resetQualityCaches(root)
    const vitest = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs")
    const environment = {
      DEBUG: "vitest:cache:fs",
      PATH: process.env.PATH,
      HOME: root,
      NODE_OPTIONS: "--max-old-space-size=8192"
    }
    guard = await startInputGuard({
      worktree: root,
      logicalInvocation: { mode: "vite fixture", baseSha: git("rev-parse", "HEAD"), toolExecutables: [vitest] },
      effectiveEnvironment: environment,
      generatedOutputRoots: outputRoots
    })
    const runVitest = () =>
      runBoundedCommand({
        captureOutput: true,
        forwardOutput: false,
        executable: process.execPath,
        args: [vitest, "run", "--config", config],
        cwd: root,
        environment,
        name: "actual installed Vitest config bundle",
        timeoutMilliseconds: 15_000
      })
    const result = await runVitest()
    assert.equal(result.exitCode, 0)
    assert.equal(existsSync(join(root, "node_modules", ".vite-temp")), true)
    assert.equal(existsSync(join(root, "node_modules", ".experimental-vitest-cache")), true)
    assert.equal((await guard.finish()).unchanged, true)
    writeFileSync(config, `${authored}\n`)
    writeFileSync(config, authored)
    await assert.rejects(guard.assertUnchanged(), /dirty|changed/u)
    await guard.close()
    guard = undefined

    writeFileSync(join(root, "fixture.test.ts"), "test('private fixture',()=>expect(2).toBe(2))\n")
    const changedSource = await runVitest()
    assert.equal(changedSource.exitCode, 0)
    assert.match(changedSource.output, /transforming by vite first/u)

    writeFileSync(config, authored.replace("maxWorkers:1", "maxWorkers:2"))
    const changedConfig = await runVitest()
    assert.equal(changedConfig.exitCode, 0)
    assert.match(changedConfig.output, /transforming by vite first/u)
  } catch (error) {
    if (error.output !== undefined) console.error(error.output)
    throw error
  } finally {
    await guard?.close()
    rmSync(root, { recursive: true, force: true })
  }
})
