import { describe, expect, it } from "vitest"
import { coveragePolicy } from "../scripts/coverage-policy.mjs"
import { coverageExitCode, coverageThresholdFailures } from "../scripts/verify-coverage-summary.mjs"

const summaryAtGoals = () => ({
  total: {
    branches: { pct: coveragePolicy.thresholds.branches },
    functions: { pct: coveragePolicy.thresholds.functions },
    lines: { pct: coveragePolicy.thresholds.lines },
    statements: { pct: coveragePolicy.thresholds.statements }
  }
})

describe("coverage summary verification", () => {
  it("requires 99% coverage for every aggregate metric", () => {
    expect(coveragePolicy.thresholds).toEqual({ branches: 99, functions: 99, lines: 99, statements: 99 })
  })

  it("returns a failing exit code when one metric is below its configured goal", () => {
    const below = summaryAtGoals()
    below.total.branches.pct = coveragePolicy.thresholds.branches - 0.01
    expect(coverageThresholdFailures(below)).toEqual([
      `branches: expected at least ${coveragePolicy.thresholds.branches}%, observed ${coveragePolicy.thresholds.branches - 0.01}`
    ])
    expect(coverageExitCode(below)).toBe(1)
  })

  it("returns a successful exit code only when every metric meets its configured goal", () => {
    const atGoals = summaryAtGoals()
    expect(coverageThresholdFailures(atGoals)).toEqual([])
    expect(coverageExitCode(atGoals)).toBe(0)
  })
})
