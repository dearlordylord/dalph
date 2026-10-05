import { type GitCommitSha, type IntegrationTarget } from "@dalph/contracts"
import { Effect } from "effect"
import { RemoteBaselineFailure } from "../../workflow/protocols/direct-publication/baseline-events.js"
import type { GitCommandService } from "./command.js"
import { failureReasonForCommand, runBounded, type RemoteOperationDeadline } from "./direct-publication-command.js"

import { decodeGitWorktreeRegistrations } from "./worktree-registration.js"

const proveUnoccupied = Effect.fn("RemoteBaselineGit.proveUnoccupied")(function* (
  output: string,
  target: IntegrationTarget
) {
  const registrations = yield* decodeGitWorktreeRegistrations(output).pipe(
    Effect.mapError(() => new RemoteBaselineFailure({ reason: "TargetUnreadable" }))
  )
  if (registrations.some((registration) => String(registration.branch) === String(target.ref))) {
    return yield* new RemoteBaselineFailure({ reason: "TargetUnreadable" })
  }
})

/**
 * update-ref does not protect a checked-out branch's index or files. Under the
 * coordinator's cooperative Git ownership, admit only a direct, unoccupied ref;
 * dirty/clean occupied targets and ambiguous registrations both fail closed.
 */
export const proveLocalCatchUpSafe = Effect.fn("RemoteBaselineGit.proveLocalCatchUpSafe")(function* (
  commands: GitCommandService,
  target: IntegrationTarget,
  expectedLocalHead: GitCommitSha,
  remoteHead: GitCommitSha,
  deadline: RemoteOperationDeadline
) {
  const read = (args: ReadonlyArray<string>) =>
    runBounded(commands, target.repository, args, deadline).pipe(
      Effect.mapError(
        (failure) => new RemoteBaselineFailure({ reason: failureReasonForCommand(failure, "TargetUnreadable") })
      )
    )
  const symbolic = yield* read(["symbolic-ref", "--quiet", target.ref])
  if (symbolic.exitCode !== 1 || symbolic.stdout.length !== 0) {
    return yield* new RemoteBaselineFailure({ reason: "TargetUnreadable" })
  }
  const registrations = yield* read(["worktree", "list", "--porcelain", "-z"])
  if (registrations.exitCode !== 0) return yield* new RemoteBaselineFailure({ reason: "TargetUnreadable" })
  yield* proveUnoccupied(registrations.stdout, target)
  const ancestry = yield* read(["merge-base", "--is-ancestor", expectedLocalHead, remoteHead])
  if (ancestry.exitCode !== 0) return yield* new RemoteBaselineFailure({ reason: "AncestryUnavailable" })
})
