import { expect, it } from "vitest"
// @ts-expect-error The quality-gate policy is an executable JavaScript module.
import * as qualityGateStagePolicy from "./quality-gate-stage-policy.mjs"
import {
  qualityGateFixtureTestTimeoutMilliseconds,
  resolveVitestConfig,
  runQualityGateFixture
} from "./quality-gate-test-fixture.js"

const recordedCatalogTest = "packages/dalph/test/cassettes/recorded-catalog-coverage.test.ts"
const { boundedQualityGateCommand, fullQualityGateManifest, recordedCatalogQualityGate } = qualityGateStagePolicy

it(
  "runs the maintained recorded-catalog proof exactly once immediately before coverage",
  async () => {
    const { invocations, result } = await runQualityGateFixture({ fixtureName: "recorded-catalog" })
    const recordedCatalogIndex = invocations.indexOf("test:recorded-catalog")

    expect(result.exitCode).toBe(0)
    expect(invocations.filter((command) => command === "test:recorded-catalog")).toHaveLength(1)
    expect(recordedCatalogIndex).toBeGreaterThan(-1)
    expect(invocations[recordedCatalogIndex + 1]).toBe("test")
  },
  qualityGateFixtureTestTimeoutMilliseconds
)

it(
  "fails the gate on a nonzero maintained recorded-catalog proof and does not start coverage",
  async () => {
    const { invocations, result } = await runQualityGateFixture({
      failureCommand: "test:recorded-catalog",
      fixtureName: "recorded-catalog"
    })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("Quality gate 'maintained recorded-catalog semantics' failed with exit 23")
    expect(invocations.filter((command) => command === "test:recorded-catalog")).toHaveLength(1)
    expect(invocations.at(-1)).toBe("test:recorded-catalog")
    expect(invocations).not.toContain("test")
  },
  qualityGateFixtureTestTimeoutMilliseconds
)

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

it("coverage excludes the monolithic proof while retaining its thresholds and other cassette tests", () => {
  const ordinary = resolveVitestConfig("test")
  const coverage = resolveVitestConfig("coverage")

  expect(ordinary.test?.exclude).toEqual([
    "**/node_modules/**",
    "**/dist/**",
    "packages/**/*.mbt.test.ts",
    "packages/dalph/test/cassettes/delivery-repeatability.test.ts",
    "scripts/capability-registration.test.ts",
    "packages/dalph/test/cassettes/recorded-catalog-coverage.test.ts"
  ])
  expect(coverage.test?.exclude).toContain(recordedCatalogTest)
  expect(coverage.test?.exclude).toContain(
    "packages/dalph/src/application/production-public-recovery.integration.test.ts"
  )
  expect(coverage.test?.exclude).toContain("packages/**/*.mbt.test.ts")
  expect(coverage.test?.exclude?.filter((pattern) => pattern === recordedCatalogTest)).toHaveLength(1)
  expect(coverage.test?.exclude).not.toContain("packages/dalph/test/cassettes/recorded-catalog.test.ts")
  expect(coverage.test?.include).toEqual(ordinary.test?.include)
  expect(coverage.test?.coverage?.thresholds).toEqual({ branches: 75, functions: 75, lines: 75, statements: 75 })
})

it("runs cheap diagnostics before resource-sensitive acceptance and coverage", () => {
  const coverage = resolveVitestConfig("coverage")
  const manifest = fullQualityGateManifest("0123456789abcdef0123456789abcdef01234567", {
    candidateHeadSha: "89abcdef0123456789abcdef0123456789abcdef",
    nodeExecutable: "/fixture/node",
    pnpmEntryPoint: "/fixture/pnpm.cjs",
    worktree: "/fixture/worktree"
  }) as ReadonlyArray<{ readonly boundary: string }>
  const firstQualification = manifest.findIndex(({ boundary }) => boundary === "qualification")

  expect(firstQualification).toBeGreaterThan(0)
  expect(manifest.slice(0, firstQualification).every(({ boundary }) => boundary === "preflight")).toBe(true)
  expect(manifest.slice(firstQualification).every(({ boundary }) => boundary === "qualification")).toBe(true)
  expect(coverage.test?.maxWorkers).toBe(4)
  expect(coverage.test?.coverage).toMatchObject({
    provider: "v8",
    thresholds: { branches: 75, functions: 75, lines: 75, statements: 75 }
  })
})
