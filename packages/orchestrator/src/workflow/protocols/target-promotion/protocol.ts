import { Effect } from "effect"
import type { IntegratorRunQualifiedCandidate } from "../integrator/events.js"
import {
  authorizeOrRecordTargetPromotionProgress,
  authorizeTargetPromotionProgress,
  observeTargetPromotionRead,
  pendingTargetPromotionAfter,
  recordTargetPromotionAttemptIntent,
  sendTargetPromotionAttempt,
  settleTargetPromotionAttempt,
  type TargetPromotionProgress
} from "./transitions.js"
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

const finishProgress = Effect.fn("TargetPromotion.finishProgress")(function* (progress: TargetPromotionProgress) {
  const afterRead =
    progress._tag === "TargetPromotionReadAuthorized" ? yield* observeTargetPromotionRead(progress) : progress
  if (afterRead._tag !== "TargetPromotionAttemptAuthorized") return afterRead
  const intended = yield* recordTargetPromotionAttemptIntent(afterRead)
  const result = yield* sendTargetPromotionAttempt(intended)
  return result._tag === "TargetPromotionAttemptAmbiguous"
    ? pendingTargetPromotionAfter(result)
    : yield* settleTargetPromotionAttempt(result)
})

/** Reads Git to settle one ambiguous prior attempt but can never issue a new compare-and-set. */
export const reconcileTargetPromotionAttempt = Effect.fn("TargetPromotion.reconcileAttempt")(function* (
  candidate: IntegratorRunQualifiedCandidate
) {
  const progress = yield* authorizeTargetPromotionProgress(candidate, "ReadOnly")
  return yield* finishProgress(progress)
})

/** Performs at most one compare-and-set and one reconciliation read for one Integrator-qualified candidate. */
export const runTargetPromotion = Effect.fn("TargetPromotion.run")(function* (
  candidate: IntegratorRunQualifiedCandidate
) {
  const progress = yield* authorizeOrRecordTargetPromotionProgress(candidate)
  return yield* finishProgress(progress)
})
