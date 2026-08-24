import { AcceptedResultEvidenceManifest, plannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Effect } from "effect"
import type { GitCommitSha, PlannedTaskAttempt } from "@dalph/contracts"
import type { GitCommand } from "@dalph/orchestrator"

/** Shared local Git/evidence boundaries keep hermetic scenario fixtures aligned. */
const requireSuccessfulGit = Effect.fn("HermeticScenario.requireSuccessfulGit")(function* (
  result: Effect.Success<ReturnType<GitCommand["Service"]["run"]>>,
  description: string
) {
  if (result.exitCode !== 0) return yield* Effect.die(`${description}: ${result.stderr}`)
  return result.stdout.trim()
})

export const runInWorktree = Effect.fn("HermeticScenario.runInWorktree")(function* (
  git: GitCommand["Service"],
  worktree: string,
  args: ReadonlyArray<string>,
  description: string
) {
  return yield* requireSuccessfulGit(yield* git.runInWorktree(worktree, args), description)
})

export const runInGitDirectory = Effect.fn("HermeticScenario.runInGitDirectory")(function* (
  git: GitCommand["Service"],
  directory: string,
  args: ReadonlyArray<string>,
  description: string
) {
  return yield* requireSuccessfulGit(yield* git.run(directory, args), description)
})

export const acceptedManifestBytes = (plannedAttempt: PlannedTaskAttempt, commit: GitCommitSha): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify(
      AcceptedResultEvidenceManifest.make({
        commit,
        correlation: plannedAttemptExecutorCorrelation(plannedAttempt),
        formatVersion: 1,
        outcome: "Accepted",
        predecessor: null
      })
    )
  )
