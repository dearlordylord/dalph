import { Context, Effect, Layer, Option, Schema } from "effect"
import { GitCommitSha, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import {
  CoordinatorOwnership,
  type GitCommonDirectoryTarget
} from "../../../authorities/coordinator-ownership/ownership.js"
import { GitCommand, type GitCommandInvocationFailure } from "../../../authorities/git/command.js"
import { BranchCleanupBoundary, BranchCleanupMutationResult, BranchCleanupObservation } from "./branch.js"
import {
  IntegratorCandidateCleanupBoundary,
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateCleanupObservation,
  unavailableIntegratorCandidateProviderAuthority
} from "./integrator-candidate.js"
import { WorktreeCleanupBoundary, WorktreeCleanupMutationResult, WorktreeCleanupObservation } from "./worktree.js"
import {
  BranchCleanupEvidenceRevision,
  type BranchCleanupAuthorization,
  IntegratorCandidateCleanupEvidenceRevision,
  type IntegratorCandidateCleanupAuthorization,
  type WorktreeCleanupAuthorization,
  WorktreeCleanupEvidenceRevision
} from "./disposition.js"

/**
 * Explicitly installed provider-neutral fallbacks for compositions that do
 * not own a Git repository (controlled workflow and authored cassettes). They
 * preserve every subject and cannot cross a mutation boundary.
 */
export const preservingDispositionCleanupBoundaryLayer = Layer.effectContext(
  Effect.gen(function* () {
    const ownership = yield* CoordinatorOwnership
    const preservingMutation = <A>(makeResult: () => A) =>
      ownership.runMutation(Effect.suspend(() => Effect.succeed(makeResult())))
    return Context.empty().pipe(
      Context.add(WorktreeCleanupBoundary, {
        observe: (authorization: WorktreeCleanupAuthorization) =>
          Effect.succeed(
            WorktreeCleanupObservation.cases.Unreadable.make({
              detail: "no Git worktree boundary is installed for this composition",
              locator: authorization.locator
            })
          ),
        remove: (authorization: WorktreeCleanupAuthorization) =>
          preservingMutation(() =>
            WorktreeCleanupMutationResult.cases.Unknown.make({
              branch: authorization.owner.branch,
              detail: "no Git worktree boundary is installed for this composition",
              locator: authorization.locator
            })
          )
      }),
      Context.add(BranchCleanupBoundary, {
        observe: (authorization: BranchCleanupAuthorization) =>
          Effect.succeed(
            BranchCleanupObservation.cases.Unreadable.make({
              branch: authorization.locator,
              detail: "no Git branch boundary is installed for this composition"
            })
          ),
        remove: (authorization: BranchCleanupAuthorization) =>
          preservingMutation(() =>
            BranchCleanupMutationResult.cases.Unknown.make({
              branch: authorization.locator,
              detail: "no Git branch boundary is installed for this composition"
            })
          )
      }),
      Context.add(IntegratorCandidateCleanupBoundary, {
        observe: (authorization: IntegratorCandidateCleanupAuthorization) =>
          Effect.succeed(
            IntegratorCandidateCleanupObservation.cases.Unreadable.make({
              detail: "no Git candidate boundary is installed for this composition",
              locator: authorization.locator
            })
          ),
        remove: (authorization: IntegratorCandidateCleanupAuthorization) =>
          preservingMutation(() =>
            IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
              detail: "no Git candidate boundary is installed for this composition",
              locator: authorization.locator,
              sessionId: authorization.owner.sessionId
            })
          )
      })
    )
  })
)

export type DispositionCleanupBoundaryServices =
  | WorktreeCleanupBoundary
  | BranchCleanupBoundary
  | IntegratorCandidateCleanupBoundary

const revisionOneWorktree = WorktreeCleanupEvidenceRevision.make(1)
const revisionOneBranch = BranchCleanupEvidenceRevision.make(1)
const revisionOneCandidate = IntegratorCandidateCleanupEvidenceRevision.make(1)

const GitWorktreeRecord = Schema.Struct({
  branch: Schema.optionalKey(TaskBranchRef),
  head: GitCommitSha,
  worktree: WorktreeLocator
})
type GitWorktreeRecord = typeof GitWorktreeRecord.Type

const parseWorktreeRecords = (stdout: string): ReadonlyArray<GitWorktreeRecord> =>
  stdout.split(/\n\n/u).flatMap((block) => {
    const fields = block
      .split("\n")
      .map((line) => {
        const separator = line.indexOf(" ")
        return separator < 0 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)]
      })
      .filter(([name]) => name === "worktree" || name === "HEAD" || name === "branch")
    const values = Object.fromEntries(fields)
    const decoded = Option.getOrUndefined(
      Schema.decodeUnknownOption(GitWorktreeRecord)({
        ...(values["branch"] === undefined ? {} : { branch: values["branch"] }),
        head: values["HEAD"],
        worktree: values["worktree"]
      })
    )
    return decoded === undefined ? [] : [decoded]
  })

const commandFailure = (failure: GitCommandInvocationFailure): string => failure.detail
const resultDetail = (stderr: string, exitCode: number): string => stderr.trim() || `git exited ${exitCode}`
const missingReference = (stderr: string): boolean =>
  /(?:unknown revision|needed a single revision|not a valid object name|does not exist|not found)/iu.test(stderr)

/** Real Git-backed cleanup boundaries used by ordinary production Run activation. */
export const gitDispositionCleanupBoundaryLayer = (target: GitCommonDirectoryTarget) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const commands = yield* GitCommand
      const ownership = yield* CoordinatorOwnership
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
            const exact = parseWorktreeRecords(listed.result.stdout).find(
              (record) => record.worktree === authorization.locator
            )
            if (exact === undefined) {
              const pathProbe = yield* commands
                .runInWorktree(authorization.locator, ["rev-parse", "--is-inside-work-tree"])
                .pipe(
                  Effect.map((result) => ({ result })),
                  Effect.catchTag("GitCommandInvocationFailure", (failure) =>
                    Effect.succeed({ failure: commandFailure(failure) })
                  )
                )
              if ("failure" in pathProbe) {
                return WorktreeCleanupObservation.cases.Unreadable.make({
                  detail: pathProbe.failure,
                  locator: authorization.locator
                })
              }
              return pathProbe.result.exitCode === 0
                ? WorktreeCleanupObservation.cases.Unregistered.make({
                    locator: authorization.locator,
                    revision: revisionOneWorktree
                  })
                : WorktreeCleanupObservation.cases.Absent.make({
                    locator: authorization.locator,
                    revision: revisionOneWorktree
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
              const pathProbe = yield* commands
                .runInWorktree(authorization.disposition.plannedAttempt.worktree, [
                  "rev-parse",
                  "--is-inside-work-tree"
                ])
                .pipe(
                  Effect.map((result) => ({ result })),
                  Effect.catchTag("GitCommandInvocationFailure", (failure) =>
                    Effect.succeed({ failure: commandFailure(failure) })
                  )
                )
              if ("failure" in pathProbe) {
                return BranchCleanupObservation.cases.Unreadable.make({
                  branch: authorization.locator,
                  detail: pathProbe.failure
                })
              }
              return pathProbe.result.exitCode === 0
                ? BranchCleanupObservation.cases.Unreadable.make({
                    branch: authorization.locator,
                    detail: "branch ref is absent but its planned worktree path is still registered"
                  })
                : BranchCleanupObservation.cases.Absent.make({
                    branch: authorization.locator,
                    revision: revisionOneBranch
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
            const registered =
              parseWorktreeRecords(worktreeResult.result.stdout).find(
                (record) => record.branch === authorization.locator
              )?.worktree ?? null
            if (registered !== null) {
              return BranchCleanupObservation.cases.Foreign.make({
                branch: authorization.locator,
                observedHead: head,
                observedWorktree: registered,
                reason: "RegisteredWorktree",
                revision: revisionOneBranch
              })
            }
            const pathProbe = yield* commands
              .runInWorktree(authorization.disposition.plannedAttempt.worktree, ["rev-parse", "--is-inside-work-tree"])
              .pipe(
                Effect.map((result) => ({ result })),
                Effect.catchTag("GitCommandInvocationFailure", (failure) =>
                  Effect.succeed({ failure: commandFailure(failure) })
                )
              )
            if ("failure" in pathProbe) {
              return BranchCleanupObservation.cases.Unreadable.make({
                branch: authorization.locator,
                detail: pathProbe.failure
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
          }),
        remove: (authorization) =>
          ownership.runMutation(
            Effect.suspend(() =>
              commands.run(target, ["branch", "-D", "--", authorization.locator]).pipe(
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
      const providerAuthority = unavailableIntegratorCandidateProviderAuthority
      const candidate = IntegratorCandidateCleanupBoundary.of({
        observe: providerAuthority.observe,
        remove: (authorization) =>
          ownership.runMutation(
            Effect.suspend(() =>
              commands.run(target, ["update-ref", "-d", "--", authorization.locator]).pipe(
                Effect.map((result) =>
                  result.exitCode === 0
                    ? IntegratorCandidateCleanupMutationResult.cases.Removed.make({
                        locator: authorization.locator,
                        revision: revisionOneCandidate,
                        sessionId: authorization.owner.sessionId
                      })
                    : IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
                        detail: resultDetail(result.stderr, result.exitCode),
                        locator: authorization.locator,
                        sessionId: authorization.owner.sessionId
                      })
                ),
                Effect.catchTag("GitCommandInvocationFailure", (failure) =>
                  Effect.succeed(
                    IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
                      detail: commandFailure(failure),
                      locator: authorization.locator,
                      sessionId: authorization.owner.sessionId
                    })
                  )
                )
              )
            )
          )
      })
      return Context.empty().pipe(
        Context.add(WorktreeCleanupBoundary, worktree),
        Context.add(BranchCleanupBoundary, branch),
        Context.add(IntegratorCandidateCleanupBoundary, candidate)
      )
    })
  )
