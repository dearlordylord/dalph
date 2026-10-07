import { expect, it } from "vitest"
import { resolveVitestConfig } from "./quality-gate-test-fixture.js"

const resourceSensitiveFiles = [
  "packages/dalph/test/conformance/disposition-cleanup-recovery-prefixes.test.ts",
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
  "packages/dalph/src/application/codex-app-server.test.ts"
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

it("runs sensitive ordinary files exactly once after the parallel batch with unchanged budgets", () => {
  const config = resolveVitestConfig("test")
  const projects = config.test?.projects
  if (!Array.isArray(projects)) throw new Error("ordinary tests must declare two projects")
  expect(projects).toHaveLength(2)
  const [parallel, serial] = projects
  if (typeof parallel !== "object" || parallel instanceof Promise) throw new Error("parallel project missing")
  if (typeof serial !== "object" || serial instanceof Promise) throw new Error("serial project missing")
  expect(parallel.resolve).toBe(config.resolve)
  expect(serial.resolve).toBe(config.resolve)
  expect(parallel.test?.include).toEqual(config.test?.include)
  expect(parallel.test?.exclude).toEqual([...(config.test?.exclude ?? []), ...resourceSensitiveFiles])
  expect(serial.test?.include).toEqual(resourceSensitiveFiles)
  expect(serial.test?.exclude).toEqual(config.test?.exclude)
  expect(parallel.test?.sequence?.groupOrder).toBe(0)
  expect(serial.test?.sequence?.groupOrder).toBe(1)
  expect(parallel.test?.maxWorkers).toBe(4)
  expect(serial.test?.maxWorkers).toBe(1)
  expect(serial.test?.fileParallelism).toBe(false)
  expect(parallel.test?.testTimeout).toBe(10_000)
  expect(serial.test?.testTimeout).toBe(10_000)
})
