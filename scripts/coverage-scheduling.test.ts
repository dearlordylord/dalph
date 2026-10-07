/* eslint-disable import/no-nodejs-modules -- The scheduling regression launches an exact, bounded Vitest fixture. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"
import { qualityGateFixtureTestTimeoutMilliseconds, resolveVitestConfig } from "./quality-gate-test-fixture.js"
// @ts-expect-error The production bounded-command helper is executable JavaScript without declarations.
import { runBoundedCommand } from "./run-bounded-command.mjs"

const resourceSensitiveFiles = [
  "packages/dalph/test/conformance/disposition-cleanup-recovery-prefixes.test.ts",
  "packages/dalph/src/application/production-public-recovery.integration.test.ts",
  "packages/dalph/test/scenarios/running-host-death.acceptance.test.ts",
  "packages/dalph/src/application/running-host-command.acceptance.test.ts",
  "packages/dalph/src/application/running-host-client-parity.test.ts",
  "packages/dalph/test/cassettes/distinct-finality.test.ts",
  "scripts/quint-ci-contract.test.ts",
  "packages/dalph/src/application/production-changing-graph-finality.test.ts",
  "packages/dalph/test/cassettes/maintained-observations.test.ts",
  "packages/dalph/test/cassettes/normal-termination.test.ts",
  "packages/dalph/test/scenarios/hermetic-mvp.test.ts",
  "packages/dalph/src/application/production-complete-delivery.acceptance.test.ts",
  "packages/dalph/test/conformance/completion-task-recovery-prefixes.test.ts",
  "packages/dalph/test/conformance/recovery-store-lanes.property.test.ts",
  "packages/dalph/src/application/codex-app-server.test.ts",
  "packages/dalph/test/scenarios/production.test.ts",
  "packages/dalph/src/application/production-publication-control.acceptance.test.ts",
  "packages/orchestrator/src/workflow-journal/termination-preconditions.property.test.ts"
]

it("runs resource-sensitive coverage files once after the ordinary batch without dropping root exclusions", () => {
  const coverage = resolveVitestConfig("coverage")
  const projects = coverage.test?.projects
  if (!Array.isArray(projects)) throw new Error("coverage must declare its three inline projects")
  const rootExcludes = coverage.test?.exclude
  if (!Array.isArray(rootExcludes)) throw new Error("coverage root exclusions missing")
  expect(projects).toHaveLength(3)

  const [ordinary, late, serial] = projects
  if (typeof ordinary !== "object" || ordinary instanceof Promise) throw new Error("ordinary coverage project missing")
  if (typeof late !== "object" || late instanceof Promise) throw new Error("late coverage project missing")
  if (typeof serial !== "object" || serial instanceof Promise) throw new Error("serial coverage project missing")

  expect(ordinary.resolve).toBe(coverage.resolve)
  expect(late.resolve).toBe(coverage.resolve)
  expect(serial.resolve).toBe(coverage.resolve)
  expect(ordinary.test?.include).toEqual(coverage.test?.include)
  expect(ordinary.test?.exclude).toEqual([...rootExcludes, ...resourceSensitiveFiles])
  expect(ordinary.test?.sequence?.groupOrder).toBe(0)
  expect(ordinary.test?.maxWorkers).toBe(2)
  expect(ordinary.test?.testTimeout).toBe(30_000)

  expect(rootExcludes).toContain("packages/dalph/test/integration/direct-remote-publication.integration.test.ts")
  expect(late.test?.include).toEqual(resourceSensitiveFiles.slice(0, 1))
  expect(late.test?.exclude).toEqual(rootExcludes)
  expect(late.test?.sequence?.groupOrder).toBe(1)
  expect(late.test?.maxWorkers).toBe(2)
  expect(late.test?.testTimeout).toBe(30_000)

  expect(serial.test?.include).toEqual(resourceSensitiveFiles.slice(1))
  expect(serial.test?.exclude).toEqual(coverage.test?.exclude)
  expect(serial.test?.sequence?.groupOrder).toBe(2)
  expect(serial.test?.fileParallelism).toBe(false)
  expect(serial.test?.maxWorkers).toBe(1)
  expect(serial.test?.testTimeout).toBe(30_000)
})

it("runs sensitive ordinary files exactly once after the ordinary batch with unchanged budgets", () => {
  const config = resolveVitestConfig("test")
  const projects = config.test?.projects
  if (!Array.isArray(projects)) throw new Error("ordinary tests must declare two projects")
  expect(projects).toHaveLength(2)
  const [ordinary, serial] = projects
  if (typeof ordinary !== "object" || ordinary instanceof Promise) throw new Error("ordinary project missing")
  if (typeof serial !== "object" || serial instanceof Promise) throw new Error("serial project missing")
  expect(ordinary.resolve).toBe(config.resolve)
  expect(serial.resolve).toBe(config.resolve)
  expect(ordinary.test?.include).toEqual(config.test?.include)
  expect(ordinary.test?.exclude).toEqual([...(config.test?.exclude ?? []), ...resourceSensitiveFiles])
  expect(serial.test?.include).toEqual(resourceSensitiveFiles)
  expect(serial.test?.exclude).toEqual(config.test?.exclude)
  expect(ordinary.test?.sequence?.groupOrder).toBe(1)
  expect(serial.test?.sequence?.groupOrder).toBe(2)
  expect(ordinary.test?.maxWorkers).toBe(1)
  expect(serial.test?.maxWorkers).toBe(1)
  expect(serial.test?.fileParallelism).toBe(false)
  expect(ordinary.test?.testTimeout).toBe(10_000)
  expect(serial.test?.testTimeout).toBe(10_000)
})

it(
  "finishes the ordinary project before starting sensitive fixtures in actual Vitest",
  async () => {
    const config = resolveVitestConfig("test")
    const projects = config.test?.projects
    if (!Array.isArray(projects)) throw new Error("ordinary projects missing")
    const directory = await mkdtemp(fileURLToPath(new URL("../.scratch/vitest-scheduling-", import.meta.url)))
    const orderLog = join(directory, "order.log")
    let cleanupDisposition: "Removable" | "Retained" = "Removable"
    try {
      await writeFile(
        join(directory, "ordinary.test.mjs"),
        String.raw`import { appendFileSync } from "node:fs"
import { test } from "vitest"
test("ordinary boundary", async () => {
  appendFileSync(${JSON.stringify(orderLog)}, "ordinary-start\n")
  await new Promise((resolve) => setTimeout(resolve, 10))
  appendFileSync(${JSON.stringify(orderLog)}, "ordinary-complete\n")
})
`
      )
      await writeFile(
        join(directory, "sensitive.test.mjs"),
        String.raw`import { appendFileSync } from "node:fs"
import { test } from "vitest"
test("sensitive boundary", () => appendFileSync(${JSON.stringify(orderLog)}, "sensitive-start\n"))
`
      )
      await writeFile(
        join(directory, "vitest.config.mjs"),
        `export default ${JSON.stringify({
          root: directory,
          test: {
            maxWorkers: config.test?.maxWorkers,
            projects: projects.map((project, index) => {
              if (typeof project !== "object" || project instanceof Promise) throw new Error("inline project missing")
              return {
                root: directory,
                test: {
                  exclude: [],
                  fileParallelism: project.test?.fileParallelism,
                  include: [index === 0 ? "ordinary.test.mjs" : "sensitive.test.mjs"],
                  maxWorkers: project.test?.maxWorkers,
                  name: project.test?.name,
                  sequence: project.test?.sequence
                }
              }
            })
          }
        })}\n`
      )
      cleanupDisposition = "Retained"
      const result = await runBoundedCommand({
        args: [fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)), "run", "--reporter=dot"],
        captureOutput: true,
        cwd: directory,
        executable: process.execPath,
        forwardOutput: false,
        name: "ordinary before sensitive Vitest fixture",
        relayParentSignals: true,
        timeoutMilliseconds: 30_000
      }).catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "stoppedWritersProven" in error &&
          error.stoppedWritersProven === true
        ) {
          cleanupDisposition = "Removable"
          throw error
        }
        throw new Error(`unproven scheduling fixture writers; retained ${directory}`, { cause: error })
      })
      cleanupDisposition = "Removable"
      expect(result.exitCode, result.output).toBe(0)
      expect((await readFile(orderLog, "utf8")).trim().split("\n")).toEqual([
        "ordinary-start",
        "ordinary-complete",
        "sensitive-start"
      ])
    } finally {
      if (cleanupDisposition === "Removable") await rm(directory, { recursive: true, force: true })
    }
  },
  qualityGateFixtureTestTimeoutMilliseconds
)
