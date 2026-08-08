import { Context } from "effect"
import type { EvidenceStoreService } from "./evidence-store.js"
import type { TargetVerificationBoundaryService, TargetVerificationPlan } from "./events.js"

/** Complete application input that enables target verification planning and execution together. */
export interface TargetVerificationRuntimeInput {
  readonly boundary: TargetVerificationBoundaryService
  readonly evidenceStore: EvidenceStoreService
  readonly plan: TargetVerificationPlan
}

/** Coherent planning and execution capability for repository-selected target verification. */
export class TargetVerificationRuntime extends Context.Service<
  TargetVerificationRuntime,
  TargetVerificationRuntimeInput
>()("@dalph/TargetVerificationRuntime") {}
