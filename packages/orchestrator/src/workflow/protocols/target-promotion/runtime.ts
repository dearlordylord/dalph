import { Context, Effect } from "effect"
import type { CoordinatorOwnershipCapability } from "../../../authorities/coordinator-ownership/ownership.js"
import type { TargetPromotionGitService } from "./events.js"

/** Complete provider-neutral input needed to execute one target-promotion action. */
export interface TargetPromotionRuntimeInput {
  readonly git: TargetPromotionGitService
}

/** Coherent Git boundary capability supplied by production, controlled, or cassette wiring. */
export class TargetPromotionRuntime extends Context.Service<TargetPromotionRuntime, TargetPromotionRuntimeInput>()(
  "@dalph/TargetPromotionRuntime"
) {}

/**
 * Installs the one existing coordinator capability around target-ref mutation.
 * Git reads remain available directly because they do not change the target.
 */
export const coordinatorOwnedTargetPromotionGit = (
  git: TargetPromotionGitService,
  ownership: CoordinatorOwnershipCapability
): TargetPromotionGitService => ({
  compareAndSet: (request) => ownership.runMutation(Effect.suspend(() => git.compareAndSet(request))),
  read: git.read
})
