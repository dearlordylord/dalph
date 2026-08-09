// @effect-diagnostics lazyEffect:off
import { Context, Effect, Layer, Ref, Schema } from "effect"
import type { CoordinatorOwnershipError } from "../coordinator-ownership/ownership.js"
import { type PlannedTaskAttempt } from "@dalph/contracts"
import { GitCommitSha, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"

/** Proves Git's current HEAD descends from the exact Base SHA declared by the planned task attempt. */
export const PlannedWorktreeReady = Schema.TaggedStruct("PlannedWorktreeReady", {
  baseSha: GitCommitSha,
  branch: TaskBranchRef,
  headSha: GitCommitSha,
  worktree: WorktreeLocator
})
export type PlannedWorktreeReady = typeof PlannedWorktreeReady.Type

/** The exact planned branch exists without a registered worktree and descends from Base. */
export const PlannedBranchReady = Schema.TaggedStruct("PlannedBranchReady", {
  baseSha: GitCommitSha,
  branch: TaskBranchRef,
  headSha: GitCommitSha
})
export type PlannedBranchReady = typeof PlannedBranchReady.Type

/** Git reports neither the planned branch nor the planned worktree path. */
// The observation carries no plan copy because its caller already owns the immutable plan.
export const PlannedWorktreeAbsent = Schema.TaggedStruct("PlannedWorktreeAbsent", {})
export type PlannedWorktreeAbsent = typeof PlannedWorktreeAbsent.Type

/** The planned path exists but Git does not register it as a worktree. */
export class UntrackedWorktreePath extends Schema.TaggedError<UntrackedWorktreePath>()("UntrackedWorktreePath", {
  worktree: WorktreeLocator
}) {}

/** The planned branch is registered at a different worktree and remains untouched. */
export class ForeignWorktreeRegistration extends Schema.TaggedError<ForeignWorktreeRegistration>()(
  "ForeignWorktreeRegistration",
  { branch: TaskBranchRef, plannedWorktree: WorktreeLocator, registeredWorktree: WorktreeLocator }
) {}

/** The planned path is registered to a different branch and remains untouched. */
export class ConflictingWorktreeRegistration extends Schema.TaggedError<ConflictingWorktreeRegistration>()(
  "ConflictingWorktreeRegistration",
  { observedBranch: TaskBranchRef, observedHead: GitCommitSha, plannedBranch: TaskBranchRef, worktree: WorktreeLocator }
) {}

/** The planned path and branch are each registered to different competing resources. */
export class CompetingWorktreeRegistrations extends Schema.TaggedError<CompetingWorktreeRegistrations>()(
  "CompetingWorktreeRegistrations",
  {
    observedBranchAtPlannedWorktree: TaskBranchRef,
    observedHeadAtPlannedWorktree: GitCommitSha,
    plannedBranch: TaskBranchRef,
    plannedBranchRegisteredWorktree: WorktreeLocator,
    plannedWorktree: WorktreeLocator
  }
) {}

/** The declared Base is not an ancestor of current HEAD; Dalph never repairs the branch. */
export class WorktreeBaseMismatch extends Schema.TaggedError<WorktreeBaseMismatch>()("WorktreeBaseMismatch", {
  baseSha: GitCommitSha,
  branch: TaskBranchRef,
  headSha: GitCommitSha,
  worktree: WorktreeLocator
}) {}

/** Git returned mutually inconsistent branch/worktree facts which require operator repair. */
export class ContradictoryWorktreeState extends Schema.TaggedError<ContradictoryWorktreeState>()(
  "ContradictoryWorktreeState",
  { detail: Schema.String, worktree: WorktreeLocator }
) {}

export class GitWorktreeReadFailure extends Schema.TaggedError<GitWorktreeReadFailure>()("GitWorktreeReadFailure", {
  detail: Schema.String,
  worktree: WorktreeLocator
}) {}

export class GitWorktreeCreateFailure extends Schema.TaggedError<GitWorktreeCreateFailure>()(
  "GitWorktreeCreateFailure",
  { detail: Schema.String, worktree: WorktreeLocator }
) {}

type GitWorktreeReconciliationFact =
  | CompetingWorktreeRegistrations
  | ConflictingWorktreeRegistration
  | ContradictoryWorktreeState
  | ForeignWorktreeRegistration
  | UntrackedWorktreePath
  | WorktreeBaseMismatch

export type GitWorktreeObservationError = GitWorktreeReadFailure | GitWorktreeReconciliationFact

export interface GitWorktreeService {
  readonly createPlannedWorktree: (
    plannedAttempt: PlannedTaskAttempt
  ) => Effect.Effect<void, CoordinatorOwnershipError | GitWorktreeCreateFailure>
  readonly readPlannedWorktree: (
    plannedAttempt: PlannedTaskAttempt
  ) => Effect.Effect<PlannedBranchReady | PlannedWorktreeAbsent | PlannedWorktreeReady, GitWorktreeObservationError>
}

export class GitWorktree extends Context.Service<GitWorktree, GitWorktreeService>()("@dalph/GitWorktree") {}

export class TestGitWorktree extends Context.Service<
  TestGitWorktree,
  {
    readonly createRequests: () => Effect.Effect<ReadonlyArray<PlannedTaskAttempt>>
    readonly setObservation: (
      observation: PlannedBranchReady | PlannedWorktreeAbsent | PlannedWorktreeReady
    ) => Effect.Effect<void>
  }
>()("@dalph/GitWorktree/Test") {}

/** Deterministic Git contract used by workflow and reconciliation tests. */
export const gitWorktreeTestLayer = (
  initialObservation: PlannedBranchReady | PlannedWorktreeAbsent | PlannedWorktreeReady
) =>
  Layer.effectContext(
    Effect.gen(function* () {
      type Observation = PlannedBranchReady | PlannedWorktreeAbsent | PlannedWorktreeReady
      const defaultObservation = yield* Ref.make<Observation>(initialObservation)
      const observationsByWorktree = yield* Ref.make<ReadonlyMap<WorktreeLocator, Observation>>(new Map())
      const requests = yield* Ref.make<ReadonlyArray<PlannedTaskAttempt>>([])
      const service = GitWorktree.of({
        createPlannedWorktree: Effect.fn("GitWorktree.Test.createPlannedWorktree")(function* (plan) {
          yield* Ref.update(requests, (current) => [...current, plan])
          yield* Ref.update(observationsByWorktree, (current) =>
            new Map(current).set(
              plan.worktree,
              PlannedWorktreeReady.make({
                baseSha: plan.baseSha,
                branch: plan.branch,
                headSha: plan.baseSha,
                worktree: plan.worktree
              })
            )
          )
        }),
        readPlannedWorktree: Effect.fn("GitWorktree.Test.readPlannedWorktree")(function* (plan) {
          const observations = yield* Ref.get(observationsByWorktree)
          return observations.get(plan.worktree) ?? (yield* Ref.get(defaultObservation))
        })
      })
      return Context.empty().pipe(
        Context.add(GitWorktree, service),
        Context.add(TestGitWorktree, {
          createRequests: () => Ref.get(requests),
          setObservation: (value) =>
            Ref.set(defaultObservation, value).pipe(Effect.andThen(Ref.set(observationsByWorktree, new Map())))
        })
      )
    })
  )

export const runGitWorktreeReconciliation = Effect.fn("GitWorktree.runReconciliation")(function* (
  git: GitWorktreeService,
  plannedAttempt: PlannedTaskAttempt
) {
  const requireExactProof = (proof: PlannedWorktreeReady) =>
    proof.baseSha === plannedAttempt.baseSha &&
    proof.branch === plannedAttempt.branch &&
    proof.worktree === plannedAttempt.worktree
      ? Effect.succeed(proof)
      : Effect.fail(
          new ContradictoryWorktreeState({
            detail: "Git returned a ready proof for different planned resources",
            worktree: plannedAttempt.worktree
          })
        )
  const requireExactObservation = (
    observation: PlannedBranchReady | PlannedWorktreeAbsent | PlannedWorktreeReady
  ): Effect.Effect<PlannedBranchReady | PlannedWorktreeAbsent | PlannedWorktreeReady, ContradictoryWorktreeState> =>
    observation._tag === "PlannedWorktreeReady"
      ? requireExactProof(observation)
      : observation._tag === "PlannedBranchReady" &&
          (observation.baseSha !== plannedAttempt.baseSha || observation.branch !== plannedAttempt.branch)
        ? Effect.fail(
            new ContradictoryWorktreeState({
              detail: "Git returned branch-ready evidence for different planned resources",
              worktree: plannedAttempt.worktree
            })
          )
        : Effect.succeed(observation)
  const initial = yield* git.readPlannedWorktree(plannedAttempt).pipe(Effect.flatMap(requireExactObservation))
  if (initial._tag === "PlannedWorktreeReady") return initial

  const request = yield* git.createPlannedWorktree(plannedAttempt).pipe(Effect.result)
  const observed = yield* git.readPlannedWorktree(plannedAttempt).pipe(Effect.flatMap(requireExactObservation))
  if (observed._tag === "PlannedWorktreeReady") return observed
  if (request._tag === "Failure") return yield* request.failure
  return yield* new GitWorktreeCreateFailure({
    detail: "Git acknowledged worktree creation but a fresh read still reports it absent",
    worktree: plannedAttempt.worktree
  })
})
