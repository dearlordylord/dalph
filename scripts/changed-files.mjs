import { spawnSync } from "node:child_process"
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
