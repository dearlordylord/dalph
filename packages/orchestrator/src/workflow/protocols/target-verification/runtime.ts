import type { EvidenceStoreService } from "./evidence-store.js"
import type { TargetVerificationBoundaryService, TargetVerificationPlan } from "./events.js"

/** Complete application input that enables target verification planning and execution together. */
export interface TargetVerificationRuntimeInput {
  readonly boundary: TargetVerificationBoundaryService
  readonly evidenceStore: EvidenceStoreService
  readonly plan: TargetVerificationPlan
}
