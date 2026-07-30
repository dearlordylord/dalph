import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  CompetingWorktreeRegistrations,
  ConflictingWorktreeRegistration,
  ContradictoryWorktreeState,
  ForeignWorktreeRegistration,
  type GitWorktreeService,
  PlannedBranchReady,
  PlannedWorktreeAbsent,
  PlannedWorktreeReady,
  UntrackedWorktreePath,
  WorktreeBaseMismatch
} from "../../../authorities/git/worktree.js"
import {
  AttemptWorktreeLost,
  observePlannedAttemptWorktree,
  plannedAttemptWorktreeObservationMatchesPlan
} from "./protocol.js"

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("typed-worktree-observation-attempt"),
  baseSha: GitCommitSha.make("9".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/typed-worktree-observation"),
  executor: TaskExecutorLocator.make("executor:controlled-fake"),
  runId: RunId.make("typed-worktree-observation-run"),
  taskId: TaskId.make("typed-worktree-observation-task"),
  taskRevision: TaskRevision.make("typed-worktree-observation-revision"),
  worktree: WorktreeLocator.make("/worktrees/typed-worktree-observation")
})

it.effect("keeps foreign and competing worktree registrations distinct from loss", () =>
  Effect.gen(function* () {
    const creates = yield* Ref.make(0)
    const observations = [
      new ForeignWorktreeRegistration({
        branch: plannedAttempt.branch,
        plannedWorktree: plannedAttempt.worktree,
        registeredWorktree: WorktreeLocator.make("/worktrees/foreign")
      }),
      new CompetingWorktreeRegistrations({
        observedBranchAtPlannedWorktree: TaskBranchRef.make("refs/heads/foreign"),
        observedHeadAtPlannedWorktree: GitCommitSha.make("a".repeat(40)),
        plannedBranch: plannedAttempt.branch,
        plannedBranchRegisteredWorktree: WorktreeLocator.make("/worktrees/registered-elsewhere"),
        plannedWorktree: plannedAttempt.worktree
      })
    ] as const

    for (const observation of observations) {
      const git: GitWorktreeService = {
        createPlannedWorktree: () => Ref.update(creates, (count) => count + 1),
        readPlannedWorktree: () => Effect.fail(observation)
      }
      expect(yield* observePlannedAttemptWorktree(git, plannedAttempt)).toEqual(observation)
      expect(plannedAttemptWorktreeObservationMatchesPlan(observation, plannedAttempt)).toBe(true)
    }
    expect(yield* Ref.get(creates)).toBe(0)
  })
)

it.effect("returns every exact read outcome without creating or repairing a worktree", () =>
  Effect.gen(function* () {
    const otherBranch = TaskBranchRef.make("refs/heads/dalph/other")
    const otherHead = GitCommitSha.make("a".repeat(40))
    const ready = PlannedWorktreeReady.make({
      baseSha: plannedAttempt.baseSha,
      branch: plannedAttempt.branch,
      headSha: plannedAttempt.baseSha,
      worktree: plannedAttempt.worktree
    })
    const typedObservations = [
      new ConflictingWorktreeRegistration({
        observedBranch: otherBranch,
        observedHead: otherHead,
        plannedBranch: plannedAttempt.branch,
        worktree: plannedAttempt.worktree
      }),
      new ContradictoryWorktreeState({ detail: "contradictory", worktree: plannedAttempt.worktree }),
      new UntrackedWorktreePath({ worktree: plannedAttempt.worktree }),
      new WorktreeBaseMismatch({
        baseSha: plannedAttempt.baseSha,
        branch: plannedAttempt.branch,
        headSha: otherHead,
        worktree: plannedAttempt.worktree
      })
    ] as const
    const reads = [
      { input: Effect.succeed(ready), output: ready },
      {
        input: Effect.succeed(
          PlannedBranchReady.make({
            baseSha: plannedAttempt.baseSha,
            branch: plannedAttempt.branch,
            headSha: plannedAttempt.baseSha
          })
        ),
        output: AttemptWorktreeLost.make({ plannedAttempt })
      },
      { input: Effect.succeed(PlannedWorktreeAbsent.make({})), output: AttemptWorktreeLost.make({ plannedAttempt }) },
      ...typedObservations.map((observation) => ({ input: Effect.fail(observation), output: observation }))
    ]

    for (const read of reads) {
      const git: GitWorktreeService = {
        createPlannedWorktree: () => Effect.die("read-only observation must not create"),
        readPlannedWorktree: () => read.input
      }
      expect(yield* observePlannedAttemptWorktree(git, plannedAttempt)).toEqual(read.output)
      expect(plannedAttemptWorktreeObservationMatchesPlan(read.output, plannedAttempt)).toBe(true)
    }
  })
)
