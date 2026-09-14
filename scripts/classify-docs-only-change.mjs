import { execFileSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

import { hostedFormalInputManifestPath, parseHostedFormalInputManifest } from "./hosted-formal-input-manifest.mjs"

const allZeroSha = /^0+$/u
const commitSha = /^[0-9a-f]{40}$/u

/** Paths that cannot change Dalph runtime, repository tooling, or executable evaluation. */
export const isDocsOnlyPath = (path) =>
  path === "README.md" ||
  path.startsWith("docs/") ||
  /^(?:packages|prototypes)\/[^/]+\/README\.md$/u.test(path) ||
  /^research\/.*\.(?:md|png|jpe?g|gif|svg|webp)$/u.test(path) ||
  /^\.github\/(?:ISSUE_TEMPLATE\/.*\.md|PULL_REQUEST_TEMPLATE\.md)$/u.test(path)

export const classifyChangedPaths = (paths) => paths.length > 0 && paths.every(isDocsOnlyPath)

export const resolveComparisonBase = ({ eventName, pullRequestBaseSha, pushBeforeSha }) => {
  if (eventName === "pull_request" && pullRequestBaseSha !== "") return pullRequestBaseSha
  if (eventName === "push" && pushBeforeSha !== "" && !allZeroSha.test(pushBeforeSha)) return pushBeforeSha
  return undefined
}

export const changedPathsBetween = (baseSha, headSha, cwd = process.cwd()) => {
  const output = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", "--diff-filter=ACDMRTUXB", baseSha, headSha, "--"],
    { cwd }
  )
  return output
    .toString("utf8")
    .split("\0")
    .filter((path) => path !== "")
}

const manifestAtCommit = (sha, cwd) =>
  parseHostedFormalInputManifest(
    execFileSync("git", ["show", `${sha}:${hostedFormalInputManifestPath}`], { cwd, encoding: "utf8" })
  )

/** A deletion remains governed by taking the union of the exact base and head projections. */
export const hostedFormalInputPathsBetween = (baseSha, headSha, cwd = process.cwd()) => [
  ...new Set([...manifestAtCommit(baseSha, cwd).paths, ...manifestAtCommit(headSha, cwd).paths])
]

export const classifyFormalChangedPaths = (changedPaths, formalInputPaths) => {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0)
    throw new Error("The exact base-to-head path set is empty")
  if (
    changedPaths.some(
      (path) =>
        typeof path !== "string" ||
        path === "" ||
        path.startsWith("/") ||
        path.includes("\\") ||
        path.split("/").some((part) => part === "" || part === "." || part === "..")
    )
  )
    throw new Error("The exact base-to-head path set contains a non-canonical repository path")
  if (!Array.isArray(formalInputPaths) || formalInputPaths.length === 0)
    throw new Error("The hosted formal input projection is unavailable")
  const governed = new Set(formalInputPaths)
  return changedPaths.filter((path) => governed.has(path)).sort((left, right) => left.localeCompare(right))
}

const unavailablePlan = ({ baseSha = "", headSha = "", reason }) => ({
  baseSha,
  headSha,
  docsOnly: false,
  formalRequired: true,
  formalClassification: {
    version: 1,
    status: "unavailable",
    baseSha,
    headSha,
    changedPaths: [],
    affectedPaths: [],
    reason
  }
})

export const planCiChange = (
  { eventName, headSha, pullRequestBaseSha = "", pushBeforeSha = "" },
  listChangedPaths = changedPathsBetween,
  listFormalInputPaths = hostedFormalInputPathsBetween,
  reportFailure = () => undefined
) => {
  const unavailable = (input) => {
    reportFailure(input.reason)
    return unavailablePlan(input)
  }
  const baseSha = resolveComparisonBase({ eventName, pullRequestBaseSha, pushBeforeSha })
  if (baseSha === undefined)
    return unavailable({ headSha, reason: "The event has no supported nonzero comparison base" })
  if (!commitSha.test(baseSha) || !commitSha.test(headSha) || allZeroSha.test(headSha))
    return unavailable({ baseSha, headSha, reason: "The event base or head is not an exact commit SHA" })

  try {
    const changedPaths = listChangedPaths(baseSha, headSha)
    const affectedPaths = classifyFormalChangedPaths(changedPaths, listFormalInputPaths(baseSha, headSha))
    const formalRequired = affectedPaths.length > 0
    return {
      baseSha,
      headSha,
      docsOnly: classifyChangedPaths(changedPaths),
      formalRequired,
      formalClassification: {
        version: 1,
        status: formalRequired ? "affected" : "unaffected",
        baseSha,
        headSha,
        changedPaths,
        affectedPaths
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return unavailable({ baseSha, headSha, reason: detail })
  }
}

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url

if (invokedDirectly) {
  const plan = planCiChange(
    {
      eventName: process.env.DALPH_CI_EVENT_NAME ?? "",
      headSha: process.env.DALPH_CI_HEAD_SHA ?? "",
      pullRequestBaseSha: process.env.DALPH_CI_PULL_REQUEST_BASE_SHA ?? "",
      pushBeforeSha: process.env.DALPH_CI_PUSH_BEFORE_SHA ?? ""
    },
    changedPathsBetween,
    hostedFormalInputPathsBetween,
    (detail) => process.stderr.write(`Unable to classify the CI change; selecting the comprehensive gate: ${detail}\n`)
  )
  const output = [
    `base-sha=${plan.baseSha}`,
    `head-sha=${plan.headSha}`,
    `docs-only=${String(plan.docsOnly)}`,
    `formal-required=${String(plan.formalRequired)}`,
    `formal-classification=${JSON.stringify(plan.formalClassification)}`,
    ""
  ].join("\n")
  if (process.env.GITHUB_OUTPUT === undefined) process.stdout.write(output)
  else appendFileSync(process.env.GITHUB_OUTPUT, output, "utf8")
}
