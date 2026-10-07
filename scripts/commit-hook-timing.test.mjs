import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { runBoundedCommand } from "./run-bounded-command.mjs"

void test("hook timing preserves commands, secret-check order and first failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hook-timing-control-"))
  try {
    const log = join(directory, "calls")
    for (const name of ["pnpm", "gitleaks"]) {
      const file = join(directory, name)
      await writeFile(
        file,
        `#!/bin/sh\nprintf '%s\\n' "${name} $*" >> "$HOOK_CONTROL_LOG"\nexit "\${${name === "pnpm" ? "LINT" : "SECRET"}_EXIT:-0}"\n`
      )
      await chmod(file, 0o755)
    }
    const run = (timing, lintExit = "0", secretExit = "0") =>
      spawnSync("sh", [resolve(".husky/pre-commit")], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          HOOK_CONTROL_LOG: log,
          DALPH_HOOK_TIMINGS: timing,
          LINT_EXIT: lintExit,
          SECRET_EXIT: secretExit
        },
        encoding: "utf8",
        timeout: 10_000
      })
    assert.equal(run("").status, 0)
    assert.equal(
      await readFile(log, "utf8"),
      "pnpm exec lint-staged\ngitleaks git --pre-commit --staged --redact --no-banner\n"
    )
    await writeFile(log, "")
    const success = run("1")
    assert.equal(success.status, 0)
    assert.deepEqual(
      success.stderr
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).stage),
      ["lint-staged", "gitleaks"]
    )
    assert.equal(
      await readFile(log, "utf8"),
      "pnpm exec lint-staged --verbose\ngitleaks git --pre-commit --staged --redact --no-banner\n"
    )
    await writeFile(log, "")
    const failure = run("1", "23")
    assert.equal(failure.status, 23)
    assert.equal(JSON.parse(failure.stderr).exitCode, 23)
    assert.equal(await readFile(log, "utf8"), "pnpm exec lint-staged --verbose\n")
    assert.equal(run("1", "0", "19").status, 19)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

void test(
  "harness interruption publishes evidence and removes its stopped fixture before relaying SIGTERM",
  { timeout: 15_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "hook-cancellation-control-"))
    const ready = join(directory, "ready.json")
    const output = join(directory, "report.json")
    let settled = false
    try {
      const git = join(directory, "git")
      await writeFile(
        git,
        `#!${process.execPath}\nimport { writeFileSync } from "node:fs"\nwriteFileSync(process.env.HOOK_CONTROL_READY, JSON.stringify({parent:process.ppid,child:process.pid}))\nsetInterval(() => {}, 1000)\n`
      )
      await chmod(git, 0o755)
      const result = runBoundedCommand({
        executable: process.execPath,
        args: [resolve("scripts/measure-commit-hook.mjs"), output],
        environment: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          TMPDIR: directory,
          HOOK_CONTROL_READY: ready
        },
        name: "Controlled harness interruption",
        timeoutMilliseconds: 10_000,
        captureOutput: true,
        forwardOutput: false,
        relayParentSignals: true
      }).then(
        (value) => ({ value }),
        (error) => ({ error })
      )
      let identities
      for (let attempt = 0; attempt < 300; attempt += 1) {
        try {
          identities = JSON.parse(await readFile(ready, "utf8"))
          break
        } catch (error) {
          if (error.code !== "ENOENT") throw error
        }
        await delay(10)
      }
      assert.ok(identities, "fake Git must start before interrupting the harness")
      process.kill(identities.parent, "SIGTERM")
      const observed = await result
      settled = true
      assert.match(observed.error?.message ?? "", /failed with SIGTERM/)
      const report = JSON.parse(await readFile(output, "utf8"))
      assert.equal(report.interruptedBy, "SIGTERM")
      assert.equal(report.stoppedWritersProven, true)
      assert.equal(report.fixtureDisposition, "removed")
      assert.deepEqual(report.samples, [])
      assert.ok(!(await readdir(directory)).some((path) => path.startsWith("dalph-hook-timing-")))
      for (const pid of [identities.parent, identities.child])
        assert.throws(() => process.kill(-pid, 0), { code: "ESRCH" })
    } finally {
      if (settled) await rm(directory, { recursive: true, force: true })
      else console.error(`Preserving unsettled cancellation control: ${directory}`)
    }
  }
)
