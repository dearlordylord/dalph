import { describe, expect, it } from "vitest"
import { coveragePolicy } from "../scripts/coverage-policy.mjs"
import { coverageExitCode, coverageThresholdFailures } from "../scripts/verify-coverage-summary.mjs"

const summary = (percentage: number) => ({
  total: {
    branches: { pct: percentage },
    functions: { pct: percentage },
    lines: { pct: percentage },
    statements: { pct: percentage }
  }
})

describe("coverage summary verification", () => {
  it("returns a failing exit code for any metric below the threshold", () => {
    const below = summary(coveragePolicy.threshold)
    below.total.branches.pct = coveragePolicy.threshold - 0.01
    expect(coverageThresholdFailures(below)).toEqual([
      `branches: expected at least ${coveragePolicy.threshold}%, observed ${coveragePolicy.threshold - 0.01}`
    ])
    expect(coverageExitCode(below)).toBe(1)
  })

  it("returns a successful exit code only when every metric meets the threshold", () => {
    expect(coverageThresholdFailures(summary(coveragePolicy.threshold))).toEqual([])
    expect(coverageExitCode(summary(coveragePolicy.threshold))).toBe(0)
  })
})
