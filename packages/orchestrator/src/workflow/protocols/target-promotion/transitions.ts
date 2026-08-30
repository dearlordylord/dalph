import { Effect } from "effect"
import {
  targetPromotionAttemptIntentRecordKey,
  targetPromotionIntentRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import type { IntegratorRunQualifiedCandidate } from "../integrator/events.js"
import {
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  type TargetPromotionCompareAndSetResult,
  TargetPromotionGit,
  TargetPromotionIntendedEvent,
  TargetPromotionStaleObservation,
  TargetPromotionTerminalBasis,
  TargetPromotionSuccessObservation,
  targetPromotionCandidateCommitOf,
  targetPromotionCorrelationFor,
  targetPromotionExpectedHeadOf,
  targetPromotionGitRequestFor
} from "./events.js"
import { TargetPromotionResultContradiction } from "./errors.js"
import { successObservationForCompareAndSet } from "./read-observation.js"
import { TargetPromotionPendingRetry, TargetPromotionState } from "./state.js"
import {
  consumeTargetPromotionIntendedAttempt,
  consumeTargetPromotionObservedAttempt,
  makeTargetPromotionAttemptAuthorization,
  makeTargetPromotionIntendedAttempt,
  makeTargetPromotionObservedAttempt,
  makeTargetPromotionReadAuthorization,
  type TargetPromotionAmbiguousAttempt,
  type TargetPromotionAttemptAuthorization,
  type TargetPromotionIntendedAttempt,
  type TargetPromotionObservedAttempt,
  type TargetPromotionReadAuthorization
} from "./transition-authority.js"
import {
  appendTargetPromotionEvent,
  appendTargetPromotionStale,
  appendTargetPromotionSuccess,
  readValidatedTargetPromotionState
} from "./transition-journal.js"
export { observeTargetPromotionRead } from "./transition-read.js"

const ordinalFor = (value: number): TargetPromotionAttemptOrdinal => TargetPromotionAttemptOrdinal.make(value)

export type {
  TargetPromotionAttemptAuthorization,
  TargetPromotionAttemptBoundaryResult,
  TargetPromotionIntendedAttempt,
  TargetPromotionProgress,
  TargetPromotionReadAuthorization
} from "./transition-authority.js"

type PendingState = Extract<TargetPromotionState, { readonly _tag: "PromotionPending" }>
type DeferredState = Extract<TargetPromotionState, { readonly _tag: "PromotionReconciliationDeferred" }>

const authorizePendingProgress = (
  state: PendingState,
  authority: "ReadOnly" | "RetryAuthorized"
): TargetPromotionReadAuthorization | undefined => {
  if (state.retry._tag === "NeedInitialReconciliationRead") {
    return authority === "ReadOnly"
      ? undefined
      : makeTargetPromotionReadAuthorization(state.correlation, undefined, authority, "PendingInitial")
  }
  return makeTargetPromotionReadAuthorization(
    state.correlation,
    state.retry.afterAttemptOrdinal,
    authority,
    "PendingAttempt"
  )
}

const authorizeDeferredProgress = (
  state: DeferredState,
  authority: "ReadOnly" | "RetryAuthorized"
): DeferredState | TargetPromotionReadAuthorization | TargetPromotionAttemptAuthorization => {
  if (authority === "ReadOnly") return state
  if (state.deferral._tag === "TargetReadFailed") {
    return makeTargetPromotionReadAuthorization(
      state.correlation,
      state.afterAttemptOrdinal,
      authority,
      "DeferredTargetReadFailed"
    )
  }
  return makeTargetPromotionAttemptAuthorization(
    state.correlation,
    ordinalFor(state.afterAttemptOrdinal + 1),
    TargetPromotionAttemptReason.cases.ReconciledExpectedHead.make({
      observedHeadSha: state.deferral.observedHeadSha,
      previousAttemptOrdinal: state.afterAttemptOrdinal
    }),
    "DeferredRetryAuthority"
  )
}

/** Appends only the outer promotion intent and returns permission for the later initial read. */
export const recordTargetPromotionIntent = Effect.fn("TargetPromotion.recordIntent")(function* (
  candidate: IntegratorRunQualifiedCandidate
) {
  const correlation = targetPromotionCorrelationFor(candidate)
  const state = yield* readValidatedTargetPromotionState(correlation)
  if (state !== undefined) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: candidate.candidateCommit,
      detail: "target promotion intent requires an absent exact promotion state"
    })
  }
  yield* appendTargetPromotionEvent(
    correlation,
    targetPromotionIntentRecordKey(correlation.requestId),
    TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  )
  return makeTargetPromotionReadAuthorization(correlation, undefined, "RetryAuthorized", "PendingInitial")
})

/** Selects the next read or retry without reading Git, appending an event, or requesting a mutation. */
export const authorizeTargetPromotionProgress = Effect.fn("TargetPromotion.authorizeProgress")(function* (
  candidate: IntegratorRunQualifiedCandidate,
  authority: "ReadOnly" | "RetryAuthorized"
) {
  const correlation = targetPromotionCorrelationFor(candidate)
  const state = yield* readValidatedTargetPromotionState(correlation)
  if (state === undefined) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: candidate.candidateCommit,
      detail: "target promotion progress requires a durable promotion intent"
    })
  }
  if (state._tag === "PromotionPending") {
    const progress = authorizePendingProgress(state, authority)
    if (progress !== undefined) return progress
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: candidate.candidateCommit,
      detail: "read-only reconciliation requires one exact unmatched compare-and-set intent"
    })
  }
  if (state._tag === "PromotionReconciliationDeferred") {
    return authorizeDeferredProgress(state, authority)
  }
  return state
})

/** Starts a new promotion or selects the next step for an existing exact correlation. */
export const authorizeOrRecordTargetPromotionProgress = Effect.fn("TargetPromotion.authorizeOrRecordProgress")(
  function* (candidate: IntegratorRunQualifiedCandidate) {
    const correlation = targetPromotionCorrelationFor(candidate)
    const state = yield* readValidatedTargetPromotionState(correlation)
    if (state === undefined) {
      yield* appendTargetPromotionEvent(
        correlation,
        targetPromotionIntentRecordKey(correlation.requestId),
        TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
      )
      return makeTargetPromotionReadAuthorization(correlation, undefined, "RetryAuthorized", "PendingInitial")
    }
    if (state._tag === "PromotionPending") {
      const progress = authorizePendingProgress(state, "RetryAuthorized")
      return progress ?? (yield* Effect.die("retry-authorized pending promotion did not authorize a read"))
    }
    if (state._tag === "PromotionReconciliationDeferred") return authorizeDeferredProgress(state, "RetryAuthorized")
    return state
  }
)

const pendingInitialAttemptMatches = (
  authorization: TargetPromotionAttemptAuthorization,
  state: TargetPromotionState | undefined
): boolean =>
  authorization.attemptOrdinal === 1 &&
  state?._tag === "PromotionPending" &&
  state.retry._tag === "NeedInitialReconciliationRead"

const pendingAttemptMatches = (
  authorization: TargetPromotionAttemptAuthorization,
  state: TargetPromotionState | undefined
): boolean =>
  state?._tag === "PromotionPending" &&
  state.retry._tag === "NeedReconciliationRead" &&
  state.retry.afterAttemptOrdinal === authorization.attemptOrdinal - 1

const deferredAttemptMatches = (
  authorization: TargetPromotionAttemptAuthorization,
  state: TargetPromotionState | undefined,
  deferral: "RetryAuthorityRequired" | "TargetReadFailed"
): boolean =>
  state?._tag === "PromotionReconciliationDeferred" &&
  state.afterAttemptOrdinal === authorization.attemptOrdinal - 1 &&
  state.deferral._tag === deferral

const attemptAuthorizationMatches = (
  authorization: TargetPromotionAttemptAuthorization,
  state: TargetPromotionState | undefined
): boolean => {
  switch (authorization.durableBasis) {
    case "PendingInitial":
      return pendingInitialAttemptMatches(authorization, state)
    case "PendingAttempt":
      return pendingAttemptMatches(authorization, state)
    case "DeferredRetryAuthority":
      return deferredAttemptMatches(authorization, state, "RetryAuthorityRequired")
    case "DeferredTargetReadFailed":
      return deferredAttemptMatches(authorization, state, "TargetReadFailed")
  }
}

/** Appends exactly one numbered compare-and-set intent and does not call Git. */
export const recordTargetPromotionAttemptIntent = Effect.fn("TargetPromotion.recordAttemptIntent")(function* (
  authorization: TargetPromotionAttemptAuthorization
) {
  const state = yield* readValidatedTargetPromotionState(authorization.correlation)
  if (!attemptAuthorizationMatches(authorization, state)) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: targetPromotionCandidateCommitOf(authorization.correlation),
      detail: "promotion attempt authorization no longer matches the exact durable state"
    })
  }
  yield* appendTargetPromotionEvent(
    authorization.correlation,
    targetPromotionAttemptIntentRecordKey(authorization.correlation.requestId, authorization.attemptOrdinal),
    TargetPromotionAttemptIntendedEvent.make({
      attemptOrdinal: authorization.attemptOrdinal,
      correlation: authorization.correlation,
      reason: authorization.reason,
      version: workflowJournalEventVersion
    })
  )
  return makeTargetPromotionIntendedAttempt(authorization)
})

/** Calls Git exactly once for an already-journaled attempt and does not append a result. */
export const sendTargetPromotionAttempt = Effect.fn("TargetPromotion.sendAttempt")(function* (
  attempt: TargetPromotionIntendedAttempt
) {
  const state = yield* readValidatedTargetPromotionState(attempt.correlation)
  if (
    state?._tag !== "PromotionPending" ||
    state.retry._tag !== "NeedReconciliationRead" ||
    state.retry.afterAttemptOrdinal !== attempt.attemptOrdinal
  ) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: targetPromotionCandidateCommitOf(attempt.correlation),
      detail: "promotion attempt intent no longer matches the exact durable state"
    })
  }
  if (!consumeTargetPromotionIntendedAttempt(attempt)) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: targetPromotionCandidateCommitOf(attempt.correlation),
      detail: "promotion attempt permission was already consumed or did not originate in this process"
    })
  }
  const git = yield* TargetPromotionGit
  const result = yield* git.compareAndSet(targetPromotionGitRequestFor(attempt.correlation)).pipe(Effect.result)
  return result._tag === "Failure"
    ? {
        _tag: "TargetPromotionAttemptAmbiguous" as const,
        attemptOrdinal: attempt.attemptOrdinal,
        correlation: attempt.correlation
      }
    : makeTargetPromotionObservedAttempt(attempt, result.success)
})

const settleRejectedCompareAndSet = Effect.fn("TargetPromotion.settleRejectedCompareAndSet")(function* (
  attempt: TargetPromotionObservedAttempt,
  result: Extract<TargetPromotionCompareAndSetResult, { readonly _tag: "RejectedExpectedHead" }>,
  basis: TargetPromotionTerminalBasis
) {
  if (result.observedHeadSha === targetPromotionCandidateCommitOf(attempt.correlation)) {
    return yield* appendTargetPromotionSuccess(
      attempt.correlation,
      basis,
      TargetPromotionSuccessObservation.cases.ReconciledCandidateCurrent.make({
        candidateAncestry: "Current",
        targetHeadSha: result.observedHeadSha
      })
    )
  }
  if (result.observedHeadSha === targetPromotionExpectedHeadOf(attempt.correlation)) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: targetPromotionCandidateCommitOf(attempt.correlation),
      detail: "Git rejected the compare-and-set while reporting the exact expected head"
    })
  }
  return yield* appendTargetPromotionStale(
    attempt.correlation,
    basis,
    TargetPromotionStaleObservation.cases.CompareAndSetRejected.make({ observedHeadSha: result.observedHeadSha })
  )
})

const settleAppliedCompareAndSet = Effect.fn("TargetPromotion.settleAppliedCompareAndSet")(function* (
  attempt: TargetPromotionObservedAttempt,
  result: Extract<TargetPromotionCompareAndSetResult, { readonly _tag: "Applied" }>,
  basis: TargetPromotionTerminalBasis
) {
  if (result.newHeadSha !== targetPromotionCandidateCommitOf(attempt.correlation)) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: targetPromotionCandidateCommitOf(attempt.correlation),
      detail: `Git reported ${result.newHeadSha} after requesting ${targetPromotionCandidateCommitOf(attempt.correlation)}`
    })
  }
  return yield* appendTargetPromotionSuccess(attempt.correlation, basis, successObservationForCompareAndSet(result))
})

/** Appends the terminal interpretation of one already-observed compare-and-set response. */
export const settleTargetPromotionAttempt = Effect.fn("TargetPromotion.settleAttempt")(function* (
  attempt: TargetPromotionObservedAttempt
) {
  const state = yield* readValidatedTargetPromotionState(attempt.correlation)
  if (
    state?._tag !== "PromotionPending" ||
    state.retry._tag !== "NeedReconciliationRead" ||
    state.retry.afterAttemptOrdinal !== attempt.attemptOrdinal
  ) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: targetPromotionCandidateCommitOf(attempt.correlation),
      detail: "observed promotion attempt no longer matches the exact durable state"
    })
  }
  if (!consumeTargetPromotionObservedAttempt(attempt)) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: targetPromotionCandidateCommitOf(attempt.correlation),
      detail: "promotion result proof was already consumed or did not originate from the Git boundary"
    })
  }
  const result = attempt.result
  const basis = TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal: attempt.attemptOrdinal })
  if (result._tag === "RejectedExpectedHead") {
    return yield* settleRejectedCompareAndSet(attempt, result, basis)
  }
  return yield* settleAppliedCompareAndSet(attempt, result, basis)
})

export const pendingTargetPromotionAfter = (
  attempt: TargetPromotionAmbiguousAttempt | TargetPromotionIntendedAttempt
): TargetPromotionState =>
  TargetPromotionState.cases.PromotionPending.make({
    correlation: attempt.correlation,
    retry: TargetPromotionPendingRetry.cases.NeedReconciliationRead.make({
      afterAttemptOrdinal: attempt.attemptOrdinal
    })
  })
