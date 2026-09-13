import { execFileSync, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"

const gitLines = (gitArguments) => {
  const result = spawnSync("git", gitArguments, { encoding: "utf8" })
  if (result.status !== 0) return []
  return result.stdout.split("\n").filter((line) => line.length > 0)
}

/**
 * Development-loop gates check what this attempt changed: everything since the merge base with the integration
 * reference, plus the working tree. A missing base reference yields the working tree alone rather than the whole
 * repository, so an unfetched worktree checks less instead of checking everything.
 */
export const changedRepositoryFiles = ({ baseReference }) => {
  const mergeBase = spawnSync("git", ["merge-base", "HEAD", baseReference], { encoding: "utf8" })
  const committed =
    mergeBase.status === 0
      ? gitLines(["diff", "--name-only", "--diff-filter=ACMR", `${mergeBase.stdout.trim()}...HEAD`])
      : []
  const working = gitLines(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"])
  const untracked = gitLines(["ls-files", "--others", "--exclude-standard"])
  return [...new Set([...committed, ...working, ...untracked])].filter((file) => existsSync(file))
}

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
