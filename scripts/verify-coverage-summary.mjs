import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { coveragePolicy } from "./coverage-policy.mjs"

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

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const summaryPath = process.argv[2] ?? "coverage/coverage-summary.json"
  const summary = JSON.parse(await readFile(summaryPath, "utf8"))
  const failures = coverageThresholdFailures(summary)
  if (failures.length > 0) {
    process.stderr.write(`Coverage threshold failure:\n${failures.join("\n")}\n`)
    process.exitCode = 1
  }
}
