import { execFileSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const allZeroSha = /^0+$/u

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

export const planCiChange = (
  { eventName, headSha, pullRequestBaseSha = "", pushBeforeSha = "" },
  listChangedPaths = changedPathsBetween,
  reportFailure = () => undefined
) => {
  const baseSha = resolveComparisonBase({ eventName, pullRequestBaseSha, pushBeforeSha })
  if (baseSha === undefined || headSha === "") return { baseSha: "", docsOnly: false }

  try {
    return { baseSha, docsOnly: classifyChangedPaths(listChangedPaths(baseSha, headSha)) }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    reportFailure(detail)
    return { baseSha, docsOnly: false }
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
    (detail) => process.stderr.write(`Unable to classify the CI change; selecting the comprehensive gate: ${detail}\n`)
  )
  const output = `base-sha=${plan.baseSha}\ndocs-only=${String(plan.docsOnly)}\n`
  if (process.env.GITHUB_OUTPUT === undefined) process.stdout.write(output)
  else appendFileSync(process.env.GITHUB_OUTPUT, output, "utf8")
}
