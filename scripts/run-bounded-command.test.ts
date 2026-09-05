import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "vitest"

// @ts-expect-error The production quality-gate helper is an executable JavaScript module.
import { runBoundedCommand } from "./run-bounded-command.mjs"

const processExists = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false
    }
    throw error
  }
}

test("counts complete and unterminated stdout and stderr lines", async () => {
  const result = await runBoundedCommand({
    args: ["-e", "process.stdout.write('first\\nsecond'); process.stderr.write('third\\n')"],
    executable: process.execPath,
    forwardOutput: false,
    name: "output line fixture",
    timeoutMilliseconds: 2000
  })

  expect(result).toEqual({ outputLineCount: 3 })
})

test("captures output and an accepted nonzero exit for verdict inspection", async () => {
  const result = await runBoundedCommand({
    acceptedExitCodes: [7],
    args: ["-e", "process.stdout.write('verdict'); process.exit(7)"],
    captureOutput: true,
    executable: process.execPath,
    forwardOutput: false,
    name: "captured verdict fixture",
    timeoutMilliseconds: 2000
  })

  expect(result).toEqual({ exitCode: 7, output: "verdict", outputLineCount: 1 })
})

test("passes a controlled environment to the bounded child", async () => {
  const result = await runBoundedCommand({
    args: ["-e", "process.stdout.write(process.env.DALPH_BOUNDED_COMMAND_FIXTURE ?? 'absent')"],
    captureOutput: true,
    environment: { ...process.env, DALPH_BOUNDED_COMMAND_FIXTURE: "present" },
    executable: process.execPath,
    forwardOutput: false,
    name: "environment fixture",
    timeoutMilliseconds: 2000
  })

  expect(result).toEqual({ exitCode: 0, output: "present", outputLineCount: 1 })
})

test.skipIf(process.platform === "win32")(
  "kills a resistant descendant after the process-group leader exits",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "dalph-bounded-command-"))
    const pidFile = join(directory, "descendant.pid")
    const resistantDescendant = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
    const leader = `
      const { spawn } = require("node:child_process")
      const { writeFileSync } = require("node:fs")
      const descendant = spawn(
        process.execPath,
        ["-e", ${JSON.stringify(resistantDescendant)}],
        { stdio: "ignore" }
      )
      writeFileSync(${JSON.stringify(pidFile)}, String(descendant.pid))
      process.on("SIGTERM", () => process.exit(0))
      setInterval(() => {}, 1000)
    `

    try {
      await expect(
        runBoundedCommand({
          args: ["-e", leader],
          executable: process.execPath,
          name: "resistant descendant fixture",
          terminationGraceMilliseconds: 100,
          timeoutMilliseconds: 2000
        })
      ).rejects.toThrow("resistant descendant fixture exceeded 2 seconds")

      const descendantPid = Number(await readFile(pidFile, "utf8"))
      await expect.poll(() => processExists(descendantPid), { interval: 20, timeout: 2000 }).toBe(false)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }
)

test.each([0, 7])("silent pnpm retains tool diagnostics and exit status %i", async (exitCode) => {
  const directory = await mkdtemp(join(tmpdir(), "dalph-quiet-gate-"))
  try {
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ private: true, scripts: { probe: "node probe.cjs" } })
    )
    await writeFile(
      join(directory, "probe.cjs"),
      `process.stdout.write("tool output\\n"); process.stderr.write("tool diagnostic\\n"); process.exitCode = ${exitCode}`
    )
    const result = await runBoundedCommand({
      acceptedExitCodes: [exitCode],
      args: ["--silent", "--dir", directory, "run", "probe"],
      captureOutput: true,
      executable: "pnpm",
      forwardOutput: false,
      name: "quiet gate fixture",
      timeoutMilliseconds: 5000
    })
    expect(result.exitCode).toBe(exitCode)
    expect(result.output).toContain("tool output\n")
    expect(result.output).toContain("tool diagnostic\n")
    expect(result.outputLineCount).toBe(2)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
