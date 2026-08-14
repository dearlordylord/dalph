import { describe, expect, it } from "vitest"
import { coveragePolicy } from "../scripts/coverage-policy.mjs"
import { coverageExitCode, coverageThresholdFailures } from "../scripts/verify-coverage-summary.mjs"

const summaryAtFloors = () => ({
  total: {
    branches: { pct: coveragePolicy.thresholds.branches },
    functions: { pct: coveragePolicy.thresholds.functions },
    lines: { pct: coveragePolicy.thresholds.lines },
    statements: { pct: coveragePolicy.thresholds.statements }
  }
})

describe("coverage summary verification", () => {
  it("returns a failing exit code when one metric is below its honest floor", () => {
    const below = summaryAtFloors()
    below.total.branches.pct = coveragePolicy.thresholds.branches - 0.01
    expect(coverageThresholdFailures(below)).toEqual([
      `branches: expected at least ${coveragePolicy.thresholds.branches}%, observed ${coveragePolicy.thresholds.branches - 0.01}`
    ])
    expect(coverageExitCode(below)).toBe(1)
  })

  it("returns a successful exit code only when every metric meets its floor", () => {
    const atFloors = summaryAtFloors()
    expect(coverageThresholdFailures(atFloors)).toEqual([])
    expect(coverageExitCode(atFloors)).toBe(0)
  })
})
