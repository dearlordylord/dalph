import { describe, expect, it } from "vitest"
import {
  changedLineCoverage,
  changedLinesFromDiff,
  changedProductionLinesFromGit,
  coverageEligiblePath,
  coverageLineFailures,
  resolveCoverageBase
} from "../scripts/verify-changed-coverage.mjs"

const sourcePath = "packages/example/src/feature.ts"
const sourceCoveragePath = `/repo/${sourcePath}`

const coverageFor = (counts: ReadonlyArray<number>) => ({
  [sourceCoveragePath]: {
    statementMap: Object.fromEntries(
      counts.map((_, index) => [
        String(index),
        { start: { line: index + 1, column: 0 }, end: { line: index + 1, column: 20 } }
      ])
    ),
    s: Object.fromEntries(counts.map((count, index) => [String(index), count]))
  }
})

describe("changed production-line coverage", () => {
  it("parses added lines from zero-context diffs across multiple hunks", () => {
    const changed = changedLinesFromDiff(
      [
        "diff --git a/packages/example/src/feature.ts b/packages/example/src/feature.ts",
        "--- a/packages/example/src/feature.ts",
        "+++ b/packages/example/src/feature.ts",
        "@@ -2,1 +2,2 @@",
        "-old()",
        "+new()",
        "+alsoNew()",
        "@@ -10,0 +12,1 @@",
        "+lastNew()"
      ].join("\n")
    )

    expect(changed.get(sourcePath)).toEqual(new Set([2, 3, 12]))
  })

  it("counts additions but not diff context or deletion-only hunks", () => {
    const changed = changedLinesFromDiff(
      [
        "diff --git a/packages/example/src/feature.ts b/packages/example/src/feature.ts",
        "--- a/packages/example/src/feature.ts",
        "+++ b/packages/example/src/feature.ts",
        "@@ -4,2 +4,2 @@",
        " context()",
        "+changed()",
        "@@ -12,1 +12,0 @@",
        "-deleted()"
      ].join("\n")
    )

    expect(changed.get(sourcePath)).toEqual(new Set([5]))
  })

  it("parses every line of a new production file", () => {
    const changed = changedLinesFromDiff(
      [
        "diff --git a/dev/null b/packages/example/src/new-feature.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/packages/example/src/new-feature.ts",
        "@@ -0,0 +1,2 @@",
        "+export const one = 1",
        "+export const two = 2"
      ].join("\n")
    )

    expect(changed.get("packages/example/src/new-feature.ts")).toEqual(new Set([1, 2]))
  })

  it("counts an added line whose content resembles a file header", () => {
    const changed = changedLinesFromDiff(
      [
        "diff --git a/packages/example/src/feature.ts b/packages/example/src/feature.ts",
        "--- a/packages/example/src/feature.ts",
        "+++ b/packages/example/src/feature.ts",
        "@@ -0,0 +1,1 @@",
        "+++ b/export const headerLike = true"
      ].join("\n")
    )

    expect(changed.get(sourcePath)).toEqual(new Set([1]))
  })

  it("includes untracked production files in the worktree change set", () => {
    const calls: Array<ReadonlyArray<string>> = []
    const changed = changedProductionLinesFromGit({
      baseSha: "base123",
      runGit: (args) => {
        calls.push(args)
        return args[0] === "ls-files" ? `${sourcePath}\n` : ""
      },
      repositoryRoot: "/repo",
      readFile: () => "first\nsecond\n"
    })

    expect(changed.get(sourcePath)).toEqual(new Set([1, 2]))
    expect(calls).toEqual([
      ["diff", "--unified=0", "--no-ext-diff", "--no-renames", "base123", "--"],
      ["ls-files", "--others", "--exclude-standard", "--"]
    ])
  })

  it("identifies executable changed lines and reports uncovered lines", () => {
    const changed = new Map([[sourcePath, new Set([1, 2, 3])]])
    const result = changedLineCoverage(coverageFor([1, 0, 1]), changed, "/repo")

    expect(result).toMatchObject({
      executableLines: 3,
      coveredLines: 2,
      uncoveredLines: [{ path: sourcePath, line: 2 }],
      percentage: 66.66666666666667
    })
    expect(coverageLineFailures(result)).toEqual([
      `changed production-line coverage: expected at least 99%, observed 66.67%`,
      `  ${sourcePath}:2`
    ])
  })

  it("uses line coverage semantics when one overlapping statement is hit", () => {
    const coverage = {
      [sourceCoveragePath]: {
        statementMap: {
          first: { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } },
          second: { start: { line: 1, column: 21 }, end: { line: 1, column: 40 } }
        },
        s: { first: 1, second: 0 }
      }
    }
    const result = changedLineCoverage(coverage, new Map([[sourcePath, new Set([1])]]), "/repo")

    expect(result).toMatchObject({ executableLines: 1, coveredLines: 1, uncoveredLines: [], percentage: 100 })
  })

  it("ignores changed lines with no executable coverage span and test/docs/tooling paths", () => {
    const changed = new Map([
      [sourcePath, new Set([4])],
      ["packages/example/src/feature.test.ts", new Set([1])],
      ["docs/coverage.md", new Set([1])],
      ["scripts/verify-changed-coverage.mjs", new Set([1])]
    ])
    const result = changedLineCoverage(coverageFor([1, 1, 1]), changed, "/repo")

    expect(coverageEligiblePath(sourcePath)).toBe(true)
    expect(coverageEligiblePath("packages/example/src/feature.test.ts")).toBe(false)
    expect(coverageEligiblePath("packages/example/src/feature.d.ts")).toBe(false)
    expect(coverageEligiblePath("packages/example/src/feature.d.mts")).toBe(false)
    expect(coverageEligiblePath("packages/example/src/feature.d.cts")).toBe(false)
    expect(coverageEligiblePath("docs/coverage.md")).toBe(false)
    expect(coverageEligiblePath("scripts/verify-changed-coverage.mjs")).toBe(false)
    expect(result.executableLines).toBe(0)
    expect(coverageLineFailures(result)).toEqual([])
  })

  it("accepts exactly the 99 percent floor while retaining uncovered-line evidence", () => {
    const changedLines = new Set(Array.from({ length: 100 }, (_, index) => index + 1))
    const result = changedLineCoverage(
      coverageFor([...Array.from({ length: 99 }, () => 1), 0]),
      new Map([[sourcePath, changedLines]]),
      "/repo"
    )

    expect(result.percentage).toBe(99)
    expect(result.uncoveredLines).toEqual([{ path: sourcePath, line: 100 }])
    expect(coverageLineFailures(result)).toEqual([])
  })

  it("fails closed when changed production source has no coverage entry", () => {
    const result = changedLineCoverage({}, new Map([[sourcePath, new Set([7])]]), "/repo")

    expect(result.uncoveredLines).toEqual([{ path: sourcePath, line: 7, reason: "coverage entry missing" }])
    expect(coverageLineFailures(result)).toEqual([
      "changed production-line coverage: expected at least 99%, observed 0.00%",
      `  ${sourcePath}:7 (coverage entry missing)`
    ])
  })
})

describe("changed coverage base selection", () => {
  it("uses an explicit valid base before fallback candidates", () => {
    const calls: Array<ReadonlyArray<string>> = []
    const base = resolveCoverageBase("abc123", (args) => {
      calls.push(args)
      return args[0] === "rev-parse" ? "abc123\n" : ""
    })

    expect(base).toBe("abc123")
    expect(calls).toEqual([["rev-parse", "--verify", "abc123^{commit}"]])
  })

  it("falls back from origin/master merge-base to the previous commit", () => {
    const calls: Array<ReadonlyArray<string>> = []
    const base = resolveCoverageBase(undefined, (args) => {
      calls.push(args)
      if (args[0] === "merge-base") {
        // eslint-disable-next-line functional/no-throw-statements -- controlled git fallback fixture.
        throw new Error("origin/master is unavailable")
      }
      return "previous123\n"
    })

    expect(base).toBe("previous123")
    expect(calls).toEqual([
      ["merge-base", "origin/master", "HEAD"],
      ["rev-parse", "HEAD^"]
    ])
  })

  it("treats GitHub's all-zero push-before SHA as absent and uses the safe fallback", () => {
    const calls: Array<ReadonlyArray<string>> = []
    const base = resolveCoverageBase("0".repeat(40), (args) => {
      calls.push(args)
      return args[0] === "merge-base" ? "merge123\n" : ""
    })

    expect(base).toBe("merge123")
    expect(calls).toEqual([["merge-base", "origin/master", "HEAD"]])
  })

  it("rejects an explicit base that is not a commit", () => {
    expect(() =>
      resolveCoverageBase("not-a-commit", () => {
        // eslint-disable-next-line functional/no-throw-statements -- controlled invalid-revision fixture.
        throw new Error("bad revision")
      })
    ).toThrow("Explicit coverage base 'not-a-commit' is not a commit")
  })
})
