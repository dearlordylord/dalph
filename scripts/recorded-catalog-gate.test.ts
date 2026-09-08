import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"
import vitestConfig from "../vitest.config.js"

// @ts-expect-error The production quality-gate helper is an executable JavaScript module.
import { runBoundedCommand } from "./run-bounded-command.mjs"
// @ts-expect-error The quality-gate policy is an executable JavaScript module.
import { boundedQualityGateCommand, recordedCatalogQualityGate } from "./quality-gate-stage-policy.mjs"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))
const recordedCatalogTest = "packages/dalph/test/cassettes/recorded-catalog-coverage.test.ts"

const resolveVitestConfig = (mode: string) => {
  if (typeof vitestConfig !== "function") throw new Error("Vitest configuration must be mode-aware")
  return vitestConfig({ command: "serve", isPreview: false, isSsrBuild: false, mode })
}

const readInvocations = async (path: string) => (await readFile(path, "utf8")).trim().split("\n").filter(Boolean)

const runQualityGateFixture = async (failureCommand?: string) => {
  const directory = await mkdtemp(join(tmpdir(), "dalph-recorded-catalog-gate-"))
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
      name: "recorded-catalog quality-gate fixture",
      timeoutMilliseconds: 10_000
    })
    return { invocations: await readInvocations(invocationLog), result }
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

it("runs the maintained recorded-catalog proof exactly once immediately before coverage", async () => {
  const { invocations, result } = await runQualityGateFixture()
  const recordedCatalogIndex = invocations.indexOf("test:recorded-catalog")

  expect(result.exitCode).toBe(0)
  expect(invocations.filter((command) => command === "test:recorded-catalog")).toHaveLength(1)
  expect(recordedCatalogIndex).toBeGreaterThan(-1)
  expect(invocations[recordedCatalogIndex + 1]).toBe("test:coverage")
})

it("fails the gate on a nonzero maintained recorded-catalog proof and does not start coverage", async () => {
  const { invocations, result } = await runQualityGateFixture("test:recorded-catalog")

  expect(result.exitCode).toBe(1)
  expect(result.output).toContain("Quality gate 'maintained recorded-catalog semantics' failed with exit 23")
  expect(invocations.filter((command) => command === "test:recorded-catalog")).toHaveLength(1)
  expect(invocations.at(-1)).toBe("test:recorded-catalog")
  expect(invocations).not.toContain("test:coverage")
})

it("passes the measured recorded-catalog deadline to the process-group-bounded runner", () => {
  expect(recordedCatalogQualityGate).toEqual({
    args: ["test:recorded-catalog"],
    name: "maintained recorded-catalog semantics",
    timeout: 420_000
  })
  expect(recordedCatalogQualityGate.timeout - 348_688).toBe(71_312)
  expect(
    boundedQualityGateCommand({
      gate: recordedCatalogQualityGate,
      nodeExecutable: "/fixture/node",
      pnpmEntryPoint: "/fixture/pnpm.cjs"
    })
  ).toEqual({
    args: ["/fixture/pnpm.cjs", "--silent", "test:recorded-catalog"],
    environment: undefined,
    executable: "/fixture/node",
    name: "Quality gate 'maintained recorded-catalog semantics'",
    relayParentSignals: true,
    terminationGraceMilliseconds: undefined,
    timeoutMilliseconds: 420_000
  })
})

it("coverage excludes only the monolithic proof while retaining its thresholds and other cassette tests", () => {
  const ordinary = resolveVitestConfig("test")
  const coverage = resolveVitestConfig("coverage")

  expect(ordinary.test?.exclude).toEqual(["**/node_modules/**", "**/dist/**"])
  expect(coverage.test?.exclude).toEqual([
    "**/node_modules/**",
    "**/dist/**",
    "packages/**/!(run-activation|run-cancellation|task-fact-reconciliation).mbt.test.ts",
    "packages/**/*.performance.test.ts",
    recordedCatalogTest
  ])
  expect(coverage.test?.include).toEqual(ordinary.test?.include)
  expect(coverage.test?.coverage?.thresholds).toEqual({ branches: 75, functions: 75, lines: 75, statements: 75 })
})
