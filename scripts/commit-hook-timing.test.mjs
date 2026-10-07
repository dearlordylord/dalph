import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"

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
