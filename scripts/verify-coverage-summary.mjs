import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { coverageBracketForPath, coveragePolicy } from "./coverage-policy.mjs"

export const coverageThresholdFailures = (summary, thresholds = coveragePolicy.thresholds) =>
  coveragePolicy.metrics.flatMap((metric) => {
    const percentage = summary?.total?.[metric]?.pct
    const threshold = thresholds[metric]
    return typeof percentage === "number" && percentage >= threshold
      ? []
      : [`${metric}: expected at least ${threshold}%, observed ${String(percentage)}`]
  })

export const coverageExitCode = (summary, thresholds = coveragePolicy.thresholds) =>
  coverageThresholdFailures(summary, thresholds).length === 0 ? 0 : 1

const emptyMetric = Object.freeze({ covered: 0, pct: 100, skipped: 0, total: 0 })

const metricFromCounts = (covered, total) => ({
  covered,
  pct: total === 0 ? 0 : (covered * 100) / total,
  skipped: 0,
  total
})

const lineCounts = (fileCoverage) => {
  if (fileCoverage.l !== undefined) {
    const counts = Object.values(fileCoverage.l)
    return [counts.filter((count) => count > 0).length, counts.length]
  }

  const lines = new Map()
  for (const [statementId, statement] of Object.entries(fileCoverage.statementMap ?? {})) {
    const count = fileCoverage.s?.[statementId] ?? 0
    const line = statement.start.line
    lines.set(line, Math.max(lines.get(line) ?? 0, count))
  }
  const counts = [...lines.values()]
  return [counts.filter((count) => count > 0).length, counts.length]
}

const metricCounts = (fileCoverage, metric) => {
  if (metric === "lines") return lineCounts(fileCoverage)
  if (metric === "branches") {
    const counts = Object.values(fileCoverage.b ?? {}).flat()
    return [counts.filter((count) => count > 0).length, counts.length]
  }
  const counts = Object.values(fileCoverage[metric === "statements" ? "s" : "f"] ?? {})
  return [counts.filter((count) => count > 0).length, counts.length]
}

const coverageFilePath = (path, fileCoverage) => (typeof fileCoverage.path === "string" ? fileCoverage.path : path)

/** Aggregate coverage-final.json entries belonging to one independent bracket. */
const coverageBracketSummary = (coverage, bracketName) => {
  const totals = Object.fromEntries(coveragePolicy.metrics.map((metric) => [metric, { covered: 0, total: 0 }]))
  for (const [path, fileCoverage] of Object.entries(coverage ?? {})) {
    if (coverageBracketForPath(coverageFilePath(path, fileCoverage)) !== bracketName) continue
    for (const metric of coveragePolicy.metrics) {
      const [covered, total] = metricCounts(fileCoverage, metric)
      totals[metric].covered += covered
      totals[metric].total += total
    }
  }

  return {
    total: Object.fromEntries(
      coveragePolicy.metrics.map((metric) => {
        const counts = totals[metric]
        return [metric, counts.total === 0 ? emptyMetric : metricFromCounts(counts.covered, counts.total)]
      })
    )
  }
}

/** Aggregate every configured bracket independently; one bracket cannot mask another. */
export const coverageBracketSummaries = (coverage) =>
  Object.fromEntries(
    Object.keys(coveragePolicy.brackets).map((bracketName) => [
      bracketName,
      coverageBracketSummary(coverage, bracketName)
    ])
  )

export const coverageBracketThresholdFailures = (coverage) =>
  Object.entries(coverageBracketSummaries(coverage)).flatMap(([bracketName, summary]) =>
    coverageThresholdFailures(summary, coveragePolicy.brackets[bracketName].thresholds).map(
      (failure) => `${bracketName} ${failure}`
    )
  )

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const summaryPath = process.argv[2] ?? "coverage/coverage-summary.json"
  const summary = JSON.parse(await readFile(summaryPath, "utf8"))
  const coveragePath = process.argv[3] ?? summaryPath.replace(/summary/u, "final")
  const coverage = JSON.parse(await readFile(coveragePath, "utf8"))
  const failures = [
    ...coverageThresholdFailures(summary, coveragePolicy.globalThresholds),
    ...coverageBracketThresholdFailures(coverage)
  ]
  if (failures.length > 0) {
    process.stderr.write(`Coverage threshold failure:\n${failures.join("\n")}\n`)
    process.exitCode = 1
  }
}
