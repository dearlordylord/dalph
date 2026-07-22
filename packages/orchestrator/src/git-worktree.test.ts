import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { describe, expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TaskWorkSessionLocator,
  WorktreeLocator
} from "./domain.js"
import {
  ConflictingWorktreeRegistration,
  ContradictoryWorktreeState,
  GitWorktree,
  GitWorktreeCreateFailure,
  gitWorktreeTestLayer,
  PlannedBranchReady,
  PlannedWorktreeAbsent,
  PlannedWorktreeReady,
  runGitWorktreeReconciliation,
  TestGitWorktree,
  WorktreeBaseMismatch
} from "./git-worktree.js"

const baseSha = GitCommitSha.make("0123456789abcdef0123456789abcdef01234567")
const plan = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-45"),
  baseSha,
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-45"),
  executor: TaskExecutorLocator.make("executor:test"),
  runId: RunId.make("run-45"),
  session: TaskWorkSessionLocator.make("session:45"),
  taskId: TaskId.make("task-45"),
  taskRevision: TaskRevision.make("revision-45"),
  worktree: WorktreeLocator.make("/worktrees/attempt-45")
})

describe("GitWorktree contract", () => {
  it.effect("creates the exact absent worktree and proves Base is HEAD's ancestor", () =>
    Effect.gen(function*() {
      const git = yield* GitWorktree
      const testGit = yield* TestGitWorktree

      const ready = yield* runGitWorktreeReconciliation(git, plan)

      expect(ready).toEqual(PlannedWorktreeReady.make({
        baseSha,
        branch: plan.branch,
        headSha: baseSha,
        worktree: plan.worktree
      }))
      expect(yield* testGit.createRequests()).toEqual([plan])
    }).pipe(Effect.provide(gitWorktreeTestLayer(PlannedWorktreeAbsent.make({})))))

  it.effect("rediscovers an exact existing worktree without creating another", () =>
    Effect.gen(function*() {
      const git = yield* GitWorktree
      const testGit = yield* TestGitWorktree
      const existing = PlannedWorktreeReady.make({
        baseSha,
        branch: plan.branch,
        headSha: GitCommitSha.make("abcdef0123456789abcdef0123456789abcdef01"),
        worktree: plan.worktree
      })

      expect(yield* runGitWorktreeReconciliation(git, plan)).toEqual(existing)
      expect(yield* testGit.createRequests()).toEqual([])
    }).pipe(Effect.provide(gitWorktreeTestLayer(PlannedWorktreeReady.make({
      baseSha,
      branch: plan.branch,
      headSha: GitCommitSha.make("abcdef0123456789abcdef0123456789abcdef01"),
      worktree: plan.worktree
    })))))

  it.effect("rejects mismatched branch-ready evidence without creating resources", () =>
    Effect.gen(function*() {
      const git = yield* GitWorktree
      const testGit = yield* TestGitWorktree
      const failure = yield* runGitWorktreeReconciliation(git, plan).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(ContradictoryWorktreeState)
      yield* testGit.setObservation(PlannedBranchReady.make({
        baseSha: GitCommitSha.make("ffffffffffffffffffffffffffffffffffffffff"),
        branch: plan.branch,
        headSha: baseSha
      }))
      expect(yield* runGitWorktreeReconciliation(git, plan).pipe(Effect.flip))
        .toBeInstanceOf(ContradictoryWorktreeState)
      expect(yield* testGit.createRequests()).toEqual([])
    }).pipe(Effect.provide(gitWorktreeTestLayer(PlannedBranchReady.make({
      baseSha,
      branch: TaskBranchRef.make("refs/heads/foreign"),
      headSha: baseSha
    })))))

  it.effect("rejects a ready proof for a different planned resource", () => {
    const foreignProof = PlannedWorktreeReady.make({
      baseSha,
      branch: TaskBranchRef.make("refs/heads/foreign"),
      headSha: baseSha,
      worktree: plan.worktree
    })
    const layer = Layer.succeed(
      GitWorktree,
      GitWorktree.of({
        createPlannedWorktree: () => Effect.die("foreign proof must not mutate Git"),
        readPlannedWorktree: () => Effect.succeed(foreignProof)
      })
    )
    return Effect.gen(function*() {
      const git = yield* GitWorktree
      expect(yield* Effect.flip(runGitWorktreeReconciliation(git, plan)))
        .toBeInstanceOf(ContradictoryWorktreeState)
    }).pipe(Effect.provide(layer))
  })

  it.effect("stops on a Base mismatch without requesting branch repair", () => {
    const mismatch = new WorktreeBaseMismatch({
      baseSha,
      branch: plan.branch,
      headSha: GitCommitSha.make("ffffffffffffffffffffffffffffffffffffffff"),
      worktree: plan.worktree
    })
    const layer = Layer.succeed(
      GitWorktree,
      GitWorktree.of({
        createPlannedWorktree: () => Effect.die("base mismatch must not mutate Git"),
        readPlannedWorktree: () => Effect.fail(mismatch)
      })
    )
    return Effect.gen(function*() {
      const git = yield* GitWorktree
      expect(yield* Effect.flip(runGitWorktreeReconciliation(git, plan))).toEqual(mismatch)
    }).pipe(Effect.provide(layer))
  })

  it.effect("preserves a conflicting registration as a typed reconciliation fact", () => {
    const conflict = new ConflictingWorktreeRegistration({
      observedBranch: TaskBranchRef.make("refs/heads/foreign"),
      observedHead: baseSha,
      plannedBranch: plan.branch,
      worktree: plan.worktree
    })
    const layer = Layer.succeed(
      GitWorktree,
      GitWorktree.of({
        createPlannedWorktree: () => Effect.die("conflicting Git state must not be changed"),
        readPlannedWorktree: () => Effect.fail(conflict)
      })
    )
    return Effect.gen(function*() {
      const git = yield* GitWorktree
      expect(yield* Effect.flip(runGitWorktreeReconciliation(git, plan))).toEqual(conflict)
    }).pipe(Effect.provide(layer))
  })

  it.effect("rereads Git after an uncertain create result before returning the failure", () => {
    const failure = new GitWorktreeCreateFailure({
      detail: "git command return was unavailable",
      worktree: plan.worktree
    })
    let reads = 0
    const layer = Layer.succeed(
      GitWorktree,
      GitWorktree.of({
        createPlannedWorktree: () => Effect.fail(failure),
        readPlannedWorktree: () =>
          Effect.sync(() => {
            reads += 1
            return PlannedWorktreeAbsent.make({})
          })
      })
    )
    return Effect.gen(function*() {
      const git = yield* GitWorktree
      expect(yield* Effect.flip(runGitWorktreeReconciliation(git, plan))).toEqual(failure)
      expect(reads).toBe(2)
    }).pipe(Effect.provide(layer))
  })

  it.effect("preserves mismatched branch evidence after an uncertain create", () => {
    const createFailure = new GitWorktreeCreateFailure({
      detail: "git command return was unavailable",
      worktree: plan.worktree
    })
    let reads = 0
    const layer = Layer.succeed(
      GitWorktree,
      GitWorktree.of({
        createPlannedWorktree: () => Effect.fail(createFailure),
        readPlannedWorktree: () =>
          Effect.sync(() => {
            reads += 1
            return reads === 1
              ? PlannedWorktreeAbsent.make({})
              : PlannedBranchReady.make({
                baseSha,
                branch: TaskBranchRef.make("refs/heads/foreign-after-create"),
                headSha: baseSha
              })
          })
      })
    )
    return Effect.gen(function*() {
      const git = yield* GitWorktree
      const failure = yield* runGitWorktreeReconciliation(git, plan).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(ContradictoryWorktreeState)
      expect(failure).not.toEqual(createFailure)
      expect(reads).toBe(2)
    }).pipe(Effect.provide(layer))
  })

  it.effect("rejects a successful create acknowledgement without a matching fresh observation", () => {
    const layer = Layer.succeed(
      GitWorktree,
      GitWorktree.of({
        createPlannedWorktree: () => Effect.void,
        readPlannedWorktree: () => Effect.succeed(PlannedWorktreeAbsent.make({}))
      })
    )
    return Effect.gen(function*() {
      const git = yield* GitWorktree
      expect(yield* Effect.flip(runGitWorktreeReconciliation(git, plan)))
        .toBeInstanceOf(GitWorktreeCreateFailure)
    }).pipe(Effect.provide(layer))
  })

  it.effect("lets tests replace the next authoritative observation", () =>
    Effect.gen(function*() {
      const git = yield* GitWorktree
      const testGit = yield* TestGitWorktree
      const ready = PlannedWorktreeReady.make({
        baseSha,
        branch: plan.branch,
        headSha: baseSha,
        worktree: plan.worktree
      })
      yield* testGit.setObservation(ready)
      expect(yield* git.readPlannedWorktree(plan)).toEqual(ready)
    }).pipe(Effect.provide(gitWorktreeTestLayer(PlannedWorktreeAbsent.make({})))))
})
