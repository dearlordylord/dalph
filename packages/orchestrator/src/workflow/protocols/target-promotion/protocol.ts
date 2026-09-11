import { makeTargetPromotionEngine } from "./protocol-engine.js"
import { readAcceptedTargetPromotionEvidence } from "./transition-journal.js"
export { deriveTargetPromotionState, TargetPromotionPendingRetry, TargetPromotionState } from "./state.js"
export { targetPromotionCorrelationConflictFor } from "./state.js"
export type { JournalOccurrence } from "./state.js"
export { targetPromotionCorrelationFor, targetPromotionRequestIdForCandidate } from "./events.js"
export { deriveTargetPromotionStateFor } from "./state-cache.js"
export {
  TargetPromotionCorrelationContradiction,
  TargetPromotionHistoryContradiction,
  TargetPromotionResultContradiction
} from "./errors.js"

/** Reads Git to settle one ambiguous prior attempt but can never issue a new compare-and-set. */
/** Performs at most one compare-and-set and one reconciliation read for one Integrator-qualified candidate. */
export const { reconcileTargetPromotionAttempt, runTargetPromotion } = makeTargetPromotionEngine(
  readAcceptedTargetPromotionEvidence
)
