import { Effect } from "effect"
import type { IntegratorRunQualifiedCandidate } from "../integrator/events.js"
import type { CurrentTargetPromotionEvidence } from "./transition-journal.js"
import { makeTargetPromotionTransitions, type TargetPromotionProgress } from "./transitions.js"
import { TargetPromotionPendingRetry, TargetPromotionState } from "./state.js"

/** Internal stateless engine; production supplies accepted evidence, focused tests supply decoded evidence. */
const makeTargetPromotionEngineImplementation = <E, R>(readEvidence: CurrentTargetPromotionEvidence<E, R>) => {
  const transitions = makeTargetPromotionTransitions(readEvidence)
  const finishProgress = Effect.fn("TargetPromotion.finishProgress")(function* (progress: TargetPromotionProgress) {
    const afterRead =
      progress._tag === "TargetPromotionReadAuthorized"
        ? yield* transitions.observeTargetPromotionRead(progress)
        : progress
    if (afterRead._tag !== "TargetPromotionAttemptAuthorized") return afterRead
    const intended = yield* transitions.recordTargetPromotionAttemptIntent(afterRead)
    const result = yield* transitions.sendTargetPromotionAttempt(intended)
    return result._tag === "TargetPromotionAttemptAmbiguous"
      ? TargetPromotionState.cases.PromotionPending.make({
          correlation: result.correlation,
          retry: TargetPromotionPendingRetry.cases.NeedReconciliationRead.make({
            afterAttemptOrdinal: result.attemptOrdinal
          })
        })
      : yield* transitions.settleTargetPromotionAttempt(result)
  })
  const reconcileTargetPromotionAttempt = Effect.fn("TargetPromotion.reconcileAttempt")(function* (
    candidate: IntegratorRunQualifiedCandidate
  ) {
    return yield* finishProgress(yield* transitions.authorizeTargetPromotionProgress(candidate, "ReadOnly"))
  })
  const runTargetPromotion = Effect.fn("TargetPromotion.run")(function* (candidate: IntegratorRunQualifiedCandidate) {
    return yield* finishProgress(yield* transitions.authorizeOrRecordTargetPromotionProgress(candidate))
  })
  return { ...transitions, reconcileTargetPromotionAttempt, runTargetPromotion }
}

type TargetPromotionEngineImplementation<E, R> = ReturnType<typeof makeTargetPromotionEngineImplementation<E, R>>

/** The complete outer protocol surface without exposing process-local capability brands. */
export interface TargetPromotionEngine<E, R> extends ReturnType<typeof makeTargetPromotionTransitions<E, R>> {
  readonly reconcileTargetPromotionAttempt: TargetPromotionEngineImplementation<E, R>["reconcileTargetPromotionAttempt"]
  readonly runTargetPromotion: TargetPromotionEngineImplementation<E, R>["runTargetPromotion"]
}

export const makeTargetPromotionEngine = <E, R>(
  readEvidence: CurrentTargetPromotionEvidence<E, R>
): TargetPromotionEngine<E, R> => makeTargetPromotionEngineImplementation(readEvidence)
