import { execFileSync } from "node:child_process"

/**
 * These documentation locations describe development or presentation. The two exact output-budget paths count
 * quality/preflight console lines without participating in formal execution or dispatch; their callers remain governed.
 */
const isUnrelatedToFormalExecution = (path) =>
  path === "README.md" ||
  path === "docs/DEVELOPMENT.md" ||
  path === "scripts/quality-output-budget.mjs" ||
  path === "scripts/quality-output-budget.test.ts" ||
  /^(?:packages|prototypes)\/[^/]+\/README\.md$/u.test(path) ||
  /^research\/.*\.(?:md|png|jpe?g|gif|svg|webp)$/u.test(path) ||
  /^\.github\/(?:ISSUE_TEMPLATE\/.*\.md|PULL_REQUEST_TEMPLATE\.md)$/u.test(path)

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
const paths = (output) => output.split("\0").filter((path) => path !== "")

/** Compare the exact commit, index, working tree and untracked paths. No rename source or deletion is discarded. */
export const completeFormalChangedPaths = (baseSha, cwd = process.cwd()) => {
  const repositoryRoot = git(["rev-parse", "--show-toplevel"], cwd).trim()
  const headSha = git(["rev-parse", "--verify", "HEAD^{commit}"], repositoryRoot).trim()
  const diff = (from, ...to) =>
    paths(
      git(
        [
          "diff",
          "--name-only",
          "--no-renames",
          "--no-relative",
          "--no-ext-diff",
          "-z",
          "--diff-filter=ACDMRTUXB",
          from,
          ...to,
          "--"
        ],
        repositoryRoot
      )
    )
  return {
    headSha,
    changedFiles: [
      ...new Set([
        ...diff(baseSha, headSha),
        ...diff("HEAD"),
        ...paths(
          git(
            [
              "diff",
              "--cached",
              "--name-only",
              "--no-renames",
              "--no-relative",
              "--no-ext-diff",
              "-z",
              "--diff-filter=ACDMRTUXB",
              "HEAD",
              "--"
            ],
            repositoryRoot
          )
        ),
        ...paths(git(["ls-files", "--full-name", "--others", "--exclude-standard", "-z"], repositoryRoot))
      ])
    ].toSorted((left, right) => left.localeCompare(right))
  }
}

/** An unreadable comparison never proves that formal execution is unrelated. */
export const selectFinalQuintGate = (baseSha, cwd = process.cwd()) => {
  try {
    if (typeof baseSha !== "string" || !/^(?:[a-f\d]{40}|[a-f\d]{64})$/u.test(baseSha) || /^0+$/u.test(baseSha)) {
      throw new Error("An explicit exact commit SHA is required via --candidate=<base sha>")
    }
    if (git(["rev-parse", "--verify", `${baseSha}^{commit}`], cwd).trim() !== baseSha) {
      throw new Error("The comparison base is not an exact commit SHA")
    }
    const comparison = completeFormalChangedPaths(baseSha, cwd)
    const requiredFiles = comparison.changedFiles.filter((file) => !isUnrelatedToFormalExecution(file))
    if (comparison.changedFiles.length === 0) {
      return { ...comparison, baseSha, full: true, reason: "Empty diff cannot prove an unrelated change" }
    }
    return {
      ...comparison,
      baseSha,
      full: requiredFiles.length > 0,
      reason:
        requiredFiles.length > 0
          ? `Full formal gate required by: ${requiredFiles.join(", ")}`
          : "Skip exhaustive models: every changed path is allowlisted as unrelated to formal execution"
    }
  } catch (error) {
    return {
      baseSha: baseSha ?? "",
      full: true,
      changedFiles: [],
      reason: `Unable to prove an unrelated exact diff; full formal gate required: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
