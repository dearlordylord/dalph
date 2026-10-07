/* eslint-disable import/no-nodejs-modules -- Verifies the actual Vitest reporter and retained child streams. */
import { execFile } from "node:child_process"
import process from "node:process"
import { expect, test } from "vitest"

const runObservationChild = (resources: boolean) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
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
      {
        timeout: 15000,
        maxBuffer: 65536,
        env: { ...process.env, DALPH_COVERAGE_RESOURCE_OBSERVATIONS: resources ? "1" : "0" }
      },
      (error, stdout, stderr) => {
        if (error !== null) reject(new Error(`${error.message}: ${stderr}`))
        else resolve({ stdout, stderr })
      }
    )
  })

test("retains bounded lifecycle edges and the named controlled timeout in child output", async () => {
  const result = await runObservationChild(true)
  const lines = result.stderr.split("\n").filter((line) => line.startsWith('{"_tag":"CoverageLifecycle"'))
  const observations = lines.map((line) => JSON.parse(line))
  expect(observations.filter(({ phase }) => phase === "ModuleQueued")).toHaveLength(1)
  expect(observations.filter(({ phase }) => phase === "ModuleStarted")).toHaveLength(1)
  expect(observations.filter(({ phase }) => phase === "ModuleFinished")).toHaveLength(1)
  const started = observations.filter(({ phase }) => phase === "TestStarted")
  const finished = observations.filter(({ phase }) => phase === "TestFinished")
  expect(started).toHaveLength(5)
  expect(started.every(({ file }) => file === "packages/dalph/test-support/coverage-wait.test.ts")).toBe(true)
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
      timeoutMilliseconds: 20000,
      outcome: "TimedOut",
      omittedCharacters: 0
    }
  ])
  expect(lines.every((line) => Buffer.byteLength(line + "\n\n") <= 4096)).toBe(true)
  expect(Buffer.byteLength(lines.join("\n"))).toBeLessThanOrEqual(8192)
  const resourceLines = result.stderr.split("\n").filter((line) => line.startsWith('{"_tag":"CoverageResources"'))
  const resources = resourceLines.map((line) => JSON.parse(line))
  expect(resources).toHaveLength(observations.length)
  expect(new Set(resources.map(({ processId }) => processId)).size).toBeGreaterThanOrEqual(2)
  expect(
    resources.every(
      ({ parallelism, processId, residentBytes, systemCpuMicroseconds, userCpuMicroseconds }) =>
        processId > 0 && residentBytes > 0 && userCpuMicroseconds >= 0 && systemCpuMicroseconds >= 0 && parallelism > 0
    )
  ).toBe(true)
  expect(Buffer.byteLength([...lines, ...resourceLines].join("\n"))).toBeLessThanOrEqual(16384)
  expect(resources.map(({ owner, phase }) => ({ owner, phase }))).toEqual(
    observations.map(({ owner, phase }) => ({ owner, phase }))
  )
  expect(resourceLines.every((line) => Buffer.byteLength(line + "\n\n") <= 4096)).toBe(true)
  expect(result.stdout).not.toContain('"_tag":"CoverageResources"')
  expect(result.stdout).not.toContain('"_tag":"CoverageLifecycle"')
}, 20000)

test("keeps resource samples opt in", async () => {
  const result = await runObservationChild(false)
  expect(result.stderr).toContain('"_tag":"CoverageLifecycle"')
  expect(result.stderr).not.toContain('"_tag":"CoverageResources"')
  expect(result.stdout).not.toContain('"_tag":"CoverageResources"')
}, 20000)
