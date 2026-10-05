import type {
  TargetPromotionCorrelation,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  TargetPromotionCompareAndSetResult
} from "./events.js"
import type { TargetPromotionState } from "./state.js"

const readAuthorizationBrand: unique symbol = Symbol("TargetPromotionReadAuthorization")
const attemptAuthorizationBrand: unique symbol = Symbol("TargetPromotionAttemptAuthorization")
const intendedAttemptBrand: unique symbol = Symbol("TargetPromotionIntendedAttempt")
export const observedAttemptBrand: unique symbol = Symbol("TargetPromotionObservedAttempt")

/** Process-local permission to perform exactly one promotion read; it is never durable authority. */
export type TargetPromotionReadAuthorization = {
  readonly _tag: "TargetPromotionReadAuthorized"
  readonly [readAuthorizationBrand]: true
  readonly authority: "ReadOnly" | "RetryAuthorized"
  readonly correlation: TargetPromotionCorrelation
  readonly durableBasis: "DeferredTargetReadFailed" | "PendingAttempt" | "PendingInitial"
  readonly previousAttemptOrdinal: TargetPromotionAttemptOrdinal | undefined
}

/** Process-local proof that one exact-head read authorizes one numbered attempt intent. */
export type TargetPromotionAttemptAuthorization = {
  readonly _tag: "TargetPromotionAttemptAuthorized"
  readonly [attemptAuthorizationBrand]: true
  readonly attemptOrdinal: TargetPromotionAttemptOrdinal
  readonly correlation: TargetPromotionCorrelation
  readonly durableBasis: "DeferredRetryAuthority" | "DeferredTargetReadFailed" | "PendingAttempt" | "PendingInitial"
  readonly reason: TargetPromotionAttemptReason
}

/** Process-local proof that the exact numbered attempt intent was appended before Git is called. */
export type TargetPromotionIntendedAttempt = {
  readonly _tag: "TargetPromotionAttemptIntended"
  readonly [intendedAttemptBrand]: true
  readonly attemptOrdinal: TargetPromotionAttemptOrdinal
  readonly correlation: TargetPromotionCorrelation
  readonly reason: TargetPromotionAttemptReason
}

/** An untrusted structural settlement claim; only a registered Git response can settle it. */
export type TargetPromotionSettlementClaim = {
  readonly _tag: "TargetPromotionAttemptObserved"
  readonly attemptOrdinal: TargetPromotionAttemptOrdinal
  readonly correlation: TargetPromotionCorrelation
  readonly result: TargetPromotionCompareAndSetResult
}

/** Process-local proof minted only from the response to one exact Git compare-and-set. */
export type TargetPromotionObservedAttempt = TargetPromotionSettlementClaim & { readonly [observedAttemptBrand]: true }

/** The one Git compare-and-set has no trustworthy response and must be reconciled by a read. */
type TargetPromotionAmbiguousAttempt = {
  readonly _tag: "TargetPromotionAttemptAmbiguous"
  readonly attemptOrdinal: TargetPromotionAttemptOrdinal
  readonly correlation: TargetPromotionCorrelation
}

export type TargetPromotionAttemptBoundaryResult =
  | TargetPromotionObservedAttempt
  | TargetPromotionAmbiguousAttempt
  | Extract<TargetPromotionState, { readonly _tag: "PromotionSafetyRefused" }>

export type TargetPromotionProgress =
  | TargetPromotionState
  | TargetPromotionReadAuthorization
  | TargetPromotionAttemptAuthorization

/** Each transition owner keeps its own private proof registry; another factory cannot mint its permissions. */
export const makeTargetPromotionCapabilities = () => {
  const availableReadAuthorizations = new WeakSet<object>()
  const availableAttemptAuthorizations = new WeakSet<object>()
  const availableIntendedAttempts = new WeakSet<object>()
  const availableObservedAttempts = new WeakSet<object>()

  const mintReadAuthorization = (
    correlation: TargetPromotionCorrelation,
    previousAttemptOrdinal: TargetPromotionAttemptOrdinal | undefined,
    authority: "ReadOnly" | "RetryAuthorized",
    durableBasis: TargetPromotionReadAuthorization["durableBasis"]
  ): TargetPromotionReadAuthorization => {
    const authorization = Object.freeze({
      _tag: "TargetPromotionReadAuthorized" as const,
      [readAuthorizationBrand]: true as const,
      authority,
      correlation,
      durableBasis,
      previousAttemptOrdinal
    })
    availableReadAuthorizations.add(authorization)
    return authorization
  }

  const mintAttemptAuthorization = (
    correlation: TargetPromotionCorrelation,
    attemptOrdinal: TargetPromotionAttemptOrdinal,
    reason: TargetPromotionAttemptReason,
    durableBasis: TargetPromotionAttemptAuthorization["durableBasis"]
  ): TargetPromotionAttemptAuthorization => {
    const authorization = Object.freeze({
      _tag: "TargetPromotionAttemptAuthorized" as const,
      [attemptAuthorizationBrand]: true as const,
      attemptOrdinal,
      correlation,
      durableBasis,
      reason
    })
    availableAttemptAuthorizations.add(authorization)
    return authorization
  }

  const mintIntendedAttempt = (authorization: TargetPromotionAttemptAuthorization): TargetPromotionIntendedAttempt => {
    const intended = Object.freeze({
      _tag: "TargetPromotionAttemptIntended" as const,
      [intendedAttemptBrand]: true as const,
      attemptOrdinal: authorization.attemptOrdinal,
      correlation: authorization.correlation,
      reason: authorization.reason
    })
    availableIntendedAttempts.add(intended)
    return intended
  }

  const mintObservedAttempt = (
    intended: TargetPromotionIntendedAttempt,
    result: TargetPromotionCompareAndSetResult
  ): TargetPromotionObservedAttempt => {
    const observed = Object.freeze({
      _tag: "TargetPromotionAttemptObserved" as const,
      [observedAttemptBrand]: true as const,
      attemptOrdinal: intended.attemptOrdinal,
      correlation: intended.correlation,
      result
    })
    availableObservedAttempts.add(observed)
    return observed
  }

  return {
    availableReadAuthorizations,
    availableAttemptAuthorizations,
    availableIntendedAttempts,
    availableObservedAttempts,
    mintReadAuthorization,
    mintAttemptAuthorization,
    mintIntendedAttempt,
    mintObservedAttempt
  }
}
