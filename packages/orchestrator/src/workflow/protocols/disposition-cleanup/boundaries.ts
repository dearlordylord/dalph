import { Context, Effect, FileSystem, Layer, Option, Schema } from "effect"
import { GitCommitSha, WorktreeLocator } from "@dalph/contracts"
import {
  CoordinatorOwnership,
  type GitCommonDirectoryTarget
} from "../../../authorities/coordinator-ownership/ownership.js"
import { GitCommand } from "../../../authorities/git/command.js"
import { BranchCleanupBoundary, BranchCleanupMutationResult, BranchCleanupObservation } from "./branch.js"
import {
  IntegratorCandidateCleanupBoundary,
  IntegratorCandidateProviderAuthority,
  unavailableIntegratorCandidateProviderAuthority
} from "./integrator-candidate.js"
import { WorktreeCleanupBoundary, WorktreeCleanupMutationResult, WorktreeCleanupObservation } from "./worktree.js"
import { BranchCleanupEvidenceRevision, WorktreeCleanupEvidenceRevision } from "./disposition.js"
import {
  commandFailure,
  missingReference,
  nonGitPath,
  parseWorktreeRecords,
  probePath,
  resultDetail
} from "./boundary-evidence.js"
export { preservingDispositionCleanupBoundaryLayer } from "./preserving-boundary.js"

export type DispositionCleanupBoundaryServices =
  | WorktreeCleanupBoundary
  | BranchCleanupBoundary
  | IntegratorCandidateCleanupBoundary

const revisionOneWorktree = WorktreeCleanupEvidenceRevision.make(1)
const revisionOneBranch = BranchCleanupEvidenceRevision.make(1)

/**
 * Installs the real Git worktree/branch boundary and an explicitly supplied
 * provider authority for predecessor candidates. A provider authority owns
 * candidate ownership and quiescence; Git object existence is never used as a
 * substitute. Omitting it is a deliberate fail-closed composition.
 */
export const gitDispositionCleanupBoundaryLayer = (
  target: GitCommonDirectoryTarget,
  candidateAuthorityLayer?: Layer.Layer<IntegratorCandidateProviderAuthority>
) => {
  const providerAuthorityLayer =
    candidateAuthorityLayer ??
    Layer.succeed(IntegratorCandidateProviderAuthority, unavailableIntegratorCandidateProviderAuthority)
  const providerMutationIsLive = candidateAuthorityLayer !== undefined
  return Layer.effectContext(
    Effect.gen(function* () {
      const commands = yield* GitCommand
      const fileSystem = yield* FileSystem.FileSystem
      const ownership = yield* CoordinatorOwnership
      const candidateAuthority = yield* IntegratorCandidateProviderAuthority
      const readWorktrees = commands.run(target, ["worktree", "list", "--porcelain"])
      const worktree = WorktreeCleanupBoundary.of({
        observe: (authorization) =>
          Effect.gen(function* () {
            const listed = yield* readWorktrees.pipe(
              Effect.map((result) => ({ result })),
              Effect.catchTag("GitCommandInvocationFailure", (failure) =>
                Effect.succeed({ failure: commandFailure(failure) })
              )
            )
            if ("failure" in listed) {
              return WorktreeCleanupObservation.cases.Unreadable.make({
                detail: listed.failure,
                locator: authorization.locator
              })
            }
            if (listed.result.exitCode !== 0) {
              return WorktreeCleanupObservation.cases.Unreadable.make({
                detail: resultDetail(listed.result.stderr, listed.result.exitCode),
                locator: authorization.locator
              })
            }
            const parsed = parseWorktreeRecords(listed.result.stdout)
            if (parsed._tag === "Malformed") {
              return WorktreeCleanupObservation.cases.Unreadable.make({
                detail: parsed.detail,
                locator: authorization.locator
              })
            }
            const exact = parsed.records.find((record) => record.worktree === authorization.locator)
            if (exact === undefined) {
              const pathProbe = yield* probePath(fileSystem, commands, authorization.locator, [
                "rev-parse",
                "--is-inside-work-tree"
              ])
              if (pathProbe._tag === "Absent") {
                return WorktreeCleanupObservation.cases.Absent.make({
                  locator: authorization.locator,
                  revision: revisionOneWorktree
                })
              }
              if (pathProbe._tag === "Unreadable") {
                return WorktreeCleanupObservation.cases.Unreadable.make({
                  detail: pathProbe.detail,
                  locator: authorization.locator
                })
              }
              if ("failure" in pathProbe.result) {
                return WorktreeCleanupObservation.cases.Unreadable.make({
                  detail: pathProbe.result.failure,
                  locator: authorization.locator
                })
              }
              return nonGitPath(pathProbe.result.stderr) || pathProbe.result.exitCode === 0
                ? WorktreeCleanupObservation.cases.Unregistered.make({
                    locator: authorization.locator,
                    revision: revisionOneWorktree
                  })
                : WorktreeCleanupObservation.cases.Unreadable.make({
                    detail: resultDetail(pathProbe.result.stderr, pathProbe.result.exitCode),
                    locator: authorization.locator
                  })
            }
            if (exact.branch === authorization.owner.branch && exact.head === authorization.expectedHead) {
              return WorktreeCleanupObservation.cases.Present.make({
                attemptId: authorization.owner.attemptId,
                branch: exact.branch,
                headSha: exact.head,
                locator: exact.worktree,
                revision: revisionOneWorktree,
                writerQuiescent: true
              })
            }
            return WorktreeCleanupObservation.cases.Foreign.make({
              locator: authorization.locator,
              observedBranch: exact.branch ?? authorization.owner.branch,
              observedHead: exact.head,
              reason: exact.branch === authorization.owner.branch ? "OtherOwner" : "OtherBranch",
              revision: revisionOneWorktree
            })
          }),
        remove: (authorization) =>
          ownership.runMutation(
            Effect.suspend(() =>
              commands.run(target, ["worktree", "remove", "--force", "--", authorization.locator]).pipe(
                Effect.map((result) =>
                  result.exitCode === 0
                    ? WorktreeCleanupMutationResult.cases.Removed.make({
                        branch: authorization.owner.branch,
                        locator: authorization.locator,
                        revision: revisionOneWorktree
                      })
                    : WorktreeCleanupMutationResult.cases.Unknown.make({
                        branch: authorization.owner.branch,
                        detail: resultDetail(result.stderr, result.exitCode),
                        locator: authorization.locator
                      })
                ),
                Effect.catchTag("GitCommandInvocationFailure", (failure) =>
                  Effect.succeed(
                    WorktreeCleanupMutationResult.cases.Unknown.make({
                      branch: authorization.owner.branch,
                      detail: commandFailure(failure),
                      locator: authorization.locator
                    })
                  )
                )
              )
            )
          )
      })
      const branch = BranchCleanupBoundary.of({
        observe: (authorization) =>
          Effect.gen(function* () {
            const ref = yield* commands.run(target, ["show-ref", "--verify", "--hash", authorization.locator]).pipe(
              Effect.map((result) => ({ result })),
              Effect.catchTag("GitCommandInvocationFailure", (failure) =>
                Effect.succeed({ failure: commandFailure(failure) })
              )
            )
            if ("failure" in ref) {
              return BranchCleanupObservation.cases.Unreadable.make({
                branch: authorization.locator,
                detail: ref.failure
              })
            }
            if (ref.result.exitCode !== 0) {
              if (!missingReference(ref.result.stderr)) {
                return BranchCleanupObservation.cases.Unreadable.make({
                  branch: authorization.locator,
                  detail: resultDetail(ref.result.stderr, ref.result.exitCode)
                })
              }
              const pathProbe = yield* probePath(
                fileSystem,
                commands,
                authorization.disposition.plannedAttempt.worktree,
                ["rev-parse", "--is-inside-work-tree"]
              )
              if (pathProbe._tag === "Absent") {
                return BranchCleanupObservation.cases.Absent.make({
                  branch: authorization.locator,
                  revision: revisionOneBranch
                })
              }
              if (pathProbe._tag === "Unreadable") {
                return BranchCleanupObservation.cases.Unreadable.make({
                  branch: authorization.locator,
                  detail: pathProbe.detail
                })
              }
              if ("failure" in pathProbe.result) {
                return BranchCleanupObservation.cases.Unreadable.make({
                  branch: authorization.locator,
                  detail: pathProbe.result.failure
                })
              }
              return pathProbe.result.exitCode === 0
                ? BranchCleanupObservation.cases.Unreadable.make({
                    branch: authorization.locator,
                    detail: "branch ref is absent but its planned worktree path is still registered"
                  })
                : BranchCleanupObservation.cases.Unreadable.make({
                    branch: authorization.locator,
                    detail: nonGitPath(pathProbe.result.stderr)
                      ? "branch ref is absent but its planned path still exists"
                      : resultDetail(pathProbe.result.stderr, pathProbe.result.exitCode)
                  })
            }
            const head = Option.getOrUndefined(Schema.decodeUnknownOption(GitCommitSha)(ref.result.stdout.trim()))
            if (head === undefined) {
              return BranchCleanupObservation.cases.Unreadable.make({
                branch: authorization.locator,
                detail: "git returned a malformed branch head"
              })
            }
            const worktreeResult = yield* readWorktrees.pipe(
              Effect.map((result) => ({ result })),
              Effect.catchTag("GitCommandInvocationFailure", (failure) =>
                Effect.succeed({ failure: commandFailure(failure) })
              )
            )
            if ("failure" in worktreeResult) {
              return BranchCleanupObservation.cases.Unreadable.make({
                branch: authorization.locator,
                detail: worktreeResult.failure
              })
            }
            if (worktreeResult.result.exitCode !== 0) {
              return BranchCleanupObservation.cases.Unreadable.make({
                branch: authorization.locator,
                detail: resultDetail(worktreeResult.result.stderr, worktreeResult.result.exitCode)
              })
            }
            const parsed = parseWorktreeRecords(worktreeResult.result.stdout)
            if (parsed._tag === "Malformed") {
              return BranchCleanupObservation.cases.Unreadable.make({
                branch: authorization.locator,
                detail: parsed.detail
              })
            }
            const registered =
              parsed.records.find((record) => record.branch === authorization.locator)?.worktree ?? null
            if (registered !== null) {
              return BranchCleanupObservation.cases.Foreign.make({
                branch: authorization.locator,
                observedHead: head,
                observedWorktree: registered,
                reason: "RegisteredWorktree",
                revision: revisionOneBranch
              })
            }
            const pathProbe = yield* probePath(
              fileSystem,
              commands,
              authorization.disposition.plannedAttempt.worktree,
              ["rev-parse", "--is-inside-work-tree"]
            )
            if (pathProbe._tag === "Absent") {
              return head === authorization.expectedHead
                ? BranchCleanupObservation.cases.Present.make({
                    branch: authorization.locator,
                    headSha: head,
                    registeredWorktree: null,
                    revision: revisionOneBranch
                  })
                : BranchCleanupObservation.cases.Foreign.make({
                    branch: authorization.locator,
                    observedHead: head,
                    observedWorktree: WorktreeLocator.make("<unregistered>"),
                    reason: "DifferentHead",
                    revision: revisionOneBranch
                  })
            }
            if (pathProbe._tag === "Unreadable") {
              return BranchCleanupObservation.cases.Unreadable.make({
                branch: authorization.locator,
                detail: pathProbe.detail
              })
            }
            if ("failure" in pathProbe.result) {
              return BranchCleanupObservation.cases.Unreadable.make({
                branch: authorization.locator,
                detail: pathProbe.result.failure
              })
            }
            if (pathProbe.result.exitCode === 0) {
              return BranchCleanupObservation.cases.Foreign.make({
                branch: authorization.locator,
                observedHead: head,
                observedWorktree: authorization.disposition.plannedAttempt.worktree,
                reason: "RegisteredWorktree",
                revision: revisionOneBranch
              })
            }
            return nonGitPath(pathProbe.result.stderr)
              ? BranchCleanupObservation.cases.Unreadable.make({
                  branch: authorization.locator,
                  detail: "branch ref is present but its planned path is not a Git worktree"
                })
              : BranchCleanupObservation.cases.Unreadable.make({
                  branch: authorization.locator,
                  detail: resultDetail(pathProbe.result.stderr, pathProbe.result.exitCode)
                })
          }),
        remove: (authorization) =>
          ownership.runMutation(
            Effect.suspend(() =>
              // `git branch` accepts the local branch name, while the
              // authorization deliberately carries the canonical full ref.
              // Strip only Git's fixed local-ref prefix; the authorization
              // and result remain bound to the exact full ref.
              commands.run(target, ["branch", "-D", "--", authorization.locator.slice("refs/heads/".length)]).pipe(
                Effect.map((result) =>
                  result.exitCode === 0
                    ? BranchCleanupMutationResult.cases.Removed.make({
                        branch: authorization.locator,
                        revision: revisionOneBranch
                      })
                    : BranchCleanupMutationResult.cases.Unknown.make({
                        branch: authorization.locator,
                        detail: resultDetail(result.stderr, result.exitCode)
                      })
                ),
                Effect.catchTag("GitCommandInvocationFailure", (failure) =>
                  Effect.succeed(
                    BranchCleanupMutationResult.cases.Unknown.make({
                      branch: authorization.locator,
                      detail: commandFailure(failure)
                    })
                  )
                )
              )
            )
          )
      })
      const candidate = IntegratorCandidateCleanupBoundary.of({
        observe: candidateAuthority.observe,
        remove: (authorization, attempt) =>
          providerMutationIsLive
            ? ownership.runMutation(Effect.suspend(() => candidateAuthority.remove(authorization, attempt)))
            : candidateAuthority.remove(authorization, attempt)
      })
      return Context.empty().pipe(
        Context.add(WorktreeCleanupBoundary, worktree),
        Context.add(BranchCleanupBoundary, branch),
        Context.add(IntegratorCandidateCleanupBoundary, candidate)
      )
    })
  ).pipe(Layer.provide(providerAuthorityLayer))
}
