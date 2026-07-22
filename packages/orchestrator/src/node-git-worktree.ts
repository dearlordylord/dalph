import { Effect, FileSystem, Layer, Schema } from "effect"
import type { GitCommonDirectoryTarget, PlannedTaskAttempt } from "./domain.js"
import { GitCommitSha, TaskBranchRef, WorktreeLocator } from "./domain.js"
import type { GitCommandResult } from "./git-command.js"
import { GitCommand } from "./git-command.js"
import {
  CompetingWorktreeRegistrations,
  ConflictingWorktreeRegistration,
  ContradictoryWorktreeState,
  ForeignWorktreeRegistration,
  GitWorktree,
  GitWorktreeCreateFailure,
  GitWorktreeReadFailure,
  PlannedBranchReady,
  PlannedWorktreeAbsent,
  PlannedWorktreeReady,
  UntrackedWorktreePath,
  WorktreeBaseMismatch
} from "./git-worktree.js"

const WorktreeRecord = Schema.Struct({
  branch: Schema.optionalKey(TaskBranchRef),
  head: GitCommitSha,
  worktree: WorktreeLocator
})
type WorktreeRecord = typeof WorktreeRecord.Type

const successful = (result: GitCommandResult): boolean => result.exitCode === 0

const readFailure = (plan: PlannedTaskAttempt, result: GitCommandResult) =>
  new GitWorktreeReadFailure({
    detail: result.stderr.trim() || `git exited ${result.exitCode}`,
    worktree: plan.worktree
  })

const parseWorktreeRecords = Effect.fn("GitWorktree.Node.parseWorktreeRecords")(
  function*(plan: PlannedTaskAttempt, output: string) {
    return yield* Effect.forEach(
      output.split("\0\0").filter((record) => record.length > 0),
      Effect.fn("GitWorktree.Node.parseWorktreeRecord")(function*(encodedRecord) {
        const entries = encodedRecord.split("\0").map((line) => {
          const separator = line.indexOf(" ")
          return separator < 0 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)]
        })
        for (const field of ["worktree", "HEAD", "branch"]) {
          if (entries.filter(([name]) => name === field).length > 1) {
            return yield* new ContradictoryWorktreeState({
              detail: `Git worktree record repeated the ${field} field`,
              worktree: plan.worktree
            })
          }
        }
        const fields = Object.fromEntries(entries)
        return yield* Schema.decodeUnknownEffect(WorktreeRecord)({
          ...(fields["branch"] === undefined ? {} : { branch: fields["branch"] }),
          head: fields["HEAD"],
          worktree: fields["worktree"]
        }).pipe(
          Effect.mapError((failure) =>
            new ContradictoryWorktreeState({
              detail: `Git worktree record did not satisfy the boundary schema: ${String(failure)}`,
              worktree: plan.worktree
            })
          )
        )
      })
    )
  }
)

const shortBranch = (plan: PlannedTaskAttempt): string => plan.branch.slice("refs/heads/".length)

export const nodeGitWorktreeLayer = (
  gitDirectory: GitCommonDirectoryTarget
) =>
  Layer.effect(
    GitWorktree,
    Effect.gen(function*() {
      const commands = yield* GitCommand
      const fileSystem = yield* FileSystem.FileSystem

      const runRead = Effect.fn("GitWorktree.Node.runRead")(function*(
        plan: PlannedTaskAttempt,
        args: ReadonlyArray<string>
      ) {
        return yield* commands.run(gitDirectory, args).pipe(
          Effect.mapError((failure) =>
            new GitWorktreeReadFailure({
              detail: failure.detail,
              worktree: plan.worktree
            })
          )
        )
      })

      const proveBase = Effect.fn("GitWorktree.Node.proveBase")(function*(
        plan: PlannedTaskAttempt,
        headSha: typeof GitCommitSha.Type
      ) {
        const result = yield* runRead(plan, [
          "merge-base",
          "--is-ancestor",
          plan.baseSha,
          headSha
        ])
        if (successful(result)) return
        if (result.exitCode === 1) {
          return yield* new WorktreeBaseMismatch({
            baseSha: plan.baseSha,
            branch: plan.branch,
            headSha,
            worktree: plan.worktree
          })
        }
        return yield* readFailure(plan, result)
      })

      const readPlannedWorktree = Effect.fn(
        "GitWorktree.Node.readPlannedWorktree"
      )(function*(plan: PlannedTaskAttempt) {
        const list = yield* runRead(plan, ["worktree", "list", "--porcelain", "-z"])
        if (!successful(list)) return yield* readFailure(plan, list)
        const records = yield* parseWorktreeRecords(plan, list.stdout)
        const atPath = records.filter((record) => record.worktree === plan.worktree)
        const onBranch = records.filter((record) => record.branch === plan.branch)
        if (atPath.length > 1 || onBranch.length > 1) {
          return yield* new ContradictoryWorktreeState({
            detail: "Git reported the planned path or branch more than once",
            worktree: plan.worktree
          })
        }
        const pathRecord = atPath[0]
        if (pathRecord !== undefined) {
          if (pathRecord.branch === undefined) {
            return yield* new ContradictoryWorktreeState({
              detail: "The planned worktree is detached from every branch",
              worktree: plan.worktree
            })
          }
          if (pathRecord.branch !== plan.branch) {
            const branchRecord = onBranch[0]
            if (branchRecord !== undefined) {
              return yield* new CompetingWorktreeRegistrations({
                observedBranchAtPlannedWorktree: pathRecord.branch,
                observedHeadAtPlannedWorktree: pathRecord.head,
                plannedBranch: plan.branch,
                plannedBranchRegisteredWorktree: branchRecord.worktree,
                plannedWorktree: plan.worktree
              })
            }
            return yield* new ConflictingWorktreeRegistration({
              observedBranch: pathRecord.branch,
              observedHead: pathRecord.head,
              plannedBranch: plan.branch,
              worktree: plan.worktree
            })
          }
          yield* proveBase(plan, pathRecord.head)
          return PlannedWorktreeReady.make({
            baseSha: plan.baseSha,
            branch: plan.branch,
            headSha: pathRecord.head,
            worktree: plan.worktree
          })
        }
        const branchRecord = onBranch[0]
        if (branchRecord !== undefined) {
          return yield* new ForeignWorktreeRegistration({
            branch: plan.branch,
            plannedWorktree: plan.worktree,
            registeredWorktree: branchRecord.worktree
          })
        }
        const pathExists = yield* fileSystem.exists(plan.worktree).pipe(
          Effect.mapError((failure) =>
            new GitWorktreeReadFailure({
              detail: String(failure),
              worktree: plan.worktree
            })
          )
        )
        if (pathExists) return yield* new UntrackedWorktreePath({ worktree: plan.worktree })

        const branch = yield* runRead(plan, [
          "rev-parse",
          "--verify",
          "--quiet",
          `${plan.branch}^{commit}`
        ])
        if (branch.exitCode === 1) return PlannedWorktreeAbsent.make({})
        if (!successful(branch)) return yield* readFailure(plan, branch)
        const headSha = yield* Schema.decodeUnknownEffect(GitCommitSha)(branch.stdout.trim()).pipe(
          Effect.mapError((failure) =>
            new ContradictoryWorktreeState({
              detail: `Git branch HEAD did not satisfy the SHA boundary: ${String(failure)}`,
              worktree: plan.worktree
            })
          )
        )
        yield* proveBase(plan, headSha)
        return PlannedBranchReady.make({
          baseSha: plan.baseSha,
          branch: plan.branch,
          headSha
        })
      })

      const createPlannedWorktree = Effect.fn(
        "GitWorktree.Node.createPlannedWorktree"
      )(function*(plan: PlannedTaskAttempt) {
        const branch = yield* commands.run(gitDirectory, [
          "rev-parse",
          "--verify",
          "--quiet",
          `${plan.branch}^{commit}`
        ]).pipe(
          Effect.mapError((failure) =>
            new GitWorktreeCreateFailure({
              detail: failure.detail,
              worktree: plan.worktree
            })
          )
        )
        const args = branch.exitCode === 0
          ? ["worktree", "add", plan.worktree, plan.branch]
          : branch.exitCode === 1
          ? ["worktree", "add", "-b", shortBranch(plan), plan.worktree, plan.baseSha]
          : undefined
        if (args === undefined) {
          return yield* new GitWorktreeCreateFailure({
            detail: branch.stderr.trim() || `git show-ref exited ${branch.exitCode}`,
            worktree: plan.worktree
          })
        }
        const result = yield* commands.run(gitDirectory, args).pipe(
          Effect.mapError((failure) =>
            new GitWorktreeCreateFailure({
              detail: failure.detail,
              worktree: plan.worktree
            })
          )
        )
        if (!successful(result)) {
          return yield* new GitWorktreeCreateFailure({
            detail: result.stderr.trim() || `git worktree add exited ${result.exitCode}`,
            worktree: plan.worktree
          })
        }
      })

      return GitWorktree.of({ createPlannedWorktree, readPlannedWorktree })
    })
  )
