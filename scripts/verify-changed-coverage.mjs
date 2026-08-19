import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { coverageBracketForPath, coveragePolicy } from "./coverage-policy.mjs"

const changedCoverageThreshold = coveragePolicy.changedProductionLinesThreshold

const defaultGit = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })

const normalizePath = (path) => path.replaceAll("\\", "/")

export const coverageEligiblePath = (path) => {
  return coverageBracketForPath(path) !== undefined
}

const addChangedLine = (changed, path, line) => {
  const current = changed.get(path)
  if (current === undefined) changed.set(path, new Set([line]))
  else current.add(line)
}

const parseHunk = (line) => {
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u.exec(line)
  if (match === null) return undefined
  const remainingLines = Number(match[2])
  return { nextLine: Number(match[1]), remainingLines: Number.isNaN(remainingLines) ? 1 : remainingLines }
}

export const changedLinesFromDiff = (diff) => {
  const changed = new Map()
  let path
  let hunk

  for (const line of diff.split("\n")) {
    if (hunk !== undefined && path !== undefined && hunk.remainingLines > 0) {
      if (line.startsWith("+")) {
        addChangedLine(changed, path, hunk.nextLine)
        hunk = { nextLine: hunk.nextLine + 1, remainingLines: hunk.remainingLines - 1 }
      } else if (line.startsWith("-")) {
        continue
      } else if (line.startsWith(" ")) {
        hunk = { nextLine: hunk.nextLine + 1, remainingLines: hunk.remainingLines - 1 }
      }
      continue
    }
    if (line.startsWith("+++ b/")) {
      const candidate = line.slice("+++ b/".length)
      path = candidate === "/dev/null" ? undefined : normalizePath(candidate)
      hunk = undefined
      continue
    }
    if (line.startsWith("@@ ")) {
      hunk = parseHunk(line)
    }
  }
  return changed
}

const mergeChangedLines = (target, source) => {
  for (const [path, lines] of source) {
    for (const line of lines) addChangedLine(target, path, line)
  }
  return target
}

const allFileLines = (source) => {
  const lines = source.split(/\r?\n/u)
  if (lines.at(-1) === "") lines.pop()
  return new Set(lines.map((_, index) => index + 1))
}

export const changedProductionLinesFromGit = ({
  baseSha,
  readFile = readFileSync,
  repositoryRoot = process.cwd(),
  runGit = defaultGit
}) => {
  const changed = changedLinesFromDiff(runGit(["diff", "--unified=0", "--no-ext-diff", "--no-renames", baseSha, "--"]))
  const untracked = runGit(["ls-files", "--others", "--exclude-standard", "--"])
    .split("\n")
    .map((path) => normalizePath(path.trim()))
    .filter((path) => path.length > 0 && coverageEligiblePath(path))
  for (const path of untracked) {
    mergeChangedLines(changed, new Map([[path, allFileLines(readFile(resolve(repositoryRoot, path), "utf8"))]]))
  }
  return changed
}

const coverageFileFor = (coverage, path, repositoryRoot) => {
  const relative = normalizePath(path)
  const absolute = resolve(repositoryRoot, relative)
  return coverage[absolute] ?? coverage[relative] ?? coverage[`file://${absolute}`]
}

const statementCoversLine = (statement, line) => statement.start.line <= line && line <= statement.end.line

const percentageFor = (covered, executable) => (executable === 0 ? 100 : (covered * 100) / executable)

export const changedLineCoverage = (coverage, changedLines, repositoryRoot = process.cwd()) => {
  const files = []
  const uncoveredLines = []
  let executableLines = 0
  let coveredLines = 0

  for (const [path, lines] of changedLines) {
    if (!coverageEligiblePath(path)) continue
    const fileCoverage = coverageFileFor(coverage, path, repositoryRoot)
    const fileUncovered = []
    let fileExecutable = 0
    let fileCovered = 0
    if (fileCoverage === undefined) {
      for (const line of lines) {
        fileUncovered.push({ path, line, reason: "coverage entry missing" })
      }
      fileExecutable = lines.size
    } else {
      for (const line of [...lines].sort((left, right) => left - right)) {
        const statementIds = Object.entries(fileCoverage.statementMap ?? {})
          .filter(([, statement]) => statementCoversLine(statement, line))
          .map(([statementId]) => statementId)
        if (statementIds.length === 0) continue
        fileExecutable += 1
        if (
          statementIds.some(
            (statementId) => (fileCoverage.s === undefined ? 0 : (fileCoverage.s[statementId] ?? 0)) > 0
          )
        )
          fileCovered += 1
        else fileUncovered.push({ path, line })
      }
    }
    executableLines += fileExecutable
    coveredLines += fileCovered
    uncoveredLines.push(...fileUncovered)
    files.push({ path, executableLines: fileExecutable, coveredLines: fileCovered, uncoveredLines: fileUncovered })
  }

  return {
    files,
    executableLines,
    coveredLines,
    uncoveredLines,
    percentage: percentageFor(coveredLines, executableLines)
  }
}

const emptyChangedLineCoverage = () => ({
  files: [],
  executableLines: 0,
  coveredLines: 0,
  uncoveredLines: [],
  percentage: 100
})

/** Measure changed executable lines independently for each configured bracket. */
export const changedLineCoverageByBracket = (coverage, changedLines, repositoryRoot = process.cwd()) =>
  Object.fromEntries(
    Object.keys(coveragePolicy.brackets).map((bracketName) => {
      const bracketLines = new Map([...changedLines].filter(([path]) => coverageBracketForPath(path) === bracketName))
      return [
        bracketName,
        bracketLines.size === 0
          ? emptyChangedLineCoverage()
          : changedLineCoverage(coverage, bracketLines, repositoryRoot)
      ]
    })
  )

/** Return changed-line failures for each bracket, preserving independent floors. */
export const coverageBracketLineFailures = (results) =>
  Object.entries(results).flatMap(([bracketName, result]) => {
    const threshold = coveragePolicy.brackets[bracketName].changedLinesThreshold
    if (result.coveredLines * 100 >= result.executableLines * threshold) return []
    return [
      `changed ${bracketName} line coverage: expected at least ${threshold}%, observed ${formatPercentage(result.percentage)}`,
      ...result.uncoveredLines.map(
        ({ line, path, reason }) => `  ${path}:${line}${reason === undefined ? "" : ` (${reason})`}`
      )
    ]
  })

const formatPercentage = (percentage) => `${percentage.toFixed(2)}%`

export const coverageLineFailures = (result, threshold = changedCoverageThreshold) => {
  if (result.coveredLines * 100 >= result.executableLines * threshold) return []
  return [
    `changed production-line coverage: expected at least ${threshold}%, observed ${formatPercentage(result.percentage)}`,
    ...result.uncoveredLines.map(
      ({ line, path, reason }) => `  ${path}:${line}${reason === undefined ? "" : ` (${reason})`}`
    )
  ]
}

const isUsableRevision = (revision) => revision.length > 0 && !/^0+$/u.test(revision)

export const resolveCoverageBase = (explicitBase, runGit = defaultGit) => {
  const requested = explicitBase?.trim()
  if (requested !== undefined && requested.length > 0 && isUsableRevision(requested)) {
    try {
      runGit(["rev-parse", "--verify", `${requested}^{commit}`])
      return requested
    } catch {
      throw new Error(`Explicit coverage base '${requested}' is not a commit`)
    }
  }

  for (const candidate of [
    ["merge-base", "origin/master", "HEAD"],
    ["rev-parse", "HEAD^"]
  ]) {
    try {
      const revision = runGit(candidate).trim()
      if (isUsableRevision(revision)) return revision
    } catch {
      // The next local fallback is intentionally attempted.
    }
  }
  throw new Error("Unable to resolve a coverage base; set DALPH_COVERAGE_BASE_SHA to a commit")
}

const main = async () => {
  const repositoryRoot = process.cwd()
  const coveragePath = process.argv[2] ?? "coverage/coverage-final.json"
  const explicitBase = process.env.DALPH_COVERAGE_BASE_SHA
  const baseSha = resolveCoverageBase(explicitBase)
  const changedLines = changedProductionLinesFromGit({ baseSha, repositoryRoot })
  const coverage = JSON.parse(readFileSync(resolve(repositoryRoot, coveragePath), "utf8"))
  const results = changedLineCoverageByBracket(coverage, changedLines, repositoryRoot)
  const failures = coverageBracketLineFailures(results)
  if (failures.length > 0) {
    process.stderr.write(`Changed-line coverage failure (base ${baseSha}):\n${failures.join("\n")}\n`)
    process.exitCode = 1
    return
  }
  const lines = Object.entries(results).map(
    ([bracketName, result]) =>
      `Changed ${bracketName} lines: ${formatPercentage(result.percentage)} (${result.coveredLines}/${result.executableLines})`
  )
  process.stdout.write(`${lines.join("; ")}; base ${baseSha}\n`)
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main()
}
