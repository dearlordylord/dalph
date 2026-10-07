/* eslint-disable import/no-nodejs-modules -- Verifies the actual Vitest reporter and retained child streams. */
import { execFile } from "node:child_process"
import process from "node:process"
import { expect, test } from "vitest"

test("retains bounded lifecycle edges and the named controlled timeout in child output", async () => {
  const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "packages/dalph/test-support/coverage-wait.test.ts",
        "--maxWorkers=1",
        "--reporter=dot",
        "--reporter=./scripts/coverage-lifecycle-reporter.ts"
      ],
      { timeout: 15000, maxBuffer: 65536 },
      (error, stdout, stderr) => {
        if (error !== null) reject(new Error(`${error.message}: ${stderr}`))
        else resolve({ stdout, stderr })
      }
    )
  })
  const lines = result.stderr.split("\n").filter((line) => line.startsWith('{"_tag":"CoverageLifecycle"'))
  const observations = lines.map((line) => JSON.parse(line))
  expect(observations.filter(({ phase }) => phase === "ModuleQueued")).toHaveLength(1)
  expect(observations.filter(({ phase }) => phase === "ModuleStarted")).toHaveLength(1)
  expect(observations.filter(({ phase }) => phase === "ModuleFinished")).toHaveLength(1)
  const started = observations.filter(({ phase }) => phase === "TestStarted")
  const finished = observations.filter(({ phase }) => phase === "TestFinished")
  expect(started).toHaveLength(5)
  expect(finished).toHaveLength(5)
  expect(finished.map(({ testId }) => testId).sort((a, b) => a.localeCompare(b))).toEqual(
    started.map(({ testId }) => testId).sort((a, b) => a.localeCompare(b))
  )
  expect(finished.every(({ outcome }) => outcome === "passed")).toBe(true)
  expect(observations.filter(({ phase }) => phase === "WaitStarted")).toHaveLength(2)
  expect(observations.filter(({ phase }) => phase === "WaitFinished")).toHaveLength(2)
  expect(observations.filter(({ phase }) => phase === "WaitTimedOut")).toEqual([
    {
      _tag: "CoverageLifecycle",
      phase: "WaitTimedOut",
      observedAt: expect.any(String),
      owner: "MCPAdvisory",
      boundary: "AuthoredTaskEObserved",
      outcome: "TimedOut",
      omittedCharacters: 0
    }
  ])
  expect(lines.every((line) => Buffer.byteLength(line + "\n\n") <= 4096)).toBe(true)
  expect(Buffer.byteLength(lines.join("\n"))).toBeLessThanOrEqual(8192)
  expect(result.stdout).not.toContain('"_tag":"CoverageLifecycle"')
}, 20000)
