import { expect, it } from "vitest"
import { resolveVitestConfig } from "./quality-gate-test-fixture.js"

const resourceSensitiveFiles = [
  "packages/dalph/test/integration/direct-remote-publication.integration.test.ts",
  "packages/dalph/test/conformance/disposition-cleanup-recovery-prefixes.test.ts",
  "packages/dalph/test/cassettes/distinct-finality.test.ts",
  "scripts/quint-ci-contract.test.ts"
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

  expect(late.test?.include).toEqual(resourceSensitiveFiles.slice(0, 2))
  expect(late.test?.exclude).toEqual(rootExcludes)
  expect(late.test?.sequence?.groupOrder).toBe(1)
  expect(late.test?.maxWorkers).toBe(2)
  expect(late.test?.testTimeout).toBe(30_000)

  expect(serial.test?.include).toEqual(resourceSensitiveFiles.slice(2))
  expect(serial.test?.exclude).toEqual(coverage.test?.exclude)
  expect(serial.test?.sequence?.groupOrder).toBe(2)
  expect(serial.test?.fileParallelism).toBe(false)
  expect(serial.test?.maxWorkers).toBe(1)
  expect(serial.test?.testTimeout).toBe(30_000)

  expect(resolveVitestConfig("test").test?.projects).toBeUndefined()
})
