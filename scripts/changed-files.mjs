import { execFileSync, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

const gitPaths = (gitArguments, cwd) => {
  const result = spawnSync("git", gitArguments, { cwd, encoding: "utf8" })
  if (result.status !== 0) return []
  return result.stdout.split("\0").filter((path) => path.length > 0)
}

const gitCommit = (reference, cwd) => {
  const result = spawnSync("git", ["rev-parse", "--verify", "--end-of-options", `${reference}^{commit}`], {
    cwd,
    encoding: "utf8"
  })
  return result.status === 0 ? result.stdout.trim() : undefined
}

/** Select the development-loop comparison base and every extant changed path, with reproducible Git evidence. */
export const changedRepositoryFileSelection = ({ baseReference, cwd = process.cwd() }) => {
  const headSha = gitCommit("HEAD", cwd)
  const resolvedBaseSha = gitCommit(baseReference, cwd)
  const mergeBase =
    resolvedBaseSha === undefined
      ? undefined
      : spawnSync("git", ["merge-base", "HEAD", resolvedBaseSha], { cwd, encoding: "utf8" })
  const comparisonBaseSha = mergeBase?.status === 0 ? mergeBase.stdout.trim() : undefined
  const committed =
    comparisonBaseSha === undefined
      ? []
      : gitPaths(
          ["diff", "--name-only", "--no-renames", "-z", "--diff-filter=ACMR", `${comparisonBaseSha}...HEAD`],
          cwd
        )
  const working = gitPaths(["diff", "--name-only", "--no-renames", "-z", "--diff-filter=ACMR", "HEAD"], cwd)
  const untracked = gitPaths(["ls-files", "--others", "--exclude-standard", "-z"], cwd)
  const files = [...new Set([...committed, ...working, ...untracked])]
    .filter((file) => existsSync(join(cwd, file)))
    .toSorted((left, right) => left.localeCompare(right))

  return { baseReference, resolvedBaseSha, comparisonBaseSha, headSha, files }
}

/**
 * Development-loop gates check what this attempt changed: everything since the merge base with the integration
 * reference, plus the working tree. A missing base reference yields the working tree alone rather than the whole
 * repository, so an unfetched worktree checks less instead of checking everything.
 */
export const changedRepositoryFiles = ({ baseReference, cwd = process.cwd() }) =>
  changedRepositoryFileSelection({ baseReference, cwd }).files

const git = (arguments_, cwd) =>
  execFileSync("git", arguments_, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })

const nulDelimitedPaths = (output) => output.split("\0").filter((path) => path !== "")

/**
 * The handoff gate observes every path changed from the frozen candidate through the current worktree. It keeps
 * staged, unstaged, untracked, deleted, and rename-source paths so final applicability cannot be decided from a
 * filtered development-loop list.
 */
export const completeFormalChangedPaths = (baseSha, cwd = process.cwd()) => {
  const repositoryRoot = git(["rev-parse", "--show-toplevel"], cwd).trim()
  const headSha = git(["rev-parse", "--verify", "HEAD^{commit}"], repositoryRoot).trim()
  const diff = (from, ...to) =>
    nulDelimitedPaths(
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
        ...nulDelimitedPaths(
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
        ...nulDelimitedPaths(git(["ls-files", "--full-name", "--others", "--exclude-standard", "-z"], repositoryRoot))
      ])
    ].toSorted((left, right) => left.localeCompare(right))
  }
}
