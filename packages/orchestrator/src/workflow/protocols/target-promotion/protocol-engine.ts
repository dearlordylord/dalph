import { Effect, Schema } from "effect"
import {
  PublishedIntegratorRunQualifiedCandidate,
  remotePublicationCorrelationFor,
  remotePublicationRunIdOf
} from "../direct-publication/events.js"
import { validateRemotePublicationState } from "../direct-publication/transition-journal.js"
import { TargetPromotionResultContradiction } from "./errors.js"
import type { CurrentTargetPromotionEvidence } from "./transition-journal.js"
import { makeTargetPromotionTransitions, type TargetPromotionProgress } from "./transitions.js"
import { TargetPromotionPendingRetry, TargetPromotionState } from "./state.js"

const publicationProofEquals = Schema.toEquivalence(
  PublishedIntegratorRunQualifiedCandidate.fields.publication.fields.proof
)

/** Internal stateless engine; production supplies accepted evidence, focused tests supply decoded evidence. */
const makeTargetPromotionEngineImplementation = <E, R>(readEvidence: CurrentTargetPromotionEvidence<E, R>) => {
  const transitions = makeTargetPromotionTransitions(readEvidence)
  const authorizePublishedCandidate = Effect.fn("TargetPromotion.authorizePublishedCandidate")(function* (
    published: PublishedIntegratorRunQualifiedCandidate
  ) {
    const correlation = remotePublicationCorrelationFor(published.candidate, published.publication.correlation.target)
    const state = yield* validateRemotePublicationState(
      yield* readEvidence(remotePublicationRunIdOf(correlation)),
      correlation
    )
    if (state._tag !== "PublicationSucceeded" || !publicationProofEquals(published.publication.proof, state.proof)) {
      return yield* new TargetPromotionResultContradiction({
        candidateCommit: published.candidate.candidateCommit,
        detail: "target promotion requires the exact durable remote publication proof"
      })
    }
    return published.candidate
  })
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
    published: PublishedIntegratorRunQualifiedCandidate
  ) {
    const candidate = yield* authorizePublishedCandidate(published)
    return yield* finishProgress(yield* transitions.authorizeTargetPromotionProgress(candidate, "ReadOnly"))
  })
  const runTargetPromotion = Effect.fn("TargetPromotion.run")(function* (
    published: PublishedIntegratorRunQualifiedCandidate
  ) {
    const candidate = yield* authorizePublishedCandidate(published)
    return yield* finishProgress(yield* transitions.authorizeOrRecordTargetPromotionProgress(candidate))
  })
  return { ...transitions, reconcileTargetPromotionAttempt, runTargetPromotion }
}

type TargetPromotionEngineImplementation<E, R> = ReturnType<typeof makeTargetPromotionEngineImplementation<E, R>>

/** The complete outer protocol surface without exposing process-local capability brands. */
interface TargetPromotionEngine<E, R> extends ReturnType<typeof makeTargetPromotionTransitions<E, R>> {
  readonly reconcileTargetPromotionAttempt: TargetPromotionEngineImplementation<E, R>["reconcileTargetPromotionAttempt"]
  readonly runTargetPromotion: TargetPromotionEngineImplementation<E, R>["runTargetPromotion"]
}

export const makeTargetPromotionEngine: <E, R>(
  readEvidence: CurrentTargetPromotionEvidence<E, R>
) => TargetPromotionEngine<E, R> = makeTargetPromotionEngineImplementation
