import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmod, mkdtemp, readFile, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const runner = fileURLToPath(new URL("./run-quality-lint.mjs", import.meta.url))

test("lint census preserves all three tool failures while ordinary lint stops at the first", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dalph-lint-census-"))
  try {
    const bin = join(directory, "node_modules", ".bin")
    await mkdir(bin, { recursive: true })
    await mkdir(join(directory, "src"))
    await writeFile(join(directory, "src", "fixture.ts"), "export const fixture = 1\n")
    const log = join(directory, "calls.log")
    for (const name of ["oxlint", "eslint", "dprint"]) {
      const path = join(bin, name)
      await writeFile(
        path,
        `#!${process.execPath}\nimport { appendFileSync } from "node:fs"\nappendFileSync(process.env.DALPH_LINT_CENSUS_LOG, "${name}\\n")\nprocess.exit(23)\n`
      )
      await chmod(path, 0o755)
    }
    const run = (args) =>
      spawnSync(process.execPath, [runner, ...args, "src/fixture.ts"], {
        cwd: directory,
        env: { ...process.env, DALPH_LINT_CENSUS_LOG: log },
        encoding: "utf8"
      })
    const census = run(["--census", "--compatibility"])
    assert.equal(census.status, 1, census.stderr)
    assert.equal(await readFile(log, "utf8"), "oxlint\neslint\ndprint\n")
    for (const name of ["oxlint", "eslint", "dprint"]) assert.ok(census.stderr.includes(`.bin/${name}`))
    await writeFile(log, "")
    const ordinary = run(["--compatibility"])
    assert.equal(ordinary.status, 23)
    assert.equal(await readFile(log, "utf8"), "oxlint\n")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("admitted lint disables dprint incremental reuse while ordinary edit-loop lint retains its command", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dalph-lint-incremental-"))
  try {
    const bin = join(directory, "node_modules", ".bin")
    await mkdir(bin, { recursive: true })
    await mkdir(join(directory, "src"))
    await writeFile(join(directory, "src", "fixture.ts"), "export const fixture = 1\n")
    await writeFile(join(bin, "oxlint"), `#!${process.execPath}\nprocess.exit(0)\n`)
    await chmod(join(bin, "oxlint"), 0o755)
    const log = join(directory, "calls.log")
    const path = join(bin, "dprint")
    await writeFile(
      path,
      `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';writeFileSync(process.env.DALPH_LINT_CENSUS_LOG,JSON.stringify(process.argv.slice(2)))\n`
    )
    await chmod(path, 0o755)
    const run = (disabled) => {
      const env = { ...process.env, DALPH_LINT_CENSUS_LOG: log }
      delete env.DALPH_DPRINT_INCREMENTAL
      if (disabled) env.DALPH_DPRINT_INCREMENTAL = "disabled"
      return spawnSync(process.execPath, [runner, "--without-compatibility", "src/fixture.ts"], {
        cwd: directory,
        env,
        encoding: "utf8"
      })
    }
    assert.equal(run(true).status, 0)
    assert.deepEqual(JSON.parse(await readFile(log, "utf8")), ["check", "--incremental=false", "src/fixture.ts"])
    assert.equal(run(false).status, 0)
    assert.deepEqual(JSON.parse(await readFile(log, "utf8")), ["check", "src/fixture.ts"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
