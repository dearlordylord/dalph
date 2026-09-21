import { AcceptedResultEvidenceManifest, GitCommitSha, plannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Effect, Layer } from "effect"
import type { PlannedTaskAttempt } from "@dalph/contracts"
import {
  LocalTargetCatchUpResult,
  RemoteBaselineFailure,
  RemoteBaselineGit,
  RemoteBaselineObservation,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateCleanupObservation,
  IntegratorCandidateProviderAuthority,
  type GitCommand
} from "@dalph/orchestrator"

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

/** Controlled baseline authority that reports the actual local target head used by a hermetic fixture. */
export const remoteBaselineGitLayerForCurrentHead = (git: GitCommand["Service"]) =>
  Layer.succeed(
    RemoteBaselineGit,
    RemoteBaselineGit.of({
      catchUp: (_correlation, _expectedLocalHead, remoteHead) =>
        Effect.succeed(LocalTargetCatchUpResult.cases.AlreadyCurrent.make({ currentHead: remoteHead })),
      observe: (correlation) =>
        runInGitDirectory(
          git,
          correlation.localTarget.repository,
          ["rev-parse", correlation.localTarget.ref],
          "read hermetic remote baseline"
        ).pipe(
          Effect.mapError(() => new RemoteBaselineFailure({ reason: "TargetUnreadable" })),
          Effect.map((head) => {
            const currentHead = GitCommitSha.make(head)
            return RemoteBaselineObservation.cases.Aligned.make({ localHead: currentHead, remoteHead: currentHead })
          })
        ),
      reconcileCatchUp: (_correlation, _expectedLocalHead, remoteHead) =>
        Effect.succeed(LocalTargetCatchUpResult.cases.AlreadyCurrent.make({ currentHead: remoteHead }))
    })
  )

/** Provider fixture that can prove a candidate is already absent and settle its cleanup responsibility. */
export const hermeticCandidateProviderAuthority = IntegratorCandidateProviderAuthority.of({
  readEvidenceRevision: () => Effect.succeed(IntegratorCandidateCleanupEvidenceRevision.make(1)),
  observe: (authorization) =>
    Effect.succeed(
      IntegratorCandidateCleanupObservation.cases.Absent.make({
        locator: authorization.locator,
        revision: IntegratorCandidateCleanupEvidenceRevision.make(1)
      })
    ),
  remove: (authorization) =>
    Effect.succeed(
      IntegratorCandidateCleanupMutationResult.cases.Removed.make({
        locator: authorization.locator,
        revision: IntegratorCandidateCleanupEvidenceRevision.make(1),
        sessionId: authorization.owner.sessionId
      })
    )
})
