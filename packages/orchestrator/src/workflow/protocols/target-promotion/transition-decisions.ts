import {
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  type TargetPromotionCompareAndSetResult,
  type TargetPromotionCorrelation,
  type TargetPromotionGitReadFailure,
  type TargetPromotionGitReadObservation,
  TargetPromotionNonConvergenceObservation,
  TargetPromotionReconciliationDeferral,
  TargetPromotionStaleObservation,
  TargetPromotionTerminalBasis,
  TargetPromotionSuccessObservation,
  targetPromotionAttemptLimit,
  targetPromotionCandidateCommitOf,
  targetPromotionExpectedHeadOf,
  targetPromotionGitRequestFor
} from "./events.js"
import {
  readObservationContradiction,
  successObservationForCompareAndSet,
  successObservationForRead
} from "./read-observation.js"
import type { TargetPromotionState } from "./state.js"

type TargetPromotionReadBasis = {
  readonly authority: "ReadOnly" | "RetryAuthorized"
  readonly correlation: TargetPromotionCorrelation
  readonly durableBasis: "DeferredTargetReadFailed" | "PendingAttempt" | "PendingInitial"
  readonly previousAttemptOrdinal: TargetPromotionAttemptOrdinal | undefined
}

type TargetPromotionAttemptBasis = {
  readonly attemptOrdinal: TargetPromotionAttemptOrdinal
  readonly durableBasis: "DeferredRetryAuthority" | "DeferredTargetReadFailed" | "PendingAttempt" | "PendingInitial"
}

export type TargetPromotionReadDecision =
  | {
      readonly _tag: "AttemptAuthorized"
      readonly attemptOrdinal: TargetPromotionAttemptOrdinal
      readonly durableBasis: TargetPromotionReadBasis["durableBasis"]
      readonly reason: TargetPromotionAttemptReason
    }
  | {
      readonly _tag: "NonConvergent"
      readonly attemptOrdinal: TargetPromotionAttemptOrdinal
      readonly observation: TargetPromotionNonConvergenceObservation
    }
  | { readonly _tag: "PropagateFailure"; readonly failure: TargetPromotionGitReadFailure }
  | {
      readonly _tag: "ReconciliationDeferred"
      readonly afterAttemptOrdinal: TargetPromotionAttemptOrdinal
      readonly deferral: TargetPromotionReconciliationDeferral
    }
  | { readonly _tag: "ResultContradiction"; readonly detail: string }
  | {
      readonly _tag: "Stale"
      readonly basis: TargetPromotionTerminalBasis
      readonly observation: TargetPromotionStaleObservation
    }
  | {
      readonly _tag: "Succeeded"
      readonly basis: TargetPromotionTerminalBasis
      readonly observation: TargetPromotionSuccessObservation
    }

type TargetPromotionSettlementDecision =
  | { readonly _tag: "ResultContradiction"; readonly detail: string }
  | { readonly _tag: "Stale"; readonly observation: TargetPromotionStaleObservation }
  | { readonly _tag: "Succeeded"; readonly observation: TargetPromotionSuccessObservation }

const pendingInitialReadMatches = (state: TargetPromotionState | undefined): boolean =>
  state?._tag === "PromotionPending" && state.retry._tag === "NeedInitialReconciliationRead"

const pendingAttemptReadMatches = (basis: TargetPromotionReadBasis, state: TargetPromotionState | undefined): boolean =>
  state?._tag === "PromotionPending" &&
  state.retry._tag === "NeedReconciliationRead" &&
  state.retry.afterAttemptOrdinal === basis.previousAttemptOrdinal

const deferredReadMatches = (basis: TargetPromotionReadBasis, state: TargetPromotionState | undefined): boolean =>
  state?._tag === "PromotionReconciliationDeferred" &&
  state.afterAttemptOrdinal === basis.previousAttemptOrdinal &&
  state.deferral._tag === "TargetReadFailed"

export const targetPromotionReadBasisMatches = (
  basis: TargetPromotionReadBasis,
  state: TargetPromotionState | undefined
): boolean => {
  if (basis.durableBasis === "PendingInitial") return pendingInitialReadMatches(state)
  if (basis.durableBasis === "PendingAttempt") return pendingAttemptReadMatches(basis, state)
  return deferredReadMatches(basis, state)
}

const pendingInitialAttemptMatches = (
  basis: TargetPromotionAttemptBasis,
  state: TargetPromotionState | undefined
): boolean =>
  basis.attemptOrdinal === 1 &&
  state?._tag === "PromotionPending" &&
  state.retry._tag === "NeedInitialReconciliationRead"

const pendingAttemptMatches = (basis: TargetPromotionAttemptBasis, state: TargetPromotionState | undefined): boolean =>
  state?._tag === "PromotionPending" &&
  state.retry._tag === "NeedReconciliationRead" &&
  state.retry.afterAttemptOrdinal === basis.attemptOrdinal - 1

const deferredAttemptMatches = (
  basis: TargetPromotionAttemptBasis,
  state: TargetPromotionState | undefined,
  deferral: "RetryAuthorityRequired" | "TargetReadFailed"
): boolean =>
  state?._tag === "PromotionReconciliationDeferred" &&
  state.afterAttemptOrdinal === basis.attemptOrdinal - 1 &&
  state.deferral._tag === deferral

export const targetPromotionAttemptBasisMatches = (
  basis: TargetPromotionAttemptBasis,
  state: TargetPromotionState | undefined
): boolean => {
  switch (basis.durableBasis) {
    case "PendingInitial":
      return pendingInitialAttemptMatches(basis, state)
    case "PendingAttempt":
      return pendingAttemptMatches(basis, state)
    case "DeferredRetryAuthority":
      return deferredAttemptMatches(basis, state, "RetryAuthorityRequired")
    case "DeferredTargetReadFailed":
      return deferredAttemptMatches(basis, state, "TargetReadFailed")
  }
}

export const decideFailedTargetPromotionRead = (
  basis: TargetPromotionReadBasis,
  failure: TargetPromotionGitReadFailure
): TargetPromotionReadDecision => {
  const previousAttemptOrdinal = basis.previousAttemptOrdinal
  if (previousAttemptOrdinal === undefined) return { _tag: "PropagateFailure", failure }
  if (basis.authority === "ReadOnly" && previousAttemptOrdinal !== targetPromotionAttemptLimit) {
    return {
      _tag: "ReconciliationDeferred",
      afterAttemptOrdinal: previousAttemptOrdinal,
      deferral: TargetPromotionReconciliationDeferral.cases.TargetReadFailed.make({ detail: failure.detail })
    }
  }
  return previousAttemptOrdinal === targetPromotionAttemptLimit
    ? {
        _tag: "NonConvergent",
        attemptOrdinal: previousAttemptOrdinal,
        observation: TargetPromotionNonConvergenceObservation.cases.TargetReadFailed.make({ detail: failure.detail })
      }
    : { _tag: "PropagateFailure", failure }
}

const decideExpectedHeadRead = (
  basis: TargetPromotionReadBasis,
  observedHeadSha: TargetPromotionGitReadObservation["currentHeadSha"]
): TargetPromotionReadDecision => {
  const previousAttemptOrdinal = basis.previousAttemptOrdinal
  if (previousAttemptOrdinal === targetPromotionAttemptLimit) {
    return {
      _tag: "NonConvergent",
      attemptOrdinal: previousAttemptOrdinal,
      observation: TargetPromotionNonConvergenceObservation.cases.ExpectedHeadStillObserved.make({ observedHeadSha })
    }
  }
  if (previousAttemptOrdinal !== undefined && basis.authority === "ReadOnly") {
    return {
      _tag: "ReconciliationDeferred",
      afterAttemptOrdinal: previousAttemptOrdinal,
      deferral: TargetPromotionReconciliationDeferral.cases.RetryAuthorityRequired.make({ observedHeadSha })
    }
  }
  return {
    _tag: "AttemptAuthorized",
    attemptOrdinal: TargetPromotionAttemptOrdinal.make((previousAttemptOrdinal ?? 0) + 1),
    durableBasis: basis.durableBasis,
    reason:
      previousAttemptOrdinal === undefined
        ? TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha })
        : TargetPromotionAttemptReason.cases.ReconciledExpectedHead.make({ observedHeadSha, previousAttemptOrdinal })
  }
}

export const decideSuccessfulTargetPromotionRead = (
  basis: TargetPromotionReadBasis,
  observation: TargetPromotionGitReadObservation
): TargetPromotionReadDecision => {
  const request = targetPromotionGitRequestFor(basis.correlation)
  const contradiction = readObservationContradiction(request, observation)
  if (contradiction !== undefined) return { _tag: "ResultContradiction", detail: contradiction }
  const terminalBasis =
    basis.previousAttemptOrdinal === undefined
      ? TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({})
      : TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal: basis.previousAttemptOrdinal })
  const success = successObservationForRead(observation)
  if (success !== undefined) return { _tag: "Succeeded", basis: terminalBasis, observation: success }
  if (observation.currentHeadSha === request.expectedTargetHead) {
    return decideExpectedHeadRead(basis, observation.currentHeadSha)
  }
  return {
    _tag: "Stale",
    basis: terminalBasis,
    observation: TargetPromotionStaleObservation.cases.ReconciledCandidateNotInAncestry.make({
      observedHeadSha: observation.currentHeadSha
    })
  }
}

export const decideTargetPromotionSettlement = (
  correlation: TargetPromotionCorrelation,
  result: TargetPromotionCompareAndSetResult
): TargetPromotionSettlementDecision => {
  if (result._tag === "Applied") {
    return result.newHeadSha === targetPromotionCandidateCommitOf(correlation)
      ? { _tag: "Succeeded", observation: successObservationForCompareAndSet(result) }
      : {
          _tag: "ResultContradiction",
          detail: `Git reported ${result.newHeadSha} after requesting ${targetPromotionCandidateCommitOf(correlation)}`
        }
  }
  if (result.observedHeadSha === targetPromotionCandidateCommitOf(correlation)) {
    return {
      _tag: "Succeeded",
      observation: TargetPromotionSuccessObservation.cases.ReconciledCandidateCurrent.make({
        candidateAncestry: "Current",
        targetHeadSha: result.observedHeadSha
      })
    }
  }
  return result.observedHeadSha === targetPromotionExpectedHeadOf(correlation)
    ? {
        _tag: "ResultContradiction",
        detail: "Git rejected the compare-and-set while reporting the exact expected head"
      }
    : {
        _tag: "Stale",
        observation: TargetPromotionStaleObservation.cases.CompareAndSetRejected.make({
          observedHeadSha: result.observedHeadSha
        })
      }
}
