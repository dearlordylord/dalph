import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { coverageBracketForPath, coveragePolicy } from "./coverage-policy.mjs"
import { completeFormalChangedPaths } from "./final-quint-selection.mjs"
import { readRunEvidence } from "./gate-run-evidence.mjs"
import { currentSourceInputDigest } from "./gate-run-identity.mjs"
import {
  changedLineCoverageByBracket,
  changedLinesFromDiff,
  coverageBracketLineFailures
} from "./verify-changed-coverage.mjs"
import { coverageBracketSummaries, coverageBracketThresholdFailures } from "./verify-coverage-summary.mjs"

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
const count = (value) => Number.isSafeInteger(value) && value >= 0
const location = (value) =>
  object(value) &&
  Number.isSafeInteger(value.line) &&
  value.line > 0 &&
  (value.column === null || value.column === undefined || count(value.column))
const range = (value) =>
  object(value) && location(value.start) && location(value.end) && value.end.line >= value.start.line
const unavailableBranchLocation = (value) =>
  object(value) &&
  object(value.start) &&
  object(value.end) &&
  Object.keys(value.start).length === 0 &&
  Object.keys(value.end).length === 0
const sourcePath = (path, root) => {
  const normalized = path.startsWith("file://") ? fileURLToPath(path) : path
  const result = relative(resolve(root), resolve(root, normalized))
  if (result === ".." || result.startsWith("../") || isAbsolute(result))
    throw new Error(`Coverage path is outside the repository: ${path}`)
  return result.replaceAll("\\", "/")
}

/** Reject missing occurrence counts and locations instead of inventing uncovered or covered evidence. */
export const validateCoverageArtifact = (coverage, root) => {
  if (!object(coverage) || Object.keys(coverage).length === 0)
    throw new Error("Coverage artifact must contain file entries")
  const normalized = {}
  for (const [key, file] of Object.entries(coverage)) {
    if (!object(file)) throw new Error(`Invalid coverage entry: ${key}`)
    const path = sourcePath(file.path ?? key, root)
    if (normalized[path] !== undefined) throw new Error(`Duplicate coverage path: ${path}`)
    for (const [mapName, countsName] of [
      ["statementMap", "s"],
      ["fnMap", "f"],
      ["branchMap", "b"]
    ]) {
      const map = file[mapName]
      const counts = file[countsName]
      if (!object(map) || !object(counts)) throw new Error(`${path}: missing ${mapName} or ${countsName}`)
      if (Object.keys(map).length !== Object.keys(counts).length)
        throw new Error(`${path}: inconsistent ${mapName}/${countsName} keys`)
      for (const [id, entry] of Object.entries(map)) {
        const hits = counts[id]
        if (!object(entry)) throw new Error(`${path}: invalid ${mapName}[${id}]`)
        if (countsName === "b") {
          if (
            !range(entry.loc) ||
            !Array.isArray(entry.locations) ||
            !entry.locations.every((loc) => range(loc) || (entry.type === "if" && unavailableBranchLocation(loc))) ||
            !Array.isArray(hits) ||
            hits.length !== entry.locations.length ||
            !hits.every(count)
          ) {
            throw new Error(`${path}: invalid branch locations/counts for ${id}`)
          }
        } else if (!count(hits) || !range(countsName === "s" ? entry : entry.loc)) {
          throw new Error(`${path}: invalid ${mapName} location/count for ${id}`)
        }
      }
    }
    if (file.l !== undefined) {
      if (!object(file.l) || Object.entries(file.l).some(([line, hits]) => !/^[1-9]\d*$/u.test(line) || !count(hits))) {
        throw new Error(`${path}: invalid line counts`)
      }
      const statementLines = new Map()
      for (const [id, entry] of Object.entries(file.statementMap)) {
        const line = String(entry.start.line)
        statementLines.set(line, Math.max(statementLines.get(line) ?? 0, file.s[id]))
      }
      if (
        Object.keys(file.l).length !== statementLines.size ||
        [...statementLines.keys()].some((line) => file.l[line] === undefined)
      ) {
        throw new Error(`${path}: line counts do not include exactly the executable statement-start lines`)
      }
      if ([...statementLines].some(([line, hits]) => file.l[line] !== hits)) {
        throw new Error(`${path}: line counts disagree with statement-start hits`)
      }
    }
    normalized[path] = { ...file, path }
  }
  return normalized
}

const uncoveredLocations = (coverage) =>
  Object.entries(coverage).flatMap(([path, file]) => {
    const bracket = coverageBracketForPath(path)
    if (bracket === undefined) return []
    const lines = new Map()
    if (file.l !== undefined) {
      for (const [line, hits] of Object.entries(file.l)) lines.set(Number(line), hits)
    } else {
      for (const [id, loc] of Object.entries(file.statementMap))
        lines.set(loc.start.line, Math.max(lines.get(loc.start.line) ?? 0, file.s[id]))
    }
    return [
      ...[...lines]
        .filter(([, hits]) => hits === 0)
        .map(([line]) => ({ path, bracket, metric: "lines", line, hits: 0 })),
      ...Object.entries(file.statementMap)
        .filter(([id]) => file.s[id] === 0)
        .map(([id, loc]) => ({ path, bracket, metric: "statements", id, hits: 0, location: loc })),
      ...Object.entries(file.fnMap)
        .filter(([id]) => file.f[id] === 0)
        .map(([id, fn]) => ({ path, bracket, metric: "functions", id, name: fn.name, hits: 0, location: fn.loc })),
      ...Object.entries(file.branchMap).flatMap(([id, branch]) =>
        branch.locations.flatMap((loc, arm) =>
          file.b[id][arm] === 0
            ? [
                {
                  path,
                  bracket,
                  metric: "branches",
                  id,
                  arm,
                  hits: 0,
                  ...(unavailableBranchLocation(loc)
                    ? {
                        locationUnavailable: "Istanbul supplied no source range for this implicit branch arm",
                        containingBranchLocation: branch.loc
                      }
                    : { location: loc })
                }
              ]
            : []
        )
      )
    ]
  })

const denominatorComparison = (current, baseline) =>
  Object.fromEntries(
    Object.keys(coveragePolicy.brackets).map((bracket) => [
      bracket,
      Object.fromEntries(
        coveragePolicy.metrics.map((metric) => [
          metric,
          {
            current: current[bracket].total[metric].total,
            baseline: baseline[bracket].total[metric].total,
            delta: current[bracket].total[metric].total - baseline[bracket].total[metric].total
          }
        ])
      )
    ])
  )

/** This is artifact analysis, never qualification. Freshness requires source/base/artifact provenance supplied by the gate. */
export const explainCoverageArtifact = ({
  baselineCoverage,
  baseSha,
  changedFiles,
  changedLines,
  currentSourcePaths = changedFiles,
  coverage,
  repositoryRoot
}) => {
  const validated = validateCoverageArtifact(coverage, repositoryRoot)
  const brackets = coverageBracketSummaries(validated)
  const changed = changedLineCoverageByBracket(validated, changedLines, repositoryRoot)
  const missingFiles = currentSourcePaths.filter(
    (path) => coverageBracketForPath(path) !== undefined && validated[path] === undefined
  )
  return {
    version: 1,
    freshness: { status: "unproven", reason: "No matching source/base/artifact provenance has been supplied" },
    baseSha,
    changedFiles,
    pathsOutsideCoveragePolicy: changedFiles.filter((path) => coverageBracketForPath(path) === undefined),
    brackets,
    changed,
    uncovered: uncoveredLocations(validated),
    incomplete: missingFiles.map((path) => ({ path, reason: "Current source has no coverage entry" })),
    thresholdFailures: [...coverageBracketThresholdFailures(validated), ...coverageBracketLineFailures(changed)],
    denominatorComparison:
      baselineCoverage === undefined
        ? { status: "unavailable", reason: "No baseline coverage artifact supplied" }
        : {
            status: "available",
            baselineProvenance: "unproven; comparison uses the explicitly supplied artifact only",
            brackets: denominatorComparison(
              brackets,
              coverageBracketSummaries(validateCoverageArtifact(baselineCoverage, repositoryRoot))
            )
          }
  }
}

const reusedCoverageVerdict = (evidence, artifact) => {
  const provenance = evidence.coverageProvenance
  const original = provenance?.origin?.coverage?.final
  const copy = provenance?.copy?.coverage?.final
  if (
    provenance?.kind !== "reused" ||
    provenance.compositeValidated !== true ||
    evidence.resume?.complete !== true ||
    provenance.origin?.outcome !== "passed" ||
    provenance.origin.subtreeProven !== true ||
    original?.sha256 !== artifact.sha256 ||
    original?.bytes !== artifact.bytes ||
    copy?.path !== artifact.path ||
    copy.sha256 !== artifact.sha256 ||
    copy.bytes !== artifact.bytes ||
    provenance.copy.directory !== dirname(artifact.path)
  )
    return undefined
  try {
    const bytes = readFileSync(original.path)
    if (bytes.length !== original.bytes || createHash("sha256").update(bytes).digest("hex") !== original.sha256) {
      return { status: "stale", reason: "Original reused coverage artifact no longer matches its captured evidence" }
    }
  } catch {
    return { status: "unproven", reason: "Original reused coverage artifact is unavailable" }
  }
  return {
    stageOutcome: "passed",
    provenance: {
      kind: "reused",
      stageId: provenance.stageId,
      originRunId: provenance.origin.runId,
      originObligationId: provenance.origin.obligationId
    }
  }
}

/** Fresh artifacts are diagnostic evidence only; the gate's qualification result remains independently owned. */
export const coverageArtifactFreshness = ({
  artifactBytes,
  artifactPath,
  baseSha,
  currentSourceDigest,
  evidence,
  repositoryRoot
}) => {
  if (evidence === undefined || evidence.version !== 1)
    return { status: "unproven", reason: "Missing or incompatible run evidence" }
  if (
    evidence.worktree !== repositoryRoot ||
    evidence.baseSha !== baseSha ||
    evidence.sourceInputDigest !== currentSourceDigest
  ) {
    return {
      status: "stale",
      reason: "Run worktree, coverage base or source inputs do not match the current candidate",
      runId: evidence.runId
    }
  }
  const artifact = evidence.coverage?.final
  const hash = createHash("sha256").update(artifactBytes).digest("hex")
  if (artifact === undefined)
    return { status: "unproven", reason: "Run has no captured coverage artifact", runId: evidence.runId }
  if (artifact.path !== artifactPath || artifact.bytes !== artifactBytes.length || artifact.sha256 !== hash) {
    return {
      status: "stale",
      reason: "Coverage artifact path, size or hash does not match captured evidence",
      runId: evidence.runId
    }
  }
  const stage = evidence.stages.find(
    (entry) =>
      entry.coverage?.final?.path === artifact.path &&
      entry.coverage.final.sha256 === artifact.sha256 &&
      entry.coverage.final.bytes === artifact.bytes
  )
  const reused = stage === undefined ? reusedCoverageVerdict(evidence, artifact) : undefined
  if (reused?.status !== undefined) return { ...reused, runId: evidence.runId }
  const stageProven =
    stage !== undefined &&
    stage.groupAbsent === true &&
    Number.isSafeInteger(stage.exitCode) &&
    /^(?:passed|failed|exit:\d+)$/u.test(stage.outcome)
  if (
    (!stageProven && reused === undefined) ||
    evidence.registration !== "closed" ||
    evidence.custody !== "stopped" ||
    evidence.terminal?.sourceUnchanged !== true
  ) {
    return {
      status: "unproven",
      reason: "Coverage stage or completed unchanged-source run evidence is missing or partial",
      runId: evidence.runId
    }
  }
  return {
    status: "fresh",
    reason: "Captured artifact and completed coverage stage match this exact source/base/worktree",
    runId: evidence.runId,
    stageOutcome: stage?.outcome ?? reused.stageOutcome,
    ...(reused === undefined ? {} : { provenance: reused.provenance }),
    gateQualification: evidence.qualification
  }
}

const git = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))

export const coverageExplanationFromFiles = ({
  baseSha,
  coveragePath,
  baselineCoveragePath,
  cwd = process.cwd(),
  runId
}) => {
  if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/u.test(baseSha ?? "") || /^0+$/u.test(baseSha))
    throw new Error("Use --candidate=<exact commit SHA>")
  const root = git(["rev-parse", "--show-toplevel"], cwd).trim()
  if (git(["rev-parse", "--verify", `${baseSha}^{commit}`], root).trim() !== baseSha)
    throw new Error("Coverage base is not an exact commit SHA")
  let evidence
  let evidenceFailure
  let sourceDigest
  if (runId !== undefined) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(runId))
      throw new Error("Invalid gate run ID")
    try {
      const commonDirectory = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], root).trim()
      evidence = readRunEvidence({ runDirectory: join(commonDirectory, "dalph-gates", "runs", runId), runId })
      sourceDigest = currentSourceInputDigest(root)
    } catch (error) {
      evidenceFailure = error instanceof Error ? error.message : String(error)
    }
  }
  const artifactPath = resolve(
    root,
    coveragePath ??
      evidence?.coverage?.final?.path ??
      (runId === undefined
        ? "coverage/coverage-final.json"
        : join(root, ".scratch", "quality-gates", runId, "coverage", "coverage-final.json"))
  )
  const artifactBytes = readFileSync(artifactPath)
  const { changedFiles } = completeFormalChangedPaths(baseSha, root)
  const diff = git(
    [
      "-c",
      "core.quotepath=false",
      "-c",
      "diff.noprefix=false",
      "-c",
      "color.ui=false",
      "diff",
      "--no-color",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--unified=0",
      "--no-ext-diff",
      "--no-renames",
      "--no-relative",
      baseSha,
      "--"
    ],
    root
  )
  // The existing diff parser cannot safely associate quoted or multiline path headers. Refuse rather than misattribute lines.
  if (diff.split("\n").some((line) => line.startsWith('+++ "')))
    throw new Error("Changed-path diff contains quoted paths; changed-line evidence is unavailable")
  const changedLines = changedLinesFromDiff(diff)
  const untracked = git(["ls-files", "--others", "--exclude-standard", "--full-name", "-z"], root)
    .split("\0")
    .filter(Boolean)
  for (const path of untracked) {
    if (coverageBracketForPath(path) === undefined) continue
    const lines = readFileSync(resolve(root, path), "utf8").split(/\r?\n/u)
    if (lines.at(-1) === "") lines.pop()
    changedLines.set(path, new Set(lines.map((_, index) => index + 1)))
  }
  const currentSourcePaths = git(["ls-files", "--cached", "--others", "--exclude-standard", "--full-name", "-z"], root)
    .split("\0")
    .filter(
      (path) => coverageBracketForPath(path) !== undefined && /\.ts$/u.test(path) && existsSync(resolve(root, path))
    )
  const explanation = explainCoverageArtifact({
    currentSourcePaths: [...new Set(currentSourcePaths)],
    coverage: JSON.parse(artifactBytes.toString("utf8")),
    baselineCoverage: baselineCoveragePath === undefined ? undefined : readJson(resolve(root, baselineCoveragePath)),
    repositoryRoot: root,
    baseSha,
    changedLines,
    changedFiles
  })
  if (runId !== undefined) {
    explanation.freshness =
      evidenceFailure === undefined
        ? coverageArtifactFreshness({
            artifactBytes,
            artifactPath,
            baseSha,
            currentSourceDigest: sourceDigest,
            evidence,
            repositoryRoot: root
          })
        : { status: "unproven", reason: `Run evidence unavailable: ${evidenceFailure}`, runId }
    if (explanation.freshness.status === "fresh" && currentSourceInputDigest(root) !== sourceDigest) {
      explanation.freshness = { status: "stale", reason: "Source inputs changed during explanation", runId }
    }
  }
  if (explanation.freshness.status === "fresh" && explanation.incomplete.length > 0) {
    explanation.freshness = {
      status: "unproven",
      reason: "Captured artifact is incomplete for current source files",
      runId
    }
  }
  return explanation
}

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url
if (invokedDirectly) {
  try {
    const options = new Map(
      process.argv.slice(2).map((argument) => {
        const match = /^--(candidate|coverage|baseline-coverage|run)=(.+)$/u.exec(argument)
        if (match === null) throw new Error(`Unsupported coverage explanation argument: ${argument}`)
        return [match[1], match[2]]
      })
    )
    const explanation = coverageExplanationFromFiles({
      baseSha: options.get("candidate"),
      coveragePath: options.get("coverage"),
      baselineCoveragePath: options.get("baseline-coverage"),
      runId: options.get("run")
    })
    process.stdout.write(`${JSON.stringify(explanation, null, 2)}\n`)
    // Successful analysis does not certify threshold compliance or full-gate qualification.
    process.exitCode = explanation.freshness.status === "fresh" && explanation.incomplete.length === 0 ? 0 : 1
  } catch (error) {
    process.stderr.write(
      `Coverage explanation unavailable: ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  }
}
