import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

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

test("runs a bounded child in the requested working directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dalph-bounded-command-cwd-"))
  try {
    const result = await runBoundedCommand({
      args: ["-e", "process.stdout.write(process.cwd())"],
      captureOutput: true,
      cwd: directory,
      executable: process.execPath,
      forwardOutput: false,
      name: "working directory fixture",
      timeoutMilliseconds: 2000
    })

    expect(result).toEqual({ exitCode: 0, output: directory, outputLineCount: 1 })
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
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
      expect(processExists(descendantPid)).toBe(false)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }
)

test.skipIf(process.platform === "win32")(
  "restores parent signal listeners after a successful relayed command",
  async () => {
    const signalCounts = new Map([
      ["SIGTERM", process.listenerCount("SIGTERM")],
      ["SIGINT", process.listenerCount("SIGINT")]
    ])
    const result = await runBoundedCommand({
      args: ["-e", "process.stdout.write('ok')"],
      executable: process.execPath,
      forwardOutput: false,
      name: "successful relayed fixture",
      relayParentSignals: true,
      timeoutMilliseconds: 2000
    })

    expect(result).toEqual({ outputLineCount: 1 })
    expect(process.listenerCount("SIGTERM")).toBe(signalCounts.get("SIGTERM"))
    expect(process.listenerCount("SIGINT")).toBe(signalCounts.get("SIGINT"))
  }
)

test.skipIf(process.platform === "win32")(
  "reaps a relayed TERM group before the controller re-raises TERM",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "dalph-bounded-command-relay-"))
    const pidFile = join(directory, "descendant.pid")
    const markerFile = join(directory, "controller-marker.json")
    const helperUrl = pathToFileURL(join(process.cwd(), "scripts", "run-bounded-command.mjs")).href
    const controllerSource = `
      (async () => {
      const { readFileSync, writeFileSync } = require("node:fs")
      const { runBoundedCommand } = await import(${JSON.stringify(helperUrl)})
      const pidFile = ${JSON.stringify(pidFile)}
      const markerFile = ${JSON.stringify(markerFile)}
      const processExists = (pid) => {
        try {
          process.kill(pid, 0)
          return true
        } catch (error) {
          return error?.code !== "ESRCH"
        }
      }
      const resistantDescendant = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
      const leader = \
        \`const { spawn } = require("node:child_process")
        const { writeFileSync } = require("node:fs")
        const descendant = spawn(process.execPath, ["-e", \${JSON.stringify(resistantDescendant)}], { stdio: "ignore" })
        writeFileSync(\${JSON.stringify(pidFile)}, String(descendant.pid))
        setInterval(() => {}, 1000)\`
      try {
        await runBoundedCommand({
          args: ["-e", leader],
          executable: process.execPath,
          forwardOutput: false,
          name: "relayed TERM controller fixture",
          processGroupAbsenceTimeoutMilliseconds: 1000,
          relayParentSignals: true,
          terminationGraceMilliseconds: 100,
          timeoutMilliseconds: 10000
        })
        writeFileSync(markerFile, JSON.stringify({ descendantAbsent: false, unexpected: true }))
      } catch (error) {
        const descendantPid = Number(readFileSync(pidFile, "utf8"))
        writeFileSync(
          markerFile,
          JSON.stringify({ descendantAbsent: !processExists(descendantPid), error: String(error) })
        )
      }
      })().catch((error) => {
        writeFileSync(${JSON.stringify(markerFile)}, JSON.stringify({ descendantAbsent: false, error: String(error) }))
      })
    `
    const controller = spawn(process.execPath, ["-e", controllerSource], { stdio: "ignore" })
    let descendantPid
    const waitForExit = (child: ChildProcess, timeoutMilliseconds: number) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ timedOut: true }), timeoutMilliseconds)
        child.once("exit", (code, signal) => {
          clearTimeout(timer)
          resolve({ code, signal })
        })
      })
    }

    try {
      await expect.poll(() => existsSync(pidFile), { interval: 50, timeout: 8000 }).toBe(true)
      descendantPid = Number(await readFile(pidFile, "utf8"))
      if (controller.pid === undefined) return expect.fail("relay controller has no process id")
      process.kill(controller.pid, "SIGTERM")
      await expect.poll(() => existsSync(markerFile), { interval: 50, timeout: 5000 }).toBe(true)

      const marker = JSON.parse(await readFile(markerFile, "utf8"))
      expect(marker).toMatchObject({ descendantAbsent: true })
      expect(processExists(descendantPid)).toBe(false)
      expect(await waitForExit(controller, 3000)).toMatchObject({ signal: "SIGTERM" })
    } finally {
      if (controller.exitCode === null && controller.signalCode === null) controller.kill("SIGKILL")
      if (descendantPid !== undefined && processExists(descendantPid)) process.kill(descendantPid, "SIGKILL")
      await waitForExit(controller, 1000)
      await rm(directory, { force: true, recursive: true })
    }
  },
  15_000
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
