import { expect, it } from "vitest"
import {
  broadQualityGateStructuralCommands,
  qualityGateFixtureTestTimeoutMilliseconds,
  qualityGateBroadPlanBaseSha,
  resolveVitestConfig,
  runQualityGateFixture
} from "./quality-gate-test-fixture.js"

const broadQualificationCommands = ["test:mbt", "test:recorded-catalog", "test"]

it(
  "runs the capability audit exactly once and continues to the next quality stage",
  async () => {
    const { invocations, result } = await runQualityGateFixture({
      environment: { DALPH_COVERAGE_BASE_SHA: qualityGateBroadPlanBaseSha() },
      fixtureName: "capability-registration"
    })
    const capabilityIndex = invocations.indexOf("test:capability-registration")

    expect(result.exitCode).toBe(0)
    expect(invocations).toEqual([...broadQualityGateStructuralCommands, ...broadQualificationCommands])
    expect(invocations.filter((command) => command === "test:capability-registration")).toHaveLength(1)
    expect(capabilityIndex).toBeGreaterThan(-1)
    expect(invocations[capabilityIndex + 1]).toBe("test:mbt")
    expect(invocations[capabilityIndex + 2]).toBe("test:recorded-catalog")
  },
  qualityGateFixtureTestTimeoutMilliseconds
)

it(
  "finishes the structural census and skips qualification when the capability audit exits nonzero",
  async () => {
    const { invocations, result } = await runQualityGateFixture({
      environment: { DALPH_COVERAGE_BASE_SHA: qualityGateBroadPlanBaseSha() },
      failureCommand: "test:capability-registration",
      fixtureName: "capability-registration"
    })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("Quality gate 'capability registration' failed with exit 23")
    expect(invocations.filter((command) => command === "test:capability-registration")).toHaveLength(1)
    expect(invocations).toEqual([...broadQualityGateStructuralCommands])
    expect(invocations.at(-1)).toBe("test:capability-registration")
    expect(invocations).not.toContain("test")
  },
  qualityGateFixtureTestTimeoutMilliseconds
)

it("keeps the exact combined exclusions out of ordinary tests and in coverage", () => {
  const ordinary = resolveVitestConfig("test")
  const coverage = resolveVitestConfig("coverage")

  expect(ordinary.test?.exclude).toEqual([
    "**/node_modules/**",
    "**/dist/**",
    "packages/**/*.mbt.test.ts",
    "packages/dalph/test/integration/direct-remote-publication.integration.test.ts",
    "packages/dalph/test/qualification/production-live-launch-preflight.integration.test.ts",
    "packages/dalph/test/cassettes/delivery-repeatability.test.ts",
    "scripts/capability-registration.test.ts",
    "packages/dalph/test/cassettes/recorded-catalog-coverage.test.ts",
    "packages/dalph/test/cassettes/delivery-predecessor-cleanup.test.ts",
    "packages/dalph/test/cassettes/ds14-final-activation-chronology.test.ts",
    "packages/dalph/test/cassettes/authored-runner-process-lifecycle.test.ts"
  ])
  expect(coverage.test?.exclude).toEqual([
    "**/node_modules/**",
    "**/dist/**",
    "packages/**/*.mbt.test.ts",
    "packages/dalph/test/integration/direct-remote-publication.integration.test.ts",
    "packages/dalph/test/qualification/production-live-launch-preflight.integration.test.ts",
    "packages/dalph/test/cassettes/delivery-repeatability.test.ts",
    "scripts/capability-registration.test.ts",
    "packages/dalph/test/cassettes/recorded-catalog-coverage.test.ts",
    "packages/dalph/test/cassettes/delivery-predecessor-cleanup.test.ts",
    "packages/dalph/test/cassettes/ds14-final-activation-chronology.test.ts",
    "packages/dalph/test/cassettes/authored-runner-process-lifecycle.test.ts",
    "**/*.performance.test.ts",
    "packages/dalph/src/application/production-public-recovery.integration.test.ts"
  ])
  expect(coverage.test?.include).toEqual(ordinary.test?.include)
  expect(coverage.test?.coverage?.thresholds).toBeUndefined()
})
