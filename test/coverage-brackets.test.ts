import { describe, expect, it } from "vitest"
import { coverageBracketForPath, coveragePolicy } from "../scripts/coverage-policy.mjs"
import { changedLineCoverageByBracket, coverageBracketLineFailures } from "../scripts/verify-changed-coverage.mjs"
import { coverageBracketSummaries, coverageBracketThresholdFailures } from "../scripts/verify-coverage-summary.mjs"

const fileCoverage = (counts: ReadonlyArray<number>) => ({
  branchMap: { branch: { locations: counts.map(() => ({})) } },
  b: { branch: counts },
  f: Object.fromEntries(counts.map((count, index) => [String(index), count])),
  fnMap: Object.fromEntries(counts.map((_, index) => [String(index), {}])),
  s: Object.fromEntries(counts.map((count, index) => [String(index), count])),
  statementMap: Object.fromEntries(
    counts.map((_, index) => [
      String(index),
      { start: { line: index + 1, column: 0 }, end: { line: index + 1, column: 20 } }
    ])
  )
})

describe("coverage brackets", () => {
  it("keeps production and maintained evaluation-infrastructure floors exact and independent", () => {
    expect(coveragePolicy.brackets.production.thresholds).toEqual({
      branches: 99,
      functions: 99,
      lines: 99,
      statements: 99
    })
    expect(coveragePolicy.brackets["maintained-evaluation"].thresholds).toEqual({
      branches: 75,
      functions: 75,
      lines: 75,
      statements: 75
    })
    expect(coveragePolicy.globalThresholds).toEqual({ branches: 75, functions: 75, lines: 75, statements: 75 })
  })

  it("classifies production, cassette, lab, scripts, tests, and disposable prototypes", () => {
    expect(coverageBracketForPath("src/application.ts")).toBe("production")
    expect(coverageBracketForPath("packages/dalph/src/cassettes/fixtures/recorded.ts")).toBe("maintained-evaluation")
    expect(
      coverageBracketForPath("packages/orchestrator/src/workflow/protocols/integration-finality/fixtures.ts")
    ).toBe("maintained-evaluation")
    expect(coverageBracketForPath("packages/orchestrator/src/authorities/task-tracker/fixture/target.ts")).toBe(
      "production"
    )
    expect(coverageBracketForPath("packages/orchestrator/src/workflow-journal/adapters/memory-store.ts")).toBe(
      "production"
    )
    expect(coverageBracketForPath("packages/orchestrator/src/coordination/run/controlled-workflow.ts")).toBe(
      "production"
    )
    expect(
      coverageBracketForPath(
        "packages/orchestrator/src/workflow/protocols/integration-finality/controlled-boundaries.ts"
      )
    ).toBe("maintained-evaluation")
    expect(coverageBracketForPath("prototypes/reducer-lab/src/cassette-lab.ts")).toBeUndefined()
    expect(coverageBracketForPath("scripts/verify-coverage-summary.mjs")).toBeUndefined()
    expect(coverageBracketForPath("specs/acceptedResultIntegration.qnt")).toBeUndefined()
    expect(coverageBracketForPath("packages/dalph/src/application.test.ts")).toBeUndefined()
    expect(coverageBracketForPath("packages/dalph/src/disposable-prototypes/fixture.ts")).toBeUndefined()
    expect(
      coverageBracketForPath("/workspace/typescript/dalph/prototypes/control-plane/src/task-dag.ts")
    ).toBeUndefined()
  })

  it("aggregates every metric per bracket without cross-bracket masking", () => {
    const coverage = {
      "/repo/src/application.ts": fileCoverage([1, 1]),
      "/repo/packages/dalph/src/cassettes/recorded.ts": fileCoverage([1, 0])
    }
    const summaries = coverageBracketSummaries(coverage)

    expect(summaries.production.total.statements.pct).toBe(100)
    expect(summaries["maintained-evaluation"].total.statements.pct).toBe(50)
    expect(coverageBracketThresholdFailures(coverage)).toContain(
      "maintained-evaluation statements: expected at least 75%, observed 50"
    )
    expect(coverageBracketThresholdFailures(coverage)).not.toContain(
      "production statements: expected at least 99%, observed 50"
    )
  })

  it("passes aggregate metrics at the maintained-evaluation floor exactly", () => {
    const exactCassette = fileCoverage([1, 1, 1, 0])
    const exactProduction = fileCoverage([...Array.from({ length: 99 }, () => 1), 0])
    const coverage = {
      "/repo/src/application.ts": exactProduction,
      "/repo/packages/dalph/src/cassettes/fixtures/recorded.ts": exactCassette
    }
    const summaries = coverageBracketSummaries(coverage)

    expect(Object.values(summaries.production.total).map(({ pct }) => pct)).toEqual([99, 99, 99, 99])
    expect(Object.values(summaries["maintained-evaluation"].total).map(({ pct }) => pct)).toEqual([75, 75, 75, 75])
    expect(coverageBracketThresholdFailures(coverage)).toEqual([])
  })

  it("rejects production below 99 even when maintained evaluation exceeds its floor", () => {
    const coverage = {
      "/repo/src/application.ts": fileCoverage([...Array.from({ length: 98 }, () => 1), 0, 0]),
      "/repo/packages/dalph/src/cassettes/recorded.ts": fileCoverage([1, 1, 1, 1])
    }

    const failures = coverageBracketThresholdFailures(coverage)
    expect(failures).toContain("production statements: expected at least 99%, observed 98")
    expect(failures.some((failure) => failure.startsWith("maintained-evaluation"))).toBe(false)
  })

  it("fails each changed bracket independently and fails closed when an entry is absent", () => {
    const changedLines = new Map([
      ["src/application.ts", new Set([1])],
      ["packages/dalph/src/cassettes/recorded.ts", new Set([1, 2])]
    ])
    const results = changedLineCoverageByBracket(
      {
        "/repo/src/application.ts": fileCoverage([1]),
        "/repo/packages/dalph/src/cassettes/recorded.ts": fileCoverage([1, 0])
      },
      changedLines,
      "/repo"
    )

    expect(results.production.percentage).toBe(100)
    expect(results["maintained-evaluation"].percentage).toBe(50)
    expect(coverageBracketLineFailures(results)).toEqual([
      "changed maintained-evaluation line coverage: expected at least 75%, observed 50.00%",
      "  packages/dalph/src/cassettes/recorded.ts:2"
    ])

    const missing = changedLineCoverageByBracket(
      {},
      new Map([["packages/dalph/src/cassettes/missing.ts", new Set([7])]]),
      "/repo"
    )
    expect(coverageBracketLineFailures(missing)).toEqual([
      "changed maintained-evaluation line coverage: expected at least 75%, observed 0.00%",
      "  packages/dalph/src/cassettes/missing.ts:7 (coverage entry missing)"
    ])
  })

  it("passes changed evaluation-infrastructure lines at the 75 percent floor exactly", () => {
    const changedLines = new Map([
      ["src/application.ts", new Set(Array.from({ length: 100 }, (_, i) => i + 1))],
      ["packages/dalph/src/cassettes/fixtures/recorded.ts", new Set(Array.from({ length: 4 }, (_, i) => i + 1))]
    ])
    const results = changedLineCoverageByBracket(
      {
        "/repo/src/application.ts": fileCoverage([...Array.from({ length: 99 }, () => 1), 0]),
        "/repo/packages/dalph/src/cassettes/fixtures/recorded.ts": fileCoverage([1, 1, 1, 0])
      },
      changedLines,
      "/repo"
    )

    expect(results.production.percentage).toBe(99)
    expect(results["maintained-evaluation"].percentage).toBe(75)
    expect(coverageBracketLineFailures(results)).toEqual([])
  })
})
