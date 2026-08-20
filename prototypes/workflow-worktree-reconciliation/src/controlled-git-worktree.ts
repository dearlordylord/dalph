import {
  ContradictoryWorktreeState,
  GitWorktree,
  GitWorktreeCreateFailure,
  GitWorktreeReadFailure,
  runGitWorktreeReconciliation,
  PlannedWorktreeAbsent,
  PlannedWorktreeReady
} from "@dalph/orchestrator"
import type { GitWorktreeService as GitWorktreeServiceType } from "../../../packages/orchestrator/dist/src/authorities/git/worktree.js"
import type { PlannedTaskAttempt } from "@dalph/contracts"
import { Effect, Layer } from "effect"
import {
  createPlannedWorktree,
  readPlannedWorktree,
  type BoundaryContext
} from "./controlled-world.ts"
import { fixture, type ControlledWorktreeObservation, type WorktreeProcessInstance } from "./contracts.ts"

export interface ControlledGitWorktreeInput {
  readonly afterCreate?: () => Promise<never>
  readonly processInstance: WorktreeProcessInstance
  readonly workspace: string
}

const contextFor = (input: ControlledGitWorktreeInput): BoundaryContext => ({
  operationId: fixture.operationId,
  processInstance: input.processInstance,
  workspace: input.workspace
})

const observationFor = (
  observation: ControlledWorktreeObservation,
  plannedAttempt: PlannedTaskAttempt
): Effect.Effect<PlannedWorktreeAbsent | PlannedWorktreeReady, ContradictoryWorktreeState> => {
  if (observation._tag === "PlannedWorktreeAbsent") return Effect.succeed(PlannedWorktreeAbsent.make({}))
  if (observation._tag === "PlannedWorktreeContradictory") {
    return Effect.fail(
      new ContradictoryWorktreeState({ detail: observation.detail, worktree: plannedAttempt.worktree })
    )
  }
  if (
    observation.baseSha !== plannedAttempt.baseSha ||
    observation.branch !== plannedAttempt.branch ||
    observation.worktree !== plannedAttempt.worktree
  ) {
    return Effect.fail(
      new ContradictoryWorktreeState({
        detail: "controlled Git returned a ready proof for a different planned resource",
        worktree: plannedAttempt.worktree
      })
    )
  }
  return Effect.succeed(
    PlannedWorktreeReady.make({
      baseSha: observation.baseSha,
      branch: observation.branch,
      headSha: observation.headSha,
      worktree: observation.worktree
    })
  )
}

const readThroughControlledWorld = (
  input: ControlledGitWorktreeInput,
  plannedAttempt: PlannedTaskAttempt
) =>
  Effect.tryPromise({
    try: () => readPlannedWorktree(contextFor(input)),
    catch: (cause) => new GitWorktreeReadFailure({ detail: String(cause), worktree: plannedAttempt.worktree })
  }).pipe(Effect.flatMap((observation) => observationFor(observation, plannedAttempt)))

const createThroughControlledWorld = (input: ControlledGitWorktreeInput, plannedAttempt: PlannedTaskAttempt) =>
  Effect.tryPromise({
    try: () => createPlannedWorktree(contextFor(input), input.afterCreate),
    catch: (cause) => new GitWorktreeCreateFailure({ detail: String(cause), worktree: plannedAttempt.worktree })
  })

/** Controlled Git authority used by both the Workflow Activity and the outer current-decision reread. */
export const controlledGitWorktreeLayer = (input: ControlledGitWorktreeInput): Layer.Layer<GitWorktree> =>
  Layer.succeed(
    GitWorktree,
    GitWorktree.of({
      createPlannedWorktree: (plannedAttempt) => createThroughControlledWorld(input, plannedAttempt),
      readPlannedWorktree: (plannedAttempt) => readThroughControlledWorld(input, plannedAttempt)
    } satisfies GitWorktreeServiceType)
  )

/** Negative control: bypassing the reconciliation protocol repeats create after an ambiguous restart. */
export const runBlindControlledGitRetry = (
  git: GitWorktreeServiceType,
  plannedAttempt: PlannedTaskAttempt
) =>
  git.createPlannedWorktree(plannedAttempt).pipe(
    Effect.andThen(git.readPlannedWorktree(plannedAttempt)),
    Effect.flatMap((observation) =>
      observation._tag === "PlannedWorktreeReady"
        ? Effect.succeed(observation)
        : Effect.fail(
            new ContradictoryWorktreeState({
              detail: "blind retry did not observe an exact ready proof",
              worktree: plannedAttempt.worktree
            })
          )
    )
  )

/** The production-shaped protocol call kept explicit for the Workflow Activity. */
export const runControlledGitWorktreeReconciliation = (
  git: GitWorktreeServiceType,
  plannedAttempt: PlannedTaskAttempt
) => runGitWorktreeReconciliation(git, plannedAttempt)
