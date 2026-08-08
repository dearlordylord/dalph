import { Context } from "effect"
import type { TargetPromotionGitService } from "./events.js"

/** Complete provider-neutral input needed to execute one target-promotion action. */
export interface TargetPromotionRuntimeInput {
  readonly git: TargetPromotionGitService
}

/** Coherent Git boundary capability supplied by production, controlled, or cassette wiring. */
export class TargetPromotionRuntime extends Context.Service<TargetPromotionRuntime, TargetPromotionRuntimeInput>()(
  "@dalph/TargetPromotionRuntime"
) {}
