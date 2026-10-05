import { Effect } from "effect"
import type { GitCommandService } from "./command.js"
import { decodeGitWorktreeRegistrations } from "./worktree-registration.js"
import {
  TargetPromotionSafetyFailure,
  TargetPromotionSafetyRefusal,
  type TargetPromotionGitRequest
} from "../../workflow/protocols/target-promotion/events.js"

const refused = (request: TargetPromotionGitRequest, refusal: TargetPromotionSafetyRefusal) =>
  new TargetPromotionSafetyFailure({
    candidateCommit: request.candidateCommit,
    expectedHead: request.expectedTargetHead,
    target: request.integrationTarget,
    refusal
  })

/** Prove the configured locator names a direct ref, never a symbolic alias. */
export const provePromotionTargetDirect = Effect.fn("TargetPromotionGit.proveDirectTarget")(function* (
  commands: GitCommandService,
  request: TargetPromotionGitRequest
) {
  const result = yield* commands
    .run(request.integrationTarget.repository, ["symbolic-ref", "--quiet", request.integrationTarget.ref])
    .pipe(
      Effect.mapError((failure) =>
        refused(request, TargetPromotionSafetyRefusal.cases.TargetIdentityUnreadable.make({ detail: failure.detail }))
      )
    )
  if (result.exitCode !== 1 || result.stdout.length !== 0) {
    return yield* refused(
      request,
      TargetPromotionSafetyRefusal.cases.TargetIdentityUnreadable.make({
        detail: result.stderr.trim() || "Git did not prove a direct target ref"
      })
    )
  }
})

/** Inspect every registration immediately before a cooperative promotion may send update-ref. */
export const provePromotionTargetUnoccupied = Effect.fn("TargetPromotionGit.proveUnoccupiedTarget")(function* (
  commands: GitCommandService,
  request: TargetPromotionGitRequest
) {
  const result = yield* commands
    .run(request.integrationTarget.repository, ["worktree", "list", "--porcelain", "-z"])
    .pipe(
      Effect.mapError((failure) =>
        refused(request, TargetPromotionSafetyRefusal.cases.InventoryUnreadable.make({ detail: failure.detail }))
      )
    )
  if (result.exitCode !== 0) {
    return yield* refused(
      request,
      TargetPromotionSafetyRefusal.cases.InventoryUnreadable.make({
        detail: result.stderr.trim() || `git worktree list exited ${result.exitCode}`
      })
    )
  }
  const registrations = yield* decodeGitWorktreeRegistrations(result.stdout).pipe(
    Effect.mapError((failure) =>
      refused(request, TargetPromotionSafetyRefusal.cases.InventoryUnreadable.make({ detail: failure.detail }))
    )
  )
  const occupied = registrations.find(({ branch }) => String(branch) === String(request.integrationTarget.ref))
  if (occupied !== undefined) {
    return yield* refused(
      request,
      TargetPromotionSafetyRefusal.cases.OccupiedWorktree.make({ worktree: occupied.worktree })
    )
  }
})
