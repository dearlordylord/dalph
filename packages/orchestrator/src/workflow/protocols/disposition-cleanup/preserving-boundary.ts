import { Context, Effect, Layer } from "effect"
import { CoordinatorOwnership } from "../../../authorities/coordinator-ownership/ownership.js"
import { BranchCleanupBoundary, BranchCleanupMutationResult, BranchCleanupObservation } from "./branch.js"
import {
  IntegratorCandidateCleanupBoundary,
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateCleanupObservation
} from "./integrator-candidate.js"
import {
  type BranchCleanupAuthorization,
  type IntegratorCandidateCleanupAuthorization,
  type WorktreeCleanupAuthorization
} from "./disposition.js"
import { WorktreeCleanupBoundary, WorktreeCleanupMutationResult, WorktreeCleanupObservation } from "./worktree.js"

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
