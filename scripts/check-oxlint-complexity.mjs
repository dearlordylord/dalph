import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"

const suppressionPath = "oxlint-complexity-suppressions.json"
const complexityEntry = (registry, filename) => registry[filename]?.complexity
const nonBlankJustification = (entry) =>
  typeof entry?.justification === "string" && entry.justification.trim().length > 0

export const suppressionPolicyViolations = ({ baseline = {}, current }) =>
  Object.entries(current).flatMap(([filename, value]) => {
    const entry = value?.complexity
    if (!Number.isSafeInteger(entry?.count) || entry.count < 1) {
      return [`${filename}: complexity count must be a positive safe integer`]
    }
    const baselineCount = complexityEntry(baseline, filename)?.count ?? 0
    return entry.count > baselineCount && !nonBlankJustification(entry)
      ? [`${filename}: new or increased complexity count requires a non-blank justification`]
      : []
  })

export const prunedSuppressionRegistry = ({ counts, current }) =>
  Object.fromEntries(
    [...counts]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([filename, count]) => {
        const justification = complexityEntry(current, filename)?.justification
        return [filename, { complexity: { count, ...(typeof justification === "string" ? { justification } : {}) } }]
      })
  )

const run = (executable, args) => {
  const result = spawnSync(executable, args, { encoding: "utf8" })
  if (result.error !== undefined || result.status !== 0) {
    throw result.error ?? new Error(result.stderr || result.stdout)
  }
  return result.stdout
}

const readCandidateRegistry = (candidate) =>
  candidate === undefined ? undefined : JSON.parse(run("git", ["show", `${candidate}:${suppressionPath}`]))

const observedComplexityCounts = () => {
  const result = spawnSync(
    "pnpm",
    ["exec", "oxlint", "-c", "oxlint.complexity.json", "-f", "json", "src", "packages"],
    { encoding: "utf8" }
  )
  if (result.error !== undefined || (result.status !== 0 && result.status !== 1)) {
    throw result.error ?? new Error(result.stderr)
  }
  const parsed = JSON.parse(result.stdout)
  if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.diagnostics)) {
    throw new Error("Oxlint returned an unexpected JSON diagnostic shape")
  }
  const counts = new Map()
  for (const diagnostic of parsed.diagnostics) {
    if (
      typeof diagnostic !== "object" ||
      diagnostic === null ||
      diagnostic.code !== "eslint(complexity)" ||
      typeof diagnostic.filename !== "string"
    ) {
      continue
    }
    const filename = relative(process.cwd(), resolve(diagnostic.filename))
    counts.set(filename, (counts.get(filename) ?? 0) + 1)
  }
  return counts
}

export const checkOxlintComplexity = () => {
  const counts = observedComplexityCounts()
  const suppressions = JSON.parse(readFileSync(suppressionPath, "utf8"))
  const candidate = process.argv.find((argument) => argument.startsWith("--candidate="))?.slice("--candidate=".length)
  const baseline = readCandidateRegistry(candidate)

  if (process.argv.includes("--prune")) {
    const next = prunedSuppressionRegistry({ counts, current: suppressions })
    const violations = suppressionPolicyViolations({ baseline: baseline ?? suppressions, current: next })
    if (violations.length > 0) {
      throw new Error(["Refusing to write an invalid complexity suppression registry:", ...violations].join("\n"))
    }
    writeFileSync(suppressionPath, `${JSON.stringify(next, undefined, 2)}\n`)
    console.log(`Updated ${suppressionPath} with ${counts.size} files.`)
    return
  }

  const policyViolations = suppressionPolicyViolations({ baseline: baseline ?? suppressions, current: suppressions })
  if (policyViolations.length > 0) {
    console.error(["Cyclomatic complexity suppression policy failed:", ...policyViolations].join("\n"))
    process.exitCode = 1
    return
  }
  const filenames = new Set([...Object.keys(suppressions), ...counts.keys()])
  const mismatches = [...filenames].flatMap((filename) => {
    const actual = counts.get(filename) ?? 0
    const expected = complexityEntry(suppressions, filename)?.count ?? 0
    return actual === expected ? [] : [`${filename}: expected ${expected}, found ${actual}`]
  })
  if (mismatches.length > 0) {
    console.error(["Cyclomatic complexity suppressions are out of sync:", ...mismatches].join("\n"))
    process.exitCode = 1
  } else {
    console.log(`Cyclomatic complexity is within the recorded baseline for ${counts.size} files.`)
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkOxlintComplexity()
}
