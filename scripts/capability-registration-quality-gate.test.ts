import { expect, it } from "vitest"
import {
  qualityGateFixtureTestTimeoutMilliseconds,
  resolveVitestConfig,
  runQualityGateFixture
} from "./quality-gate-test-fixture.js"

it(
  "runs the capability audit exactly once and continues to the next quality stage",
  async () => {
    const { invocations, result } = await runQualityGateFixture({ fixtureName: "capability-registration" })
    const capabilityIndex = invocations.indexOf("test:capability-registration")

    expect(result.exitCode).toBe(0)
    expect(invocations.filter((command) => command === "test:capability-registration")).toHaveLength(1)
    expect(capabilityIndex).toBeGreaterThan(-1)
    expect(invocations[capabilityIndex + 1]).toBe("test:issue-268-c4")
  },
  qualityGateFixtureTestTimeoutMilliseconds
)

it(
  "finishes the structural census and skips qualification when the capability audit exits nonzero",
  async () => {
    const { invocations, result } = await runQualityGateFixture({
      failureCommand: "test:capability-registration",
      fixtureName: "capability-registration"
    })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("Quality gate 'capability registration' failed with exit 23")
    expect(invocations.filter((command) => command === "test:capability-registration")).toHaveLength(1)
    expect(invocations.at(-1)).toBe("test:capability-registration")
    expect(invocations).toContain("test:ci-change-classification")
    expect(invocations).not.toContain("test:coverage")
  },
  qualityGateFixtureTestTimeoutMilliseconds
)

it("keeps the exact combined exclusions out of ordinary tests and in coverage", () => {
  const ordinary = resolveVitestConfig("test")
  const coverage = resolveVitestConfig("coverage")

  expect(ordinary.test?.exclude).toEqual(["**/node_modules/**", "**/dist/**"])
  expect(coverage.test?.exclude).toEqual([
    "**/node_modules/**",
    "**/dist/**",
    "packages/**/!(run-activation|run-cancellation|task-fact-reconciliation).mbt.test.ts",
    "scripts/capability-registration.test.ts",
    "**/*.performance.test.ts",
    "packages/dalph/test/cassettes/recorded-catalog-coverage.test.ts"
  ])
  expect(coverage.test?.include).toEqual(ordinary.test?.include)
  expect(coverage.test?.coverage?.thresholds).toEqual({ branches: 75, functions: 75, lines: 75, statements: 75 })
})
