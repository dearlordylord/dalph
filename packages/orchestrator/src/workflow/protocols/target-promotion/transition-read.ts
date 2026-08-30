import { Effect } from "effect"
import {
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  TargetPromotionGit,
  type TargetPromotionGitReadFailure,
  type TargetPromotionGitReadObservation,
  TargetPromotionNonConvergenceObservation,
  TargetPromotionReconciliationDeferral,
  TargetPromotionStaleObservation,
  TargetPromotionTerminalBasis,
  targetPromotionAttemptLimit,
  targetPromotionCandidateCommitOf,
  targetPromotionGitRequestFor
} from "./events.js"
import { TargetPromotionResultContradiction } from "./errors.js"
import { readObservationContradiction, successObservationForRead } from "./read-observation.js"
import type { TargetPromotionState } from "./state.js"
import {
  makeTargetPromotionAttemptAuthorization,
  type TargetPromotionReadAuthorization
} from "./transition-authority.js"
import {
  appendTargetPromotionNonConvergence,
  appendTargetPromotionReconciliationDeferral,
  appendTargetPromotionStale,
  appendTargetPromotionSuccess,
  readValidatedTargetPromotionState
} from "./transition-journal.js"

const ordinalFor = (value: number): TargetPromotionAttemptOrdinal => TargetPromotionAttemptOrdinal.make(value)

const finishFailedRead = Effect.fn("TargetPromotion.finishFailedRead")(function* (
  authorization: TargetPromotionReadAuthorization,
  failure: TargetPromotionGitReadFailure
) {
  const previousAttemptOrdinal = authorization.previousAttemptOrdinal
  if (previousAttemptOrdinal === undefined) return yield* failure
  if (authorization.authority === "ReadOnly" && previousAttemptOrdinal !== targetPromotionAttemptLimit) {
    return yield* appendTargetPromotionReconciliationDeferral(
      authorization.correlation,
      previousAttemptOrdinal,
      TargetPromotionReconciliationDeferral.cases.TargetReadFailed.make({ detail: failure.detail })
    )
  }
  return previousAttemptOrdinal === targetPromotionAttemptLimit
    ? yield* appendTargetPromotionNonConvergence(
        authorization.correlation,
        previousAttemptOrdinal,
        TargetPromotionNonConvergenceObservation.cases.TargetReadFailed.make({ detail: failure.detail })
      )
    : yield* failure
})

const pendingInitialReadMatches = (state: TargetPromotionState | undefined): boolean =>
  state?._tag === "PromotionPending" && state.retry._tag === "NeedInitialReconciliationRead"

const pendingAttemptReadMatches = (
  authorization: TargetPromotionReadAuthorization,
  state: TargetPromotionState | undefined
): boolean =>
  state?._tag === "PromotionPending" &&
  state.retry._tag === "NeedReconciliationRead" &&
  state.retry.afterAttemptOrdinal === authorization.previousAttemptOrdinal

const deferredReadMatches = (
  authorization: TargetPromotionReadAuthorization,
  state: TargetPromotionState | undefined
): boolean =>
  state?._tag === "PromotionReconciliationDeferred" &&
  state.afterAttemptOrdinal === authorization.previousAttemptOrdinal &&
  state.deferral._tag === "TargetReadFailed"

const readAuthorizationMatches = (
  authorization: TargetPromotionReadAuthorization,
  state: TargetPromotionState | undefined
): boolean => {
  if (authorization.durableBasis === "PendingInitial") return pendingInitialReadMatches(state)
  if (authorization.durableBasis === "PendingAttempt") return pendingAttemptReadMatches(authorization, state)
  return deferredReadMatches(authorization, state)
}

const continueAfterExpectedHeadRead = Effect.fn("TargetPromotion.continueAfterExpectedHeadRead")(function* (
  authorization: TargetPromotionReadAuthorization,
  observedHeadSha: TargetPromotionGitReadObservation["currentHeadSha"]
) {
  const previousAttemptOrdinal = authorization.previousAttemptOrdinal
  if (previousAttemptOrdinal === targetPromotionAttemptLimit) {
    return yield* appendTargetPromotionNonConvergence(
      authorization.correlation,
      previousAttemptOrdinal,
      TargetPromotionNonConvergenceObservation.cases.ExpectedHeadStillObserved.make({ observedHeadSha })
    )
  }
  if (previousAttemptOrdinal !== undefined && authorization.authority === "ReadOnly") {
    return yield* appendTargetPromotionReconciliationDeferral(
      authorization.correlation,
      previousAttemptOrdinal,
      TargetPromotionReconciliationDeferral.cases.RetryAuthorityRequired.make({ observedHeadSha })
    )
  }
  const attemptOrdinal = ordinalFor((previousAttemptOrdinal ?? 0) + 1)
  const reason =
    previousAttemptOrdinal === undefined
      ? TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha })
      : TargetPromotionAttemptReason.cases.ReconciledExpectedHead.make({ observedHeadSha, previousAttemptOrdinal })
  return makeTargetPromotionAttemptAuthorization(
    authorization.correlation,
    attemptOrdinal,
    reason,
    authorization.durableBasis
  )
})

const finishSuccessfulRead = Effect.fn("TargetPromotion.finishSuccessfulRead")(function* (
  authorization: TargetPromotionReadAuthorization,
  observation: TargetPromotionGitReadObservation
) {
  const request = targetPromotionGitRequestFor(authorization.correlation)
  const contradiction = readObservationContradiction(request, observation)
  if (contradiction !== undefined) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: request.candidateCommit,
      detail: contradiction
    })
  }
  const basis =
    authorization.previousAttemptOrdinal === undefined
      ? TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({})
      : TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal: authorization.previousAttemptOrdinal })
  const success = successObservationForRead(observation)
  if (success !== undefined) return yield* appendTargetPromotionSuccess(authorization.correlation, basis, success)
  if (observation.currentHeadSha === request.expectedTargetHead) {
    return yield* continueAfterExpectedHeadRead(authorization, observation.currentHeadSha)
  }
  return yield* appendTargetPromotionStale(
    authorization.correlation,
    basis,
    TargetPromotionStaleObservation.cases.ReconciledCandidateNotInAncestry.make({
      observedHeadSha: observation.currentHeadSha
    })
  )
})

/** Performs exactly the one Git read represented by a process-local authorization. */
export const observeTargetPromotionRead = Effect.fn("TargetPromotion.observeRead")(function* (
  authorization: TargetPromotionReadAuthorization
) {
  const state = yield* readValidatedTargetPromotionState(authorization.correlation)
  if (!readAuthorizationMatches(authorization, state)) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: targetPromotionCandidateCommitOf(authorization.correlation),
      detail: "promotion read authorization no longer matches the exact durable state"
    })
  }

  const git = yield* TargetPromotionGit
  const request = targetPromotionGitRequestFor(authorization.correlation)
  const readResult = yield* git.read(request).pipe(Effect.result)
  if (readResult._tag === "Failure") return yield* finishFailedRead(authorization, readResult.failure)
  return yield* finishSuccessfulRead(authorization, readResult.success)
})
