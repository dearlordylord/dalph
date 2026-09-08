import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"
import vitestConfig from "../vitest.config.js"

// @ts-expect-error The production quality-gate helper is an executable JavaScript module.
import { runBoundedCommand } from "./run-bounded-command.mjs"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

const resolveVitestConfig = (mode: string) => {
  if (typeof vitestConfig !== "function") throw new Error("Vitest configuration must be mode-aware")
  return vitestConfig({ command: "serve", isPreview: false, isSsrBuild: false, mode })
}

const readInvocations = async (path: string) => (await readFile(path, "utf8")).trim().split("\n").filter(Boolean)

const runQualityGateFixture = async (failureCommand?: string) => {
  const directory = await mkdtemp(join(tmpdir(), "dalph-capability-registration-gate-"))
  const entryPoint = join(directory, "pnpm-entry-point.mjs")
  const invocationLog = join(directory, "invocations.log")

  await writeFile(
    entryPoint,
    `import { appendFileSync } from "node:fs"
const command = process.argv[3]
appendFileSync(process.env.DALPH_QUALITY_GATE_INVOCATIONS, command + "\\n")
if (command === process.env.DALPH_QUALITY_GATE_FAILURE_COMMAND) process.exit(23)
`
  )
  await appendFile(invocationLog, "")

  try {
    const result = await runBoundedCommand({
      acceptedExitCodes: failureCommand === undefined ? [0] : [1],
      args: ["scripts/run-quality-gate.mjs"],
      captureOutput: true,
      cwd: repositoryRoot,
      environment: {
        ...process.env,
        DALPH_QUALITY_GATE_FAILURE_COMMAND: failureCommand,
        DALPH_QUALITY_GATE_INVOCATIONS: invocationLog,
        npm_execpath: entryPoint
      },
      executable: process.execPath,
      forwardOutput: false,
      name: "capability-registration quality-gate fixture",
      timeoutMilliseconds: 10_000
    })
    return { invocations: await readInvocations(invocationLog), result }
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

it("runs the capability audit exactly once and continues to the next quality stage", async () => {
  const { invocations, result } = await runQualityGateFixture()
  const capabilityIndex = invocations.indexOf("test:capability-registration")

  expect(result.exitCode).toBe(0)
  expect(invocations.filter((command) => command === "test:capability-registration")).toHaveLength(1)
  expect(capabilityIndex).toBeGreaterThan(-1)
  expect(invocations[capabilityIndex + 1]).toBe("test:ci-change-classification")
})

it("fails fast when the capability audit exits nonzero", async () => {
  const { invocations, result } = await runQualityGateFixture("test:capability-registration")

  expect(result.exitCode).toBe(1)
  expect(result.output).toContain("Quality gate 'capability registration' failed with exit 23")
  expect(invocations.filter((command) => command === "test:capability-registration")).toHaveLength(1)
  expect(invocations.at(-1)).toBe("test:capability-registration")
  expect(invocations).not.toContain("test:ci-change-classification")
})

it("excludes capability correctness and every performance test only from coverage", () => {
  const ordinary = resolveVitestConfig("test")
  const coverage = resolveVitestConfig("coverage")
  const capabilityTest = "scripts/capability-registration.test.ts"
  const performanceTests = "**/*.performance.test.ts"

  expect(ordinary.test?.exclude).not.toContain(capabilityTest)
  expect(ordinary.test?.exclude).not.toContain(performanceTests)
  expect(coverage.test?.exclude).toEqual(expect.arrayContaining([capabilityTest, performanceTests]))
  expect(coverage.test?.include).toEqual(ordinary.test?.include)
  expect(coverage.test?.coverage?.thresholds).toEqual({ branches: 75, functions: 75, lines: 75, statements: 75 })
})
