import { Context, Effect, Layer, Option, Schema } from "effect"
import { GitCommitSha, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import { GitCommonDirectoryTarget } from "../../../authorities/coordinator-ownership/ownership.js"
import { GitCommand, GitCommandInvocationFailure } from "../../../authorities/git/command.js"
import {
  BranchCleanupBoundary,
  BranchCleanupMutationResult,
  BranchCleanupObservation
} from "./branch.js"
import {
  IntegratorCandidateCleanupBoundary,
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateCleanupObservation
} from "./integrator-candidate.js"
import {
  WorktreeCleanupBoundary,
  WorktreeCleanupMutationResult,
  WorktreeCleanupObservation
} from "./worktree.js"
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
  Effect.succeed(
    Context.empty().pipe(
      Context.add(WorktreeCleanupBoundary, {
        observe: (authorization: WorktreeCleanupAuthorization) =>
          Effect.succeed(
            WorktreeCleanupObservation.cases.Unreadable.make({
              detail: "no Git worktree boundary is installed for this composition",
              locator: authorization.locator
            })
          ),
        remove: (authorization: WorktreeCleanupAuthorization) =>
          Effect.succeed(
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
          Effect.succeed(
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
          Effect.succeed(
            IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
              detail: "no Git candidate boundary is installed for this composition",
              locator: authorization.locator,
              sessionId: authorization.owner.sessionId
            })
          )
      })
    )
  )
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
      const readWorktrees = commands.run(target, ["worktree", "list", "--porcelain"])
      const worktree = WorktreeCleanupBoundary.of({
        observe: (authorization) =>
          readWorktrees.pipe(
            Effect.map((result) => {
              if (result.exitCode !== 0) {
                return WorktreeCleanupObservation.cases.Unreadable.make({
                  detail: resultDetail(result.stderr, result.exitCode),
                  locator: authorization.locator
                })
              }
              const records = parseWorktreeRecords(result.stdout)
              const exact = records.find((record) => record.worktree === authorization.locator)
              if (exact === undefined) {
                return WorktreeCleanupObservation.cases.Absent.make({
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
            Effect.catchTag("GitCommandInvocationFailure", (failure) =>
              Effect.succeed(
                WorktreeCleanupObservation.cases.Unreadable.make({
                  detail: commandFailure(failure),
                  locator: authorization.locator
                })
              )
            )
          ),
        remove: (authorization) =>
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
      })
      const branch = BranchCleanupBoundary.of({
        observe: (authorization) =>
          Effect.gen(function* () {
            const ref = yield* commands
              .run(target, ["show-ref", "--verify", "--hash", authorization.locator])
              .pipe(
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
              return missingReference(ref.result.stderr)
                ? BranchCleanupObservation.cases.Absent.make({
                    branch: authorization.locator,
                    revision: revisionOneBranch
                  })
                : BranchCleanupObservation.cases.Unreadable.make({
                    branch: authorization.locator,
                    detail: resultDetail(ref.result.stderr, ref.result.exitCode)
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
            const registered =
              worktreeResult.result.exitCode === 0
                ? parseWorktreeRecords(worktreeResult.result.stdout).find(
                    (record) => record.branch === authorization.locator
                  )?.worktree ?? null
                : null
            if (registered !== null) {
              return BranchCleanupObservation.cases.Foreign.make({
                branch: authorization.locator,
                observedHead: head,
                observedWorktree: registered,
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
      })
      const candidate = IntegratorCandidateCleanupBoundary.of({
        observe: (authorization) =>
          commands.run(target, ["rev-parse", "--verify", "--end-of-options", `${authorization.locator}^{object}`]).pipe(
            Effect.map((result) =>
              result.exitCode === 0
                ? IntegratorCandidateCleanupObservation.cases.Present.make({
                    locator: authorization.locator,
                    revision: revisionOneCandidate,
                    sessionId: authorization.owner.sessionId,
                    writerQuiescent: true
                  })
                : missingReference(result.stderr)
                  ? IntegratorCandidateCleanupObservation.cases.Absent.make({
                      locator: authorization.locator,
                      revision: revisionOneCandidate
                    })
                  : IntegratorCandidateCleanupObservation.cases.Unreadable.make({
                      detail: resultDetail(result.stderr, result.exitCode),
                      locator: authorization.locator
                    })
            ),
            Effect.catchTag("GitCommandInvocationFailure", (failure) =>
              Effect.succeed(
                IntegratorCandidateCleanupObservation.cases.Unreadable.make({
                  detail: commandFailure(failure),
                  locator: authorization.locator
                })
              )
            )
          ),
        remove: (authorization) =>
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
      })
      return Context.empty().pipe(
        Context.add(WorktreeCleanupBoundary, worktree),
        Context.add(BranchCleanupBoundary, branch),
        Context.add(IntegratorCandidateCleanupBoundary, candidate)
      )
    })
  )
