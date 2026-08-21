import { Effect, Match, Schema } from "effect"
import { PlannedTaskAttempt, plannedTaskAttemptEquivalence } from "@dalph/contracts"
import {
  CompetingWorktreeRegistrations,
  ConflictingWorktreeRegistration,
  ContradictoryWorktreeState,
  ForeignWorktreeRegistration,
  type GitWorktreeReadFailure,
  type GitWorktreeService,
  PlannedWorktreeReady,
  UntrackedWorktreePath,
  WorktreeBaseMismatch
} from "../../../authorities/git/worktree.js"

export { PlannedWorktreeReady } from "../../../authorities/git/worktree.js"

/** Git no longer registers the exact worktree previously proven ready for this planned attempt. */
export const AttemptWorktreeLost = Schema.TaggedStruct("AttemptWorktreeLost", { plannedAttempt: PlannedTaskAttempt })
export type AttemptWorktreeLost = typeof AttemptWorktreeLost.Type

/** One read-only Git check of the exact worktree required by a planned attempt. */
export const PlannedAttemptWorktreeObservation = Schema.Union([
  PlannedWorktreeReady,
  AttemptWorktreeLost,
  UntrackedWorktreePath,
  ForeignWorktreeRegistration,
  ConflictingWorktreeRegistration,
  CompetingWorktreeRegistrations,
  WorktreeBaseMismatch,
  ContradictoryWorktreeState
])
export type PlannedAttemptWorktreeObservation = typeof PlannedAttemptWorktreeObservation.Type

/** Proves every plan-owned locator in one Git outcome belongs to the exact read intent. */
// eslint-disable-next-line complexity -- Each closed Git observation variant names a different subset of plan-owned fields.
export const plannedAttemptWorktreeObservationMatchesPlan = (
  observation: PlannedAttemptWorktreeObservation,
  plannedAttempt: PlannedTaskAttempt
): boolean =>
  Match.valueTags(observation, {
    AttemptWorktreeLost: ({ plannedAttempt: observedAttempt }) =>
      plannedTaskAttemptEquivalence(observedAttempt, plannedAttempt),
    CompetingWorktreeRegistrations: (observation) =>
      observation.plannedBranch === plannedAttempt.branch && observation.plannedWorktree === plannedAttempt.worktree,
    ConflictingWorktreeRegistration: (observation) =>
      observation.plannedBranch === plannedAttempt.branch && observation.worktree === plannedAttempt.worktree,
    ContradictoryWorktreeState: ({ worktree }) => worktree === plannedAttempt.worktree,
    UntrackedWorktreePath: ({ worktree }) => worktree === plannedAttempt.worktree,
    ForeignWorktreeRegistration: (observation) =>
      observation.branch === plannedAttempt.branch && observation.plannedWorktree === plannedAttempt.worktree,
    PlannedWorktreeReady: (observation) =>
      observation.baseSha === plannedAttempt.baseSha &&
      observation.branch === plannedAttempt.branch &&
      observation.worktree === plannedAttempt.worktree,
    WorktreeBaseMismatch: (observation) =>
      observation.baseSha === plannedAttempt.baseSha &&
      observation.branch === plannedAttempt.branch &&
      observation.worktree === plannedAttempt.worktree
  })

export const observePlannedAttemptWorktree = Effect.fn("GitWorktree.observePlannedAttemptWorktree")(function* (
  git: GitWorktreeService,
  plannedAttempt: PlannedTaskAttempt
): Effect.fn.Return<PlannedAttemptWorktreeObservation, GitWorktreeReadFailure> {
  const observation = yield* git
    .readPlannedWorktree(plannedAttempt)
    .pipe(
      Effect.catchTags({
        CompetingWorktreeRegistrations: (failure) => Effect.succeed(failure),
        ConflictingWorktreeRegistration: (failure) => Effect.succeed(failure),
        ContradictoryWorktreeState: (failure) => Effect.succeed(failure),
        ForeignWorktreeRegistration: (failure) => Effect.succeed(failure),
        UntrackedWorktreePath: (failure) => Effect.succeed(failure),
        WorktreeBaseMismatch: (failure) => Effect.succeed(failure)
      })
    )
  return observation._tag === "PlannedWorktreeReady"
    ? observation
    : observation._tag === "PlannedBranchReady" || observation._tag === "PlannedWorktreeAbsent"
      ? AttemptWorktreeLost.make({ plannedAttempt })
      : observation
})
